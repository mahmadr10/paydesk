import { schedule, ScheduledTask } from "node-cron";
import { Ticket, ITicket } from "../models/Ticket";
import { createNotification } from "../repositories/notificationRepository";
import { findActiveAdminIds } from "../repositories/userRepository";
import { emitNotification } from "../sockets/io";
import { logAction } from "../services/auditLogService";
import { logger } from "../observability/logger";
import { env } from "../config/env";

// Background job - the spec's "Background Jobs" bonus item. Runs every
// minute, finds tickets that JUST crossed an SLA deadline while still
// active (not resolved/closed) and haven't been notified about yet, and
// pushes a persisted Notification + a live Socket.IO event to whoever
// should know: the assigned agent, or every admin if nobody's assigned yet.
//
// Why a `*Notified` flag per ticket instead of re-deriving "is this
// breached" fresh every run: computeSlaStatus() (used for the LIVE display
// on a ticket) is intentionally stateless - "breached: true/false" recomputed
// on every read. A notification is different: it must fire EXACTLY ONCE per
// breach, or a still-overdue ticket would re-notify its agent every single
// minute forever. The flag is the only way to distinguish "still breached,
// already told you" from "just breached, telling you now."
const ACTIVE_STATUSES = ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "WAITING_FOR_CUSTOMER"] as const;

async function notifyRecipients(ticket: ITicket, message: string) {
  const recipientIds = ticket.assignedAgent ? [ticket.assignedAgent.toString()] : await findActiveAdminIds();
  for (const userId of recipientIds) {
    const notification = await createNotification({ user: userId, type: "SLA_BREACH_RESOLUTION", message, ticket: ticket._id.toString() });
    emitNotification(userId, notification);
  }
}

export async function checkSlaBreaches(): Promise<{ responseBreaches: number; resolutionBreaches: number }> {
  const now = new Date();

  const responseBreaches = await Ticket.find({
    status: { $in: ACTIVE_STATUSES },
    firstResponseAt: null,
    responseDeadline: { $lt: now },
    // `$ne: true`, not `{ responseBreachNotified: false }` - a real bug
    // found running this against real seeded data: MongoDB's `{ field:
    // false }` filter does NOT match documents where the field is simply
    // ABSENT (e.g. tickets created before this field existed in the
    // schema) - only ones where it's explicitly stored as `false`. `$ne:
    // true` matches both "explicitly false" and "missing," which is the
    // correct meaning of "not yet notified" for legacy documents too.
    responseBreachNotified: { $ne: true },
  });
  for (const ticket of responseBreaches) {
    const message = `Response SLA breached: ${ticket.ticketNumber} - "${ticket.title}"`;
    await notifyRecipients(ticket, message);
    await logAction({ actor: null, action: "SLA_BREACH_DETECTED", entity: "Ticket", entityId: ticket._id.toString(), metadata: { type: "response" } });
    ticket.responseBreachNotified = true;
    await ticket.save();
  }

  const resolutionBreaches = await Ticket.find({
    status: { $in: ACTIVE_STATUSES },
    resolutionDeadline: { $lt: now },
    resolutionBreachNotified: { $ne: true },
  });
  for (const ticket of resolutionBreaches) {
    const message = `Resolution SLA breached: ${ticket.ticketNumber} - "${ticket.title}"`;
    await notifyRecipients(ticket, message);
    await logAction({ actor: null, action: "SLA_BREACH_DETECTED", entity: "Ticket", entityId: ticket._id.toString(), metadata: { type: "resolution" } });
    ticket.resolutionBreachNotified = true;
    await ticket.save();
  }

  if (responseBreaches.length || resolutionBreaches.length) {
    logger.info({ responseBreaches: responseBreaches.length, resolutionBreaches: resolutionBreaches.length }, "SLA breach job: sent notifications");
  }

  return { responseBreaches: responseBreaches.length, resolutionBreaches: resolutionBreaches.length };
}

let task: ScheduledTask | null = null;

export function startSlaBreachJob() {
  if (env.JOBS_ENABLED !== "true") {
    logger.info("SLA breach job disabled (JOBS_ENABLED=false)");
    return;
  }
  if (process.env.VERCEL) {
    logger.info("SLA breach job running via Vercel Cron endpoints (/api/cron/sla-breach)");
    return;
  }
  task = schedule("* * * * *", () => {
    checkSlaBreaches().catch((err) => logger.error({ err }, "SLA breach job failed"));
  });
  logger.info("SLA breach job started (runs every minute)");
}

export function stopSlaBreachJob() {
  task?.stop();
  task = null;
}
