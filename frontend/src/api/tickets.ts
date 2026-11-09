import { api } from "./client";
import type { ApiSuccess, Ticket, TicketPriority, TicketStatus, Comment, Pagination, TicketAiAnalysis } from "../types";

export interface ListTicketsParams {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: string;
  assignedAgent?: string;
  search?: string;
  tag?: string;
  createdAfterDays?: number;
  sortBy?: "createdAt" | "updatedAt" | "priority" | "resolutionDeadline";
  sortDir?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export async function createTicketRequest(input: {
  title: string;
  description: string;
  category: string;
  priority: TicketPriority;
  tags: string[];
}) {
  const res = await api.post<ApiSuccess<{ ticket: Ticket }>>("/tickets", input);
  return res.data.data.ticket;
}

export async function listTicketsRequest(params: ListTicketsParams) {
  const res = await api.get<ApiSuccess<{ tickets: Ticket[]; pagination: Pagination }>>("/tickets", { params });
  return res.data.data;
}

export async function getTicketRequest(id: string) {
  const res = await api.get<ApiSuccess<{ ticket: Ticket }>>(`/tickets/${id}`);
  return res.data.data.ticket;
}

export async function updateTicketStatusRequest(id: string, status: TicketStatus) {
  const res = await api.patch<ApiSuccess<{ ticket: Ticket }>>(`/tickets/${id}/status`, { status });
  return res.data.data.ticket;
}

export async function updateTicketPriorityRequest(id: string, priority: TicketPriority) {
  const res = await api.patch<ApiSuccess<{ ticket: Ticket }>>(`/tickets/${id}/priority`, { priority });
  return res.data.data.ticket;
}

export async function updateTicketTagsRequest(id: string, tags: string[]) {
  const res = await api.patch<ApiSuccess<{ ticket: Ticket }>>(`/tickets/${id}/tags`, { tags });
  return res.data.data.ticket;
}

export async function assignTicketToSelfRequest(id: string) {
  const res = await api.post<ApiSuccess<{ ticket: Ticket }>>(`/tickets/${id}/assign`);
  return res.data.data.ticket;
}

export async function reassignTicketRequest(id: string, agentId: string) {
  const res = await api.post<ApiSuccess<{ ticket: Ticket }>>(`/tickets/${id}/reassign`, { agentId });
  return res.data.data.ticket;
}

export async function uploadAttachmentRequest(id: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await api.post<ApiSuccess<{ ticket: Ticket }>>(`/tickets/${id}/attachments`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data.data.ticket;
}

// A plain <a href="..."> can't carry our Authorization header, so a direct
// link to this URL would 401 - instead we fetch the file THROUGH axios
// (which does attach the header) as a blob, then hand the browser a
// temporary local object URL to save it. Revoking that URL after the click
// avoids leaking memory for large files across a long session.
export async function downloadAttachment(ticketId: string, attachmentId: string, filename: string) {
  const res = await api.get(`/tickets/${ticketId}/attachments/${attachmentId}`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function analyzeTicketWithAiRequest(ticketId: string) {
  const res = await api.post<ApiSuccess<{ analysis: TicketAiAnalysis }>>(`/tickets/${ticketId}/ai-analyze`);
  return res.data.data.analysis;
}

export async function listCommentsRequest(ticketId: string) {
  const res = await api.get<ApiSuccess<{ comments: Comment[] }>>(`/tickets/${ticketId}/comments`);
  return res.data.data.comments;
}

export async function addCommentRequest(ticketId: string, text: string, isInternal: boolean) {
  const res = await api.post<ApiSuccess<{ comment: Comment }>>(`/tickets/${ticketId}/comments`, { text, isInternal });
  return res.data.data.comment;
}
