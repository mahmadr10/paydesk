"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.smartIntakeSchema = exports.rejectProposalSchema = exports.approveProposalSchema = exports.listOrdersQuerySchema = exports.createOrderSchema = void 0;
const zod_1 = require("zod");
exports.createOrderSchema = zod_1.z.object({
    items: zod_1.z
        .array(zod_1.z.object({
        sku: zod_1.z.string().trim().min(1).max(40),
        quantity: zod_1.z.coerce.number().int().min(1).max(10),
    }))
        .min(1)
        .max(10),
});
exports.listOrdersQuerySchema = zod_1.z.object({
    paid: zod_1.z.enum(["true", "false"]).optional(),
});
exports.approveProposalSchema = zod_1.z.object({
    amount: zod_1.z.coerce.number().positive().max(100000).optional(),
    customerReply: zod_1.z.string().trim().max(2000).optional(),
});
exports.rejectProposalSchema = zod_1.z.object({
    note: zod_1.z.string().trim().max(500).optional(),
});
exports.smartIntakeSchema = zod_1.z.object({
    message: zod_1.z.string().trim().min(10, "Tell us a bit more (at least 10 characters)").max(2000),
});
