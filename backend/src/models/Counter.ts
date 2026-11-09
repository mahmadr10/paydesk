import { Schema, model, Document } from "mongoose";

// MongoDB's ObjectIds aren't human-friendly ("TCK-000042" reads a lot
// better on a support ticket than "691a2f...").  This is the standard
// Mongo "auto-increment" recipe: one document per counter name, incremented
// atomically with $inc so two tickets created at the same instant can never
// get the same number (the increment happens as a single atomic database
// operation, not a read-then-write).
//
// Its _id is a plain string (the counter's name, e.g. "ticket") instead of
// the usual ObjectId, so this interface deliberately does NOT extend
// Document<ObjectId> - that would conflict on the _id type.
export interface ICounter extends Document<string> {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const Counter = model<ICounter>("Counter", counterSchema);

export async function nextSequence(name: string): Promise<number> {
  const counter = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return counter!.seq;
}
