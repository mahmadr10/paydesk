"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordAuditLog = recordAuditLog;
exports.listAuditLogs = listAuditLogs;
const AuditLog_1 = require("../models/AuditLog");
function recordAuditLog(entry) {
    return AuditLog_1.AuditLog.create({
        actor: entry.actor,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        oldValue: entry.oldValue ?? null,
        newValue: entry.newValue ?? null,
        metadata: entry.metadata ?? {},
    });
}
async function listAuditLogs(filter, skip, limit) {
    const [logs, total] = await Promise.all([
        AuditLog_1.AuditLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).populate("actor", "name email role"),
        AuditLog_1.AuditLog.countDocuments(filter),
    ]);
    return { logs, total };
}
