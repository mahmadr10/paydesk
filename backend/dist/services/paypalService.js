"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__setPaypalTestOverride = __setPaypalTestOverride;
exports.paypalMode = paypalMode;
exports.ensureSimulatedCapture = ensureSimulatedCapture;
exports.createOrder = createOrder;
exports.captureOrder = captureOrder;
exports.getCaptureDetails = getCaptureDetails;
exports.refundCapture = refundCapture;
exports.createSimulatedDispute = createSimulatedDispute;
exports.restoreSimulatedDispute = restoreSimulatedDispute;
exports.getDisputeRaw = getDisputeRaw;
exports.getDispute = getDispute;
exports.listDisputeIds = listDisputeIds;
exports.normalizeDispute = normalizeDispute;
exports.acceptDisputeClaim = acceptDisputeClaim;
exports.makeDisputeOffer = makeDisputeOffer;
exports.provideDisputeEvidence = provideDisputeEvidence;
exports.adjudicateDispute = adjudicateDispute;
exports.verifyWebhookSignature = verifyWebhookSignature;
const crypto_1 = require("crypto");
const paypal_server_sdk_1 = require("@paypal/paypal-server-sdk");
const env_1 = require("../config/env");
const logger_1 = require("../observability/logger");
const AppError_1 = require("../utils/AppError");
// Test seam (see the APIMatic plugin's typescript-testing skill): tests
// inject an SDK Client whose transport is a stub adapter, and force sandbox
// mode, so the real-PayPal code path is exercised with no network.
let testOverride = { client: null, mode: null };
function __setPaypalTestOverride(o) {
    testOverride = { client: o.client ?? null, mode: o.mode ?? null };
    cachedToken = null;
}
function paypalMode() {
    if (testOverride.mode)
        return testOverride.mode;
    return env_1.env.PAYPAL_CLIENT_ID && env_1.env.PAYPAL_CLIENT_SECRET ? "sandbox" : "simulated";
}
const money = (n) => n.toFixed(2);
// ── PayPal Server SDK client (built once, reused) ────────────────────────
let sdkClient = null;
// Sends the SDK's own request/response log lines into our structured logger
// (built-in logging, from the APIMatic plugin's resilience skill). Request
// headers and all bodies are NOT logged. The response's paypal-debug-id header
// is, so a failed call can be traced with PayPal support.
const sdkLogger = {
    log(level, message, params) {
        const method = level === paypal_server_sdk_1.LogLevel.Error ? "error" : level === paypal_server_sdk_1.LogLevel.Warn ? "warn" : level === paypal_server_sdk_1.LogLevel.Debug ? "debug" : "info";
        logger_1.logger[method]({ paypalSdk: params }, message);
    },
};
// Upper bound for ONE SDK call including its retries (a retry round on its own
// can take 45 s). The resilience skill's abortSignal; it does not cover the
// separate token request, which has its own 15 s timeout.
const CALL_TIMEOUT_MS = 25_000;
const callOptions = () => ({ abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
function sdk() {
    if (testOverride.client)
        return testOverride.client;
    if (!sdkClient) {
        sdkClient = new paypal_server_sdk_1.Client({
            clientCredentialsAuthCredentials: {
                oAuthClientId: env_1.env.PAYPAL_CLIENT_ID,
                oAuthClientSecret: env_1.env.PAYPAL_CLIENT_SECRET,
                oAuthClockSkew: 60, // refresh the token a minute before it expires
            },
            environment: env_1.env.PAYPAL_API_BASE.includes("sandbox") ? paypal_server_sdk_1.Environment.Sandbox : paypal_server_sdk_1.Environment.Production,
            // SDK defaults are "no timeout, no retries" (timeout 0 = unlimited).
            // Per the APIMatic plugin's resilience skill, retries only happen when
            // the backoff fits inside maximumRetryWaitTime, whose generated default
            // is 0, so it must be set alongside maxNumberOfRetries. POST is safe to
            // retry here because every POST we send carries a PayPal-Request-Id.
            timeout: 30000,
            httpClientOptions: {
                timeout: 15000,
                retryConfig: {
                    maxNumberOfRetries: 2,
                    maximumRetryWaitTime: 10,
                    backoffFactor: 2,
                    httpMethodsToRetry: ["GET", "PUT", "POST"],
                },
            },
            logging: {
                logger: sdkLogger,
                logLevel: paypal_server_sdk_1.LogLevel.Info,
                logRequest: { logBody: false, logHeaders: false },
                // headersToWhitelist un-masks just this one header (the debug id is not a secret).
                logResponse: { logBody: false, logHeaders: true, headersToInclude: ["paypal-debug-id"], headersToWhitelist: ["paypal-debug-id"] },
                maskSensitiveHeaders: true,
            },
        });
    }
    return sdkClient;
}
// What the common PayPal issue codes mean for a user: a proper HTTP status and
// a plain message (instead of one generic 502 for everything). The code stays
// in brackets so it can still be looked up.
const PAYPAL_ISSUES = {
    ORDER_NOT_APPROVED: { status: 409, message: "The buyer has not approved this payment in PayPal yet." },
    ORDER_ALREADY_CAPTURED: { status: 409, message: "This payment was already completed." },
    INSTRUMENT_DECLINED: { status: 402, message: "PayPal declined this payment method. Try another one." },
    PAYER_ACTION_REQUIRED: { status: 409, message: "The buyer needs to finish an extra step in PayPal." },
    CAPTURE_FULLY_REFUNDED: { status: 409, message: "This payment was already fully refunded." },
    REFUND_AMOUNT_EXCEEDED: { status: 422, message: "That refund is more than what is left on this payment." },
    RESOURCE_NOT_FOUND: { status: 404, message: "PayPal could not find that payment." },
};
function issueToError(issue, what) {
    const known = PAYPAL_ISSUES[issue];
    if (known)
        return new AppError_1.AppError(known.status, "PAYPAL_ERROR", `${known.message} (${issue})`);
    return new AppError_1.AppError(502, "PAYPAL_ERROR", `PayPal rejected the ${what} (${issue}).`);
}
function isTimeout(err) {
    const e = err;
    if (!e)
        return false;
    return (e.name === "AbortError" ||
        e.name === "TimeoutError" ||
        e.name === "CanceledError" ||
        e.code === "ERR_CANCELED" ||
        e.code === "ECONNABORTED" ||
        /timeout|timed out|aborted/i.test(String(e.message ?? "")));
}
// Turn an SDK error into our AppError. An ApiError carries PayPal's issue code
// in its payload (snake_case field names, as the error-handling skill warns).
function fromSdkError(err, what) {
    if (err instanceof paypal_server_sdk_1.ApiError) {
        let issue = `HTTP ${err.statusCode}`;
        try {
            const payload = (err.result ?? (typeof err.body === "string" ? JSON.parse(err.body) : null));
            issue = payload?.details?.[0]?.issue ?? payload?.name ?? issue;
            logger_1.logger.error({ status: err.statusCode, issue, debugId: payload?.debug_id }, `PayPal ${what} failed`);
        }
        catch {
            logger_1.logger.error({ status: err.statusCode }, `PayPal ${what} failed`);
        }
        throw issueToError(issue, what);
    }
    if (isTimeout(err)) {
        logger_1.logger.error({ what }, `PayPal ${what} timed out`);
        throw new AppError_1.AppError(504, "PAYPAL_TIMEOUT", "PayPal took too long to answer. Please try again in a moment.");
    }
    throw err;
}
// ── Raw REST (for APIs the SDK doesn't cover) ────────────────────────────
let cachedToken = null;
async function getAccessToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000)
        return cachedToken.value;
    const basic = Buffer.from(`${env_1.env.PAYPAL_CLIENT_ID}:${env_1.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
    const res = await fetch(`${env_1.env.PAYPAL_API_BASE}/v1/oauth2/token`, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
    });
    if (!res.ok) {
        logger_1.logger.error({ status: res.status }, "PayPal OAuth token request failed");
        throw new AppError_1.AppError(502, "PAYPAL_AUTH_FAILED", "Could not authenticate with PayPal. Check the sandbox credentials.");
    }
    const json = (await res.json());
    cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
}
async function paypalRest(path, init) {
    const headers = { Authorization: `Bearer ${await getAccessToken()}` };
    if (!init.form)
        headers["Content-Type"] = "application/json";
    if (init.requestId)
        headers["PayPal-Request-Id"] = init.requestId;
    const res = await fetch(`${env_1.env.PAYPAL_API_BASE}${path}`, {
        method: init.method,
        headers,
        body: init.form ?? (init.body ? JSON.stringify(init.body) : undefined),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
        const detail = json?.details?.[0]?.issue ?? json?.name ?? `HTTP ${res.status}`;
        logger_1.logger.error({ status: res.status, path, detail, debugId: json?.debug_id }, "PayPal REST call failed");
        throw new AppError_1.AppError(502, "PAYPAL_ERROR", `PayPal rejected the request (${detail}).`);
    }
    return json;
}
const simOrders = new Map();
const simCaptures = new Map();
const simId = (prefix) => `${prefix}-SIM-${(0, crypto_1.randomUUID)().slice(0, 8).toUpperCase()}`;
// The simulator keeps state in memory, so after a restart it rebuilds a
// capture from our saved order. No-op when talking to real PayPal.
function ensureSimulatedCapture(order) {
    if (paypalMode() !== "simulated" || !order.captureId || simCaptures.has(order.captureId))
        return;
    simCaptures.set(order.captureId, {
        amount: order.total,
        currency: order.currency,
        refunded: order.refundedTotal,
        createTime: (order.paidAt ?? new Date()).toISOString(),
    });
}
// ── Orders & payments (SDK) ──────────────────────────────────────────────
async function createOrder(input) {
    if (paypalMode() === "simulated") {
        const id = simId("ORDER");
        simOrders.set(id, { amount: input.amount, currency: input.currency });
        return { paypalOrderId: id };
    }
    try {
        const { result } = await new paypal_server_sdk_1.OrdersController(sdk()).createOrder({
            body: {
                intent: paypal_server_sdk_1.CheckoutPaymentIntent.Capture,
                purchaseUnits: [
                    {
                        referenceId: input.referenceId,
                        customId: input.referenceId,
                        description: input.description.slice(0, 127),
                        amount: { currencyCode: input.currency, value: money(input.amount) },
                    },
                ],
            },
            paypalRequestId: `create-${input.referenceId}`,
            prefer: "return=minimal",
        }, callOptions());
        if (!result.id)
            throw new AppError_1.AppError(502, "PAYPAL_ERROR", "PayPal did not return an order id.");
        return { paypalOrderId: result.id };
    }
    catch (err) {
        fromSdkError(err, "order creation");
    }
}
async function captureOrder(paypalOrderId) {
    if (paypalMode() === "simulated") {
        const order = simOrders.get(paypalOrderId);
        if (!order)
            throw new AppError_1.AppError(404, "NOT_FOUND", "Simulated PayPal order not found.");
        const captureId = simId("CAPTURE");
        simCaptures.set(captureId, { ...order, refunded: 0, createTime: new Date().toISOString() });
        return { captureId, status: "COMPLETED", amount: order.amount, currency: order.currency, payerEmail: "buyer@simulated.paypal" };
    }
    try {
        const { result } = await new paypal_server_sdk_1.OrdersController(sdk()).captureOrder({
            id: paypalOrderId,
            paypalRequestId: `capture-${paypalOrderId}`,
            prefer: "return=representation",
        }, callOptions());
        const capture = result.purchaseUnits?.[0]?.payments?.captures?.[0];
        if (!capture?.id || !capture.amount)
            throw new AppError_1.AppError(502, "PAYPAL_ERROR", "PayPal did not return a capture.");
        return {
            captureId: capture.id,
            status: String(capture.status ?? "UNKNOWN"),
            amount: Number(capture.amount.value),
            currency: capture.amount.currencyCode,
            payerEmail: result.payer?.emailAddress ?? null,
        };
    }
    catch (err) {
        fromSdkError(err, "payment capture");
    }
}
// Live lookup used by the agents, so decisions use what PayPal says now.
async function getCaptureDetails(captureId) {
    if (paypalMode() === "simulated") {
        const c = simCaptures.get(captureId);
        if (!c)
            throw new AppError_1.AppError(404, "NOT_FOUND", "Simulated PayPal capture not found.");
        const status = c.refunded <= 0 ? "COMPLETED" : c.refunded >= c.amount ? "REFUNDED" : "PARTIALLY_REFUNDED";
        return { captureId, status, amount: c.amount, currency: c.currency, createTime: c.createTime };
    }
    try {
        const { result } = await new paypal_server_sdk_1.PaymentsController(sdk()).getCapturedPayment({ captureId }, callOptions());
        return {
            captureId: result.id ?? captureId,
            status: String(result.status ?? "UNKNOWN"),
            amount: Number(result.amount?.value ?? 0),
            currency: result.amount?.currencyCode ?? env_1.env.PAYPAL_CURRENCY,
            createTime: result.createTime ?? new Date().toISOString(),
        };
    }
    catch (err) {
        fromSdkError(err, "capture lookup");
    }
}
async function refundCapture(input) {
    if (paypalMode() === "simulated") {
        const c = simCaptures.get(input.captureId);
        if (!c)
            throw new AppError_1.AppError(404, "NOT_FOUND", "Simulated PayPal capture not found.");
        if (c.refunded + input.amount > c.amount + 0.001) {
            throw issueToError("REFUND_AMOUNT_EXCEEDED", "refund");
        }
        c.refunded += input.amount;
        return { refundId: simId("REFUND"), status: "COMPLETED", amount: input.amount, currency: input.currency };
    }
    try {
        const { result } = await new paypal_server_sdk_1.PaymentsController(sdk()).refundCapturedPayment({
            captureId: input.captureId,
            paypalRequestId: input.idempotencyKey,
            prefer: "return=representation",
            body: {
                amount: { currencyCode: input.currency, value: money(input.amount) },
                noteToPayer: input.note.slice(0, 255),
            },
        }, callOptions());
        return {
            refundId: result.id ?? "unknown",
            status: String(result.status ?? "UNKNOWN"),
            amount: Number(result.amount?.value ?? input.amount),
            currency: result.amount?.currencyCode ?? input.currency,
        };
    }
    catch (err) {
        fromSdkError(err, "refund");
    }
}
function normalizeDispute(d) {
    const tx = d.disputed_transactions?.[0] ?? {};
    return {
        disputeId: d.dispute_id,
        reason: d.reason ?? "OTHER",
        status: d.status ?? "OPEN",
        stage: d.dispute_life_cycle_stage ?? "INQUIRY",
        amount: Number(d.dispute_amount?.value ?? 0),
        currency: d.dispute_amount?.currency_code ?? env_1.env.PAYPAL_CURRENCY,
        sellerResponseDue: d.seller_response_due_date ?? null,
        createTime: d.create_time ?? new Date().toISOString(),
        updateTime: d.update_time ?? new Date().toISOString(),
        transactionId: tx.seller_transaction_id ?? null,
        buyerName: tx.buyer?.name ?? null,
        messages: (d.messages ?? []).map((m) => ({ postedBy: m.posted_by, time: m.time_posted, content: m.content })),
        outcome: d.dispute_outcome
            ? {
                code: d.dispute_outcome.outcome_code,
                amountRefunded: d.dispute_outcome.amount_refunded ? Number(d.dispute_outcome.amount_refunded.value) : null,
            }
            : null,
        actions: (d.links ?? []).map((l) => l.rel).filter((r) => r && r !== "self"),
    };
}
// Simulated disputes look exactly like PayPal's JSON so the same code reads both.
const simDisputes = new Map();
function simLinks(status, stage) {
    if (status === "RESOLVED")
        return [];
    if (status === "UNDER_REVIEW")
        return ["adjudicate"];
    const rels = ["accept_claim", "provide_evidence", "send_message"];
    if (stage === "INQUIRY")
        rels.push("make_offer", "escalate");
    return rels;
}
function simSetStatus(d, status, stage) {
    d.status = status;
    if (stage)
        d.dispute_life_cycle_stage = stage;
    d.update_time = new Date().toISOString();
    d.links = simLinks(d.status, d.dispute_life_cycle_stage).map((rel) => ({ rel }));
}
function createSimulatedDispute(input) {
    const now = new Date();
    const d = {
        dispute_id: `PP-D-SIM-${(0, crypto_1.randomUUID)().slice(0, 6).toUpperCase()}`,
        create_time: now.toISOString(),
        update_time: now.toISOString(),
        reason: input.reason,
        status: "WAITING_FOR_SELLER_RESPONSE",
        dispute_life_cycle_stage: "INQUIRY",
        dispute_channel: "INTERNAL",
        dispute_amount: { currency_code: input.currency, value: money(input.amount) },
        seller_response_due_date: new Date(now.getTime() + 10 * 86_400_000).toISOString(),
        disputed_transactions: [{ seller_transaction_id: input.captureId, buyer: { name: input.buyerName } }],
        messages: [{ posted_by: "BUYER", time_posted: now.toISOString(), content: input.buyerMessage }],
    };
    simSetStatus(d, d.status);
    simDisputes.set(d.dispute_id, d);
    return d;
}
// Rebuild a simulated dispute from our database copy after a restart.
function restoreSimulatedDispute(raw) {
    if (paypalMode() === "simulated" && raw?.dispute_id && !simDisputes.has(raw.dispute_id)) {
        simDisputes.set(raw.dispute_id, structuredClone(raw));
    }
}
function simDisputeOr404(id) {
    const d = simDisputes.get(id);
    if (!d)
        throw new AppError_1.AppError(404, "NOT_FOUND", "Simulated dispute not found.");
    return d;
}
async function getDisputeRaw(disputeId) {
    if (paypalMode() === "simulated")
        return structuredClone(simDisputeOr404(disputeId));
    return paypalRest(`/v1/customer/disputes/${encodeURIComponent(disputeId)}`, { method: "GET" });
}
async function getDispute(disputeId) {
    return normalizeDispute(await getDisputeRaw(disputeId));
}
async function listDisputeIds() {
    if (paypalMode() === "simulated")
        return [...simDisputes.keys()];
    const res = await paypalRest(`/v1/customer/disputes?page_size=50`, { method: "GET" });
    return (res.items ?? []).map((i) => i.dispute_id);
}
// Refund the buyer and close the dispute in their favour.
async function acceptDisputeClaim(disputeId, note, amount, currency) {
    if (paypalMode() === "simulated") {
        const d = simDisputeOr404(disputeId);
        const refunded = amount ?? Number(d.dispute_amount.value);
        d.dispute_outcome = { outcome_code: "RESOLVED_BUYER_FAVOUR", amount_refunded: { currency_code: currency, value: money(refunded) } };
        d.messages.push({ posted_by: "SELLER", time_posted: new Date().toISOString(), content: note });
        simSetStatus(d, "RESOLVED");
        return;
    }
    await paypalRest(`/v1/customer/disputes/${encodeURIComponent(disputeId)}/accept-claim`, {
        method: "POST",
        requestId: `accept-${disputeId}`,
        body: {
            note: note.slice(0, 2000),
            ...(amount !== null ? { refund_amount: { currency_code: currency, value: money(amount) } } : {}),
        },
    });
}
// Offer a partial refund to settle an inquiry.
async function makeDisputeOffer(disputeId, note, amount, currency) {
    if (paypalMode() === "simulated") {
        const d = simDisputeOr404(disputeId);
        d.offer = { seller_offered_amount: { currency_code: currency, value: money(amount) }, offer_type: "REFUND" };
        d.messages.push({ posted_by: "SELLER", time_posted: new Date().toISOString(), content: note });
        simSetStatus(d, "WAITING_FOR_BUYER_RESPONSE");
        return;
    }
    await paypalRest(`/v1/customer/disputes/${encodeURIComponent(disputeId)}/make-offer`, {
        method: "POST",
        requestId: `offer-${disputeId}-${money(amount)}`,
        body: { note: note.slice(0, 2000), offer_amount: { currency_code: currency, value: money(amount) }, offer_type: "REFUND" },
    });
}
// Contest the dispute: send our written case plus an evidence file.
async function provideDisputeEvidence(disputeId, notes, evidenceText) {
    if (paypalMode() === "simulated") {
        const d = simDisputeOr404(disputeId);
        d.evidences = [...(d.evidences ?? []), { evidence_type: "OTHER", notes, date: new Date().toISOString() }];
        d.messages.push({ posted_by: "SELLER", time_posted: new Date().toISOString(), content: notes });
        simSetStatus(d, "UNDER_REVIEW", d.dispute_life_cycle_stage === "INQUIRY" ? "CHARGEBACK" : undefined);
        return;
    }
    const form = new FormData();
    form.append("input", new Blob([JSON.stringify({ evidences: [{ evidence_type: "OTHER", notes: notes.slice(0, 2000) }] })], {
        type: "application/json",
    }));
    form.append("evidence-file", new Blob([evidenceText], { type: "text/plain" }), "paydesk-evidence.txt");
    await paypalRest(`/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`, { method: "POST", form });
}
// Sandbox only: make PayPal decide a dispute that's under review.
async function adjudicateDispute(disputeId, outcome) {
    if (paypalMode() === "simulated") {
        const d = simDisputeOr404(disputeId);
        d.dispute_outcome =
            outcome === "SELLER_FAVOR"
                ? { outcome_code: "RESOLVED_SELLER_FAVOUR" }
                : { outcome_code: "RESOLVED_BUYER_FAVOUR", amount_refunded: d.dispute_amount };
        simSetStatus(d, "RESOLVED");
        return;
    }
    await paypalRest(`/v1/customer/disputes/${encodeURIComponent(disputeId)}/adjudicate`, {
        method: "POST",
        body: { adjudication_outcome: outcome },
    });
}
// ── Webhooks ─────────────────────────────────────────────────────────────
// Asks PayPal to confirm a webhook really came from PayPal.
async function verifyWebhookSignature(headers, event) {
    if (!env_1.env.PAYPAL_WEBHOOK_ID)
        return false;
    const res = await paypalRest("/v1/notifications/verify-webhook-signature", {
        method: "POST",
        body: {
            auth_algo: headers["paypal-auth-algo"],
            cert_url: headers["paypal-cert-url"],
            transmission_id: headers["paypal-transmission-id"],
            transmission_sig: headers["paypal-transmission-sig"],
            transmission_time: headers["paypal-transmission-time"],
            webhook_id: env_1.env.PAYPAL_WEBHOOK_ID,
            webhook_event: event,
        },
    });
    return res.verification_status === "SUCCESS";
}
