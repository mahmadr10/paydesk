// Run manually with: npm run seed:users
// Creates one demo account per role, ONLY if that email doesn't already
// exist - safe to run more than once. This is a deliberate, explicit step
// (not automatic on every boot, unlike config/seed.ts) because it creates
// login credentials, and printing/creating those automatically on every
// server start would be a bad habit even for a demo.
import bcrypt from "bcryptjs";
import { connectDB } from "../config/db";
import { User } from "../models/User";
import mongoose from "mongoose";

const DEMO_USERS = [
  { name: "Demo Admin", email: "admin@demo.servicedesk", password: "AdminPass123!", role: "ADMIN" as const },
  { name: "Demo Agent", email: "agent@demo.servicedesk", password: "AgentPass123!", role: "AGENT" as const },
  { name: "Demo Customer", email: "customer@demo.servicedesk", password: "CustomerPass123!", role: "CUSTOMER" as const },
];

async function main() {
  await connectDB();

  for (const demo of DEMO_USERS) {
    const existing = await User.findOne({ email: demo.email });
    if (existing) {
      console.log(`- ${demo.email} already exists, skipping`);
      continue;
    }
    const passwordHash = await bcrypt.hash(demo.password, 10);
    await User.create({ name: demo.name, email: demo.email, passwordHash, role: demo.role });
    console.log(`✅ Created ${demo.role}: ${demo.email} / ${demo.password}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
