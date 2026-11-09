import { useState } from "react";
import type { TicketPriority, TicketStatus } from "../types";
import { TICKET_PRIORITIES } from "../types";
import { StatusFilter } from "../components/StatusFilter";
import { Pagination } from "../components/Pagination";
import { TicketListView } from "../components/TicketListView";
import { useTicketList } from "../hooks/useTickets";
import { getApiErrorMessage } from "../api/client";
import * as ticketsApi from "../api/tickets";
import { useQueryClient } from "@tanstack/react-query";

export function TicketQueuePage() {
  const [status, setStatus] = useState<TicketStatus | "">("");
  const [priority, setPriority] = useState<TicketPriority | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useTicketList({
    status: status || undefined,
    priority: priority || undefined,
    search: search || undefined,
    page,
    limit: 10,
  });

  // A one-off assignment mutation not tied to a specific ticket id (unlike
  // useAssignToSelf, which is scoped per ticket-detail page) - here we
  // handle it inline since the queue shows many tickets at once.
  async function handleAssign(ticketId: string) {
    setAssigningId(ticketId);
    setError(null);
    try {
      await ticketsApi.assignTicketToSelfRequest(ticketId);
      qc.invalidateQueries({ queryKey: ["tickets"] });
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setAssigningId(null);
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-800">Ticket Queue</h1>
        <div className="flex flex-wrap gap-2">
          <input
            placeholder="Search title…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
          <select
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value as TicketPriority | "");
              setPage(1);
            }}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">All priorities</option>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <StatusFilter
            value={status}
            onChange={(s) => {
              setStatus(s);
              setPage(1);
            }}
          />
        </div>
      </div>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {data && (
        <TicketListView
          tickets={data.tickets}
          showCustomerColumn
          showAssignAction
          onAssign={handleAssign}
          assigningId={assigningId}
        />
      )}
      {data && <Pagination page={page} totalPages={data.pagination.totalPages} onChange={setPage} />}
    </div>
  );
}
