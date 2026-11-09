import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { aiLimiter } from "../middleware/rateLimit";
import { mongoIdParamSchema } from "../validators/ticketValidators";
import { Ticket } from "../models/Ticket";
import * as disputeService from "../services/disputeService";
import { askAssistant } from "../services/sellerAssistantService";
import { recordAccess } from "../services/orderService";
import { getTicketById } from "../services/ticketService";

const router = Router();
router.use(requireAuth);
const staff = requireRole("AGENT", "ADMIN");

const approveSchema = z.object({
  amount: z.coerce.number().positive().max(100000).optional(),
  responseNote: z.string().trim().max(2000).optional(),
});
const adjudicateSchema = z.object({ outcome: z.enum(["BUYER_FAVOR", "SELLER_FAVOR"]) });
const simulateSchema = z.object({
  orderId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  reason: z.enum(["MERCHANDISE_OR_SERVICE_NOT_RECEIVED", "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", "UNAUTHORISED", "DUPLICATE_TRANSACTION"]),
  message: z.string().trim().min(5).max(1000),
});
const askSchema = z.object({
  question: z.string().trim().min(2).max(1000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(12).default([]),
});

// Dispute cases list (staff).
router.get("/", staff, async (_req: Request, res: Response) => {
  const cases = await Ticket.find({ dispute: { $ne: null } })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate("customer", "name email")
    .select("-dispute.raw -disputeProposal.evidenceText");
  res.json({ success: true, data: { cases } });
});

router.get("/events", staff, async (_req, res) => {
  res.json({ success: true, data: { events: await disputeService.listWebhookEvents() } });
});

router.post("/sync", staff, async (_req, res) => {
  res.json({ success: true, data: await disputeService.syncAllDisputes() });
});

router.post("/assistant", staff, aiLimiter, validate(askSchema), async (req, res) => {
  res.json({ success: true, data: await askAssistant(req.body.question, req.body.history) });
});

// Buyer side (simulated mode): open a dispute on one of my orders.
router.post("/simulate", requireRole("CUSTOMER"), validate(simulateSchema), async (req, res) => {
  const r = await disputeService.simulateBuyerDispute(req.user!, req.body.orderId, req.body.reason, req.body.message);
  res.status(201).json({ success: true, data: r });
});

// Buyer downloads their purchase (delivery evidence).
router.post("/orders/:id/download", requireRole("CUSTOMER"), validate(mongoIdParamSchema, "params"), async (req, res) => {
  res.json({ success: true, data: await recordAccess(req.params.id as string, req.user!) });
});

router.post("/:id/agent", staff, aiLimiter, validate(mongoIdParamSchema, "params"), async (req, res) => {
  await disputeService.runAgent(req.params.id as string, req.user!);
  res.json({ success: true, data: { ticket: await getTicketById(req.params.id as string, req.user!) } });
});

router.post("/:id/approve", staff, validate(mongoIdParamSchema, "params"), validate(approveSchema), async (req, res) => {
  res.json({ success: true, data: { ticket: await disputeService.approve(req.params.id as string, req.user!, req.body) } });
});

router.post("/:id/reject", staff, validate(mongoIdParamSchema, "params"), async (req, res) => {
  res.json({ success: true, data: { ticket: await disputeService.reject(req.params.id as string, req.user!) } });
});

router.post("/:id/adjudicate", staff, validate(mongoIdParamSchema, "params"), validate(adjudicateSchema), async (req, res) => {
  res.json({ success: true, data: { ticket: await disputeService.adjudicate(req.params.id as string, req.user!, req.body.outcome) } });
});

export default router;
