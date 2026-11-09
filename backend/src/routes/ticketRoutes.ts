import { Router } from "express";
import * as ticketController from "../controllers/ticketController";
import * as commentController from "../controllers/commentController";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { upload } from "../middleware/upload";
import {
  createTicketSchema,
  listTicketsQuerySchema,
  updateStatusSchema,
  updatePrioritySchema,
  updateTagsSchema,
  reassignSchema,
  mongoIdParamSchema,
} from "../validators/ticketValidators";
import { createCommentSchema } from "../validators/commentValidators";
import { approveProposalSchema, rejectProposalSchema, smartIntakeSchema } from "../validators/paymentValidators";
import { aiLimiter } from "../middleware/rateLimit";

const router = Router();

router.use(requireAuth);

router.post("/", requireRole("CUSTOMER"), validate(createTicketSchema), ticketController.createTicket);
// "Describe your problem" box: AI picks the order and opens the ticket.
router.post(
  "/smart-intake",
  requireRole("CUSTOMER"),
  aiLimiter,
  validate(smartIntakeSchema),
  ticketController.smartIntake
);

// Refund agent (staff only). Running it moves no money; only approve does.
router.post(
  "/:id/refund-agent",
  requireRole("AGENT", "ADMIN"),
  aiLimiter,
  validate(mongoIdParamSchema, "params"),
  ticketController.runRefundAgent
);
router.post(
  "/:id/refund-proposal/approve",
  requireRole("AGENT", "ADMIN"),
  validate(mongoIdParamSchema, "params"),
  validate(approveProposalSchema),
  ticketController.approveRefundProposal
);
router.post(
  "/:id/refund-proposal/reject",
  requireRole("AGENT", "ADMIN"),
  validate(mongoIdParamSchema, "params"),
  validate(rejectProposalSchema),
  ticketController.rejectRefundProposal
);
router.get("/", validate(listTicketsQuerySchema, "query"), ticketController.listTickets);
router.get("/:id", validate(mongoIdParamSchema, "params"), ticketController.getTicket);

router.patch(
  "/:id/status",
  requireRole("CUSTOMER", "AGENT", "ADMIN"), // customers can trigger the CLOSED/reopen transitions; the service enforces which ones
  validate(mongoIdParamSchema, "params"),
  validate(updateStatusSchema),
  ticketController.updateStatus
);

router.patch(
  "/:id/priority",
  requireRole("AGENT", "ADMIN"),
  validate(mongoIdParamSchema, "params"),
  validate(updatePrioritySchema),
  ticketController.updatePriority
);

router.patch(
  "/:id/tags",
  requireRole("AGENT", "ADMIN"),
  validate(mongoIdParamSchema, "params"),
  validate(updateTagsSchema),
  ticketController.updateTags
);

router.post(
  "/:id/assign",
  requireRole("AGENT"),
  validate(mongoIdParamSchema, "params"),
  ticketController.assignToSelf
);

// AI ticket assistant (spec's optional bonus feature) — staff-only, since
// the output (a suggested internal priority, a draft reply) is triage
// tooling, not something a customer should see. See services/aiService.ts.
router.post(
  "/:id/ai-analyze",
  requireRole("AGENT", "ADMIN"),
  validate(mongoIdParamSchema, "params"),
  ticketController.analyzeWithAi
);

router.post(
  "/:id/reassign",
  requireRole("ADMIN"),
  validate(mongoIdParamSchema, "params"),
  validate(reassignSchema),
  ticketController.reassign
);

router.post(
  "/:id/attachments",
  validate(mongoIdParamSchema, "params"),
  upload.single("file"),
  ticketController.uploadAttachment
);
router.get(
  "/:id/attachments/:attachmentId",
  validate(mongoIdParamSchema, "params"),
  ticketController.downloadAttachment
);

router.get("/:id/comments", validate(mongoIdParamSchema, "params"), commentController.listComments);
router.post(
  "/:id/comments",
  validate(mongoIdParamSchema, "params"),
  validate(createCommentSchema),
  commentController.addComment
);

export default router;
