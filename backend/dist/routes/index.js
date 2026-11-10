"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authRoutes_1 = __importDefault(require("./authRoutes"));
const ticketRoutes_1 = __importDefault(require("./ticketRoutes"));
const adminRoutes_1 = __importDefault(require("./adminRoutes"));
const auditLogRoutes_1 = __importDefault(require("./auditLogRoutes"));
const dashboardRoutes_1 = __importDefault(require("./dashboardRoutes"));
const categoryRoutes_1 = __importDefault(require("./categoryRoutes"));
const notificationRoutes_1 = __importDefault(require("./notificationRoutes"));
const paymentRoutes_1 = __importDefault(require("./paymentRoutes"));
const disputeRoutes_1 = __importDefault(require("./disputeRoutes"));
const webhookRoutes_1 = __importDefault(require("./webhookRoutes"));
const router = (0, express_1.Router)();
router.use("/webhooks", webhookRoutes_1.default); // no login: PayPal calls it, signature-verified
router.use("/payments", paymentRoutes_1.default);
router.use("/disputes", disputeRoutes_1.default);
router.use("/auth", authRoutes_1.default);
router.use("/tickets", ticketRoutes_1.default);
router.use("/categories", categoryRoutes_1.default);
router.use("/admin", adminRoutes_1.default);
router.use("/audit-logs", auditLogRoutes_1.default);
router.use("/dashboard", dashboardRoutes_1.default);
router.use("/notifications", notificationRoutes_1.default);
exports.default = router;
