import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { ChatGroq } from "@langchain/groq";
import { env } from "../../config/env";
import { searchRepo, getRecentGitLog, searchRecentLogs, runTestSuite, extractSearchKeywords } from "./tools";

const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");

// The multi-agent shape: an orchestrator PLANS which specialist agents are
// actually relevant to the question (not a fixed pipeline every time -
// asking "why is the SLA math wrong" has no business spinning up a full
// test run), those agents gather evidence in PARALLEL, and a diagnosis
// step synthesizes everything into one answer:
//
//        ┌─→ repoAgent  (grep the codebase)     ─┐
//   plan ─┼─→ gitAgent   (recent commit history) ─┼─→ diagnosis → END
//        ├─→ logAgent   (recent structured logs)─┤
//        └─→ testAgent  (runs the real suite)   ─┘
//         (only the agents `plan` actually selected run at all)
//
// Every tool call here is READ-ONLY (see tools.ts) - this graph can
// investigate and recommend, never apply a fix itself. See
// ARCHITECTURE.md's AI Dev Assistant section for the full reasoning.

export type AgentName = "repo" | "git" | "log" | "test";
export type StepStatus = "running" | "done";
export type OnStep = (agent: AgentName | "orchestrator" | "diagnosis" | "suggestFix", status: StepStatus, summary?: string) => void;

export interface SuggestedFix {
  fixAvailable: boolean;
  targetFile: string;
  oldCode: string;
  newCode: string;
  explanation: string;
}

const NO_FIX: SuggestedFix = { fixAvailable: false, targetFile: "", oldCode: "", newCode: "", explanation: "" };

const State = Annotation.Root({
  question: Annotation<string>(),
  selectedAgents: Annotation<AgentName[]>(),
  findings: Annotation<Record<string, string>>({
    // Multiple agent nodes run in parallel and each writes ITS OWN key into
    // `findings` in the same superstep - without an explicit merge reducer,
    // LangGraph's default "last write wins" semantics would let one agent's
    // result silently clobber another's. This merges them all.
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  diagnosis: Annotation<string>(),
  // No `default` needed - `suggestFix` unconditionally runs after
  // `diagnosisAgent` on every invocation, so this is always populated by
  // the time `.invoke()` resolves.
  suggestedFix: Annotation<SuggestedFix>(),
});
type S = typeof State.State;

function onStepOf(config: RunnableConfig): OnStep {
  return (config.configurable?.onStep as OnStep | undefined) ?? (() => {});
}

function buildModel() {
  return new ChatGroq({ apiKey: env.GROQ_API_KEY, model: env.AI_MODEL, temperature: 0.1 });
}

const planSchema = z.object({
  agents: z
    .array(z.enum(["repo", "git", "log", "test"]))
    .min(1)
    .describe("Which specialist agents are actually relevant to answering this question."),
  reasoning: z.string().describe("One sentence on why these agents were chosen."),
});

async function planNode(state: S, config: RunnableConfig): Promise<Partial<S>> {
  const onStep = onStepOf(config);
  onStep("orchestrator", "running");
  const model = buildModel().withStructuredOutput(planSchema);
  const result = await model.invoke([
    {
      role: "system",
      content:
        "You orchestrate 4 read-only investigation agents for a support-ticket platform's codebase: " +
        "'repo' (searches TypeScript source for relevant code), 'git' (recent commit history), " +
        "'log' (recent structured application logs), 'test' (runs the real automated test suite - " +
        "slower, only include it if the question is actually about a bug/regression/broken behavior, " +
        "not a general architecture question). Pick the smallest useful set, not all four by default.",
    },
    { role: "user", content: state.question },
  ]);
  onStep("orchestrator", "done", `Selected: ${result.agents.join(", ")} - ${result.reasoning}`);
  return { selectedAgents: result.agents };
}

// Fan-out: LangGraph runs every node name returned here as a PARALLEL
// branch in the same superstep - only the agents `plan` actually chose,
// nothing else. `diagnosis` only waits on whichever of these branches were
// actually triggered this run, not on the full static set of possible ones.
function routeToAgents(state: S): AgentName[] {
  return state.selectedAgents;
}

function makeToolAgentNode(name: AgentName, run: (question: string) => Promise<string>) {
  return async function agentNode(state: S, config: RunnableConfig): Promise<Partial<S>> {
    const onStep = onStepOf(config);
    onStep(name, "running");
    const result = await run(state.question);
    const summary = result.length > 800 ? `${result.slice(0, 800)}…` : result;
    onStep(name, "done", summary);
    return { findings: { [name]: result } };
  };
}

const repoAgentNode = makeToolAgentNode("repo", (question) => searchRepo(extractSearchKeywords(question)));
const gitAgentNode = makeToolAgentNode("git", async () => getRecentGitLog(10));
const logAgentNode = makeToolAgentNode("log", (question) => Promise.resolve(searchRecentLogs(extractSearchKeywords(question))));
const testAgentNode = makeToolAgentNode("test", async () => runTestSuite());

async function diagnosisNode(state: S, config: RunnableConfig): Promise<Partial<S>> {
  const onStep = onStepOf(config);
  onStep("diagnosis", "running");
  const model = buildModel();
  const findingsText = Object.entries(state.findings)
    .map(([agent, text]) => `--- ${agent} agent findings ---\n${text}`)
    .join("\n\n");
  const result = await model.invoke([
    {
      role: "system",
      content:
        "You are a senior engineer diagnosing an issue in a support-ticket platform, given evidence gathered " +
        "by read-only investigation agents. Write: 1) a likely root-cause hypothesis (or 'insufficient evidence' " +
        "if the findings don't support one), 2) a concrete recommended next step. You are NOT applying any fix " +
        "yourself - say what a human engineer should do next. Be concise (4-6 sentences total).",
    },
    { role: "user", content: `Question: ${state.question}\n\n${findingsText}` },
  ]);
  const diagnosis = String(result.content).trim();
  onStep("diagnosis", "done", diagnosis);
  return { diagnosis };
}

const suggestFixSchema = z.object({
  fixAvailable: z
    .boolean()
    .describe("True ONLY if you can identify a safe, minimal, specific fix directly supported by the file content given. False if unsure."),
  oldCode: z
    .string()
    .describe("The EXACT original code to replace, copied VERBATIM (character-for-character) from the file content provided below."),
  newCode: z.string().describe("The replacement code."),
  explanation: z.string().describe("One or two sentences: what this changes and why it addresses the diagnosis."),
});

// Extracts the file the fix suggestion should target - from the repo
// agent's findings (lines shaped "path:line: content", already sorted by
// relevance by tools.ts's searchRepo), simply whichever file the FIRST
// (highest-scored) line belongs to.
//
// Real bug this fixes, found live (see BUILD_LOG.md): the original version
// instead picked the MOST-FREQUENTLY-APPEARING file across all findings -
// which let a file matching one common, generic keyword five separate
// times (five unrelated `function` declarations) outrank a file matching a
// specific, rare identifier exactly once, even though that one match was
// clearly the actually-relevant result. Counting occurrences threw away
// the relevance ranking searchRepo had already done.
function mostReferencedFile(repoFindings: string | undefined): string | null {
  if (!repoFindings) return null;
  const firstLine = repoFindings.split("\n")[0];
  const match = firstLine.match(/^([^:]+\.tsx?):\d+:/);
  return match ? match[1] : null;
}

async function suggestFixNode(state: S, config: RunnableConfig): Promise<Partial<S>> {
  const onStep = onStepOf(config);
  onStep("suggestFix", "running");

  const targetFile = mostReferencedFile(state.findings.repo);
  if (!targetFile) {
    onStep("suggestFix", "done", "No specific file identified by the repo search - no fix suggested.");
    return { suggestedFix: NO_FIX };
  }

  // Cap what we read/send - a fix suggestion for a 2000-line file from one
  // grep hit isn't the point; this is for a small, localized, minimal fix.
  const fileContent = await fs
    .readFile(path.join(REPO_ROOT, targetFile), "utf-8")
    .then((c) => c.split("\n").slice(0, 400).join("\n"))
    .catch(() => null);
  if (!fileContent) {
    onStep("suggestFix", "done", `Could not read ${targetFile} - no fix suggested.`);
    return { suggestedFix: NO_FIX };
  }

  const model = buildModel().withStructuredOutput(suggestFixSchema);
  const result = await model.invoke([
    {
      role: "system",
      content:
        "Given a diagnosed issue and the full content of the ONE file most likely responsible, propose a minimal, " +
        "safe fix if you're genuinely confident - otherwise set fixAvailable to false rather than guess. " +
        "`oldCode` MUST be copied character-for-character from the file content below (it will be matched as an " +
        "exact substring - if it doesn't match exactly, the fix will be rejected). Keep the change small and specific.",
    },
    { role: "user", content: `Question: ${state.question}\n\nDiagnosis: ${state.diagnosis}\n\nFile: ${targetFile}\n\n${fileContent}` },
  ]);

  // Defense in depth: never trust the model's claim that oldCode matches -
  // verify it actually is a substring of the REAL current file content
  // before ever presenting it as applicable. (applyFix.ts re-verifies this
  // AGAIN independently at apply time - this check is what keeps an
  // obviously-bad suggestion from even being shown as clickable.)
  const oldCodeReallyMatches = result.fixAvailable && fileContent.includes(result.oldCode);

  if (!oldCodeReallyMatches) {
    onStep("suggestFix", "done", "No confident, verifiable fix identified.");
    return { suggestedFix: NO_FIX };
  }

  const suggestedFix: SuggestedFix = { fixAvailable: true, targetFile, oldCode: result.oldCode, newCode: result.newCode, explanation: result.explanation };
  onStep("suggestFix", "done", `Suggested fix for ${targetFile}: ${result.explanation}`);
  return { suggestedFix };
}

const compiledGraph = new StateGraph(State)
  .addNode("plan", planNode)
  .addNode("repoAgent", repoAgentNode)
  .addNode("gitAgent", gitAgentNode)
  .addNode("logAgent", logAgentNode)
  .addNode("testAgent", testAgentNode)
  // Named "diagnosisAgent", not "diagnosis" - LangGraph doesn't allow a node
  // name to collide with a state channel name, and `diagnosis` is already
  // the State field this node writes into.
  .addNode("diagnosisAgent", diagnosisNode)
  .addNode("suggestFix", suggestFixNode)
  .addEdge(START, "plan")
  .addConditionalEdges("plan", (state: S) =>
    routeToAgents(state).map((name) => (({ repo: "repoAgent", git: "gitAgent", log: "logAgent", test: "testAgent" }) as const)[name])
  )
  .addEdge("repoAgent", "diagnosisAgent")
  .addEdge("gitAgent", "diagnosisAgent")
  .addEdge("logAgent", "diagnosisAgent")
  .addEdge("testAgent", "diagnosisAgent")
  .addEdge("diagnosisAgent", "suggestFix")
  .addEdge("suggestFix", END)
  .compile();

export async function runDevAssistantGraph(question: string, onStep: OnStep) {
  const final = await compiledGraph.invoke({ question }, { configurable: { onStep } });
  return { selectedAgents: final.selectedAgents, findings: final.findings, diagnosis: final.diagnosis, suggestedFix: final.suggestedFix };
}
