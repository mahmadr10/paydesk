"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const slaService_1 = require("./slaService");
// Every test here works in plain Date math - no live clock, no timezone
// assumptions - because computeSlaStatus is a pure function of the
// timestamps you hand it. That's what makes it testable without flakiness:
// a test that used `new Date()` directly would occasionally fail depending
// on exactly when it happened to run.
const T0 = new Date("2026-01-01T00:00:00.000Z");
(0, vitest_1.describe)("slaService: computeSlaStatus", () => {
    (0, vitest_1.it)("is not breached before either deadline has passed", () => {
        const result = (0, slaService_1.computeSlaStatus)({
            responseDeadline: (0, slaService_1.addMinutes)(T0, 15),
            resolutionDeadline: (0, slaService_1.addMinutes)(T0, 240),
            firstResponseAt: null,
            resolvedAt: null,
            now: (0, slaService_1.addMinutes)(T0, 5),
        });
        (0, vitest_1.expect)(result.responseBreached).toBe(false);
        (0, vitest_1.expect)(result.resolutionBreached).toBe(false);
        (0, vitest_1.expect)(result.responseRemainingMs).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("marks the response SLA breached once 'now' passes the deadline with no response yet", () => {
        const result = (0, slaService_1.computeSlaStatus)({
            responseDeadline: (0, slaService_1.addMinutes)(T0, 15),
            resolutionDeadline: (0, slaService_1.addMinutes)(T0, 240),
            firstResponseAt: null,
            resolvedAt: null,
            now: (0, slaService_1.addMinutes)(T0, 20),
        });
        (0, vitest_1.expect)(result.responseBreached).toBe(true);
        (0, vitest_1.expect)(result.responseRemainingMs).toBeLessThan(0);
    });
    (0, vitest_1.it)("freezes the response clock at the moment of first response - replying late still counts as breached", () => {
        const result = (0, slaService_1.computeSlaStatus)({
            responseDeadline: (0, slaService_1.addMinutes)(T0, 15),
            resolutionDeadline: (0, slaService_1.addMinutes)(T0, 240),
            firstResponseAt: (0, slaService_1.addMinutes)(T0, 30), // responded at +30, deadline was +15
            resolvedAt: null,
            now: (0, slaService_1.addMinutes)(T0, 500), // "now" is irrelevant once responded
        });
        (0, vitest_1.expect)(result.responseBreached).toBe(true);
    });
    (0, vitest_1.it)("responding before the deadline is NOT breached, even long after 'now' has passed the deadline", () => {
        const result = (0, slaService_1.computeSlaStatus)({
            responseDeadline: (0, slaService_1.addMinutes)(T0, 15),
            resolutionDeadline: (0, slaService_1.addMinutes)(T0, 240),
            firstResponseAt: (0, slaService_1.addMinutes)(T0, 10), // responded at +10, before the +15 deadline
            resolvedAt: null,
            now: (0, slaService_1.addMinutes)(T0, 999), // long after - must not matter anymore
        });
        (0, vitest_1.expect)(result.responseBreached).toBe(false);
    });
    (0, vitest_1.it)("resolving exactly AT the deadline is not breached (strictly after counts, not equal-to)", () => {
        const deadline = (0, slaService_1.addMinutes)(T0, 240);
        const result = (0, slaService_1.computeSlaStatus)({
            responseDeadline: (0, slaService_1.addMinutes)(T0, 15),
            resolutionDeadline: deadline,
            firstResponseAt: (0, slaService_1.addMinutes)(T0, 5),
            resolvedAt: deadline,
            now: (0, slaService_1.addMinutes)(T0, 999),
        });
        (0, vitest_1.expect)(result.resolutionBreached).toBe(false);
    });
    (0, vitest_1.it)("addMinutes is pure UTC epoch math - unaffected by any notion of local timezone", () => {
        const result = (0, slaService_1.addMinutes)(T0, 90);
        (0, vitest_1.expect)(result.getTime()).toBe(T0.getTime() + 90 * 60_000);
    });
});
