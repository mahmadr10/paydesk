import { useState } from "react";
import { useDevAssistant, useApplyDevAssistantFix } from "../../hooks/useDevAssistant";
import type { DevAssistantAgent } from "../../types";

const AGENT_LABELS: Record<DevAssistantAgent, string> = {
  orchestrator: "Orchestrator",
  repo: "Repo Agent",
  git: "Git Agent",
  log: "Log Agent",
  test: "Test Agent",
  diagnosis: "Diagnosis",
  suggestFix: "Suggested Fix",
};

const SAMPLE_QUESTIONS = [
  "Why are ticket updates sometimes duplicated on the frontend?",
  "Where is authentication implemented in this codebase?",
  "Which endpoints modify a ticket's status?",
  "Is the test suite currently passing?",
];

function AgentBox({ agent, step }: { agent: DevAssistantAgent; step?: { status: "running" | "done"; summary?: string } }) {
  const [expanded, setExpanded] = useState(false);
  const state = step?.status ?? "idle";

  const boxClass =
    state === "running"
      ? "border-violet-400 bg-violet-50 animate-pulse"
      : state === "done"
        ? "border-emerald-400 bg-emerald-50 cursor-pointer"
        : "border-slate-200 bg-slate-50 opacity-40";

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`w-28 rounded-lg border-2 px-2 py-3 text-center text-xs font-medium transition-colors ${boxClass}`}
        onClick={() => state === "done" && setExpanded((v) => !v)}
        title={state === "done" ? "Click to see this agent's findings" : undefined}
      >
        {state === "running" && <span className="mb-1 block">⟳</span>}
        {state === "done" && <span className="mb-1 block text-emerald-600">✓</span>}
        <span className={state === "idle" ? "text-slate-400" : "text-slate-700"}>{AGENT_LABELS[agent]}</span>
      </div>
      {expanded && step?.summary && (
        <div className="w-56 whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-left text-xs text-slate-600">
          {step.summary}
        </div>
      )}
    </div>
  );
}

// Old code struck through in red, new code in green - a minimal diff view,
// not a full syntax-highlighted editor, because this only ever needs to
// show one small, localized change (applyFix.ts itself refuses anything
// that isn't).
function DiffView({ oldCode, newCode }: { oldCode: string; newCode: string }) {
  return (
    <div className="overflow-x-auto rounded border border-slate-200 font-mono text-xs">
      <pre className="whitespace-pre-wrap bg-red-50 p-2 text-red-800 line-through decoration-red-400">{oldCode}</pre>
      <pre className="whitespace-pre-wrap bg-emerald-50 p-2 text-emerald-800">{newCode}</pre>
    </div>
  );
}

export function DevAssistantPage() {
  const [question, setQuestion] = useState("");
  const { ask, steps, result, error, isPending } = useDevAssistant();
  const applyFix = useApplyDevAssistantFix();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || isPending) return;
    applyFix.reset();
    await ask(question.trim());
  }

  return (
    <div className="mx-auto mt-8 max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-800">AI Dev Assistant</h1>
      <p className="mt-1 text-sm text-slate-500">
        A multi-agent investigator for THIS codebase - an orchestrator picks which read-only agents
        (repo search, git history, recent logs, the real test suite) are relevant to your question,
        runs them, and synthesizes a diagnosis. It can propose a specific code fix, but{" "}
        <strong>nothing is ever applied without your explicit click</strong> - and an applied fix
        immediately re-runs the real test suite, auto-reverting itself if anything breaks.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Why are ticket updates sometimes duplicated?"
          rows={2}
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          {SAMPLE_QUESTIONS.map((q) => (
            <button
              type="button"
              key={q}
              onClick={() => setQuestion(q)}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50"
            >
              {q}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={isPending || !question.trim()}
          className="ml-auto rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {isPending ? "Investigating…" : "Ask"}
        </button>
      </form>

      {(isPending || Object.keys(steps).length > 0) && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Agent pipeline</h2>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <AgentBox agent="orchestrator" step={steps.orchestrator} />
            <span className="text-slate-300">→</span>
            <div className="flex flex-wrap justify-center gap-3">
              {(["repo", "git", "log", "test"] as const).map((a) => (
                <AgentBox key={a} agent={a} step={steps[a]} />
              ))}
            </div>
            <span className="text-slate-300">→</span>
            <AgentBox agent="diagnosis" step={steps.diagnosis} />
            <span className="text-slate-300">→</span>
            <AgentBox agent="suggestFix" step={steps.suggestFix} />
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Diagnosis</h2>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                result.source === "groq" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {result.source === "groq" ? "Live AI (Groq)" : "Mock fallback (no API key configured)"}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{result.diagnosis}</p>
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
            Investigation only - no code was changed by the analysis itself. Applying the suggested
            fix below (if any) is a separate, explicit step.
          </p>
        </div>
      )}

      {result?.suggestedFix.fixAvailable && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-white p-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Suggested Fix</h2>
          <p className="mb-1 text-xs text-slate-500">
            Target file: <code className="rounded bg-slate-100 px-1 py-0.5">{result.suggestedFix.targetFile}</code>
          </p>
          <p className="mb-3 text-sm text-slate-700">{result.suggestedFix.explanation}</p>
          <DiffView oldCode={result.suggestedFix.oldCode} newCode={result.suggestedFix.newCode} />

          {!applyFix.data && (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() =>
                  applyFix.mutate({
                    targetFile: result.suggestedFix.targetFile,
                    oldCode: result.suggestedFix.oldCode,
                    newCode: result.suggestedFix.newCode,
                  })
                }
                disabled={applyFix.isPending}
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {applyFix.isPending ? "Applying + running tests…" : "Apply Fix"}
              </button>
              <span className="text-xs text-slate-400">Runs the real test suite immediately after applying; auto-reverts on failure.</span>
            </div>
          )}

          {applyFix.isError && (
            <p className="mt-3 text-xs text-red-600">
              {(applyFix.error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
                "Failed to apply the fix."}
            </p>
          )}

          {applyFix.data && (
            <div className={`mt-3 rounded p-3 text-xs ${applyFix.data.applied ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
              <p className="font-medium">
                {applyFix.data.applied
                  ? "✓ Applied - tests passed."
                  : "✗ Reverted automatically - the change broke the test suite. No file was left modified."}
              </p>
              <pre className="mt-1 whitespace-pre-wrap">{applyFix.data.testSummary}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
