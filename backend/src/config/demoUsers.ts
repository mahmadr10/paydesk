import bcrypt from "bcryptjs";
import { User, UserRole } from "../models/User";
import { logger } from "../observability/logger";

// The demo accounts behind the one-click buttons on the login page.
// They exist so anyone (a hackathon judge, a teammate) can try both sides of
// the app instantly. They only get created when DEMO_MODE=true (see
// config/seed.ts) or when `npm run seed:users` is run by hand.
//
// The password is public on purpose. Registration is open anyway (anyone can
// sign up as a buyer or a seller), so these accounts expose nothing new.
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
