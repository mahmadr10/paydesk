import { env } from "../config/env";
import { Order } from "../models/Order";
import { Ticket, IRefundProposal } from "../models/Ticket";
import { AppError } from "../utils/AppError";
import { JwtPayload } from "../utils/jwt";
import { logger } from "../observability/logger";
import { runRefundAgent } from "../ai/refundAgentGraph";
import * as ticketRepo from "../repositories/ticketRepository";
import { emitTicketUpdated } from "../sockets/io";
import { logAction } from "./auditLogService";
import { addComment } from "./commentService";
import { isLegalTransition, updateTicketStatus, getTicketById } from "./ticketService";
import { paypalMode, ensureSimulatedCapture } from "./paypalService";
import { refundOrder } from "./orderService";

async function loadTicketWithOrder(ticketId: string) {
  const ticket = await ticketRepo.findTicketDocById(ticketId);
  if (!ticket) throw new AppError(404, "NOT_FOUND", "Ticket not found.");
  if (!ticket.order) throw new AppError(400, "NO_ORDER", "This ticket isn't linked to a PayPal order.");
  const order = await Order.findById(ticket.order);
  if (!order) throw new AppError(404, "NOT_FOUND", "The linked order no longer exists.");
  if (!order.captureId) throw new AppError(400, "NOT_PAID", "The linked order was never paid.");
  ensureSimulatedCapture(order);
  return { ticket, order };
}

async function broadcast(ticketId: string) {
  const populated = await ticketRepo.findTicketById(ticketId);
  if (populated) emitTicketUpdated(populated);
}

// Runs the agent and stores its proposal on the ticket. Moves no money.
// actor is null when the system runs it automatically on a new ticket.
export async function runAgent(ticketId: string, actor: JwtPayload | null) {
  const { ticket, order } = await loadTicketWithOrder(ticketId);

  const since = new Date(Date.now() - 90 * 86_400_000);
  const [refundStats] = await Order.aggregate<{ count: number; total: number }>([
    { $match: { customer: order.customer } },
    { $unwind: "$refunds" },
    { $match: { "refunds.createdAt": { $gte: since } } },
    { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$refunds.amount" } } },
  ]);

  const otherOrders = await Order.find({
    customer: order.customer,
    _id: { $ne: order._id },
    status: { $ne: "CREATED" },
  })
    .sort({ paidAt: -1 })
    .limit(20);

  const useLlm = env.AI_ENABLED === "true" && !!env.GROQ_API_KEY;
  const input = {
    ticketTitle: ticket.title,
    ticketDescription: ticket.description,
    order: {
      orderNumber: order.orderNumber,
      items: order.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice })),
      total: order.total,
      currency: order.currency,
      captureId: order.captureId!,
      refundedTotal: order.refundedTotal,
      paidAt: order.paidAt,
    },
    otherOrders: otherOrders.map((o) => ({
      orderNumber: o.orderNumber,
      total: o.total,
      paidAt: o.paidAt,
      itemNames: o.items.map((i) => i.name),
    })),
    recentRefunds: { count: refundStats?.count ?? 0, total: refundStats?.total ?? 0 },
  };

  let result;
  try {
    result = await runRefundAgent(input, useLlm);
  } catch (err) {
    // If the LLM call fails, run the same graph on rules so the agent
    // still answers. PayPal errors are real problems and are passed on.
    if (useLlm && !(err instanceof AppError)) {
      logger.error({ err }, "Refund agent LLM call failed, retrying with rules");
      result = await runRefundAgent(input, false);
    } else {
      throw err;
    }
  }

  const proposal: IRefundProposal = {
    status: "PENDING",
    issueType: result.issueType,
    action: result.action,
    amount: result.amount,
    currency: result.facts.currency,
    reasoning: result.reasoning,
    confidence: result.confidence,
    policyNotes: result.policyNotes,
    customerReply: result.customerReply,
    facts: result.facts as unknown as Record<string, unknown>,
    steps: result.steps,
    source: result.source,
    paypalMode: paypalMode(),
    createdBy: (actor?.userId ?? null) as any,
    createdAt: new Date(),
    decidedBy: null,
    decidedAt: null,
    executedAmount: null,
    paypalRefundId: null,
    error: null,
  };

  // Save conditionally, because the agent can take a few seconds:
  //  - an automatic run only fills an empty slot (never overwrites a
  //    proposal a person already ran, approved or rejected meanwhile);
  //  - a manual run never replaces one that's mid-refund.
  const previous = await Ticket.findOneAndUpdate(
    actor
      ? { _id: ticketId, "refundProposal.status": { $ne: "PROCESSING" } }
      : { _id: ticketId, refundProposal: null },
    { $set: { refundProposal: proposal } },
    { returnDocument: "before" }
  );
  if (!previous) {
    if (actor) throw new AppError(409, "REFUND_IN_PROGRESS", "A refund for this ticket is being processed right now.");
    return; // automatic run lost the race: someone already handled it
  }
  if (previous.refundProposal?.status === "PENDING") {
    await logAction({
      actor: actor?.userId ?? null,
      action: "REFUND_PROPOSAL_REPLACED",
      entity: "Ticket",
      entityId: ticketId,
      oldValue: { action: previous.refundProposal.action, amount: previous.refundProposal.amount },
    });
  }

  await logAction({
    actor: actor?.userId ?? null,
    action: "REFUND_PROPOSED",
    entity: "Ticket",
    entityId: ticketId,
    newValue: { action: result.action, amount: result.amount, issueType: result.issueType },
    metadata: { source: result.source, paypalMode: paypalMode(), automatic: actor === null },
  });

  await broadcast(ticketId);
}

// Fire-and-forget version used right after a customer opens a ticket about
// an order: staff find a proposal already waiting. Failures are only logged
// (staff can always click "Run agent" again).
export function runAgentInBackground(ticketId: string) {
  runAgent(ticketId, null).catch((err) => logger.error({ err, ticketId }, "Automatic refund agent run failed"));
}

// Human approval. For a refund action this is the ONLY path that calls the
// PayPal refund API. For no-refund / ask-for-info it just sends the reply.
export async function approveProposal(
  ticketId: string,
  actor: JwtPayload,
  overrides: { amount?: number; customerReply?: string }
) {
  const { order } = await loadTicketWithOrder(ticketId);

  // Claim the proposal (PENDING -> PROCESSING in one atomic step) before
  // calling PayPal, so a double click can't start two refunds, and we act on
  // exactly the proposal we claimed. PayPal-Request-Id is a second safety net.
  const ticket = await ticketRepo.claimPendingProposal(ticketId);
  if (!ticket || !ticket.refundProposal) {
    throw new AppError(409, "NO_PENDING_PROPOSAL", "There's no pending refund proposal to approve. Run the agent first.");
  }
  const proposal = ticket.refundProposal;

  const reply = overrides.customerReply?.trim() || proposal.customerReply;
  const isRefund = proposal.action === "FULL_REFUND" || proposal.action === "PARTIAL_REFUND";

  if (isRefund) {
    const amount = overrides.amount ?? proposal.amount;
    try {
      const refund = await refundOrder({
        order,
        amount,
        reason: `Ticket ${ticket.ticketNumber}: ${proposal.issueType.replace(/_/g, " ").toLowerCase()}`,
        ticketId,
        approvedBy: actor.userId,
        idempotencyKey: `refund-${ticketId}-${proposal.createdAt.getTime()}`,
      });
      ticket.refundProposal!.status = "EXECUTED";
      ticket.refundProposal!.executedAmount = refund.amount;
      ticket.refundProposal!.paypalRefundId = refund.refundId;
    } catch (err) {
      ticket.refundProposal!.status = "FAILED";
      ticket.refundProposal!.error = err instanceof Error ? err.message : "Refund failed.";
      ticket.refundProposal!.decidedBy = actor.userId as any;
      ticket.refundProposal!.decidedAt = new Date();
      ticket.markModified("refundProposal");
      await ticket.save();
      await logAction({
        actor: actor.userId,
        action: "REFUND_FAILED",
        entity: "Ticket",
        entityId: ticketId,
        metadata: { error: ticket.refundProposal!.error },
      });
      await broadcast(ticketId);
      throw err;
    }
  } else {
    ticket.refundProposal!.status = "SENT";
  }

  ticket.refundProposal!.customerReply = reply;
  ticket.refundProposal!.decidedBy = actor.userId as any;
  ticket.refundProposal!.decidedAt = new Date();
  ticket.markModified("refundProposal");
  await ticket.save();

  await logAction({
    actor: actor.userId,
    action: isRefund ? "REFUND_APPROVED" : "REFUND_REPLY_SENT",
    entity: "Ticket",
    entityId: ticketId,
    newValue: {
      action: proposal.action,
      amount: ticket.refundProposal!.executedAmount,
      paypalRefundId: ticket.refundProposal!.paypalRefundId,
    },
  });

  // Send the reply to the customer as a normal (public) comment.
  await addComment(ticketId, actor, reply, false);

  // A refund settles the ticket: resolve it if the workflow allows it now.
  if (isRefund && isLegalTransition(ticket.status, "RESOLVED")) {
    await updateTicketStatus(ticketId, "RESOLVED", actor);
  } else {
    await broadcast(ticketId);
  }
  return getTicketById(ticketId, actor);
}

export async function rejectProposal(ticketId: string, actor: JwtPayload, note?: string) {
  const ticket = await ticketRepo.findTicketDocById(ticketId);
  if (!ticket) throw new AppError(404, "NOT_FOUND", "Ticket not found.");
  if (!ticket.refundProposal || ticket.refundProposal.status !== "PENDING") {
    throw new AppError(409, "NO_PENDING_PROPOSAL", "There's no pending refund proposal to reject.");
  }
  ticket.refundProposal.status = "REJECTED";
  ticket.refundProposal.decidedBy = actor.userId as any;
  ticket.refundProposal.decidedAt = new Date();
  ticket.markModified("refundProposal");
  await ticket.save();

  await logAction({
    actor: actor.userId,
    action: "REFUND_REJECTED",
    entity: "Ticket",
    entityId: ticketId,
    oldValue: { action: ticket.refundProposal.action, amount: ticket.refundProposal.amount },
    metadata: note ? { note } : {},
  });
  if (note?.trim()) await addComment(ticketId, actor, `Refund agent proposal rejected: ${note.trim()}`, true);

  await broadcast(ticketId);
  return getTicketById(ticketId, actor);
}
