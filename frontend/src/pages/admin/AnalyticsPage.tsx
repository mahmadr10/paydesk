import { BarChartCard } from "../../components/BarChartCard";
import { useDashboardAnalytics } from "../../hooks/useDashboard";
import { getApiErrorMessage } from "../../api/client";

function toChartData(record: Record<string, number> | undefined) {
  return Object.entries(record ?? {}).map(([name, count]) => ({ name: name.replace(/_/g, " "), count }));
}

// A dedicated, larger view of the same analytics the Dashboard summarizes -
// the Dashboard is "at a glance," this page is "drill in."
export function AnalyticsPage() {
  const { data, isLoading, error } = useDashboardAnalytics();

  if (isLoading) return <p className="mt-8 text-center text-sm text-slate-500">Loading…</p>;
  if (error) return <p className="mt-8 text-center text-sm text-red-600">{getApiErrorMessage(error)}</p>;
  if (!data) return null;

  return (
    <div className="mx-auto mt-8 max-w-6xl">
      <h1 className="mb-4 text-xl font-semibold text-slate-800">Analytics</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarChartCard title="Tickets by Status" data={toChartData(data.byStatus)} color="#2563eb" />
        <BarChartCard title="Tickets by Priority" data={toChartData(data.byPriority)} color="#f97316" />
        <BarChartCard title="Tickets by Category" data={toChartData(data.byCategory)} color="#059669" />
        <BarChartCard
          title="Tickets by Agent"
          data={data.byAgent.map((a) => ({ name: a.name, count: a.count }))}
          color="#7c3aed"
        />
      </div>
    </div>
  );
}
