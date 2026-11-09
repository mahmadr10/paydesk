# Build Log

Feature-by-feature record of how this was actually built, including the
parts that didn't work on the first try.

---

## Ticket state machine + SLA engine

**Problem**: tickets need a workflow that can't be corrupted by an
arbitrary status change (e.g. `OPEN` jumping straight to `RESOLVED`), and
each ticket needs a response/resolution deadline derived from its priority.

**Approach**: a single `Record<TicketStatus, TicketStatus[]>` map
(`ticketService.ts`) as the one source of truth for legal transitions -
every other layer (role rules, the frontend's button rendering) defers to
it rather than re-implementing the graph. SLA deadlines computed once at
creation (`responseDeadline`/`resolutionDeadline` stored as real `Date`
fields) and "remaining time"/"breached" computed fresh on every read
(`computeSlaStatus`, a pure function).

**Implementation**: the graph branches (`IN_PROGRESS` → `WAITING_FOR_CUSTOMER`
*or* `RESOLVED`) and allows a `CLOSED → OPEN` reopen - richer than a
straight line, so role rules had to be layered separately
(`isTransitionAllowedForActor`) rather than baked into the graph itself,
since "customer may close a resolved ticket" isn't a property of the two
status strings alone.

**Challenges**: deciding what counts as "breached" for SLA purposes wasn't
obvious at first - is it breached the moment `now` passes the deadline
(even if later resolved on time), or only if the actual response/resolution
happened after the deadline? The second is correct (a ticket resolved at
minute 10 against a 4-hour deadline isn't "breached" just because it's now
day 3), which is why `computeSlaStatus` checks `firstResponseAt`/
`resolvedAt` first and only falls back to `now` if the event hasn't
happened yet.

**Decision**: "assign to self" is the specific action that transitions
`TRIAGED → ASSIGNED` (rather than a separate free-standing action) - a
ticket must be triaged before it can be picked up, matching the graph
exactly.

**Testing**: 6 unit tests on `isLegalTransition` (every legal step, the
spec's own reject-example, backwards moves, staying-still), 6 more on
`computeSlaStatus` (breach boundary conditions, the "clock freezes at
response time" behavior).

**Result**: all passing; see [TESTING.md](TESTING.md).

---

## Access + refresh JWT authentication

**Problem**: the earlier (2-day scoped) version used one 7-day JWT with no
revocation - logging out didn't actually invalidate anything.

**Approach**: short-lived (15 min) access token + rotating refresh token in
an httpOnly cookie, hashed at rest. See [DECISIONS.md](DECISIONS.md#2-access-token-jwt--rotating-refresh-token-httponly-cookie-not-a-single-long-lived-jwt)
for the full alternatives comparison.

**Implementation**: `utils/jwt.ts` (token generation/hashing),
`models/RefreshToken.ts` (with a TTL index so expired ones self-delete),
`authService.ts` (issue/rotate/revoke), frontend `api/client.ts` (axios
interceptor: on a 401, silently call `/auth/refresh` once and retry the
original request).

**Challenges**: getting the frontend's silent-refresh-on-401 logic right
without an infinite loop - the refresh call itself must never go through
the same interceptor that triggers refreshes, or a failed refresh would
try to refresh itself forever. Solved with a plain, separate `axios.post`
call for `/auth/refresh` specifically, outside the interceptor chain.

**Decision**: access token kept in a module-level JS variable (memory
only), never `localStorage` - see [DECISIONS.md](DECISIONS.md#3-refresh-token-in-an-httponly-cookie-access-token-in-memory-only-neither-in-localstorage).

**Testing**: integration tests cover register/login/duplicate-email/
wrong-password/unauthenticated-access. (Refresh-rotation itself doesn't
have a dedicated automated test - flagged as a gap; manually verified via
the E2E suite's multi-step login flow implicitly exercising it.)

**Result**: working; logout now actually revokes access.

---

## Role-aware, branching ticket workflow across three roles

**Problem**: Customer/Agent/Admin need genuinely different capabilities,
enforced at the API - not just different UI.

**Approach**: `requireRole(...)` middleware per route, plus ownership
checks inside services for anything role alone can't answer ("is this
YOUR ticket").

**Implementation**: `middleware/auth.ts`, `services/ticketService.ts`'s
`assertCanView`/`isTransitionAllowedForActor`, `services/adminService.ts`
for user/category/SLA-policy management.

**Challenges**: the frontend needed to know which status buttons to show
an agent vs. a customer vs. nobody (for a ticket they can't act on) -
duplicating the role rules in the frontend would risk them drifting from
the backend's actual rules. Solved by having `GET /tickets/:id` return an
authoritative `allowedNextStatuses[]` computed server-side, so the frontend
just renders whatever the server says is legal right now, and the server
still re-checks independently on the actual `PATCH` (the array is a
convenience, not the security boundary).

**Result**: see the real bug this surfaced, next section.

---

## Testing infrastructure - and the bug it found

**Problem**: prove the app actually works, at three different levels of
confidence (see [TESTING.md](TESTING.md) for the full breakdown of why
three layers).

**Approach**: Vitest for unit + integration (with `mongodb-memory-server`
for a real-but-throwaway database), Playwright for E2E against real running
servers.

**Challenges** (the interesting part): setting up Playwright's `webServer`
config to auto-start both the frontend and backend hit a wall - the very
first E2E run showed a completely wrong page (a "Sign up" form with no Name
field, nothing like this app's actual Register page). Root cause: an
**unrelated project's dev server** was already running on port 5173 (Vite's
default), and Playwright's `reuseExistingServer` setting happily attached
to it instead of starting a fresh one. Fixed by moving the E2E servers to
dedicated ports (4001/5175) that can't collide with anything else running
on the machine.

Once pointed at the real app, the very first real test -
"customer creates a ticket, then views it" - failed with
`403 FORBIDDEN: You can only view your own tickets.` **on the customer's
own ticket.** Root cause: `assertCanView()` compared
`ticket.customer.toString()` against `user.userId`, but `GET /tickets/:id`
populates the `customer` field (to include the owner's name/email in the
response) - and `.toString()` on a *populated* Mongoose document does not
return its id string, so the check failed unconditionally for every
customer, every time. Every existing integration test for this function
happened to test the *correctly-forbidden* case (viewing someone else's
ticket), where an "always reject" bug is invisible.

**Decision**: normalize the comparison with a small helper
(`customerIdOf`) that handles both a populated document (`{ _id, name,
email }`) and a raw ObjectId - used everywhere `ticket.customer` is
compared to a user id.

While writing this test, a second, related bug surfaced by inspection: the
frontend's generic "Move to X" button loop didn't exclude `ASSIGNED`,
which would have let an agent set a ticket's status to `ASSIGNED` directly
(via the generic status-update endpoint) without going through "Assign to
me" - leaving the ticket `ASSIGNED` with no actual agent attached. Fixed by
excluding `ASSIGNED` from that generic loop; it's now only reachable via
the dedicated assign action.

**Testing**: added a dedicated regression integration test
(`lets a customer view their OWN ticket via GET /tickets/:id (populated
customer field)`) so this specific bug shape can never silently return.

**Result**: 28 backend tests passing, 4/4 E2E tests passing against real
servers and a real browser. This is the single clearest example in the
whole build of why the E2E layer earns its keep - neither the unit nor the
integration layer happened to exercise the exact code path (a customer
GETting their own populated ticket) where the bug lived.

---

## Docker & local disk space

**Problem**: containerize both halves, runnable with one command.

**Approach**: multi-stage Dockerfiles (build stage with full
devDependencies, discarded; runtime stage with only what's needed to run),
`docker-compose.yml` bundling a local MongoDB so the whole stack works with
zero external accounts.

**Challenges**: Docker Desktop could not actually be installed in the
environment this project was built in - the machine's `C:` drive was
essentially full (down to 0 bytes free at one point). Freed several GB by
clearing `npm`'s package cache (1.36 GB - safe, it just re-downloads
what's needed) and removing genuinely duplicate/leftover installer files,
but the installer's actual deploy step still needed more (`need 3459 MiB,
only 1881 MiB available`) than could be freed without deeper cleanup of
the user's own files, which wasn't this project's call to make unilaterally.

**Decision**: stopped pursuing local installation rather than keep
troubleshooting an environment-specific disk constraint - it doesn't block
the actual deliverable, since a real deployment platform (Render/Railway/
Fly.io) builds the Docker image **in the cloud** from the Dockerfile
already in the repo, never touching the local machine's disk at all. Noted
honestly in [README.md](README.md) and [DEPLOYMENT.md](DEPLOYMENT.md) as
"written but not run end-to-end here" rather than claimed as verified.

**Result**: Dockerfiles and compose config complete and reviewed line by
line for correctness; genuinely unverified by an actual `docker compose up`
run. This is the one deliverable in the whole project carrying that
caveat, and it's called out rather than hidden.

---

## Performance pass

**Problem**: demonstrate the app holds up at a realistic data volume
(10,000+ tickets), not just the handful of demo tickets used everywhere
else.

**Approach**: `npm run seed:perf` generates 10,000 tickets across 200
customers and 15 agents with randomized status/priority/dates. `npm run
benchmark` measures one real query - the agent ticket queue's filter (by
assigned agent + status) + sort (newest first) + limit - using MongoDB's
`explain("executionStats")`, with and without its compound index.

**Measurement** (`Ticket.find({ assignedAgent, status: "IN_PROGRESS" })
.sort({ createdAt: -1 }).limit(10)`, run against the real 10,000-document
in-memory dataset):

| | Documents examined | Documents returned | Plan |
|---|---|---|---|
| Compound index dropped | 478 | 10 | `SORT → FETCH → IXSCAN` (a narrower single-field index on `assignedAgent` alone still helped partially) |
| Compound index present | 10 | 10 | `LIMIT → FETCH → IXSCAN` |

**Root cause** (of the *difference*, not a bug - both used *some* index,
since the schema also declares single-field indexes): a single-field index
on `assignedAgent` can narrow the search but still has to individually
inspect every matching document to check `status` and sort them; the
compound index `{ assignedAgent: 1, status: 1, createdAt: -1 }` lets
MongoDB satisfy the filter AND the sort order directly from the index
itself, examining exactly the 10 documents it returns - the theoretical
minimum.

**Optimization**: the compound index was already declared in
`models/Ticket.ts` from the initial backend rebuild (not added
reactively after finding a problem) - this benchmark exists to *prove* that
choice mattered with real numbers, rather than assert it on faith.

**Result**: ~98% reduction in documents examined (478 → 10) for this
query shape, confirmed by `explain()`, not estimated.

**Honest note**: the "before" measurement never showed a true `COLLSCAN`
(full collection scan) - the schema's other single-field indexes provided
partial help even with the compound index dropped, which is a more
realistic and more interesting result than an artificially manufactured
worst case would have been, so it's reported as measured rather than
engineered to look more dramatic.

---

## OpenTelemetry tracing + metrics

**Problem**: structured logging (Pino) answers "what happened, in words,
per request" but not "where did the time go, across layers, for THIS
request" - the spec asks specifically for the latter, with the worked
example of investigating `/api/v1/dashboard/analytics` latency using traces.

**Approach**: `@opentelemetry/sdk-node` with auto-instrumentation for
http/express/mongodb (covers "HTTP Request → Express Route → MongoDB" with
zero application code), plus a small `withSpan()` helper
(`observability/otel.ts`) wrapping a handful of representative Service-layer
functions explicitly - auto-instrumentation can only patch real libraries,
and the Service layer is just our own function calls, invisible to a trace
otherwise. Traces print to the console with zero setup (no collector
required); `docker compose up` additionally wires a bundled Jaeger service
for a real trace-waterfall UI. Metrics via `@opentelemetry/exporter-
prometheus`, which serves `/metrics` itself - no collector needed there
either.

**Implementation**: `observability/tracing.ts` (SDK bootstrap - imported as
the literal first line of `index.ts`, ahead of every other import) and
`observability/otel.ts` (the `withSpan` helper), used in
`ticketService.createTicket`/`updateTicketStatus` and
`dashboardService.getSummary`/`getAnalytics`.

**Challenges**: auto-instrumentation patches modules at `require()` time -
if `tracing.ts` were imported anywhere other than first, any module already
loaded by that point (e.g. `express`, pulled in transitively by `app.ts`)
would keep running its original, un-patched code, and its spans would
silently never appear. No error, no warning - just missing spans, which
would have been a genuinely nasty thing to debug after the fact. Solved by
making it the first statement in `index.ts` and calling that out explicitly
in both files' comments so a future edit doesn't reorder it by accident.

Separately, verifying the Prometheus metrics endpoint actually worked hit a
false alarm: requests from a **different** local process (a separate
PowerShell instance) to `localhost:9464/metrics` timed out, which looked
like the exporter wasn't really listening. An in-process self-request (the
same Node process, after its own server started, calling its own endpoint)
returned `200` with a real metrics body immediately - proving the exporter
was correct all along, and the timeout was the *testing environment's*
loopback/sandbox networking between separate processes, not the code. Kept
the in-process check as the actual verification method rather than trusting
the misleading cross-process symptom.

**Decision**: Prometheus's pull model over an OTLP metrics exporter - a
`curl localhost:9464/metrics` works with nothing else running, where OTLP
metrics would need a collector or backend already listening to be useful at
all. Console-exporter-by-default over "OTLP always, fail if no collector" -
same reasoning as everywhere else in this project that talks to optional
external infrastructure (Docker, deployment): the app must run standalone
first, richer behavior is additive when configured.

**Testing**: full backend suite (28 tests) re-run after the change - still
passing, since `tracing.ts` is never imported by the integration test path
(tests import `app.ts` directly, not `index.ts`) and `OTEL_ENABLED=false` is
set for the E2E backend specifically, so tracing doesn't add a port-binding
flakiness risk to a test suite that isn't testing tracing itself. Verified
the SDK actually produces a working metrics endpoint via the in-process
self-request described above (not just "it compiled").

**Result**: a real, working `HTTP → Express Route → Service → MongoDB` trace
chain, viewable with zero setup (console) or a full UI (`docker compose up`
→ http://localhost:16686), plus a scrape-ready `/metrics` endpoint.

---

## AI ticket assistant (LangGraph + Groq)

**Problem**: the spec's optional AI bonus feature - ticket summarization/
classification - explicitly requested as a real agentic pipeline (LangGraph
by name), not a single prompt call, with a Groq API key provided to test it
live and a hard requirement that the app still runs with zero API key.

**Approach**: a genuine fan-out/fan-in LangGraph - `classify` (structured
category+priority output) and `summarize` run in parallel (both only need
the raw title/description), then both feed `draftResponse` (which needs
both outputs to write a coherent reply). Wrapped behind one function,
`aiService.analyzeTicket()` - the "replaceable service abstraction" the
spec asks for - so nothing outside that one file imports LangGraph or Groq
directly. A deterministic keyword-based mock (`ai/mockAnalyzer.ts`) runs
automatically whenever no `GROQ_API_KEY` is configured, including in CI.

**Implementation**: `ai/ticketAnalysisGraph.ts` (the graph),
`ai/mockAnalyzer.ts` (the fallback), `services/aiService.ts` (the seam),
a new staff-only `POST /tickets/:id/ai-analyze` endpoint, and an "AI
Assist" panel on the ticket detail page (Agent/Admin only - a customer
shouldn't see internal triage suggestions) with one-click "apply suggested
priority" and "use as reply" actions.

**Challenges** - three real bugs, found by actually running it against a
live key rather than stopping at "it compiles and the mock path works":

1. TypeScript's `Node16` module resolution rejected a dynamic
   `import("../ai/ticketAnalysisGraph")` at **compile time** ("relative
   import paths need explicit file extensions") - fixed by writing the
   specifier as `ticketAnalysisGraph.js`, the Node16/NodeNext convention
   (refers to the future compiled file regardless of the source's actual
   `.ts` extension).
2. That fix compiled clean but was silently wrong at **runtime**: `tsx`'s
   dev-time module resolver does not remap a `.js`-suffixed dynamic-import
   specifier back to the real `.ts` file the way static imports do under
   this project's CommonJS setup. Every real-mode call was throwing
   `ERR_MODULE_NOT_FOUND` inside the `try/catch` and silently falling back
   to mock - the endpoint kept returning `200` with plausible-looking data
   the whole time, which is exactly the dangerous kind of failure (no
   error surfaced anywhere a user or a quick smoke test would notice).
   Caught only by explicitly asserting `source === "groq"` during live
   verification, not by the response merely "looking right." Root cause:
   the lazy-import design wasn't actually load-bearing (the module has no
   expensive side effects at import time - `ChatGroq` instances are built
   inside functions, not at module scope), so the fix was to make it a
   plain static import and drop the lazy-loading premise entirely, rather
   than chase `tsx`'s resolver behavior further.
3. Once real requests were actually reaching Groq, they came back `404
   model_not_found` for the originally-chosen `llama-3.3-70b-versatile` -
   that model lineup has been retired on Groq's side since this was
   written. Fixed by querying `https://api.groq.com/openai/v1/models`
   directly with the real key to see the CURRENT live lineup rather than
   guess from memory, and switching the default to `openai/gpt-oss-120b`
   (confirmed to support structured output, which `classify` depends on).

Separately (lower stakes): two of the mock analyzer's own unit tests failed
on first run - not a bug in the analyzer, a bug in the test wording: a test
asserting `MEDIUM` default behavior used the word "Question" in its ticket
title, which the analyzer's own (correct) LOW-priority keyword list
matches. Fixed by rewording the test fixtures rather than loosening the
keyword rules to accommodate a coincidentally-bad test string.

And once a real `GROQ_API_KEY` existed in the local `.env` for live testing,
the integration test asserting `source === "mock"` started failing - it had
implicitly depended on nobody's local environment having a real key, which
is exactly the kind of hidden coupling that makes a test suite behave
differently on different machines. Fixed properly, not papered over: added
an explicit `process.env.AI_ENABLED = "false"` in `test/globalSetup.ts`, so
the integration suite deterministically exercises the mock path regardless
of what's in any given developer's `.env` - matching CI's actual
(genuinely-no-key) condition on purpose, rather than by accident.

**Decision**: see [DECISIONS.md](DECISIONS.md#8-langgraph-over-a-single-llm-call-for-the-ai-ticket-assistant-with-groq-as-the-model-provider)
for the full graph-vs-single-call and Groq-vs-OpenAI reasoning.

**Testing**: `mockAnalyzeTicket()` gets its own unit tests (priority
keyword matching including the CRITICAL/HIGH/LOW/MEDIUM-default paths,
category fallback behavior) since it's the path CI and any API-key-less run
actually exercises - not an untested stub. Integration tests cover the real
HTTP endpoint end to end (agent gets a `mock`-sourced analysis; a customer
gets `403`), now deterministically forced onto the mock path (see above)
regardless of local environment.

**Result**: verified working end to end against the real Groq API - a
ticket titled "Payment API returns 500" / "checkout is completely down for
every customer" came back `{ suggestedCategory: "Payment",
suggestedPriority: "CRITICAL", source: "groq" }` with a coherent,
context-aware summary and draft reply, not templated filler. Also fully
functional with zero key (type-checks, lints, all 38 tests pass) for
anyone cloning the repo without one.

---

## AI Dev Assistant (multi-agent orchestrator)

**Problem**: the ticket AI assistant above answers questions about ONE
ticket. This is a different, separate ask - a multi-agent orchestrator that
investigates questions about the CODEBASE ITSELF ("why are ticket updates
sometimes duplicated?"), agents dispatching to specialized sub-agents and
reporting back, with an orchestrator synthesizing a final diagnosis -
autonomous investigation, but explicitly NOT autonomous code changes (see
[DECISIONS.md](DECISIONS.md#9-ai-dev-assistant-investigate-and-recommend-only-never-a-writepatch-tool)).

**Approach**: a LangGraph with a genuine planning step - an orchestrator
node uses structured LLM output to decide which of 4 read-only specialist
agents (repo search, git history, recent logs, the real test suite) are
actually relevant to the question, only those run (in parallel), and a
diagnosis node synthesizes their findings into a root-cause hypothesis +
recommended next step. Every tool is read-only by construction - no
write/patch tool exists anywhere in the tool set for the graph to call.
Live per-agent progress streams to the frontend over the existing
Socket.IO infrastructure (same per-user room pattern the ticket workflow
already uses), so the UI can show agents lighting up in real time instead
of one opaque spinner - genuinely useful for a demo, not decoration.

**Implementation**: `ai/devAssistant/tools.ts` (repo search - pure Node
directory walk, no shell dependency; git log/diff - best-effort, degrades
gracefully with no `.git`/no `git` binary; log search - reads a new
in-memory ring buffer; test run - spawns the real `npm test`),
`ai/devAssistant/orchestratorGraph.ts` (the graph), `ai/devAssistant/
mockOrchestrator.ts` (no-API-key fallback - keyword heuristic instead of an
LLM planner, raw findings instead of an LLM diagnosis), `observability/
logBuffer.ts` (the ring buffer - mirrors every Pino log call via a
`hooks.logMethod` hook), `services/devAssistantService.ts` (the seam),
`POST /admin/dev-assistant/ask` (Admin-only, its own tighter rate limit),
and an Admin → "Dev Assistant" page with a live-updating agent pipeline
visualization.

**Challenges** - four real bugs, every one found by actually running it
against the live key and reading what came back, not by inspection:

1. **Node name / state channel name collision.** LangGraph rejected
   `.addNode("diagnosis", ...)` outright at startup - a node can't share a
   name with a state field, and `diagnosis` was already the State's output
   field. Renamed the node to `diagnosisAgent`; the state field stayed
   `diagnosis`.
2. **Keyword extraction was fundamentally wrong, not just imperfect.** The
   first version reduced a whole question down to ONE joined phrase and
   searched for it as a single literal substring - asking "where is
   authentication implemented" (a real, answerable question - auth code
   obviously exists in this repo) came back "no matches," because nothing
   in the code literally contains the string "where authentication
   implemented this." Fixed by extracting multiple standalone keywords and
   matching ANY of them (OR), not the whole phrase as one AND'd string.
3. **Real code doesn't use the same words a question does.** Even fixed,
   "authentication" alone still didn't match - the actual file is
   `auth.ts`, using `JWT`, `login`, `token`, never the literal word
   "authentication." Added a small synonym table for this specific
   codebase's actual vocabulary (`authentication` → `auth`, `jwt`, `login`,
   `token`, etc.) - a deliberate, bounded middle ground, not a claim of
   real semantic search.
4. **The Dev Assistant's own comments became the top search result.**
   Once (2) and (3) were fixed, the top "authentication" match was this
   tool's OWN code comments explaining the fix (dense with exactly that
   vocabulary), crowding out the real `authController.ts`/`authService.ts`
   hits within the match cap. Fixed by excluding the Dev Assistant's own
   `ai/devAssistant/` directory from repo search results - asking "where is
   X implemented" should point at application code, not this tool's notes
   about itself.
5. **A circular-JSON crash in the Log Agent, caught mid-demo.** A live UI
   test showed the result badge saying "Live AI (Groq)" while the actual
   diagnosis text was visibly the MOCK fallback's raw-findings dump - a
   real, user-visible inconsistency. Backend logs showed the actual cause:
   `getRecentLogs()`'s `JSON.stringify()` threw `Converting circular
   structure to JSON` on a stored log entry, because Pino's `hooks.logMethod`
   runs on the RAW arguments passed to `logger.info()`/etc., BEFORE Pino's
   own configured `req`/`res` serializers apply (those only run at actual
   output-serialization time) - so a request-completion log's raw `res`
   object, with its circular `res.req`/`req...res` reference chain, was
   getting stored as-is. Fixed by sanitizing every entry through a
   circular-safe stringify ONCE at store time, so anything read back later
   is guaranteed safe. Separately fixed the actual bug this exposed: the
   response's `source` field was computed from "was a key configured"
   rather than "which path actually ran," so a graph that threw mid-run and
   correctly fell back to mock still reported `source: "groq"` - a UI
   showing "Live AI" next to content that's visibly the mock fallback is
   exactly the kind of quietly-wrong result a demo (or a real user) could
   be misled by. Fixed by tracking the actual executed path, not inferring
   it after the fact. (Verified the ticket AI service, built earlier, never
   had this specific bug - each of its branches already returns its own
   explicit `source` literal.)

**Testing**: `extractSearchKeywords()` gets dedicated regression unit tests
for bug #2 specifically (asserts multiple standalone keywords, never one
joined phrase) and the synonym expansion from bug #3. Full backend suite
(42 tests total now) passing. Live end-to-end verification via both a
direct graph invocation AND a real Playwright browser click-through
(logged in as the seeded admin, asked a real question, screenshotted the
live agent pipeline mid-run and the final diagnosis) - this is what
actually caught bug #5, which none of the automated tests would have
(nothing was asserting that the displayed `source` matched the actual
displayed content).

**Result**: a genuinely working multi-agent investigation - verified live
answering both a diagnostic question ("why are ticket updates sometimes
duplicated," correctly selected repo+log agents, correctly found a real
burst of duplicate-looking log entries, gave a specific, plausible
root-cause hypothesis and a concrete next step) and a codebase-navigation
question ("where is authentication implemented," correctly traced through
`authController.ts` → `services/authService.ts` → `utils/jwt.ts`). Fully
functional with zero API key. Runs with zero write access to source files,
by construction.

---

## Background job: SLA breach notifications

**Problem**: the spec's "Background Jobs" bonus item, and a real gap:
`computeSlaStatus()` shows LIVE "breached: true/false" on a ticket someone's
actively looking at, but nobody gets told about a breach unless they
happen to be staring at that exact ticket at that exact moment.

**Approach**: a `node-cron` job, every minute, scanning for tickets that
just crossed their response or resolution deadline while still active,
writing a real persisted `Notification` (the spec's own suggested
`notifications` collection - not built until now) and pushing a live
`notification:new` Socket.IO event to whoever should know. A per-ticket
`*BreachNotified` boolean is what makes this fire exactly once per breach
instead of every minute forever.

**Implementation**: `models/Notification.ts`, `repositories/
notificationRepository.ts`, `jobs/slaBreachJob.ts` (the cron + the
`checkSlaBreaches()` function it calls), a manual-trigger admin endpoint
(same function, on demand), and a notification bell component in the
navbar (unread badge, dropdown, live socket updates).

**Challenges - a real backward-compatibility bug, caught by testing
against real (pre-existing) data instead of only freshly-created test
fixtures**: the query `Ticket.find({ resolutionBreachNotified: false, ... })`
matched **zero** of the 15 demo tickets seeded earlier in this build,
despite several of them being genuinely, obviously overdue (backdated
`createdAt` well past their SLA window). Root cause: those tickets were
created via `Ticket.create()` **before** `resolutionBreachNotified` existed
in the schema - the field is simply absent from their stored documents.
MongoDB's `{ field: false }` filter does not match a missing field, only
one explicitly stored as `false`. My own new automated integration test
(`slaBreachJob.integration.test.ts`) didn't catch this, because it creates
its OWN test tickets via the current (already-updated) schema - Mongoose
populates the field's default on every fresh `.create()` call, so the test
data never had the "field genuinely doesn't exist" shape the real seeded
data did. Fixed the query to `{ $ne: true }` (matches both "explicitly
false" and "missing" - the correct meaning of "not yet notified" either
way). A schema gaining a field after real documents already exist is an
entirely ordinary situation in a real deployment, not a contrived edge
case - this is exactly the kind of bug that "looks fine in tests, silently
does nothing in the field" (see [SECURITY.md](SECURITY.md) et al. for the
project's general stance on preferring caught-in-testing over
caught-in-production).

**Testing**: `slaBreachJob.integration.test.ts` - a real (in-memory)
database, not a mocked Ticket model, specifically because the bug above
was a QUERY-correctness bug, invisible to any test that mocks the query
away. Covers: a newly-breached unresolved ticket gets notified and flagged
(and does NOT get re-notified on a second run), and a ticket whose deadline
hasn't passed yet is correctly left alone.

**Result**: verified live against the real (Atlas-backed) seeded data - the
manual-trigger endpoint correctly found and notified on 10 genuinely
overdue demo tickets in one run, a screenshot of the notification bell
shows real messages ("Resolution SLA breached: TCK-000001 - 'Payment API
returns HTTP 500 on checkout'") with real timestamps, and the ticket queue
itself shows the same tickets in red ("overdue by 29:08:27") - two
independent parts of the UI agreeing with each other and with reality.

---

## AI Dev Assistant: patch generation, human-gated apply, auto-test-verify

**Problem**: the Dev Assistant (investigate-only, above) was explicitly
extended to propose and - with an explicit human approval step - actually
apply a real code fix, weighed directly against the brief's own stated
principle ("AI can recommend and automate; humans retain control over
high-impact actions"). Full autonomous apply (an LLM generating AND
applying a patch with no human step) was rejected outright as contradicting
that principle for no real benefit; the brief's own suggested shape -
`Diagnosis → Suggested Fix → Human Approval → Code Change → Tests` - is
exactly what got built.

**Approach**: a new `suggestFix` graph node (after `diagnosisAgent`) reads
the single file the repo agent's evidence points at and proposes a
specific `{ targetFile, oldCode, newCode, explanation }` - but ONLY
declares `fixAvailable: true` after independently verifying `oldCode` is a
real, exact substring of the file's actual current content (never trusting
the model's own claim that it copied correctly). Applying a suggestion is
a SEPARATE code path (`ai/devAssistant/applyFix.ts`) the graph has no way
to reach on its own: path-validated (inside `backend/src`/`frontend/src`
only, never the Dev Assistant's own code), exact-match-validated again
independently (0 or 2+ occurrences both rejected), applied, immediately
re-verified by running the REAL test suite, and automatically reverted if
that fails - before the HTTP response is even returned.

**Implementation**: `ai/devAssistant/applyFix.ts` (the one write path -
see its own header comment for the full safety reasoning), a
`suggestFix` node + `SuggestedFix` state field in `orchestratorGraph.ts`,
`runTestSuiteVerbose()` added to `tools.ts` (the existing `runTestSuite()`
returns a string summary for the investigation path; this returns a real
`{ passed: boolean, summary }` the apply flow can actually branch on - exit
code, not string-matching "FAIL" in output, is what decides `passed`), a
new `POST /admin/dev-assistant/apply-fix` endpoint, and a "Suggested Fix"
panel (a red/green diff view, an "Apply Fix" button, and a live
applying-and-testing result) on the Dev Assistant page.

**Verification approach, deliberately**: before wiring this to the LLM or
the HTTP layer at all, `applyFix()` was tested in complete isolation
against a disposable scratch file created specifically for this (never
real application code) - path traversal, wrong extension, self-
modification, no-match, and a genuinely-breaking change (which correctly
triggered the auto-revert, confirmed by re-reading the file afterward and
seeing it back to original) were all exercised directly before this code
ever touched anything that mattered. Only once that mechanism was proven
safe on its own was it connected to the LLM-generated suggestion, and only
after THAT was it driven through the real browser UI's "Apply Fix" button.

**Challenges - three more real bugs, all found by that same "verify live,
not just unit-test" discipline**:

1. A question like "where is authentication implemented" initially
   produced `fixAvailable: false` - correctly, since that's a navigation
   question with nothing to fix. But testing a genuine PLANTED bug (a
   scratch function computing tax subtraction instead of addition) also
   came back with no fix suggested, which was wrong. Root cause: the repo
   search results were dominated by generic words the question also
   happened to contain ("function", "expected") - common enough to fill the
   15-result cap with noise from files earlier in the directory walk order,
   before ever reaching the file the SPECIFIC identifier
   (`addTaxToPrice`/`scratchBuggyMath`) would have found. Fixed by scoring
   every candidate line by the summed LENGTH of the keywords it matches
   (a long, specific identifier outweighs several matches of a short,
   generic word) and keeping the highest-scoring results, not the
   first-encountered ones.
2. Even after that fix, `suggestFix` still picked the WRONG target file.
   `mostReferencedFile()` counted which file appeared most OFTEN across
   the findings - but a file matching one common word five separate times
   (five unrelated `function` declarations) still outranked the actually-
   relevant file matching the specific identifier exactly once. Root cause:
   `searchRepo`'s results were already sorted by relevance (fix #1, above)
   - counting raw occurrences instead of trusting that order threw the
   ranking away again, one function up the call stack. Fixed to simply use
   the file the FIRST (highest-scored) line belongs to.
3. `runTestSuite()`'s original pass/fail signal was string-matching "FAIL"
   in Vitest's output - good enough for a human-readable investigation
   summary, not reliable enough to gate an automatic file revert on. Added
   `runTestSuiteVerbose()`, which uses `npm test`'s actual exit code
   (whether `execFile` threw) as the real, unambiguous signal.

**Testing**: `applyFix.test.ts` - every REJECTION path (path traversal,
wrong extension, self-modification, no-match, ambiguous-match, empty
input) runs in the automated suite, fast, because each one throws before
ever reaching the nested `npm test` call. The successful-apply-then-verify
and applies-then-auto-reverts-on-failure paths were deliberately verified
LIVE instead of automated here (a nested `npm test` inside this already-
running suite would work, but at ~10-15s per assertion for marginal
benefit over what live verification already proved) - see BUILD_LOG entries
above for the pattern this project generally follows on that trade-off.

**Result**: a real, planted bug (a discount calculation that added instead
of subtracted) was correctly diagnosed, a fix was correctly generated with
`oldCode` matching the live file exactly, applied through the ACTUAL
browser UI's "Apply Fix" button (not a backend-only test), the real
44-test suite ran and passed, and the file was genuinely corrected on
disk - with a matching `DEV_ASSISTANT_FIX_APPLIED` audit log entry
recording the real old/new code and which admin approved it.

---

## E2E demo mode: SLOWMO, and the timeout bug it exposed

**Problem**: `npx playwright test --headed` finishes the whole 4-test
ticket-lifecycle flow in ~25 seconds - too fast for a human to narrate
over while presenting it live.

**Approach**: `SLOWMO=<ms>` (an env var, opt-in - unset runs at normal
speed) adds a pause of that many milliseconds before every single
Playwright action (click, fill, goto, select), via Playwright's own
`launchOptions.slowMo`. `SLOWMO=5000` makes each step clearly visible and
narratable.

**Challenge - a real bug this surfaced**: `SLOWMO=5000` immediately failed
the very first test with `Test timeout of 30000ms exceeded` and
`Expected: "http://localhost:5175/", Received: ""` - LOOKING like a real
app bug (navigation never completing), but it wasn't. The `register()`
helper alone performs 6 slowMo-affected actions (a `goto`, three `fill`s, a
`selectOption`, a `click`) - at 5s each, that's 30 seconds of pure
artificial delay, which alone equals Playwright's default 30s PER-TEST
timeout, before the actual page navigation even has a chance to complete.
The timeout fired on the slowMo delay itself, not on anything actually
being broken. Fixed by scaling the per-test timeout to 5 minutes whenever
`SLOWMO` is set (untouched at 30s otherwise, including in CI, which never
sets `SLOWMO`).

**Testing**: verified by actually running `SLOWMO=5000 npx playwright test
--headed` end to end after the fix, not just reasoning about the math.

**Result**: a demo-friendly, narratable automated run - the whole ticket
lifecycle (customer creates a ticket → agent triages/assigns/resolves it →
customer closes it → an illegal transition correctly rejected), driven
entirely by the browser itself, paced for a human audience instead of
finishing before anyone could explain what just happened.
