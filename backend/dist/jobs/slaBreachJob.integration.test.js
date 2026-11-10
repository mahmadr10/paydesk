"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mongoose_1 = __importDefault(require("mongoose"));
const db_1 = require("../config/db");
const seed_1 = require("../config/seed");
const User_1 = require("../models/User");
const Ticket_1 = require("../models/Ticket");
const Notification_1 = require("../models/Notification");
const slaBreachJob_1 = require("./slaBreachJob");
// Exercises the REAL job function against a REAL (in-memory) database - not
// just its shape - because the interesting bugs here are query-level ones
// ("did this actually find the breached ticket," "did it actually skip an
// already-notified one"), which a pure unit test with a mocked Ticket model
// wouldn't catch.
(0, vitest_1.describe)("slaBreachJob: checkSlaBreaches", () => {
    (0, vitest_1.beforeAll)(async () => {
        await (0, db_1.connectDB)();
        await (0, seed_1.seedDefaults)();
    });
    (0, vitest_1.afterAll)(async () => {
        await mongoose_1.default.disconnect();
    });
    (0, vitest_1.it)("notifies the assigned agent once for a newly-breached, unresolved ticket", async () => {
        const customer = await User_1.User.create({ name: "SLA Test Customer", email: `sla-cust-${Date.now()}@test.local`, passwordHash: "x", role: "CUSTOMER" });
        const agent = await User_1.User.create({ name: "SLA Test Agent", email: `sla-agent-${Date.now()}@test.local`, passwordHash: "x", role: "AGENT" });
        const now = new Date();
        const ticket = await Ticket_1.Ticket.create({
            ticketNumber: `TCK-SLA-${Date.now()}`,
            title: "Backdated breach test ticket",
            description: "This ticket's resolution deadline is already in the past.",
            category: "Other",
            priority: "HIGH",
            status: "IN_PROGRESS",
            customer: customer._id,
            assignedAgent: agent._id,
            responseDeadline: new Date(now.getTime() - 2 * 60 * 60 * 1000),
            resolutionDeadline: new Date(now.getTime() - 60 * 1000), // 1 minute ago - already breached
            firstResponseAt: new Date(now.getTime() - 90 * 60 * 1000), // already responded, so only resolution breaches
            resolvedAt: null,
        });
        const result = await (0, slaBreachJob_1.checkSlaBreaches)();
        (0, vitest_1.expect)(result.resolutionBreaches).toBeGreaterThanOrEqual(1);
        const updated = await Ticket_1.Ticket.findById(ticket._id);
        (0, vitest_1.expect)(updated?.resolutionBreachNotified).toBe(true);
        const notification = await Notification_1.Notification.findOne({ ticket: ticket._id, type: "SLA_BREACH_RESOLUTION" });
        (0, vitest_1.expect)(notification).not.toBeNull();
        (0, vitest_1.expect)(notification?.user.toString()).toBe(agent._id.toString());
        (0, vitest_1.expect)(notification?.read).toBe(false);
        // Second run must NOT re-notify - the whole point of the *Notified flag.
        const countBefore = await Notification_1.Notification.countDocuments({ ticket: ticket._id });
        await (0, slaBreachJob_1.checkSlaBreaches)();
        const countAfter = await Notification_1.Notification.countDocuments({ ticket: ticket._id });
        (0, vitest_1.expect)(countAfter).toBe(countBefore);
    });
    (0, vitest_1.it)("does not flag a ticket whose deadline hasn't passed yet", async () => {
        const customer = await User_1.User.create({ name: "SLA Test Customer 2", email: `sla-cust2-${Date.now()}@test.local`, passwordHash: "x", role: "CUSTOMER" });
        const now = new Date();
        const ticket = await Ticket_1.Ticket.create({
            ticketNumber: `TCK-SLA2-${Date.now()}`,
            title: "Not yet breached",
            description: "This ticket's deadlines are both in the future.",
            category: "Other",
            priority: "LOW",
            status: "OPEN",
            customer: customer._id,
            assignedAgent: null,
            responseDeadline: new Date(now.getTime() + 60 * 60 * 1000),
            resolutionDeadline: new Date(now.getTime() + 8 * 60 * 60 * 1000),
            firstResponseAt: null,
            resolvedAt: null,
        });
        await (0, slaBreachJob_1.checkSlaBreaches)();
        const updated = await Ticket_1.Ticket.findById(ticket._id);
        (0, vitest_1.expect)(updated?.responseBreachNotified).toBe(false);
        (0, vitest_1.expect)(updated?.resolutionBreachNotified).toBe(false);
    });
});
