"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mongoIdParamSchema = exports.reassignSchema = exports.updateTagsSchema = exports.updatePrioritySchema = exports.updateStatusSchema = exports.listTicketsQuerySchema = exports.createTicketSchema = void 0;
const zod_1 = require("zod");
const Ticket_1 = require("../models/Ticket");
exports.createTicketSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(3, "Title must be at least 3 characters").max(150),
    description: zod_1.z.string().trim().min(10, "Description must be at least 10 characters"),
    category: zod_1.z.string().trim().min(1, "Category is required"),
    priority: zod_1.z.enum(Ticket_1.TICKET_PRIORITIES),
    tags: zod_1.z.array(zod_1.z.string().trim().min(1)).max(10).default([]),
    orderId: zod_1.z
        .string()
        .regex(/^[0-9a-fA-F]{24}$/, "Invalid order id")
        .optional(),
});
// Everything the ticket queue/list needs: filter, search, sort, paginate -
// all handled server-side (see repositories/ticketRepository.ts) so the
// browser never downloads more than one page of results.
exports.listTicketsQuerySchema = zod_1.z.object({
    status: zod_1.z.enum(Ticket_1.TICKET_STATUSES).optional(),
    priority: zod_1.z.enum(Ticket_1.TICKET_PRIORITIES).optional(),
    category: zod_1.z.string().trim().optional(),
    assignedAgent: zod_1.z
        .string()
        .regex(/^[0-9a-fA-F]{24}$/)
        .optional(),
    tag: zod_1.z.string().trim().optional(),
    search: zod_1.z.string().trim().max(150).optional(),
    createdAfterDays: zod_1.z.coerce.number().int().positive().optional(), // e.g. 7 = "last 7 days"
    sortBy: zod_1.z.enum(["createdAt", "updatedAt", "priority", "resolutionDeadline"]).default("createdAt"),
    sortDir: zod_1.z.enum(["asc", "desc"]).default("desc"),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(10),
});
exports.updateStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(Ticket_1.TICKET_STATUSES),
});
exports.updatePrioritySchema = zod_1.z.object({
    priority: zod_1.z.enum(Ticket_1.TICKET_PRIORITIES),
});
exports.updateTagsSchema = zod_1.z.object({
    tags: zod_1.z.array(zod_1.z.string().trim().min(1)).max(10),
});
// Admin/agent reassignment - assign a SPECIFIC agent, as opposed to
// POST /tickets/:id/assign which always means "assign to myself".
exports.reassignSchema = zod_1.z.object({
    agentId: zod_1.z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid agent id"),
});
exports.mongoIdParamSchema = zod_1.z.object({
    id: zod_1.z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id format"),
});
