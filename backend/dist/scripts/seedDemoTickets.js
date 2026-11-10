"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const db_1 = require("../config/db");
const seed_1 = require("../config/seed");
const User_1 = require("../models/User");
const Ticket_1 = require("../models/Ticket");
const Category_1 = require("../models/Category");
const Counter_1 = require("../models/Counter");
const slaService_1 = require("../services/slaService");
const AuditLog_1 = require("../models/AuditLog");
const mongoose_1 = __importDefault(require("mongoose"));
const TICKETS = [
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
    await (0, db_1.connectDB)();
    await (0, seed_1.seedDefaults)();
    const customer = await User_1.User.findOne({ email: "customer@demo.servicedesk" });
    const agent = await User_1.User.findOne({ email: "agent@demo.servicedesk" });
    if (!customer || !agent) {
        console.error("Demo accounts not found - run `npm run seed:users` first.");
        process.exit(1);
    }
    const categories = new Map((await Category_1.Category.find({ isActive: true })).map((c) => [c.name, c.name]));
    let created = 0;
    for (const t of TICKETS) {
        const categoryName = categories.get(t.category) ?? [...categories.values()][0];
        const { responseMinutes, resolutionMinutes } = await (0, slaService_1.getSlaMinutesForPriority)(t.priority);
        const createdAt = new Date(Date.now() - t.daysAgo * 24 * 60 * 60 * 1000);
        const seq = await (0, Counter_1.nextSequence)("ticket");
        const resolvedAt = t.status === "RESOLVED" || t.status === "CLOSED" ? new Date(createdAt.getTime() + 60 * 60 * 1000) : null;
        const ticket = await Ticket_1.Ticket.create({
            ticketNumber: `TCK-${String(seq).padStart(6, "0")}`,
            title: t.title,
            description: t.description,
            category: categoryName,
            priority: t.priority,
            status: t.status,
            tags: [],
            customer: customer._id,
            assignedAgent: t.assigned ? agent._id : null,
            responseDeadline: (0, slaService_1.addMinutes)(createdAt, responseMinutes),
            resolutionDeadline: (0, slaService_1.addMinutes)(createdAt, resolutionMinutes),
            firstResponseAt: t.assigned ? (0, slaService_1.addMinutes)(createdAt, Math.min(responseMinutes, 30)) : null,
            resolvedAt,
            createdAt,
            updatedAt: resolvedAt ?? createdAt,
        });
        // A couple of audit entries per ticket so the Audit Log screen has a
        // real trail to show, not just one row per ticket.
        await AuditLog_1.AuditLog.create({ actor: customer._id, action: "TICKET_CREATED", entity: "Ticket", entityId: ticket._id, newValue: { title: t.title, priority: t.priority }, timestamp: createdAt });
        if (t.assigned) {
            await AuditLog_1.AuditLog.create({ actor: agent._id, action: "ASSIGNED", entity: "Ticket", entityId: ticket._id, newValue: agent._id, timestamp: (0, slaService_1.addMinutes)(createdAt, 10) });
        }
        if (resolvedAt) {
            await AuditLog_1.AuditLog.create({ actor: agent._id, action: "STATUS_CHANGED", entity: "Ticket", entityId: ticket._id, oldValue: "IN_PROGRESS", newValue: t.status, timestamp: resolvedAt });
        }
        created++;
    }
    console.log(`✅ Seeded ${created} demo tickets (spread across every status/priority) for customer@demo.servicedesk / agent@demo.servicedesk.`);
    await mongoose_1.default.disconnect();
}
main().catch((err) => {
    console.error("Demo ticket seed failed:", err);
    process.exit(1);
});
