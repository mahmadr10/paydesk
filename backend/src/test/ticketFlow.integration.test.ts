import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app";
import { connectDB } from "../config/db";
import { seedDefaults } from "../config/seed";

// Integration tests exercise the REAL HTTP layer (Supertest drives the
// actual Express app - routes, middleware, validation, controllers,
// services, and a real MongoDB, all wired together) rather than calling
// service functions directly. This is what catches bugs unit tests can't:
// wrong route paths, a validator that doesn't match its controller, a role
// check that's missing on one specific route.
const app = createApp();

beforeAll(async () => {
  await connectDB();
  await seedDefaults();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

async function registerAndLogin(role: "CUSTOMER" | "AGENT", emailPrefix: string) {
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ name: `Test ${role}`, email, password: "TestPass123!", role });
  return { token: res.body.data.accessToken as string, userId: res.body.data.user._id as string, email };
}

describe("Auth", () => {
  it("registers a new customer and returns an access token + user", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "Alice", email: `alice-${Date.now()}@test.local`, password: "TestPass123!", role: "CUSTOMER" });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.role).toBe("CUSTOMER");
    // The password hash must never be sent to the client.
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it("rejects registering the same email twice", async () => {
    const email = `dup-${Date.now()}@test.local`;
    await request(app).post("/api/v1/auth/register").send({ name: "Alice A", email, password: "TestPass123!", role: "CUSTOMER" });
    const second = await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "Bob B", email, password: "TestPass123!", role: "CUSTOMER" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("EMAIL_IN_USE");
  });

  it("rejects a weak password with a validation error, not a raw stack trace", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "Alice A", email: `weak-${Date.now()}@test.local`, password: "123", role: "CUSTOMER" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).not.toMatch(/at\s+.*\(.*:\d+:\d+\)/); // no stack-trace-looking text
  });

  it("cannot self-register as ADMIN", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "Alice A", email: `admin-try-${Date.now()}@test.local`, password: "TestPass123!", role: "ADMIN" });
    expect(res.status).toBe(400);
  });

  it("rejects login with the wrong password using the same error as a nonexistent email", async () => {
    const email = `login-${Date.now()}@test.local`;
    await request(app).post("/api/v1/auth/register").send({ name: "Alice A", email, password: "TestPass123!", role: "CUSTOMER" });

    const wrongPassword = await request(app).post("/api/v1/auth/login").send({ email, password: "WrongPass123!" });
    const noSuchEmail = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "nobody@test.local", password: "WrongPass123!" });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe(noSuchEmail.body.error.code);
  });

  it("rejects an unauthenticated request to a protected route", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("Tickets: creation, retrieval, assignment, status transitions", () => {
  it("lets a customer create a ticket with computed SLA deadlines", async () => {
    const { token } = await registerAndLogin("CUSTOMER", "cust");
    const res = await request(app)
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Payment API returns 500", description: "Started failing at 10am today", category: "Technical", priority: "CRITICAL" });

    expect(res.status).toBe(201);
    expect(res.body.data.ticket.status).toBe("OPEN");
    expect(res.body.data.ticket.ticketNumber).toMatch(/^TCK-\d{6}$/);
    expect(res.body.data.ticket.sla).toBeDefined();
    expect(new Date(res.body.data.ticket.responseDeadline).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects ticket creation with an unknown category", async () => {
    const { token } = await registerAndLogin("CUSTOMER", "cust");
    const res = await request(app)
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Something broke", description: "Details here please", category: "NotARealCategory", priority: "LOW" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CATEGORY");
  });

  it("lets a customer view their OWN ticket via GET /tickets/:id (populated customer field)", async () => {
    // Regression test: GET-by-id populates the customer field (to include
    // their name/email in the response), which is a DIFFERENT code path
    // than list/create. A prior bug compared the populated User object
    // against user.userId with .toString() and always failed, locking
    // every customer out of their own ticket detail page.
    const { token } = await registerAndLogin("CUSTOMER", "viewowncust");
    const created = await request(app)
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Can I see my own ticket?", description: "This should be visible to its owner", category: "Other", priority: "LOW" });
    const ticketId = created.body.data.ticket._id;

    const res = await request(app).get(`/api/v1/tickets/${ticketId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ticket._id).toBe(ticketId);
    // Triaging is staff-only, so a customer viewing their own OPEN ticket
    // is correctly offered no status-change buttons at all.
    expect(res.body.data.ticket.allowedNextStatuses).toEqual([]);
  });

  it("blocks a customer from creating a ticket as another customer's - a customer cannot see others' tickets", async () => {
    const a = await registerAndLogin("CUSTOMER", "custA");
    const b = await registerAndLogin("CUSTOMER", "custB");

    const created = await request(app)
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ title: "A's private ticket", description: "Only A should see this", category: "Technical", priority: "LOW" });
    const ticketId = created.body.data.ticket._id;

    const bTriesToView = await request(app).get(`/api/v1/tickets/${ticketId}`).set("Authorization", `Bearer ${b.token}`);
    expect(bTriesToView.status).toBe(403);
    expect(bTriesToView.body.error.code).toBe("FORBIDDEN");
  });

  it("walks a ticket through the full legal path, and rejects skipping a step along the way", async () => {
    const customer = await registerAndLogin("CUSTOMER", "flowcust");
    const agent = await registerAndLogin("AGENT", "flowagent");

    const created = await request(app)
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ title: "Login page is broken", description: "Cannot log in since this morning", category: "Technical", priority: "HIGH" });
    const ticketId = created.body.data.ticket._id;

    // The spec's own example: OPEN straight to RESOLVED must be rejected.
    const skipAttempt = await request(app)
      .patch(`/api/v1/tickets/${ticketId}/status`)
      .set("Authorization", `Bearer ${agent.token}`)
      .send({ status: "RESOLVED" });
    expect(skipAttempt.status).toBe(400);
    expect(skipAttempt.body.error.code).toBe("INVALID_STATUS_TRANSITION");

    // A customer cannot triage - staff-only action.
    const customerTriesToTriage = await request(app)
      .patch(`/api/v1/tickets/${ticketId}/status`)
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ status: "TRIAGED" });
    expect(customerTriesToTriage.status).toBe(403);

    const triaged = await request(app)
      .patch(`/api/v1/tickets/${ticketId}/status`)
      .set("Authorization", `Bearer ${agent.token}`)
      .send({ status: "TRIAGED" });
    expect(triaged.status).toBe(200);
    expect(triaged.body.data.ticket.status).toBe("TRIAGED");

    const assigned = await request(app).post(`/api/v1/tickets/${ticketId}/assign`).set("Authorization", `Bearer ${agent.token}`);
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.ticket.status).toBe("ASSIGNED");
    expect(assigned.body.data.ticket.assignedAgent._id).toBe(agent.userId);

    const inProgress = await request(app)
      .patch(`/api/v1/tickets/${ticketId}/status`)
      .set("Authorization", `Bearer ${agent.token}`)
      .send({ status: "IN_PROGRESS" });
    expect(inProgress.status).toBe(200);

    const resolved = await request(app)
      .patch(`/api/v1/tickets/${ticketId}/status`)
      .set("Authorization", `Bearer ${agent.token}`)
      .send({ status: "RESOLVED" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.ticket.resolvedAt).toBeTruthy();

    // Closing is the customer's action (per spec), and it works here.
    const closed = await request(app)
      .patch(`/api/v1/tickets/${ticketId}/status`)
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ status: "CLOSED" });
    expect(closed.status).toBe(200);
    expect(closed.body.data.ticket.status).toBe("CLOSED");
  });

  it("rejects a customer trying to assign a ticket to themselves as an agent action", async () => {
    const customer = await registerAndLogin("CUSTOMER", "assigncust");
    const created = await request(app)
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ title: "Need help", description: "Please assist with this issue", category: "Other", priority: "LOW" });
    const ticketId = created.body.data.ticket._id;

    const res = await request(app).post(`/api/v1/tickets/${ticketId}/assign`).set("Authorization", `Bearer ${customer.token}`);
    expect(res.status).toBe(403);
  });

  it("lets an agent run AI analysis on a ticket (mock fallback - no GROQ_API_KEY in test env)", async () => {
    const customer = await registerAndLogin("CUSTOMER", "aicust");
    const agent = await registerAndLogin("AGENT", "aiagent");
    const created = await request(app)
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ title: "Payment API returns 500", description: "Checkout is down for every customer.", category: "Technical", priority: "LOW" });
    const ticketId = created.body.data.ticket._id;

    const res = await request(app).post(`/api/v1/tickets/${ticketId}/ai-analyze`).set("Authorization", `Bearer ${agent.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.analysis.source).toBe("mock"); // no GROQ_API_KEY is set in the test environment, by design
    expect(res.body.data.analysis.suggestedPriority).toBe("CRITICAL"); // "returns 500" / "down" - the mock's own keyword rules
    expect(typeof res.body.data.analysis.summary).toBe("string");
    expect(typeof res.body.data.analysis.suggestedResponse).toBe("string");
  });

  it("blocks a customer from calling the staff-only AI analysis endpoint", async () => {
    const customer = await registerAndLogin("CUSTOMER", "aicust2");
    const created = await request(app)
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ title: "Need help", description: "Please assist with this issue", category: "Other", priority: "LOW" });
    const ticketId = created.body.data.ticket._id;

    const res = await request(app).post(`/api/v1/tickets/${ticketId}/ai-analyze`).set("Authorization", `Bearer ${customer.token}`);
    expect(res.status).toBe(403);
  });

  it("paginates the ticket list instead of returning everything at once", async () => {
    const customer = await registerAndLogin("CUSTOMER", "pagecust");
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/v1/tickets")
        .set("Authorization", `Bearer ${customer.token}`)
        .send({ title: `Ticket ${i}`, description: "Some description text here", category: "Other", priority: "LOW" });
    }
    const res = await request(app)
      .get("/api/v1/tickets?limit=2&page=1")
      .set("Authorization", `Bearer ${customer.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tickets.length).toBe(2);
    expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(3);
  });
});
