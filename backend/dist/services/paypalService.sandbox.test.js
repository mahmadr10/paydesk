"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const paypal_server_sdk_1 = require("@paypal/paypal-server-sdk");
const paypal = __importStar(require("./paypalService"));
const AppError_1 = require("../utils/AppError");
function stubClient(route) {
    const requests = [];
    const client = new paypal_server_sdk_1.Client({
        clientCredentialsAuthCredentials: {
            oAuthClientId: "dummy-id",
            oAuthClientSecret: "dummy-secret",
            // Seeded, unexpired token: no token fetch reaches the adapter.
            oAuthToken: { accessToken: "seeded-token", tokenType: "Bearer", expiry: BigInt(Math.floor(Date.now() / 1000) + 3600) },
        },
        environment: paypal_server_sdk_1.Environment.Sandbox,
        unstable_httpClientOptions: {
            adapter: async (config) => {
                requests.push(config);
                const r = route(config.url, config);
                return {
                    data: typeof r.body === "string" ? r.body : JSON.stringify(r.body),
                    status: r.status,
                    statusText: "",
                    headers: { "content-type": "application/json" },
                    config,
                };
            },
        },
        httpClientOptions: { retryConfig: { maxNumberOfRetries: 0 } },
    });
    return { client, requests };
}
const header = (config, name) => {
    const h = config.headers ?? {};
    const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? h[key] : undefined;
};
(0, vitest_1.afterEach)(() => {
    paypal.__setPaypalTestOverride({});
    vitest_1.vi.unstubAllGlobals();
});
(0, vitest_1.describe)("PayPal Server SDK path (sandbox mode)", () => {
    (0, vitest_1.it)("creates an order with server-side amount and an idempotency key", async () => {
        const { client, requests } = stubClient(() => ({ status: 201, body: { id: "5O190127TN364715T", status: "CREATED" } }));
        paypal.__setPaypalTestOverride({ client, mode: "sandbox" });
        const r = await paypal.createOrder({ referenceId: "ORD-000001", description: "1x UI Kit", amount: 49, currency: "USD" });
        (0, vitest_1.expect)(r.paypalOrderId).toBe("5O190127TN364715T");
        const req = requests[0];
        (0, vitest_1.expect)(req.url).toContain("api-m.sandbox.paypal.com/v2/checkout/orders");
        (0, vitest_1.expect)(req.method.toUpperCase()).toBe("POST");
        (0, vitest_1.expect)(header(req, "PayPal-Request-Id")).toBe("create-ORD-000001");
        const body = JSON.parse(req.data);
        (0, vitest_1.expect)(body.intent).toBe("CAPTURE");
        (0, vitest_1.expect)(body.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "49.00" });
    });
    (0, vitest_1.it)("captures an order and reads the capture id, amount and payer", async () => {
        const { client } = stubClient(() => ({
            status: 201,
            body: {
                id: "5O190127TN364715T",
                status: "COMPLETED",
                payer: { email_address: "buyer@personal.example.com" },
                purchase_units: [{ payments: { captures: [{ id: "3C679366HH908993F", status: "COMPLETED", amount: { currency_code: "USD", value: "49.00" } }] } }],
            },
        }));
        paypal.__setPaypalTestOverride({ client, mode: "sandbox" });
        const c = await paypal.captureOrder("5O190127TN364715T");
        (0, vitest_1.expect)(c).toEqual({ captureId: "3C679366HH908993F", status: "COMPLETED", amount: 49, currency: "USD", payerEmail: "buyer@personal.example.com" });
    });
    (0, vitest_1.it)("refunds a capture with amount, note and the given idempotency key", async () => {
        const { client, requests } = stubClient(() => ({
            status: 201,
            body: { id: "1JU08902781691411", status: "COMPLETED", amount: { currency_code: "USD", value: "24.50" } },
        }));
        paypal.__setPaypalTestOverride({ client, mode: "sandbox" });
        const r = await paypal.refundCapture({ captureId: "3C679366HH908993F", amount: 24.5, currency: "USD", note: "Partial refund", idempotencyKey: "refund-abc" });
        (0, vitest_1.expect)(r).toEqual({ refundId: "1JU08902781691411", status: "COMPLETED", amount: 24.5, currency: "USD" });
        (0, vitest_1.expect)(requests[0].url).toContain("/v2/payments/captures/3C679366HH908993F/refund");
        (0, vitest_1.expect)(header(requests[0], "PayPal-Request-Id")).toBe("refund-abc");
        (0, vitest_1.expect)(JSON.parse(requests[0].data)).toEqual({ amount: { currency_code: "USD", value: "24.50" }, note_to_payer: "Partial refund" });
    });
    (0, vitest_1.it)("turns a PayPal rejection into a clear error with PayPal's issue code", async () => {
        const { client } = stubClient(() => ({
            status: 422,
            body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "REFUND_AMOUNT_EXCEEDED" }], debug_id: "abc123" },
        }));
        paypal.__setPaypalTestOverride({ client, mode: "sandbox" });
        const err = await paypal
            .refundCapture({ captureId: "X", amount: 999, currency: "USD", note: "n", idempotencyKey: "k" })
            .catch((e) => e);
        (0, vitest_1.expect)(err).toBeInstanceOf(AppError_1.AppError);
        (0, vitest_1.expect)(err.message).toContain("REFUND_AMOUNT_EXCEEDED");
    });
});
(0, vitest_1.describe)("Disputes + webhooks REST path (sandbox mode)", () => {
    function stubFetch(handler) {
        const calls = [];
        vitest_1.vi.stubGlobal("fetch", async (url, init) => {
            calls.push({ url, init });
            if (url.endsWith("/v1/oauth2/token")) {
                return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
            }
            const r = handler(url, init);
            return new Response(JSON.stringify(r.body), { status: r.status });
        });
        paypal.__setPaypalTestOverride({ mode: "sandbox" });
        return calls;
    }
    (0, vitest_1.it)("normalizes a dispute and reads allowed actions from PayPal's links", async () => {
        stubFetch(() => ({
            status: 200,
            body: {
                dispute_id: "PP-D-27803",
                reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                status: "WAITING_FOR_SELLER_RESPONSE",
                dispute_life_cycle_stage: "INQUIRY",
                dispute_amount: { currency_code: "USD", value: "79.00" },
                seller_response_due_date: "2026-11-20T10:00:00.000Z",
                disputed_transactions: [{ seller_transaction_id: "3C679366HH908993F", buyer: { name: "Ali Buyer" } }],
                messages: [{ posted_by: "BUYER", time_posted: "2026-11-09T10:00:00.000Z", content: "Never got it" }],
                links: [{ rel: "self" }, { rel: "accept_claim" }, { rel: "make_offer" }, { rel: "provide_evidence" }],
            },
        }));
        const d = await paypal.getDispute("PP-D-27803");
        (0, vitest_1.expect)(d.amount).toBe(79);
        (0, vitest_1.expect)(d.transactionId).toBe("3C679366HH908993F");
        (0, vitest_1.expect)(d.actions).toEqual(["accept_claim", "make_offer", "provide_evidence"]);
        (0, vitest_1.expect)(d.messages[0]).toEqual({ postedBy: "BUYER", time: "2026-11-09T10:00:00.000Z", content: "Never got it" });
    });
    (0, vitest_1.it)("accepts a claim with the refund amount", async () => {
        const calls = stubFetch(() => ({ status: 200, body: {} }));
        await paypal.acceptDisputeClaim("PP-D-27803", "Sorry, refunding.", 79, "USD");
        const call = calls.find((c) => c.url.includes("/accept-claim"));
        (0, vitest_1.expect)(JSON.parse(call.init.body)).toEqual({ note: "Sorry, refunding.", refund_amount: { currency_code: "USD", value: "79.00" } });
    });
    (0, vitest_1.it)("sends evidence as multipart with an input JSON part and a file", async () => {
        const calls = stubFetch(() => ({ status: 200, body: {} }));
        await paypal.provideDisputeEvidence("PP-D-27803", "Delivered, downloaded twice.", "EVIDENCE FILE");
        const call = calls.find((c) => c.url.includes("/provide-evidence"));
        const form = call.init.body;
        (0, vitest_1.expect)(form).toBeInstanceOf(FormData);
        const input = JSON.parse(await form.get("input").text());
        (0, vitest_1.expect)(input.evidences[0].notes).toBe("Delivered, downloaded twice.");
        (0, vitest_1.expect)(await form.get("evidence-file").text()).toBe("EVIDENCE FILE");
        (0, vitest_1.expect)(call.init.headers["Content-Type"]).toBeUndefined(); // fetch sets the multipart boundary
    });
    (0, vitest_1.it)("rejects webhook verification when PayPal says FAILURE", async () => {
        stubFetch(() => ({ status: 200, body: { verification_status: "FAILURE" } }));
        // No PAYPAL_WEBHOOK_ID configured in tests -> never trusted.
        (0, vitest_1.expect)(await paypal.verifyWebhookSignature({}, { id: "WH-1" })).toBe(false);
    });
});
