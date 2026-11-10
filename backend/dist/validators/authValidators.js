"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginSchema = exports.registerSchema = void 0;
const zod_1 = require("zod");
// Deliberately only CUSTOMER/AGENT here - never ADMIN. If self-registration
// allowed picking "ADMIN", anyone could grant themselves full control of the
// system. Admin accounts are created by seeding (config/seed.ts) or by an
// existing admin promoting a user via PATCH /admin/users/:id.
exports.registerSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2, "Name must be at least 2 characters"),
    email: zod_1.z.string().trim().toLowerCase().email("Must be a valid email"),
    password: zod_1.z.string().min(8, "Password must be at least 8 characters"),
    role: zod_1.z.enum(["CUSTOMER", "AGENT"]),
});
exports.loginSchema = zod_1.z.object({
    email: zod_1.z.string().trim().toLowerCase().email("Must be a valid email"),
    password: zod_1.z.string().min(1, "Password is required"),
});
