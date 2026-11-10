"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTicketAnalysisGraph = runTicketAnalysisGraph;
const zod_1 = require("zod");
const langgraph_1 = require("@langchain/langgraph");
const groq_1 = require("@langchain/groq");
const env_1 = require("../config/env");
const Ticket_1 = require("../models/Ticket");
// A real (small) LangGraph, not one prompt call wearing a graph as a costume:
//
//        ┌─→ classify   (category + priority) ─┐
//   START┤                                     ├─→ draftResponse ─→ END
//        └─→ summarize  (2-3 sentence summary) ─┘
//
// `classify` and `summarize` both only need the raw title/description, so
// they run as independent parallel branches (LangGraph batches everything
// reachable from START in one superstep); `draftResponse` genuinely NEEDS
// both of their outputs (it references the category/priority AND the
// summary when drafting a reply), so it can't start until both finish -
// LangGraph waits for every incoming edge before running a fan-in node.
// This is the concrete reason a graph earns its keep here over a single
// prompt: two independent pieces of work, one downstream step that depends
// on both.
const TicketAnalysisState = langgraph_1.Annotation.Root({
    title: (0, langgraph_1.Annotation)(),
    description: (0, langgraph_1.Annotation)(),
    validCategories: (0, langgraph_1.Annotation)(),
    category: (0, langgraph_1.Annotation)(),
    priority: (0, langgraph_1.Annotation)(),
    summary: (0, langgraph_1.Annotation)(),
    suggestedResponse: (0, langgraph_1.Annotation)(),
});
function buildModel() {
    // One model instance per graph run rather than a module-level singleton -
    // this is cheap (no connection to hold open) and means a future per-request
    // override (e.g. a different model for a paid tier) doesn't need rearchitecting.
    return new groq_1.ChatGroq({ apiKey: env_1.env.GROQ_API_KEY, model: env_1.env.AI_MODEL, temperature: 0.2 });
}
const classifySchema = zod_1.z.object({
    category: zod_1.z.string().describe("The single best-fit category name, copied EXACTLY from the provided list."),
    priority: zod_1.z.enum(Ticket_1.TICKET_PRIORITIES).describe("How urgent this ticket is, based on its actual impact and language."),
});
async function classifyNode(state) {
    const model = buildModel().withStructuredOutput(classifySchema);
    const result = await model.invoke([
        {
            role: "system",
            content: "You are a support ticket triage assistant. Pick the single best category from the given list " +
                "(copy it exactly - do not invent a new one) and a priority level reflecting real urgency: " +
                "CRITICAL only for outages/security/data loss/payment failures; HIGH for a clear error/bug blocking " +
                "the user; MEDIUM for a working-but-degraded issue; LOW for cosmetic issues or questions.",
        },
        {
            role: "user",
            content: `Valid categories: ${state.validCategories.join(", ")}\n\nTitle: ${state.title}\n\nDescription: ${state.description}`,
        },
    ]);
    // Guard against the model returning a category that isn't actually in the
    // list despite the instruction - LLMs are probabilistic, this constraint
    // is not - fall back to the first valid category rather than let a
    // hallucinated one leak into ticket data.
    const category = state.validCategories.includes(result.category) ? result.category : state.validCategories[0];
    return { category, priority: result.priority };
}
async function summarizeNode(state) {
    const model = buildModel();
    const result = await model.invoke([
        {
            role: "system",
            content: "Summarize this support ticket in 1-2 plain sentences for a support agent skimming a queue. No preamble, just the summary.",
        },
        { role: "user", content: `Title: ${state.title}\n\nDescription: ${state.description}` },
    ]);
    return { summary: String(result.content).trim() };
}
async function draftResponseNode(state) {
    const model = buildModel();
    const result = await model.invoke([
        {
            role: "system",
            content: "Draft a short, empathetic first response an agent could send to the customer as-is or lightly edit. " +
                "Acknowledge the issue, reference its category/priority naturally, and set an expectation that the team " +
                "is looking into it. 2-4 sentences. No subject line, no signature.",
        },
        {
            role: "user",
            content: `Category: ${state.category}\nPriority: ${state.priority}\nSummary: ${state.summary}\n\nOriginal title: ${state.title}`,
        },
    ]);
    return { suggestedResponse: String(result.content).trim() };
}
const compiledGraph = new langgraph_1.StateGraph(TicketAnalysisState)
    .addNode("classify", classifyNode)
    .addNode("summarize", summarizeNode)
    .addNode("draftResponse", draftResponseNode)
    .addEdge(langgraph_1.START, "classify")
    .addEdge(langgraph_1.START, "summarize")
    .addEdge("classify", "draftResponse")
    .addEdge("summarize", "draftResponse")
    .addEdge("draftResponse", langgraph_1.END)
    .compile();
async function runTicketAnalysisGraph(input) {
    const final = await compiledGraph.invoke({
        title: input.title,
        description: input.description,
        validCategories: input.validCategories,
    });
    return {
        summary: final.summary,
        suggestedCategory: final.category,
        suggestedPriority: final.priority,
        suggestedResponse: final.suggestedResponse,
    };
}
