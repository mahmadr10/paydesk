import { Category } from "../models/Category";
import { SLAPolicy, DEFAULT_SLA_POLICIES } from "../models/SLAPolicy";
import { TicketPriority, TICKET_PRIORITIES } from "../models/Ticket";
import { logger } from "../observability/logger";
import { env } from "./env";
import { seedDemoUsers } from "./demoUsers";

const DEFAULT_CATEGORIES = ["Technical", "Billing", "Account", "Payment", "Other"];

let isSeeded = false;

// Ticket creation requires a category to exist and an SLA policy for its
// priority to exist - so an empty database can't create a ticket at all.
// Rather than make that a manual setup step, we seed sensible defaults
// automatically on every startup. It's idempotent (checks "does anything
// exist" first) so restarting the server never duplicates or resets data
// an admin has already customized.
export async function seedDefaults() {
  if (isSeeded) return;

  // Clean up any rogue/legacy indexes (e.g. from previous schemas)
  try {
    const usersCol = (Category.db as any).collection("users");
    const indexes = await usersCol.indexes();
    for (const idx of indexes) {
      if (idx.name === "userName_1" || (idx.key && idx.key.userName)) {
        await usersCol.dropIndex(idx.name);
        logger.info(`Dropped legacy ${idx.name} index from users collection`);
      }
    }
  } catch (_e) {
    // ignore
  }

  const categoryCount = await Category.countDocuments();
  if (categoryCount === 0) {
    await Category.insertMany(DEFAULT_CATEGORIES.map((name) => ({ name, isActive: true })));
    logger.info(`Seeded ${DEFAULT_CATEGORIES.length} default categories`);
  }

  const policyCount = await SLAPolicy.countDocuments();
  if (policyCount === 0) {
    await SLAPolicy.insertMany(
      TICKET_PRIORITIES.map((priority: TicketPriority) => ({ priority, ...DEFAULT_SLA_POLICIES[priority] }))
    );
    logger.info(`Seeded ${TICKET_PRIORITIES.length} default SLA policies`);
  }

  if (env.DEMO_MODE === "true") await seedDemoUsers();
  isSeeded = true;
}
