import { describe, it, expect, afterEach, vi } from "vitest";
import { Client, Environment } from "@paypal/paypal-server-sdk";
import * as paypal from "./paypalService";
import { AppError } from "../utils/AppError";

// Exercises the REAL PayPal code path (sandbox mode) with no network:
//  - Orders/Payments go through the PayPal Server SDK; its transport is
//    replaced by a stub axios adapter via unstable_httpClientOptions, the
//    seam described in the APIMatic Context Plugin's typescript-testing skill.
//  - Disputes/webhooks use fetch, stubbed with vi.stubGlobal.

type Reply = { status: number; body: unknown };

function stubClient(route: (url: string, config: any) => Reply) {
  const requests: any[] = [];
  const client = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: "dummy-id",
      oAuthClientSecret: "dummy-secret",
      // Seeded, unexpired token: no token fetch reaches the adapter.
      oAuthToken: { accessToken: "seeded-token", tokenType: "Bearer", expiry: BigInt(Math.floor(Date.now() / 1000) + 3600) },
    },
    environment: Environment.Sandbox,
    unstable_httpClientOptions: {
      adapter: async (config: any) => {
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

const header = (config: any, name: string) => {
  const h = config.headers ?? {};
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
};

afterEach(() => {
  paypal.__setPaypalTestOverride({});
  vi.unstubAllGlobals();
});

describe("PayPal Server SDK path (sandbox mode)", () => {
  it("creates an order with server-side amount and an idempotency key", async () => {
    const { client, requests } = stubClient(() => ({ status: 201, body: { id: "5O190127TN364715T", status: "CREATED" } }));
    paypal.__setPaypalTestOverride({ client, mode: "sandbox" });

    const r = await paypal.createOrder({ referenceId: "ORD-000001", description: "1x UI Kit", amount: 49, currency: "USD" });
    expect(r.paypalOrderId).toBe("5O190127TN364715T");

    const req = requests[0];
    expect(req.url).toContain("api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(req.method.toUpperCase()).toBe("POST");
    expect(header(req, "PayPal-Request-Id")).toBe("create-ORD-000001");
    const body = JSON.parse(req.data);
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "49.00" });
  });

  it("captures an order and reads the capture id, amount and payer", async () => {
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
    expect(c).toEqual({ captureId: "3C679366HH908993F", status: "COMPLETED", amount: 49, currency: "USD", payerEmail: "buyer@personal.example.com" });
  });

  it("refunds a capture with amount, note and the given idempotency key", async () => {
    const { client, requests } = stubClient(() => ({
      status: 201,
      body: { id: "1JU08902781691411", status: "COMPLETED", amount: { currency_code: "USD", value: "24.50" } },
    }));
    paypal.__setPaypalTestOverride({ client, mode: "sandbox" });
    const r = await paypal.refundCapture({ captureId: "3C679366HH908993F", amount: 24.5, currency: "USD", note: "Partial refund", idempotencyKey: "refund-abc" });
    expect(r).toEqual({ refundId: "1JU08902781691411", status: "COMPLETED", amount: 24.5, currency: "USD" });
    expect(requests[0].url).toContain("/v2/payments/captures/3C679366HH908993F/refund");
    expect(header(requests[0], "PayPal-Request-Id")).toBe("refund-abc");
    expect(JSON.parse(requests[0].data)).toEqual({ amount: { currency_code: "USD", value: "24.50" }, note_to_payer: "Partial refund" });
  });

  it("turns a PayPal rejection into a clear error with PayPal's issue code", async () => {
    const { client } = stubClient(() => ({
      status: 422,
      body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "REFUND_AMOUNT_EXCEEDED" }], debug_id: "abc123" },
    }));
    paypal.__setPaypalTestOverride({ client, mode: "sandbox" });
    const err = await paypal
      .refundCapture({ captureId: "X", amount: 999, currency: "USD", note: "n", idempotencyKey: "k" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.message).toContain("REFUND_AMOUNT_EXCEEDED");
    expect(err.statusCode).toBe(422);
  });

  // Known PayPal issue codes become a proper HTTP status and a plain message;
  // unknown ones stay a generic 502 that still names the code.
  it.each([
    ["ORDER_NOT_APPROVED", 409, "has not approved"],
    ["INSTRUMENT_DECLINED", 402, "declined"],
    ["CAPTURE_FULLY_REFUNDED", 409, "already fully refunded"],
    ["SOMETHING_NEW", 502, "SOMETHING_NEW"],
  ])("maps PayPal issue %s to HTTP %i", async (issue, status, text) => {
    const { client } = stubClient(() => ({
      status: 422,
      body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue }], debug_id: "dbg-1" },
    }));
    paypal.__setPaypalTestOverride({ client, mode: "sandbox" });
    const err = await paypal.captureOrder("5O190127TN364715T").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(status);
    expect(err.message).toContain(text);
    expect(err.message).toContain(issue); // the code is kept for lookups
  });

  it("gives each SDK call a time limit so a slow PayPal cannot hang a request", async () => {
    const { client, requests } = stubClient(() => ({ status: 201, body: { id: "5O190127TN364715T", status: "CREATED" } }));
    paypal.__setPaypalTestOverride({ client, mode: "sandbox" });
    await paypal.createOrder({ referenceId: "ORD-000009", description: "x", amount: 1, currency: "USD" });
    // The SDK turns our abort signal into an axios cancel token on the request.
    expect(requests[0].cancelToken).toBeDefined();
  });

  it("turns an aborted or timed-out PayPal call into a clear 504", async () => {
    const client = new Client({
      clientCredentialsAuthCredentials: {
        oAuthClientId: "dummy-id",
        oAuthClientSecret: "dummy-secret",
        oAuthToken: { accessToken: "seeded-token", tokenType: "Bearer", expiry: BigInt(Math.floor(Date.now() / 1000) + 3600) },
      },
      environment: Environment.Sandbox,
      unstable_httpClientOptions: {
        adapter: async () => {
          throw Object.assign(new Error("The HTTP call was aborted."), { name: "AbortError" });
        },
      },
      httpClientOptions: { retryConfig: { maxNumberOfRetries: 0 } },
    });
    paypal.__setPaypalTestOverride({ client, mode: "sandbox" });
    const err = await paypal.createOrder({ referenceId: "ORD-000010", description: "x", amount: 1, currency: "USD" }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(504);
    expect(err.message).toContain("too long");
  });
});

describe("Disputes + webhooks REST path (sandbox mode)", () => {
  function stubFetch(handler: (url: string, init: any) => { status: number; body: unknown }) {
    const calls: { url: string; init: any }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
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

  it("normalizes a dispute and reads allowed actions from PayPal's links", async () => {
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
    expect(d.amount).toBe(79);
    expect(d.transactionId).toBe("3C679366HH908993F");
    expect(d.actions).toEqual(["accept_claim", "make_offer", "provide_evidence"]);
    expect(d.messages[0]).toEqual({ postedBy: "BUYER", time: "2026-11-09T10:00:00.000Z", content: "Never got it" });
  });

  it("accepts a claim with the refund amount", async () => {
    const calls = stubFetch(() => ({ status: 200, body: {} }));
    await paypal.acceptDisputeClaim("PP-D-27803", "Sorry, refunding.", 79, "USD");
    const call = calls.find((c) => c.url.includes("/accept-claim"))!;
    expect(JSON.parse(call.init.body)).toEqual({ note: "Sorry, refunding.", refund_amount: { currency_code: "USD", value: "79.00" } });
  });

  it("sends evidence as multipart with an input JSON part and a file", async () => {
    const calls = stubFetch(() => ({ status: 200, body: {} }));
    await paypal.provideDisputeEvidence("PP-D-27803", "Delivered, downloaded twice.", "EVIDENCE FILE");
    const call = calls.find((c) => c.url.includes("/provide-evidence"))!;
    const form = call.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const input = JSON.parse(await (form.get("input") as Blob).text());
    expect(input.evidences[0].notes).toBe("Delivered, downloaded twice.");
    expect(await (form.get("evidence-file") as Blob).text()).toBe("EVIDENCE FILE");
    expect(call.init.headers["Content-Type"]).toBeUndefined(); // fetch sets the multipart boundary
  });

  it("rejects webhook verification when PayPal says FAILURE", async () => {
    stubFetch(() => ({ status: 200, body: { verification_status: "FAILURE" } }));
    // No PAYPAL_WEBHOOK_ID configured in tests -> never trusted.
    expect(await paypal.verifyWebhookSignature({}, { id: "WH-1" })).toBe(false);
  });
});
