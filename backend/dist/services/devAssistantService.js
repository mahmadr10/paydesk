"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.askDevAssistant = askDevAssistant;
exports.applyDevAssistantFix = applyDevAssistantFix;
const env_1 = require("../config/env");
const logger_1 = require("../observability/logger");
const otel_1 = require("../observability/otel");
const io_1 = require("../sockets/io");
const auditLogService_1 = require("./auditLogService");
const orchestratorGraph_1 = require("../ai/devAssistant/orchestratorGraph");
const mockOrchestrator_1 = require("../ai/devAssistant/mockOrchestrator");
const applyFix_1 = require("../ai/devAssistant/applyFix");
// The AI Dev Assistant - same replaceable-abstraction shape as
// aiService.analyzeTicket(): one function, real-vs-mock decided here, real
// implementation and its provider are an implementation detail nobody else
// imports. Admin-only (enforced by the route), investigate-and-recommend
// only (enforced structurally - see ai/devAssistant/tools.ts, there is no
// write tool for the graph to call).
async function askDevAssistant(question, actor) {
    return (0, otel_1.withSpan)("devAssistantService.askDevAssistant", async () => {
        const onStep = (agent, status, summary) => {
            (0, io_1.emitDevAssistantStep)(actor.userId, { agent, status, summary });
        };
        const aiConfigured = env_1.env.AI_ENABLED === "true" && !!env_1.env.GROQ_API_KEY;
        // `source` tracks which path ACTUALLY ran, not just whether a key was
        // configured - a real bug caught during live verification (see
        // BUILD_LOG.md): the graph threw mid-run (an unrelated logging bug),
        // the catch below correctly fell back to the mock, but the response was
        // labeled "groq" anyway because that label was computed from
        // `aiConfigured` alone. A UI showing "Live AI" next to content that's
        // visibly the mock's raw-findings dump is exactly the kind of quietly
        // wrong result a demo (or a real user) could reasonably be misled by.
        let source = aiConfigured ? "groq" : "mock";
        const result = aiConfigured
            ? await (0, orchestratorGraph_1.runDevAssistantGraph)(question, onStep).catch((err) => {
                logger_1.logger.error({ err }, "Dev Assistant graph failed, falling back to mock");
                source = "mock";
                return (0, mockOrchestrator_1.runDevAssistantMock)(question, onStep);
            })
            : await (0, mockOrchestrator_1.runDevAssistantMock)(question, onStep);
        await (0, auditLogService_1.logAction)({
            actor: actor.userId,
            action: "DEV_ASSISTANT_QUERY",
            entity: "System",
            entityId: actor.userId, // no natural entity for a system-wide investigation - attributed to the asking admin
            newValue: { question, selectedAgents: result.selectedAgents },
            metadata: { source },
        });
        return { ...result, source };
    });
}
// The ONE gated write path - reached only after a human has seen the
// suggested diff and explicitly clicked "Apply" (there is no automatic
// call path into this from askDevAssistant above). applyFix.ts does the
// actual safety work (path validation, exact-match validation, apply,
// test, auto-revert-on-failure); this function's job is authorization,
// tracing, and the audit trail.
async function applyDevAssistantFix(input, actor) {
    return (0, otel_1.withSpan)("devAssistantService.applyDevAssistantFix", async () => {
        const result = await (0, applyFix_1.applyFix)(input);
        await (0, auditLogService_1.logAction)({
            actor: actor.userId,
            action: result.applied ? "DEV_ASSISTANT_FIX_APPLIED" : "DEV_ASSISTANT_FIX_REVERTED_TESTS_FAILED",
            entity: "System",
            entityId: actor.userId,
            oldValue: input.oldCode,
            newValue: input.newCode,
            metadata: { targetFile: input.targetFile, testsPassed: result.testsPassed },
        });
        return result;
    });
}
