import { describe, it, expect } from "vitest";
import { computeSlaStatus, addMinutes } from "./slaService";

// Every test here works in plain Date math - no live clock, no timezone
// assumptions - because computeSlaStatus is a pure function of the
// timestamps you hand it. That's what makes it testable without flakiness:
// a test that used `new Date()` directly would occasionally fail depending
// on exactly when it happened to run.
const T0 = new Date("2026-01-01T00:00:00.000Z");

describe("slaService: computeSlaStatus", () => {
  it("is not breached before either deadline has passed", () => {
    const result = computeSlaStatus({
      responseDeadline: addMinutes(T0, 15),
      resolutionDeadline: addMinutes(T0, 240),
      firstResponseAt: null,
      resolvedAt: null,
      now: addMinutes(T0, 5),
    });
    expect(result.responseBreached).toBe(false);
    expect(result.resolutionBreached).toBe(false);
    expect(result.responseRemainingMs).toBeGreaterThan(0);
  });

  it("marks the response SLA breached once 'now' passes the deadline with no response yet", () => {
    const result = computeSlaStatus({
      responseDeadline: addMinutes(T0, 15),
      resolutionDeadline: addMinutes(T0, 240),
      firstResponseAt: null,
      resolvedAt: null,
      now: addMinutes(T0, 20),
    });
    expect(result.responseBreached).toBe(true);
    expect(result.responseRemainingMs).toBeLessThan(0);
  });

  it("freezes the response clock at the moment of first response - replying late still counts as breached", () => {
    const result = computeSlaStatus({
      responseDeadline: addMinutes(T0, 15),
      resolutionDeadline: addMinutes(T0, 240),
      firstResponseAt: addMinutes(T0, 30), // responded at +30, deadline was +15
      resolvedAt: null,
      now: addMinutes(T0, 500), // "now" is irrelevant once responded
    });
    expect(result.responseBreached).toBe(true);
  });

  it("responding before the deadline is NOT breached, even long after 'now' has passed the deadline", () => {
    const result = computeSlaStatus({
      responseDeadline: addMinutes(T0, 15),
      resolutionDeadline: addMinutes(T0, 240),
      firstResponseAt: addMinutes(T0, 10), // responded at +10, before the +15 deadline
      resolvedAt: null,
      now: addMinutes(T0, 999), // long after - must not matter anymore
    });
    expect(result.responseBreached).toBe(false);
  });

  it("resolving exactly AT the deadline is not breached (strictly after counts, not equal-to)", () => {
    const deadline = addMinutes(T0, 240);
    const result = computeSlaStatus({
      responseDeadline: addMinutes(T0, 15),
      resolutionDeadline: deadline,
      firstResponseAt: addMinutes(T0, 5),
      resolvedAt: deadline,
      now: addMinutes(T0, 999),
    });
    expect(result.resolutionBreached).toBe(false);
  });

  it("addMinutes is pure UTC epoch math - unaffected by any notion of local timezone", () => {
    const result = addMinutes(T0, 90);
    expect(result.getTime()).toBe(T0.getTime() + 90 * 60_000);
  });
});
