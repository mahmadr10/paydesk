"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCommentSchema = void 0;
const zod_1 = require("zod");
exports.createCommentSchema = zod_1.z.object({
    text: zod_1.z.string().trim().min(1, "Comment cannot be empty").max(2000),
    // Only an agent/admin request is allowed to set this true - enforced in
    // the controller (a customer's request body is not trusted to self-report
    // "isInternal: false", but a customer trying to set it true is rejected).
    isInternal: zod_1.z.boolean().default(false),
});
