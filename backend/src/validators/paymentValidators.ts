import { z } from "zod";

export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(40),
        quantity: z.coerce.number().int().min(1).max(10),
      })
    )
    .min(1)
    .max(10),
});

export const listOrdersQuerySchema = z.object({
  paid: z.enum(["true", "false"]).optional(),
});

export const approveProposalSchema = z.object({
  amount: z.coerce.number().positive().max(100000).optional(),
  customerReply: z.string().trim().max(2000).optional(),
});

export const rejectProposalSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export const smartIntakeSchema = z.object({
  message: z.string().trim().min(10, "Tell us a bit more (at least 10 characters)").max(2000),
});
