import { Schema, model, Document, Types } from "mongoose";

export interface IComment extends Document {
  _id: Types.ObjectId;
  ticket: Types.ObjectId;
  author: Types.ObjectId;
  authorRole: "CUSTOMER" | "AGENT" | "ADMIN";
  text: string;
  // Internal notes are agent/admin-only - visible to support staff, hidden
  // from the customer entirely (e.g. "escalating this to the payments
  // team, customer seems frustrated"). Enforced in commentService, not just
  // hidden in the UI: a customer's list-comments call filters these out
  // server-side before the response is even built.
  isInternal: boolean;
  createdAt: Date;
}

const commentSchema = new Schema<IComment>(
  {
    ticket: { type: Schema.Types.ObjectId, ref: "Ticket", required: true, index: true },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authorRole: { type: String, enum: ["CUSTOMER", "AGENT", "ADMIN"], required: true },
    text: { type: String, required: true, trim: true },
    isInternal: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Comment = model<IComment>("Comment", commentSchema);
