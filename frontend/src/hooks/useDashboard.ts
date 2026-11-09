import { useQuery } from "@tanstack/react-query";
import { getDashboardSummaryRequest, getDashboardAnalyticsRequest } from "../api/dashboard";

export function useDashboardSummary() {
  return useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: getDashboardSummaryRequest,
    refetchInterval: 30_000, // SLA countdowns move even without anyone taking an action - refresh periodically
  });
}

export function useDashboardAnalytics() {
  return useQuery({ queryKey: ["dashboard", "analytics"], queryFn: getDashboardAnalyticsRequest });
}
