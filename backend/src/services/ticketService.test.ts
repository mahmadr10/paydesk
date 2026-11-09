import { describe, it, expect } from "vitest";
import { isLegalTransition } from "./ticketService";

// We test isLegalTransition() directly - it's a pure function (same input,
// same output, no database, no side effects) - rather than hitting the real
// API. This is the single rule the whole ticket workflow depends on being
// correct, so it's the highest-value place to have tests.
describe("ticket state machine: isLegalTransition", () => {
  it("allows every legal forward step", () => {
    expect(isLegalTransition("OPEN", "TRIAGED")).toBe(true);
    expect(isLegalTransition("TRIAGED", "ASSIGNED")).toBe(true);
    expect(isLegalTransition("ASSIGNED", "IN_PROGRESS")).toBe(true);
    expect(isLegalTransition("IN_PROGRESS", "RESOLVED")).toBe(true);
    expect(isLegalTransition("RESOLVED", "CLOSED")).toBe(true);
  });

  it("allows the two branches out of IN_PROGRESS", () => {
    expect(isLegalTransition("IN_PROGRESS", "WAITING_FOR_CUSTOMER")).toBe(true);
    expect(isLegalTransition("IN_PROGRESS", "RESOLVED")).toBe(true);
  });

  it("allows a customer reply to bring a waiting ticket back to in-progress", () => {
    expect(isLegalTransition("WAITING_FOR_CUSTOMER", "IN_PROGRESS")).toBe(true);
  });

  it("allows reopening a closed ticket", () => {
    expect(isLegalTransition("CLOSED", "OPEN")).toBe(true);
  });

  it("rejects skipping a step (the spec's example)", () => {
    expect(isLegalTransition("OPEN", "RESOLVED")).toBe(false);
  });

  it("rejects skipping ahead by more than one legal step", () => {
    expect(isLegalTransition("OPEN", "ASSIGNED")).toBe(false);
    expect(isLegalTransition("OPEN", "IN_PROGRESS")).toBe(false);
    expect(isLegalTransition("OPEN", "CLOSED")).toBe(false);
    expect(isLegalTransition("TRIAGED", "IN_PROGRESS")).toBe(false);
    expect(isLegalTransition("ASSIGNED", "RESOLVED")).toBe(false);
    expect(isLegalTransition("WAITING_FOR_CUSTOMER", "RESOLVED")).toBe(false);
  });

  it("rejects moving backwards outside the two explicit exceptions", () => {
    expect(isLegalTransition("TRIAGED", "OPEN")).toBe(false);
    expect(isLegalTransition("ASSIGNED", "TRIAGED")).toBe(false);
    expect(isLegalTransition("RESOLVED", "IN_PROGRESS")).toBe(false);
  });

  it("rejects staying in the same status", () => {
    expect(isLegalTransition("OPEN", "OPEN")).toBe(false);
    expect(isLegalTransition("CLOSED", "CLOSED")).toBe(false);
  });

  it("a reopened (OPEN) ticket must go through TRIAGED again, not straight back to where it left off", () => {
    expect(isLegalTransition("OPEN", "ASSIGNED")).toBe(false);
    expect(isLegalTransition("OPEN", "IN_PROGRESS")).toBe(false);
  });
});
