"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mockAnalyzeTicket = mockAnalyzeTicket;
// The mock/fallback mode the spec explicitly requires: "the application
// [must] still run without the API key." Deterministic keyword matching, not
// a real classifier - good enough to prove the feature's SHAPE end to end
// (UI, API contract, audit log) without ever calling a network, which is
// also why this is what CI runs (no GROQ_API_KEY secret configured there).
const PRIORITY_KEYWORDS = [
    [/\b(down|outage|(?:http )?500|cannot\s+(?:log\s?in|pay|checkout)|data\s?loss|security\s?breach|critical)\b/i, "CRITICAL"],
    [/\b(error|fail(?:ing|ed|ure)?|broken|not\s+working|bug|urgent)\b/i, "HIGH"],
    [/\b(slow|minor|cosmetic|typo|question|how\s+do\s+i|feature\s+request)\b/i, "LOW"],
];
function mockAnalyzeTicket(input) {
    const text = `${input.title} ${input.description}`.toLowerCase();
    let suggestedPriority = "MEDIUM";
    for (const [pattern, priority] of PRIORITY_KEYWORDS) {
        if (pattern.test(text)) {
            suggestedPriority = priority;
            break;
        }
    }
    const suggestedCategory = input.validCategories.find((c) => text.includes(c.toLowerCase())) ?? input.validCategories[0] ?? "Other";
    const summary = input.description.length > 160 ? `${input.title} - ${input.description.slice(0, 160)}…` : `${input.title} - ${input.description}`;
    return {
        summary,
        suggestedCategory,
        suggestedPriority,
        suggestedResponse: `Thanks for reaching out - we've logged "${input.title}" and a member of our team is looking into it. ` +
            `We'll follow up as soon as we have an update.`,
    };
}
