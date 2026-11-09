import { useState } from "react";
import { useAuditLogs } from "../../hooks/useAuditLogs";
import { Pagination } from "../../components/Pagination";
import { getApiErrorMessage } from "../../api/client";
import type { User } from "../../types";

function ValueCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-slate-300">-</span>;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return <span className="font-mono text-xs">{text.length > 40 ? text.slice(0, 40) + "…" : text}</span>;
}

export function AuditLogsPage() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useAuditLogs({ action: action || undefined, page, limit: 25 });

  return (
    <div className="mx-auto mt-8 max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Audit Logs</h1>
        <input
          placeholder="Filter by action (e.g. STATUS_CHANGED)"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          className="w-64 rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-600">{getApiErrorMessage(error)}</p>}
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {data && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Actor</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Entity</th>
                <th className="px-4 py-2 font-medium">Old</th>
                <th className="px-4 py-2 font-medium">New</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.map((log) => {
                const actor = log.actor as User | null;
                return (
                  <tr key={log._id} className="border-b border-slate-50 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-slate-700">{actor?.name ?? "system"}</td>
                    <td className="px-4 py-2">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{log.action}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {log.entity} <span className="text-slate-300">{log.entityId.slice(-6)}</span>
                    </td>
                    <td className="px-4 py-2">
                      <ValueCell value={log.oldValue} />
                    </td>
                    <td className="px-4 py-2">
                      <ValueCell value={log.newValue} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pagination page={page} totalPages={data.pagination.totalPages} onChange={setPage} />}
    </div>
  );
}
