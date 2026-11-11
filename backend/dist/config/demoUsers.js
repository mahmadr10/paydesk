"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEMO_USERS = exports.DEMO_PASSWORD = void 0;
exports.seedDemoUsers = seedDemoUsers;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const User_1 = require("../models/User");
const logger_1 = require("../observability/logger");
// Demo accounts for LOCAL development: a buyer, a seller and an admin, so you
// can try every side of the app without signing up each time. They only get
// created when DEMO_MODE=true (see config/seed.ts) or when
// `npm run seed:users` is run by hand.
//
// The password is public (it is in this file), so never enable DEMO_MODE on a
// public deployment.
exports.DEMO_PASSWORD = "DemoPass123!";
exports.DEMO_USERS = [
    { name: "Ali Buyer", email: "buyer@paydesk.test", role: "CUSTOMER" },
    { name: "Sara Seller", email: "seller@paydesk.test", role: "AGENT" },
    { name: "Demo Admin", email: "admin@paydesk.test", role: "ADMIN" },
];
// Creates whichever demo accounts are missing. Safe to call on every cold
// start: it only reads when everything already exists. Returns how many it made.
async function seedDemoUsers() {
    const existing = await User_1.User.find({ email: { $in: exports.DEMO_USERS.map((u) => u.email) } }).select("email");
    const have = new Set(existing.map((u) => u.email));
    const missing = exports.DEMO_USERS.filter((u) => !have.has(u.email));
    if (missing.length === 0)
        return 0;
    const passwordHash = await bcryptjs_1.default.hash(exports.DEMO_PASSWORD, 10);
    let created = 0;
    for (const u of missing) {
        try {
            await User_1.User.create({ ...u, passwordHash });
            created++;
        }
        catch (err) {
            // Two cold starts can race; the loser just hits the unique email index.
            if (err?.code !== 11000)
                throw err;
        }
    }
    if (created > 0)
        logger_1.logger.info(`Created ${created} demo account(s)`);
    return created;
}
