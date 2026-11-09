import { Router } from "express";
import * as paymentController from "../controllers/paymentController";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { mongoIdParamSchema } from "../validators/ticketValidators";
import { createOrderSchema, listOrdersQuerySchema } from "../validators/paymentValidators";

const router = Router();

// Public: the PayPal client id is meant to be public (it's in the SDK script tag).
router.get("/config", paymentController.getConfig);
router.get("/catalog", paymentController.getCatalog);

router.use(requireAuth);

router.get("/stats", requireRole("AGENT", "ADMIN"), paymentController.refundStats);
router.get("/orders", validate(listOrdersQuerySchema, "query"), paymentController.listOrders);
router.post("/orders", requireRole("CUSTOMER"), validate(createOrderSchema), paymentController.createOrder);
router.get("/orders/:id", validate(mongoIdParamSchema, "params"), paymentController.getOrder);
router.post(
  "/orders/:id/capture",
  requireRole("CUSTOMER"),
  validate(mongoIdParamSchema, "params"),
  paymentController.captureOrder
);

export default router;
