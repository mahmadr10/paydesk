"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const slaBreachJob_1 = require("../jobs/slaBreachJob");
const env_1 = require("../config/env");
const logger_1 = require("../observability/logger");
const router = (0, express_1.Router)();
// Endpoint for Vercel Cron or external schedulers to trigger SLA breach detection
router.all("/sla-breach", async (req, res) => {
    if (env_1.env.CRON_SECRET) {
        const authHeader = req.headers.authorization;
        if (authHeader !== `Bearer ${env_1.env.CRON_SECRET}`) {
            res.status(401).json({ success: false, message: "Unauthorized: Invalid cron secret" });
            return;
        }
    }
    try {
        const result = await (0, slaBreachJob_1.checkSlaBreaches)();
        res.json({
            success: true,
            message: "SLA breach check completed",
            data: result,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        logger_1.logger.error({ error }, "Error running SLA breach cron endpoint");
        res.status(500).json({
            success: false,
            message: "Failed to run SLA breach check",
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
exports.default = router;
