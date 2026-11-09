import { Comment } from "../models/Comment";

export function createComment(data: {
  ticket: string;
  author: string;
  authorRole: "CUSTOMER" | "AGENT" | "ADMIN";
  text: string;
  isInternal: boolean;
}) {
  return Comment.create(data);
}

// includeInternal is false for a customer's view - internal notes never
// even reach the query result, rather than being filtered out afterwards.
export function findCommentsForTicket(ticketId: string, includeInternal: boolean) {
  const query: Record<string, unknown> = { ticket: ticketId };
  if (!includeInternal) query.isInternal = false;
  return Comment.find(query).sort({ createdAt: 1 }).populate("author", "name email");
}

export function findFirstAgentComment(ticketId: string) {
  return Comment.findOne({ ticket: ticketId, authorRole: { $in: ["AGENT", "ADMIN"] } }).sort({ createdAt: 1 });
}
