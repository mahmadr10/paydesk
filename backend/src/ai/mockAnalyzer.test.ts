import { describe, it, expect } from "vitest";
import { mockAnalyzeTicket } from "./mockAnalyzer";

// The mock analyzer is what CI, and anyone running this project with no
// GROQ_API_KEY, actually exercises - it's the load-bearing "the app must
// still run without the API key" path, not just a stub, so it gets real
// test coverage of its own.
describe("mockAnalyzeTicket", () => {
  const validCategories = ["Payment", "Account", "Technical", "Other"];

  it("flags an outage/500-style description as CRITICAL", () => {
    const result = mockAnalyzeTicket({
      title: "Payment API returns 500",
      description: "Our checkout is completely down, customers cannot pay at all.",
      validCategories,
    });
    expect(result.suggestedPriority).toBe("CRITICAL");
  });

  it("flags a clear error/bug as HIGH", () => {
    const result = mockAnalyzeTicket({
      title: "Login is broken",
      description: "Getting an error when I try to log in, it's not working.",
      validCategories,
    });
    expect(result.suggestedPriority).toBe("HIGH");
  });

  it("flags a cosmetic-issue ticket as LOW", () => {
    const result = mockAnalyzeTicket({
      title: "Minor cosmetic issue on the settings page",
      description: "There's a small alignment issue with one of the buttons.",
      validCategories,
    });
    expect(result.suggestedPriority).toBe("LOW");
  });

  it("defaults to MEDIUM when no keyword matches", () => {
    const result = mockAnalyzeTicket({
      title: "Invoice line item review",
      description: "I'd like clarification on a specific charge listed in last month's statement.",
      validCategories,
    });
    expect(result.suggestedPriority).toBe("MEDIUM");
  });

  it("only ever suggests a category from the provided valid list", () => {
    const result = mockAnalyzeTicket({
      title: "Payment issue",
      description: "My payment failed during checkout.",
      validCategories,
    });
    expect(validCategories).toContain(result.suggestedCategory);
  });

  it("falls back to the first valid category when nothing matches by keyword", () => {
    const result = mockAnalyzeTicket({
      title: "Something odd happened",
      description: "Not sure how to describe it.",
      validCategories,
    });
    expect(result.suggestedCategory).toBe(validCategories[0]);
  });

  it("falls back to 'Other' when no valid categories are provided at all", () => {
    const result = mockAnalyzeTicket({ title: "x", description: "y", validCategories: [] });
    expect(result.suggestedCategory).toBe("Other");
  });

  it("always returns a non-empty summary and suggested response", () => {
    const result = mockAnalyzeTicket({ title: "Cannot access dashboard", description: "Blank page after login.", validCategories });
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.suggestedResponse.length).toBeGreaterThan(0);
  });
});
