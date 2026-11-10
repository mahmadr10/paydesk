"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeTicket = analyzeTicket;
const env_1 = require("../config/env");
const logger_1 = require("../observability/logger");
const otel_1 = require("../observability/otel");
const mockAnalyzer_1 = require("../ai/mockAnalyzer");
const ticketAnalysisGraph_1 = require("../ai/ticketAnalysisGraph");
// The "replaceable service abstraction" the spec asks for: every caller in
// this app (ticketService, the controller) only ever imports THIS function.
// Nothing outside this file knows LangGraph or Groq exist - swapping the
// provider (a different model, a different vendor entirely, a fine-tuned
// in-house model later) means editing/replacing ai/ticketAnalysisGraph.ts
// and this one call site, never the controller/route/frontend contract.
//
// This IS a static (not lazy/dynamic) import of the LangGraph module -
// tried lazy-loading it via `import()` first (so the mock-only path would
// never even load LangGraph), but `tsx`'s dev-time module resolver doesn't
// remap a `.js`-suffixed dynamic-import specifier to the actual `.ts` file
// the NodeNext convention expects, so every real-mode call silently failed
// and fell back to mock (caught during live verification, see
// BUILD_LOG.md). The module has no expensive side effects at import time
// (ChatGroq instances are constructed inside functions, not at module
// scope; `.compile()` on the graph is pure structure-building, no network
// call, no API key needed) - so a static import is simply the correct fix,
// not a compromise.
async function analyzeTicket(input) {
    return (0, otel_1.withSpan)("aiService.analyzeTicket", async () => {
        const aiConfigured = env_1.env.AI_ENABLED === "true" && !!env_1.env.GROQ_API_KEY;
        if (!aiConfigured) {
            logger_1.logger.info("AI ticket analysis: using mock fallback (AI_ENABLED=false or no GROQ_API_KEY set)");
            return { ...(0, mockAnalyzer_1.mockAnalyzeTicket)(input), source: "mock" };
        }
        try {
            const result = await (0, ticketAnalysisGraph_1.runTicketAnalysisGraph)(input);
            return { ...result, source: "groq" };
        }
        catch (err) {
            // A flaky LLM call is not worth failing the agent's whole request
            // over - degrade to the mock rather than surface a 500 for what's
            // an assistive, non-critical feature.
            logger_1.logger.error({ err }, "AI ticket analysis failed, falling back to mock");
            return { ...(0, mockAnalyzer_1.mockAnalyzeTicket)(input), source: "mock" };
        }
    }, { "ai.category_count": input.validCategories.length });
}
