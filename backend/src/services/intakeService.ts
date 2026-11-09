import { Order } from "../models/Order";
import { listActiveCategories } from "../repositories/categoryRepository";
import { runIntake } from "../ai/intakeAgent";
import { logAction } from "./auditLogService";
import { createTicket } from "./ticketService";
import { runAgentInBackground } from "./refundService";

// One message in, one ready-to-handle ticket out:
//   customer message → intake AI picks the order + title/category/priority
//   → ticket created and linked to that PayPal order
//   → refund agent starts in the background, so staff see a proposal waiting.
export async function smartIntake(customerId: string, message: string) {
  const [orders, categories] = await Promise.all([
    Order.find({ customer: customerId, status: { $ne: "CREATED" } }).sort({ paidAt: -1 }).limit(20),
    listActiveCategories(),
  ]);

  const intake = await runIntake(
    message,
    orders.map((o) => ({
      id: o._id.toString(),
      orderNumber: o.orderNumber,
      itemNames: o.items.map((i) => i.name),
      total: o.total,
      currency: o.currency,
      paidAt: o.paidAt,
    })),
    categories.map((c) => c.name)
  );

  const ticket = await createTicket(customerId, {
    title: intake.title.length >= 3 ? intake.title : "Payment issue",
    description: message,
    category: intake.category,
    priority: intake.priority,
    tags: ["smart-intake"],
    orderId: intake.orderId ?? undefined,
  });

  await logAction({
    actor: customerId,
    action: "SMART_INTAKE",
    entity: "Ticket",
    entityId: String(ticket._id),
    newValue: { orderId: intake.orderId, category: intake.category, priority: intake.priority },
    metadata: { source: intake.source, matchReason: intake.matchReason },
  });

  if (intake.orderId) runAgentInBackground(String(ticket._id));

  const order = orders.find((o) => o._id.toString() === intake.orderId);
  return {
    ticket,
    intake: { ...intake, orderNumber: order?.orderNumber ?? null },
  };
}
