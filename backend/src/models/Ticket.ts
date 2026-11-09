import { Schema, model, Document, Types } from "mongoose";

// The full status graph now BRANCHES (IN_PROGRESS can go two different
// places), so it's no longer "one next status" — see
// services/ticketService.ts TRANSITIONS map for the actual rules. This list
// is just every status that exists.
export const TICKET_STATUSES = [
  "OPEN",
  "TRIAGED",
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_FOR_CUSTOMER",
  "RESOLVED",
  "CLOSED",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export interface ITicketAttachment {
  _id?: Types.ObjectId;
  filename: string; // name on disk (random, avoids collisions/path traversal)
  originalName: string; // name to show the user
  mimeType: string;
  size: number;
  uploadedBy: Types.ObjectId;
  uploadedAt: Date;
}

const attachmentSchema = new Schema<ITicketAttachment>(
  {
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

export interface ITicket extends Document {
  _id: Types.ObjectId;
  ticketNumber: string; // human-friendly id, e.g. "TCK-000042"
  title: string;
  description: string;
  category: string; // validated against the Category collection at write time
  priority: TicketPriority;
  status: TicketStatus;
  tags: string[];
  customer: Types.ObjectId;
  assignedAgent: Types.ObjectId | null;
  attachments: ITicketAttachment[];

  // SLA fields — set once, from the SLA policy in effect at creation time
  // (see slaService.ts). Storing the actual deadline (not just "15 minutes")
  // means we can index and query "which tickets are overdue RIGHT NOW"
  // efficiently, and it's immune to a later policy change silently
  // reshaping an already-running ticket's deadline.
  responseDeadline: Date;
  resolutionDeadline: Date;
  firstResponseAt: Date | null; // set when an agent's first comment/action lands
  resolvedAt: Date | null;

  // Set by jobs/slaBreachJob.ts the first (and only) time each deadline is
  // found breached — without these, a job re-scanning every minute would
  // re-notify the same still-overdue ticket every single run forever.
  responseBreachNotified: boolean;
  resolutionBreachNotified: boolean;

  // The PayPal order this ticket is about (optional).
  order: Types.ObjectId | null;
  // Latest proposal from the AI refund agent. Stored (not recomputed) so
  // that "Approve" executes exactly what the agent saw and proposed.
  refundProposal: IRefundProposal | null;

  // Set when this case was opened by a PayPal dispute (webhook or sync).
  dispute: ITicketDispute | null;
  disputeProposal: IDisputeProposal | null;

  createdAt: Date;
  updatedAt: Date;
}

// Our copy of a PayPal dispute, refreshed from PayPal on every webhook/sync.
export interface ITicketDispute {
  disputeId: string;
  reason: string;
  status: string;
  stage: string;
  amount: number;
  currency: string;
  sellerResponseDue: Date | null;
  transactionId: string | null;
  buyerName: string | null;
  messages: { postedBy: string; time: string; content: string }[];
  outcome: { code: string; amountRefunded: number | null } | null;
  actions: string[];
  raw: Record<string, unknown>; // full PayPal JSON (also used to restore the simulator)
  lastSyncedAt: Date;
}

export const DISPUTE_ACTIONS = ["ACCEPT_CLAIM", "MAKE_OFFER", "CONTEST", "NONE"] as const;

export interface IDisputeProposal {
  status: "PENDING" | "PROCESSING" | "EXECUTED" | "REJECTED" | "FAILED";
  action: (typeof DISPUTE_ACTIONS)[number];
  amount: number; // refund/offer amount (0 for CONTEST/NONE)
  currency: string;
  winChance: number; // agent's estimate that contesting would win, 0..1
  reasoning: string;
  policyNotes: string[];
  responseNote: string; // what we send to PayPal / the buyer
  evidenceText: string; // evidence file contents (CONTEST only), built from real records
  facts: Record<string, unknown>;
  steps: { name: string; detail: string }[];
  source: "groq" | "rules";
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  error: string | null;
}

const disputeSchema = new Schema<ITicketDispute>(
  {
    disputeId: { type: String, required: true },
    reason: String,
    status: String,
    stage: String,
    amount: Number,
    currency: String,
    sellerResponseDue: { type: Date, default: null },
    transactionId: { type: String, default: null },
    buyerName: { type: String, default: null },
    messages: { type: [{ postedBy: String, time: String, content: String, _id: false }], default: [] },
    outcome: { type: Schema.Types.Mixed, default: null },
    actions: { type: [String], default: [] },
    raw: { type: Schema.Types.Mixed, default: {} },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const disputeProposalSchema = new Schema<IDisputeProposal>(
  {
    status: { type: String, enum: ["PENDING", "PROCESSING", "EXECUTED", "REJECTED", "FAILED"], required: true },
    action: { type: String, enum: DISPUTE_ACTIONS, required: true },
    amount: { type: Number, default: 0 },
    currency: { type: String, required: true },
    winChance: { type: Number, default: 0 },
    reasoning: { type: String, default: "" },
    policyNotes: { type: [String], default: [] },
    responseNote: { type: String, default: "" },
    evidenceText: { type: String, default: "" },
    facts: { type: Schema.Types.Mixed, default: {} },
    steps: { type: [{ name: String, detail: String, _id: false }], default: [] },
    source: { type: String, enum: ["groq", "rules"], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdAt: { type: Date, default: Date.now },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { _id: false }
);

export const REFUND_PROPOSAL_STATUSES = ["PENDING", "PROCESSING", "EXECUTED", "SENT", "REJECTED", "FAILED"] as const;

export interface IRefundProposal {
  status: (typeof REFUND_PROPOSAL_STATUSES)[number];
  issueType: string;
  action: string;
  amount: number;
  currency: string;
  reasoning: string;
  confidence: number;
  policyNotes: string[];
  customerReply: string;
  facts: Record<string, unknown>;
  steps: { name: string; detail: string }[];
  source: "groq" | "rules";
  paypalMode: "sandbox" | "simulated";
  createdBy: Types.ObjectId | null; // null = run automatically by the system
  createdAt: Date;
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  executedAmount: number | null;
  paypalRefundId: string | null;
  error: string | null;
}

const refundProposalSchema = new Schema<IRefundProposal>(
  {
    status: { type: String, enum: REFUND_PROPOSAL_STATUSES, required: true },
    issueType: { type: String, required: true },
    action: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    reasoning: { type: String, default: "" },
    confidence: { type: Number, default: 0 },
    policyNotes: { type: [String], default: [] },
    customerReply: { type: String, default: "" },
    facts: { type: Schema.Types.Mixed, default: {} },
    steps: { type: [{ name: String, detail: String, _id: false }], default: [] },
    source: { type: String, enum: ["groq", "rules"], required: true },
    paypalMode: { type: String, enum: ["sandbox", "simulated"], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdAt: { type: Date, default: Date.now },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    executedAmount: { type: Number, default: null },
    paypalRefundId: { type: String, default: null },
    error: { type: String, default: null },
  },
  { _id: false }
);

const ticketSchema = new Schema<ITicket>(
  {
    ticketNumber: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    category: { type: String, required: true },
    priority: { type: String, enum: TICKET_PRIORITIES, required: true },
    status: { type: String, enum: TICKET_STATUSES, default: "OPEN", index: true },
    tags: { type: [String], default: [] },
    customer: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    assignedAgent: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    attachments: { type: [attachmentSchema], default: [] },
    responseDeadline: { type: Date, required: true },
    resolutionDeadline: { type: Date, required: true },
    firstResponseAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    responseBreachNotified: { type: Boolean, default: false },
    resolutionBreachNotified: { type: Boolean, default: false },
    order: { type: Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    refundProposal: { type: refundProposalSchema, default: null },
    dispute: { type: disputeSchema, default: null },
    disputeProposal: { type: disputeProposalSchema, default: null },
  },
  { timestamps: true }
);

// One case per PayPal dispute (webhooks can arrive more than once).
ticketSchema.index({ "dispute.disputeId": 1 }, { unique: true, partialFilterExpression: { "dispute.disputeId": { $type: "string" } } });

// Compound indexes for the query patterns the ticket queue/dashboard
// actually run: "an agent's queue filtered by status, newest first" and
// "a customer's tickets filtered by status, newest first" are both covered
// by a (field, status, createdAt) index — MongoDB can satisfy the filter AND
// the sort from the index alone, without a separate in-memory sort step.
ticketSchema.index({ assignedAgent: 1, status: 1, createdAt: -1 });
ticketSchema.index({ customer: 1, status: 1, createdAt: -1 });
ticketSchema.index({ priority: 1, status: 1 });

export const Ticket = model<ITicket>("Ticket", ticketSchema);
