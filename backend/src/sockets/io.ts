import { Server } from "socket.io";
import { ITicket } from "../models/Ticket";

let ioInstance: Server | null = null;

export function setIO(io: Server) {
  ioInstance = io;
}

// Broadcasts a ticket change to everyone who should see it live:
//  - the ticket's customer (their own room, "user:<id>") - so their ticket
//    view updates without a refresh.
//  - every agent/admin ("agents" room) - so the Ticket Queue updates live,
//    and specifically so that if Agent A reassigns a ticket to Agent B,
//    Agent B sees it appear without refreshing (the spec's exact example).
// Everyone in the "agents" room gets the SAME event; the frontend doesn't
// need per-agent targeting since agents can see all tickets anyway.
export function emitTicketUpdated(ticket: ITicket) {
  if (!ioInstance) return;
  const payload = ticket.toJSON();
  ioInstance.to(`user:${ticket.customer.toString()}`).emit("ticket:updated", payload);
  ioInstance.to("agents").emit("ticket:updated", payload);
}

export function emitNewTicket(ticket: ITicket) {
  if (!ioInstance) return;
  ioInstance.to("agents").emit("ticket:created", ticket.toJSON());
}

// Streams the AI Dev Assistant's live progress to the ONE admin who asked
// the question (their own "user:<id>" room - same room every other
// per-user event already uses) - not broadcast to "agents", since this is
// that one admin's own investigation, not something every agent needs to
// see. This is what lets the frontend show agents "lighting up" in
// real time instead of a single blocking spinner.
// New notification for one user (see jobs/slaBreachJob.ts) - the SAME
// per-user "user:<id>" room every other targeted event in this app uses,
// not a new mechanism invented for this feature.
export function emitNotification(userId: string, notification: unknown) {
  if (!ioInstance) return;
  ioInstance.to(`user:${userId}`).emit("notification:new", notification);
}

export function emitDevAssistantStep(
  userId: string,
  step: { agent: string; status: "running" | "done"; summary?: string }
) {
  if (!ioInstance) return;
  ioInstance.to(`user:${userId}`).emit("devAssistant:step", step);
}
