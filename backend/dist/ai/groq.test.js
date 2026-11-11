"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
vitest_1.vi.mock("../config/env", () => ({
    env: { GROQ_API_KEY: "key-one", GROQ_API_KEY_2: "key-two", GROQ_API_KEY_3: undefined, AI_MODEL: "test-model" },
}));
vitest_1.vi.mock("../observability/logger", () => ({ logger: { warn: vitest_1.vi.fn(), error: vitest_1.vi.fn(), info: vitest_1.vi.fn() } }));
const groq_1 = require("./groq");
(0, vitest_1.describe)("Groq key failover", () => {
    (0, vitest_1.it)("uses every configured key and skips unset ones", () => {
        (0, vitest_1.expect)((0, groq_1.groqKeys)()).toEqual(["key-one", "key-two"]);
    });
    (0, vitest_1.it)("recognises rate-limit errors", () => {
        (0, vitest_1.expect)((0, groq_1.isRateLimit)(new groq_1.GroqRateLimitError("slow down"))).toBe(true);
        (0, vitest_1.expect)((0, groq_1.isRateLimit)({ status: 429 })).toBe(true);
        (0, vitest_1.expect)((0, groq_1.isRateLimit)(new Error("429 Rate limit reached for model"))).toBe(true);
        (0, vitest_1.expect)((0, groq_1.isRateLimit)(new Error("connection reset"))).toBe(false);
        (0, vitest_1.expect)((0, groq_1.isRateLimit)({ status: 401 })).toBe(false);
    });
    (0, vitest_1.it)("spreads calls over the keys", async () => {
        const first = await (0, groq_1.withGroqKey)(async (k) => k);
        const second = await (0, groq_1.withGroqKey)(async (k) => k);
        (0, vitest_1.expect)(first).not.toBe(second);
    });
    (0, vitest_1.it)("moves to the next key when one is rate limited", async () => {
        const tried = [];
        const result = await (0, groq_1.withGroqKey)(async (k) => {
            tried.push(k);
            if (tried.length === 1)
                throw new groq_1.GroqRateLimitError("limit");
            return `ok-${k}`;
        }, 0);
        (0, vitest_1.expect)(tried).toHaveLength(2);
        (0, vitest_1.expect)(tried[0]).not.toBe(tried[1]);
        (0, vitest_1.expect)(result).toBe(`ok-${tried[1]}`);
    });
    (0, vitest_1.it)("waits and tries again when every key is rate limited once", async () => {
        let calls = 0;
        const result = await (0, groq_1.withGroqKey)(async () => {
            calls++;
            if (calls <= 2)
                throw new groq_1.GroqRateLimitError("limit"); // both keys fail in round 1
            return "ok";
        }, 0);
        (0, vitest_1.expect)(result).toBe("ok");
        (0, vitest_1.expect)(calls).toBe(3);
    });
    (0, vitest_1.it)("gives up after two full rounds of rate limits", async () => {
        let calls = 0;
        await (0, vitest_1.expect)((0, groq_1.withGroqKey)(async () => {
            calls++;
            throw new groq_1.GroqRateLimitError("still limited");
        }, 0)).rejects.toThrow("still limited");
        (0, vitest_1.expect)(calls).toBe(4); // 2 keys x 2 rounds
    });
    (0, vitest_1.it)("does not retry other kinds of errors", async () => {
        let calls = 0;
        await (0, vitest_1.expect)((0, groq_1.withGroqKey)(async () => {
            calls++;
            throw new Error("invalid api key");
        }, 0)).rejects.toThrow("invalid api key");
        (0, vitest_1.expect)(calls).toBe(1);
    });
});
