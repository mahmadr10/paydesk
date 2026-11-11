// Run manually with: npm run seed:users
// Creates the demo accounts (buyer, seller, admin) if they don't exist yet.
// Safe to run more than once. The same accounts are created automatically on
// startup when DEMO_MODE=true (see config/seed.ts).
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { DEMO_PASSWORD, DEMO_USERS, seedDemoUsers } from "../config/demoUsers";

async function main() {
  await connectDB();
  const created = await seedDemoUsers();
  console.log(created > 0 ? `Created ${created} demo account(s).` : "Demo accounts already exist.");
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(8)} ${u.email} / ${DEMO_PASSWORD}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
