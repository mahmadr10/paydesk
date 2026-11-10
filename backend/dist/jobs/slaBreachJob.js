"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkSlaBreaches = checkSlaBreaches;
exports.startSlaBreachJob = startSlaBreachJob;
exports.stopSlaBreachJob = stopSlaBreachJob;
const node_cron_1 = require("node-cron");
const Ticket_1 = require("../models/Ticket");
const notificationRepository_1 = require("../repositories/notificationRepository");
const userRepository_1 = require("../repositories/userRepository");
const io_1 = require("../sockets/io");
const auditLogService_1 = require("../services/auditLogService");
const logger_1 = require("../observability/logger");
const env_1 = require("../config/env");
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
const ACTIVE_STATUSES = ["OPEN", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "WAITING_FOR_CUSTOMER"];
async function notifyRecipients(ticket, message) {
    const recipientIds = ticket.assignedAgent ? [ticket.assignedAgent.toString()] : await (0, userRepository_1.findActiveAdminIds)();
    for (const userId of recipientIds) {
        const notification = await (0, notificationRepository_1.createNotification)({ user: userId, type: "SLA_BREACH_RESOLUTION", message, ticket: ticket._id.toString() });
        (0, io_1.emitNotification)(userId, notification);
    }
}
async function checkSlaBreaches() {
    const now = new Date();
    const responseBreaches = await Ticket_1.Ticket.find({
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
        await (0, auditLogService_1.logAction)({ actor: null, action: "SLA_BREACH_DETECTED", entity: "Ticket", entityId: ticket._id.toString(), metadata: { type: "response" } });
        ticket.responseBreachNotified = true;
        await ticket.save();
    }
    const resolutionBreaches = await Ticket_1.Ticket.find({
        status: { $in: ACTIVE_STATUSES },
        resolutionDeadline: { $lt: now },
        resolutionBreachNotified: { $ne: true },
    });
    for (const ticket of resolutionBreaches) {
        const message = `Resolution SLA breached: ${ticket.ticketNumber} - "${ticket.title}"`;
        await notifyRecipients(ticket, message);
        await (0, auditLogService_1.logAction)({ actor: null, action: "SLA_BREACH_DETECTED", entity: "Ticket", entityId: ticket._id.toString(), metadata: { type: "resolution" } });
        ticket.resolutionBreachNotified = true;
        await ticket.save();
    }
    if (responseBreaches.length || resolutionBreaches.length) {
        logger_1.logger.info({ responseBreaches: responseBreaches.length, resolutionBreaches: resolutionBreaches.length }, "SLA breach job: sent notifications");
    }
    return { responseBreaches: responseBreaches.length, resolutionBreaches: resolutionBreaches.length };
}
let task = null;
function startSlaBreachJob() {
    if (env_1.env.JOBS_ENABLED !== "true") {
        logger_1.logger.info("SLA breach job disabled (JOBS_ENABLED=false)");
        return;
    }
    if (process.env.VERCEL) {
        logger_1.logger.info("SLA breach job running via Vercel Cron endpoints (/api/cron/sla-breach)");
        return;
    }
    task = (0, node_cron_1.schedule)("* * * * *", () => {
        checkSlaBreaches().catch((err) => logger_1.logger.error({ err }, "SLA breach job failed"));
    });
    logger_1.logger.info("SLA breach job started (runs every minute)");
}
function stopSlaBreachJob() {
    task?.stop();
    task = null;
}
