# API Reference

Base URL: `http://localhost:4000/api/v1` (dev) - see [DEPLOYMENT.md](DEPLOYMENT.md) for production.

## Conventions

**Every response** is one of two shapes:

```json
{ "success": true, "data": { ... } }
```
```json
{ "success": false, "error": { "code": "SOME_CODE", "message": "Human-readable." }, "requestId": "..." }
```

**Auth**: send `Authorization: Bearer <accessToken>` on every protected
route. The access token expires in 15 minutes - see
[ARCHITECTURE.md](ARCHITECTURE.md#authentication-flow) for the refresh
flow. `POST /auth/refresh` and `POST /auth/logout` instead rely on an
httpOnly `refreshToken` cookie (sent automatically by the browser; a raw
`curl`/Postman call needs to pass it explicitly).

**Pagination** (any endpoint marked 📄): query params `page` (default 1),
`limit` (default varies, max 100). Response includes:
```json
{ "tickets": [...], "pagination": { "page": 1, "limit": 10, "total": 42, "totalPages": 5 } }
```

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | A Zod schema rejected the request body/params/query |
| `INVALID_CATEGORY` | 400 | Ticket creation referenced a category that doesn't exist or is inactive |
| `INVALID_STATUS_TRANSITION` | 400 | The requested status change isn't legal from the ticket's current status (or the requester's role doesn't permit it right now) |
| `INVALID_AGENT` | 400 | Reassignment target isn't an active agent |
| `UNSUPPORTED_FILE_TYPE` | 400 | Attachment upload rejected by the MIME-type whitelist |
| `CANNOT_DEACTIVATE_SELF` | 400 | An admin tried to deactivate their own account |
| `UNAUTHORIZED` | 401 | Missing/invalid/expired access token |
| `INVALID_CREDENTIALS` | 401 | Login email/password didn't match (same code for "no such email" and "wrong password" - deliberately, to not leak which emails are registered) |
| `INVALID_REFRESH_TOKEN` | 401 | Refresh cookie missing, expired, revoked, or its account deactivated |
| `FORBIDDEN` | 403 | Authenticated, but not allowed to do this specific thing (wrong role, or not this ticket's owner) |
| `NOT_FOUND` | 404 | No such ticket/user/category/etc., or an unmatched route |
| `EMAIL_IN_USE` | 409 | Registration email already has an account |
| `INVALID_TARGET_FILE` | 400 | Dev Assistant apply-fix: target file is outside `backend/src`/`frontend/src`, wrong extension, or is the Dev Assistant's own code |
| `FIX_NOT_APPLICABLE` | 400 | Dev Assistant apply-fix: `oldCode` no longer matches the file's current content |
| `FIX_AMBIGUOUS` | 400 | Dev Assistant apply-fix: `oldCode` appears more than once - refuses to guess which occurrence |
| `FIX_TOO_BROAD` | 400 | Dev Assistant apply-fix: the change covers most of the file - refused rather than applied blindly |
| `RATE_LIMITED` | 429 | Too many requests in the current window |
| `INTERNAL_ERROR` | 500 | Unexpected server error - check the logs by `requestId` |

## Auth

| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/auth/register` | none | `{ name, email, password, role: "CUSTOMER"\|"AGENT" }` |
| POST | `/auth/login` | none | `{ email, password }` |
| POST | `/auth/refresh` | refresh cookie | - |
| POST | `/auth/logout` | refresh cookie | - |
| GET | `/auth/me` | Bearer | - |

`register`/`login`/`refresh` all return `{ user, accessToken }` (and set the
refresh cookie). `role: "ADMIN"` is rejected on registration - see
[SECURITY.md](SECURITY.md).

## Categories

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/categories` | Bearer (any role) | Active categories only - for populating the "Create Ticket" form |

## Tickets

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/tickets` | Customer | `{ title, description, category, priority, tags[] }` |
| GET | `/tickets` 📄 | Bearer | Customers see only their own; Agents/Admins see all. Query: `status, priority, category, assignedAgent, tag, search, createdAfterDays, sortBy, sortDir, page, limit` |
| GET | `/tickets/:id` | Bearer (owner, or Agent/Admin) | Includes live `sla` object and `allowedNextStatuses[]` |
| PATCH | `/tickets/:id/status` | Bearer | `{ status }` - legality depends on current status AND role/ownership (see state machine, [ARCHITECTURE.md](ARCHITECTURE.md)) |
| PATCH | `/tickets/:id/priority` | Agent/Admin | `{ priority }` - recomputes SLA deadlines |
| PATCH | `/tickets/:id/tags` | Agent/Admin | `{ tags: string[] }` |
| POST | `/tickets/:id/assign` | Agent | Assigns the caller to the ticket (only legal from `TRIAGED`) |
| POST | `/tickets/:id/reassign` | Admin | `{ agentId }` - reassign to a specific agent |
| POST | `/tickets/:id/ai-analyze` | Agent/Admin | No body. Returns `{ summary, suggestedCategory, suggestedPriority, suggestedResponse, source: "groq"\|"mock" }` - see [ARCHITECTURE.md](ARCHITECTURE.md#ai-assist) |
| POST | `/tickets/:id/attachments` | Bearer (ticket-visible) | `multipart/form-data`, field `file`, 5MB max, whitelisted types |
| GET | `/tickets/:id/attachments/:attachmentId` | Bearer (ticket-visible) | Streams the file (`Content-Disposition: attachment`) |
| GET | `/tickets/:id/comments` | Bearer (ticket-visible) | Internal notes filtered out for customers |
| POST | `/tickets/:id/comments` | Bearer (ticket-visible) | `{ text, isInternal }` - `isInternal` is ignored (forced false) if the caller is a customer |

**Example - illegal transition:**
```http
PATCH /api/v1/tickets/691a.../status
Authorization: Bearer eyJ...
Content-Type: application/json

{ "status": "RESOLVED" }
```
```json
{
  "success": false,
  "error": {
    "code": "INVALID_STATUS_TRANSITION",
    "message": "A ticket cannot move from OPEN directly to RESOLVED."
  },
  "requestId": "a1b2c3..."
}
```

## Admin

All routes below require `requireAuth` + `requireRole("ADMIN")`.

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/users` 📄 | Query: `role, page, limit` |
| PATCH | `/admin/users/:id` | `{ role?, isActive? }` - can't deactivate your own account |
| GET | `/admin/categories` | All categories (active and inactive) |
| POST | `/admin/categories` | `{ name, description? }` |
| PATCH | `/admin/categories/:id` | `{ isActive }` |
| GET | `/admin/sla-policies` | Current policy per priority |
| PUT | `/admin/sla-policies/:priority` | `{ responseMinutes, resolutionMinutes }` (upsert) |
| POST | `/admin/dev-assistant/ask` | `{ question }` - multi-agent codebase investigator. Returns `{ selectedAgents, findings, diagnosis, suggestedFix, source: "groq"\|"mock" }`. Tighter rate limit (10/15min) - see [ARCHITECTURE.md](ARCHITECTURE.md#ai-dev-assistant) |
| POST | `/admin/dev-assistant/apply-fix` | `{ targetFile, oldCode, newCode }` - applies a fix from `suggestedFix` above. Immediately re-runs the real test suite; auto-reverts the file if it fails. Returns `{ applied, testsPassed, testSummary }`. The ONLY write path in this feature - reachable only after a human reviews the diff and explicitly calls this. |

## Notifications

Persisted, per-user notifications - currently written only by the SLA
breach background job (see [ARCHITECTURE.md](ARCHITECTURE.md#background-jobs)),
generic enough for future notification types.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/notifications` 📄 | Bearer | Own notifications, newest first |
| GET | `/notifications/unread-count` | Bearer | `{ count }` |
| PATCH | `/notifications/:id/read` | Bearer | Marks one read (scoped to the caller - can't mark another user's) |
| PATCH | `/notifications/read-all` | Bearer | Marks all of the caller's unread notifications read |
| POST | `/admin/jobs/sla-check/run` | Admin | Manually runs the SLA breach job on demand (same function the 1-minute cron calls) |

## Audit Logs

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/audit-logs` 📄 | Admin | Query: `entity, entityId, actor, action, page, limit` |

## Dashboard

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/dashboard/summary` | Agent/Admin | `{ total, open, inProgress, resolved, critical, slaBreaches, avgResolutionMinutes }` |
| GET | `/dashboard/analytics` | Agent/Admin | `{ byStatus, byPriority, byCategory, byAgent[] }` (counts per group) |

## Real-time events (Socket.IO, not REST)

Connect with `io(url, { auth: { token: accessToken } })`. Events received:

| Event | Payload | When |
|---|---|---|
| `ticket:created` | full ticket | A customer creates a ticket (sent to the `agents` room) |
| `ticket:updated` | full ticket | Status change, assignment, reassignment, or priority change (sent to the ticket's customer AND the `agents` room) |
| `devAssistant:step` | `{ agent, status, summary? }` | Live progress from an in-flight `POST /admin/dev-assistant/ask` - sent only to the asking admin's own room, not broadcast |
| `notification:new` | full notification | The SLA breach job created a new notification for this user - sent only to that user's own room |

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the authentication and room
model prevent duplicate/ghost updates.
