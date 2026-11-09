import { Link } from "react-router-dom";
import type { Ticket, User } from "../types";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";
import { SlaCountdown } from "./SlaCountdown";

// One shared table used by "My Tickets" (customer), "Ticket Queue"
// (agent), and "All Tickets" (admin) - the three views differ only in
// which columns/actions they need, controlled by props, not three
// near-duplicate components.
export function TicketListView({
  tickets,
  showCustomerColumn = false,
  showAssignAction = false,
  onAssign,
  assigningId,
}: {
  tickets: Ticket[];
  showCustomerColumn?: boolean;
  showAssignAction?: boolean;
  onAssign?: (ticketId: string) => void;
  assigningId?: string | null;
}) {
  if (tickets.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">No tickets found.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-4 py-2 font-medium">Ticket</th>
            {showCustomerColumn && <th className="px-4 py-2 font-medium">Customer</th>}
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Priority</th>
            <th className="px-4 py-2 font-medium">Resolution SLA</th>
            <th className="px-4 py-2 font-medium">Agent</th>
            {showAssignAction && <th className="px-4 py-2 font-medium" />}
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => {
            const customer = t.customer as User;
            const agent = t.assignedAgent as User | null;
            const canAssign = showAssignAction && t.status === "TRIAGED";
            return (
              <tr key={t._id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link to={`/tickets/${t._id}`} className="font-medium text-slate-800 hover:underline">
                    {t.title}
                  </Link>
                  <p className="text-xs text-slate-400">
                    {t.ticketNumber} · {t.category}
                  </p>
                </td>
                {showCustomerColumn && <td className="px-4 py-3 text-slate-600">{customer?.name ?? "-"}</td>}
                <td className="px-4 py-3">
                  <StatusBadge status={t.status} />
                </td>
                <td className="px-4 py-3">
                  <PriorityBadge priority={t.priority} />
                </td>
                <td className="px-4 py-3">
                  {t.status === "RESOLVED" || t.status === "CLOSED" ? (
                    <span className="text-slate-400">-</span>
                  ) : (
                    <SlaCountdown deadline={t.resolutionDeadline} breached={t.sla.resolutionBreached} />
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{agent?.name ?? "Unassigned"}</td>
                {showAssignAction && (
                  <td className="px-4 py-3">
                    {canAssign && (
                      <button
                        onClick={() => onAssign?.(t._id)}
                        disabled={assigningId === t._id}
                        className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {assigningId === t._id ? "Assigning…" : "Assign to me"}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
