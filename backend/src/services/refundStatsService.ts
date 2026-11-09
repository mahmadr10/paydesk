import { Order } from "../models/Order";
import { Ticket } from "../models/Ticket";

// Numbers for the admin "Refund Agent" panel: how much money went back,
// what the agent proposed, and how often humans agreed with it.
export async function getRefundStats() {
  const [money] = await Order.aggregate<{ revenue: number; refunded: number; paidOrders: number }>([
    { $match: { status: { $ne: "CREATED" } } },
    { $group: { _id: null, revenue: { $sum: "$total" }, refunded: { $sum: "$refundedTotal" }, paidOrders: { $sum: 1 } } },
  ]);

  const proposals = await Ticket.aggregate<{ _id: { status: string; action: string }; count: number; amount: number }>([
    { $match: { refundProposal: { $ne: null } } },
    {
      $group: {
        _id: { status: "$refundProposal.status", action: "$refundProposal.action" },
        count: { $sum: 1 },
        amount: { $sum: "$refundProposal.amount" },
      },
    },
  ]);

  const timing = await Ticket.aggregate<{ avgMinutes: number }>([
    { $match: { "refundProposal.decidedAt": { $ne: null } } },
    {
      $group: {
        _id: null,
        avgMinutes: { $avg: { $divide: [{ $subtract: ["$refundProposal.decidedAt", "$createdAt"] }, 60000] } },
      },
    },
  ]);

  const byStatus: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  let decided = 0;
  let approved = 0;
  let pendingAmount = 0;
  for (const p of proposals) {
    byStatus[p._id.status] = (byStatus[p._id.status] ?? 0) + p.count;
    byAction[p._id.action] = (byAction[p._id.action] ?? 0) + p.count;
    if (["EXECUTED", "SENT", "REJECTED"].includes(p._id.status)) decided += p.count;
    if (["EXECUTED", "SENT"].includes(p._id.status)) approved += p.count;
    if (p._id.status === "PENDING") pendingAmount += p.amount;
  }

  return {
    revenue: Math.round((money?.revenue ?? 0) * 100) / 100,
    refunded: Math.round((money?.refunded ?? 0) * 100) / 100,
    paidOrders: money?.paidOrders ?? 0,
    proposalsByStatus: byStatus,
    proposalsByAction: byAction,
    pendingCount: byStatus.PENDING ?? 0,
    pendingAmount: Math.round(pendingAmount * 100) / 100,
    agreementRate: decided ? Math.round((approved / decided) * 100) : null,
    avgMinutesToDecision: timing[0] ? Math.round(timing[0].avgMinutes) : null,
  };
}
