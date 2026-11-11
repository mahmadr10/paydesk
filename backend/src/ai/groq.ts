import { ChatGroq } from "@langchain/groq";
import type { z } from "zod";
import { env } from "../config/env";
import { logger } from "../observability/logger";

// Groq's free plan allows only about 8,000 tokens per minute per account, and
// one demo run makes several AI calls in a row (intake, refund agent, chat).
// A rate-limited call used to make the agents quietly fall back to simple
// rules. This module makes the AI calls more robust:
//   - calls are spread over every configured key (GROQ_API_KEY, _2, _3);
//   - when a key is rate limited (HTTP 429) the next key is tried;
//   - after every key has been tried once, wait a few seconds and try once more;
//   - the model is asked for LOW reasoning effort, so each call is smaller.

export function groqKeys(): string[] {
  return [env.GROQ_API_KEY, env.GROQ_API_KEY_2, env.GROQ_API_KEY_3].filter((k): k is string => !!k);
}

export class GroqRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroqRateLimitError";
  }
}

export function isRateLimit(err: unknown): boolean {
  if (err instanceof GroqRateLimitError) return true;
  const e = err as { status?: number; statusCode?: number; message?: string } | null;
  return e?.status === 429 || e?.statusCode === 429 || /\b429\b|rate limit/i.test(String(e?.message ?? ""));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let cursor = 0;

// Runs one AI call with failover across keys. Only rate-limit errors are
// retried; any other error is thrown straight away.
export async function withGroqKey<T>(fn: (apiKey: string) => Promise<T>, waitMs = 8000): Promise<T> {
  const keys = groqKeys();
  if (keys.length === 0) throw new Error("No GROQ_API_KEY is configured.");
  const start = cursor++ % keys.length;
  let lastErr: unknown;
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < keys.length; i++) {
      const index = (start + i) % keys.length;
      try {
        return await fn(keys[index]);
      } catch (err) {
        lastErr = err;
        if (!isRateLimit(err)) throw err;
        logger.warn({ keyNumber: index + 1, round: round + 1 }, "Groq rate limit reached, trying the next key");
      }
    }
    if (round === 0) await sleep(waitMs);
  }
  throw lastErr;
}

type Messages = Parameters<ChatGroq["invoke"]>[0];

function build(apiKey: string, temperature: number) {
  return new ChatGroq({
    apiKey,
    model: env.AI_MODEL,
    temperature,
    maxRetries: 0, // failover above replaces the library's own quick retries
    reasoningEffort: "low",
  });
}

// Drop-in replacement for `new ChatGroq(...)` in the agents.
//   groqModel(0.1).invoke(messages)
//   groqModel(0.1).structured(zodSchema).invoke(messages)
export function groqModel(temperature: number) {
  return {
    invoke: (messages: Messages) => withGroqKey((key) => build(key, temperature).invoke(messages)),
    structured: <S extends z.ZodType>(schema: S) => ({
      invoke: (messages: Messages) =>
        withGroqKey((key) => build(key, temperature).withStructuredOutput(schema).invoke(messages)) as Promise<z.infer<S>>,
    }),
  };
}
