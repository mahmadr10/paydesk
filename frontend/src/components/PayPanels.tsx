import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import * as pd from "../api/paydesk";
import type { Order, PayTicket } from "../api/paydesk";
import { getApiErrorMessage } from "../api/client";
import { AgentSteps, SourceBadge } from "./AgentSteps";

const card = "mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm";
const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50";

function useRefresh(ticketId: string) {
  const qc = useQueryClient();
  return (t?: PayTicket) => {
    if (t) qc.setQueryData(["ticket", ticketId], t);
    qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
    qc.invalidateQueries({ queryKey: ["comments", ticketId] });
  };
}

export function OrderCard({ order }: { order: Order }) {
  return (
    <div className={card}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">PayPal payment · {order.orderNumber}</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{pd.human(order.status)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4">
        <p>Items: <b>{order.items.map((i) => i.name).join(", ")}</b></p>
        <p>Paid: <b>{pd.money(order.total, order.currency)}</b></p>
        <p>Refunded: <b>{pd.money(order.refundedTotal, order.currency)}</b></p>
        <p>Downloads: <b>{order.fulfillment?.accessCount ?? 0}</b></p>
      </div>
      <p className="mt-2 truncate text-[11px] text-slate-400">Capture {order.captureId ?? "-"} · {order.paypalMode === "sandbox" ? "PayPal Sandbox" : "Simulated PayPal"}</p>
    </div>
  );
}

// ── Refund agent (support tickets about an order) ───────────────────────

export function RefundAgentPanel({ ticket }: { ticket: PayTicket }) {
  const refresh = useRefresh(ticket._id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const p = ticket.refundProposal;

  async function act(name: string, fn: () => Promise<PayTicket>) {
    setBusy(name);
    setError(null);
    try {
      refresh(await fn());
      setReply(null);
    } catch (e) {
      setError(getApiErrorMessage(e));
      refresh();
    } finally {
      setBusy(null);
    }
  }

  const isRefund = p?.action === "FULL_REFUND" || p?.action === "PARTIAL_REFUND";
  return (
    <div className={`${card} border-indigo-200`}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">🤖 Refund agent</h2>
          <p className="text-xs text-slate-500">Checks the payment in PayPal, decides, checks store policy. Nothing is refunded until you approve.</p>
        </div>
        <button onClick={() => act("run", () => pd.runRefundAgent(ticket._id))} disabled={!!busy} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>
          {busy === "run" ? "Thinking…" : p ? "Run again" : "Run agent"}
        </button>
      </div>

      {!p && <p className="text-sm text-slate-400">No proposal yet. It runs automatically for new tickets about an order.</p>}
      {p && (
        <div className="grid gap-5 md:grid-cols-[1fr_1.3fr]">
          <AgentSteps steps={p.steps} />
          <div className="flex flex-col gap-3 text-sm">
            <SourceBadge source={p.source} paypal={p.paypalMode} />
            <div className="rounded-lg bg-indigo-50 p-3">
              <p className="text-xs uppercase tracking-wide text-indigo-500">Recommendation · {pd.human(p.issueType)}</p>
              <p className="text-lg font-semibold text-indigo-900">
                {p.issueType === "DUPLICATE_CHARGE" && p.action === "FULL_REFUND" ? "Refund the duplicate charge" : pd.human(p.action)}{" "}
                {p.amount > 0 && `· ${pd.money(p.amount, p.currency)}`}
              </p>
              <p className="text-xs text-indigo-700">Confidence {Math.round(p.confidence * 100)}%</p>
            </div>
            <p className="text-slate-600">{p.reasoning}</p>
            <ul className="text-xs text-slate-500">{p.policyNotes.map((n, i) => <li key={i}>🛡️ {n}</li>)}</ul>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-500">Reply to customer</p>
              {p.status === "PENDING" ? (
                <textarea rows={4} value={reply ?? p.customerReply} onChange={(e) => setReply(e.target.value)} className="w-full rounded border border-slate-300 p-2 text-sm" />
              ) : (
                <p className="rounded bg-slate-50 p-2 text-slate-700">{p.customerReply}</p>
              )}
            </div>
            {p.status === "PENDING" && (
              <div className="flex gap-2">
                <button
                  onClick={() => act("approve", () => pd.approveRefund(ticket._id, { customerReply: reply ?? undefined }))}
                  disabled={!!busy}
                  className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
                >
                  {busy === "approve" ? "Sending…" : isRefund ? `Approve & refund ${pd.money(p.amount, p.currency)} via PayPal` : "Approve & send reply"}
                </button>
                <button onClick={() => act("reject", () => pd.rejectRefund(ticket._id))} disabled={!!busy} className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}>
                  Reject
                </button>
              </div>
            )}
            {p.status === "EXECUTED" && (
              <p className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">
                ✅ Refunded {pd.money(p.executedAmount ?? 0, p.currency)} through PayPal · refund id <code>{p.paypalRefundId}</code>
                {p.decidedBy && ` · approved by ${p.decidedBy.name}`}
              </p>
            )}
            {p.status === "SENT" && <p className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">✅ Reply sent, no money moved.</p>}
            {p.status === "REJECTED" && <p className="rounded-lg bg-slate-100 p-2 text-xs text-slate-600">Rejected by a person.</p>}
            {p.status === "FAILED" && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">PayPal refused: {p.error}</p>}
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}

// ── Dispute agent (cases opened by a PayPal dispute) ────────────────────

export function DisputePanel({ ticket, mode }: { ticket: PayTicket; mode?: "sandbox" | "simulated" }) {
  const refresh = useRefresh(ticket._id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const d = ticket.dispute!;
  const p = ticket.disputeProposal;

  async function act(name: string, fn: () => Promise<PayTicket>) {
    setBusy(name);
    setError(null);
    try {
      refresh(await fn());
      setNote(null);
    } catch (e) {
      setError(getApiErrorMessage(e));
      refresh();
    } finally {
      setBusy(null);
    }
  }

  const due = d.sellerResponseDue ? new Date(d.sellerResponseDue) : null;
  const label: Record<string, string> = { ACCEPT_CLAIM: "Accept claim & refund", MAKE_OFFER: "Offer partial refund", CONTEST: "Contest with evidence", NONE: "Nothing to send" };
  return (
    <>
      <div className={`${card} border-rose-200`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-rose-500">PayPal dispute · {pd.human(d.stage)}</p>
            <h2 className="text-lg font-semibold text-slate-800">{pd.human(d.reason)} · {pd.money(d.amount, d.currency)}</h2>
            <p className="text-xs text-slate-400">{d.disputeId} · buyer {d.buyerName ?? "unknown"}</p>
          </div>
          <div className="text-right">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${d.status === "RESOLVED" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{pd.human(d.status)}</span>
            {due && d.status !== "RESOLVED" && <p className="mt-1 text-xs text-rose-600">Respond {formatDistanceToNow(due, { addSuffix: true })}</p>}
          </div>
        </div>
        {d.messages.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {d.messages.map((m, i) => (
              <p key={i} className={`rounded-lg p-2 text-xs ${m.postedBy === "BUYER" ? "bg-slate-50 text-slate-700" : "bg-indigo-50 text-indigo-800"}`}>
                <b>{m.postedBy === "BUYER" ? "Buyer" : "You"}:</b> {m.content}
              </p>
            ))}
          </div>
        )}
        {d.outcome && <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">Outcome: {pd.human(d.outcome.code)}{d.outcome.amountRefunded ? ` · ${pd.money(d.outcome.amountRefunded, d.currency)} refunded` : ""}</p>}
        {d.status === "UNDER_REVIEW" && (d.actions.includes("adjudicate") || mode === "simulated") && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-slate-300 p-2 text-xs text-slate-500">
            Sandbox: let PayPal decide →
            <button onClick={() => act("seller", () => pd.adjudicateDispute(ticket._id, "SELLER_FAVOR"))} disabled={!!busy} className={`${btn} bg-emerald-100 text-emerald-800`}>Seller wins</button>
            <button onClick={() => act("buyer", () => pd.adjudicateDispute(ticket._id, "BUYER_FAVOR"))} disabled={!!busy} className={`${btn} bg-rose-100 text-rose-800`}>Buyer wins</button>
          </div>
        )}
      </div>

      <div className={`${card} border-indigo-200`}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">🤖 Dispute agent</h2>
            <p className="text-xs text-slate-500">Reads the dispute from PayPal, gathers evidence from your records, and prepares the best response. You approve before anything is sent.</p>
          </div>
          <button onClick={() => act("run", () => pd.runDisputeAgent(ticket._id))} disabled={!!busy || d.status === "RESOLVED"} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>
            {busy === "run" ? "Investigating…" : p ? "Run again" : "Run agent"}
          </button>
        </div>
        {!p && <p className="text-sm text-slate-400">The agent starts automatically when a dispute arrives. Refresh in a few seconds.</p>}
        {p && (
          <div className="grid gap-5 md:grid-cols-[1fr_1.3fr]">
            <AgentSteps steps={p.steps} />
            <div className="flex flex-col gap-3 text-sm">
              <SourceBadge source={p.source} paypal={mode} />
              <div className="rounded-lg bg-indigo-50 p-3">
                <p className="text-xs uppercase tracking-wide text-indigo-500">Recommended response</p>
                <p className="text-lg font-semibold text-indigo-900">{label[p.action]} {p.amount > 0 && `· ${pd.money(p.amount, p.currency)}`}</p>
                <div className="mt-1 flex items-center gap-2 text-xs text-indigo-700">
                  Chance to win if contested
                  <div className="h-1.5 w-24 rounded bg-indigo-200"><div className="h-1.5 rounded bg-indigo-600" style={{ width: `${Math.round(p.winChance * 100)}%` }} /></div>
                  {Math.round(p.winChance * 100)}%
                </div>
              </div>
              <p className="text-slate-600">{p.reasoning}</p>
              <ul className="text-xs text-slate-500">{p.policyNotes.map((n, i) => <li key={i}>🛡️ {n}</li>)}</ul>
              {p.action !== "NONE" && (
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-500">Note to PayPal / buyer</p>
                  {p.status === "PENDING" ? (
                    <textarea rows={4} value={note ?? p.responseNote} onChange={(e) => setNote(e.target.value)} className="w-full rounded border border-slate-300 p-2 text-sm" />
                  ) : (
                    <p className="rounded bg-slate-50 p-2 text-slate-700">{p.responseNote}</p>
                  )}
                </div>
              )}
              {p.evidenceText && (
                <div>
                  <button onClick={() => setShowEvidence(!showEvidence)} className="text-xs text-indigo-600 hover:underline">
                    {showEvidence ? "Hide" : "Show"} evidence file (built from your records, not by AI)
                  </button>
                  {showEvidence && <pre className="mt-1 max-h-60 overflow-auto rounded bg-slate-900 p-3 text-[11px] text-slate-100">{p.evidenceText}</pre>}
                </div>
              )}
              {p.status === "PENDING" && p.action !== "NONE" && (
                <div className="flex gap-2">
                  <button onClick={() => act("approve", () => pd.approveDispute(ticket._id, { responseNote: note ?? undefined }))} disabled={!!busy} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                    {busy === "approve" ? "Sending to PayPal…" : `Approve: ${label[p.action]}`}
                  </button>
                  <button onClick={() => act("reject", () => pd.rejectDispute(ticket._id))} disabled={!!busy} className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}>Reject</button>
                </div>
              )}
              {p.status === "EXECUTED" && <p className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">✅ Sent to PayPal. Dispute is now {pd.human(d.status)}.</p>}
              {p.status === "REJECTED" && <p className="rounded-lg bg-slate-100 p-2 text-xs text-slate-600">Rejected by a person.</p>}
              {p.status === "FAILED" && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">PayPal refused: {p.error}</p>}
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    </>
  );
}
