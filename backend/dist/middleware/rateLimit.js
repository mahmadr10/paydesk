"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.devAssistantLimiter = exports.aiLimiter = exports.authLimiter = exports.generalLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const AppError_1 = require("../utils/AppError");
// Rate limiting exists to slow down a real attacker guessing passwords -
// it should never make our OWN automated test suite flaky by having tests
// trip each other's shared limiter state. Real request volume from a
// script/attacker is what this guards against; NODE_ENV=test is us, so we
// skip counting entirely there (see src/test/globalSetup.ts, which sets it).
const isTestEnv = () => process.env.NODE_ENV === "test";
exports.generalLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isTestEnv,
    handler: () => {
        throw new AppError_1.AppError(429, "RATE_LIMITED", "Too many requests. Please slow down.");
    },
});
// Tighter than the general limit - this is the endpoint an attacker would
// actually try to brute-force (guessing passwords, enumerating emails) - but
// not SO tight that trying a few demo accounts in one sitting locks you out;
// 30 per 15 minutes stops scripted brute-forcing while staying invisible to
// normal use.
exports.authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isTestEnv,
    handler: () => {
        throw new AppError_1.AppError(429, "RATE_LIMITED", "Too many attempts. Please try again later.");
    },
});
// Refund agent + smart intake each make a few LLM calls (and a PayPal call),
// so they get their own, tighter budget.
exports.aiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isTestEnv,
    handler: () => {
        throw new AppError_1.AppError(429, "RATE_LIMITED", "Too many AI requests. Please wait a few minutes.");
    },
});
// The AI Dev Assistant can trigger multiple LLM calls AND a real test suite
// run (~10-15s) per question - genuinely expensive compared to a normal CRUD
// request, so this is deliberately tighter than the general limiter even
// though it's already Admin-only.
exports.devAssistantLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isTestEnv,
    handler: () => {
        throw new AppError_1.AppError(429, "RATE_LIMITED", "Too many Dev Assistant queries. Please wait before asking another.");
    },
});
