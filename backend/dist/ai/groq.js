"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroqRateLimitError = void 0;
exports.groqKeys = groqKeys;
exports.isRateLimit = isRateLimit;
exports.withGroqKey = withGroqKey;
exports.groqModel = groqModel;
const groq_1 = require("@langchain/groq");
const env_1 = require("../config/env");
const logger_1 = require("../observability/logger");
// Groq's free plan allows only about 8,000 tokens per minute per account, and
// one demo run makes several AI calls in a row (intake, refund agent, chat).
// A rate-limited call used to make the agents quietly fall back to simple
// rules. This module makes the AI calls more robust:
//   - calls are spread over every configured key (GROQ_API_KEY, _2, _3);
//   - when a key is rate limited (HTTP 429) the next key is tried;
//   - after every key has been tried once, wait a few seconds and try once more;
//   - the model is asked for LOW reasoning effort, so each call is smaller.
function groqKeys() {
    return [env_1.env.GROQ_API_KEY, env_1.env.GROQ_API_KEY_2, env_1.env.GROQ_API_KEY_3].filter((k) => !!k);
}
class GroqRateLimitError extends Error {
    constructor(message) {
        super(message);
        this.name = "GroqRateLimitError";
    }
}
exports.GroqRateLimitError = GroqRateLimitError;
function isRateLimit(err) {
    if (err instanceof GroqRateLimitError)
        return true;
    const e = err;
    return e?.status === 429 || e?.statusCode === 429 || /\b429\b|rate limit/i.test(String(e?.message ?? ""));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let cursor = 0;
// Runs one AI call with failover across keys. Only rate-limit errors are
// retried; any other error is thrown straight away.
async function withGroqKey(fn, waitMs = 8000) {
    const keys = groqKeys();
    if (keys.length === 0)
        throw new Error("No GROQ_API_KEY is configured.");
    const start = cursor++ % keys.length;
    let lastErr;
    for (let round = 0; round < 2; round++) {
        for (let i = 0; i < keys.length; i++) {
            const index = (start + i) % keys.length;
            try {
                return await fn(keys[index]);
            }
            catch (err) {
                lastErr = err;
                if (!isRateLimit(err))
                    throw err;
                logger_1.logger.warn({ keyNumber: index + 1, round: round + 1 }, "Groq rate limit reached, trying the next key");
            }
        }
        if (round === 0)
            await sleep(waitMs);
    }
    throw lastErr;
}
function build(apiKey, temperature) {
    return new groq_1.ChatGroq({
        apiKey,
        model: env_1.env.AI_MODEL,
        temperature,
        maxRetries: 0, // failover above replaces the library's own quick retries
        reasoningEffort: "low",
    });
}
// Drop-in replacement for `new ChatGroq(...)` in the agents.
//   groqModel(0.1).invoke(messages)
//   groqModel(0.1).structured(zodSchema).invoke(messages)
function groqModel(temperature) {
    return {
        invoke: (messages) => withGroqKey((key) => build(key, temperature).invoke(messages)),
        structured: (schema) => ({
            invoke: (messages) => withGroqKey((key) => build(key, temperature).withStructuredOutput(schema).invoke(messages)),
        }),
    };
}
