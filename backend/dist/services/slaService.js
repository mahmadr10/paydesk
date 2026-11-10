"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSlaMinutesForPriority = getSlaMinutesForPriority;
exports.addMinutes = addMinutes;
exports.computeSlaStatus = computeSlaStatus;
const slaPolicyRepository_1 = require("../repositories/slaPolicyRepository");
const SLAPolicy_1 = require("../models/SLAPolicy");
// The SLA engine, isolated from Express/Mongoose as much as possible so the
// math itself (the part most likely to have an off-by-one or timezone bug)
// is easy to unit test in isolation.
//
// Timezone handling: every timestamp here is a JavaScript Date, which
// internally is always UTC (epoch milliseconds) - there's no "which
// timezone is this Date in" ambiguity to get wrong. The only place a
// timezone matters is when FORMATTING a Date for display, and that's the
// frontend's job (the browser's local timezone), not the backend's. The
// backend only ever adds minutes to timestamps and compares timestamps -
// operations that are timezone-agnostic by construction.
async function getSlaMinutesForPriority(priority) {
    const policy = await (0, slaPolicyRepository_1.findPolicyForPriority)(priority);
    if (policy)
        return { responseMinutes: policy.responseMinutes, resolutionMinutes: policy.resolutionMinutes };
    // Fall back to hardcoded defaults if the admin hasn't seeded/customized
    // policies yet - the app should still work correctly out of the box.
    return SLAPolicy_1.DEFAULT_SLA_POLICIES[priority];
}
function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60_000);
}
// Pure function: same inputs always produce the same output, no I/O. This
// is what MyTicketsPage/dashboard/tests all actually call - it's the
// highest-value place to test the SLA logic, same reasoning as the ticket
// state machine.
function computeSlaStatus(snapshot) {
    const { responseDeadline, resolutionDeadline, firstResponseAt, resolvedAt, now } = snapshot;
    // "Breached" means: the deadline passed before the thing it was measuring
    // actually happened. Once resolved/responded-to, the clock for THAT
    // deadline stops - a ticket resolved at minute 10 against a 4-hour
    // deadline is not "breached" just because it's now day 3.
    const responseBreached = firstResponseAt ? firstResponseAt > responseDeadline : now > responseDeadline;
    const resolutionBreached = resolvedAt ? resolvedAt > resolutionDeadline : now > resolutionDeadline;
    return {
        responseBreached,
        resolutionBreached,
        responseRemainingMs: responseDeadline.getTime() - (firstResponseAt ?? now).getTime(),
        resolutionRemainingMs: resolutionDeadline.getTime() - (resolvedAt ?? now).getTime(),
    };
}
