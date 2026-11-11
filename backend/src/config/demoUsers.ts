import bcrypt from "bcryptjs";
import { User, UserRole } from "../models/User";
import { logger } from "../observability/logger";

// Demo accounts for LOCAL development: a buyer, a seller and an admin, so you
// can try every side of the app without signing up each time. They only get
// created when DEMO_MODE=true (see config/seed.ts) or when
// `npm run seed:users` is run by hand.
//
// The password is public (it is in this file), so never enable DEMO_MODE on a
// public deployment.
export const DEMO_PASSWORD = "DemoPass123!";

export const DEMO_USERS: { name: string; email: string; role: UserRole }[] = [
  { name: "Ali Buyer", email: "buyer@paydesk.test", role: "CUSTOMER" },
  { name: "Sara Seller", email: "seller@paydesk.test", role: "AGENT" },
  { name: "Demo Admin", email: "admin@paydesk.test", role: "ADMIN" },
];

// Creates whichever demo accounts are missing. Safe to call on every cold
// start: it only reads when everything already exists. Returns how many it made.
export async function seedDemoUsers(): Promise<number> {
  const existing = await User.find({ email: { $in: DEMO_USERS.map((u) => u.email) } }).select("email");
  const have = new Set(existing.map((u) => u.email));
  const missing = DEMO_USERS.filter((u) => !have.has(u.email));
  if (missing.length === 0) return 0;

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  let created = 0;
  for (const u of missing) {
    try {
      await User.create({ ...u, passwordHash });
      created++;
    } catch (err) {
      // Two cold starts can race; the loser just hits the unique email index.
      if ((err as { code?: number })?.code !== 11000) throw err;
    }
  }
  if (created > 0) logger.info(`Created ${created} demo account(s)`);
  return created;
}
