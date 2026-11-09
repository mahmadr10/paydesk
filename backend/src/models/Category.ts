import { Schema, model, Document, Types } from "mongoose";

// Categories used to be a hardcoded enum. An admin needs to "configure
// categories" per the spec, so they're now a real collection an admin can
// add to / retire - tickets store the category NAME (a string), not a
// reference id. That's a deliberate denormalization: ticket documents and
// analytics queries ("tickets by category") stay simple string
// group-bys/filters instead of needing a $lookup join on every read. The
// trade-off: renaming a category doesn't retroactively rename it on old
// tickets. For a support-ticket history, that's usually what you want
// anyway (the ticket keeps the label it had at the time).
export interface ICategory extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  isActive: boolean;
}

const categorySchema = new Schema<ICategory>({
  name: { type: String, required: true, unique: true, trim: true },
  description: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
});

export const Category = model<ICategory>("Category", categorySchema);
