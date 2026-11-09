import * as dashboardRepo from "../repositories/dashboardRepository";
import { withSpan } from "../observability/otel";

function toCountMap(rows: { _id: string; count: number }[]) {
  return Object.fromEntries(rows.map((r) => [r._id, r.count]));
}

export async function getSummary() {
  return withSpan("dashboardService.getSummary", async () => {
    const [counts, slaBreaches, avgResolutionMinutes] = await Promise.all([
      dashboardRepo.getTotalAndOpenCounts(),
      dashboardRepo.getSlaBreachCount(),
      dashboardRepo.getAverageResolutionMinutes(),
    ]);
    return { ...counts, slaBreaches, avgResolutionMinutes: Math.round(avgResolutionMinutes) };
  });
}

// Named directly in the spec as the example of a route to investigate for
// latency ("Investigate why /api/v1/dashboard/analytics has high latency.
// Use logs and traces to identify the slow operation.") - it fans out into
// FOUR separate aggregation queries, which is exactly the kind of thing a
// trace waterfall makes obvious at a glance (four sibling MongoDB spans
// under this one, each individually timed) in a way a single "200 OK in
// 340ms" log line never could.
export async function getAnalytics() {
  return withSpan("dashboardService.getAnalytics", async () => {
    const [byStatus, byPriority, byCategory, byAgent] = await Promise.all([
      dashboardRepo.getStatusCounts(),
      dashboardRepo.getPriorityCounts(),
      dashboardRepo.getCategoryCounts(),
      dashboardRepo.getAgentCounts(),
    ]);
    return {
      byStatus: toCountMap(byStatus),
      byPriority: toCountMap(byPriority),
      byCategory: toCountMap(byCategory),
      byAgent: byAgent.map((a) => ({ agentId: a._id, name: a.name, email: a.email, count: a.count })),
    };
  });
}
