"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ticket = exports.REFUND_PROPOSAL_STATUSES = exports.DISPUTE_ACTIONS = exports.TICKET_PRIORITIES = exports.TICKET_STATUSES = void 0;
const mongoose_1 = require("mongoose");
// The full status graph now BRANCHES (IN_PROGRESS can go two different
// places), so it's no longer "one next status" - see
// services/ticketService.ts TRANSITIONS map for the actual rules. This list
// is just every status that exists.
exports.TICKET_STATUSES = [
    "OPEN",
    "TRIAGED",
    "ASSIGNED",
    "IN_PROGRESS",
    "WAITING_FOR_CUSTOMER",
    "RESOLVED",
    "CLOSED",
];
exports.TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const attachmentSchema = new mongoose_1.Schema({
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    uploadedAt: { type: Date, default: Date.now },
}, { _id: true });
exports.DISPUTE_ACTIONS = ["ACCEPT_CLAIM", "MAKE_OFFER", "CONTEST", "NONE"];
const disputeSchema = new mongoose_1.Schema({
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
    outcome: { type: mongoose_1.Schema.Types.Mixed, default: null },
    actions: { type: [String], default: [] },
    raw: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    lastSyncedAt: { type: Date, default: Date.now },
}, { _id: false });
const disputeProposalSchema = new mongoose_1.Schema({
    status: { type: String, enum: ["PENDING", "PROCESSING", "EXECUTED", "REJECTED", "FAILED"], required: true },
    action: { type: String, enum: exports.DISPUTE_ACTIONS, required: true },
    amount: { type: Number, default: 0 },
    currency: { type: String, required: true },
    winChance: { type: Number, default: 0 },
    reasoning: { type: String, default: "" },
    policyNotes: { type: [String], default: [] },
    responseNote: { type: String, default: "" },
    evidenceText: { type: String, default: "" },
    facts: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    steps: { type: [{ name: String, detail: String, _id: false }], default: [] },
    source: { type: String, enum: ["groq", "rules"], required: true },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null },
    createdAt: { type: Date, default: Date.now },
    decidedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    error: { type: String, default: null },
}, { _id: false });
exports.REFUND_PROPOSAL_STATUSES = ["PENDING", "PROCESSING", "EXECUTED", "SENT", "REJECTED", "FAILED"];
const refundProposalSchema = new mongoose_1.Schema({
    status: { type: String, enum: exports.REFUND_PROPOSAL_STATUSES, required: true },
    issueType: { type: String, required: true },
    action: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    reasoning: { type: String, default: "" },
    confidence: { type: Number, default: 0 },
    policyNotes: { type: [String], default: [] },
    customerReply: { type: String, default: "" },
    facts: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    steps: { type: [{ name: String, detail: String, _id: false }], default: [] },
    source: { type: String, enum: ["groq", "rules"], required: true },
    paypalMode: { type: String, enum: ["sandbox", "simulated"], required: true },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null },
    createdAt: { type: Date, default: Date.now },
    decidedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    executedAmount: { type: Number, default: null },
    paypalRefundId: { type: String, default: null },
    error: { type: String, default: null },
}, { _id: false });
const ticketSchema = new mongoose_1.Schema({
    ticketNumber: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    category: { type: String, required: true },
    priority: { type: String, enum: exports.TICKET_PRIORITIES, required: true },
    status: { type: String, enum: exports.TICKET_STATUSES, default: "OPEN", index: true },
    tags: { type: [String], default: [] },
    customer: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    assignedAgent: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    attachments: { type: [attachmentSchema], default: [] },
    responseDeadline: { type: Date, required: true },
    resolutionDeadline: { type: Date, required: true },
    firstResponseAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    responseBreachNotified: { type: Boolean, default: false },
    resolutionBreachNotified: { type: Boolean, default: false },
    order: { type: mongoose_1.Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    refundProposal: { type: refundProposalSchema, default: null },
    dispute: { type: disputeSchema, default: null },
    disputeProposal: { type: disputeProposalSchema, default: null },
}, { timestamps: true });
// One case per PayPal dispute (webhooks can arrive more than once).
ticketSchema.index({ "dispute.disputeId": 1 }, { unique: true, partialFilterExpression: { "dispute.disputeId": { $type: "string" } } });
// Compound indexes for the query patterns the ticket queue/dashboard
// actually run: "an agent's queue filtered by status, newest first" and
// "a customer's tickets filtered by status, newest first" are both covered
// by a (field, status, createdAt) index - MongoDB can satisfy the filter AND
// the sort from the index alone, without a separate in-memory sort step.
ticketSchema.index({ assignedAgent: 1, status: 1, createdAt: -1 });
ticketSchema.index({ customer: 1, status: 1, createdAt: -1 });
ticketSchema.index({ priority: 1, status: 1 });
exports.Ticket = (0, mongoose_1.model)("Ticket", ticketSchema);
