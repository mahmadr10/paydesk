# Devpost submission: copy and paste

Fields are in the order Devpost shows them. Replace anything in [square brackets].

---

## 1. Project overview

**Project name**
```
PayDesk: AI co-pilot for PayPal disputes & refunds
```

**Elevator pitch** (max 200 characters)
```
AI agents that investigate PayPal disputes and refund requests, gather real evidence, and prepare the answer. The seller just clicks Approve. Safe by design: no money moves without a human.
```

**Thumbnail**: use `demo/thumbnail.png` (3:2).

---

## 2. Project details

**About the project** (Markdown)
```markdown
## Inspiration
Small online sellers lose real money on PayPal disputes and refund requests. Not because they are wrong, but because they answer late, without evidence, or refund out of fear when they would have won. Big companies have dispute teams. A one-person shop has a 10-day deadline and a busy inbox.

## What it does
PayDesk is an AI co-pilot for PayPal sellers with two agents and one rule: **AI prepares, a human approves.**

- **Dispute agent.** A buyer opens a dispute in PayPal. A **PayPal webhook** reaches PayDesk, a case opens with PayPal's real response deadline, and the agent starts immediately. It reads the dispute from the **Disputes API**, checks the payment through the **PayPal Server SDK**, and gathers evidence from the store's own records: what was sold, when it was delivered, whether the buyer downloaded it, past refunds and support history. It then recommends **accept, offer a partial refund, or contest**, with an estimated chance to win, a drafted note to PayPal and an evidence file. The seller clicks Approve and PayDesk answers PayPal.
- **Refund agent.** A buyer types their problem in plain words ("I was charged twice for the UI kit"). The AI finds the right PayPal payment and opens a case. The refund agent checks the payment live in PayPal, detects duplicate charges, applies the store's refund policy and proposes a full or partial refund, or asks for details. One click refunds through the PayPal Payments API.
- **Ask PayPal.** A chat over the seller's PayPal account built on **PayPal's Agent Toolkit** ("Which disputes need my attention first?"). Read-only by design.

## How we built it
- **PayPal:** JS SDK Smart Buttons for checkout; **PayPal Server SDK** (APIMatic-generated, TypeScript) for Orders v2 (create, capture) and Payments v2 (capture lookup, refunds), idempotent with PayPal-Request-Id; **Disputes API** (read, accept claim, make offer, provide evidence as multipart, sandbox adjudicate); **Webhooks** with signature verification for CUSTOMER.DISPUTE.* events; **PayPal Agent Toolkit** for the chat.
- **AI:** two LangGraph pipelines on Groq (gpt-oss-120b): gather facts from PayPal → AI decision → policy guard (plain code) → drafted reply → proposal → human approval.
- **App:** React + TypeScript + Tailwind, Node + Express + TypeScript, MongoDB, Socket.IO for live updates, 70 automated tests.
- We used **APIMatic's Context Plugin for PayPal** while writing the Server SDK integration. It caught a real bug: SDK retries silently never run unless maximumRetryWaitTime is set, because its default is 0.

## Safety (the part we are proudest of)
- **Policy guard in code.** The AI cannot talk its way past it: refund window, never more than what is left, no contesting "not received" without download proof, only actions PayPal currently allows, and refunds held for customers with 3+ refunds in 90 days.
- **Evidence is built from records by code, never written by the AI**, so the agent cannot invent evidence.
- **Atomic approval** (PENDING to PROCESSING): a double click can never refund twice.
- Buyers never see the agent's internal reasoning.

## Challenges we ran into
- Making AI safe around money. We split "deciding" from "doing": the agent only proposes, and a separate code path executes after a human click.
- Race conditions: a webhook-triggered agent run finishing after a human already approved. We made every save conditional.
- Testing the real PayPal path without network access: we used the stub-transport seam described in the APIMatic plugin's testing skill.

## Accomplishments that we're proud of
- A full loop from buyer dispute to PayPal resolution, with live AI, in one click for the seller.
- 70 tests, including the real PayPal code path against a stub transport.

## What we learned
PayPal's Disputes lifecycle (inquiry, chargeback, allowed actions via HATEOAS links), webhook verification, the APIMatic-generated SDK patterns, and how to design agentic commerce so a human stays in control.

## What's next for PayDesk
Real document evidence (PDF receipts, shipping tracking via the Shipment Tracking API), multi-store support via PayPal partner onboarding, and learning from outcomes to improve the win estimate.
```

**Built with** (tags)
```
paypal, paypal-server-sdk, paypal-disputes-api, paypal-webhooks, paypal-agent-toolkit, paypal-js-sdk, apimatic, langgraph, langchain, groq, typescript, react, node.js, express.js, mongodb, socket.io, tailwindcss, vite, vitest
```

**"Try it out" links**
```
https://github.com/mahmadr10/paydesk
```

**Video**: [YouTube link after you upload demo/paydesk-demo.mp4]

---

## 3. Additional info

| Field | Answer |
|---|---|
| Submitter Type | Team |
| Country of Residence | Pakistan |
| Canada province | N/A |
| Organization Name | N/A |
| New or Existing? | Existing |

**If it existed before, explain what already existed and what you built during the submission period**
```
Before Oct 1, 2026 we had a generic support-ticket app (login, roles, ticket workflow, audit log, live updates). During the hackathon we built everything PayPal- and AI-related on top of it: PayPal checkout (JS SDK), the PayPal Server SDK integration (orders, captures, refunds), the Disputes API integration and verified webhooks, the AI dispute agent and AI refund agent (LangGraph + Groq) with code policy guards and human approval, AI smart intake, the "Ask PayPal" assistant built on PayPal's Agent Toolkit, the seller co-pilot dashboard, and 70 tests. The git history shows the before/after.
```

**Explain how your project meets the main technology requirement**
```
PayPal (sandbox):
- PayPal JS SDK (Smart Buttons): buyer checkout.
- PayPal Server SDK (@paypal/paypal-server-sdk, TypeScript), OrdersController: create and capture orders. PaymentsController: live capture lookup used by both agents, and refunds. Every POST is idempotent with PayPal-Request-Id.
- Disputes API v1: read disputes, accept claim (refund), make offer (partial refund), provide evidence (multipart with a generated evidence file), sandbox adjudicate.
- Webhooks (CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED), verified with verify-webhook-signature: each new dispute automatically opens a case and starts the dispute agent.
- PayPal Agent Toolkit (@paypal/agent-toolkit): read-only PayPal tools (disputes, orders, refunds, invoices) for the "Ask PayPal" chat, plus a tool over the store's own sales records.

AI:
- Groq (openai/gpt-oss-120b) with LangGraph: the dispute agent and the refund agent each run "gather facts from PayPal, AI decision with structured output, code policy guard, AI-drafted reply". The output is a proposal that a human approves before PayPal is called.
- Groq for smart intake: turns a buyer's free-text message into a case linked to the right PayPal payment.
- Groq with tool calling over the PayPal Agent Toolkit for the seller chat.
```

**Which additional sponsor tool(s) did you use?**: **APIMatic**

**Public code repository URL**
```
https://github.com/mahmadr10/paydesk
```

**Working demo / hosted app URL**
```
https://github.com/mahmadr10/paydesk#run-it-locally-about-2-minutes
```

**Testing instructions**
```
Runs locally in about 2 minutes with no accounts: see README "Run it locally". Set MONGODB_URI=memory (built-in temporary database). Without PayPal keys a built-in PayPal simulator is used; add sandbox PAYPAL_CLIENT_ID/SECRET to use the real PayPal sandbox. GROQ_API_KEY is optional (free at console.groq.com); without it the agents use rule-based decisions.

Demo path:
1. Register a buyer (role Customer). Shop > buy. My orders > Download > Open PayPal dispute.
2. Register a seller (role Agent) in another browser profile. The Co-pilot shows the dispute and the agent's recommendation. Open it > Approve.
3. As the buyer: My orders > "Problem with an order?" > "I was charged twice for ...". As the seller: open the case > Approve refund.
4. Seller: Ask PayPal.
Tests: cd backend && npm test (70 tests).
```

| Field | Answer |
|---|---|
| Rate your PayPal integration experience (1-10) | [your honest rating] |
| Why / feedback | [1-2 honest lines, for example: "The Server SDK made orders and refunds straightforward; disputes and webhooks needed the REST API since they are not in the SDK yet."] |
| Open to feedback contact? | Your choice |

**APIMatic Context Plugin experience**
```
We installed the APIMatic Context Plugin for PayPal (paypaldev/server-sdk-context-plugin-preview) and used its TypeScript skills while writing our PayPal Server SDK integration. What worked well: the skills are grounded in the SDK source, so client setup (clientCredentialsAuthCredentials, OrdersController/PaymentsController, named-argument calls, ApiError handling) was right the first time instead of guessed. The resilience skill caught a real bug: we had set maxNumberOfRetries, but the SDK's generated maximumRetryWaitTime defaults to 0, so no retry would ever happen. The testing skill showed the unstable_httpClientOptions stub-adapter seam, which let us test the real PayPal code path with no network (8 tests). Issue: the installer looks for the Claude Code CLI on PATH, so with only the desktop app it installed for VS Code, and we copied the skills into the project manually. Compared to building without it: fewer wrong guesses about generated names and defaults, and better tests.
```

| Field | Answer |
|---|---|
| Age / jurisdiction / not an employee checkboxes | Tick all 3 (true for both of you) |
| Which AI tools did you leverage? | Groq (gpt-oss-120b), LangGraph/LangChain, PayPal Agent Toolkit, APIMatic Context Plugin, Claude Code (coding assistant) |
| Level of learning | Significant |
| Gained AI value for your career? | Yes |

---

## Before you click Submit
- [ ] Repo is **public** and the License shows in the About section on GitHub
- [ ] Video is under 3 minutes, on YouTube (public or unlisted)
- [ ] Teammate added under "Manage team"
- [ ] Groq keys that were pasted in chat have been replaced with new ones
- [ ] Submit by **Thursday Nov 12, evening** (hard deadline Fri Nov 13, 1:00 AM Pakistan time)
