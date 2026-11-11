"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgent = runAgent;
exports.runAgentInBackground = runAgentInBackground;
exports.approveProposal = approveProposal;
exports.rejectProposal = rejectProposal;
const env_1 = require("../config/env");
const Order_1 = require("../models/Order");
const Ticket_1 = require("../models/Ticket");
const AppError_1 = require("../utils/AppError");
const background_1 = require("../utils/background");
const logger_1 = require("../observability/logger");
const refundAgentGraph_1 = require("../ai/refundAgentGraph");
const ticketRepo = __importStar(require("../repositories/ticketRepository"));
const io_1 = require("../sockets/io");
const auditLogService_1 = require("./auditLogService");
const commentService_1 = require("./commentService");
const ticketService_1 = require("./ticketService");
const paypalService_1 = require("./paypalService");
const orderService_1 = require("./orderService");
async function loadTicketWithOrder(ticketId) {
    const ticket = await ticketRepo.findTicketDocById(ticketId);
    if (!ticket)
        throw new AppError_1.AppError(404, "NOT_FOUND", "Ticket not found.");
    if (!ticket.order)
        throw new AppError_1.AppError(400, "NO_ORDER", "This ticket isn't linked to a PayPal order.");
    const order = await Order_1.Order.findById(ticket.order);
    if (!order)
        throw new AppError_1.AppError(404, "NOT_FOUND", "The linked order no longer exists.");
    if (!order.captureId)
        throw new AppError_1.AppError(400, "NOT_PAID", "The linked order was never paid.");
    (0, paypalService_1.ensureSimulatedCapture)(order);
    return { ticket, order };
}
async function broadcast(ticketId) {
    const populated = await ticketRepo.findTicketById(ticketId);
    if (populated)
        (0, io_1.emitTicketUpdated)(populated);
}
// Runs the agent and stores its proposal on the ticket. Moves no money.
// actor is null when the system runs it automatically on a new ticket.
async function runAgent(ticketId, actor) {
    const { ticket, order } = await loadTicketWithOrder(ticketId);
    const since = new Date(Date.now() - 90 * 86_400_000);
    const [refundStats] = await Order_1.Order.aggregate([
        { $match: { customer: order.customer } },
        { $unwind: "$refunds" },
        { $match: { "refunds.createdAt": { $gte: since } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$refunds.amount" } } },
    ]);
    const otherOrders = await Order_1.Order.find({
        customer: order.customer,
        _id: { $ne: order._id },
        status: { $ne: "CREATED" },
    })
        .sort({ paidAt: -1 })
        .limit(20);
    const useLlm = env_1.env.AI_ENABLED === "true" && !!env_1.env.GROQ_API_KEY;
    const input = {
        ticketTitle: ticket.title,
        ticketDescription: ticket.description,
        order: {
            orderNumber: order.orderNumber,
            items: order.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice })),
            total: order.total,
            currency: order.currency,
            captureId: order.captureId,
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
        result = await (0, refundAgentGraph_1.runRefundAgent)(input, useLlm);
    }
    catch (err) {
        // If the LLM call fails, run the same graph on rules so the agent
        // still answers. PayPal errors are real problems and are passed on.
        if (useLlm && !(err instanceof AppError_1.AppError)) {
            logger_1.logger.error({ err }, "Refund agent LLM call failed, retrying with rules");
            result = await (0, refundAgentGraph_1.runRefundAgent)(input, false);
        }
        else {
            throw err;
        }
    }
    const proposal = {
        status: "PENDING",
        issueType: result.issueType,
        action: result.action,
        amount: result.amount,
        currency: result.facts.currency,
        reasoning: result.reasoning,
        confidence: result.confidence,
        policyNotes: result.policyNotes,
        customerReply: result.customerReply,
        facts: result.facts,
        steps: result.steps,
        source: result.source,
        paypalMode: (0, paypalService_1.paypalMode)(),
        createdBy: (actor?.userId ?? null),
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
    const previous = await Ticket_1.Ticket.findOneAndUpdate(actor
        ? { _id: ticketId, "refundProposal.status": { $ne: "PROCESSING" } }
        : { _id: ticketId, refundProposal: null }, { $set: { refundProposal: proposal } }, { returnDocument: "before" });
    if (!previous) {
        if (actor)
            throw new AppError_1.AppError(409, "REFUND_IN_PROGRESS", "A refund for this ticket is being processed right now.");
        return; // automatic run lost the race: someone already handled it
    }
    if (previous.refundProposal?.status === "PENDING") {
        await (0, auditLogService_1.logAction)({
            actor: actor?.userId ?? null,
            action: "REFUND_PROPOSAL_REPLACED",
            entity: "Ticket",
            entityId: ticketId,
            oldValue: { action: previous.refundProposal.action, amount: previous.refundProposal.amount },
        });
    }
    await (0, auditLogService_1.logAction)({
        actor: actor?.userId ?? null,
        action: "REFUND_PROPOSED",
        entity: "Ticket",
        entityId: ticketId,
        newValue: { action: result.action, amount: result.amount, issueType: result.issueType },
        metadata: { source: result.source, paypalMode: (0, paypalService_1.paypalMode)(), automatic: actor === null },
    });
    await broadcast(ticketId);
}
// Fire-and-forget version used right after a customer opens a ticket about
// an order: staff find a proposal already waiting. Failures are only logged
// (staff can always click "Run agent" again).
function runAgentInBackground(ticketId) {
    (0, background_1.runInBackground)(runAgent(ticketId, null), `Automatic refund agent run for ${ticketId}`);
}
// Human approval. For a refund action this is the ONLY path that calls the
// PayPal refund API. For no-refund / ask-for-info it just sends the reply.
async function approveProposal(ticketId, actor, overrides) {
    const { order } = await loadTicketWithOrder(ticketId);
    // Claim the proposal (PENDING -> PROCESSING in one atomic step) before
    // calling PayPal, so a double click can't start two refunds, and we act on
    // exactly the proposal we claimed. PayPal-Request-Id is a second safety net.
    const ticket = await ticketRepo.claimPendingProposal(ticketId);
    if (!ticket || !ticket.refundProposal) {
        throw new AppError_1.AppError(409, "NO_PENDING_PROPOSAL", "There's no pending refund proposal to approve. Run the agent first.");
    }
    const proposal = ticket.refundProposal;
    const reply = overrides.customerReply?.trim() || proposal.customerReply;
    const isRefund = proposal.action === "FULL_REFUND" || proposal.action === "PARTIAL_REFUND";
    if (isRefund) {
        const amount = overrides.amount ?? proposal.amount;
        try {
            const refund = await (0, orderService_1.refundOrder)({
                order,
                amount,
                reason: `Ticket ${ticket.ticketNumber}: ${proposal.issueType.replace(/_/g, " ").toLowerCase()}`,
                ticketId,
                approvedBy: actor.userId,
                idempotencyKey: `refund-${ticketId}-${proposal.createdAt.getTime()}`,
            });
            ticket.refundProposal.status = "EXECUTED";
            ticket.refundProposal.executedAmount = refund.amount;
            ticket.refundProposal.paypalRefundId = refund.refundId;
        }
        catch (err) {
            ticket.refundProposal.status = "FAILED";
            ticket.refundProposal.error = err instanceof Error ? err.message : "Refund failed.";
            ticket.refundProposal.decidedBy = actor.userId;
            ticket.refundProposal.decidedAt = new Date();
            ticket.markModified("refundProposal");
            await ticket.save();
            await (0, auditLogService_1.logAction)({
                actor: actor.userId,
                action: "REFUND_FAILED",
                entity: "Ticket",
                entityId: ticketId,
                metadata: { error: ticket.refundProposal.error },
            });
            await broadcast(ticketId);
            throw err;
        }
    }
    else {
        ticket.refundProposal.status = "SENT";
    }
    ticket.refundProposal.customerReply = reply;
    ticket.refundProposal.decidedBy = actor.userId;
    ticket.refundProposal.decidedAt = new Date();
    ticket.markModified("refundProposal");
    await ticket.save();
    await (0, auditLogService_1.logAction)({
        actor: actor.userId,
        action: isRefund ? "REFUND_APPROVED" : "REFUND_REPLY_SENT",
        entity: "Ticket",
        entityId: ticketId,
        newValue: {
            action: proposal.action,
            amount: ticket.refundProposal.executedAmount,
            paypalRefundId: ticket.refundProposal.paypalRefundId,
        },
    });
    // Send the reply to the customer as a normal (public) comment.
    await (0, commentService_1.addComment)(ticketId, actor, reply, false);
    // A refund settles the ticket: resolve it if the workflow allows it now.
    if (isRefund && (0, ticketService_1.isLegalTransition)(ticket.status, "RESOLVED")) {
        await (0, ticketService_1.updateTicketStatus)(ticketId, "RESOLVED", actor);
    }
    else {
        await broadcast(ticketId);
    }
    return (0, ticketService_1.getTicketById)(ticketId, actor);
}
async function rejectProposal(ticketId, actor, note) {
    const ticket = await ticketRepo.findTicketDocById(ticketId);
    if (!ticket)
        throw new AppError_1.AppError(404, "NOT_FOUND", "Ticket not found.");
    if (!ticket.refundProposal || ticket.refundProposal.status !== "PENDING") {
        throw new AppError_1.AppError(409, "NO_PENDING_PROPOSAL", "There's no pending refund proposal to reject.");
    }
    ticket.refundProposal.status = "REJECTED";
    ticket.refundProposal.decidedBy = actor.userId;
    ticket.refundProposal.decidedAt = new Date();
    ticket.markModified("refundProposal");
    await ticket.save();
    await (0, auditLogService_1.logAction)({
        actor: actor.userId,
        action: "REFUND_REJECTED",
        entity: "Ticket",
        entityId: ticketId,
        oldValue: { action: ticket.refundProposal.action, amount: ticket.refundProposal.amount },
        metadata: note ? { note } : {},
    });
    if (note?.trim())
        await (0, commentService_1.addComment)(ticketId, actor, `Refund agent proposal rejected: ${note.trim()}`, true);
    await broadcast(ticketId);
    return (0, ticketService_1.getTicketById)(ticketId, actor);
}
