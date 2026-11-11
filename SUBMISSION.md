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
AI agents that investigate PayPal disputes and refund requests (Sandbox, test money), collect evidence and draft the answer. The seller approves; no refund happens without a human.
```

**Thumbnail**: use `demo/thumbnail.png` (3:2).

---

## 2. Project details

**About the project** (Markdown)
```markdown
## The problem
Small online shops lose money on PayPal disputes and refund requests. They answer late, have no proof, or refund when they did not need to. A big company has a team for this. A small shop has one person and a deadline.

## What PayDesk does
PayDesk is an AI helper for people who sell with PayPal. The AI does the investigating. **The seller makes the final decision.**

Everything in this demo runs on the PayPal Sandbox with test money.

- **Refunds.** A buyer writes "I was charged twice". The AI finds the payment, checks PayPal, sees the duplicate, and suggests refunding that one payment. The seller clicks Approve and PayPal sends the refund.
- **Disputes.** When a buyer opens a dispute on PayPal, PayDesk picks it up and opens a case. It collects proof (delivery and download records) and suggests what to do: accept, offer part of the money back, or contest. The seller clicks Approve and the answer goes to PayPal.
- **Ask PayPal.** A chat where the seller asks about disputes and sales, like "Which disputes need my attention first?".

## How we built it
- **PayPal:** Smart Buttons for checkout, the PayPal Server SDK for orders and refunds, the Disputes API, webhooks, and PayPal's Agent Toolkit for the chat.
- **AI:** LangGraph agents on Groq. Each agent gathers facts from PayPal, decides, passes a rules check, and drafts a reply.
- **App:** React, Node.js, Express, MongoDB and TypeScript, with 85 automated tests.
- We built the PayPal payment and refund code with **APIMatic's Context Plugin for PayPal** and the PayPal Server SDK that APIMatic makes. It was a big help: its guides gave us the right setup, error handling and tests from the start, and caught a bug in our retry settings.

## Built to be safe
- Rules written in code check every AI suggestion: the refund window, never more than what is left, and proof before contesting a dispute.
- Proof files are made from store records, not written by the AI.
- A double click can never refund twice.
- Nothing moves until a person approves.

## What we learned
How PayPal disputes work, how to verify webhooks, how much a good SDK and good guides like APIMatic's help a developer, and how to keep a person in charge when AI works near money.
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
Before Oct 1, 2026 we had a generic support-ticket app (login, roles, ticket workflow, audit log, live updates). During the hackathon we built everything PayPal- and AI-related on top of it: PayPal checkout (JS SDK), the PayPal Server SDK integration (orders, captures, refunds), the Disputes API integration and verified webhooks, the AI dispute agent and AI refund agent (LangGraph + Groq) with code policy guards and human approval, AI smart intake, the "Ask PayPal" assistant built on PayPal's Agent Toolkit, the seller co-pilot dashboard, and 85 tests. The git history shows the before/after.
```

**Explain how your project meets the main technology requirement**
```
PayPal (sandbox):
- PayPal JS SDK (Smart Buttons): buyer checkout.
- PayPal Server SDK (@paypal/paypal-server-sdk, TypeScript), OrdersController: create and capture orders. PaymentsController: live capture lookup used by both agents, and refunds. Every POST is idempotent with PayPal-Request-Id.
- Disputes API v1: read disputes, accept claim (refund), make offer (partial refund), provide evidence (multipart with a generated evidence file), sandbox adjudicate.
- Webhooks (CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED), verified with verify-webhook-signature: a new dispute opens a case and starts the dispute agent. (The endpoint is built and tested; the seller dashboard also has a one-click "Sync disputes from PayPal" that does the same thing.)
- PayPal Agent Toolkit (@paypal/agent-toolkit): read-only PayPal tools (disputes, orders) for the "Ask PayPal" chat, plus a tool over the store's own sales records.

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
Live demo: https://paydesk-web.vercel.app (PayPal Sandbox, test money only).
Judge login, buyer:  [JUDGE BUYER EMAIL] / [JUDGE BUYER PASSWORD]
Judge login, seller: [JUDGE SELLER EMAIL] / [JUDGE SELLER PASSWORD]
(Fill these in on Devpost only. Do NOT commit real logins to this public file.) Open the buyer in one browser window and the seller in a private window.
Or run locally in about 2 minutes with no accounts: see README "Run it locally". Set MONGODB_URI=memory (built-in temporary database) and DEMO_MODE=true. Without PayPal keys a built-in PayPal simulator is used; add sandbox PAYPAL_CLIENT_ID/SECRET to use the real PayPal sandbox. GROQ_API_KEY is optional (free at console.groq.com); without it the agents use rule-based decisions.

Demo path:
1. Log in as the buyer. Shop > buy. My orders > Download. Then Report a problem on sandbox.paypal.com (real sandbox) with the PayPal test buyer account.
2. Log in as the seller in another browser profile. Click Sync disputes from PayPal. The Co-pilot shows the dispute and the agent's recommendation. Open it > Approve.
3. As the buyer: My orders > "Problem with an order?" > "I was charged twice for ...". As the seller: open the case > Approve refund.
4. Seller: Ask PayPal.
Tests: cd backend && npm test (85 tests).
```

| Field | Answer |
|---|---|
| Rate your PayPal integration experience (1-10) | [your honest rating] |
| Why / feedback | [1-2 honest lines, for example: "The Server SDK made orders and refunds straightforward; disputes and webhooks needed the REST API since they are not in the SDK yet."] |
| Open to feedback contact? | Your choice |

**APIMatic Context Plugin experience**
```
Thank you, APIMatic team. The Context Plugin for PayPal was one of the most useful parts of our build, and we want to say that clearly. We used its TypeScript guides while writing our PayPal Server SDK code for orders, payments and refunds. The guides come from the SDK's own source, so the client setup, the order and refund calls, and the error handling were right the first time instead of guessed. The resilience guide caught a real bug in our code: we had set retries, but the SDK's retry wait time defaults to 0, so no retry would ever have happened. It also showed us the SDK's built-in logging and abortSignal, which we use to log PayPal debug ids and to cap each call at 25 seconds. The error-handling guide helped us turn PayPal error codes such as ORDER_NOT_APPROVED and INSTRUMENT_DECLINED into clear messages, and the testing guide showed how to stub the SDK's network layer, so we could test the real PayPal code path with no network (14 tests). Compared with building without it, we guessed much less and wrote better tests. We learned a lot from how carefully the guides are written. I am Muhammad Ahmad (github.com/mahmadr10), and I would love to work on tools like this at APIMatic one day.
```

| Field | Answer |
|---|---|
| Age / jurisdiction / not an employee checkboxes | Tick all 3 (true for both of you) |
| Which AI tools did you leverage? | Groq (gpt-oss-120b), LangGraph and LangChain, PayPal Agent Toolkit, APIMatic Context Plugin |
| Level of learning | Significant |
| Gained AI value for your career? | Yes |

---

## Before you click Submit
- [ ] Repo is **public** and the License shows in the About section on GitHub
- [ ] Video is under 3 minutes, on YouTube (public or unlisted)
- [ ] Teammate added under "Manage team"
- [ ] Groq keys that were pasted in chat have been replaced with new ones
- [ ] Submit by **Thursday Nov 12, evening** (hard deadline Fri Nov 13, 1:00 AM Pakistan time)
