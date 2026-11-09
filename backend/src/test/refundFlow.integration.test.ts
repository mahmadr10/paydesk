import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app";
import { connectDB } from "../config/db";
import { seedDefaults } from "../config/seed";
import { applyPolicy, PaymentFacts } from "../ai/refundAgentGraph";

// End-to-end refund flow over real HTTP + a real (in-memory) MongoDB, with
// PayPal in simulated mode and the AI on its rules fallback:
// buy → capture → ticket → agent proposal → human approval → refund.
const app = createApp();

beforeAll(async () => {
  await connectDB();
  await seedDefaults();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

async function register(role: "CUSTOMER" | "AGENT") {
  const email = `${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ name: `Test ${role}`, email, password: "TestPass123!", role });
  return res.body.data.accessToken as string;
}

async function buy(token: string, sku: string) {
  const created = await request(app)
    .post("/api/v1/payments/orders")
    .set("Authorization", `Bearer ${token}`)
    .send({ items: [{ sku, quantity: 1 }] });
  expect(created.status).toBe(201);
  const captured = await request(app)
    .post(`/api/v1/payments/orders/${created.body.data.order._id}/capture`)
    .set("Authorization", `Bearer ${token}`);
  expect(captured.status).toBe(200);
  expect(captured.body.data.order.status).toBe("COMPLETED");
  return captured.body.data.order;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Payments", () => {
  it("exposes config and catalog without login", async () => {
    const config = await request(app).get("/api/v1/payments/config");
    expect(config.body.data.mode).toBe("simulated");
    expect(config.body.data.clientId).toBeNull();
    const catalog = await request(app).get("/api/v1/payments/catalog");
    expect(catalog.body.data.products.length).toBeGreaterThan(0);
  });

  it("prices orders on the server and rejects unknown products", async () => {
    const token = await register("CUSTOMER");
    const order = await buy(token, "UI-KIT");
    expect(order.total).toBe(49);
    const bad = await request(app)
      .post("/api/v1/payments/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ sku: "FREE-STUFF", quantity: 1, price: 0 }] });
    expect(bad.status).toBe(400);
  });

  it("stops customers from seeing each other's orders", async () => {
    const alice = await register("CUSTOMER");
    const bob = await register("CUSTOMER");
    const order = await buy(alice, "ICON-PACK");
    const res = await request(app).get(`/api/v1/payments/orders/${order._id}`).set("Authorization", `Bearer ${bob}`);
    expect(res.status).toBe(403);
  });
});

describe("Refund agent", () => {
  it("smart intake → duplicate detected → approve → PayPal refund → ticket resolved", async () => {
    const customer = await register("CUSTOMER");
    const agent = await register("AGENT");
    await buy(customer, "UI-KIT");
    const second = await buy(customer, "UI-KIT"); // the duplicate charge

    const intake = await request(app)
      .post("/api/v1/tickets/smart-intake")
      .set("Authorization", `Bearer ${customer}`)
      .send({ message: "I was charged twice for the Dashboard UI Kit today, please refund one of them." });
    expect(intake.status).toBe(201);
    expect(intake.body.data.intake.orderId).toBeTruthy();
    const ticketId = intake.body.data.ticket._id;

    // Move it into IN_PROGRESS like a real agent would.
    const auth = { Authorization: `Bearer ${agent}` };
    await request(app).patch(`/api/v1/tickets/${ticketId}/status`).set(auth).send({ status: "TRIAGED" });
    await request(app).post(`/api/v1/tickets/${ticketId}/assign`).set(auth);
    await request(app).patch(`/api/v1/tickets/${ticketId}/status`).set(auth).send({ status: "IN_PROGRESS" });

    await wait(300); // let the automatic background run finish
    const run = await request(app).post(`/api/v1/tickets/${ticketId}/refund-agent`).set(auth);
    expect(run.status).toBe(200);
    const proposal = run.body.data.ticket.refundProposal;
    expect(proposal.status).toBe("PENDING");
    expect(proposal.issueType).toBe("DUPLICATE_CHARGE");
    expect(proposal.action).toBe("FULL_REFUND");
    expect(proposal.amount).toBe(49);
    expect(proposal.facts.duplicateOrders.length).toBe(1);

    // Customers never see the agent's internal reasoning.
    const asCustomer = await request(app).get(`/api/v1/tickets/${ticketId}`).set("Authorization", `Bearer ${customer}`);
    expect(asCustomer.body.data.ticket.refundProposal).toBeNull();
    // ...and can't run or approve it.
    const forbidden = await request(app)
      .post(`/api/v1/tickets/${ticketId}/refund-proposal/approve`)
      .set("Authorization", `Bearer ${customer}`)
      .send({});
    expect(forbidden.status).toBe(403);

    const approved = await request(app).post(`/api/v1/tickets/${ticketId}/refund-proposal/approve`).set(auth).send({});
    expect(approved.status).toBe(200);
    const done = approved.body.data.ticket;
    expect(done.refundProposal.status).toBe("EXECUTED");
    expect(done.refundProposal.paypalRefundId).toMatch(/^REFUND-SIM-/);
    expect(done.status).toBe("RESOLVED");
    expect(done.order.status).toBe("REFUNDED");
    expect(done.order._id).toBe(second._id); // intake picked the most recent matching order

    // A second approve must not refund again.
    const again = await request(app).post(`/api/v1/tickets/${ticketId}/refund-proposal/approve`).set(auth).send({});
    expect(again.status).toBe(409);

    // The reply went to the customer as a public comment.
    const comments = await request(app).get(`/api/v1/tickets/${ticketId}/comments`).set("Authorization", `Bearer ${customer}`);
    expect(comments.body.data.comments.some((c: { text: string }) => c.text.includes("49"))).toBe(true);

    // Running the agent again on a fully refunded order proposes no refund.
    const rerun = await request(app).post(`/api/v1/tickets/${ticketId}/refund-agent`).set(auth);
    expect(rerun.body.data.ticket.refundProposal.action).toBe("NO_REFUND");
  });

  it("asks for details instead of refunding a duplicate claim with no evidence", async () => {
    const customer = await register("CUSTOMER");
    const agent = await register("AGENT");
    const order = await buy(customer, "COURSE-AI");
    const created = await request(app)
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${customer}`)
      .send({
        title: "Charged twice",
        description: "PayPal charged me twice for the course!",
        category: "Payment",
        priority: "HIGH",
        orderId: order._id,
      });
    expect(created.status).toBe(201);
    await wait(300);
    const run = await request(app)
      .post(`/api/v1/tickets/${created.body.data.ticket._id}/refund-agent`)
      .set("Authorization", `Bearer ${agent}`);
    expect(run.body.data.ticket.refundProposal.action).toBe("ASK_FOR_INFO");
    expect(run.body.data.ticket.refundProposal.amount).toBe(0);
  });

  it("won't link a ticket to someone else's order", async () => {
    const alice = await register("CUSTOMER");
    const bob = await register("CUSTOMER");
    const order = await buy(alice, "ICON-PACK");
    const res = await request(app)
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${bob}`)
      .send({ title: "Refund please", description: "Please refund this order", category: "Payment", priority: "LOW", orderId: order._id });
    expect(res.status).toBe(400);
  });
});

describe("Dispute agent", () => {
  it("buyer disputes after downloading → agent contests with evidence → approved → PayPal decides for seller", async () => {
    const customer = await register("CUSTOMER");
    const agent = await register("AGENT");
    const auth = { Authorization: `Bearer ${agent}` };
    const order = await buy(customer, "COURSE-AI");
    const dl = await request(app).post(`/api/v1/disputes/orders/${order._id}/download`).set("Authorization", `Bearer ${customer}`);
    expect(dl.status).toBe(200);

    const sim = await request(app)
      .post("/api/v1/disputes/simulate")
      .set("Authorization", `Bearer ${customer}`)
      .send({ orderId: order._id, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", message: "I never got the course." });
    expect(sim.status).toBe(201);

    const list = await request(app).get("/api/v1/disputes").set(auth);
    const kase = list.body.data.cases.find((c: any) => c.order === order._id);
    expect(kase.dispute.status).toBe("WAITING_FOR_SELLER_RESPONSE");

    const run = await request(app).post(`/api/v1/disputes/${kase._id}/agent`).set(auth);
    const p = run.body.data.ticket.disputeProposal;
    expect(p.action).toBe("CONTEST");
    expect(p.evidenceText).toContain("Download link used: 1 time(s)");

    const ok = await request(app).post(`/api/v1/disputes/${kase._id}/approve`).set(auth).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.data.ticket.dispute.status).toBe("UNDER_REVIEW");

    const decided = await request(app).post(`/api/v1/disputes/${kase._id}/adjudicate`).set(auth).send({ outcome: "SELLER_FAVOR" });
    expect(decided.body.data.ticket.dispute.status).toBe("RESOLVED");

    const events = await request(app).get("/api/v1/disputes/events").set(auth);
    expect(events.body.data.events.some((e: any) => e.eventType === "CUSTOMER.DISPUTE.CREATED")).toBe(true);
  });

  it("refuses to contest 'not received' without a download and accepts the claim instead", async () => {
    const customer = await register("CUSTOMER");
    const agent = await register("AGENT");
    const order = await buy(customer, "ICON-PACK");
    await request(app)
      .post("/api/v1/disputes/simulate")
      .set("Authorization", `Bearer ${customer}`)
      .send({ orderId: order._id, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", message: "Nothing arrived." });
    const list = await request(app).get("/api/v1/disputes").set("Authorization", `Bearer ${agent}`);
    const kase = list.body.data.cases.find((c: any) => c.order === order._id);
    const run = await request(app).post(`/api/v1/disputes/${kase._id}/agent`).set("Authorization", `Bearer ${agent}`);
    expect(run.body.data.ticket.disputeProposal.action).toBe("ACCEPT_CLAIM");
    const ok = await request(app).post(`/api/v1/disputes/${kase._id}/approve`).set("Authorization", `Bearer ${agent}`).send({});
    expect(ok.body.data.ticket.dispute.status).toBe("RESOLVED");
    expect(ok.body.data.ticket.order.status).toBe("REFUNDED");
  });
});

describe("Policy guard", () => {
  const facts: PaymentFacts = {
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

  it("never refunds more than is left", () => {
    const r = applyPolicy({ ...facts, refundable: 40 }, { issueType: "NOT_AS_DESCRIBED", action: "PARTIAL_REFUND", amount: 90 });
    expect(r.amount).toBe(40);
  });

  it("blocks refunds outside the window", () => {
    const r = applyPolicy({ ...facts, daysSincePayment: 45, withinWindow: false }, { issueType: "CHANGED_MIND", action: "FULL_REFUND", amount: 100 });
    expect(r.action).toBe("NO_REFUND");
    expect(r.amount).toBe(0);
  });

  it("holds refunds for customers with many recent refunds", () => {
    const r = applyPolicy({ ...facts, recentRefundCount: 4, riskLevel: "HIGH" }, { issueType: "NOT_RECEIVED", action: "FULL_REFUND", amount: 100 });
    expect(r.action).toBe("ASK_FOR_INFO");
  });

  it("forces full refunds to equal the refundable balance", () => {
    const r = applyPolicy({ ...facts, refundable: 60 }, { issueType: "NOT_RECEIVED", action: "FULL_REFUND", amount: 999 });
    expect(r.amount).toBe(60);
  });
});
