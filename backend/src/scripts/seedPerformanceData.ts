// Run manually with: npm run seed:perf
// Generates a large, realistic dataset (10,000+ tickets across a handful of
// customers/agents) so we can actually MEASURE query performance instead of
// guessing - an index either helps at this scale or it doesn't, and you
// can't tell the difference on 20 hand-created demo tickets.
import { connectDB } from "../config/db";
import { seedDefaults } from "../config/seed";
import { User } from "../models/User";
import { Ticket } from "../models/Ticket";
import { Category } from "../models/Category";
import { nextSequence } from "../models/Counter";
import { getSlaMinutesForPriority, addMinutes } from "../services/slaService";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "../models/Ticket";

const TICKET_COUNT = 10_000;
const CUSTOMER_COUNT = 200;
const AGENT_COUNT = 15;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  await connectDB();
  await seedDefaults();

  console.log("Seeding demo users…");
  const passwordHash = await bcrypt.hash("PerfTestPass123!", 4); // low cost factor - this is throwaway perf data, not real accounts

  const customerIds: mongoose.Types.ObjectId[] = [];
  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const u = await User.create({ name: `Perf Customer ${i}`, email: `perf-customer-${i}@test.local`, passwordHash, role: "CUSTOMER" });
    customerIds.push(u._id);
  }
  const agentIds: mongoose.Types.ObjectId[] = [];
  for (let i = 0; i < AGENT_COUNT; i++) {
    const u = await User.create({ name: `Perf Agent ${i}`, email: `perf-agent-${i}@test.local`, passwordHash, role: "AGENT" });
    agentIds.push(u._id);
  }

  const categories = (await Category.find({ isActive: true })).map((c) => c.name);

  console.log(`Seeding ${TICKET_COUNT} tickets…`);
  const BATCH_SIZE = 1000;
  let batch: Record<string, unknown>[] = [];

  for (let i = 0; i < TICKET_COUNT; i++) {
    const priority = pick(TICKET_PRIORITIES);
    const status = pick(TICKET_STATUSES);
    const { responseMinutes, resolutionMinutes } = await getSlaMinutesForPriority(priority);
    const createdAt = new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000); // spread over the last 90 days
    const seq = await nextSequence("ticket");

    batch.push({
      ticketNumber: `TCK-${String(seq).padStart(6, "0")}`,
      title: `Perf test ticket #${i}`,
      description: "Auto-generated ticket for performance/load testing.",
      category: pick(categories),
      priority,
      status,
      tags: [],
      customer: pick(customerIds),
      assignedAgent: status === "OPEN" || status === "TRIAGED" ? null : pick(agentIds),
      responseDeadline: addMinutes(createdAt, responseMinutes),
      resolutionDeadline: addMinutes(createdAt, resolutionMinutes),
      firstResponseAt: null,
      resolvedAt: status === "RESOLVED" || status === "CLOSED" ? createdAt : null,
      createdAt,
      updatedAt: createdAt,
    });

    if (batch.length >= BATCH_SIZE) {
      await Ticket.insertMany(batch, { ordered: false });
      batch = [];
      process.stdout.write(`\r  ${i + 1}/${TICKET_COUNT}`);
    }
  }
  if (batch.length) await Ticket.insertMany(batch, { ordered: false });

  console.log(`\nDone. Total tickets in DB: ${await Ticket.countDocuments()}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Perf seed failed:", err);
  process.exit(1);
});
