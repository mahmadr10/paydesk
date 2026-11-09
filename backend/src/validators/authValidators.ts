import { z } from "zod";

// Deliberately only CUSTOMER/AGENT here - never ADMIN. If self-registration
// allowed picking "ADMIN", anyone could grant themselves full control of the
// system. Admin accounts are created by seeding (config/seed.ts) or by an
// existing admin promoting a user via PATCH /admin/users/:id.
export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z.string().trim().toLowerCase().email("Must be a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["CUSTOMER", "AGENT"]),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Must be a valid email"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;
