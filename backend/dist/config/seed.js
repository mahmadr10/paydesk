"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDefaults = seedDefaults;
const Category_1 = require("../models/Category");
const SLAPolicy_1 = require("../models/SLAPolicy");
const Ticket_1 = require("../models/Ticket");
const logger_1 = require("../observability/logger");
const DEFAULT_CATEGORIES = ["Technical", "Billing", "Account", "Payment", "Other"];
let isSeeded = false;
// Ticket creation requires a category to exist and an SLA policy for its
// priority to exist - so an empty database can't create a ticket at all.
// Rather than make that a manual setup step, we seed sensible defaults
// automatically on every startup. It's idempotent (checks "does anything
// exist" first) so restarting the server never duplicates or resets data
// an admin has already customized.
async function seedDefaults() {
    if (isSeeded)
        return;
    // Clean up any rogue/legacy indexes (e.g. from previous schemas)
    try {
        const usersCol = Category_1.Category.db.collection("users");
        const indexes = await usersCol.indexes();
        for (const idx of indexes) {
            if (idx.name === "userName_1" || (idx.key && idx.key.userName)) {
                await usersCol.dropIndex(idx.name);
                logger_1.logger.info(`Dropped legacy ${idx.name} index from users collection`);
            }
        }
    }
    catch (_e) {
        // ignore
    }
    const categoryCount = await Category_1.Category.countDocuments();
    if (categoryCount === 0) {
        await Category_1.Category.insertMany(DEFAULT_CATEGORIES.map((name) => ({ name, isActive: true })));
        logger_1.logger.info(`Seeded ${DEFAULT_CATEGORIES.length} default categories`);
    }
    const policyCount = await SLAPolicy_1.SLAPolicy.countDocuments();
    if (policyCount === 0) {
        await SLAPolicy_1.SLAPolicy.insertMany(Ticket_1.TICKET_PRIORITIES.map((priority) => ({ priority, ...SLAPolicy_1.DEFAULT_SLA_POLICIES[priority] })));
        logger_1.logger.info(`Seeded ${Ticket_1.TICKET_PRIORITIES.length} default SLA policies`);
    }
    isSeeded = true;
}
