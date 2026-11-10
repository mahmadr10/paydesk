"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mockAnalyzer_1 = require("./mockAnalyzer");
// The mock analyzer is what CI, and anyone running this project with no
// GROQ_API_KEY, actually exercises - it's the load-bearing "the app must
// still run without the API key" path, not just a stub, so it gets real
// test coverage of its own.
(0, vitest_1.describe)("mockAnalyzeTicket", () => {
    const validCategories = ["Payment", "Account", "Technical", "Other"];
    (0, vitest_1.it)("flags an outage/500-style description as CRITICAL", () => {
        const result = (0, mockAnalyzer_1.mockAnalyzeTicket)({
            title: "Payment API returns 500",
            description: "Our checkout is completely down, customers cannot pay at all.",
            validCategories,
        });
        (0, vitest_1.expect)(result.suggestedPriority).toBe("CRITICAL");
    });
    (0, vitest_1.it)("flags a clear error/bug as HIGH", () => {
        const result = (0, mockAnalyzer_1.mockAnalyzeTicket)({
            title: "Login is broken",
            description: "Getting an error when I try to log in, it's not working.",
            validCategories,
        });
        (0, vitest_1.expect)(result.suggestedPriority).toBe("HIGH");
    });
    (0, vitest_1.it)("flags a cosmetic-issue ticket as LOW", () => {
        const result = (0, mockAnalyzer_1.mockAnalyzeTicket)({
            title: "Minor cosmetic issue on the settings page",
            description: "There's a small alignment issue with one of the buttons.",
            validCategories,
        });
        (0, vitest_1.expect)(result.suggestedPriority).toBe("LOW");
    });
    (0, vitest_1.it)("defaults to MEDIUM when no keyword matches", () => {
        const result = (0, mockAnalyzer_1.mockAnalyzeTicket)({
            title: "Invoice line item review",
            description: "I'd like clarification on a specific charge listed in last month's statement.",
            validCategories,
        });
        (0, vitest_1.expect)(result.suggestedPriority).toBe("MEDIUM");
    });
    (0, vitest_1.it)("only ever suggests a category from the provided valid list", () => {
        const result = (0, mockAnalyzer_1.mockAnalyzeTicket)({
            title: "Payment issue",
            description: "My payment failed during checkout.",
            validCategories,
        });
        (0, vitest_1.expect)(validCategories).toContain(result.suggestedCategory);
    });
    (0, vitest_1.it)("falls back to the first valid category when nothing matches by keyword", () => {
        const result = (0, mockAnalyzer_1.mockAnalyzeTicket)({
            title: "Something odd happened",
            description: "Not sure how to describe it.",
            validCategories,
        });
        (0, vitest_1.expect)(result.suggestedCategory).toBe(validCategories[0]);
    });
    (0, vitest_1.it)("falls back to 'Other' when no valid categories are provided at all", () => {
        const result = (0, mockAnalyzer_1.mockAnalyzeTicket)({ title: "x", description: "y", validCategories: [] });
        (0, vitest_1.expect)(result.suggestedCategory).toBe("Other");
    });
    (0, vitest_1.it)("always returns a non-empty summary and suggested response", () => {
        const result = (0, mockAnalyzer_1.mockAnalyzeTicket)({ title: "Cannot access dashboard", description: "Blank page after login.", validCategories });
        (0, vitest_1.expect)(result.summary.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(result.suggestedResponse.length).toBeGreaterThan(0);
    });
});
