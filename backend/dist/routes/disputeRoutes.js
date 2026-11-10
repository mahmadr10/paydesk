"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const rateLimit_1 = require("../middleware/rateLimit");
const ticketValidators_1 = require("../validators/ticketValidators");
const Ticket_1 = require("../models/Ticket");
const disputeService = __importStar(require("../services/disputeService"));
const sellerAssistantService_1 = require("../services/sellerAssistantService");
const orderService_1 = require("../services/orderService");
const ticketService_1 = require("../services/ticketService");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const staff = (0, auth_1.requireRole)("AGENT", "ADMIN");
const approveSchema = zod_1.z.object({
    amount: zod_1.z.coerce.number().positive().max(100000).optional(),
    responseNote: zod_1.z.string().trim().max(2000).optional(),
});
const adjudicateSchema = zod_1.z.object({ outcome: zod_1.z.enum(["BUYER_FAVOR", "SELLER_FAVOR"]) });
const simulateSchema = zod_1.z.object({
    orderId: zod_1.z.string().regex(/^[0-9a-fA-F]{24}$/),
    reason: zod_1.z.enum(["MERCHANDISE_OR_SERVICE_NOT_RECEIVED", "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", "UNAUTHORISED", "DUPLICATE_TRANSACTION"]),
    message: zod_1.z.string().trim().min(5).max(1000),
});
const askSchema = zod_1.z.object({
    question: zod_1.z.string().trim().min(2).max(1000),
    history: zod_1.z.array(zod_1.z.object({ role: zod_1.z.enum(["user", "assistant"]), content: zod_1.z.string().max(4000) })).max(12).default([]),
});
// Dispute cases list (staff).
router.get("/", staff, async (_req, res) => {
    const cases = await Ticket_1.Ticket.find({ dispute: { $ne: null } })
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
router.post("/assistant", staff, rateLimit_1.aiLimiter, (0, validate_1.validate)(askSchema), async (req, res) => {
    res.json({ success: true, data: await (0, sellerAssistantService_1.askAssistant)(req.body.question, req.body.history) });
});
// Buyer side (simulated mode): open a dispute on one of my orders.
router.post("/simulate", (0, auth_1.requireRole)("CUSTOMER"), (0, validate_1.validate)(simulateSchema), async (req, res) => {
    const r = await disputeService.simulateBuyerDispute(req.user, req.body.orderId, req.body.reason, req.body.message);
    res.status(201).json({ success: true, data: r });
});
// Buyer downloads their purchase (delivery evidence).
router.post("/orders/:id/download", (0, auth_1.requireRole)("CUSTOMER"), (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), async (req, res) => {
    res.json({ success: true, data: await (0, orderService_1.recordAccess)(req.params.id, req.user) });
});
router.post("/:id/agent", staff, rateLimit_1.aiLimiter, (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), async (req, res) => {
    await disputeService.runAgent(req.params.id, req.user);
    res.json({ success: true, data: { ticket: await (0, ticketService_1.getTicketById)(req.params.id, req.user) } });
});
router.post("/:id/approve", staff, (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), (0, validate_1.validate)(approveSchema), async (req, res) => {
    res.json({ success: true, data: { ticket: await disputeService.approve(req.params.id, req.user, req.body) } });
});
router.post("/:id/reject", staff, (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), async (req, res) => {
    res.json({ success: true, data: { ticket: await disputeService.reject(req.params.id, req.user) } });
});
router.post("/:id/adjudicate", staff, (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), (0, validate_1.validate)(adjudicateSchema), async (req, res) => {
    res.json({ success: true, data: { ticket: await disputeService.adjudicate(req.params.id, req.user, req.body.outcome) } });
});
exports.default = router;
