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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncDispute = syncDispute;
exports.syncAllDisputes = syncAllDisputes;
exports.runAgent = runAgent;
exports.runAgentInBackground = runAgentInBackground;
exports.approve = approve;
exports.reject = reject;
exports.adjudicate = adjudicate;
exports.handleWebhookEvent = handleWebhookEvent;
exports.listWebhookEvents = listWebhookEvents;
exports.simulateBuyerDispute = simulateBuyerDispute;
const crypto_1 = require("crypto");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const env_1 = require("../config/env");
const Order_1 = require("../models/Order");
const Ticket_1 = require("../models/Ticket");
const User_1 = require("../models/User");
const WebhookEvent_1 = require("../models/WebhookEvent");
const AppError_1 = require("../utils/AppError");
const background_1 = require("../utils/background");
const logger_1 = require("../observability/logger");
const ticketRepo = __importStar(require("../repositories/ticketRepository"));
const io_1 = require("../sockets/io");
const disputeAgentGraph_1 = require("../ai/disputeAgentGraph");
const paypal = __importStar(require("./paypalService"));
const auditLogService_1 = require("./auditLogService");
const commentService_1 = require("./commentService");
const slaService_1 = require("./slaService");
const ticketService_1 = require("./ticketService");
const human = (s) => s.replace(/_/g, " ").toLowerCase();
// Disputes from buyers we don't have an account for are filed under one
// inactive placeholder user (cases need a customer).
async function placeholderBuyer() {
    const email = "paypal-buyer@system.paydesk";
    const existing = await User_1.User.findOne({ email });
    if (existing)
        return existing;
    return User_1.User.create({
        name: "PayPal buyer",
        email,
        passwordHash: await bcryptjs_1.default.hash((0, crypto_1.randomUUID)(), 10),
        role: "CUSTOMER",
        isActive: false,
    });
}
function toDisputeDoc(raw) {
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
async function broadcast(ticketId) {
    const t = await ticketRepo.findTicketById(ticketId);
    if (t)
        (0, io_1.emitTicketUpdated)(t);
}
// Pull a dispute fresh from PayPal and create/update its case.
async function syncDispute(disputeId, opts) {
    const raw = await paypal.getDisputeRaw(disputeId);
    const dispute = toDisputeDoc(raw);
    const existing = await Ticket_1.Ticket.findOne({ "dispute.disputeId": disputeId });
    if (existing) {
        const wasResolved = existing.dispute?.status === "RESOLVED";
        existing.dispute = dispute;
        await existing.save();
        if (!wasResolved && dispute.status === "RESOLVED") {
            await (0, auditLogService_1.logAction)({ actor: null, action: "DISPUTE_RESOLVED", entity: "Ticket", entityId: String(existing._id), newValue: dispute.outcome });
        }
        await broadcast(String(existing._id));
        return { ticketId: String(existing._id), created: false };
    }
    const order = dispute.transactionId ? await Order_1.Order.findOne({ captureId: dispute.transactionId }) : null;
    const customerId = order ? order.customer : (await placeholderBuyer())._id;
    const priority = dispute.stage === "INQUIRY" ? "HIGH" : "CRITICAL";
    const { responseMinutes, resolutionMinutes } = await (0, slaService_1.getSlaMinutesForPriority)(priority);
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
            customer: customerId,
            assignedAgent: null,
            responseDeadline: (0, slaService_1.addMinutes)(now, responseMinutes),
            // The real deadline is PayPal's: answer by then or lose automatically.
            resolutionDeadline: dispute.sellerResponseDue ?? (0, slaService_1.addMinutes)(now, resolutionMinutes),
            firstResponseAt: null,
            resolvedAt: null,
            order: (order?._id ?? null),
            dispute: dispute,
        });
        await (0, auditLogService_1.logAction)({
            actor: null,
            action: "DISPUTE_RECEIVED",
            entity: "Ticket",
            entityId: String(ticket._id),
            newValue: { disputeId, reason: dispute.reason, amount: dispute.amount, orderNumber: order?.orderNumber ?? null },
        });
        (0, io_1.emitNewTicket)(ticket);
        if (opts.autoRun)
            runAgentInBackground(String(ticket._id));
        return { ticketId: String(ticket._id), created: true };
    }
    catch (err) {
        if (err?.code === 11000)
            return syncDispute(disputeId, { autoRun: false }); // duplicate webhook raced us
        throw err;
    }
}
async function syncAllDisputes() {
    const ids = await paypal.listDisputeIds();
    let created = 0;
    for (const id of ids) {
        const r = await syncDispute(id, { autoRun: true });
        if (r.created)
            created++;
    }
    return { checked: ids.length, created };
}
async function loadDisputeCase(ticketId) {
    const ticket = await Ticket_1.Ticket.findById(ticketId);
    if (!ticket)
        throw new AppError_1.AppError(404, "NOT_FOUND", "Case not found.");
    if (!ticket.dispute)
        throw new AppError_1.AppError(400, "NOT_A_DISPUTE", "This case isn't a PayPal dispute.");
    paypal.restoreSimulatedDispute(ticket.dispute.raw);
    const order = ticket.order ? await Order_1.Order.findById(ticket.order) : null;
    if (order)
        paypal.ensureSimulatedCapture(order);
    return { ticket, order };
}
async function runAgent(ticketId, actor) {
    const { ticket, order } = await loadDisputeCase(ticketId);
    const priorCases = await Ticket_1.Ticket.find({ customer: ticket.customer, _id: { $ne: ticket._id } })
        .sort({ createdAt: -1 })
        .limit(10);
    const input = {
        disputeId: ticket.dispute.disputeId,
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
    const useLlm = env_1.env.AI_ENABLED === "true" && !!env_1.env.GROQ_API_KEY;
    let r;
    try {
        r = await (0, disputeAgentGraph_1.runDisputeAgent)(input, useLlm);
    }
    catch (err) {
        if (!useLlm || err instanceof AppError_1.AppError)
            throw err;
        logger_1.logger.error({ err }, "Dispute agent LLM failed, retrying with rules");
        r = await (0, disputeAgentGraph_1.runDisputeAgent)(input, false);
    }
    const proposal = {
        status: "PENDING",
        action: r.action,
        amount: r.amount,
        currency: r.facts.currency,
        winChance: r.winChance,
        reasoning: r.reasoning,
        policyNotes: r.policyNotes,
        responseNote: r.responseNote,
        evidenceText: r.evidenceText,
        facts: r.facts,
        steps: r.steps,
        source: r.source,
        createdBy: (actor?.userId ?? null),
        createdAt: new Date(),
        decidedBy: null,
        decidedAt: null,
        error: null,
    };
    // Automatic runs only fill an empty slot; manual runs never replace one mid-send.
    const prev = await Ticket_1.Ticket.findOneAndUpdate(actor ? { _id: ticketId, "disputeProposal.status": { $ne: "PROCESSING" } } : { _id: ticketId, disputeProposal: null }, { $set: { disputeProposal: proposal, dispute: toDisputeDoc(await paypal.getDisputeRaw(input.disputeId)) } }, { returnDocument: "before" });
    if (!prev) {
        if (actor)
            throw new AppError_1.AppError(409, "DISPUTE_BUSY", "A response for this dispute is being sent right now.");
        return;
    }
    await (0, auditLogService_1.logAction)({
        actor: actor?.userId ?? null,
        action: "DISPUTE_RESPONSE_PROPOSED",
        entity: "Ticket",
        entityId: ticketId,
        newValue: { action: r.action, amount: r.amount, winChance: r.winChance },
        metadata: { source: r.source, automatic: actor === null },
    });
    await broadcast(ticketId);
}
function runAgentInBackground(ticketId) {
    (0, background_1.runInBackground)(runAgent(ticketId, null), `Automatic dispute agent run for ${ticketId}`);
}
// Human approval: the only place we answer PayPal.
async function approve(ticketId, actor, overrides) {
    const { order } = await loadDisputeCase(ticketId);
    const ticket = await Ticket_1.Ticket.findOneAndUpdate({ _id: ticketId, "disputeProposal.status": "PENDING" }, { $set: { "disputeProposal.status": "PROCESSING" } }, { returnDocument: "after" });
    if (!ticket?.disputeProposal || !ticket.dispute)
        throw new AppError_1.AppError(409, "NO_PENDING_PROPOSAL", "No pending response to approve. Run the agent first.");
    const p = ticket.disputeProposal;
    const d = ticket.dispute;
    const note = overrides.responseNote?.trim() || p.responseNote;
    const amount = overrides.amount ?? p.amount;
    try {
        if (p.action === "ACCEPT_CLAIM") {
            await paypal.acceptDisputeClaim(d.disputeId, note, amount, p.currency);
            if (order) {
                order.refunds.push({ refundId: `DISPUTE-${d.disputeId}`, amount, status: "COMPLETED", reason: `Dispute ${d.disputeId} accepted`, ticket: ticket._id, approvedBy: actor.userId, createdAt: new Date() });
                order.refundedTotal = Math.round((order.refundedTotal + amount) * 100) / 100;
                order.status = order.refundedTotal >= order.total - 0.001 ? "REFUNDED" : "PARTIALLY_REFUNDED";
                await order.save();
            }
        }
        else if (p.action === "MAKE_OFFER") {
            await paypal.makeDisputeOffer(d.disputeId, note, amount, p.currency);
        }
        else if (p.action === "CONTEST") {
            await paypal.provideDisputeEvidence(d.disputeId, note, p.evidenceText);
        }
        else {
            throw new AppError_1.AppError(400, "NOTHING_TO_SEND", "The agent found nothing to send for this dispute.");
        }
    }
    catch (err) {
        p.status = "FAILED";
        p.error = err instanceof Error ? err.message : "Failed";
        p.decidedBy = actor.userId;
        p.decidedAt = new Date();
        ticket.markModified("disputeProposal");
        await ticket.save();
        await (0, auditLogService_1.logAction)({ actor: actor.userId, action: "DISPUTE_RESPONSE_FAILED", entity: "Ticket", entityId: ticketId, metadata: { error: p.error } });
        await broadcast(ticketId);
        throw err;
    }
    p.status = "EXECUTED";
    p.responseNote = note;
    p.amount = amount;
    p.decidedBy = actor.userId;
    p.decidedAt = new Date();
    ticket.markModified("disputeProposal");
    ticket.dispute = toDisputeDoc(await paypal.getDisputeRaw(d.disputeId));
    await ticket.save();
    await (0, auditLogService_1.logAction)({
        actor: actor.userId,
        action: "DISPUTE_RESPONSE_SENT",
        entity: "Ticket",
        entityId: ticketId,
        newValue: { action: p.action, amount, disputeStatus: ticket.dispute.status },
    });
    await (0, commentService_1.addComment)(ticketId, actor, `Sent to PayPal: ${human(p.action)}${amount > 0 ? ` (${amount} ${p.currency})` : ""}. Dispute is now ${human(ticket.dispute.status)}.\n\n${note}`, true);
    await broadcast(ticketId);
    return (0, ticketService_1.getTicketById)(ticketId, actor);
}
async function reject(ticketId, actor) {
    const ticket = await Ticket_1.Ticket.findOneAndUpdate({ _id: ticketId, "disputeProposal.status": "PENDING" }, { $set: { "disputeProposal.status": "REJECTED", "disputeProposal.decidedBy": actor.userId, "disputeProposal.decidedAt": new Date() } }, { returnDocument: "after" });
    if (!ticket)
        throw new AppError_1.AppError(409, "NO_PENDING_PROPOSAL", "No pending response to reject.");
    await (0, auditLogService_1.logAction)({ actor: actor.userId, action: "DISPUTE_RESPONSE_REJECTED", entity: "Ticket", entityId: ticketId });
    await broadcast(ticketId);
    return (0, ticketService_1.getTicketById)(ticketId, actor);
}
// Sandbox/simulator only: ask PayPal to decide a dispute that's under review.
async function adjudicate(ticketId, actor, outcome) {
    if (env_1.env.PAYPAL_API_BASE.includes("api-m.paypal.com"))
        throw new AppError_1.AppError(400, "NOT_SANDBOX", "Only available in sandbox.");
    const { ticket } = await loadDisputeCase(ticketId);
    await paypal.adjudicateDispute(ticket.dispute.disputeId, outcome);
    await syncDispute(ticket.dispute.disputeId, { autoRun: false });
    await (0, auditLogService_1.logAction)({ actor: actor.userId, action: "DISPUTE_ADJUDICATED_SANDBOX", entity: "Ticket", entityId: ticketId, newValue: { outcome } });
    return (0, ticketService_1.getTicketById)(ticketId, actor);
}
// ── Webhooks ────────────────────────────────────────────────────────────
async function handleWebhookEvent(event, source, verified) {
    const eventId = event?.id ?? `SIM-${(0, crypto_1.randomUUID)()}`;
    const type = event?.event_type ?? "UNKNOWN";
    const resourceId = event?.resource?.dispute_id ?? event?.resource?.id ?? null;
    try {
        await WebhookEvent_1.WebhookEvent.create({ eventId, eventType: type, resourceId, verified, source, result: "processing" });
    }
    catch (err) {
        if (err?.code === 11000)
            return { duplicate: true }; // PayPal retried: already handled
        throw err;
    }
    let result = "ignored";
    if (type.startsWith("CUSTOMER.DISPUTE.") && resourceId) {
        const r = await syncDispute(resourceId, { autoRun: type === "CUSTOMER.DISPUTE.CREATED" });
        result = r.created ? "case created, agent started" : "case updated";
    }
    else if (type.startsWith("PAYMENT.CAPTURE.")) {
        result = "recorded";
    }
    await WebhookEvent_1.WebhookEvent.updateOne({ eventId }, { $set: { result } });
    return { duplicate: false, result };
}
function listWebhookEvents() {
    return WebhookEvent_1.WebhookEvent.find().sort({ receivedAt: -1 }).limit(30);
}
// Simulated mode only: a buyer opens a dispute, and it reaches us through
// the same webhook path a real PayPal event would.
async function simulateBuyerDispute(customer, orderId, reason, message) {
    if (paypal.paypalMode() !== "simulated") {
        throw new AppError_1.AppError(400, "USE_PAYPAL", "With real sandbox keys, open the dispute as the buyer on sandbox.paypal.com.");
    }
    const order = await Order_1.Order.findById(orderId);
    if (!order || order.customer.toString() !== customer.userId)
        throw new AppError_1.AppError(404, "NOT_FOUND", "Order not found.");
    if (!order.captureId)
        throw new AppError_1.AppError(400, "NOT_PAID", "This order was never paid.");
    const user = await User_1.User.findById(customer.userId);
    const raw = paypal.createSimulatedDispute({
        captureId: order.captureId,
        amount: order.total - order.refundedTotal,
        currency: order.currency,
        reason,
        buyerName: user?.name ?? "Buyer",
        buyerMessage: message,
    });
    return handleWebhookEvent({ id: `WH-SIM-${(0, crypto_1.randomUUID)().slice(0, 8)}`, event_type: "CUSTOMER.DISPUTE.CREATED", resource: { dispute_id: raw.dispute_id } }, "simulated", false);
}
