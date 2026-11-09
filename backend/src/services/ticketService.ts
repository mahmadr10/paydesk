import { ITicket, TicketStatus, TicketPriority } from "../models/Ticket";
import { JwtPayload } from "../utils/jwt";
import { AppError } from "../utils/AppError";
import { CreateTicketInput, ListTicketsQuery } from "../validators/ticketValidators";
import { emitTicketUpdated, emitNewTicket } from "../sockets/io";
import * as ticketRepo from "../repositories/ticketRepository";
import * as userRepo from "../repositories/userRepository";
import { findCategoryByName } from "../repositories/categoryRepository";
import { getSlaMinutesForPriority, addMinutes, computeSlaStatus } from "./slaService";
import { logAction } from "./auditLogService";
import { withSpan } from "../observability/otel";
import { analyzeTicket as runAiAnalysis } from "./aiService";
import { listActiveCategories } from "../repositories/categoryRepository";
import { Order } from "../models/Order";

// ── The state machine ──────────────────────────────────────────────────
// Unlike the earlier linear version, this graph BRANCHES: an IN_PROGRESS
// ticket can go to either WAITING_FOR_CUSTOMER or straight to RESOLVED, and
// a CLOSED ticket can be reopened back to OPEN. One source of truth for
// "what's a legal move" — everything else defers to this.
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ["TRIAGED"],
  TRIAGED: ["ASSIGNED"],
  ASSIGNED: ["IN_PROGRESS"],
  IN_PROGRESS: ["WAITING_FOR_CUSTOMER", "RESOLVED"],
  WAITING_FOR_CUSTOMER: ["IN_PROGRESS"],
  RESOLVED: ["CLOSED"],
  CLOSED: ["OPEN"], // reopen
};

export function isLegalTransition(current: TicketStatus, next: TicketStatus): boolean {
  return TRANSITIONS[current]?.includes(next) ?? false;
}

// `ticket.customer` is sometimes a raw ObjectId (ticket loaded via
// findTicketDocById, e.g. for a status update) and sometimes a POPULATED
// User document (ticket loaded via findTicketById for a detail view, which
// runs .populate("customer", ...) to also return the customer's name).
// Calling .toString() on a populated document does NOT give back the id
// string — it was silently comparing "[object Object]" to a hex string and
// failing 100% of the time, which locked every customer out of their own
// ticket detail page. This normalizes both shapes to a plain id string.
function customerIdOf(customer: ITicket["customer"] | { _id: { toString(): string } }): string {
  if (typeof customer === "object" && customer !== null && "_id" in customer) {
    return (customer as { _id: { toString(): string } })._id.toString();
  }
  return (customer as { toString(): string }).toString();
}

// Role + ownership rules layered ON TOP of the pure graph above. The graph
// alone can't know "only the ticket's own customer may close it" — that
// needs the ticket and the acting user, not just two status strings.
function isTransitionAllowedForActor(ticket: ITicket, user: JwtPayload, next: TicketStatus): boolean {
  if (!isLegalTransition(ticket.status, next)) return false;

  const isOwner = customerIdOf(ticket.customer) === user.userId;
  const isStaff = user.role === "AGENT" || user.role === "ADMIN";

  // Two transitions are customer-initiated: closing a resolved ticket, and
  // reopening a closed one. Staff can also do both (e.g. auto-closing a
  // stale resolved ticket). Every other transition is staff-only — a
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
// re-implement these role rules — it just renders whatever buttons the
// server says are legal right now. The server still re-checks on the
// actual PATCH; this is a convenience, not the security boundary.
export function getAllowedNextStatuses(ticket: ITicket, user: JwtPayload): TicketStatus[] {
  return TRANSITIONS[ticket.status].filter((next) => isTransitionAllowedForActor(ticket, user, next));
}

async function findTicketDocOr404(ticketId: string) {
  const ticket = await ticketRepo.findTicketDocById(ticketId);
  if (!ticket) throw new AppError(404, "NOT_FOUND", "Ticket not found.");
  return ticket;
}

function assertCanView(ticket: { customer: ITicket["customer"] | { _id: { toString(): string } } }, user: JwtPayload) {
  if (user.role === "CUSTOMER" && customerIdOf(ticket.customer) !== user.userId) {
    throw new AppError(403, "FORBIDDEN", "You can only view your own tickets.");
  }
}

// Attaches the live-computed SLA numbers to a ticket before it goes out
// over the API. These are NEVER stored — "3 minutes remaining" is only
// true at the instant it's computed, so it's derived fresh on every read
// instead of risking a stale cached value.
function withSla(ticket: ITicket) {
  const sla = computeSlaStatus({
    responseDeadline: ticket.responseDeadline,
    resolutionDeadline: ticket.resolutionDeadline,
    firstResponseAt: ticket.firstResponseAt,
    resolvedAt: ticket.resolvedAt,
    now: new Date(),
  });
  return Object.assign(ticket.toJSON(), { sla });
}

export async function createTicket(customerId: string, input: CreateTicketInput) {
  return withSpan(
    "ticketService.createTicket",
    async () => {
      const category = await findCategoryByName(input.category);
      if (!category) {
        throw new AppError(400, "INVALID_CATEGORY", `Unknown or inactive category: ${input.category}`);
      }

      // A ticket can be about one of the customer's own paid orders.
      let orderId: string | null = null;
      if (input.orderId) {
        const order = await Order.findById(input.orderId);
        if (!order || order.customer.toString() !== customerId) {
          throw new AppError(400, "INVALID_ORDER", "That order doesn't exist or isn't yours.");
        }
        if (order.status === "CREATED") {
          throw new AppError(400, "INVALID_ORDER", "That order was never paid.");
        }
        orderId = order._id.toString();
      }

      const { responseMinutes, resolutionMinutes } = await getSlaMinutesForPriority(input.priority);
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
        customer: customerId as any,
        assignedAgent: null,
        responseDeadline: addMinutes(now, responseMinutes),
        resolutionDeadline: addMinutes(now, resolutionMinutes),
        firstResponseAt: null,
        resolvedAt: null,
        order: orderId as any,
      });

      await logAction({
        actor: customerId,
        action: "TICKET_CREATED",
        entity: "Ticket",
        entityId: ticket._id.toString(),
        newValue: { title: ticket.title, priority: ticket.priority, category: ticket.category },
      });

      emitNewTicket(ticket);
      return withSla(ticket);
    },
    { "ticket.priority": input.priority, "ticket.category": input.category }
  );
}

export async function listTickets(user: JwtPayload, query: ListTicketsQuery) {
  const filter: ticketRepo.TicketFilter = {
    status: query.status,
    priority: query.priority,
    category: query.category,
    assignedAgent: query.assignedAgent,
    tag: query.tag,
    search: query.search,
  };

  // Customers only ever see their own tickets — enforced in the query
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

export async function getTicketById(ticketId: string, user: JwtPayload) {
  const ticket = await ticketRepo.findTicketById(ticketId);
  if (!ticket) throw new AppError(404, "NOT_FOUND", "Ticket not found.");
  assertCanView(ticket, user);
  const result = Object.assign(withSla(ticket), { allowedNextStatuses: getAllowedNextStatuses(ticket, user) });
  // The refund agent's reasoning is internal staff tooling. Customers only
  // ever see the reply that staff actually sends them.
  if (user.role === "CUSTOMER") (result as any).refundProposal = null;
  return result;
}

export async function updateTicketStatus(ticketId: string, requestedStatus: TicketStatus, user: JwtPayload) {
  return withSpan(
    "ticketService.updateTicketStatus",
    async () => {
      const ticket = await findTicketDocOr404(ticketId);

      if (!isTransitionAllowedForActor(ticket, user, requestedStatus)) {
        if (!isLegalTransition(ticket.status, requestedStatus)) {
          throw new AppError(
            400,
            "INVALID_STATUS_TRANSITION",
            `A ticket cannot move from ${ticket.status} directly to ${requestedStatus}.`
          );
        }
        throw new AppError(403, "FORBIDDEN", `You are not allowed to move this ticket to ${requestedStatus}.`);
      }

      const oldStatus = ticket.status;
      ticket.status = requestedStatus;

      if (requestedStatus === "RESOLVED") ticket.resolvedAt = new Date();
      // Reopening clears the old resolution timestamp — it's unresolved again,
      // so the resolution SLA clock (relative to createdAt) resumes ticking.
      if (requestedStatus === "OPEN") ticket.resolvedAt = null;

      await ticket.save();

      await logAction({
        actor: user.userId,
        action: "STATUS_CHANGED",
        entity: "Ticket",
        entityId: ticket._id.toString(),
        oldValue: oldStatus,
        newValue: requestedStatus,
      });

      const populated = await ticketRepo.findTicketById(ticketId);
      emitTicketUpdated(populated!);
      return withSla(populated!);
    },
    { "ticket.id": ticketId, "ticket.requestedStatus": requestedStatus }
  );
}

export async function assignTicketToSelf(ticketId: string, agent: JwtPayload) {
  const ticket = await findTicketDocOr404(ticketId);

  if (!isLegalTransition(ticket.status, "ASSIGNED")) {
    throw new AppError(
      400,
      "INVALID_STATUS_TRANSITION",
      `A ticket cannot move from ${ticket.status} directly to ASSIGNED. It must be TRIAGED first.`
    );
  }

  ticket.assignedAgent = agent.userId as any;
  ticket.status = "ASSIGNED";
  await ticket.save();

  await logAction({
    actor: agent.userId,
    action: "ASSIGNED",
    entity: "Ticket",
    entityId: ticket._id.toString(),
    oldValue: null,
    newValue: agent.userId,
  });

  const populated = await ticketRepo.findTicketById(ticketId);
  emitTicketUpdated(populated!);
  return withSla(populated!);
}

// Admin/agent reassignment to a SPECIFIC agent (e.g. an admin redistributing
// workload, or Agent A handing off to Agent B) — distinct from "assign to
// self", and requires the ticket already have an agent (i.e. be past TRIAGED).
export async function reassignTicket(ticketId: string, newAgentId: string, actor: JwtPayload) {
  const ticket = await findTicketDocOr404(ticketId);
  const newAgent = await userRepo.findUserById(newAgentId);
  if (!newAgent || newAgent.role !== "AGENT" || !newAgent.isActive) {
    throw new AppError(400, "INVALID_AGENT", "Target user is not an active agent.");
  }
  if (ticket.status === "OPEN" || ticket.status === "TRIAGED") {
    throw new AppError(400, "INVALID_STATUS_TRANSITION", "Ticket must be assigned before it can be reassigned.");
  }

  const oldAgent = ticket.assignedAgent;
  ticket.assignedAgent = newAgent._id;
  await ticket.save();

  await logAction({
    actor: actor.userId,
    action: "REASSIGNED",
    entity: "Ticket",
    entityId: ticket._id.toString(),
    oldValue: oldAgent,
    newValue: newAgent._id,
  });

  const populated = await ticketRepo.findTicketById(ticketId);
  emitTicketUpdated(populated!);
  return withSla(populated!);
}

export async function updatePriority(ticketId: string, newPriority: TicketPriority, actor: JwtPayload) {
  const ticket = await findTicketDocOr404(ticketId);
  const oldPriority = ticket.priority;
  if (oldPriority === newPriority) return withSla(ticket);

  const { responseMinutes, resolutionMinutes } = await getSlaMinutesForPriority(newPriority);
  ticket.priority = newPriority;
  // Recompute deadlines from the ORIGINAL creation time — escalating a
  // ticket to CRITICAL tightens its deadline immediately, rather than
  // giving it a fresh full SLA window starting now.
  if (!ticket.firstResponseAt) ticket.responseDeadline = addMinutes(ticket.createdAt, responseMinutes);
  if (!ticket.resolvedAt) ticket.resolutionDeadline = addMinutes(ticket.createdAt, resolutionMinutes);
  await ticket.save();

  await logAction({
    actor: actor.userId,
    action: "PRIORITY_CHANGED",
    entity: "Ticket",
    entityId: ticket._id.toString(),
    oldValue: oldPriority,
    newValue: newPriority,
  });

  const populated = await ticketRepo.findTicketById(ticketId);
  emitTicketUpdated(populated!);
  return withSla(populated!);
}

export async function updateTags(ticketId: string, tags: string[], actor: JwtPayload) {
  const ticket = await findTicketDocOr404(ticketId);
  const oldTags = ticket.tags;
  ticket.tags = tags;
  await ticket.save();

  await logAction({
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
// ticket — this is what "first response" means for the SLA's purposes.
export async function markFirstResponseIfNeeded(ticketId: string) {
  const ticket = await findTicketDocOr404(ticketId);
  if (!ticket.firstResponseAt) {
    ticket.firstResponseAt = new Date();
    await ticket.save();
  }
}

export async function addAttachment(
  ticketId: string,
  user: JwtPayload,
  file: { filename: string; originalName: string; mimeType: string; size: number }
) {
  const ticket = await findTicketDocOr404(ticketId);
  assertCanView(ticket, user);

  ticket.attachments.push({
    filename: file.filename,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    uploadedBy: user.userId as any,
    uploadedAt: new Date(),
  });
  await ticket.save();

  await logAction({
    actor: user.userId,
    action: "ATTACHMENT_ADDED",
    entity: "Ticket",
    entityId: ticket._id.toString(),
    newValue: { originalName: file.originalName, size: file.size },
  });

  const populated = await ticketRepo.findTicketById(ticketId);
  return withSla(populated!);
}

export async function getTicketDocForDownload(ticketId: string, user: JwtPayload) {
  const ticket = await ticketRepo.findTicketDocById(ticketId);
  if (!ticket) throw new AppError(404, "NOT_FOUND", "Ticket not found.");
  assertCanView(ticket, user);
  return ticket;
}

// Staff-only (route enforces AGENT/ADMIN) — a customer isn't shown internal
// triage tooling like a priority suggestion or a draft agent reply. Recomputed
// on demand rather than cached on the ticket: it's an assistive suggestion for
// whoever's looking at the ticket right now, not part of the ticket's
// authoritative state (compare with `withSla()`, which is similarly
// recomputed-not-stored for the same "only true at read time" reason).
export async function getAiAnalysis(ticketId: string, actor: JwtPayload) {
  const ticket = await findTicketDocOr404(ticketId);
  const activeCategories = await listActiveCategories();

  const analysis = await runAiAnalysis({
    title: ticket.title,
    description: ticket.description,
    validCategories: activeCategories.map((c) => c.name),
  });

  await logAction({
    actor: actor.userId,
    action: "AI_ANALYSIS_REQUESTED",
    entity: "Ticket",
    entityId: ticket._id.toString(),
    newValue: { suggestedCategory: analysis.suggestedCategory, suggestedPriority: analysis.suggestedPriority },
    metadata: { source: analysis.source },
  });

  return analysis;
}
