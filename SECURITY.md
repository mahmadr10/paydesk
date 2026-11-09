# Security

## Authentication & session model

- Passwords hashed with **bcrypt** (cost factor 10), never stored or logged
  in plain text. `User.toJSON()` strips `passwordHash` before any user
  object is ever sent to a client.
- **Access tokens**: JWTs, 15-minute expiry, signed with `JWT_ACCESS_SECRET`.
  Stateless - the server never stores them, so they can't be revoked early,
  but the short expiry limits the damage window if one leaks.
- **Refresh tokens**: opaque random 320-bit strings (not JWTs - nothing to
  decode), stored **hashed** (SHA-256) in MongoDB, sent to the browser only
  in an **httpOnly, sameSite=lax** cookie scoped to `/api/v1/auth` - never
  readable by JavaScript, and never sent to non-auth routes. **Rotated** on
  every use: each refresh revokes the token it was given and issues a new
  one, which is what makes theft *detectable* (if a stolen token and the
  real user both try to use it, the second use fails).
- Login and register share the **same error message and code**
  (`INVALID_CREDENTIALS`) whether the email doesn't exist or the password
  is wrong - prevents an attacker from using the login form to enumerate
  registered emails.
- **Self-registration cannot create an Admin account** (`registerSchema`
  only allows `CUSTOMER`/`AGENT`) - Admins are seeded (`seed:users` script)
  or promoted by an existing Admin via `PATCH /admin/users/:id`. Without
  this, anyone could grant themselves full control of the system.

## Authorization

- **Two-layer check on every protected route**: `requireAuth` (who are
  you?) then `requireRole(...)` (are you allowed?) - enforced in Express
  middleware, so a customer calling an agent-only endpoint directly with
  `curl` gets a `403`, not just a hidden button in the UI.
- **Ownership checks are separate from role checks.** An agent can view any
  ticket; a customer can only view their own - checked in the service layer
  (`assertCanView`), independent of the role middleware, because "is this
  YOUR ticket" isn't a role question.
- **State-machine transitions carry their own role rules** layered on top
  of the pure legal-transition graph (`isTransitionAllowedForActor` in
  `ticketService.ts`) - e.g. closing a resolved ticket is customer-or-staff,
  but triaging is staff-only, checked per-transition, not just per-route.

## Input validation

Every request body, query string, and route param is validated with **Zod**
before it reaches a controller (`middleware/validate.ts`). Unknown fields
are stripped (Zod's default "strip unknown keys" behavior), which is also
the main defense against a crafted body trying to smuggle in extra fields
(e.g. a customer's comment request setting `isInternal: true` is overridden
server-side regardless of what Zod let through - see `commentService.ts`).

**Why validate server-side when the frontend also validates?** The
frontend's React Hook Form + Zod checks are a UX nicety - instant feedback
without a round trip. They're not a security boundary: anyone can bypass
the browser entirely and call the API directly with `curl`/Postman. The
server-side Zod schemas are the real gate, and they're intentionally
independent of the frontend's copies (duplicated, not shared) so a bug in
one doesn't silently disable the other.

## Injection

- **NoSQL injection**: Mongoose queries are built from Zod-validated,
  typed objects (`ticketRepository.buildTicketQuery`), never from raw
  user-supplied objects - a crafted `{ "$ne": null }` in a JSON field fails
  Zod's `z.string()`/`z.enum()` checks before it can ever reach a Mongoose
  filter. We deliberately did not add `express-mongo-sanitize` on top: the
  validate-then-replace pattern already closes this gap, and that library
  has had compatibility friction with Express 5's read-only `req.query`
  (see `middleware/validate.ts`'s own workaround for the same issue) -
  redundant risk for no real gain here.
- **XSS**: React escapes all rendered content by default (no
  `dangerouslySetInnerHTML` anywhere in this codebase) - user-supplied
  ticket titles/descriptions/comments can't inject script into the page.

## Rate limiting

- General: 300 requests / 15 min / IP, all routes.
- Auth (`/auth/login`, `/auth/register`): 30 / 15 min / IP - tighter,
  because this is the endpoint an attacker would actually script against
  (password guessing, email enumeration), while staying loose enough not to
  lock out a real user trying a few accounts in one sitting.
- Both are skipped when `NODE_ENV=test`, so the automated test suite's own
  rapid-fire requests never trip them (learned the hard way - see
  [BUILD_LOG.md](BUILD_LOG.md)).

## HTTP security headers

**Helmet** is applied globally - sets `X-Content-Type-Options`,
`X-Frame-Options`, a conservative default CSP, and other response headers
that tell the *browser* to enforce protections (clickjacking,
MIME-sniffing) independent of application-code correctness.

## File uploads

- **Type whitelist** (not blacklist) - only specific image/PDF/document
  MIME types are accepted; anything else (including executables, HTML)
  is rejected before it's ever written to disk.
- **Size limit**: 5MB per file.
- **On-disk filenames are never the client-supplied filename** - a random
  hex string is generated instead (`middleware/upload.ts`), which is what
  prevents path-traversal (`../../etc/...`) and filename-collision attacks.
  The original filename is kept only as display metadata.
- **Downloads are authorization-checked, not served via a static file
  route** - `GET /tickets/:id/attachments/:attachmentId` re-checks the
  requester can view that ticket before streaming the file; there's no
  `express.static` exposing `uploads/` directly.

## AI Assist and third-party data handling

When `GROQ_API_KEY` is configured, "Analyze with AI" sends a ticket's
**title and description** (not comments, not attachments, not any user PII
beyond what's already in that text) to Groq's API to generate a summary/
suggested priority/draft reply. This is a real data-handling boundary worth
being explicit about:

- **Staff-initiated only** - never runs automatically on ticket creation;
  an Agent/Admin has to click "Analyze with AI" for anything to be sent.
- **No API key configured → nothing ever leaves the server** - the
  deterministic mock fallback (`ai/mockAnalyzer.ts`) runs entirely
  in-process, which is also the default and what CI/a fresh clone runs.
- Every analysis request is written to the audit trail
  (`AI_ANALYSIS_REQUESTED`), so there's a record of when a ticket's content
  was sent to a third party.
- A real production deployment handling sensitive ticket content should
  review Groq's own data-retention/training-use policy before enabling this
  feature, the same as any third-party LLM API integration.

## AI Dev Assistant: additional boundaries

Beyond AI Assist's data-handling notes above, this is an internal
developer/admin tool with its own specific hardening:

- **Admin-only** - every route below requires `requireRole("ADMIN")`, same
  as every other `/admin/*` endpoint. Agents and customers cannot reach any
  of this.
- **The investigation graph is structurally read-only** - there is no
  write/edit/apply tool defined in `ai/devAssistant/tools.ts` for the LLM
  to call, and nothing inside the graph (`plan`, the four agents,
  `diagnosisAgent`, `suggestFix`) can reach the one code path that DOES
  write (below) on its own. This is enforced by what functions the graph
  can call, not by a prompt telling the model not to write files - no
  prompt injection via a cleverly-worded question can grant a capability
  that was never wired in.
- **The one write path (`POST /admin/dev-assistant/apply-fix`) is gated
  and defended in depth**, not just admin-authenticated:
  - Only reachable from a suggestion the graph already produced and a human
    reviewed in the UI - never called automatically.
  - `targetFile` must resolve (after normalizing `..`/`.` segments) inside
    `backend/src` or `frontend/src`, must be `.ts`/`.tsx`, and cannot be
    inside `ai/devAssistant/` itself (self-modification refused) - checked
    server-side regardless of what the client sends.
  - `oldCode` must match the file's CURRENT content exactly once - zero
    matches (stale suggestion) or multiple matches (ambiguous) are both
    rejected outright rather than guessed at.
  - A change covering most of the file is refused (`FIX_TOO_BROAD`) rather
    than applied.
  - The real test suite runs immediately after every apply; a failure
    triggers an automatic revert to the original file content before the
    response is even returned - an approved-but-wrong fix cannot persist
    unnoticed.
- **Its own tighter rate limit** (`devAssistantLimiter`, 10 requests /
  15 min) - separate from the general API limiter, because a single question
  can trigger multiple LLM calls and a real ~10-15s test suite run, making
  it meaningfully more expensive per-request than ordinary CRUD traffic.
- **Repo search never touches secrets** - it only reads `.ts`/`.tsx` source
  files under `backend/src`/`frontend/src`; `.env` files, `node_modules`,
  and dotfiles/dot-directories are excluded by the same walk that skips
  `node_modules`.
- **Live progress is scoped to the asking admin only** - `devAssistant:step`
  events go to that admin's own `user:<id>` Socket.IO room, not broadcast to
  the shared `agents` room, so one admin's in-progress investigation (which
  could reference internal log contents) isn't visible to others by default.

## Error handling

Centralized (`middleware/errorHandler.ts`): every error becomes
`{ success: false, error: { code, message }, requestId }`. Unexpected
errors (bugs, not `AppError`s we threw on purpose) log the **full** error
(with stack trace) server-side via Pino, but the client only ever sees a
generic message plus a `requestId` - enough to look the real error up in
the logs without exposing internals (file paths, library versions,
database error text) to a potential attacker probing for information.

## Secrets

- No secrets are committed - `.env` is gitignored at every level
  (root/backend/frontend); `.env.example` files document what's needed
  without real values.
- `JWT_ACCESS_SECRET` and refresh-token hashing use independent mechanisms
  - a leaked access-token secret doesn't compromise stored refresh tokens
  (which are hashed, not signed) and vice versa.
- Logs are redacted (`observability/logger.ts`) so `Authorization` headers,
  cookies, and any field named `password`/`passwordHash`/`token` are never
  written to a log line even by accident.

## What's deliberately out of scope

- **2FA** - not requested by the spec's core requirements list, and adds
  real complexity (TOTP setup flow, backup codes) not justified for this
  build.
- **CSRF tokens** - the refresh cookie is `sameSite=lax`, which already
  blocks it being sent on cross-site POST requests from another origin
  (the main CSRF vector for cookie-based auth); access-token-bearing
  requests aren't cookie-based at all, so they're not CSRF-able in the
  classic sense.
- **A dedicated security scan** (OWASP ZAP / Semgrep / `npm audit` in CI) -
  not run as part of this build; `npm audit` is worth running before a real
  deployment and would be a natural CI step to add.
- **Encryption at rest** for MongoDB - delegated to the hosting provider
  (Atlas encrypts at rest by default); not something the application layer
  manages.
