"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertSlaPolicySchema = exports.applyDevAssistantFixSchema = exports.askDevAssistantSchema = exports.setCategoryActiveSchema = exports.createCategorySchema = exports.updateUserSchema = exports.listUsersQuerySchema = void 0;
const zod_1 = require("zod");
exports.listUsersQuerySchema = zod_1.z.object({
    role: zod_1.z.enum(["CUSTOMER", "AGENT", "ADMIN"]).optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
});
exports.updateUserSchema = zod_1.z.object({
    role: zod_1.z.enum(["CUSTOMER", "AGENT", "ADMIN"]).optional(),
    isActive: zod_1.z.boolean().optional(),
});
exports.createCategorySchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(50),
    description: zod_1.z.string().trim().max(200).optional(),
});
exports.setCategoryActiveSchema = zod_1.z.object({
    isActive: zod_1.z.boolean(),
});
exports.askDevAssistantSchema = zod_1.z.object({
    question: zod_1.z.string().trim().min(5, "Ask a real question (min 5 characters).").max(500),
});
exports.applyDevAssistantFixSchema = zod_1.z.object({
    targetFile: zod_1.z.string().trim().min(1).max(300),
    oldCode: zod_1.z.string().min(1).max(5000),
    newCode: zod_1.z.string().min(1).max(5000),
});
exports.upsertSlaPolicySchema = zod_1.z.object({
    responseMinutes: zod_1.z.coerce.number().int().min(1),
    resolutionMinutes: zod_1.z.coerce.number().int().min(1),
});
