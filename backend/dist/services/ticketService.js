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
exports.isLegalTransition = isLegalTransition;
exports.getAllowedNextStatuses = getAllowedNextStatuses;
exports.createTicket = createTicket;
exports.listTickets = listTickets;
exports.getTicketById = getTicketById;
exports.updateTicketStatus = updateTicketStatus;
exports.assignTicketToSelf = assignTicketToSelf;
exports.reassignTicket = reassignTicket;
exports.updatePriority = updatePriority;
exports.updateTags = updateTags;
exports.markFirstResponseIfNeeded = markFirstResponseIfNeeded;
exports.addAttachment = addAttachment;
exports.getTicketDocForDownload = getTicketDocForDownload;
exports.getAiAnalysis = getAiAnalysis;
const AppError_1 = require("../utils/AppError");
const io_1 = require("../sockets/io");
const ticketRepo = __importStar(require("../repositories/ticketRepository"));
const userRepo = __importStar(require("../repositories/userRepository"));
const categoryRepository_1 = require("../repositories/categoryRepository");
const slaService_1 = require("./slaService");
const auditLogService_1 = require("./auditLogService");
const otel_1 = require("../observability/otel");
const aiService_1 = require("./aiService");
const categoryRepository_2 = require("../repositories/categoryRepository");
const Order_1 = require("../models/Order");
// ── The state machine ──────────────────────────────────────────────────
// Unlike the earlier linear version, this graph BRANCHES: an IN_PROGRESS
// ticket can go to either WAITING_FOR_CUSTOMER or straight to RESOLVED, and
// a CLOSED ticket can be reopened back to OPEN. One source of truth for
// "what's a legal move" - everything else defers to this.
const TRANSITIONS = {
    OPEN: ["TRIAGED"],
    TRIAGED: ["ASSIGNED"],
    ASSIGNED: ["IN_PROGRESS"],
    IN_PROGRESS: ["WAITING_FOR_CUSTOMER", "RESOLVED"],
    WAITING_FOR_CUSTOMER: ["IN_PROGRESS"],
    RESOLVED: ["CLOSED"],
    CLOSED: ["OPEN"], // reopen
};
function isLegalTransition(current, next) {
    return TRANSITIONS[current]?.includes(next) ?? false;
}
// `ticket.customer` is sometimes a raw ObjectId (ticket loaded via
// findTicketDocById, e.g. for a status update) and sometimes a POPULATED
// User document (ticket loaded via findTicketById for a detail view, which
// runs .populate("customer", ...) to also return the customer's name).
// Calling .toString() on a populated document does NOT give back the id
// string - it was silently comparing "[object Object]" to a hex string and
// failing 100% of the time, which locked every customer out of their own
// ticket detail page. This normalizes both shapes to a plain id string.
function customerIdOf(customer) {
    if (typeof customer === "object" && customer !== null && "_id" in customer) {
        return customer._id.toString();
    }
    return customer.toString();
}
// Role + ownership rules layered ON TOP of the pure graph above. The graph
// alone can't know "only the ticket's own customer may close it" - that
// needs the ticket and the acting user, not just two status strings.
function isTransitionAllowedForActor(ticket, user, next) {
    if (!isLegalTransition(ticket.status, next))
        return false;
    const isOwner = customerIdOf(ticket.customer) === user.userId;
    const isStaff = user.role === "AGENT" || user.role === "ADMIN";
    // Two transitions are customer-initiated: closing a resolved ticket, and
    // reopening a closed one. Staff can also do both (e.g. auto-closing a
    // stale resolved ticket). Every other transition is staff-only - a
    // customer can't triage, assign, or move their own ticket to IN_PROGRESS.
    if (ticket.status === "RESOLVED" && next === "CLOSED") {
        return (user.role === "CUSTOMER" && isOwner) || isStaff;
    }
    if (ticket.status === "CLOSED" && next === "OPEN") {
        return (user.role === "CUSTOMER" && isOwner) || isStaff;
    }
    return isStaff;
}
// Used by the ticket detail response so the FRONTEND doesn't have to
// re-implement these role rules - it just renders whatever buttons the
// server says are legal right now. The server still re-checks on the
// actual PATCH; this is a convenience, not the security boundary.
function getAllowedNextStatuses(ticket, user) {
    return TRANSITIONS[ticket.status].filter((next) => isTransitionAllowedForActor(ticket, user, next));
}
async function findTicketDocOr404(ticketId) {
    const ticket = await ticketRepo.findTicketDocById(ticketId);
    if (!ticket)
        throw new AppError_1.AppError(404, "NOT_FOUND", "Ticket not found.");
    return ticket;
}
function assertCanView(ticket, user) {
    if (user.role === "CUSTOMER" && customerIdOf(ticket.customer) !== user.userId) {
        throw new AppError_1.AppError(403, "FORBIDDEN", "You can only view your own tickets.");
    }
}
// Attaches the live-computed SLA numbers to a ticket before it goes out
// over the API. These are NEVER stored - "3 minutes remaining" is only
// true at the instant it's computed, so it's derived fresh on every read
// instead of risking a stale cached value.
function withSla(ticket) {
    const sla = (0, slaService_1.computeSlaStatus)({
        responseDeadline: ticket.responseDeadline,
        resolutionDeadline: ticket.resolutionDeadline,
        firstResponseAt: ticket.firstResponseAt,
        resolvedAt: ticket.resolvedAt,
        now: new Date(),
    });
    return Object.assign(ticket.toJSON(), { sla });
}
async function createTicket(customerId, input) {
    return (0, otel_1.withSpan)("ticketService.createTicket", async () => {
        const category = await (0, categoryRepository_1.findCategoryByName)(input.category);
        if (!category) {
            throw new AppError_1.AppError(400, "INVALID_CATEGORY", `Unknown or inactive category: ${input.category}`);
        }
        // A ticket can be about one of the customer's own paid orders.
        let orderId = null;
        if (input.orderId) {
            const order = await Order_1.Order.findById(input.orderId);
            if (!order || order.customer.toString() !== customerId) {
                throw new AppError_1.AppError(400, "INVALID_ORDER", "That order doesn't exist or isn't yours.");
            }
            if (order.status === "CREATED") {
                throw new AppError_1.AppError(400, "INVALID_ORDER", "That order was never paid.");
            }
            orderId = order._id.toString();
        }
        const { responseMinutes, resolutionMinutes } = await (0, slaService_1.getSlaMinutesForPriority)(input.priority);
        const now = new Date();
        const ticketNumber = await ticketRepo.nextTicketNumber();
        const ticket = await ticketRepo.createTicket({
            ticketNumber,
            title: input.title,
            description: input.description,
            category: category.name,
            priority: input.priority,
            tags: input.tags,
            status: "OPEN",
            customer: customerId,
            assignedAgent: null,
            responseDeadline: (0, slaService_1.addMinutes)(now, responseMinutes),
            resolutionDeadline: (0, slaService_1.addMinutes)(now, resolutionMinutes),
            firstResponseAt: null,
            resolvedAt: null,
            order: orderId,
        });
        await (0, auditLogService_1.logAction)({
            actor: customerId,
            action: "TICKET_CREATED",
            entity: "Ticket",
            entityId: ticket._id.toString(),
            newValue: { title: ticket.title, priority: ticket.priority, category: ticket.category },
        });
        (0, io_1.emitNewTicket)(ticket);
        return withSla(ticket);
    }, { "ticket.priority": input.priority, "ticket.category": input.category });
}
async function listTickets(user, query) {
    const filter = {
        status: query.status,
        priority: query.priority,
        category: query.category,
        assignedAgent: query.assignedAgent,
        tag: query.tag,
        search: query.search,
    };
    // Customers only ever see their own tickets - enforced in the query
    // itself, not just hidden in the UI.
    if (user.role === "CUSTOMER") {
        filter.customer = user.userId;
    }
    if (query.createdAfterDays) {
        filter.createdAfter = new Date(Date.now() - query.createdAfterDays * 24 * 60 * 60 * 1000);
    }
    const skip = (query.page - 1) * query.limit;
    const sortDir = query.sortDir === "asc" ? 1 : -1;
    const { tickets, total } = await ticketRepo.findTickets(filter, {
        skip,
        limit: query.limit,
        sortField: query.sortBy,
        sortDir,
    });
    return {
        tickets: tickets.map(withSla),
        pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit) || 1,
        },
    };
}
async function getTicketById(ticketId, user) {
    const ticket = await ticketRepo.findTicketById(ticketId);
    if (!ticket)
        throw new AppError_1.AppError(404, "NOT_FOUND", "Ticket not found.");
    assertCanView(ticket, user);
    const result = Object.assign(withSla(ticket), { allowedNextStatuses: getAllowedNextStatuses(ticket, user) });
    // The refund agent's reasoning is internal staff tooling. Customers only
    // ever see the reply that staff actually sends them.
    if (user.role === "CUSTOMER")
        result.refundProposal = null;
    return result;
}
async function updateTicketStatus(ticketId, requestedStatus, user) {
    return (0, otel_1.withSpan)("ticketService.updateTicketStatus", async () => {
        const ticket = await findTicketDocOr404(ticketId);
        if (!isTransitionAllowedForActor(ticket, user, requestedStatus)) {
            if (!isLegalTransition(ticket.status, requestedStatus)) {
                throw new AppError_1.AppError(400, "INVALID_STATUS_TRANSITION", `A ticket cannot move from ${ticket.status} directly to ${requestedStatus}.`);
            }
            throw new AppError_1.AppError(403, "FORBIDDEN", `You are not allowed to move this ticket to ${requestedStatus}.`);
        }
        const oldStatus = ticket.status;
        ticket.status = requestedStatus;
        if (requestedStatus === "RESOLVED")
            ticket.resolvedAt = new Date();
        // Reopening clears the old resolution timestamp - it's unresolved again,
        // so the resolution SLA clock (relative to createdAt) resumes ticking.
        if (requestedStatus === "OPEN")
            ticket.resolvedAt = null;
        await ticket.save();
        await (0, auditLogService_1.logAction)({
            actor: user.userId,
            action: "STATUS_CHANGED",
            entity: "Ticket",
            entityId: ticket._id.toString(),
            oldValue: oldStatus,
            newValue: requestedStatus,
        });
        const populated = await ticketRepo.findTicketById(ticketId);
        (0, io_1.emitTicketUpdated)(populated);
        return withSla(populated);
    }, { "ticket.id": ticketId, "ticket.requestedStatus": requestedStatus });
}
async function assignTicketToSelf(ticketId, agent) {
    const ticket = await findTicketDocOr404(ticketId);
    if (!isLegalTransition(ticket.status, "ASSIGNED")) {
        throw new AppError_1.AppError(400, "INVALID_STATUS_TRANSITION", `A ticket cannot move from ${ticket.status} directly to ASSIGNED. It must be TRIAGED first.`);
    }
    ticket.assignedAgent = agent.userId;
    ticket.status = "ASSIGNED";
    await ticket.save();
    await (0, auditLogService_1.logAction)({
        actor: agent.userId,
        action: "ASSIGNED",
        entity: "Ticket",
        entityId: ticket._id.toString(),
        oldValue: null,
        newValue: agent.userId,
    });
    const populated = await ticketRepo.findTicketById(ticketId);
    (0, io_1.emitTicketUpdated)(populated);
    return withSla(populated);
}
// Admin/agent reassignment to a SPECIFIC agent (e.g. an admin redistributing
// workload, or Agent A handing off to Agent B) - distinct from "assign to
// self", and requires the ticket already have an agent (i.e. be past TRIAGED).
async function reassignTicket(ticketId, newAgentId, actor) {
    const ticket = await findTicketDocOr404(ticketId);
    const newAgent = await userRepo.findUserById(newAgentId);
    if (!newAgent || newAgent.role !== "AGENT" || !newAgent.isActive) {
        throw new AppError_1.AppError(400, "INVALID_AGENT", "Target user is not an active agent.");
    }
    if (ticket.status === "OPEN" || ticket.status === "TRIAGED") {
        throw new AppError_1.AppError(400, "INVALID_STATUS_TRANSITION", "Ticket must be assigned before it can be reassigned.");
    }
    const oldAgent = ticket.assignedAgent;
    ticket.assignedAgent = newAgent._id;
    await ticket.save();
    await (0, auditLogService_1.logAction)({
        actor: actor.userId,
        action: "REASSIGNED",
        entity: "Ticket",
        entityId: ticket._id.toString(),
        oldValue: oldAgent,
        newValue: newAgent._id,
    });
    const populated = await ticketRepo.findTicketById(ticketId);
    (0, io_1.emitTicketUpdated)(populated);
    return withSla(populated);
}
async function updatePriority(ticketId, newPriority, actor) {
    const ticket = await findTicketDocOr404(ticketId);
    const oldPriority = ticket.priority;
    if (oldPriority === newPriority)
        return withSla(ticket);
    const { responseMinutes, resolutionMinutes } = await (0, slaService_1.getSlaMinutesForPriority)(newPriority);
    ticket.priority = newPriority;
    // Recompute deadlines from the ORIGINAL creation time - escalating a
    // ticket to CRITICAL tightens its deadline immediately, rather than
    // giving it a fresh full SLA window starting now.
    if (!ticket.firstResponseAt)
        ticket.responseDeadline = (0, slaService_1.addMinutes)(ticket.createdAt, responseMinutes);
    if (!ticket.resolvedAt)
        ticket.resolutionDeadline = (0, slaService_1.addMinutes)(ticket.createdAt, resolutionMinutes);
    await ticket.save();
    await (0, auditLogService_1.logAction)({
        actor: actor.userId,
        action: "PRIORITY_CHANGED",
        entity: "Ticket",
        entityId: ticket._id.toString(),
        oldValue: oldPriority,
        newValue: newPriority,
    });
    const populated = await ticketRepo.findTicketById(ticketId);
    (0, io_1.emitTicketUpdated)(populated);
    return withSla(populated);
}
async function updateTags(ticketId, tags, actor) {
    const ticket = await findTicketDocOr404(ticketId);
    const oldTags = ticket.tags;
    ticket.tags = tags;
    await ticket.save();
    await (0, auditLogService_1.logAction)({
        actor: actor.userId,
        action: "TAGS_UPDATED",
        entity: "Ticket",
        entityId: ticket._id.toString(),
        oldValue: oldTags,
        newValue: tags,
    });
    return withSla(ticket);
}
// Called by commentService when an agent/admin's first comment lands on a
// ticket - this is what "first response" means for the SLA's purposes.
async function markFirstResponseIfNeeded(ticketId) {
    const ticket = await findTicketDocOr404(ticketId);
    if (!ticket.firstResponseAt) {
        ticket.firstResponseAt = new Date();
        await ticket.save();
    }
}
async function addAttachment(ticketId, user, file) {
    const ticket = await findTicketDocOr404(ticketId);
    assertCanView(ticket, user);
    ticket.attachments.push({
        filename: file.filename,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        uploadedBy: user.userId,
        uploadedAt: new Date(),
    });
    await ticket.save();
    await (0, auditLogService_1.logAction)({
        actor: user.userId,
        action: "ATTACHMENT_ADDED",
        entity: "Ticket",
        entityId: ticket._id.toString(),
        newValue: { originalName: file.originalName, size: file.size },
    });
    const populated = await ticketRepo.findTicketById(ticketId);
    return withSla(populated);
}
async function getTicketDocForDownload(ticketId, user) {
    const ticket = await ticketRepo.findTicketDocById(ticketId);
    if (!ticket)
        throw new AppError_1.AppError(404, "NOT_FOUND", "Ticket not found.");
    assertCanView(ticket, user);
    return ticket;
}
// Staff-only (route enforces AGENT/ADMIN) - a customer isn't shown internal
// triage tooling like a priority suggestion or a draft agent reply. Recomputed
// on demand rather than cached on the ticket: it's an assistive suggestion for
// whoever's looking at the ticket right now, not part of the ticket's
// authoritative state (compare with `withSla()`, which is similarly
// recomputed-not-stored for the same "only true at read time" reason).
async function getAiAnalysis(ticketId, actor) {
    const ticket = await findTicketDocOr404(ticketId);
    const activeCategories = await (0, categoryRepository_2.listActiveCategories)();
    const analysis = await (0, aiService_1.analyzeTicket)({
        title: ticket.title,
        description: ticket.description,
        validCategories: activeCategories.map((c) => c.name),
    });
    await (0, auditLogService_1.logAction)({
        actor: actor.userId,
        action: "AI_ANALYSIS_REQUESTED",
        entity: "Ticket",
        entityId: ticket._id.toString(),
        newValue: { suggestedCategory: analysis.suggestedCategory, suggestedPriority: analysis.suggestedPriority },
        metadata: { source: analysis.source },
    });
    return analysis;
}
