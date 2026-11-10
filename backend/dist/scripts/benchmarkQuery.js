"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Run manually with: npm run seed:perf   (first, to generate data)
//                    npm run benchmark   (then, to measure)
//
// Demonstrates ONE concrete query optimization with real numbers, not a
// claim. The query: an agent's filtered, sorted, paginated ticket queue -
// "assigned to me, status = IN_PROGRESS, newest first" - exactly what
// GET /api/v1/tickets does for the Ticket Queue page.
const mongoose_1 = __importDefault(require("mongoose"));
const db_1 = require("../config/db");
const Ticket_1 = require("../models/Ticket");
const User_1 = require("../models/User");
async function explainQuery(label) {
    const agent = await User_1.User.findOne({ role: "AGENT" });
    if (!agent)
        throw new Error("No agent found - run `npm run seed:perf` first.");
    const query = { assignedAgent: agent._id, status: "IN_PROGRESS" };
    const start = Date.now();
    const explanation = await Ticket_1.Ticket.find(query)
        .sort({ createdAt: -1 })
        .limit(10)
        .explain("executionStats");
    const wallClockMs = Date.now() - start;
    const stats = explanation.executionStats;
    // The plan is a TREE (e.g. SORT -> FETCH -> IXSCAN, or SORT -> COLLSCAN)
    // - the top-level stage is usually just "SORT" regardless of what's
    // underneath, so we walk down to find the actual scan stage that
    // determines whether an index was used.
    let node = stats.executionStages;
    const stagesSeen = [];
    while (node) {
        stagesSeen.push(node.stage);
        node = node.inputStage;
    }
    const usedIndex = stagesSeen.includes("IXSCAN");
    console.log(`\n── ${label} ──`);
    console.log(`  Wall clock:          ${wallClockMs} ms`);
    console.log(`  Execution time:      ${stats.executionTimeMillis} ms`);
    console.log(`  Documents examined:  ${stats.totalDocsExamined}`);
    console.log(`  Documents returned:  ${stats.nReturned}`);
    console.log(`  Plan stages:         ${stagesSeen.join(" -> ")}`);
    console.log(`  Used index?          ${usedIndex ? "YES (IXSCAN)" : "NO (COLLSCAN - full collection scan)"}`);
}
async function main() {
    await (0, db_1.connectDB)();
    const total = await Ticket_1.Ticket.countDocuments();
    console.log(`Total tickets in collection: ${total}`);
    if (total < 5000) {
        console.log("⚠ For a meaningful measurement, run `npm run seed:perf` first (10,000 tickets).");
    }
    // ── BEFORE: drop the compound index, forcing MongoDB to fall back to a
    // full collection scan - examining every single document to find the
    // ones matching assignedAgent+status, then sorting the results in memory.
    // We look the index up by its KEY PATTERN rather than guessing its
    // auto-generated name string, so this doesn't silently no-op if Mongoose
    // ever names it differently.
    const indexes = await Ticket_1.Ticket.collection.indexes();
    const targetIndex = indexes.find((idx) => JSON.stringify(idx.key) === JSON.stringify({ assignedAgent: 1, status: 1, createdAt: -1 }));
    if (targetIndex?.name) {
        await Ticket_1.Ticket.collection.dropIndex(targetIndex.name);
    }
    else {
        console.log("(index not found - already absent)");
    }
    await explainQuery("BEFORE (no compound index)");
    // ── AFTER: recreate the index. Mongoose's schema already declares it
    // (models/Ticket.ts) - this just re-syncs the actual DB indexes to match
    // the schema, same as what happens automatically on a normal app boot.
    await Ticket_1.Ticket.syncIndexes();
    await explainQuery("AFTER (compound index restored)");
    await mongoose_1.default.disconnect();
}
main().catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(1);
});
