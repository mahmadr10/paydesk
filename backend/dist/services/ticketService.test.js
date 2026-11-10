"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const ticketService_1 = require("./ticketService");
// We test isLegalTransition() directly - it's a pure function (same input,
// same output, no database, no side effects) - rather than hitting the real
// API. This is the single rule the whole ticket workflow depends on being
// correct, so it's the highest-value place to have tests.
(0, vitest_1.describe)("ticket state machine: isLegalTransition", () => {
    (0, vitest_1.it)("allows every legal forward step", () => {
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("OPEN", "TRIAGED")).toBe(true);
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("TRIAGED", "ASSIGNED")).toBe(true);
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("ASSIGNED", "IN_PROGRESS")).toBe(true);
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("IN_PROGRESS", "RESOLVED")).toBe(true);
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("RESOLVED", "CLOSED")).toBe(true);
    });
    (0, vitest_1.it)("allows the two branches out of IN_PROGRESS", () => {
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("IN_PROGRESS", "WAITING_FOR_CUSTOMER")).toBe(true);
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("IN_PROGRESS", "RESOLVED")).toBe(true);
    });
    (0, vitest_1.it)("allows a customer reply to bring a waiting ticket back to in-progress", () => {
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("WAITING_FOR_CUSTOMER", "IN_PROGRESS")).toBe(true);
    });
    (0, vitest_1.it)("allows reopening a closed ticket", () => {
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("CLOSED", "OPEN")).toBe(true);
    });
    (0, vitest_1.it)("rejects skipping a step (the spec's example)", () => {
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("OPEN", "RESOLVED")).toBe(false);
    });
    (0, vitest_1.it)("rejects skipping ahead by more than one legal step", () => {
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("OPEN", "ASSIGNED")).toBe(false);
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("OPEN", "IN_PROGRESS")).toBe(false);
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("OPEN", "CLOSED")).toBe(false);
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("TRIAGED", "IN_PROGRESS")).toBe(false);
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("ASSIGNED", "RESOLVED")).toBe(false);
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("WAITING_FOR_CUSTOMER", "RESOLVED")).toBe(false);
    });
    (0, vitest_1.it)("rejects moving backwards outside the two explicit exceptions", () => {
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("TRIAGED", "OPEN")).toBe(false);
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("ASSIGNED", "TRIAGED")).toBe(false);
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("RESOLVED", "IN_PROGRESS")).toBe(false);
    });
    (0, vitest_1.it)("rejects staying in the same status", () => {
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("OPEN", "OPEN")).toBe(false);
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("CLOSED", "CLOSED")).toBe(false);
    });
    (0, vitest_1.it)("a reopened (OPEN) ticket must go through TRIAGED again, not straight back to where it left off", () => {
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("OPEN", "ASSIGNED")).toBe(false);
        (0, vitest_1.expect)((0, ticketService_1.isLegalTransition)("OPEN", "IN_PROGRESS")).toBe(false);
    });
});
