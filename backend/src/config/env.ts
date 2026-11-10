import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().default("4000"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required - check your .env file"),
  // Separate secrets for access vs refresh tokens: if one ever leaked, the
  // other token type stays safe - they're independently rotatable.
  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required - check your .env file"),
  JWT_REFRESH_COOKIE_NAME: z.string().default("refreshToken"),
  FRONTEND_ORIGIN: z.string().default("http://localhost:5173"),

  // Observability (OpenTelemetry) - all optional, all defaulted, so the app
  // runs identically whether or not any of this is configured. Read directly
  // via process.env in observability/tracing.ts too (that file must init
  // BEFORE this module's dotenv.config() import chain even matters for
  // instrumentation timing reasons), but declared here as well so they show
  // up in the one place the rest of the app's config lives, and so a typo'd
  // value fails fast at startup like every other env var does.
  OTEL_ENABLED: z.enum(["true", "false"]).default("true"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_METRICS_PORT: z.string().default("9464"),
  OTEL_SERVICE_NAME: z.string().default("servicedesk-backend"),

  // AI ticket assistant (spec's optional bonus feature) - see
  // ai/ticketAnalysisGraph.ts and services/aiService.ts. GROQ_API_KEY absent
  // (or AI_ENABLED=false) means the app runs a deterministic mock analyzer
  // instead of calling out to an LLM - the app must work with zero API key.
  AI_ENABLED: z.enum(["true", "false"]).default("true"),
  GROQ_API_KEY: z.string().optional(),
  // Groq's model lineup changes over time (the Llama 3.x models this
  // originally targeted were retired) - verified live against
  // https://api.groq.com/openai/v1/models during development; gpt-oss-120b
  // explicitly supports structured output, which the classify node relies
  // on. Override via AI_MODEL if this one is retired too - check that
  // endpoint (with your own key) for the current lineup.
  AI_MODEL: z.string().default("openai/gpt-oss-120b"),

  // Background jobs (jobs/slaBreachJob.ts). Off in tests (no point scanning
  // for breaches against a throwaway in-memory DB that's gone in seconds)
  // and in the E2E harness (nothing there depends on it, and a cron ticking
  // during a short-lived test run is just noise).
  JOBS_ENABLED: z.enum(["true", "false"]).default("true"),
  CRON_SECRET: z.string().optional(),

  // PayPal (sandbox). Both keys come from developer.paypal.com -> Apps &
  // Credentials -> Sandbox. Leave them unset and the app runs a simulated
  // PayPal so it still works end to end without an account.
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_API_BASE: z.string().default("https://api-m.sandbox.paypal.com"),
  PAYPAL_CURRENCY: z.string().default("USD"),
  // Webhook id from developer.paypal.com (your app -> Webhooks). Needed to
  // verify that incoming webhook calls really come from PayPal.
  PAYPAL_WEBHOOK_ID: z.string().optional(),

  // Refund policy the AI agent is checked against (not just told about).
  REFUND_WINDOW_DAYS: z.coerce.number().int().positive().default(30),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  console.error("❌ Invalid or missing environment variables:\n" + issues);
  if (!process.env.VERCEL) {
    process.exit(1);
  }
  throw new Error("Invalid or missing environment variables:\n" + issues);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
