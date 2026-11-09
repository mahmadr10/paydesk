import { Schema, model, Document } from "mongoose";

// Every PayPal webhook we receive. Unique eventId = idempotent processing
// (PayPal retries), and the list is the live "PayPal events" feed in the UI.
export interface IWebhookEvent extends Document {
  eventId: string;
  eventType: string;
  resourceId: string | null;
  verified: boolean;
  source: "paypal" | "simulated";
  result: string;
  receivedAt: Date;
}

const webhookEventSchema = new Schema<IWebhookEvent>({
  eventId: { type: String, required: true, unique: true },
  eventType: { type: String, required: true },
  resourceId: { type: String, default: null },
  verified: { type: Boolean, default: false },
  source: { type: String, enum: ["paypal", "simulated"], required: true },
  result: { type: String, default: "" },
  receivedAt: { type: Date, default: Date.now, index: true },
});

export const WebhookEvent = model<IWebhookEvent>("WebhookEvent", webhookEventSchema);
