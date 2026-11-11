"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const logger_1 = require("../observability/logger");
const paypalService_1 = require("../services/paypalService");
const disputeService_1 = require("../services/disputeService");
const background_1 = require("../utils/background");
// PayPal calls this URL (set it in developer.paypal.com → your app →
// Webhooks) for CUSTOMER.DISPUTE.* and PAYMENT.CAPTURE.* events. Each event
// is verified with PayPal before we act on it.
const router = (0, express_1.Router)();
router.post("/paypal", async (req, res) => {
    const event = req.body;
    if ((0, paypalService_1.paypalMode)() !== "sandbox") {
        res.status(400).json({ success: false, error: { code: "NOT_CONFIGURED", message: "PayPal keys are not configured." } });
        return;
    }
    let verified = false;
    try {
        verified = await (0, paypalService_1.verifyWebhookSignature)(req.headers, event);
    }
    catch (err) {
        logger_1.logger.error({ err }, "Webhook verification call failed");
    }
    if (!verified) {
        logger_1.logger.warn({ type: event?.event_type }, "Rejected unverified PayPal webhook");
        res.status(400).json({ success: false, error: { code: "INVALID_SIGNATURE", message: "Webhook signature not verified." } });
        return;
    }
    // Answer PayPal quickly; process right after (kept alive on Vercel).
    res.status(200).json({ success: true });
    (0, background_1.runInBackground)((0, disputeService_1.handleWebhookEvent)(event, "paypal", true), "Webhook processing");
});
exports.default = router;
