import { Schema, model, Document, Types } from "mongoose";

export const ORDER_STATUSES = ["CREATED", "COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface IOrderItem {
  sku: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export interface IOrderRefund {
  refundId: string; // PayPal refund id
  amount: number;
  status: string;
  reason: string;
  ticket: Types.ObjectId | null;
  approvedBy: Types.ObjectId | null;
  createdAt: Date;
}

export interface IOrder extends Document {
  _id: Types.ObjectId;
  orderNumber: string; // e.g. "ORD-000042"
  customer: Types.ObjectId;
  items: IOrderItem[];
  total: number;
  currency: string;
  status: OrderStatus;
  paypalMode: "sandbox" | "simulated";
  paypalOrderId: string;
  captureId: string | null;
  payerEmail: string | null;
  paidAt: Date | null;
  refundedTotal: number;
  refunds: IOrderRefund[];
  // Digital delivery record: the strongest evidence against a "never
  // received it" dispute is proof the buyer actually downloaded it.
  fulfillment: { deliveredAt: Date | null; accessCount: number; lastAccessAt: Date | null };
  createdAt: Date;
  updatedAt: Date;
}

const itemSchema = new Schema<IOrderItem>(
  {
    sku: { type: String, required: true },
    name: { type: String, required: true },
    unitPrice: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const refundSchema = new Schema<IOrderRefund>(
  {
    refundId: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, required: true },
    reason: { type: String, default: "" },
    ticket: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true, unique: true },
    customer: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: { type: [itemSchema], required: true },
    total: { type: Number, required: true },
    currency: { type: String, required: true },
    status: { type: String, enum: ORDER_STATUSES, default: "CREATED", index: true },
    paypalMode: { type: String, enum: ["sandbox", "simulated"], required: true },
    paypalOrderId: { type: String, required: true, unique: true },
    captureId: { type: String, default: null },
    payerEmail: { type: String, default: null },
    paidAt: { type: Date, default: null },
    refundedTotal: { type: Number, default: 0 },
    refunds: { type: [refundSchema], default: [] },
    fulfillment: {
      deliveredAt: { type: Date, default: null },
      accessCount: { type: Number, default: 0 },
      lastAccessAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ captureId: 1 }); // disputes reference the capture id

export const Order = model<IOrder>("Order", orderSchema);
