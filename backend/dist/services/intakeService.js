"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.smartIntake = smartIntake;
const Order_1 = require("../models/Order");
const categoryRepository_1 = require("../repositories/categoryRepository");
const intakeAgent_1 = require("../ai/intakeAgent");
const auditLogService_1 = require("./auditLogService");
const ticketService_1 = require("./ticketService");
const refundService_1 = require("./refundService");
// One message in, one ready-to-handle ticket out:
//   customer message → intake AI picks the order + title/category/priority
//   → ticket created and linked to that PayPal order
//   → refund agent starts in the background, so staff see a proposal waiting.
async function smartIntake(customerId, message) {
    const [orders, categories] = await Promise.all([
        Order_1.Order.find({ customer: customerId, status: { $ne: "CREATED" } }).sort({ paidAt: -1 }).limit(20),
        (0, categoryRepository_1.listActiveCategories)(),
    ]);
    const intake = await (0, intakeAgent_1.runIntake)(message, orders.map((o) => ({
        id: o._id.toString(),
        orderNumber: o.orderNumber,
        itemNames: o.items.map((i) => i.name),
        total: o.total,
        currency: o.currency,
        paidAt: o.paidAt,
    })), categories.map((c) => c.name));
    const ticket = await (0, ticketService_1.createTicket)(customerId, {
        title: intake.title.length >= 3 ? intake.title : "Payment issue",
        description: message,
        category: intake.category,
        priority: intake.priority,
        tags: ["smart-intake"],
        orderId: intake.orderId ?? undefined,
    });
    await (0, auditLogService_1.logAction)({
        actor: customerId,
        action: "SMART_INTAKE",
        entity: "Ticket",
        entityId: String(ticket._id),
        newValue: { orderId: intake.orderId, category: intake.category, priority: intake.priority },
        metadata: { source: intake.source, matchReason: intake.matchReason },
    });
    if (intake.orderId)
        (0, refundService_1.runAgentInBackground)(String(ticket._id));
    const order = orders.find((o) => o._id.toString() === intake.orderId);
    return {
        ticket,
        intake: { ...intake, orderNumber: order?.orderNumber ?? null },
    };
}
