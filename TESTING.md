# Testing

Three layers, each catching a different class of bug:

| Layer | Tool | What it catches | Speed |
|---|---|---|---|
| Unit | Vitest | Logic bugs in one pure function (no I/O) | Milliseconds |
| Integration | Vitest + Supertest + in-memory MongoDB | Wiring bugs - wrong route, missing middleware, a validator that doesn't match its controller | Seconds |
| E2E | Playwright | Bugs that only show up when the real frontend and real backend talk to each other through a real browser | Tens of seconds |

## Unit tests

```bash
cd backend && npm test
```

`src/services/ticketService.test.ts` and `src/services/slaService.test.ts`.
These test the **highest-value logic** directly - the state machine's
`isLegalTransition()` and the SLA engine's `computeSlaStatus()` - because
both are pure functions (same input → same output, no database, no HTTP),
which makes them fast to test exhaustively and impossible to get flaky.

Coverage highlights:
- Every legal transition in the state machine graph, including both
  branches out of `IN_PROGRESS` and the `CLOSED → OPEN` reopen path.
- The spec's own example (`OPEN` directly to `RESOLVED` must be rejected).
- SLA edge cases: responding exactly at the deadline (not breached - only
  strictly *after* counts), responding late but checking "now" long after
  (still correctly not-breached if the response itself was on time - the
  clock freezes at the moment of response, not at query time).

## Integration tests

Same command (`npm test` runs the whole Vitest suite, unit and integration
together) - `src/test/ticketFlow.integration.test.ts`.

These drive the **actual Express app** (`createApp()` from `src/app.ts`)
with Supertest - real routing, real middleware, real validation, real
Mongoose queries - against a **real MongoDB**, just an ephemeral in-memory
one (`mongodb-memory-server`), started fresh for the test run by
`src/test/globalSetup.ts` and thrown away after. This is what makes them
integration tests rather than unit tests: they exercise the full stack
except the network layer and the browser.

Covers: registration (including the duplicate-email and self-registering-
as-Admin rejections), login (including the identical-error-for-wrong-
password-vs-no-such-email check), unauthenticated access, ticket creation
(including the unknown-category rejection), cross-customer access denial,
**a customer viewing their own populated ticket** (a real bug's regression
test - see below), the full legal status-transition path with an illegal
skip attempt in the middle, a customer forbidden from self-assigning, and
pagination actually limiting result size.

### A bug this layer caught in practice

While writing the E2E suite (see below), `assertCanView()` turned out to
compare a **populated** Mongoose document's `.toString()` against a plain
id string - which never matches (`.toString()` on a populated document
doesn't return its id), so every customer was locked out of their own
ticket detail page. The integration suite hadn't caught it because no
existing test called `GET /tickets/:id` as a customer viewing their *own*
ticket - every prior FORBIDDEN-related test happened to be testing the
*correctly*-forbidden case (someone else's ticket), where an "always
reject" bug is invisible. Fixed in the service layer, and a dedicated
regression test (`lets a customer view their OWN ticket...`) now covers
exactly that path. This is the concrete argument for why integration tests
alone aren't enough - see the E2E section below for how it was actually
found.

## End-to-end tests

```bash
cd e2e && npm test
```

`e2e/tests/ticket-lifecycle.spec.ts` - Playwright drives a real Chromium
browser through the mandatory flow: **customer registers → creates a
ticket → agent registers → triages → assigns to self → progresses through
IN_PROGRESS → resolves → customer sees the resolution and closes it**, plus
a check that an illegal transition is rejected via direct API call.

`playwright.config.ts` starts **both real servers itself** before running
any test (`webServer` config) - a throwaway in-memory MongoDB + the actual
backend dev server on port **4001**, and the actual frontend dev server on
port **5175**. Deliberately non-default ports: the first version of this
config used the normal 4000/5173 and Playwright silently reused an
unrelated project's dev server that happened to already be running on
5173, producing bewildering failures against the wrong app entirely.
Dedicated ports make that class of mistake structurally impossible.

**This is the layer that found the real ownership-check bug above.** Unit
tests proved the state machine's *rules* were correct in isolation.
Integration tests proved the API's *wiring* was correct for the cases they
covered. Neither one drives an actual browser through an actual multi-step
user journey - the E2E test's very first assertion (customer navigates to
their own freshly-created ticket) hit a code path none of the other layers
happened to exercise, and failed immediately with a `403 FORBIDDEN` that
had no business being there. That's the concrete case for keeping all
three layers instead of picking one.

## Demonstrating a failing → passing CI run

To show the CI pipeline (`.github/workflows/ci.yml`) actually catching a
real failure (a useful thing to show in a review or the demo video):

1. On a branch, break something on purpose - e.g. in
   `backend/src/services/ticketService.ts`, change
   `IN_PROGRESS: ["WAITING_FOR_CUSTOMER", "RESOLVED"]` to
   `IN_PROGRESS: ["WAITING_FOR_CUSTOMER"]` (silently makes `RESOLVED`
   unreachable from `IN_PROGRESS`).
2. Push the branch, open a PR. The `backend` job's **test** step fails -
   the existing unit test `"allows the two branches out of IN_PROGRESS"`
   catches it directly, and several integration tests fail downstream too.
3. Revert the change, push again. The same PR's checks turn green.

This is a deliberate regression, not a hypothetical - the test that catches
it already exists in the suite (`ticketService.test.ts`), so this is safe
to actually try.

## What's not covered

- **Frontend unit tests** (e.g. React Testing Library component tests) -
  not written; the Playwright E2E suite exercises the real frontend
  end-to-end, which was judged higher-value for the time available than
  isolated component tests on top of that.
- **Load/stress testing** - the performance work (`npm run seed:perf` +
  `npm run benchmark`, see [BUILD_LOG.md](BUILD_LOG.md#performance-pass))
  measures one query's index behavior at 10k documents, not concurrent
  request throughput.
