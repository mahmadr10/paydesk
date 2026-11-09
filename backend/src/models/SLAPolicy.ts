import { Schema, model, Document, Types } from "mongoose";
import { TicketPriority } from "./Ticket";

// One SLA (Service Level Agreement) policy per priority level: how fast we
// promise to first respond, and how fast we promise to fully resolve. An
// admin can tune these numbers; the SLA engine (services/slaService.ts)
// reads them to compute each ticket's deadlines.
export interface ISLAPolicy extends Document {
  _id: Types.ObjectId;
  priority: TicketPriority;
  responseMinutes: number;
  resolutionMinutes: number;
}

const slaPolicySchema = new Schema<ISLAPolicy>({
  priority: { type: String, required: true, unique: true },
  responseMinutes: { type: Number, required: true, min: 1 },
  resolutionMinutes: { type: Number, required: true, min: 1 },
});

export const SLAPolicy = model<ISLAPolicy>("SLAPolicy", slaPolicySchema);

// Seeded defaults (minutes) if the collection is empty - see config/seed.ts.
// CRITICAL: 15 min response / 4h resolution · HIGH: 1h / 8h ·
// MEDIUM: 4h / 24h · LOW: 8h / 72h.
export const DEFAULT_SLA_POLICIES: Record<TicketPriority, { responseMinutes: number; resolutionMinutes: number }> = {
  CRITICAL: { responseMinutes: 15, resolutionMinutes: 4 * 60 },
  HIGH: { responseMinutes: 60, resolutionMinutes: 8 * 60 },
  MEDIUM: { responseMinutes: 4 * 60, resolutionMinutes: 24 * 60 },
  LOW: { responseMinutes: 8 * 60, resolutionMinutes: 72 * 60 },
};
