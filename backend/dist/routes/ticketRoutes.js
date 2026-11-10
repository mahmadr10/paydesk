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
const ticketController = __importStar(require("../controllers/ticketController"));
const commentController = __importStar(require("../controllers/commentController"));
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const upload_1 = require("../middleware/upload");
const ticketValidators_1 = require("../validators/ticketValidators");
const commentValidators_1 = require("../validators/commentValidators");
const paymentValidators_1 = require("../validators/paymentValidators");
const rateLimit_1 = require("../middleware/rateLimit");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
router.post("/", (0, auth_1.requireRole)("CUSTOMER"), (0, validate_1.validate)(ticketValidators_1.createTicketSchema), ticketController.createTicket);
// "Describe your problem" box: AI picks the order and opens the ticket.
router.post("/smart-intake", (0, auth_1.requireRole)("CUSTOMER"), rateLimit_1.aiLimiter, (0, validate_1.validate)(paymentValidators_1.smartIntakeSchema), ticketController.smartIntake);
// Refund agent (staff only). Running it moves no money; only approve does.
router.post("/:id/refund-agent", (0, auth_1.requireRole)("AGENT", "ADMIN"), rateLimit_1.aiLimiter, (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), ticketController.runRefundAgent);
router.post("/:id/refund-proposal/approve", (0, auth_1.requireRole)("AGENT", "ADMIN"), (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), (0, validate_1.validate)(paymentValidators_1.approveProposalSchema), ticketController.approveRefundProposal);
router.post("/:id/refund-proposal/reject", (0, auth_1.requireRole)("AGENT", "ADMIN"), (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), (0, validate_1.validate)(paymentValidators_1.rejectProposalSchema), ticketController.rejectRefundProposal);
router.get("/", (0, validate_1.validate)(ticketValidators_1.listTicketsQuerySchema, "query"), ticketController.listTickets);
router.get("/:id", (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), ticketController.getTicket);
router.patch("/:id/status", (0, auth_1.requireRole)("CUSTOMER", "AGENT", "ADMIN"), // customers can trigger the CLOSED/reopen transitions; the service enforces which ones
(0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), (0, validate_1.validate)(ticketValidators_1.updateStatusSchema), ticketController.updateStatus);
router.patch("/:id/priority", (0, auth_1.requireRole)("AGENT", "ADMIN"), (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), (0, validate_1.validate)(ticketValidators_1.updatePrioritySchema), ticketController.updatePriority);
router.patch("/:id/tags", (0, auth_1.requireRole)("AGENT", "ADMIN"), (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), (0, validate_1.validate)(ticketValidators_1.updateTagsSchema), ticketController.updateTags);
router.post("/:id/assign", (0, auth_1.requireRole)("AGENT"), (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), ticketController.assignToSelf);
// AI ticket assistant (spec's optional bonus feature) - staff-only, since
// the output (a suggested internal priority, a draft reply) is triage
// tooling, not something a customer should see. See services/aiService.ts.
router.post("/:id/ai-analyze", (0, auth_1.requireRole)("AGENT", "ADMIN"), (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), ticketController.analyzeWithAi);
router.post("/:id/reassign", (0, auth_1.requireRole)("ADMIN"), (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), (0, validate_1.validate)(ticketValidators_1.reassignSchema), ticketController.reassign);
router.post("/:id/attachments", (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), upload_1.upload.single("file"), ticketController.uploadAttachment);
router.get("/:id/attachments/:attachmentId", (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), ticketController.downloadAttachment);
router.get("/:id/comments", (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), commentController.listComments);
router.post("/:id/comments", (0, validate_1.validate)(ticketValidators_1.mongoIdParamSchema, "params"), (0, validate_1.validate)(commentValidators_1.createCommentSchema), commentController.addComment);
exports.default = router;
