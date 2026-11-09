import { env } from "../config/env";
import { CATALOG, findProduct } from "../config/catalog";
import { Order, IOrder } from "../models/Order";
import { nextSequence } from "../models/Counter";
import { AppError } from "../utils/AppError";
import { JwtPayload } from "../utils/jwt";
import { logAction } from "./auditLogService";
import * as paypal from "./paypalService";

export function getPaymentsConfig() {
  return {
    mode: paypal.paypalMode(),
    // The client id is public by design (it goes into the PayPal JS SDK
    // script tag). The secret never leaves the server.
    clientId: paypal.paypalMode() === "sandbox" ? env.PAYPAL_CLIENT_ID : null,
    currency: env.PAYPAL_CURRENCY,
    refundWindowDays: env.REFUND_WINDOW_DAYS,
  };
}

export function getCatalog() {
  return CATALOG;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function createOrder(customerId: string, items: { sku: string; quantity: number }[]) {
  const lineItems = items.map((i) => {
    const product = findProduct(i.sku);
    if (!product) throw new AppError(400, "INVALID_PRODUCT", `Unknown product: ${i.sku}`);
    return { sku: product.sku, name: product.name, unitPrice: product.price, quantity: i.quantity };
  });
  const total = round2(lineItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0));
  const orderNumber = `ORD-${String(await nextSequence("order")).padStart(6, "0")}`;

  const { paypalOrderId } = await paypal.createOrder({
    referenceId: orderNumber,
    description: lineItems.map((i) => `${i.quantity}x ${i.name}`).join(", "),
    amount: total,
    currency: env.PAYPAL_CURRENCY,
  });

  const order = await Order.create({
    orderNumber,
    customer: customerId,
    items: lineItems,
    total,
    currency: env.PAYPAL_CURRENCY,
    status: "CREATED",
    paypalMode: paypal.paypalMode(),
    paypalOrderId,
  });

  await logAction({
    actor: customerId,
    action: "ORDER_CREATED",
    entity: "Order",
    entityId: order._id.toString(),
    newValue: { orderNumber, total, paypalOrderId },
  });
  return order;
}

async function findOwnOrderOr404(orderId: string, user: JwtPayload) {
  const order = await Order.findById(orderId);
  if (!order) throw new AppError(404, "NOT_FOUND", "Order not found.");
  if (user.role === "CUSTOMER" && order.customer.toString() !== user.userId) {
    throw new AppError(403, "FORBIDDEN", "You can only access your own orders.");
  }
  return order;
}

export async function captureOrder(orderId: string, user: JwtPayload) {
  const order = await findOwnOrderOr404(orderId, user);
  if (order.status !== "CREATED") return order; // already captured: safe to call twice

  const capture = await paypal.captureOrder(order.paypalOrderId);
  if (capture.status !== "COMPLETED") {
    throw new AppError(402, "PAYMENT_NOT_COMPLETED", `PayPal reports the payment as ${capture.status}.`);
  }
  order.captureId = capture.captureId;
  order.payerEmail = capture.payerEmail;
  order.status = "COMPLETED";
  order.paidAt = new Date();
  // Digital goods are delivered instantly (download link unlocked).
  order.fulfillment = { deliveredAt: new Date(), accessCount: 0, lastAccessAt: null };
  await order.save();

  await logAction({
    actor: user.userId,
    action: "PAYMENT_CAPTURED",
    entity: "Order",
    entityId: order._id.toString(),
    newValue: { captureId: capture.captureId, amount: capture.amount },
  });
  return order;
}

export async function listOrders(user: JwtPayload, onlyPaid: boolean) {
  const query: Record<string, unknown> = {};
  if (user.role === "CUSTOMER") query.customer = user.userId;
  if (onlyPaid) query.status = { $ne: "CREATED" };
  return Order.find(query).sort({ createdAt: -1 }).limit(100).populate("customer", "name email");
}

export async function getOrder(orderId: string, user: JwtPayload) {
  const order = await findOwnOrderOr404(orderId, user);
  return order.populate("customer", "name email");
}

// The buyer opened their download. Logged as dispute evidence.
export async function recordAccess(orderId: string, user: JwtPayload) {
  const order = await findOwnOrderOr404(orderId, user);
  if (order.status === "CREATED") throw new AppError(400, "NOT_PAID", "This order isn't paid yet.");
  if (order.status === "REFUNDED") throw new AppError(403, "REFUNDED", "This order was refunded, so access was removed.");
  const now = new Date();
  await Order.updateOne(
    { _id: order._id },
    { $inc: { "fulfillment.accessCount": 1 }, $set: { "fulfillment.lastAccessAt": now } }
  );
  await logAction({
    actor: user.userId,
    action: "DOWNLOAD_ACCESSED",
    entity: "Order",
    entityId: order._id.toString(),
    newValue: { at: now.toISOString() },
  });
  return {
    orderNumber: order.orderNumber,
    files: order.items.map((i) => `${i.sku.toLowerCase()}-v1.zip`),
    note: "Demo store: these are placeholder download links.",
  };
}

export function refundableAmount(order: IOrder) {
  return round2(order.total - order.refundedTotal);
}

// Single place where money actually goes back to the customer. Called only
// from an explicit human approval (see refundService.approveProposal).
export async function refundOrder(input: {
  order: IOrder;
  amount: number;
  reason: string;
  ticketId: string | null;
  approvedBy: string;
  idempotencyKey: string;
}) {
  const { order, amount } = input;
  if (!order.captureId) throw new AppError(400, "NOT_PAID", "This order was never paid, so it can't be refunded.");
  if (amount <= 0) throw new AppError(400, "INVALID_AMOUNT", "Refund amount must be greater than zero.");
  if (amount > refundableAmount(order) + 0.001) {
    throw new AppError(400, "INVALID_AMOUNT", `At most ${refundableAmount(order)} ${order.currency} can still be refunded.`);
  }

  const refund = await paypal.refundCapture({
    captureId: order.captureId,
    amount: round2(amount),
    currency: order.currency,
    note: input.reason,
    idempotencyKey: input.idempotencyKey,
  });

  order.refunds.push({
    refundId: refund.refundId,
    amount: refund.amount,
    status: refund.status,
    reason: input.reason,
    ticket: input.ticketId as any,
    approvedBy: input.approvedBy as any,
    createdAt: new Date(),
  });
  order.refundedTotal = round2(order.refundedTotal + refund.amount);
  order.status = order.refundedTotal >= order.total - 0.001 ? "REFUNDED" : "PARTIALLY_REFUNDED";
  await order.save();

  await logAction({
    actor: input.approvedBy,
    action: "REFUND_ISSUED",
    entity: "Order",
    entityId: order._id.toString(),
    newValue: { refundId: refund.refundId, amount: refund.amount, status: refund.status },
    metadata: { ticketId: input.ticketId },
  });
  return refund;
}
