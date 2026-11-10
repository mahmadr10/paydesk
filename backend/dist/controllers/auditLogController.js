"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuditLogs = getAuditLogs;
const auditLogRepository_1 = require("../repositories/auditLogRepository");
async function getAuditLogs(req, res) {
    const { entity, entityId, actor, action, page, limit } = req.query;
    const skip = (page - 1) * limit;
    const { logs, total } = await (0, auditLogRepository_1.listAuditLogs)({ entity, entityId, actor, action }, skip, limit);
    res.status(200).json({
        success: true,
        data: { logs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } },
    });
}
