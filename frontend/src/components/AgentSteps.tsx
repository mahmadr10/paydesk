import type { AgentStep } from "../api/paydesk";

// The agent's work, step by step: what it checked and what it decided.
export function AgentSteps({ steps }: { steps: AgentStep[] }) {
  return (
    <ol className="relative ml-2 border-l border-slate-200">
      {steps.map((s, i) => (
        <li key={i} className="mb-3 ml-4 last:mb-0">
          <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-white bg-indigo-500" />
          <p className="text-xs font-semibold text-slate-700">{s.name}</p>
          <p className="text-xs text-slate-500">{s.detail}</p>
        </li>
      ))}
    </ol>
  );
}

export function SourceBadge({ source, paypal }: { source: "groq" | "rules"; paypal?: "sandbox" | "simulated" }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${source === "groq" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"}`}>
        {source === "groq" ? "Live AI (Groq)" : "Rules fallback (AI unavailable)"}
      </span>
      {paypal && (
        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${paypal === "sandbox" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>
          {paypal === "sandbox" ? "PayPal Sandbox (live API)" : "Simulated PayPal"}
        </span>
      )}
    </div>
  );
}
