import * as commentRepo from "../repositories/commentRepository";
import * as ticketRepo from "../repositories/ticketRepository";
import { AppError } from "../utils/AppError";
import { JwtPayload } from "../utils/jwt";
import { logAction } from "./auditLogService";
import { markFirstResponseIfNeeded, updateTicketStatus } from "./ticketService";

async function assertTicketVisible(ticketId: string, user: JwtPayload) {
  const ticket = await ticketRepo.findTicketDocById(ticketId);
  if (!ticket) throw new AppError(404, "NOT_FOUND", "Ticket not found.");
  if (user.role === "CUSTOMER" && ticket.customer.toString() !== user.userId) {
    throw new AppError(403, "FORBIDDEN", "You can only comment on your own tickets.");
  }
  return ticket;
}

export async function addComment(ticketId: string, user: JwtPayload, text: string, isInternal: boolean) {
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

  await logAction({
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
    await markFirstResponseIfNeeded(ticketId);
  }
  if (user.role === "CUSTOMER" && ticket.status === "WAITING_FOR_CUSTOMER") {
    await updateTicketStatus(ticketId, "IN_PROGRESS", user);
  }

  return comment.populate("author", "name email");
}

export async function listComments(ticketId: string, user: JwtPayload) {
  await assertTicketVisible(ticketId, user);
  const includeInternal = user.role === "AGENT" || user.role === "ADMIN";
  return commentRepo.findCommentsForTicket(ticketId, includeInternal);
}
