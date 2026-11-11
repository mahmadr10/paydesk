import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { env } from "../config/env";
import { Order } from "../models/Order";
import { Ticket, IDisputeProposal } from "../models/Ticket";
import { User } from "../models/User";
import { WebhookEvent } from "../models/WebhookEvent";
import { AppError } from "../utils/AppError";
import { runInBackground } from "../utils/background";
import { JwtPayload } from "../utils/jwt";
import { logger } from "../observability/logger";
import * as ticketRepo from "../repositories/ticketRepository";
import { emitNewTicket, emitTicketUpdated } from "../sockets/io";
import { runDisputeAgent } from "../ai/disputeAgentGraph";
import * as paypal from "./paypalService";
import { logAction } from "./auditLogService";
import { addComment } from "./commentService";
import { getSlaMinutesForPriority, addMinutes } from "./slaService";
import { getTicketById } from "./ticketService";

const human = (s: string) => s.replace(/_/g, " ").toLowerCase();

// Disputes from buyers we don't have an account for are filed under one
// inactive placeholder user (cases need a customer).
async function placeholderBuyer() {
  const email = "paypal-buyer@system.paydesk";
  const existing = await User.findOne({ email });
  if (existing) return existing;
  return User.create({
    name: "PayPal buyer",
    email,
    passwordHash: await bcrypt.hash(randomUUID(), 10),
    role: "CUSTOMER",
    isActive: false,
  });
}

function toDisputeDoc(raw: any) {
  const s = paypal.normalizeDispute(raw);
  return {
    disputeId: s.disputeId,
    reason: s.reason,
    status: s.status,
    stage: s.stage,
    amount: s.amount,
    currency: s.currency,
    sellerResponseDue: s.sellerResponseDue ? new Date(s.sellerResponseDue) : null,
    transactionId: s.transactionId,
    buyerName: s.buyerName,
    messages: s.messages,
    outcome: s.outcome,
    actions: s.actions,
    raw,
    lastSyncedAt: new Date(),
  };
}

async function broadcast(ticketId: string) {
  const t = await ticketRepo.findTicketById(ticketId);
  if (t) emitTicketUpdated(t);
}

// Pull a dispute fresh from PayPal and create/update its case.
export async function syncDispute(disputeId: string, opts: { autoRun: boolean }) {
  const raw = await paypal.getDisputeRaw(disputeId);
  const dispute = toDisputeDoc(raw);

  const existing = await Ticket.findOne({ "dispute.disputeId": disputeId });
  if (existing) {
    const wasResolved = existing.dispute?.status === "RESOLVED";
    existing.dispute = dispute as any;
    await existing.save();
    if (!wasResolved && dispute.status === "RESOLVED") {
      await logAction({ actor: null, action: "DISPUTE_RESOLVED", entity: "Ticket", entityId: String(existing._id), newValue: dispute.outcome });
    }
    await broadcast(String(existing._id));
    return { ticketId: String(existing._id), created: false };
  }

  const order = dispute.transactionId ? await Order.findOne({ captureId: dispute.transactionId }) : null;
  const customerId = order ? order.customer : (await placeholderBuyer())._id;
  const priority = dispute.stage === "INQUIRY" ? "HIGH" : "CRITICAL";
  const { responseMinutes, resolutionMinutes } = await getSlaMinutesForPriority(priority);
  const now = new Date();
  const buyerSaid = dispute.messages.filter((m) => m.postedBy === "BUYER").map((m) => m.content).join("\n");

  try {
    const ticket = await ticketRepo.createTicket({
      ticketNumber: await ticketRepo.nextTicketNumber(),
      title: `PayPal dispute: ${human(dispute.reason)} (${dispute.amount} ${dispute.currency})`,
      description: buyerSaid || `PayPal opened a ${human(dispute.stage)} for ${dispute.amount} ${dispute.currency}.`,
      category: "Payment",
      priority,
      tags: ["paypal-dispute", dispute.reason.toLowerCase()],
      status: "OPEN",
      customer: customerId as any,
      assignedAgent: null,
      responseDeadline: addMinutes(now, responseMinutes),
      // The real deadline is PayPal's: answer by then or lose automatically.
      resolutionDeadline: dispute.sellerResponseDue ?? addMinutes(now, resolutionMinutes),
      firstResponseAt: null,
      resolvedAt: null,
      order: (order?._id ?? null) as any,
      dispute: dispute as any,
    });
    await logAction({
      actor: null,
      action: "DISPUTE_RECEIVED",
      entity: "Ticket",
      entityId: String(ticket._id),
      newValue: { disputeId, reason: dispute.reason, amount: dispute.amount, orderNumber: order?.orderNumber ?? null },
    });
    emitNewTicket(ticket);
    if (opts.autoRun) runAgentInBackground(String(ticket._id));
    return { ticketId: String(ticket._id), created: true };
  } catch (err: any) {
    if (err?.code === 11000) return syncDispute(disputeId, { autoRun: false }); // duplicate webhook raced us
    throw err;
  }
}

export async function syncAllDisputes() {
  const ids = await paypal.listDisputeIds();
  let created = 0;
  for (const id of ids) {
    const r = await syncDispute(id, { autoRun: true });
    if (r.created) created++;
  }
  return { checked: ids.length, created };
}

async function loadDisputeCase(ticketId: string) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new AppError(404, "NOT_FOUND", "Case not found.");
  if (!ticket.dispute) throw new AppError(400, "NOT_A_DISPUTE", "This case isn't a PayPal dispute.");
  paypal.restoreSimulatedDispute(ticket.dispute.raw);
  const order = ticket.order ? await Order.findById(ticket.order) : null;
  if (order) paypal.ensureSimulatedCapture(order);
  return { ticket, order };
}

export async function runAgent(ticketId: string, actor: JwtPayload | null) {
  const { ticket, order } = await loadDisputeCase(ticketId);
  const priorCases = await Ticket.find({ customer: ticket.customer, _id: { $ne: ticket._id } })
    .sort({ createdAt: -1 })
    .limit(10);
  const input = {
    disputeId: ticket.dispute!.disputeId,
    order: order?.captureId
      ? {
          orderNumber: order.orderNumber,
          items: order.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice })),
          total: order.total,
          currency: order.currency,
          captureId: order.captureId,
          paidAt: order.paidAt,
          payerEmail: order.payerEmail,
          refundedTotal: order.refundedTotal,
          deliveredAt: order.fulfillment?.deliveredAt ?? null,
          accessCount: order.fulfillment?.accessCount ?? 0,
          lastAccessAt: order.fulfillment?.lastAccessAt ?? null,
        }
      : null,
    priorCases: priorCases.map((c) => ({ ticketNumber: c.ticketNumber, title: c.title, status: c.status, createdAt: c.createdAt })),
  };

  const useLlm = env.AI_ENABLED === "true" && !!env.GROQ_API_KEY;
  let r;
  try {
    r = await runDisputeAgent(input, useLlm);
  } catch (err) {
    if (!useLlm || err instanceof AppError) throw err;
    logger.error({ err }, "Dispute agent LLM failed, retrying with rules");
    r = await runDisputeAgent(input, false);
  }

  const proposal: IDisputeProposal = {
    status: "PENDING",
    action: r.action,
    amount: r.amount,
    currency: r.facts.currency,
    winChance: r.winChance,
    reasoning: r.reasoning,
    policyNotes: r.policyNotes,
    responseNote: r.responseNote,
    evidenceText: r.evidenceText,
    facts: r.facts as any,
    steps: r.steps,
    source: r.source,
    createdBy: (actor?.userId ?? null) as any,
    createdAt: new Date(),
    decidedBy: null,
    decidedAt: null,
    error: null,
  };
  // Automatic runs only fill an empty slot; manual runs never replace one mid-send.
  const prev = await Ticket.findOneAndUpdate(
    actor ? { _id: ticketId, "disputeProposal.status": { $ne: "PROCESSING" } } : { _id: ticketId, disputeProposal: null },
    { $set: { disputeProposal: proposal, dispute: toDisputeDoc(await paypal.getDisputeRaw(input.disputeId)) } },
    { returnDocument: "before" }
  );
  if (!prev) {
    if (actor) throw new AppError(409, "DISPUTE_BUSY", "A response for this dispute is being sent right now.");
    return;
  }
  await logAction({
    actor: actor?.userId ?? null,
    action: "DISPUTE_RESPONSE_PROPOSED",
    entity: "Ticket",
    entityId: ticketId,
    newValue: { action: r.action, amount: r.amount, winChance: r.winChance },
    metadata: { source: r.source, automatic: actor === null },
  });
  await broadcast(ticketId);
}

export function runAgentInBackground(ticketId: string) {
  runInBackground(runAgent(ticketId, null), `Automatic dispute agent run for ${ticketId}`);
}

// Human approval: the only place we answer PayPal.
export async function approve(ticketId: string, actor: JwtPayload, overrides: { amount?: number; responseNote?: string }) {
  const { order } = await loadDisputeCase(ticketId);
  const ticket = await Ticket.findOneAndUpdate(
    { _id: ticketId, "disputeProposal.status": "PENDING" },
    { $set: { "disputeProposal.status": "PROCESSING" } },
    { returnDocument: "after" }
  );
  if (!ticket?.disputeProposal || !ticket.dispute) throw new AppError(409, "NO_PENDING_PROPOSAL", "No pending response to approve. Run the agent first.");
  const p = ticket.disputeProposal;
  const d = ticket.dispute;
  const note = overrides.responseNote?.trim() || p.responseNote;
  const amount = overrides.amount ?? p.amount;

  try {
    if (p.action === "ACCEPT_CLAIM") {
      await paypal.acceptDisputeClaim(d.disputeId, note, amount, p.currency);
      if (order) {
        order.refunds.push({ refundId: `DISPUTE-${d.disputeId}`, amount, status: "COMPLETED", reason: `Dispute ${d.disputeId} accepted`, ticket: ticket._id, approvedBy: actor.userId as any, createdAt: new Date() });
        order.refundedTotal = Math.round((order.refundedTotal + amount) * 100) / 100;
        order.status = order.refundedTotal >= order.total - 0.001 ? "REFUNDED" : "PARTIALLY_REFUNDED";
        await order.save();
      }
    } else if (p.action === "MAKE_OFFER") {
      await paypal.makeDisputeOffer(d.disputeId, note, amount, p.currency);
    } else if (p.action === "CONTEST") {
      await paypal.provideDisputeEvidence(d.disputeId, note, p.evidenceText);
    } else {
      throw new AppError(400, "NOTHING_TO_SEND", "The agent found nothing to send for this dispute.");
    }
  } catch (err) {
    p.status = "FAILED";
    p.error = err instanceof Error ? err.message : "Failed";
    p.decidedBy = actor.userId as any;
    p.decidedAt = new Date();
    ticket.markModified("disputeProposal");
    await ticket.save();
    await logAction({ actor: actor.userId, action: "DISPUTE_RESPONSE_FAILED", entity: "Ticket", entityId: ticketId, metadata: { error: p.error } });
    await broadcast(ticketId);
    throw err;
  }

  p.status = "EXECUTED";
  p.responseNote = note;
  p.amount = amount;
  p.decidedBy = actor.userId as any;
  p.decidedAt = new Date();
  ticket.markModified("disputeProposal");
  ticket.dispute = toDisputeDoc(await paypal.getDisputeRaw(d.disputeId)) as any;
  await ticket.save();

  await logAction({
    actor: actor.userId,
    action: "DISPUTE_RESPONSE_SENT",
    entity: "Ticket",
    entityId: ticketId,
    newValue: { action: p.action, amount, disputeStatus: ticket.dispute!.status },
  });
  await addComment(
    ticketId,
    actor,
    `Sent to PayPal: ${human(p.action)}${amount > 0 ? ` (${amount} ${p.currency})` : ""}. Dispute is now ${human(ticket.dispute!.status)}.\n\n${note}`,
    true
  );
  await broadcast(ticketId);
  return getTicketById(ticketId, actor);
}

export async function reject(ticketId: string, actor: JwtPayload) {
  const ticket = await Ticket.findOneAndUpdate(
    { _id: ticketId, "disputeProposal.status": "PENDING" },
    { $set: { "disputeProposal.status": "REJECTED", "disputeProposal.decidedBy": actor.userId, "disputeProposal.decidedAt": new Date() } },
    { returnDocument: "after" }
  );
  if (!ticket) throw new AppError(409, "NO_PENDING_PROPOSAL", "No pending response to reject.");
  await logAction({ actor: actor.userId, action: "DISPUTE_RESPONSE_REJECTED", entity: "Ticket", entityId: ticketId });
  await broadcast(ticketId);
  return getTicketById(ticketId, actor);
}

// Sandbox/simulator only: ask PayPal to decide a dispute that's under review.
export async function adjudicate(ticketId: string, actor: JwtPayload, outcome: "BUYER_FAVOR" | "SELLER_FAVOR") {
  if (env.PAYPAL_API_BASE.includes("api-m.paypal.com")) throw new AppError(400, "NOT_SANDBOX", "Only available in sandbox.");
  const { ticket } = await loadDisputeCase(ticketId);
  await paypal.adjudicateDispute(ticket.dispute!.disputeId, outcome);
  await syncDispute(ticket.dispute!.disputeId, { autoRun: false });
  await logAction({ actor: actor.userId, action: "DISPUTE_ADJUDICATED_SANDBOX", entity: "Ticket", entityId: ticketId, newValue: { outcome } });
  return getTicketById(ticketId, actor);
}

// ── Webhooks ────────────────────────────────────────────────────────────

export async function handleWebhookEvent(event: any, source: "paypal" | "simulated", verified: boolean) {
  const eventId: string = event?.id ?? `SIM-${randomUUID()}`;
  const type: string = event?.event_type ?? "UNKNOWN";
  const resourceId: string | null = event?.resource?.dispute_id ?? event?.resource?.id ?? null;

  try {
    await WebhookEvent.create({ eventId, eventType: type, resourceId, verified, source, result: "processing" });
  } catch (err: any) {
    if (err?.code === 11000) return { duplicate: true }; // PayPal retried: already handled
    throw err;
  }

  let result = "ignored";
  if (type.startsWith("CUSTOMER.DISPUTE.") && resourceId) {
    const r = await syncDispute(resourceId, { autoRun: type === "CUSTOMER.DISPUTE.CREATED" });
    result = r.created ? "case created, agent started" : "case updated";
  } else if (type.startsWith("PAYMENT.CAPTURE.")) {
    result = "recorded";
  }
  await WebhookEvent.updateOne({ eventId }, { $set: { result } });
  return { duplicate: false, result };
}

export function listWebhookEvents() {
  return WebhookEvent.find().sort({ receivedAt: -1 }).limit(30);
}

// Simulated mode only: a buyer opens a dispute, and it reaches us through
// the same webhook path a real PayPal event would.
export async function simulateBuyerDispute(customer: JwtPayload, orderId: string, reason: string, message: string) {
  if (paypal.paypalMode() !== "simulated") {
    throw new AppError(400, "USE_PAYPAL", "With real sandbox keys, open the dispute as the buyer on sandbox.paypal.com.");
  }
  const order = await Order.findById(orderId);
  if (!order || order.customer.toString() !== customer.userId) throw new AppError(404, "NOT_FOUND", "Order not found.");
  if (!order.captureId) throw new AppError(400, "NOT_PAID", "This order was never paid.");
  const user = await User.findById(customer.userId);
  const raw = paypal.createSimulatedDispute({
    captureId: order.captureId,
    amount: order.total - order.refundedTotal,
    currency: order.currency,
    reason,
    buyerName: user?.name ?? "Buyer",
    buyerMessage: message,
  });
  return handleWebhookEvent(
    { id: `WH-SIM-${randomUUID().slice(0, 8)}`, event_type: "CUSTOMER.DISPUTE.CREATED", resource: { dispute_id: raw.dispute_id } },
    "simulated",
    false
  );
}
