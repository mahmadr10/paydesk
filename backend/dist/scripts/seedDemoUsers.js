"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Run manually with: npm run seed:users
// Creates one demo account per role, ONLY if that email doesn't already
// exist - safe to run more than once. This is a deliberate, explicit step
// (not automatic on every boot, unlike config/seed.ts) because it creates
// login credentials, and printing/creating those automatically on every
// server start would be a bad habit even for a demo.
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../config/db");
const User_1 = require("../models/User");
const mongoose_1 = __importDefault(require("mongoose"));
const DEMO_USERS = [
    { name: "Demo Admin", email: "admin@demo.servicedesk", password: "AdminPass123!", role: "ADMIN" },
    { name: "Demo Agent", email: "agent@demo.servicedesk", password: "AgentPass123!", role: "AGENT" },
    { name: "Demo Customer", email: "customer@demo.servicedesk", password: "CustomerPass123!", role: "CUSTOMER" },
];
async function main() {
    await (0, db_1.connectDB)();
    for (const demo of DEMO_USERS) {
        const existing = await User_1.User.findOne({ email: demo.email });
        if (existing) {
            console.log(`- ${demo.email} already exists, skipping`);
            continue;
        }
        const passwordHash = await bcryptjs_1.default.hash(demo.password, 10);
        await User_1.User.create({ name: demo.name, email: demo.email, passwordHash, role: demo.role });
        console.log(`✅ Created ${demo.role}: ${demo.email} / ${demo.password}`);
    }
    await mongoose_1.default.disconnect();
}
main().catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
});
