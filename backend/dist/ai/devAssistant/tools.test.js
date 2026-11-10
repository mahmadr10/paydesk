"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const tools_1 = require("./tools");
// Regression coverage for a real bug caught during live verification (see
// BUILD_LOG.md): the first version reduced a whole question down to ONE
// combined phrase and searched for it as a literal substring, so a genuinely
// answerable question ("where is authentication implemented") came back
// empty every time - nothing in the code says "authentication implemented"
// verbatim. Fixed by returning multiple OR-able keywords, expanded through a
// small synonym table for this codebase's actual vocabulary.
(0, vitest_1.describe)("extractSearchKeywords", () => {
    (0, vitest_1.it)("extracts a meaningful keyword from a natural-language question, not the whole phrase", () => {
        const keywords = (0, tools_1.extractSearchKeywords)("Where is authentication implemented in this codebase?");
        (0, vitest_1.expect)(keywords).toContain("authentication");
        // The bug: previously this would have been ONE joined string like
        // "where authentication implemented this" - never multiple standalone terms.
        (0, vitest_1.expect)(keywords.every((k) => !k.includes(" "))).toBe(true);
    });
    (0, vitest_1.it)("expands a known term into this codebase's actual vocabulary via the synonym table", () => {
        const keywords = (0, tools_1.extractSearchKeywords)("Where is authentication implemented?");
        (0, vitest_1.expect)(keywords).toEqual(vitest_1.expect.arrayContaining(["auth", "jwt", "login", "token"]));
    });
    (0, vitest_1.it)("filters out filler/question words", () => {
        const keywords = (0, tools_1.extractSearchKeywords)("Why are ticket updates sometimes duplicated on the frontend?");
        (0, vitest_1.expect)(keywords).not.toContain("why");
        (0, vitest_1.expect)(keywords).not.toContain("are");
        (0, vitest_1.expect)(keywords).not.toContain("sometimes");
    });
    (0, vitest_1.it)("never returns an empty list for a real question", () => {
        (0, vitest_1.expect)((0, tools_1.extractSearchKeywords)("Why are ticket updates sometimes duplicated?").length).toBeGreaterThan(0);
    });
});
