import { z } from "zod";
import { TICKET_PRIORITIES } from "./types";

// These mirror the backend's Zod validators (backend/src/validators/*.ts).
// Duplicating the rules here is what makes React Hook Form show inline
// errors instantly, without a round trip - but the backend re-validates
// independently and is the real gate; these schemas are UX only.
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
export type LoginForm = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["CUSTOMER", "AGENT"]),
});
export type RegisterForm = z.infer<typeof registerSchema>;

export const createTicketSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(150),
  description: z.string().trim().min(10, "Description must be at least 10 characters"),
  category: z.string().min(1, "Pick a category"),
  priority: z.enum(TICKET_PRIORITIES),
  tags: z.string().optional(), // comma-separated in the form; split before sending
});
export type CreateTicketForm = z.infer<typeof createTicketSchema>;
