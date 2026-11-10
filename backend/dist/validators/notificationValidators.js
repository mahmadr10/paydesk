"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationIdParamSchema = exports.listNotificationsQuerySchema = void 0;
const zod_1 = require("zod");
exports.listNotificationsQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(50).default(20),
});
exports.notificationIdParamSchema = zod_1.z.object({
    id: zod_1.z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid notification id"),
});
