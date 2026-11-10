import { Router, Request, Response } from "express";
import { checkSlaBreaches } from "../jobs/slaBreachJob";
import { env } from "../config/env";
import { logger } from "../observability/logger";

const router = Router();

// Endpoint for Vercel Cron or external schedulers to trigger SLA breach detection
router.all("/sla-breach", async (req: Request, res: Response) => {
  if (env.CRON_SECRET) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
      res.status(401).json({ success: false, message: "Unauthorized: Invalid cron secret" });
      return;
    }
  }

  try {
    const result = await checkSlaBreaches();
    res.json({
      success: true,
      message: "SLA breach check completed",
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error }, "Error running SLA breach cron endpoint");
    res.status(500).json({
      success: false,
      message: "Failed to run SLA breach check",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
