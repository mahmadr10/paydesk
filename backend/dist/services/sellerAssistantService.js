"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.askAssistant = askAssistant;
const openai_1 = require("@paypal/agent-toolkit/openai");
const env_1 = require("../config/env");
const Order_1 = require("../models/Order");
const Ticket_1 = require("../models/Ticket");
const AppError_1 = require("../utils/AppError");
const paypalService_1 = require("./paypalService");
let toolkit = null;
function paypalToolkit() {
    if (!toolkit) {
        toolkit = new openai_1.PayPalAgentToolkit({
            clientId: env_1.env.PAYPAL_CLIENT_ID,
            clientSecret: env_1.env.PAYPAL_CLIENT_SECRET,
            configuration: {
                actions: {
                    disputes: { list: true, get: true },
                    orders: { get: true },
                    payments: { getRefunds: true },
                    invoices: { list: true, get: true },
                    // transactions.list and insights.get are left off: they need
                    // PayPal's Transaction Search / reporting permissions, which a
                    // fresh sandbox app doesn't have. Sales totals come from the
                    // store's own records via list_store_orders below.
                },
                context: { sandbox: !env_1.env.PAYPAL_API_BASE.includes("api-m.paypal.com") },
            },
        });
    }
    return toolkit;
}
// list_store_orders reads the store's own database (paid orders with refund
// totals), so sales questions work in both modes. In simulated mode,
// list_disputes is also served locally with the same name the toolkit uses.
const storeOrdersTool = {
    type: "function",
    function: {
        name: "list_store_orders",
        description: "List the store's recent paid orders: amount, currency, status, how much was refunded, paid date, items. Use for sales and refund totals.",
        parameters: { type: "object", properties: {} },
    },
};
const localTools = [
    { type: "function", function: { name: "list_disputes", description: "List PayPal disputes with status and amount", parameters: { type: "object", properties: {} } } },
    storeOrdersTool,
];
async function runLocalTool(name) {
    if (name === "list_disputes") {
        const cases = await Ticket_1.Ticket.find({ dispute: { $ne: null } }).sort({ createdAt: -1 }).limit(25);
        return JSON.stringify(cases.map((c) => ({ dispute_id: c.dispute.disputeId, reason: c.dispute.reason, status: c.dispute.status, stage: c.dispute.stage, amount: c.dispute.amount, currency: c.dispute.currency, seller_response_due: c.dispute.sellerResponseDue, case: c.ticketNumber })));
    }
    if (name === "list_store_orders") {
        const orders = await Order_1.Order.find({ status: { $ne: "CREATED" } }).sort({ paidAt: -1 }).limit(25);
        return JSON.stringify(orders.map((o) => ({ order: o.orderNumber, capture_id: o.captureId, amount: o.total, currency: o.currency, status: o.status, refunded: o.refundedTotal, paid_at: o.paidAt, items: o.items.map((i) => i.name) })));
    }
    return JSON.stringify({ error: "unknown tool" });
}
async function groqChat(messages, tools) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env_1.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: env_1.env.AI_MODEL, messages, tools, tool_choice: "auto", temperature: 0.2 }),
    });
    if (!res.ok)
        throw new AppError_1.AppError(502, "AI_ERROR", `The AI service returned ${res.status}.`);
    const json = (await res.json());
    return json.choices[0].message;
}
async function askAssistant(question, history) {
    if (!env_1.env.GROQ_API_KEY || env_1.env.AI_ENABLED !== "true") {
        throw new AppError_1.AppError(400, "AI_DISABLED", "Add a GROQ_API_KEY to use the assistant.");
    }
    const live = (0, paypalService_1.paypalMode)() === "sandbox";
    const tools = live ? [...paypalToolkit().getTools(), storeOrdersTool] : localTools;
    const messages = [
        {
            role: "system",
            content: "You are PayDesk's assistant for a small online seller. Answer questions about their PayPal business using the tools " +
                "(PayPal disputes, order and refund lookups, invoices, and list_store_orders for the store's own sales and refund totals). " +
                "Always call a tool for facts; never guess numbers. " +
                "Keep answers short and practical: plain text with simple '-' bullets, no markdown tables, no bold. Include amounts with currency. " +
                "You can only read data. If asked to refund or respond to a dispute, say to open the case and approve the agent's proposal. " +
                `Today is ${new Date().toISOString().slice(0, 10)}.`,
        },
        ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: question },
    ];
    const toolsUsed = [];
    for (let step = 0; step < 6; step++) {
        const reply = await groqChat(messages, tools);
        messages.push(reply);
        if (!reply.tool_calls?.length) {
            return { answer: reply.content ?? "", toolsUsed, source: live ? "paypal-agent-toolkit" : "simulated" };
        }
        for (const call of reply.tool_calls) {
            toolsUsed.push(call.function.name);
            let content;
            try {
                content =
                    live && call.function.name !== "list_store_orders"
                        ? String((await paypalToolkit().handleToolCall(call)).content)
                        : await runLocalTool(call.function.name);
            }
            catch (err) {
                content = JSON.stringify({ error: err instanceof Error ? err.message : "tool failed" });
            }
            messages.push({ role: "tool", tool_call_id: call.id, content: content.slice(0, 8000) });
        }
    }
    return { answer: "That took too many steps. Try a more specific question.", toolsUsed, source: live ? "paypal-agent-toolkit" : "simulated" };
}
