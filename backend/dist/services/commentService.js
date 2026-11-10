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
exports.addComment = addComment;
exports.listComments = listComments;
const commentRepo = __importStar(require("../repositories/commentRepository"));
const ticketRepo = __importStar(require("../repositories/ticketRepository"));
const AppError_1 = require("../utils/AppError");
const auditLogService_1 = require("./auditLogService");
const ticketService_1 = require("./ticketService");
async function assertTicketVisible(ticketId, user) {
    const ticket = await ticketRepo.findTicketDocById(ticketId);
    if (!ticket)
        throw new AppError_1.AppError(404, "NOT_FOUND", "Ticket not found.");
    if (user.role === "CUSTOMER" && ticket.customer.toString() !== user.userId) {
        throw new AppError_1.AppError(403, "FORBIDDEN", "You can only comment on your own tickets.");
    }
    return ticket;
}
async function addComment(ticketId, user, text, isInternal) {
    const ticket = await assertTicketVisible(ticketId, user);
    // A customer can never post an internal note - even if a crafted request
    // sent isInternal:true, we override it here rather than trusting the
    // caller's role claim embedded in the body.
    const reallyInternal = user.role === "CUSTOMER" ? false : isInternal;
    const comment = await commentRepo.createComment({
        ticket: ticketId,
        author: user.userId,
        authorRole: user.role,
        text,
        isInternal: reallyInternal,
    });
    await (0, auditLogService_1.logAction)({
        actor: user.userId,
        action: "COMMENT_ADDED",
        entity: "Ticket",
        entityId: ticketId,
        metadata: { commentId: comment._id.toString(), isInternal: reallyInternal },
    });
    // Two side effects, both business rules that belong here (not in the
    // controller): an agent's first reply starts the "first response" SLA
    // clock, and a customer replying to a WAITING_FOR_CUSTOMER ticket is
    // exactly the signal that means "the ball is back in the agent's court" -
    // so we auto-advance the status instead of making the agent notice and
    // click a button.
    if ((user.role === "AGENT" || user.role === "ADMIN") && !reallyInternal) {
        await (0, ticketService_1.markFirstResponseIfNeeded)(ticketId);
    }
    if (user.role === "CUSTOMER" && ticket.status === "WAITING_FOR_CUSTOMER") {
        await (0, ticketService_1.updateTicketStatus)(ticketId, "IN_PROGRESS", user);
    }
    return comment.populate("author", "name email");
}
async function listComments(ticketId, user) {
    await assertTicketVisible(ticketId, user);
    const includeInternal = user.role === "AGENT" || user.role === "ADMIN";
    return commentRepo.findCommentsForTicket(ticketId, includeInternal);
}
