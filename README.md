# PayDesk - AI co-pilot for PayPal sellers

Small online sellers lose money on PayPal disputes and refund requests: they answer too late, without evidence, or refund when they would have won. **PayDesk handles both with AI agents, and a human always approves before money moves.**

- **Disputes arrive by PayPal webhook** → a case opens with PayPal's real response deadline → the **dispute agent** reads the dispute from PayPal, gathers evidence from the store's records (payment, delivery, download log, support history) and recommends **accept / partial-refund offer / contest**, with a win estimate, a drafted note and an evidence file → the seller clicks **Approve** → PayPal is answered through the Disputes API.
- **Refund requests**: a buyer types their problem in plain words ("I was charged twice for the UI kit"). The AI finds the right PayPal payment and opens a case, and the **refund agent** checks the payment live in PayPal and proposes a full or partial refund, or asks for details → **Approve** → refund through the PayPal Payments API.
- **Ask PayPal**: a chat over the seller's PayPal account, built on **PayPal's Agent Toolkit**, read-only by design.

## How PayPal is used

| PayPal product / API | Used for |
|---|---|
| **PayPal JS SDK** (Smart Buttons) | Buyer checkout in the demo store |
| **PayPal Server SDK** (`@paypal/paypal-server-sdk`, APIMatic-generated) - Orders v2 | Create + capture orders (`OrdersController`) |
| **PayPal Server SDK** - Payments v2 | Live capture lookup + refunds (`PaymentsController`), idempotent via `PayPal-Request-Id` |
| **Disputes API v1** | Read disputes, accept claim, make offer, provide evidence (multipart), sandbox adjudicate |
| **Webhooks** + `verify-webhook-signature` | `CUSTOMER.DISPUTE.*` events open and update cases. Every event is verified with PayPal and stored once (idempotent). |
| **PayPal Agent Toolkit** (`@paypal/agent-toolkit`) | "Ask PayPal" chat tools: disputes, transactions, orders, refunds, invoices, insights (read-only) |

The PayPal Server SDK integration was written with **APIMatic's Context Plugin for PayPal** (`paypaldev/server-sdk-context-plugin-preview`). Its TypeScript skills guided client setup (single long-lived `Client`, `clientCredentialsAuthCredentials`, `oAuthClockSkew`), named-argument calls, timeouts/retries and `ApiError` handling. Its resilience skill caught a real bug: SDK retries never happen unless `maximumRetryWaitTime` is also set, because its generated default is 0. Its testing skill gave the stub-transport seam used in `paypalService.sandbox.test.ts`. See `backend/src/services/paypalService.ts`.

## How AI is used (and kept safe)

Both agents are **LangGraph** pipelines on **Groq** (`openai/gpt-oss-120b`):

```
gather facts (PayPal API + records) → AI decision → policy guard (code) → draft reply → PROPOSAL → human Approve → PayPal
```

- **Policy guard** is plain code the AI can't argue with. It enforces the refund window, never refunds more than is left, blocks contesting "not received" without download proof, only uses actions PayPal currently allows, and holds refunds for customers with 3+ refunds in 90 days (abuse check).
- **Evidence files are built from records by code, never written by the AI**, so the agent can't invent evidence.
- **Approve is atomic** (PENDING → PROCESSING claim): a double-click can't refund twice.
- Customers never see the agent's internal reasoning.
- No Groq key? The same graphs run with rule-based decisions.

## Run it locally (about 2 minutes)

Needs Node 20+. No database or PayPal account required for a first look.

```bash
cd backend
cp .env.example .env      # set MONGODB_URI=memory, JWT_ACCESS_SECRET=anything-long, GROQ_API_KEY=... (optional)
npm install
npm run dev               # http://localhost:4000
```

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

1. Register a **Buyer** (role Customer) → **Shop** → buy something → **My orders** → Download → **Open PayPal dispute**.
2. Register a **Seller** (role Agent) in another browser profile → **Co-pilot** shows the dispute and the agent's recommendation → open it → **Approve**.
3. Try **My orders → "Problem with an order?"** as the buyer for the refund agent, and **Ask PayPal** as the seller.

Without PayPal keys a built-in simulator stands in for PayPal (the UI says so). The simulated disputes and webhooks follow the same code path as real ones.

### With the real PayPal sandbox

1. developer.paypal.com → Apps & Credentials → Sandbox → create an app → put the Client ID and Secret in `backend/.env`.
2. Buy from the shop with a **sandbox personal account** (Smart Buttons appear automatically).
3. Open a dispute as that buyer on **sandbox.paypal.com** → Activity → the payment → Report a problem.
4. Webhooks: deploy the backend (e.g. Render, `render.yaml` included), add a webhook to your sandbox app pointing to `https://<backend>/api/v1/webhooks/paypal` for `CUSTOMER.DISPUTE.*`, and set `PAYPAL_WEBHOOK_ID`. Locally, use **Sync disputes from PayPal** on the dashboard instead.

## Tests

```bash
cd backend && npm test    # 70 tests: unit + integration (real HTTP, in-memory MongoDB)
```

These cover buy → capture → smart intake → duplicate detection → approve → refund → resolved; dispute → evidence → contest → adjudication; the policy guard; double-approve protection; and cross-customer access. The real PayPal code path (Server SDK + Disputes REST) is also tested against a stub transport, so the sandbox integration is checked without network access.

**Free to run:** Groq free tier, PayPal Sandbox, MongoDB Atlas M0, Render free plan (sleeps after 15 min idle, so the first load takes about 30 seconds).

## Stack

React + TypeScript + Vite + Tailwind · Node + Express + TypeScript · MongoDB (Mongoose) · Socket.IO live updates · LangGraph + Groq · PayPal Server SDK, Disputes API, Webhooks, JS SDK, Agent Toolkit · Vitest + Supertest · Docker + Render.

## What was built during the hackathon

PayDesk is built on our earlier support-desk project (auth, roles, case workflow, audit log, live updates; see `ARCHITECTURE.md`). Everything PayPal- and agent-related was built during the hackathon (Oct–Nov 2026): the store + checkout, PayPal Server SDK integration, disputes + webhooks, both AI agents with policy guards and approval flow, smart intake, the Agent Toolkit assistant, and the seller co-pilot UI.

## License

MIT, see [LICENSE](LICENSE).
