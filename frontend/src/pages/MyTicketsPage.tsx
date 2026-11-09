import { useState } from "react";
import type { TicketStatus } from "../types";
import { StatusFilter } from "../components/StatusFilter";
import { Pagination } from "../components/Pagination";
import { TicketListView } from "../components/TicketListView";
import { useTicketList } from "../hooks/useTickets";
import { getApiErrorMessage } from "../api/client";

export function MyTicketsPage() {
  const [status, setStatus] = useState<TicketStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // TanStack Query's cache key includes these params, so changing the
  // filter automatically fetches (and caches) that specific slice - no
  // manual useEffect/fetch/setState wiring, and results from a filter you
  // switch back to come back instantly from cache instead of reloading.
  const { data, isLoading, error } = useTicketList({
    status: status || undefined,
    search: search || undefined,
    page,
    limit: 10,
  });

  return (
    <div className="mx-auto mt-8 max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-800">My Tickets</h1>
        <div className="flex gap-2">
          <input
            placeholder="Search title…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
          <StatusFilter
            value={status}
            onChange={(s) => {
              setStatus(s);
              setPage(1);
            }}
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{getApiErrorMessage(error)}</p>}
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {data && <TicketListView tickets={data.tickets} />}
      {data && <Pagination page={page} totalPages={data.pagination.totalPages} onChange={setPage} />}
    </div>
  );
}
