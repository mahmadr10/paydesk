"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAuditLogsQuerySchema = void 0;
const zod_1 = require("zod");
exports.listAuditLogsQuerySchema = zod_1.z.object({
    entity: zod_1.z.string().trim().optional(),
    entityId: zod_1.z
        .string()
        .regex(/^[0-9a-fA-F]{24}$/)
        .optional(),
    actor: zod_1.z
        .string()
        .regex(/^[0-9a-fA-F]{24}$/)
        .optional(),
    action: zod_1.z.string().trim().optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(25),
});
