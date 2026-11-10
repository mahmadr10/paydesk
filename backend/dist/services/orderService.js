"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaymentsConfig = getPaymentsConfig;
exports.getCatalog = getCatalog;
exports.createOrder = createOrder;
exports.captureOrder = captureOrder;
exports.listOrders = listOrders;
exports.getOrder = getOrder;
exports.recordAccess = recordAccess;
exports.refundableAmount = refundableAmount;
exports.refundOrder = refundOrder;
const env_1 = require("../config/env");
const catalog_1 = require("../config/catalog");
const Order_1 = require("../models/Order");
const Counter_1 = require("../models/Counter");
const AppError_1 = require("../utils/AppError");
const auditLogService_1 = require("./auditLogService");
const paypal = __importStar(require("./paypalService"));
function getPaymentsConfig() {
    return {
        mode: paypal.paypalMode(),
        // The client id is public by design (it goes into the PayPal JS SDK
        // script tag). The secret never leaves the server.
        clientId: paypal.paypalMode() === "sandbox" ? env_1.env.PAYPAL_CLIENT_ID : null,
        currency: env_1.env.PAYPAL_CURRENCY,
        refundWindowDays: env_1.env.REFUND_WINDOW_DAYS,
    };
}
function getCatalog() {
    return catalog_1.CATALOG;
}
const round2 = (n) => Math.round(n * 100) / 100;
async function createOrder(customerId, items) {
    const lineItems = items.map((i) => {
        const product = (0, catalog_1.findProduct)(i.sku);
        if (!product)
            throw new AppError_1.AppError(400, "INVALID_PRODUCT", `Unknown product: ${i.sku}`);
        return { sku: product.sku, name: product.name, unitPrice: product.price, quantity: i.quantity };
    });
    const total = round2(lineItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0));
    const orderNumber = `ORD-${String(await (0, Counter_1.nextSequence)("order")).padStart(6, "0")}`;
    const { paypalOrderId } = await paypal.createOrder({
        referenceId: orderNumber,
        description: lineItems.map((i) => `${i.quantity}x ${i.name}`).join(", "),
        amount: total,
        currency: env_1.env.PAYPAL_CURRENCY,
    });
    const order = await Order_1.Order.create({
        orderNumber,
        customer: customerId,
        items: lineItems,
        total,
        currency: env_1.env.PAYPAL_CURRENCY,
        status: "CREATED",
        paypalMode: paypal.paypalMode(),
        paypalOrderId,
    });
    await (0, auditLogService_1.logAction)({
        actor: customerId,
        action: "ORDER_CREATED",
        entity: "Order",
        entityId: order._id.toString(),
        newValue: { orderNumber, total, paypalOrderId },
    });
    return order;
}
async function findOwnOrderOr404(orderId, user) {
    const order = await Order_1.Order.findById(orderId);
    if (!order)
        throw new AppError_1.AppError(404, "NOT_FOUND", "Order not found.");
    if (user.role === "CUSTOMER" && order.customer.toString() !== user.userId) {
        throw new AppError_1.AppError(403, "FORBIDDEN", "You can only access your own orders.");
    }
    return order;
}
async function captureOrder(orderId, user) {
    const order = await findOwnOrderOr404(orderId, user);
    if (order.status !== "CREATED")
        return order; // already captured: safe to call twice
    const capture = await paypal.captureOrder(order.paypalOrderId);
    if (capture.status !== "COMPLETED") {
        throw new AppError_1.AppError(402, "PAYMENT_NOT_COMPLETED", `PayPal reports the payment as ${capture.status}.`);
    }
    order.captureId = capture.captureId;
    order.payerEmail = capture.payerEmail;
    order.status = "COMPLETED";
    order.paidAt = new Date();
    // Digital goods are delivered instantly (download link unlocked).
    order.fulfillment = { deliveredAt: new Date(), accessCount: 0, lastAccessAt: null };
    await order.save();
    await (0, auditLogService_1.logAction)({
        actor: user.userId,
        action: "PAYMENT_CAPTURED",
        entity: "Order",
        entityId: order._id.toString(),
        newValue: { captureId: capture.captureId, amount: capture.amount },
    });
    return order;
}
async function listOrders(user, onlyPaid) {
    const query = {};
    if (user.role === "CUSTOMER")
        query.customer = user.userId;
    if (onlyPaid)
        query.status = { $ne: "CREATED" };
    return Order_1.Order.find(query).sort({ createdAt: -1 }).limit(100).populate("customer", "name email");
}
async function getOrder(orderId, user) {
    const order = await findOwnOrderOr404(orderId, user);
    return order.populate("customer", "name email");
}
// The buyer opened their download. Logged as dispute evidence.
async function recordAccess(orderId, user) {
    const order = await findOwnOrderOr404(orderId, user);
    if (order.status === "CREATED")
        throw new AppError_1.AppError(400, "NOT_PAID", "This order isn't paid yet.");
    if (order.status === "REFUNDED")
        throw new AppError_1.AppError(403, "REFUNDED", "This order was refunded, so access was removed.");
    const now = new Date();
    await Order_1.Order.updateOne({ _id: order._id }, { $inc: { "fulfillment.accessCount": 1 }, $set: { "fulfillment.lastAccessAt": now } });
    await (0, auditLogService_1.logAction)({
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
function refundableAmount(order) {
    return round2(order.total - order.refundedTotal);
}
// Single place where money actually goes back to the customer. Called only
// from an explicit human approval (see refundService.approveProposal).
async function refundOrder(input) {
    const { order, amount } = input;
    if (!order.captureId)
        throw new AppError_1.AppError(400, "NOT_PAID", "This order was never paid, so it can't be refunded.");
    if (amount <= 0)
        throw new AppError_1.AppError(400, "INVALID_AMOUNT", "Refund amount must be greater than zero.");
    if (amount > refundableAmount(order) + 0.001) {
        throw new AppError_1.AppError(400, "INVALID_AMOUNT", `At most ${refundableAmount(order)} ${order.currency} can still be refunded.`);
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
        ticket: input.ticketId,
        approvedBy: input.approvedBy,
        createdAt: new Date(),
    });
    order.refundedTotal = round2(order.refundedTotal + refund.amount);
    order.status = order.refundedTotal >= order.total - 0.001 ? "REFUNDED" : "PARTIALLY_REFUNDED";
    await order.save();
    await (0, auditLogService_1.logAction)({
        actor: input.approvedBy,
        action: "REFUND_ISSUED",
        entity: "Order",
        entityId: order._id.toString(),
        newValue: { refundId: refund.refundId, amount: refund.amount, status: refund.status },
        metadata: { ticketId: input.ticketId },
    });
    return refund;
}
