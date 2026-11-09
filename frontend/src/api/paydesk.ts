import { api } from "./client";
import type { ApiSuccess, Ticket } from "../types";

// ── Types ───────────────────────────────────────────────────────────────

export interface PaymentsConfig {
  mode: "sandbox" | "simulated";
  clientId: string | null;
  currency: string;
  refundWindowDays: number;
}

export interface Product {
  sku: string;
  name: string;
  description: string;
  price: number;
  emoji: string;
}

export interface Order {
  _id: string;
  orderNumber: string;
  customer: { _id: string; name: string; email: string } | string;
  items: { sku: string; name: string; unitPrice: number; quantity: number }[];
  total: number;
  currency: string;
  status: "CREATED" | "COMPLETED" | "PARTIALLY_REFUNDED" | "REFUNDED";
  paypalMode: "sandbox" | "simulated";
  paypalOrderId: string;
  captureId: string | null;
  paidAt: string | null;
  refundedTotal: number;
  refunds: { refundId: string; amount: number; status: string; reason: string; createdAt: string }[];
  fulfillment?: { deliveredAt: string | null; accessCount: number; lastAccessAt: string | null };
}

export interface AgentStep {
  name: string;
  detail: string;
}

export interface RefundProposal {
  status: "PENDING" | "PROCESSING" | "EXECUTED" | "SENT" | "REJECTED" | "FAILED";
  issueType: string;
  action: "FULL_REFUND" | "PARTIAL_REFUND" | "NO_REFUND" | "ASK_FOR_INFO";
  amount: number;
  currency: string;
  reasoning: string;
  confidence: number;
  policyNotes: string[];
  customerReply: string;
  facts: Record<string, unknown>;
  steps: AgentStep[];
  source: "groq" | "rules";
  paypalMode: "sandbox" | "simulated";
  createdBy: { name: string } | null;
  createdAt: string;
  decidedBy: { name: string } | null;
  executedAmount: number | null;
  paypalRefundId: string | null;
  error: string | null;
}

export interface TicketDispute {
  disputeId: string;
  reason: string;
  status: string;
  stage: string;
  amount: number;
  currency: string;
  sellerResponseDue: string | null;
  transactionId: string | null;
  buyerName: string | null;
  messages: { postedBy: string; time: string; content: string }[];
  outcome: { code: string; amountRefunded: number | null } | null;
  actions: string[];
}

export interface DisputeProposal {
  status: "PENDING" | "PROCESSING" | "EXECUTED" | "REJECTED" | "FAILED";
  action: "ACCEPT_CLAIM" | "MAKE_OFFER" | "CONTEST" | "NONE";
  amount: number;
  currency: string;
  winChance: number;
  reasoning: string;
  policyNotes: string[];
  responseNote: string;
  evidenceText: string;
  steps: AgentStep[];
  source: "groq" | "rules";
  createdAt: string;
  error: string | null;
}

export interface PayTicket extends Ticket {
  order: Order | string | null;
  refundProposal: RefundProposal | null;
  dispute: TicketDispute | null;
  disputeProposal: DisputeProposal | null;
}

export interface RefundStats {
  revenue: number;
  refunded: number;
  paidOrders: number;
  pendingCount: number;
  pendingAmount: number;
  agreementRate: number | null;
  avgMinutesToDecision: number | null;
}

export interface WebhookEventRow {
  _id: string;
  eventId: string;
  eventType: string;
  resourceId: string | null;
  verified: boolean;
  source: "paypal" | "simulated";
  result: string;
  receivedAt: string;
}

// ── Calls ───────────────────────────────────────────────────────────────

const d = <T,>(p: Promise<{ data: ApiSuccess<T> }>) => p.then((r) => r.data.data);

export const getPaymentsConfig = () => d<PaymentsConfig>(api.get("/payments/config"));
export const getCatalog = () => d<{ products: Product[] }>(api.get("/payments/catalog")).then((r) => r.products);
export const listOrders = (paid = false) => d<{ orders: Order[] }>(api.get("/payments/orders", { params: paid ? { paid: "true" } : {} })).then((r) => r.orders);
export const createOrder = (sku: string) => d<{ order: Order }>(api.post("/payments/orders", { items: [{ sku, quantity: 1 }] })).then((r) => r.order);
export const captureOrder = (id: string) => d<{ order: Order }>(api.post(`/payments/orders/${id}/capture`)).then((r) => r.order);
export const getRefundStats = () => d<RefundStats>(api.get("/payments/stats"));

export const downloadOrder = (id: string) => d<{ files: string[]; note: string }>(api.post(`/disputes/orders/${id}/download`));
export const simulateDispute = (orderId: string, reason: string, message: string) =>
  d<{ result: string }>(api.post("/disputes/simulate", { orderId, reason, message }));

export const smartIntake = (message: string) =>
  d<{ ticket: Ticket; intake: { orderNumber: string | null; matchReason: string; source: string } }>(api.post("/tickets/smart-intake", { message }));

export const runRefundAgent = (ticketId: string) => d<{ ticket: PayTicket }>(api.post(`/tickets/${ticketId}/refund-agent`)).then((r) => r.ticket);
export const approveRefund = (ticketId: string, body: { amount?: number; customerReply?: string }) =>
  d<{ ticket: PayTicket }>(api.post(`/tickets/${ticketId}/refund-proposal/approve`, body)).then((r) => r.ticket);
export const rejectRefund = (ticketId: string, note?: string) =>
  d<{ ticket: PayTicket }>(api.post(`/tickets/${ticketId}/refund-proposal/reject`, { note })).then((r) => r.ticket);

export const listDisputeCases = () => d<{ cases: PayTicket[] }>(api.get("/disputes")).then((r) => r.cases);
export const listEvents = () => d<{ events: WebhookEventRow[] }>(api.get("/disputes/events")).then((r) => r.events);
export const syncDisputes = () => d<{ checked: number; created: number }>(api.post("/disputes/sync"));
export const runDisputeAgent = (ticketId: string) => d<{ ticket: PayTicket }>(api.post(`/disputes/${ticketId}/agent`)).then((r) => r.ticket);
export const approveDispute = (ticketId: string, body: { amount?: number; responseNote?: string }) =>
  d<{ ticket: PayTicket }>(api.post(`/disputes/${ticketId}/approve`, body)).then((r) => r.ticket);
export const rejectDispute = (ticketId: string) => d<{ ticket: PayTicket }>(api.post(`/disputes/${ticketId}/reject`)).then((r) => r.ticket);
export const adjudicateDispute = (ticketId: string, outcome: "BUYER_FAVOR" | "SELLER_FAVOR") =>
  d<{ ticket: PayTicket }>(api.post(`/disputes/${ticketId}/adjudicate`, { outcome })).then((r) => r.ticket);

export const askAssistant = (question: string, history: { role: "user" | "assistant"; content: string }[]) =>
  d<{ answer: string; toolsUsed: string[]; source: string }>(api.post("/disputes/assistant", { question, history }));

export const human = (s: string) => s.replace(/_/g, " ").toLowerCase();
export const money = (n: number, cur = "USD") => `${cur === "USD" ? "$" : ""}${n.toFixed(2)}${cur === "USD" ? "" : ` ${cur}`}`;
