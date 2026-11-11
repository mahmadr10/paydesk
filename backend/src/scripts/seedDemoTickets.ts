// Run manually with: npm run seed:demo
//
// `seed:users` creates the 3 demo accounts but no tickets - logging in
// right after that shows an empty "My Tickets"/queue/dashboard, which is a
// weak demo (a single ticket created live is the right thing to SHOW, but
// an admin's Dashboard/Analytics/Audit Logs screens need more than one data
// point to look like anything). This creates a small, realistic, HAND-
// CURATED spread (not `seed:perf`'s 10,000 random rows - that's for query
// benchmarking, not a demo video) across every status/priority/category, so
// the dashboard/analytics/audit-log screens have something real to show
// before you've clicked anything.
import { connectDB } from "../config/db";
import { seedDefaults } from "../config/seed";
import { User } from "../models/User";
import { Ticket, TicketStatus, TicketPriority } from "../models/Ticket";
import { Category } from "../models/Category";
import { nextSequence } from "../models/Counter";
import { getSlaMinutesForPriority, addMinutes } from "../services/slaService";
import { AuditLog } from "../models/AuditLog";
import mongoose from "mongoose";

interface SeedTicket {
  title: string;
  description: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  assigned: boolean;
  daysAgo: number; // how long ago it was created - lets some SLAs breach realistically
}

const TICKETS: SeedTicket[] = [
  { title: "Payment API returns HTTP 500 on checkout", description: "Every checkout attempt since ~10am today fails with a 500 from the payment gateway. Affects all customers.", category: "Technical", priority: "CRITICAL", status: "IN_PROGRESS", assigned: true, daysAgo: 0.2 },
  { title: "Cannot log in - password reset email never arrives", description: "Requested a password reset three times, no email in inbox or spam.", category: "Account", priority: "HIGH", status: "TRIAGED", assigned: false, daysAgo: 0.4 },
  { title: "Dashboard charts render blank on Safari", description: "The analytics bar charts don't render at all on Safari 17, works fine on Chrome.", category: "Technical", priority: "MEDIUM", status: "ASSIGNED", assigned: true, daysAgo: 1 },
  { title: "Feature request: dark mode", description: "Would love a dark mode toggle for the ticket queue.", category: "Other", priority: "LOW", status: "OPEN", assigned: false, daysAgo: 0.1 },
  { title: "Invoice shows incorrect tax amount", description: "Last month's invoice shows 15% tax, our contract specifies 8%.", category: "Billing", priority: "MEDIUM", status: "WAITING_FOR_CUSTOMER", assigned: true, daysAgo: 2 },
  { title: "Export to CSV button does nothing", description: "Clicking 'Export' on the ticket list does not download anything, no error shown either.", category: "Technical", priority: "LOW", status: "RESOLVED", assigned: true, daysAgo: 5 },
  { title: "Account locked after failed 2FA attempts", description: "Locked out after entering the wrong 2FA code twice, need it unlocked.", category: "Account", priority: "HIGH", status: "RESOLVED", assigned: true, daysAgo: 3 },
  { title: "Slow page load on the ticket detail view", description: "Ticket detail page takes 4-5 seconds to load, other pages are fast.", category: "Technical", priority: "MEDIUM", status: "IN_PROGRESS", assigned: true, daysAgo: 0.5 },
  { title: "Duplicate charge on this month's invoice", description: "Charged twice for the same subscription period, need a refund.", category: "Billing", priority: "CRITICAL", status: "TRIAGED", assigned: false, daysAgo: 0.05 },
  { title: "Typo in the welcome email subject line", description: "The welcome email subject says 'Wellcome' instead of 'Welcome'.", category: "Other", priority: "LOW", status: "CLOSED", assigned: true, daysAgo: 10 },
  { title: "API rate limit hit unexpectedly", description: "Getting 429s well under our documented rate limit - seems too aggressive.", category: "Technical", priority: "HIGH", status: "OPEN", assigned: false, daysAgo: 0.02 },
  { title: "Cannot upload attachments over 3MB", description: "Docs say 5MB limit but uploads fail around 3MB with a generic error.", category: "Technical", priority: "MEDIUM", status: "ASSIGNED", assigned: true, daysAgo: 1.5 },
  { title: "Billing portal shows wrong plan name", description: "We're on the Enterprise plan but the portal shows 'Starter'.", category: "Billing", priority: "LOW", status: "RESOLVED", assigned: true, daysAgo: 7 },
  { title: "Security: possible XSS in comment field", description: "Was able to enter a <script> tag in a comment, want confirmation it's sanitized.", category: "Technical", priority: "CRITICAL", status: "IN_PROGRESS", assigned: true, daysAgo: 0.3 },
  { title: "Request to add a new team member seat", description: "Need to add 3 more seats to our current plan.", category: "Account", priority: "LOW", status: "CLOSED", assigned: true, daysAgo: 14 },
];

async function main() {
  await connectDB();
  await seedDefaults();

  const customer = await User.findOne({ email: "buyer@paydesk.test" });
  const agent = await User.findOne({ email: "seller@paydesk.test" });
  if (!customer || !agent) {
    console.error("Demo accounts not found - run `npm run seed:users` first.");
    process.exit(1);
  }

  const categories = new Map((await Category.find({ isActive: true })).map((c) => [c.name, c.name]));

  let created = 0;
  for (const t of TICKETS) {
    const categoryName = categories.get(t.category) ?? [...categories.values()][0];
    const { responseMinutes, resolutionMinutes } = await getSlaMinutesForPriority(t.priority);
    const createdAt = new Date(Date.now() - t.daysAgo * 24 * 60 * 60 * 1000);
    const seq = await nextSequence("ticket");
    const resolvedAt = t.status === "RESOLVED" || t.status === "CLOSED" ? new Date(createdAt.getTime() + 60 * 60 * 1000) : null;

    const ticket = await Ticket.create({
      ticketNumber: `TCK-${String(seq).padStart(6, "0")}`,
      title: t.title,
      description: t.description,
      category: categoryName,
      priority: t.priority,
      status: t.status,
      tags: [],
      customer: customer._id,
      assignedAgent: t.assigned ? agent._id : null,
      responseDeadline: addMinutes(createdAt, responseMinutes),
      resolutionDeadline: addMinutes(createdAt, resolutionMinutes),
      firstResponseAt: t.assigned ? addMinutes(createdAt, Math.min(responseMinutes, 30)) : null,
      resolvedAt,
      createdAt,
      updatedAt: resolvedAt ?? createdAt,
    });

    // A couple of audit entries per ticket so the Audit Log screen has a
    // real trail to show, not just one row per ticket.
    await AuditLog.create({ actor: customer._id, action: "TICKET_CREATED", entity: "Ticket", entityId: ticket._id, newValue: { title: t.title, priority: t.priority }, timestamp: createdAt });
    if (t.assigned) {
      await AuditLog.create({ actor: agent._id, action: "ASSIGNED", entity: "Ticket", entityId: ticket._id, newValue: agent._id, timestamp: addMinutes(createdAt, 10) });
    }
    if (resolvedAt) {
      await AuditLog.create({ actor: agent._id, action: "STATUS_CHANGED", entity: "Ticket", entityId: ticket._id, oldValue: "IN_PROGRESS", newValue: t.status, timestamp: resolvedAt });
    }

    created++;
  }

  console.log(`✅ Seeded ${created} demo tickets (spread across every status/priority) for customer@demo.servicedesk / agent@demo.servicedesk.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Demo ticket seed failed:", err);
  process.exit(1);
});
