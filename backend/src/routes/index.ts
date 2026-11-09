import { Router } from "express";
import authRoutes from "./authRoutes";
import ticketRoutes from "./ticketRoutes";
import adminRoutes from "./adminRoutes";
import auditLogRoutes from "./auditLogRoutes";
import dashboardRoutes from "./dashboardRoutes";
import categoryRoutes from "./categoryRoutes";
import notificationRoutes from "./notificationRoutes";
import paymentRoutes from "./paymentRoutes";
import disputeRoutes from "./disputeRoutes";
import webhookRoutes from "./webhookRoutes";

const router = Router();

router.use("/webhooks", webhookRoutes); // no login: PayPal calls it, signature-verified
router.use("/payments", paymentRoutes);
router.use("/disputes", disputeRoutes);

router.use("/auth", authRoutes);
router.use("/tickets", ticketRoutes);
router.use("/categories", categoryRoutes);
router.use("/admin", adminRoutes);
router.use("/audit-logs", auditLogRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/notifications", notificationRoutes);

export default router;
