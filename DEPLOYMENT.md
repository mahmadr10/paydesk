# Deployment

## MongoDB Atlas setup

1. Sign up / log in at https://cloud.mongodb.com
2. **Create a free (M0) cluster** - any region, any name.
3. **Database Access** → create a database user (username + password;
   "Autogenerate Secure Password" is fine, just save it - Atlas won't show
   it again).
4. **Network Access** → **Add IP Address** → **Allow Access From Anywhere**
   (`0.0.0.0/0`) for this project's purposes; a real production deployment
   would instead allowlist only the deploying server's IP.
5. **Database** → **Connect** → **Drivers** → copy the connection string,
   replace `<password>` with your real password, and (recommended) add a
   database name before the `?`: `.../servicedesk?retryWrites=...`.

## Environment variables

### `backend/.env`

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | no (default `development`) | Set `production` on a real deploy - disables pretty-printed logs, marks refresh cookies `secure` |
| `PORT` | no (default `4000`) | |
| `MONGODB_URI` | **yes** | Atlas connection string (above) or any MongoDB instance |
| `JWT_ACCESS_SECRET` | **yes** | Long random string - signs access tokens |
| `JWT_REFRESH_COOKIE_NAME` | no (default `refreshToken`) | |
| `FRONTEND_ORIGIN` | no (default `http://localhost:5173`) | Must match the frontend's real URL in production, for CORS + cookie scoping |
| `LOG_LEVEL` | no (default `info`) | Pino level: `trace\|debug\|info\|warn\|error\|fatal` |
| `OTEL_ENABLED` | no (default `true`) | Set `false` to disable OpenTelemetry entirely |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no (unset = console) | e.g. `http://localhost:4318` for a local Jaeger/collector; unset prints traces to the console instead |
| `OTEL_METRICS_PORT` | no (default `9464`) | Prometheus metrics served at `/metrics` on this port |

### `frontend/.env` (build-time - see note below)

| Variable | Notes |
|---|---|
| `VITE_API_URL` | Backend's API base, e.g. `https://api.yourapp.com/api/v1` |
| `VITE_SOCKET_URL` | Backend's base (no `/api/v1`), e.g. `https://api.yourapp.com` |

**Important**: Vite bakes `VITE_*` variables into the compiled JS at
**build** time - there's no way to change them after the static files are
built (unlike the backend's env vars, which are read at container start).
Set them correctly *before* running `npm run build` / the Docker build.

## Running with Docker

```bash
docker compose up
```

Starts a local MongoDB + backend + frontend **+ Jaeger** together. See root
`docker-compose.yml` and `.env.example` for overriding any of the above
(e.g. pointing `MONGODB_URI` at a real Atlas cluster instead of the bundled
local Mongo). Details on the container design (multi-stage builds, non-root
user, volumes) are commented directly in `backend/Dockerfile` and
`frontend/Dockerfile`.

Once up: traces at http://localhost:16686 (Jaeger UI - click a trace and
you'll see `HTTP → Express → Service → MongoDB` spans nested, per
[ARCHITECTURE.md](ARCHITECTURE.md#observability)), metrics at
http://localhost:9464/metrics.

> This was written carefully but not run end-to-end in the environment this
> project was built in (Docker wasn't installed there). Run
> `docker compose up` once yourself and confirm the three services come up
> healthy before relying on this for a real deployment.

## CI/CD

`.github/workflows/ci.yml` runs on every PR and push to `main`:
**install → lint → typecheck → test → build**, for both `backend/` and
`frontend/` as separate jobs. See [TESTING.md](TESTING.md#demonstrating-a-failing--passing-ci-run)
for how to demonstrate it actually catching a regression.

There is currently **no CD (auto-deploy) job** - see the next section for
why, and what adding one would look like.

## Deploying live

You can deploy the backend to **Vercel** (Serverless Functions) or **Render** (persistent container), and the frontend to **Vercel**.

### Backend on Vercel (Serverless)

The backend has been adapted to run seamlessly on Vercel serverless functions via `backend/api/index.ts` and `backend/vercel.json`:
- **Serverless database pooling**: Caches MongoDB connections across warm lambdas to prevent connection exhaustion.
- **Auto-initialization**: Seeds defaults (categories, SLA policies) automatically on cold starts.
- **Cross-origin cookies**: Configured with `SameSite=None` and `Secure` in production so refresh tokens work across different Vercel domains.
- **SLA Breach Cron**: Runs via Vercel Cron (`/api/cron/sla-breach`) instead of a persistent background interval.
- **Real-time note**: Socket.IO events gracefully degrade to silent no-ops in serverless mode (REST API and notifications persist normally in MongoDB).

#### Step-by-step:

1. [vercel.com](https://vercel.com) → **Add New** → **Project** → Import your repository.
2. In the setup screen:
   - **Root Directory**: Click "Edit" and choose **`backend`**.
   - **Framework Preset**: Other (default).
   - **Build Command**: `npm run build` (or leave default).
   - **Output Directory**: Leave empty / default.
3. Under **Environment Variables**, add:
   - `NODE_ENV` = `production`
   - `MONGODB_URI` = your MongoDB Atlas connection string (e.g. `mongodb+srv://...`)
   - `JWT_ACCESS_SECRET` = a secure random string (at least 32 characters)
   - `FRONTEND_ORIGIN` = your frontend Vercel URL (e.g. `https://paydesk.vercel.app` or multiple separated by comma: `https://paydesk.vercel.app,http://localhost:5173`)
   - `AI_ENABLED` = `true` (optional)
   - `GROQ_API_KEY` = your Groq API key (optional)
   - `PAYPAL_CLIENT_ID` = your PayPal Sandbox Client ID (optional)
   - `PAYPAL_CLIENT_SECRET` = your PayPal Sandbox Secret (optional)
   - `CRON_SECRET` = random secret string for Vercel Cron authentication (optional)
4. Click **Deploy**.
5. Once deployed, test your API:
   - `https://<your-backend>.vercel.app/` -> returns `{ "success": true, "message": "PayDesk API is running" }`
   - `https://<your-backend>.vercel.app/api/health` -> returns `{ "success": true, "database": "connected" }`

### Backend on Render (Persistent Container)

If you prefer keeping persistent WebSockets for live Socket.IO events, Render keeps a persistent Node container alive. A `render.yaml` Blueprint at the repo root does most of this for you:

1. [render.com](https://render.com) → sign up/log in (GitHub login is
   easiest, since the next step needs repo access anyway).
2. **New +** → **Blueprint** → connect the `mahmadr10/servicedesk` GitHub
   repo → Render reads `render.yaml` and shows the one service it defines
   (`servicedesk-backend`, building from `backend/Dockerfile`).
3. It'll prompt for the env vars marked `sync: false` in that file:
   - `MONGODB_URI` - your Atlas connection string (see setup above)
   - `JWT_ACCESS_SECRET` - a long random string (generate a new one, don't
     reuse the local dev value)
   - `FRONTEND_ORIGIN` - leave blank for now, come back and set it once
     Vercel gives you a URL (step below)
   - `GROQ_API_KEY` - optional; omit it and the AI features run their mock
     fallback in production instead
4. **Apply** - Render builds the Docker image and deploys it. Takes a few
   minutes on the free tier's first build. You'll get a URL like
   `https://servicedesk-backend-xxxx.onrender.com`.
5. Confirm it's alive: `https://<that-url>/api/health` should return
   `{"success":true,...}`.

There's no bundled Jaeger on Render (that's a `docker-compose.yml`
convenience for local dev) - traces print to Render's own log stream
instead, or point `OTEL_EXPORTER_OTLP_ENDPOINT` at a real hosted OTel
backend (Grafana Cloud, Honeycomb, etc.) if you have one.

### Frontend on Vercel

1. [vercel.com](https://vercel.com) → sign up/log in with GitHub.
2. **Add New** → **Project** → import the same `mahmadr10/servicedesk` repo.
3. **Root Directory** → set to `frontend` (Vercel needs to know this isn't
   a single-project repo).
4. Framework preset should auto-detect **Vite**. Build command
   `npm run build`, output directory `dist` (Vercel usually fills these in
   automatically once it detects Vite).
5. **Environment Variables** → add, using the Render URL from above:
   - `VITE_API_URL` = `https://<your-render-url>/api/v1`
   - `VITE_SOCKET_URL` = `https://<your-render-url>` (no `/api/v1` suffix)
6. **Deploy**. You'll get a URL like `https://servicedesk-xxxx.vercel.app`.

### Close the loop

Go back to Render → the backend service → Environment → set
`FRONTEND_ORIGIN` to the real Vercel URL from step 6 above → save (Render
redeploys automatically on an env var change). Without this, CORS blocks
every request from the deployed frontend to the deployed backend.

Also, for real production use: MongoDB Atlas → Network Access → restrict
from `0.0.0.0/0` to Render's actual outbound IP range (Render publishes
this) instead of leaving it open to anywhere.

**Adding actual CD**: a `deploy` job in `ci.yml`, gated on
`push: branches: [main]` and the existing jobs passing, that calls the
chosen platform's deploy CLI/API (Render and Railway both have GitHub
Actions available) - not added here since it needs real platform
credentials as GitHub Secrets, which only the account owner can provision.
