"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const mongoose_1 = __importDefault(require("mongoose"));
const app_1 = require("../app");
const db_1 = require("../config/db");
const seed_1 = require("../config/seed");
const refundAgentGraph_1 = require("../ai/refundAgentGraph");
// End-to-end refund flow over real HTTP + a real (in-memory) MongoDB, with
// PayPal in simulated mode and the AI on its rules fallback:
// buy → capture → ticket → agent proposal → human approval → refund.
const app = (0, app_1.createApp)();
(0, vitest_1.beforeAll)(async () => {
    await (0, db_1.connectDB)();
    await (0, seed_1.seedDefaults)();
});
(0, vitest_1.afterAll)(async () => {
    await mongoose_1.default.connection.dropDatabase();
    await mongoose_1.default.disconnect();
});
async function register(role) {
    const email = `${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
    const res = await (0, supertest_1.default)(app)
        .post("/api/v1/auth/register")
        .send({ name: `Test ${role}`, email, password: "TestPass123!", role });
    return res.body.data.accessToken;
}
async function buy(token, sku) {
    const created = await (0, supertest_1.default)(app)
        .post("/api/v1/payments/orders")
        .set("Authorization", `Bearer ${token}`)
        .send({ items: [{ sku, quantity: 1 }] });
    (0, vitest_1.expect)(created.status).toBe(201);
    const captured = await (0, supertest_1.default)(app)
        .post(`/api/v1/payments/orders/${created.body.data.order._id}/capture`)
        .set("Authorization", `Bearer ${token}`);
    (0, vitest_1.expect)(captured.status).toBe(200);
    (0, vitest_1.expect)(captured.body.data.order.status).toBe("COMPLETED");
    return captured.body.data.order;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(0, vitest_1.describe)("Payments", () => {
    (0, vitest_1.it)("exposes config and catalog without login", async () => {
        const config = await (0, supertest_1.default)(app).get("/api/v1/payments/config");
        (0, vitest_1.expect)(config.body.data.mode).toBe("simulated");
        (0, vitest_1.expect)(config.body.data.clientId).toBeNull();
        const catalog = await (0, supertest_1.default)(app).get("/api/v1/payments/catalog");
        (0, vitest_1.expect)(catalog.body.data.products.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("prices orders on the server and rejects unknown products", async () => {
        const token = await register("CUSTOMER");
        const order = await buy(token, "UI-KIT");
        (0, vitest_1.expect)(order.total).toBe(49);
        const bad = await (0, supertest_1.default)(app)
            .post("/api/v1/payments/orders")
            .set("Authorization", `Bearer ${token}`)
            .send({ items: [{ sku: "FREE-STUFF", quantity: 1, price: 0 }] });
        (0, vitest_1.expect)(bad.status).toBe(400);
    });
    (0, vitest_1.it)("stops customers from seeing each other's orders", async () => {
        const alice = await register("CUSTOMER");
        const bob = await register("CUSTOMER");
        const order = await buy(alice, "ICON-PACK");
        const res = await (0, supertest_1.default)(app).get(`/api/v1/payments/orders/${order._id}`).set("Authorization", `Bearer ${bob}`);
        (0, vitest_1.expect)(res.status).toBe(403);
    });
});
(0, vitest_1.describe)("Refund agent", () => {
    (0, vitest_1.it)("smart intake → duplicate detected → approve → PayPal refund → ticket resolved", async () => {
        const customer = await register("CUSTOMER");
        const agent = await register("AGENT");
        await buy(customer, "UI-KIT");
        const second = await buy(customer, "UI-KIT"); // the duplicate charge
        const intake = await (0, supertest_1.default)(app)
            .post("/api/v1/tickets/smart-intake")
            .set("Authorization", `Bearer ${customer}`)
            .send({ message: "I was charged twice for the Dashboard UI Kit today, please refund one of them." });
        (0, vitest_1.expect)(intake.status).toBe(201);
        (0, vitest_1.expect)(intake.body.data.intake.orderId).toBeTruthy();
        const ticketId = intake.body.data.ticket._id;
        // Move it into IN_PROGRESS like a real agent would.
        const auth = { Authorization: `Bearer ${agent}` };
        await (0, supertest_1.default)(app).patch(`/api/v1/tickets/${ticketId}/status`).set(auth).send({ status: "TRIAGED" });
        await (0, supertest_1.default)(app).post(`/api/v1/tickets/${ticketId}/assign`).set(auth);
        await (0, supertest_1.default)(app).patch(`/api/v1/tickets/${ticketId}/status`).set(auth).send({ status: "IN_PROGRESS" });
        await wait(300); // let the automatic background run finish
        const run = await (0, supertest_1.default)(app).post(`/api/v1/tickets/${ticketId}/refund-agent`).set(auth);
        (0, vitest_1.expect)(run.status).toBe(200);
        const proposal = run.body.data.ticket.refundProposal;
        (0, vitest_1.expect)(proposal.status).toBe("PENDING");
        (0, vitest_1.expect)(proposal.issueType).toBe("DUPLICATE_CHARGE");
        (0, vitest_1.expect)(proposal.action).toBe("FULL_REFUND");
        (0, vitest_1.expect)(proposal.amount).toBe(49);
        (0, vitest_1.expect)(proposal.facts.duplicateOrders.length).toBe(1);
        // Customers never see the agent's internal reasoning.
        const asCustomer = await (0, supertest_1.default)(app).get(`/api/v1/tickets/${ticketId}`).set("Authorization", `Bearer ${customer}`);
        (0, vitest_1.expect)(asCustomer.body.data.ticket.refundProposal).toBeNull();
        // ...and can't run or approve it.
        const forbidden = await (0, supertest_1.default)(app)
            .post(`/api/v1/tickets/${ticketId}/refund-proposal/approve`)
            .set("Authorization", `Bearer ${customer}`)
            .send({});
        (0, vitest_1.expect)(forbidden.status).toBe(403);
        const approved = await (0, supertest_1.default)(app).post(`/api/v1/tickets/${ticketId}/refund-proposal/approve`).set(auth).send({});
        (0, vitest_1.expect)(approved.status).toBe(200);
        const done = approved.body.data.ticket;
        (0, vitest_1.expect)(done.refundProposal.status).toBe("EXECUTED");
        (0, vitest_1.expect)(done.refundProposal.paypalRefundId).toMatch(/^REFUND-SIM-/);
        (0, vitest_1.expect)(done.status).toBe("RESOLVED");
        (0, vitest_1.expect)(done.order.status).toBe("REFUNDED");
        (0, vitest_1.expect)(done.order._id).toBe(second._id); // intake picked the most recent matching order
        // A second approve must not refund again.
        const again = await (0, supertest_1.default)(app).post(`/api/v1/tickets/${ticketId}/refund-proposal/approve`).set(auth).send({});
        (0, vitest_1.expect)(again.status).toBe(409);
        // The reply went to the customer as a public comment.
        const comments = await (0, supertest_1.default)(app).get(`/api/v1/tickets/${ticketId}/comments`).set("Authorization", `Bearer ${customer}`);
        (0, vitest_1.expect)(comments.body.data.comments.some((c) => c.text.includes("49"))).toBe(true);
        // Running the agent again on a fully refunded order proposes no refund.
        const rerun = await (0, supertest_1.default)(app).post(`/api/v1/tickets/${ticketId}/refund-agent`).set(auth);
        (0, vitest_1.expect)(rerun.body.data.ticket.refundProposal.action).toBe("NO_REFUND");
    });
    (0, vitest_1.it)("asks for details instead of refunding a duplicate claim with no evidence", async () => {
        const customer = await register("CUSTOMER");
        const agent = await register("AGENT");
        const order = await buy(customer, "COURSE-AI");
        const created = await (0, supertest_1.default)(app)
            .post("/api/v1/tickets")
            .set("Authorization", `Bearer ${customer}`)
            .send({
            title: "Charged twice",
            description: "PayPal charged me twice for the course!",
            category: "Payment",
            priority: "HIGH",
            orderId: order._id,
        });
        (0, vitest_1.expect)(created.status).toBe(201);
        await wait(300);
        const run = await (0, supertest_1.default)(app)
            .post(`/api/v1/tickets/${created.body.data.ticket._id}/refund-agent`)
            .set("Authorization", `Bearer ${agent}`);
        (0, vitest_1.expect)(run.body.data.ticket.refundProposal.action).toBe("ASK_FOR_INFO");
        (0, vitest_1.expect)(run.body.data.ticket.refundProposal.amount).toBe(0);
    });
    (0, vitest_1.it)("won't link a ticket to someone else's order", async () => {
        const alice = await register("CUSTOMER");
        const bob = await register("CUSTOMER");
        const order = await buy(alice, "ICON-PACK");
        const res = await (0, supertest_1.default)(app)
            .post("/api/v1/tickets")
            .set("Authorization", `Bearer ${bob}`)
            .send({ title: "Refund please", description: "Please refund this order", category: "Payment", priority: "LOW", orderId: order._id });
        (0, vitest_1.expect)(res.status).toBe(400);
    });
});
(0, vitest_1.describe)("Dispute agent", () => {
    (0, vitest_1.it)("buyer disputes after downloading → agent contests with evidence → approved → PayPal decides for seller", async () => {
        const customer = await register("CUSTOMER");
        const agent = await register("AGENT");
        const auth = { Authorization: `Bearer ${agent}` };
        const order = await buy(customer, "COURSE-AI");
        const dl = await (0, supertest_1.default)(app).post(`/api/v1/disputes/orders/${order._id}/download`).set("Authorization", `Bearer ${customer}`);
        (0, vitest_1.expect)(dl.status).toBe(200);
        const sim = await (0, supertest_1.default)(app)
            .post("/api/v1/disputes/simulate")
            .set("Authorization", `Bearer ${customer}`)
            .send({ orderId: order._id, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", message: "I never got the course." });
        (0, vitest_1.expect)(sim.status).toBe(201);
        const list = await (0, supertest_1.default)(app).get("/api/v1/disputes").set(auth);
        const kase = list.body.data.cases.find((c) => c.order === order._id);
        (0, vitest_1.expect)(kase.dispute.status).toBe("WAITING_FOR_SELLER_RESPONSE");
        const run = await (0, supertest_1.default)(app).post(`/api/v1/disputes/${kase._id}/agent`).set(auth);
        const p = run.body.data.ticket.disputeProposal;
        (0, vitest_1.expect)(p.action).toBe("CONTEST");
        (0, vitest_1.expect)(p.evidenceText).toContain("Download link used: 1 time(s)");
        const ok = await (0, supertest_1.default)(app).post(`/api/v1/disputes/${kase._id}/approve`).set(auth).send({});
        (0, vitest_1.expect)(ok.status).toBe(200);
        (0, vitest_1.expect)(ok.body.data.ticket.dispute.status).toBe("UNDER_REVIEW");
        const decided = await (0, supertest_1.default)(app).post(`/api/v1/disputes/${kase._id}/adjudicate`).set(auth).send({ outcome: "SELLER_FAVOR" });
        (0, vitest_1.expect)(decided.body.data.ticket.dispute.status).toBe("RESOLVED");
        const events = await (0, supertest_1.default)(app).get("/api/v1/disputes/events").set(auth);
        (0, vitest_1.expect)(events.body.data.events.some((e) => e.eventType === "CUSTOMER.DISPUTE.CREATED")).toBe(true);
    });
    (0, vitest_1.it)("refuses to contest 'not received' without a download and accepts the claim instead", async () => {
        const customer = await register("CUSTOMER");
        const agent = await register("AGENT");
        const order = await buy(customer, "ICON-PACK");
        await (0, supertest_1.default)(app)
            .post("/api/v1/disputes/simulate")
            .set("Authorization", `Bearer ${customer}`)
            .send({ orderId: order._id, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", message: "Nothing arrived." });
        const list = await (0, supertest_1.default)(app).get("/api/v1/disputes").set("Authorization", `Bearer ${agent}`);
        const kase = list.body.data.cases.find((c) => c.order === order._id);
        const run = await (0, supertest_1.default)(app).post(`/api/v1/disputes/${kase._id}/agent`).set("Authorization", `Bearer ${agent}`);
        (0, vitest_1.expect)(run.body.data.ticket.disputeProposal.action).toBe("ACCEPT_CLAIM");
        const ok = await (0, supertest_1.default)(app).post(`/api/v1/disputes/${kase._id}/approve`).set("Authorization", `Bearer ${agent}`).send({});
        (0, vitest_1.expect)(ok.body.data.ticket.dispute.status).toBe("RESOLVED");
        (0, vitest_1.expect)(ok.body.data.ticket.order.status).toBe("REFUNDED");
    });
});
(0, vitest_1.describe)("Policy guard", () => {
    const facts = {
        captureStatus: "COMPLETED",
        capturedAmount: 100,
        currency: "USD",
        refundedSoFar: 0,
        refundable: 100,
        daysSincePayment: 3,
        withinWindow: true,
        refundWindowDays: 30,
        duplicateOrders: [],
        recentRefundCount: 0,
        recentRefundTotal: 0,
        riskLevel: "LOW",
    };
    (0, vitest_1.it)("never refunds more than is left", () => {
        const r = (0, refundAgentGraph_1.applyPolicy)({ ...facts, refundable: 40 }, { issueType: "NOT_AS_DESCRIBED", action: "PARTIAL_REFUND", amount: 90 });
        (0, vitest_1.expect)(r.amount).toBe(40);
    });
    (0, vitest_1.it)("blocks refunds outside the window", () => {
        const r = (0, refundAgentGraph_1.applyPolicy)({ ...facts, daysSincePayment: 45, withinWindow: false }, { issueType: "CHANGED_MIND", action: "FULL_REFUND", amount: 100 });
        (0, vitest_1.expect)(r.action).toBe("NO_REFUND");
        (0, vitest_1.expect)(r.amount).toBe(0);
    });
    (0, vitest_1.it)("holds refunds for customers with many recent refunds", () => {
        const r = (0, refundAgentGraph_1.applyPolicy)({ ...facts, recentRefundCount: 4, riskLevel: "HIGH" }, { issueType: "NOT_RECEIVED", action: "FULL_REFUND", amount: 100 });
        (0, vitest_1.expect)(r.action).toBe("ASK_FOR_INFO");
    });
    (0, vitest_1.it)("forces full refunds to equal the refundable balance", () => {
        const r = (0, refundAgentGraph_1.applyPolicy)({ ...facts, refundable: 60 }, { issueType: "NOT_RECEIVED", action: "FULL_REFUND", amount: 999 });
        (0, vitest_1.expect)(r.amount).toBe(60);
    });
});
