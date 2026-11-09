import { Router } from "express";
import * as notificationController from "../controllers/notificationController";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { listNotificationsQuerySchema, notificationIdParamSchema } from "../validators/notificationValidators";

const router = Router();

// Any authenticated role - a Customer can be notified too in the future
// (e.g. "your ticket was updated"); today only the SLA breach job writes
// notifications (Agents/Admins), but the read side isn't role-restricted.
router.use(requireAuth);

router.get("/", validate(listNotificationsQuerySchema, "query"), notificationController.listNotifications);
router.get("/unread-count", notificationController.getUnreadCount);
router.patch("/:id/read", validate(notificationIdParamSchema, "params"), notificationController.markRead);
router.patch("/read-all", notificationController.markAllRead);

export default router;
