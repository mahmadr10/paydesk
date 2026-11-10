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
// Integration tests exercise the REAL HTTP layer (Supertest drives the
// actual Express app - routes, middleware, validation, controllers,
// services, and a real MongoDB, all wired together) rather than calling
// service functions directly. This is what catches bugs unit tests can't:
// wrong route paths, a validator that doesn't match its controller, a role
// check that's missing on one specific route.
const app = (0, app_1.createApp)();
(0, vitest_1.beforeAll)(async () => {
    await (0, db_1.connectDB)();
    await (0, seed_1.seedDefaults)();
});
(0, vitest_1.afterAll)(async () => {
    await mongoose_1.default.connection.dropDatabase();
    await mongoose_1.default.disconnect();
});
async function registerAndLogin(role, emailPrefix) {
    const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
    const res = await (0, supertest_1.default)(app)
        .post("/api/v1/auth/register")
        .send({ name: `Test ${role}`, email, password: "TestPass123!", role });
    return { token: res.body.data.accessToken, userId: res.body.data.user._id, email };
}
(0, vitest_1.describe)("Auth", () => {
    (0, vitest_1.it)("registers a new customer and returns an access token + user", async () => {
        const res = await (0, supertest_1.default)(app)
            .post("/api/v1/auth/register")
            .send({ name: "Alice", email: `alice-${Date.now()}@test.local`, password: "TestPass123!", role: "CUSTOMER" });
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.success).toBe(true);
        (0, vitest_1.expect)(res.body.data.accessToken).toBeTruthy();
        (0, vitest_1.expect)(res.body.data.user.role).toBe("CUSTOMER");
        // The password hash must never be sent to the client.
        (0, vitest_1.expect)(res.body.data.user.passwordHash).toBeUndefined();
    });
    (0, vitest_1.it)("rejects registering the same email twice", async () => {
        const email = `dup-${Date.now()}@test.local`;
        await (0, supertest_1.default)(app).post("/api/v1/auth/register").send({ name: "Alice A", email, password: "TestPass123!", role: "CUSTOMER" });
        const second = await (0, supertest_1.default)(app)
            .post("/api/v1/auth/register")
            .send({ name: "Bob B", email, password: "TestPass123!", role: "CUSTOMER" });
        (0, vitest_1.expect)(second.status).toBe(409);
        (0, vitest_1.expect)(second.body.error.code).toBe("EMAIL_IN_USE");
    });
    (0, vitest_1.it)("rejects a weak password with a validation error, not a raw stack trace", async () => {
        const res = await (0, supertest_1.default)(app)
            .post("/api/v1/auth/register")
            .send({ name: "Alice A", email: `weak-${Date.now()}@test.local`, password: "123", role: "CUSTOMER" });
        (0, vitest_1.expect)(res.status).toBe(400);
        (0, vitest_1.expect)(res.body.error.code).toBe("VALIDATION_ERROR");
        (0, vitest_1.expect)(res.body.error.message).not.toMatch(/at\s+.*\(.*:\d+:\d+\)/); // no stack-trace-looking text
    });
    (0, vitest_1.it)("cannot self-register as ADMIN", async () => {
        const res = await (0, supertest_1.default)(app)
            .post("/api/v1/auth/register")
            .send({ name: "Alice A", email: `admin-try-${Date.now()}@test.local`, password: "TestPass123!", role: "ADMIN" });
        (0, vitest_1.expect)(res.status).toBe(400);
    });
    (0, vitest_1.it)("rejects login with the wrong password using the same error as a nonexistent email", async () => {
        const email = `login-${Date.now()}@test.local`;
        await (0, supertest_1.default)(app).post("/api/v1/auth/register").send({ name: "Alice A", email, password: "TestPass123!", role: "CUSTOMER" });
        const wrongPassword = await (0, supertest_1.default)(app).post("/api/v1/auth/login").send({ email, password: "WrongPass123!" });
        const noSuchEmail = await (0, supertest_1.default)(app)
            .post("/api/v1/auth/login")
            .send({ email: "nobody@test.local", password: "WrongPass123!" });
        (0, vitest_1.expect)(wrongPassword.status).toBe(401);
        (0, vitest_1.expect)(noSuchEmail.status).toBe(401);
        (0, vitest_1.expect)(wrongPassword.body.error.code).toBe(noSuchEmail.body.error.code);
    });
    (0, vitest_1.it)("rejects an unauthenticated request to a protected route", async () => {
        const res = await (0, supertest_1.default)(app).get("/api/v1/auth/me");
        (0, vitest_1.expect)(res.status).toBe(401);
        (0, vitest_1.expect)(res.body.error.code).toBe("UNAUTHORIZED");
    });
});
(0, vitest_1.describe)("Tickets: creation, retrieval, assignment, status transitions", () => {
    (0, vitest_1.it)("lets a customer create a ticket with computed SLA deadlines", async () => {
        const { token } = await registerAndLogin("CUSTOMER", "cust");
        const res = await (0, supertest_1.default)(app)
            .post("/api/v1/tickets")
            .set("Authorization", `Bearer ${token}`)
            .send({ title: "Payment API returns 500", description: "Started failing at 10am today", category: "Technical", priority: "CRITICAL" });
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.data.ticket.status).toBe("OPEN");
        (0, vitest_1.expect)(res.body.data.ticket.ticketNumber).toMatch(/^TCK-\d{6}$/);
        (0, vitest_1.expect)(res.body.data.ticket.sla).toBeDefined();
        (0, vitest_1.expect)(new Date(res.body.data.ticket.responseDeadline).getTime()).toBeGreaterThan(Date.now());
    });
    (0, vitest_1.it)("rejects ticket creation with an unknown category", async () => {
        const { token } = await registerAndLogin("CUSTOMER", "cust");
        const res = await (0, supertest_1.default)(app)
            .post("/api/v1/tickets")
            .set("Authorization", `Bearer ${token}`)
            .send({ title: "Something broke", description: "Details here please", category: "NotARealCategory", priority: "LOW" });
        (0, vitest_1.expect)(res.status).toBe(400);
        (0, vitest_1.expect)(res.body.error.code).toBe("INVALID_CATEGORY");
    });
    (0, vitest_1.it)("lets a customer view their OWN ticket via GET /tickets/:id (populated customer field)", async () => {
        // Regression test: GET-by-id populates the customer field (to include
        // their name/email in the response), which is a DIFFERENT code path
        // than list/create. A prior bug compared the populated User object
        // against user.userId with .toString() and always failed, locking
        // every customer out of their own ticket detail page.
        const { token } = await registerAndLogin("CUSTOMER", "viewowncust");
        const created = await (0, supertest_1.default)(app)
            .post("/api/v1/tickets")
            .set("Authorization", `Bearer ${token}`)
            .send({ title: "Can I see my own ticket?", description: "This should be visible to its owner", category: "Other", priority: "LOW" });
        const ticketId = created.body.data.ticket._id;
        const res = await (0, supertest_1.default)(app).get(`/api/v1/tickets/${ticketId}`).set("Authorization", `Bearer ${token}`);
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.data.ticket._id).toBe(ticketId);
        // Triaging is staff-only, so a customer viewing their own OPEN ticket
        // is correctly offered no status-change buttons at all.
        (0, vitest_1.expect)(res.body.data.ticket.allowedNextStatuses).toEqual([]);
    });
    (0, vitest_1.it)("blocks a customer from creating a ticket as another customer's - a customer cannot see others' tickets", async () => {
        const a = await registerAndLogin("CUSTOMER", "custA");
        const b = await registerAndLogin("CUSTOMER", "custB");
        const created = await (0, supertest_1.default)(app)
            .post("/api/v1/tickets")
            .set("Authorization", `Bearer ${a.token}`)
            .send({ title: "A's private ticket", description: "Only A should see this", category: "Technical", priority: "LOW" });
        const ticketId = created.body.data.ticket._id;
        const bTriesToView = await (0, supertest_1.default)(app).get(`/api/v1/tickets/${ticketId}`).set("Authorization", `Bearer ${b.token}`);
        (0, vitest_1.expect)(bTriesToView.status).toBe(403);
        (0, vitest_1.expect)(bTriesToView.body.error.code).toBe("FORBIDDEN");
    });
    (0, vitest_1.it)("walks a ticket through the full legal path, and rejects skipping a step along the way", async () => {
        const customer = await registerAndLogin("CUSTOMER", "flowcust");
        const agent = await registerAndLogin("AGENT", "flowagent");
        const created = await (0, supertest_1.default)(app)
            .post("/api/v1/tickets")
            .set("Authorization", `Bearer ${customer.token}`)
            .send({ title: "Login page is broken", description: "Cannot log in since this morning", category: "Technical", priority: "HIGH" });
        const ticketId = created.body.data.ticket._id;
        // The spec's own example: OPEN straight to RESOLVED must be rejected.
        const skipAttempt = await (0, supertest_1.default)(app)
            .patch(`/api/v1/tickets/${ticketId}/status`)
            .set("Authorization", `Bearer ${agent.token}`)
            .send({ status: "RESOLVED" });
        (0, vitest_1.expect)(skipAttempt.status).toBe(400);
        (0, vitest_1.expect)(skipAttempt.body.error.code).toBe("INVALID_STATUS_TRANSITION");
        // A customer cannot triage - staff-only action.
        const customerTriesToTriage = await (0, supertest_1.default)(app)
            .patch(`/api/v1/tickets/${ticketId}/status`)
            .set("Authorization", `Bearer ${customer.token}`)
            .send({ status: "TRIAGED" });
        (0, vitest_1.expect)(customerTriesToTriage.status).toBe(403);
        const triaged = await (0, supertest_1.default)(app)
            .patch(`/api/v1/tickets/${ticketId}/status`)
            .set("Authorization", `Bearer ${agent.token}`)
            .send({ status: "TRIAGED" });
        (0, vitest_1.expect)(triaged.status).toBe(200);
        (0, vitest_1.expect)(triaged.body.data.ticket.status).toBe("TRIAGED");
        const assigned = await (0, supertest_1.default)(app).post(`/api/v1/tickets/${ticketId}/assign`).set("Authorization", `Bearer ${agent.token}`);
        (0, vitest_1.expect)(assigned.status).toBe(200);
        (0, vitest_1.expect)(assigned.body.data.ticket.status).toBe("ASSIGNED");
        (0, vitest_1.expect)(assigned.body.data.ticket.assignedAgent._id).toBe(agent.userId);
        const inProgress = await (0, supertest_1.default)(app)
            .patch(`/api/v1/tickets/${ticketId}/status`)
            .set("Authorization", `Bearer ${agent.token}`)
            .send({ status: "IN_PROGRESS" });
        (0, vitest_1.expect)(inProgress.status).toBe(200);
        const resolved = await (0, supertest_1.default)(app)
            .patch(`/api/v1/tickets/${ticketId}/status`)
            .set("Authorization", `Bearer ${agent.token}`)
            .send({ status: "RESOLVED" });
        (0, vitest_1.expect)(resolved.status).toBe(200);
        (0, vitest_1.expect)(resolved.body.data.ticket.resolvedAt).toBeTruthy();
        // Closing is the customer's action (per spec), and it works here.
        const closed = await (0, supertest_1.default)(app)
            .patch(`/api/v1/tickets/${ticketId}/status`)
            .set("Authorization", `Bearer ${customer.token}`)
            .send({ status: "CLOSED" });
        (0, vitest_1.expect)(closed.status).toBe(200);
        (0, vitest_1.expect)(closed.body.data.ticket.status).toBe("CLOSED");
    });
    (0, vitest_1.it)("rejects a customer trying to assign a ticket to themselves as an agent action", async () => {
        const customer = await registerAndLogin("CUSTOMER", "assigncust");
        const created = await (0, supertest_1.default)(app)
            .post("/api/v1/tickets")
            .set("Authorization", `Bearer ${customer.token}`)
            .send({ title: "Need help", description: "Please assist with this issue", category: "Other", priority: "LOW" });
        const ticketId = created.body.data.ticket._id;
        const res = await (0, supertest_1.default)(app).post(`/api/v1/tickets/${ticketId}/assign`).set("Authorization", `Bearer ${customer.token}`);
        (0, vitest_1.expect)(res.status).toBe(403);
    });
    (0, vitest_1.it)("lets an agent run AI analysis on a ticket (mock fallback - no GROQ_API_KEY in test env)", async () => {
        const customer = await registerAndLogin("CUSTOMER", "aicust");
        const agent = await registerAndLogin("AGENT", "aiagent");
        const created = await (0, supertest_1.default)(app)
            .post("/api/v1/tickets")
            .set("Authorization", `Bearer ${customer.token}`)
            .send({ title: "Payment API returns 500", description: "Checkout is down for every customer.", category: "Technical", priority: "LOW" });
        const ticketId = created.body.data.ticket._id;
        const res = await (0, supertest_1.default)(app).post(`/api/v1/tickets/${ticketId}/ai-analyze`).set("Authorization", `Bearer ${agent.token}`);
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.data.analysis.source).toBe("mock"); // no GROQ_API_KEY is set in the test environment, by design
        (0, vitest_1.expect)(res.body.data.analysis.suggestedPriority).toBe("CRITICAL"); // "returns 500" / "down" - the mock's own keyword rules
        (0, vitest_1.expect)(typeof res.body.data.analysis.summary).toBe("string");
        (0, vitest_1.expect)(typeof res.body.data.analysis.suggestedResponse).toBe("string");
    });
    (0, vitest_1.it)("blocks a customer from calling the staff-only AI analysis endpoint", async () => {
        const customer = await registerAndLogin("CUSTOMER", "aicust2");
        const created = await (0, supertest_1.default)(app)
            .post("/api/v1/tickets")
            .set("Authorization", `Bearer ${customer.token}`)
            .send({ title: "Need help", description: "Please assist with this issue", category: "Other", priority: "LOW" });
        const ticketId = created.body.data.ticket._id;
        const res = await (0, supertest_1.default)(app).post(`/api/v1/tickets/${ticketId}/ai-analyze`).set("Authorization", `Bearer ${customer.token}`);
        (0, vitest_1.expect)(res.status).toBe(403);
    });
    (0, vitest_1.it)("paginates the ticket list instead of returning everything at once", async () => {
        const customer = await registerAndLogin("CUSTOMER", "pagecust");
        for (let i = 0; i < 3; i++) {
            await (0, supertest_1.default)(app)
                .post("/api/v1/tickets")
                .set("Authorization", `Bearer ${customer.token}`)
                .send({ title: `Ticket ${i}`, description: "Some description text here", category: "Other", priority: "LOW" });
        }
        const res = await (0, supertest_1.default)(app)
            .get("/api/v1/tickets?limit=2&page=1")
            .set("Authorization", `Bearer ${customer.token}`);
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.data.tickets.length).toBe(2);
        (0, vitest_1.expect)(res.body.data.pagination.total).toBeGreaterThanOrEqual(3);
    });
});
