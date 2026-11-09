import { Request, Response } from "express";
import path from "path";
import * as ticketService from "../services/ticketService";
import * as refundService from "../services/refundService";
import * as intakeService from "../services/intakeService";
import { AppError } from "../utils/AppError";
import { UPLOAD_DIR } from "../middleware/upload";

export async function createTicket(req: Request, res: Response) {
  const ticket = await ticketService.createTicket(req.user!.userId, req.body);
  // Ticket about a PayPal order: start the refund agent right away.
  if (ticket.order) refundService.runAgentInBackground(String(ticket._id));
  res.status(201).json({ success: true, data: { ticket } });
}

export async function smartIntake(req: Request, res: Response) {
  const result = await intakeService.smartIntake(req.user!.userId, req.body.message);
  res.status(201).json({ success: true, data: result });
}

export async function runRefundAgent(req: Request, res: Response) {
  await refundService.runAgent(req.params.id as string, req.user!);
  const ticket = await ticketService.getTicketById(req.params.id as string, req.user!);
  res.json({ success: true, data: { ticket } });
}

export async function approveRefundProposal(req: Request, res: Response) {
  const ticket = await refundService.approveProposal(req.params.id as string, req.user!, req.body);
  res.json({ success: true, data: { ticket } });
}

export async function rejectRefundProposal(req: Request, res: Response) {
  const ticket = await refundService.rejectProposal(req.params.id as string, req.user!, req.body.note);
  res.json({ success: true, data: { ticket } });
}

export async function listTickets(req: Request, res: Response) {
  const result = await ticketService.listTickets(req.user!, req.query as any);
  res.status(200).json({ success: true, data: result });
}

export async function getTicket(req: Request, res: Response) {
  const ticket = await ticketService.getTicketById(req.params.id as string, req.user!);
  res.status(200).json({ success: true, data: { ticket } });
}

export async function updateStatus(req: Request, res: Response) {
  const ticket = await ticketService.updateTicketStatus(req.params.id as string, req.body.status, req.user!);
  res.status(200).json({ success: true, data: { ticket } });
}

export async function assignToSelf(req: Request, res: Response) {
  const ticket = await ticketService.assignTicketToSelf(req.params.id as string, req.user!);
  res.status(200).json({ success: true, data: { ticket } });
}

export async function reassign(req: Request, res: Response) {
  const ticket = await ticketService.reassignTicket(req.params.id as string, req.body.agentId, req.user!);
  res.status(200).json({ success: true, data: { ticket } });
}

export async function updatePriority(req: Request, res: Response) {
  const ticket = await ticketService.updatePriority(req.params.id as string, req.body.priority, req.user!);
  res.status(200).json({ success: true, data: { ticket } });
}

export async function updateTags(req: Request, res: Response) {
  const ticket = await ticketService.updateTags(req.params.id as string, req.body.tags, req.user!);
  res.status(200).json({ success: true, data: { ticket } });
}

export async function uploadAttachment(req: Request, res: Response) {
  if (!req.file) {
    throw new AppError(400, "VALIDATION_ERROR", "No file was uploaded.");
  }
  const ticket = await ticketService.addAttachment(req.params.id as string, req.user!, {
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
  });
  res.status(201).json({ success: true, data: { ticket } });
}

export async function analyzeWithAi(req: Request, res: Response) {
  const analysis = await ticketService.getAiAnalysis(req.params.id as string, req.user!);
  res.status(200).json({ success: true, data: { analysis } });
}

export async function downloadAttachment(req: Request, res: Response) {
  const ticket = await ticketService.getTicketDocForDownload(req.params.id as string, req.user!);
  const attachment = ticket.attachments.find((a) => a._id?.toString() === req.params.attachmentId);
  if (!attachment) {
    throw new AppError(404, "NOT_FOUND", "Attachment not found.");
  }
  // We check authorization (assertCanView, above) and look up the ON-DISK
  // filename ourselves from the ticket document — we never let the request
  // supply a raw file path, which is what prevents path-traversal attacks
  // against this endpoint.
  const filePath = path.join(UPLOAD_DIR, attachment.filename);
  res.download(filePath, attachment.originalName);
}
