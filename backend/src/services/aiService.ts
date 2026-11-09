import { env } from "../config/env";
import { logger } from "../observability/logger";
import { withSpan } from "../observability/otel";
import { mockAnalyzeTicket, TicketAnalysisInput, TicketAnalysisOutput } from "../ai/mockAnalyzer";
import { runTicketAnalysisGraph } from "../ai/ticketAnalysisGraph";

export type { TicketAnalysisInput, TicketAnalysisOutput };

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
export async function analyzeTicket(input: TicketAnalysisInput): Promise<TicketAnalysisOutput & { source: "groq" | "mock" }> {
  return withSpan(
    "aiService.analyzeTicket",
    async () => {
      const aiConfigured = env.AI_ENABLED === "true" && !!env.GROQ_API_KEY;
      if (!aiConfigured) {
        logger.info("AI ticket analysis: using mock fallback (AI_ENABLED=false or no GROQ_API_KEY set)");
        return { ...mockAnalyzeTicket(input), source: "mock" as const };
      }

      try {
        const result = await runTicketAnalysisGraph(input);
        return { ...result, source: "groq" as const };
      } catch (err) {
        // A flaky LLM call is not worth failing the agent's whole request
        // over - degrade to the mock rather than surface a 500 for what's
        // an assistive, non-critical feature.
        logger.error({ err }, "AI ticket analysis failed, falling back to mock");
        return { ...mockAnalyzeTicket(input), source: "mock" as const };
      }
    },
    { "ai.category_count": input.validCategories.length }
  );
}
