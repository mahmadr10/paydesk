"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Run manually with: npm run seed:users
// Creates the demo accounts (buyer, seller, admin) if they don't exist yet.
// Safe to run more than once. The same accounts are created automatically on
// startup when DEMO_MODE=true (see config/seed.ts).
const mongoose_1 = __importDefault(require("mongoose"));
const db_1 = require("../config/db");
const demoUsers_1 = require("../config/demoUsers");
async function main() {
    await (0, db_1.connectDB)();
    const created = await (0, demoUsers_1.seedDemoUsers)();
    console.log(created > 0 ? `Created ${created} demo account(s).` : "Demo accounts already exist.");
    for (const u of demoUsers_1.DEMO_USERS)
        console.log(`  ${u.role.padEnd(8)} ${u.email} / ${demoUsers_1.DEMO_PASSWORD}`);
    await mongoose_1.default.disconnect();
}
main().catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
});
