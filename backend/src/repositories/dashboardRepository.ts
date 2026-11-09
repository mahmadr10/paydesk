import { Ticket } from "../models/Ticket";

// All of these use MongoDB's aggregation pipeline - the database counts and
// groups the data itself and sends back only the small summarized result.
// The alternative (fetch every ticket to the server and count in
// JavaScript) would work fine at 50 tickets and fall over at 50,000; doing
// it in the aggregation pipeline is what keeps this correct at any scale.
export async function getStatusCounts() {
  return Ticket.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
}

export async function getPriorityCounts() {
  return Ticket.aggregate([{ $group: { _id: "$priority", count: { $sum: 1 } } }]);
}

export async function getCategoryCounts() {
  return Ticket.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }]);
}

export async function getAgentCounts() {
  return Ticket.aggregate([
    { $match: { assignedAgent: { $ne: null } } },
    { $group: { _id: "$assignedAgent", count: { $sum: 1 } } },
    { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "agent" } },
    { $unwind: "$agent" },
    { $project: { count: 1, name: "$agent.name", email: "$agent.email" } },
  ]);
}

export async function getSlaBreachCount() {
  const now = new Date();
  return Ticket.countDocuments({
    status: { $nin: ["RESOLVED", "CLOSED"] },
    resolutionDeadline: { $lt: now },
  });
}

// Average resolution time in minutes, computed entirely inside MongoDB via
// $dateDiff - only resolved tickets with a resolvedAt timestamp count.
export async function getAverageResolutionMinutes() {
  const result = await Ticket.aggregate([
    { $match: { resolvedAt: { $ne: null } } },
    {
      $project: {
        minutes: { $dateDiff: { startDate: "$createdAt", endDate: "$resolvedAt", unit: "minute" } },
      },
    },
    { $group: { _id: null, avgMinutes: { $avg: "$minutes" } } },
  ]);
  return result[0]?.avgMinutes ?? 0;
}

export async function getTotalAndOpenCounts() {
  const [total, open, inProgress, resolved, critical] = await Promise.all([
    Ticket.countDocuments({}),
    Ticket.countDocuments({ status: "OPEN" }),
    Ticket.countDocuments({ status: { $in: ["IN_PROGRESS", "WAITING_FOR_CUSTOMER"] } }),
    Ticket.countDocuments({ status: "RESOLVED" }),
    Ticket.countDocuments({ priority: "CRITICAL", status: { $nin: ["RESOLVED", "CLOSED"] } }),
  ]);
  return { total, open, inProgress, resolved, critical };
}
