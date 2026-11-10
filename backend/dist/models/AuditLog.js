"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLog = void 0;
const mongoose_1 = require("mongoose");
const auditLogSchema = new mongoose_1.Schema({
    actor: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: mongoose_1.Schema.Types.ObjectId, required: true, index: true },
    oldValue: { type: mongoose_1.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose_1.Schema.Types.Mixed, default: null },
    metadata: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now, index: true },
});
exports.AuditLog = (0, mongoose_1.model)("AuditLog", auditLogSchema);
