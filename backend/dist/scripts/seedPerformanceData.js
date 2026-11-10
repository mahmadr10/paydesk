"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Run manually with: npm run seed:perf
// Generates a large, realistic dataset (10,000+ tickets across a handful of
// customers/agents) so we can actually MEASURE query performance instead of
// guessing - an index either helps at this scale or it doesn't, and you
// can't tell the difference on 20 hand-created demo tickets.
const db_1 = require("../config/db");
const seed_1 = require("../config/seed");
const User_1 = require("../models/User");
const Ticket_1 = require("../models/Ticket");
const Category_1 = require("../models/Category");
const Counter_1 = require("../models/Counter");
const slaService_1 = require("../services/slaService");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const mongoose_1 = __importDefault(require("mongoose"));
const Ticket_2 = require("../models/Ticket");
const TICKET_COUNT = 10_000;
const CUSTOMER_COUNT = 200;
const AGENT_COUNT = 15;
function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
async function main() {
    await (0, db_1.connectDB)();
    await (0, seed_1.seedDefaults)();
    console.log("Seeding demo users…");
    const passwordHash = await bcryptjs_1.default.hash("PerfTestPass123!", 4); // low cost factor - this is throwaway perf data, not real accounts
    const customerIds = [];
    for (let i = 0; i < CUSTOMER_COUNT; i++) {
        const u = await User_1.User.create({ name: `Perf Customer ${i}`, email: `perf-customer-${i}@test.local`, passwordHash, role: "CUSTOMER" });
        customerIds.push(u._id);
    }
    const agentIds = [];
    for (let i = 0; i < AGENT_COUNT; i++) {
        const u = await User_1.User.create({ name: `Perf Agent ${i}`, email: `perf-agent-${i}@test.local`, passwordHash, role: "AGENT" });
        agentIds.push(u._id);
    }
    const categories = (await Category_1.Category.find({ isActive: true })).map((c) => c.name);
    console.log(`Seeding ${TICKET_COUNT} tickets…`);
    const BATCH_SIZE = 1000;
    let batch = [];
    for (let i = 0; i < TICKET_COUNT; i++) {
        const priority = pick(Ticket_2.TICKET_PRIORITIES);
        const status = pick(Ticket_2.TICKET_STATUSES);
        const { responseMinutes, resolutionMinutes } = await (0, slaService_1.getSlaMinutesForPriority)(priority);
        const createdAt = new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000); // spread over the last 90 days
        const seq = await (0, Counter_1.nextSequence)("ticket");
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
            responseDeadline: (0, slaService_1.addMinutes)(createdAt, responseMinutes),
            resolutionDeadline: (0, slaService_1.addMinutes)(createdAt, resolutionMinutes),
            firstResponseAt: null,
            resolvedAt: status === "RESOLVED" || status === "CLOSED" ? createdAt : null,
            createdAt,
            updatedAt: createdAt,
        });
        if (batch.length >= BATCH_SIZE) {
            await Ticket_1.Ticket.insertMany(batch, { ordered: false });
            batch = [];
            process.stdout.write(`\r  ${i + 1}/${TICKET_COUNT}`);
        }
    }
    if (batch.length)
        await Ticket_1.Ticket.insertMany(batch, { ordered: false });
    console.log(`\nDone. Total tickets in DB: ${await Ticket_1.Ticket.countDocuments()}`);
    await mongoose_1.default.disconnect();
}
main().catch((err) => {
    console.error("Perf seed failed:", err);
    process.exit(1);
});
