import { Schema, model, Document, Types } from "mongoose";

// The "notifications" collection the spec suggests directly - previously
// covered only by ephemeral Socket.IO events (fine for "I'm looking at the
// screen right now," useless for "what did I miss since I logged off"). A
// real collection means notifications persist, survive a refresh, and can
// be marked read/unread - the first consumer is the SLA breach background
// job (jobs/slaBreachJob.ts), but the shape is generic enough for any
// future notification type, not SLA-specific.
export type NotificationType = "SLA_BREACH_RESPONSE" | "SLA_BREACH_RESOLUTION";

export interface INotification extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId; // recipient
  type: NotificationType;
  message: string;
  ticket: Types.ObjectId | null;
  read: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, required: true },
  message: { type: String, required: true },
  ticket: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },
  read: { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now, index: true },
});

// Serves "my unread notifications, newest first" - the one query pattern
// the notification bell actually runs.
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

export const Notification = model<INotification>("Notification", notificationSchema);
