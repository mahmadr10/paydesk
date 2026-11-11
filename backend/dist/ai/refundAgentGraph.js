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
exports.REFUND_ABUSE_THRESHOLD = exports.ISSUE_TYPES = exports.REFUND_ACTIONS = void 0;
exports.applyPolicy = applyPolicy;
exports.runRefundAgent = runRefundAgent;
const zod_1 = require("zod");
const langgraph_1 = require("@langchain/langgraph");
const env_1 = require("../config/env");
const paypal = __importStar(require("../services/paypalService"));
const groq_1 = require("./groq");
// The refund agent. Four steps, each with one job:
//
//   START → gatherFacts → assessClaim → policyGuard → draftReply → END
//
//   gatherFacts  TOOL   Calls PayPal live (GET /v2/payments/captures/:id) and
//                       looks for duplicate charges in the customer's history.
//   assessClaim  LLM    Reads the ticket + facts, picks an issue type and a
//                       refund action/amount, explains why.
//   policyGuard  CODE   Hard rules the LLM cannot talk its way past: refund
//                       window, amount never above what's left, no refund on
//                       an already-refunded payment, duplicate claims need
//                       evidence. It can only make a proposal safer.
//   draftReply   LLM    Writes the customer reply for the FINAL decision.
//
// Nothing here moves money. The output is a proposal; a human clicks
// Approve and only then does refundService call the PayPal refund API.
// With no GROQ_API_KEY the two LLM steps use simple keyword rules instead,
// while the PayPal lookup and policy checks stay exactly the same.
exports.REFUND_ACTIONS = ["FULL_REFUND", "PARTIAL_REFUND", "NO_REFUND", "ASK_FOR_INFO"];
exports.ISSUE_TYPES = [
    "DUPLICATE_CHARGE",
    "NOT_RECEIVED",
    "NOT_AS_DESCRIBED",
    "CHANGED_MIND",
    "BILLING_QUESTION",
    "OTHER",
];
// 3+ refunds in 90 days means a human must look closer before money moves.
exports.REFUND_ABUSE_THRESHOLD = 3;
const State = langgraph_1.Annotation.Root({
    input: (0, langgraph_1.Annotation)(),
    useLlm: (0, langgraph_1.Annotation)(),
    facts: (0, langgraph_1.Annotation)(),
    issueType: (0, langgraph_1.Annotation)(),
    action: (0, langgraph_1.Annotation)(),
    amount: (0, langgraph_1.Annotation)(),
    reasoning: (0, langgraph_1.Annotation)(),
    confidence: (0, langgraph_1.Annotation)(),
    policyNotes: (0, langgraph_1.Annotation)(),
    customerReply: (0, langgraph_1.Annotation)(),
    steps: (0, langgraph_1.Annotation)({
        reducer: (a, b) => a.concat(b),
        default: () => [],
    }),
});
const round2 = (n) => Math.round(n * 100) / 100;
// ── 1. gatherFacts (tool) ───────────────────────────────────────────────
async function gatherFacts(state) {
    const { order, otherOrders } = state.input;
    const capture = await paypal.getCaptureDetails(order.captureId);
    const paidAt = order.paidAt ?? new Date(capture.createTime);
    const daysSincePayment = Math.floor((Date.now() - paidAt.getTime()) / 86_400_000);
    const refundable = round2(Math.max(0, capture.amount - order.refundedTotal));
    // A "duplicate" = another paid order, same total and same items, within 48h.
    const itemKey = order.items.map((i) => i.name).sort().join("|");
    const duplicateOrders = otherOrders
        .filter((o) => o.paidAt &&
        Math.abs(o.total - order.total) < 0.01 &&
        o.itemNames.slice().sort().join("|") === itemKey &&
        Math.abs(o.paidAt.getTime() - paidAt.getTime()) <= 48 * 3_600_000)
        .map((o) => o.orderNumber);
    const facts = {
        captureStatus: capture.status,
        capturedAmount: capture.amount,
        currency: capture.currency,
        refundedSoFar: order.refundedTotal,
        refundable,
        daysSincePayment,
        withinWindow: daysSincePayment <= env_1.env.REFUND_WINDOW_DAYS,
        refundWindowDays: env_1.env.REFUND_WINDOW_DAYS,
        duplicateOrders,
        recentRefundCount: state.input.recentRefunds.count,
        recentRefundTotal: round2(state.input.recentRefunds.total),
        riskLevel: state.input.recentRefunds.count >= exports.REFUND_ABUSE_THRESHOLD ? "HIGH" : "LOW",
    };
    return {
        facts,
        steps: [
            {
                name: "Checked PayPal",
                detail: `Capture ${order.captureId} is ${capture.status}: ${capture.amount} ${capture.currency} paid ` +
                    `${daysSincePayment} day(s) ago, ${refundable} still refundable` +
                    (duplicateOrders.length ? `; matching order(s) found: ${duplicateOrders.join(", ")}` : "; no duplicate orders found"),
            },
            {
                name: "Checked refund history",
                detail: `${facts.recentRefundCount} refund(s) to this customer in the last 90 days` +
                    (facts.riskLevel === "HIGH" ? " - high refund frequency, flagged for manual review" : " - normal"),
            },
        ],
    };
}
// ── 2. assessClaim (LLM, or rules without a key) ───────────────────────
const assessSchema = zod_1.z.object({
    issueType: zod_1.z.enum(exports.ISSUE_TYPES),
    action: zod_1.z.enum(exports.REFUND_ACTIONS),
    amount: zod_1.z.number().describe("Refund amount in the order currency. 0 for NO_REFUND or ASK_FOR_INFO."),
    reasoning: zod_1.z.string().describe("2-3 plain sentences explaining the decision to a support agent."),
    confidence: zod_1.z.number().min(0).max(1),
});
function rulesAssess(state) {
    const text = `${state.input.ticketTitle} ${state.input.ticketDescription}`.toLowerCase();
    const f = state.facts;
    if (/\b(twice|double|duplicate|charged two|two charges)\b/.test(text)) {
        return f.duplicateOrders.length
            ? {
                issueType: "DUPLICATE_CHARGE",
                action: "FULL_REFUND",
                amount: f.refundable,
                reasoning: `The customer reports a double charge and order ${f.duplicateOrders[0]} has the same items and total, paid within 48 hours. Refunding this one payment removes the duplicate, and the other payment stays.`,
                confidence: 0.9,
            }
            : {
                issueType: "DUPLICATE_CHARGE",
                action: "ASK_FOR_INFO",
                amount: 0,
                reasoning: "The customer reports a double charge, but no second matching payment exists. Ask for the transaction id of the other charge.",
                confidence: 0.6,
            };
    }
    if (/(not received|never (got|arrived|received)|didn'?t (get|receive)|can'?t access|cannot access|no download|link (is )?(broken|expired))/.test(text)) {
        return {
            issueType: "NOT_RECEIVED",
            action: "FULL_REFUND",
            amount: f.refundable,
            reasoning: "The customer says they never received access to what they paid for. Under the policy, undelivered digital goods get a full refund.",
            confidence: 0.8,
        };
    }
    if (/(not as described|missing|broken|doesn'?t work|does not work|wrong|corrupt|incomplete)/.test(text)) {
        return {
            issueType: "NOT_AS_DESCRIBED",
            action: "PARTIAL_REFUND",
            amount: round2(f.refundable * 0.5),
            reasoning: "The product was delivered but the customer says part of it is broken or missing. A 50% partial refund is fair while the team fixes the issue.",
            confidence: 0.65,
        };
    }
    if (/(changed my mind|no longer need|don'?t need|cancel|by mistake|accident)/.test(text)) {
        return {
            issueType: "CHANGED_MIND",
            action: "FULL_REFUND",
            amount: f.refundable,
            reasoning: "The customer no longer wants the purchase. Change-of-mind refunds are allowed inside the refund window.",
            confidence: 0.75,
        };
    }
    return {
        issueType: "OTHER",
        action: "ASK_FOR_INFO",
        amount: 0,
        reasoning: "The ticket doesn't clearly describe a refundable problem. Ask the customer what went wrong before deciding.",
        confidence: 0.5,
    };
}
async function assessClaim(state) {
    let result;
    if (state.useLlm) {
        const { order } = state.input;
        const f = state.facts;
        result = await (0, groq_1.groqModel)(0.1)
            .structured(assessSchema)
            .invoke([
            {
                role: "system",
                content: "You are a payments support analyst for an online store that sells digital products, paid via PayPal. " +
                    "Decide what should happen with a customer's refund request.\n" +
                    "Store policy:\n" +
                    `- Refunds are possible within ${f.refundWindowDays} days of payment.\n` +
                    "- Duplicate charge (the customer paid twice for the same item): refund ONLY the duplicate payment, which is one payment's amount, never both payments. " +
                    "Use FULL_REFUND with the refundable amount of this ONE payment, and only if a matching second payment exists.\n" +
                    "- Product never delivered / no access: full refund.\n" +
                    "- Delivered but partly broken or not as described: partial refund (usually 30-60%) unless unusable.\n" +
                    "- Change of mind inside the window: full refund.\n" +
                    "- If the request is unclear or unsupported by the facts, choose ASK_FOR_INFO.\n" +
                    "Never propose more than the refundable amount. Use only the facts given; do not invent payments.",
            },
            {
                role: "user",
                content: `Ticket title: ${state.input.ticketTitle}\nTicket description: ${state.input.ticketDescription}\n\n` +
                    `Order ${order.orderNumber}: ${order.items.map((i) => `${i.quantity}x ${i.name} @ ${i.unitPrice}`).join(", ")}\n` +
                    `PayPal capture status: ${f.captureStatus}\nCaptured: ${f.capturedAmount} ${f.currency}\n` +
                    `Already refunded: ${f.refundedSoFar}\nStill refundable: ${f.refundable}\n` +
                    `Days since payment: ${f.daysSincePayment}\n` +
                    `Refunds to this customer in last 90 days: ${f.recentRefundCount}\n` +
                    `Matching duplicate orders: ${f.duplicateOrders.length ? f.duplicateOrders.join(", ") : "none"}`,
            },
        ]);
    }
    else {
        result = rulesAssess(state);
    }
    return {
        issueType: result.issueType,
        action: result.action,
        amount: round2(result.amount),
        reasoning: result.reasoning,
        confidence: Math.max(0, Math.min(1, result.confidence)),
        steps: [
            {
                name: state.useLlm ? "AI assessed the claim" : "Rules assessed the claim",
                // A duplicate charge refunds ONE payment (the duplicate), so say that instead of "full refund".
                detail: `${result.issueType.replace(/_/g, " ").toLowerCase()} → ${result.issueType === "DUPLICATE_CHARGE" && result.action === "FULL_REFUND"
                    ? "refund the duplicate payment"
                    : result.action.replace(/_/g, " ").toLowerCase()}` +
                    (result.amount > 0 ? ` (${round2(result.amount)} ${state.facts.currency})` : ""),
            },
        ],
    };
}
// ── 3. policyGuard (deterministic) ─────────────────────────────────────
function applyPolicy(facts, proposal) {
    let { action, amount } = proposal;
    const notes = [];
    const isRefund = () => action === "FULL_REFUND" || action === "PARTIAL_REFUND";
    if (isRefund() && facts.refundable <= 0) {
        notes.push("This payment is already fully refunded, so no further refund is possible.");
        action = "NO_REFUND";
    }
    if (isRefund() && !["COMPLETED", "PARTIALLY_REFUNDED"].includes(facts.captureStatus)) {
        notes.push(`PayPal reports the payment as ${facts.captureStatus}; refunds need a completed payment.`);
        action = "NO_REFUND";
    }
    if (isRefund() && !facts.withinWindow) {
        notes.push(`Paid ${facts.daysSincePayment} days ago, outside the ${facts.refundWindowDays}-day refund window.`);
        action = "NO_REFUND";
    }
    if (isRefund() && facts.riskLevel === "HIGH") {
        notes.push(`Customer already received ${facts.recentRefundCount} refunds in 90 days (limit ${exports.REFUND_ABUSE_THRESHOLD - 1}). ` +
            "Holding the refund and asking for details so a person can review it.");
        action = "ASK_FOR_INFO";
    }
    if (isRefund() && proposal.issueType === "DUPLICATE_CHARGE" && facts.duplicateOrders.length === 0) {
        notes.push("Duplicate charge claimed, but PayPal history shows no second matching payment. Asking for details instead.");
        action = "ASK_FOR_INFO";
    }
    if (action === "FULL_REFUND") {
        if (Math.abs(amount - facts.refundable) > 0.009)
            notes.push(`Full refund amount set to the refundable balance (${facts.refundable}).`);
        amount = facts.refundable;
    }
    else if (action === "PARTIAL_REFUND") {
        if (amount > facts.refundable) {
            notes.push(`Amount lowered from ${amount} to the refundable balance (${facts.refundable}).`);
            amount = facts.refundable;
        }
        if (amount <= 0) {
            notes.push("Partial refund had no valid amount. Asking for details instead.");
            action = "ASK_FOR_INFO";
            amount = 0;
        }
    }
    else {
        amount = 0;
    }
    if (notes.length === 0)
        notes.push("All policy checks passed.");
    return { action, amount: round2(amount), notes };
}
async function policyGuard(state) {
    const result = applyPolicy(state.facts, { issueType: state.issueType, action: state.action, amount: state.amount });
    const changed = result.action !== state.action || Math.abs(result.amount - state.amount) > 0.009;
    return {
        action: result.action,
        amount: result.amount,
        policyNotes: result.notes,
        steps: [
            {
                name: "Policy check",
                detail: changed ? `Adjusted to ${result.action.replace(/_/g, " ").toLowerCase()}: ${result.notes.join(" ")}` : "Passed: proposal is within store policy.",
            },
        ],
    };
}
// ── 4. draftReply (LLM, or template) ───────────────────────────────────
function templateReply(state) {
    const { orderNumber } = state.input.order;
    const cur = state.facts.currency;
    switch (state.action) {
        case "FULL_REFUND":
            if (state.issueType === "DUPLICATE_CHARGE") {
                return `We found that you were charged twice for the same item. We've refunded the duplicate payment of ${state.amount} ${cur} (order ${orderNumber}) to your PayPal account. Your other payment stays as it is, so you keep your purchase. It usually shows up within a few days. Sorry for the trouble!`;
            }
            return `Thanks for your patience. We've issued a full refund of ${state.amount} ${cur} for order ${orderNumber} to your PayPal account. It usually shows up within a few days. Sorry for the trouble!`;
        case "PARTIAL_REFUND":
            return `Thanks for letting us know. We've refunded ${state.amount} ${cur} for order ${orderNumber} to your PayPal account to make up for the problem, and our team is fixing the issue you reported.`;
        case "NO_REFUND":
            return `Thanks for reaching out about order ${orderNumber}. We looked into it, but we're not able to issue a refund: ${state.policyNotes[0] ?? "it isn't covered by our refund policy"}. Let us know if there's anything else we can help with.`;
        default:
            return `Thanks for contacting us about order ${orderNumber}. To sort this out quickly, could you share a bit more detail about what went wrong (and, if you were charged twice, the PayPal transaction id of the second charge)?`;
    }
}
async function draftReply(state) {
    let reply;
    if (state.useLlm) {
        const res = await (0, groq_1.groqModel)(0.1).invoke([
            {
                role: "system",
                content: "Write a short, warm reply (2-4 sentences) from the support team to the customer. It must match the FINAL decision exactly: " +
                    "state the refund amount and currency if there is a refund, say it goes back to their PayPal account, or explain the reason " +
                    "if there is no refund, or ask the specific question if more info is needed. " +
                    "If the issue type is DUPLICATE_CHARGE, say clearly that ONLY the duplicate payment is refunded and the customer keeps their purchase (their other payment stays). " +
                    "No subject line, no signature, no placeholders.",
            },
            {
                role: "user",
                content: `Order: ${state.input.order.orderNumber}\nIssue type: ${state.issueType}\nCustomer message: ${state.input.ticketDescription}\n` +
                    `Final decision: ${state.action}\nAmount: ${state.amount} ${state.facts.currency}\n` +
                    `Reasoning: ${state.reasoning}\nPolicy notes: ${state.policyNotes.join(" ")}`,
            },
        ]);
        reply = String(res.content).trim();
    }
    else {
        reply = templateReply(state);
    }
    return { customerReply: reply, steps: [{ name: "Drafted reply", detail: "Customer reply written for the final decision." }] };
}
const graph = new langgraph_1.StateGraph(State)
    .addNode("gatherFacts", gatherFacts)
    .addNode("assessClaim", assessClaim)
    .addNode("policyGuard", policyGuard)
    .addNode("draftReply", draftReply)
    .addEdge(langgraph_1.START, "gatherFacts")
    .addEdge("gatherFacts", "assessClaim")
    .addEdge("assessClaim", "policyGuard")
    .addEdge("policyGuard", "draftReply")
    .addEdge("draftReply", langgraph_1.END)
    .compile();
async function runRefundAgent(input, useLlm) {
    const final = await graph.invoke({ input, useLlm });
    return {
        facts: final.facts,
        issueType: final.issueType,
        action: final.action,
        amount: final.amount,
        reasoning: final.reasoning,
        confidence: final.confidence,
        policyNotes: final.policyNotes,
        customerReply: final.customerReply,
        source: useLlm ? "groq" : "rules",
        steps: final.steps,
    };
}
