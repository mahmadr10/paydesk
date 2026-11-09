import { Schema, model, Document, Types } from "mongoose";

// The audit log is what makes this a "production system" rather than a toy:
// a permanent, append-only record of who did what to which record, and what
// changed. Nothing ever updates or deletes an AuditLog entry - services only
// ever create new ones. That immutability is the whole point: it's a trail,
// not a cache.
export interface IAuditLog extends Document {
  _id: Types.ObjectId;
  actor: Types.ObjectId | null; // null = system-triggered (e.g. auto-transition), not a human
  action: string; // e.g. "TICKET_CREATED", "STATUS_CHANGED", "PRIORITY_CHANGED"
  entity: string; // e.g. "Ticket"
  entityId: Types.ObjectId;
  oldValue: unknown;
  newValue: unknown;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

const auditLogSchema = new Schema<IAuditLog>({
  actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
  action: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: { type: Schema.Types.ObjectId, required: true, index: true },
  oldValue: { type: Schema.Types.Mixed, default: null },
  newValue: { type: Schema.Types.Mixed, default: null },
  metadata: { type: Schema.Types.Mixed, default: {} },
  timestamp: { type: Date, default: Date.now, index: true },
});

export const AuditLog = model<IAuditLog>("AuditLog", auditLogSchema);
