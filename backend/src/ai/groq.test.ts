import { describe, it, expect, vi } from "vitest";

vi.mock("../config/env", () => ({
  env: { GROQ_API_KEY: "key-one", GROQ_API_KEY_2: "key-two", GROQ_API_KEY_3: undefined, AI_MODEL: "test-model" },
}));
vi.mock("../observability/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { GroqRateLimitError, groqKeys, isRateLimit, withGroqKey } from "./groq";

describe("Groq key failover", () => {
  it("uses every configured key and skips unset ones", () => {
    expect(groqKeys()).toEqual(["key-one", "key-two"]);
  });

  it("recognises rate-limit errors", () => {
    expect(isRateLimit(new GroqRateLimitError("slow down"))).toBe(true);
    expect(isRateLimit({ status: 429 })).toBe(true);
    expect(isRateLimit(new Error("429 Rate limit reached for model"))).toBe(true);
    expect(isRateLimit(new Error("connection reset"))).toBe(false);
    expect(isRateLimit({ status: 401 })).toBe(false);
  });

  it("spreads calls over the keys", async () => {
    const first = await withGroqKey(async (k) => k);
    const second = await withGroqKey(async (k) => k);
    expect(first).not.toBe(second);
  });

  it("moves to the next key when one is rate limited", async () => {
    const tried: string[] = [];
    const result = await withGroqKey(async (k) => {
      tried.push(k);
      if (tried.length === 1) throw new GroqRateLimitError("limit");
      return `ok-${k}`;
    }, 0);
    expect(tried).toHaveLength(2);
    expect(tried[0]).not.toBe(tried[1]);
    expect(result).toBe(`ok-${tried[1]}`);
  });

  it("waits and tries again when every key is rate limited once", async () => {
    let calls = 0;
    const result = await withGroqKey(async () => {
      calls++;
      if (calls <= 2) throw new GroqRateLimitError("limit"); // both keys fail in round 1
      return "ok";
    }, 0);
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after two full rounds of rate limits", async () => {
    let calls = 0;
    await expect(
      withGroqKey(async () => {
        calls++;
        throw new GroqRateLimitError("still limited");
      }, 0)
    ).rejects.toThrow("still limited");
    expect(calls).toBe(4); // 2 keys x 2 rounds
  });

  it("does not retry other kinds of errors", async () => {
    let calls = 0;
    await expect(
      withGroqKey(async () => {
        calls++;
        throw new Error("invalid api key");
      }, 0)
    ).rejects.toThrow("invalid api key");
    expect(calls).toBe(1);
  });
});
