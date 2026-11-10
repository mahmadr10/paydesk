"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAction = logAction;
const auditLogRepository_1 = require("../repositories/auditLogRepository");
const logger_1 = require("../observability/logger");
// A thin, deliberately boring wrapper - every place that changes a ticket
// (or a user, or a category) calls this ONE function instead of writing to
// AuditLog directly, so the shape of an audit entry (actor/action/entity/
// entityId/oldValue/newValue/metadata/timestamp) can never drift between
// call sites.
function logAction(entry) {
    // Fire-and-forget from the caller's perspective, but we still await it
    // internally and log failures - an audit-log write failing should never
    // crash the actual user-facing action (e.g. don't fail "assign ticket"
    // just because the audit write had a transient hiccup), but silently
    // losing audit entries forever would defeat the point, so at least log it.
    return (0, auditLogRepository_1.recordAuditLog)(entry).catch((err) => {
        logger_1.logger.error({ err, action: entry.action }, "Failed to write audit log entry");
    });
}
