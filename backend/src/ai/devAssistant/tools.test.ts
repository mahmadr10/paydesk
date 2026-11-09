import { describe, it, expect } from "vitest";
import { extractSearchKeywords } from "./tools";

// Regression coverage for a real bug caught during live verification (see
// BUILD_LOG.md): the first version reduced a whole question down to ONE
// combined phrase and searched for it as a literal substring, so a genuinely
// answerable question ("where is authentication implemented") came back
// empty every time - nothing in the code says "authentication implemented"
// verbatim. Fixed by returning multiple OR-able keywords, expanded through a
// small synonym table for this codebase's actual vocabulary.
describe("extractSearchKeywords", () => {
  it("extracts a meaningful keyword from a natural-language question, not the whole phrase", () => {
    const keywords = extractSearchKeywords("Where is authentication implemented in this codebase?");
    expect(keywords).toContain("authentication");
    // The bug: previously this would have been ONE joined string like
    // "where authentication implemented this" - never multiple standalone terms.
    expect(keywords.every((k) => !k.includes(" "))).toBe(true);
  });

  it("expands a known term into this codebase's actual vocabulary via the synonym table", () => {
    const keywords = extractSearchKeywords("Where is authentication implemented?");
    expect(keywords).toEqual(expect.arrayContaining(["auth", "jwt", "login", "token"]));
  });

  it("filters out filler/question words", () => {
    const keywords = extractSearchKeywords("Why are ticket updates sometimes duplicated on the frontend?");
    expect(keywords).not.toContain("why");
    expect(keywords).not.toContain("are");
    expect(keywords).not.toContain("sometimes");
  });

  it("never returns an empty list for a real question", () => {
    expect(extractSearchKeywords("Why are ticket updates sometimes duplicated?").length).toBeGreaterThan(0);
  });
});
