import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { seedDefaults } from "../config/seed";
import { User } from "../models/User";
import { Ticket } from "../models/Ticket";
import { Notification } from "../models/Notification";
import { checkSlaBreaches } from "./slaBreachJob";

// Exercises the REAL job function against a REAL (in-memory) database - not
// just its shape - because the interesting bugs here are query-level ones
// ("did this actually find the breached ticket," "did it actually skip an
// already-notified one"), which a pure unit test with a mocked Ticket model
// wouldn't catch.
describe("slaBreachJob: checkSlaBreaches", () => {
  beforeAll(async () => {
    await connectDB();
    await seedDefaults();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it("notifies the assigned agent once for a newly-breached, unresolved ticket", async () => {
    const customer = await User.create({ name: "SLA Test Customer", email: `sla-cust-${Date.now()}@test.local`, passwordHash: "x", role: "CUSTOMER" });
    const agent = await User.create({ name: "SLA Test Agent", email: `sla-agent-${Date.now()}@test.local`, passwordHash: "x", role: "AGENT" });

    const now = new Date();
    const ticket = await Ticket.create({
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

    const result = await checkSlaBreaches();
    expect(result.resolutionBreaches).toBeGreaterThanOrEqual(1);

    const updated = await Ticket.findById(ticket._id);
    expect(updated?.resolutionBreachNotified).toBe(true);

    const notification = await Notification.findOne({ ticket: ticket._id, type: "SLA_BREACH_RESOLUTION" });
    expect(notification).not.toBeNull();
    expect(notification?.user.toString()).toBe(agent._id.toString());
    expect(notification?.read).toBe(false);

    // Second run must NOT re-notify - the whole point of the *Notified flag.
    const countBefore = await Notification.countDocuments({ ticket: ticket._id });
    await checkSlaBreaches();
    const countAfter = await Notification.countDocuments({ ticket: ticket._id });
    expect(countAfter).toBe(countBefore);
  });

  it("does not flag a ticket whose deadline hasn't passed yet", async () => {
    const customer = await User.create({ name: "SLA Test Customer 2", email: `sla-cust2-${Date.now()}@test.local`, passwordHash: "x", role: "CUSTOMER" });
    const now = new Date();
    const ticket = await Ticket.create({
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

    await checkSlaBreaches();
    const updated = await Ticket.findById(ticket._id);
    expect(updated?.responseBreachNotified).toBe(false);
    expect(updated?.resolutionBreachNotified).toBe(false);
  });
});
