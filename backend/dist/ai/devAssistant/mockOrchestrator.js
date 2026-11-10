"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDevAssistantMock = runDevAssistantMock;
// The AI Dev Assistant's no-API-key fallback - same principle as
// ai/mockAnalyzer.ts: the app (and this feature) must work with zero API
// key. No LLM planner and no LLM synthesis here; a simple keyword heuristic
// picks agents, and the "diagnosis" is just the raw findings, clearly
// labeled as such rather than dressed up as an AI opinion.
const tools_1 = require("./tools");
function pickAgents(question) {
    const q = question.toLowerCase();
    const agents = ["repo"]; // always search the codebase
    if (/\b(log|error|exception|crash)\b/.test(q))
        agents.push("log");
    if (/\b(test|broken|bug|regression|fail)\b/.test(q))
        agents.push("test");
    agents.push("git"); // cheap, usually relevant context
    return agents;
}
async function runDevAssistantMock(question, onStep) {
    onStep("orchestrator", "running");
    const selectedAgents = pickAgents(question);
    onStep("orchestrator", "done", `Selected (keyword heuristic, no LLM): ${selectedAgents.join(", ")}`);
    const findings = {};
    const keywords = (0, tools_1.extractSearchKeywords)(question);
    for (const agent of selectedAgents) {
        onStep(agent, "running");
        let result;
        if (agent === "repo")
            result = await (0, tools_1.searchRepo)(keywords);
        else if (agent === "git")
            result = await (0, tools_1.getRecentGitLog)(10);
        else if (agent === "log")
            result = (0, tools_1.searchRecentLogs)(keywords);
        else
            result = await (0, tools_1.runTestSuite)();
        findings[agent] = result;
        onStep(agent, "done", result.length > 800 ? `${result.slice(0, 800)}…` : result);
    }
    onStep("diagnosis", "running");
    const diagnosis = "No GROQ_API_KEY configured - showing raw findings only, no AI synthesis. " +
        "Set GROQ_API_KEY for an actual diagnosis and recommendation.\n\n" +
        Object.entries(findings)
            .map(([agent, text]) => `--- ${agent} ---\n${text}`)
            .join("\n\n");
    onStep("diagnosis", "done", diagnosis);
    // No fix suggestion without a real model - generating a code patch is a
    // genuinely higher-stakes action than a keyword-heuristic diagnosis, not
    // something to fake with string templates the way the diagnosis text is.
    onStep("suggestFix", "done", "No GROQ_API_KEY configured - fix suggestions require a real model.");
    return {
        selectedAgents,
        findings,
        diagnosis,
        suggestedFix: { fixAvailable: false, targetFile: "", oldCode: "", newCode: "", explanation: "" },
    };
}
