import { Ticket, ITicket, TicketPriority, TicketStatus } from "../models/Ticket";
import { nextSequence } from "../models/Counter";

export interface TicketFilter {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: string;
  assignedAgent?: string;
  customer?: string;
  search?: string; // matches title/description
  tag?: string;
  createdAfter?: Date;
}

// Turns our typed filter object into a MongoDB query. Kept in ONE place so
// every caller (ticket list, dashboard counts, SLA breach sweep) builds
// filters the exact same way.
export function buildTicketQuery(filter: TicketFilter): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  if (filter.status) query.status = filter.status;
  if (filter.priority) query.priority = filter.priority;
  if (filter.category) query.category = filter.category;
  if (filter.assignedAgent) query.assignedAgent = filter.assignedAgent;
  if (filter.customer) query.customer = filter.customer;
  if (filter.tag) query.tags = filter.tag;
  if (filter.createdAfter) query.createdAt = { $gte: filter.createdAfter };
  if (filter.search) {
    // $text would need a text index; for a demo-scale dataset a case
    // insensitive regex on title is simple and index-assisted enough. A
    // dedicated search engine (Atlas Search/Elasticsearch) would replace
    // this at real scale — noted in ARCHITECTURE.md as a scaling concern.
    query.title = { $regex: filter.search, $options: "i" };
  }
  return query;
}

export async function nextTicketNumber() {
  const seq = await nextSequence("ticket");
  return `TCK-${String(seq).padStart(6, "0")}`;
}

// Atomically flips a PENDING refund proposal to PROCESSING. Returns null if
// another request got there first, which is what blocks double refunds.
export function claimPendingProposal(ticketId: string) {
  return Ticket.findOneAndUpdate(
    { _id: ticketId, "refundProposal.status": "PENDING" },
    { $set: { "refundProposal.status": "PROCESSING" } },
    { returnDocument: "after" }
  );
}

export function createTicket(data: Partial<ITicket>) {
  return Ticket.create(data);
}

export function findTicketById(id: string) {
  return Ticket.findById(id)
    .populate("customer", "name email")
    .populate("assignedAgent", "name email")
    .populate("order")
    .populate("refundProposal.createdBy", "name")
    .populate("refundProposal.decidedBy", "name");
}

// Internal variant that skips populate — used when a service needs to
// mutate and re-save the document (populated subdocuments can't be saved).
export function findTicketDocById(id: string) {
  return Ticket.findById(id);
}

export async function findTickets(
  filter: TicketFilter,
  options: { skip: number; limit: number; sortField: string; sortDir: 1 | -1 }
) {
  const query = buildTicketQuery(filter);
  const [tickets, total] = await Promise.all([
    Ticket.find(query)
      .sort({ [options.sortField]: options.sortDir })
      .skip(options.skip)
      .limit(options.limit)
      .populate("customer", "name email")
      .populate("assignedAgent", "name email"),
    Ticket.countDocuments(query),
  ]);
  return { tickets, total };
}
