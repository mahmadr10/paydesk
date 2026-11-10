"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Order = exports.ORDER_STATUSES = void 0;
const mongoose_1 = require("mongoose");
exports.ORDER_STATUSES = ["CREATED", "COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"];
const itemSchema = new mongoose_1.Schema({
    sku: { type: String, required: true },
    name: { type: String, required: true },
    unitPrice: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
}, { _id: false });
const refundSchema = new mongoose_1.Schema({
    refundId: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, required: true },
    reason: { type: String, default: "" },
    ticket: { type: mongoose_1.Schema.Types.ObjectId, ref: "Ticket", default: null },
    approvedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null },
    createdAt: { type: Date, default: Date.now },
}, { _id: false });
const orderSchema = new mongoose_1.Schema({
    orderNumber: { type: String, required: true, unique: true },
    customer: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: { type: [itemSchema], required: true },
    total: { type: Number, required: true },
    currency: { type: String, required: true },
    status: { type: String, enum: exports.ORDER_STATUSES, default: "CREATED", index: true },
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
}, { timestamps: true });
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ captureId: 1 }); // disputes reference the capture id
exports.Order = (0, mongoose_1.model)("Order", orderSchema);
