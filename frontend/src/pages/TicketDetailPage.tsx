import { useState } from "react";
import { useParams } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { PriorityBadge } from "../components/PriorityBadge";
import { SlaCountdown } from "../components/SlaCountdown";
import { useAuth } from "../context/AuthContext";
import {
  useAddComment,
  useAnalyzeTicketWithAi,
  useAssignToSelf,
  useComments,
  useTicket,
  useUpdateTicketPriority,
  useUpdateTicketStatus,
  useUploadAttachment,
} from "../hooks/useTickets";
import { downloadAttachment } from "../api/tickets";
import { getApiErrorMessage } from "../api/client";
import { TICKET_PRIORITIES, type TicketPriority, type User } from "../types";
import { useQuery } from "@tanstack/react-query";
import { getPaymentsConfig, type PayTicket } from "../api/paydesk";
import { DisputePanel, OrderCard, RefundAgentPanel } from "../components/PayPanels";

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data: ticket, isLoading, error } = useTicket(id);
  const { data: comments } = useComments(id);

  const updateStatus = useUpdateTicketStatus(id ?? "");
  const updatePriority = useUpdateTicketPriority(id ?? "");
  const assignToSelf = useAssignToSelf(id ?? "");
  const uploadAttachment = useUploadAttachment(id ?? "");
  const addComment = useAddComment(id ?? "");
  const analyzeWithAi = useAnalyzeTicketWithAi(id ?? "");

  const [commentText, setCommentText] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data: config } = useQuery({ queryKey: ["payments-config"], queryFn: getPaymentsConfig, staleTime: Infinity });

  if (isLoading) return <p className="mt-8 text-center text-sm text-slate-500">Loading…</p>;
  if (error || !ticket) return <p className="mt-8 text-center text-sm text-red-600">{getApiErrorMessage(error)}</p>;

  const payTicket = ticket as PayTicket;
  const customer = ticket.customer as User;
  const agent = ticket.assignedAgent as User | null;
  const isStaff = user?.role === "AGENT" || user?.role === "ADMIN";
  const isResolvedOrClosed = ticket.status === "RESOLVED" || ticket.status === "CLOSED";

  async function runAction(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(getApiErrorMessage(err));
    }
  }

  async function handleCommentSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim()) return;
    await runAction(async () => {
      await addComment.mutateAsync({ text: commentText.trim(), isInternal });
      setCommentText("");
      setIsInternal(false);
    });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await runAction(() => uploadAttachment.mutateAsync(file));
    e.target.value = "";
  }

  return (
    <div className="mx-auto mt-8 max-w-4xl">
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-1 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-800">{ticket.title}</h1>
          <StatusBadge status={ticket.status} />
        </div>
        <p className="mb-3 text-xs text-slate-400">{ticket.ticketNumber}</p>
        <p className="mb-4 text-sm text-slate-600">{ticket.description}</p>

        <div className="grid grid-cols-2 gap-3 text-xs text-slate-500 sm:grid-cols-3">
          <p>Category: {ticket.category}</p>
          <p className="flex items-center gap-1">
            Priority: <PriorityBadge priority={ticket.priority} />
          </p>
          <p>Customer: {customer?.name ?? "-"}</p>
          <p>Agent: {agent?.name ?? "Unassigned"}</p>
          {ticket.tags.length > 0 && <p>Tags: {ticket.tags.join(", ")}</p>}
        </div>

        {!isResolvedOrClosed && (
          <div className="mt-4 grid grid-cols-2 gap-3 rounded bg-slate-50 p-3 text-xs">
            <div>
              <p className="text-slate-400">Response SLA</p>
              <SlaCountdown deadline={ticket.responseDeadline} breached={ticket.sla.responseBreached} />
            </div>
            <div>
              <p className="text-slate-400">Resolution SLA</p>
              <SlaCountdown deadline={ticket.resolutionDeadline} breached={ticket.sla.resolutionBreached} />
            </div>
          </div>
        )}

        {/* Every button here reflects what the SERVER says is legal right
            now (ticket.allowedNextStatuses) - the frontend doesn't
            re-implement the state machine's role rules, it just renders
            whatever the authoritative answer was on the last fetch. */}
        {isStaff && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {ticket.status === "TRIAGED" && !agent && (
              <button
                onClick={() => runAction(() => assignToSelf.mutateAsync())}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                Assign to me
              </button>
            )}
            {ticket.allowedNextStatuses
              // OPEN/CLOSED are customer-initiated actions, rendered separately below.
              // ASSIGNED must always go through "Assign to me" (which also sets
              // assignedAgent) - a generic status-only button here would let an
              // agent set status to ASSIGNED with no agent actually attached.
              ?.filter((s) => s !== "OPEN" && s !== "CLOSED" && s !== "ASSIGNED")
              .map((next) => (
                <button
                  key={next}
                  onClick={() => runAction(() => updateStatus.mutateAsync(next))}
                  className="rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900"
                >
                  Move to {next.replace(/_/g, " ")}
                </button>
              ))}
            <label className="ml-auto text-xs text-slate-500">
              Priority:
              <select
                value={ticket.priority}
                onChange={(e) => runAction(() => updatePriority.mutateAsync(e.target.value as TicketPriority))}
                className="ml-1 rounded border border-slate-300 px-1.5 py-1 text-xs"
              >
                {TICKET_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* Customer-initiated transitions: closing a resolved ticket, or
            reopening a closed one. */}
        {user?.role === "CUSTOMER" && ticket.allowedNextStatuses?.includes("CLOSED") && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <button
              onClick={() => runAction(() => updateStatus.mutateAsync("CLOSED"))}
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
            >
              Close ticket
            </button>
          </div>
        )}
        {user?.role === "CUSTOMER" && ticket.allowedNextStatuses?.includes("OPEN") && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <button
              onClick={() => runAction(() => updateStatus.mutateAsync("OPEN"))}
              className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              Reopen ticket
            </button>
          </div>
        )}

        {actionError && <p className="mt-3 text-sm text-red-600">{actionError}</p>}
      </div>

      {payTicket.dispute && isStaff && <DisputePanel ticket={payTicket} mode={config?.mode} />}
      {payTicket.order && typeof payTicket.order === "object" && <OrderCard order={payTicket.order} />}
      {isStaff && payTicket.order && !payTicket.dispute && <RefundAgentPanel ticket={payTicket} />}

      {/* AI Assist - staff-only triage tooling (suggested priority/category,
          a draft reply). Not shown to customers: this is internal-facing
          assistance, not a claim about what actually happened to the
          ticket. See backend/src/services/aiService.ts for the
          replaceable-provider design and its mock/no-API-key fallback. */}
      {isStaff && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">AI Assist</h2>
            <button
              onClick={() => analyzeWithAi.mutate()}
              disabled={analyzeWithAi.isPending}
              className="rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {analyzeWithAi.isPending ? "Analyzing…" : analyzeWithAi.data ? "Re-analyze" : "Analyze with AI"}
            </button>
          </div>

          {analyzeWithAi.isError && (
            <p className="text-sm text-red-600">{getApiErrorMessage(analyzeWithAi.error)}</p>
          )}

          {analyzeWithAi.data && (
            <div className="flex flex-col gap-3 text-sm">
              <span
                className={`w-fit rounded px-2 py-0.5 text-xs font-medium ${
                  analyzeWithAi.data.source === "groq" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"
                }`}
                title={
                  analyzeWithAi.data.source === "groq"
                    ? "Generated by a live LLM call (Groq)"
                    : "No GROQ_API_KEY configured - showing the deterministic mock fallback"
                }
              >
                {analyzeWithAi.data.source === "groq" ? "Live AI (Groq)" : "Mock fallback (no API key configured)"}
              </span>

              <div>
                <p className="text-xs font-medium text-slate-500">Summary</p>
                <p className="text-slate-700">{analyzeWithAi.data.summary}</p>
              </div>

              <div className="flex items-center gap-4">
                <p className="text-xs text-slate-500">
                  Suggested category: <span className="font-medium text-slate-700">{analyzeWithAi.data.suggestedCategory}</span>
                </p>
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  Suggested priority: <PriorityBadge priority={analyzeWithAi.data.suggestedPriority} />
                  {analyzeWithAi.data.suggestedPriority !== ticket.priority && (
                    <button
                      onClick={() => runAction(() => updatePriority.mutateAsync(analyzeWithAi.data!.suggestedPriority))}
                      className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                    >
                      Apply
                    </button>
                  )}
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-slate-500">Suggested response</p>
                <p className="rounded bg-slate-50 p-2 text-slate-700">{analyzeWithAi.data.suggestedResponse}</p>
                <button
                  onClick={() => setCommentText(analyzeWithAi.data!.suggestedResponse)}
                  className="mt-1 text-xs text-blue-600 hover:underline"
                >
                  Use as reply
                </button>
              </div>
            </div>
          )}

          {!analyzeWithAi.data && !analyzeWithAi.isPending && (
            <p className="text-sm text-slate-400">
              Generates a summary, a suggested category/priority, and a draft first response.
            </p>
          )}
        </div>
      )}

      {/* Attachments */}
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Attachments</h2>
        {ticket.attachments.length === 0 && <p className="text-sm text-slate-400">No files attached.</p>}
        <ul className="flex flex-col gap-1">
          {ticket.attachments.map((a) => (
            <li key={a._id} className="flex items-center justify-between text-sm">
              <span className="text-slate-700">
                {a.originalName} <span className="text-xs text-slate-400">({Math.round(a.size / 1024)} KB)</span>
              </span>
              <button
                onClick={() => downloadAttachment(ticket._id, a._id, a.originalName)}
                className="text-xs text-blue-600 hover:underline"
              >
                Download
              </button>
            </li>
          ))}
        </ul>
        <label className="mt-3 inline-block cursor-pointer rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200">
          {uploadAttachment.isPending ? "Uploading…" : "Upload file"}
          <input type="file" onChange={handleFileChange} className="hidden" disabled={uploadAttachment.isPending} />
        </label>
      </div>

      {/* Comments */}
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-slate-800">Comments</h2>
        <div className="flex flex-col gap-3">
          {(!comments || comments.length === 0) && <p className="text-sm text-slate-400">No comments yet.</p>}
          {comments?.map((c) => {
            const author = c.author as User;
            return (
              <div
                key={c._id}
                className={`rounded border p-3 text-sm ${c.isInternal ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}
              >
                <p className="mb-1 text-xs font-medium text-slate-500">
                  {author?.name ?? "Unknown"} · {c.authorRole}
                  {c.isInternal && <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-amber-800">Internal note</span>}
                </p>
                <p className="text-slate-700">{c.text}</p>
              </div>
            );
          })}
        </div>
        <form onSubmit={handleCommentSubmit} className="mt-4 flex flex-col gap-2">
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment…"
            className="rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
          <div className="flex items-center justify-between">
            {isStaff && (
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
                Internal note (staff only - customer won't see this)
              </label>
            )}
            <button
              type="submit"
              disabled={addComment.isPending || !commentText.trim()}
              className="ml-auto rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Post
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
