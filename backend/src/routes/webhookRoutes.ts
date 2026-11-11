import { Router } from "express";
import { logger } from "../observability/logger";
import { paypalMode, verifyWebhookSignature } from "../services/paypalService";
import { handleWebhookEvent } from "../services/disputeService";
import { runInBackground } from "../utils/background";

// PayPal calls this URL (set it in developer.paypal.com → your app →
// Webhooks) for CUSTOMER.DISPUTE.* and PAYMENT.CAPTURE.* events. Each event
// is verified with PayPal before we act on it.
const router = Router();

router.post("/paypal", async (req, res) => {
  const event = req.body;
  if (paypalMode() !== "sandbox") {
    res.status(400).json({ success: false, error: { code: "NOT_CONFIGURED", message: "PayPal keys are not configured." } });
    return;
  }
  let verified = false;
  try {
    verified = await verifyWebhookSignature(req.headers as Record<string, string>, event);
  } catch (err) {
    logger.error({ err }, "Webhook verification call failed");
  }
  if (!verified) {
    logger.warn({ type: event?.event_type }, "Rejected unverified PayPal webhook");
    res.status(400).json({ success: false, error: { code: "INVALID_SIGNATURE", message: "Webhook signature not verified." } });
    return;
  }
  // Answer PayPal quickly; process right after (kept alive on Vercel).
  res.status(200).json({ success: true });
  runInBackground(handleWebhookEvent(event, "paypal", true), "Webhook processing");
});

export default router;
