"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSummary = getSummary;
exports.getAnalytics = getAnalytics;
const dashboardRepo = __importStar(require("../repositories/dashboardRepository"));
const otel_1 = require("../observability/otel");
function toCountMap(rows) {
    return Object.fromEntries(rows.map((r) => [r._id, r.count]));
}
async function getSummary() {
    return (0, otel_1.withSpan)("dashboardService.getSummary", async () => {
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
async function getAnalytics() {
    return (0, otel_1.withSpan)("dashboardService.getAnalytics", async () => {
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
