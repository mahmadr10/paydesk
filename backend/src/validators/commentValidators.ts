import { z } from "zod";

export const createCommentSchema = z.object({
  text: z.string().trim().min(1, "Comment cannot be empty").max(2000),
  // Only an agent/admin request is allowed to set this true - enforced in
  // the controller (a customer's request body is not trusted to self-report
  // "isInternal: false", but a customer trying to set it true is rejected).
  isInternal: z.boolean().default(false),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
