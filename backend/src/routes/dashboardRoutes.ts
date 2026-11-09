import { Router } from "express";
import * as dashboardController from "../controllers/dashboardController";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

// Agents get a dashboard too (their own workload view), admins get the
// full picture - both roles are allowed here, customers are not.
router.use(requireAuth, requireRole("AGENT", "ADMIN"));

router.get("/summary", dashboardController.getSummary);
router.get("/analytics", dashboardController.getAnalytics);

export default router;
