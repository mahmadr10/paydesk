import { z } from "zod";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "../models/Ticket";

export const createTicketSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(150),
  description: z.string().trim().min(10, "Description must be at least 10 characters"),
  category: z.string().trim().min(1, "Category is required"),
  priority: z.enum(TICKET_PRIORITIES),
  tags: z.array(z.string().trim().min(1)).max(10).default([]),
  orderId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid order id")
    .optional(),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

// Everything the ticket queue/list needs: filter, search, sort, paginate -
// all handled server-side (see repositories/ticketRepository.ts) so the
// browser never downloads more than one page of results.
export const listTicketsQuerySchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  category: z.string().trim().optional(),
  assignedAgent: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  tag: z.string().trim().optional(),
  search: z.string().trim().max(150).optional(),
  createdAfterDays: z.coerce.number().int().positive().optional(), // e.g. 7 = "last 7 days"
  sortBy: z.enum(["createdAt", "updatedAt", "priority", "resolutionDeadline"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

export const updateStatusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
});
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

export const updatePrioritySchema = z.object({
  priority: z.enum(TICKET_PRIORITIES),
});

export const updateTagsSchema = z.object({
  tags: z.array(z.string().trim().min(1)).max(10),
});

// Admin/agent reassignment - assign a SPECIFIC agent, as opposed to
// POST /tickets/:id/assign which always means "assign to myself".
export const reassignSchema = z.object({
  agentId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid agent id"),
});

export const mongoIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id format"),
});
