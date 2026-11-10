"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signAccessToken = signAccessToken;
exports.verifyAccessToken = verifyAccessToken;
exports.generateRefreshToken = generateRefreshToken;
exports.hashToken = hashToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../config/env");
// ── Access / refresh token strategy ─────────────────────────────────────
// Two tokens instead of one, each with a different job:
//
// - ACCESS token: a JWT, short-lived (15 min), sent as
//   "Authorization: Bearer <token>" on every API call. It's self-contained
//   (the server can verify it with just a signature check, no DB lookup),
//   which is what makes API requests fast - but that same property means
//   it CANNOT be revoked early. If it leaks, it's valid until it expires.
// - REFRESH token: a random opaque string (NOT a JWT - nothing to decode),
//   long-lived (30 days), stored in an httpOnly cookie so frontend JS can
//   never read it. We store its HASH in the database (models/RefreshToken),
//   which is what makes it revocable: logout deletes the DB record, so the
//   token stops working immediately even though it hasn't "expired" yet.
//
// This is strictly more secure than the single 7-day access token we used
// in the earlier scoped build - that one couldn't be revoked at all short
// of changing JWT_SECRET (which would log out every user at once). The
// cost: an extra DB round-trip on /auth/refresh, and more moving parts.
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
function signAccessToken(payload) {
    return jsonwebtoken_1.default.sign(payload, env_1.env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}
function verifyAccessToken(token) {
    return jsonwebtoken_1.default.verify(token, env_1.env.JWT_ACCESS_SECRET);
}
function generateRefreshToken() {
    const raw = crypto_1.default.randomBytes(40).toString("hex");
    return {
        raw,
        hash: hashToken(raw),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    };
}
// One-way hash so the database never holds a usable token, same principle
// as password hashing (though SHA-256, not bcrypt - this token is already
// 320 bits of random entropy, unlike a human password, so it doesn't need
// bcrypt's deliberate slowness to resist guessing).
function hashToken(raw) {
    return crypto_1.default.createHash("sha256").update(raw).digest("hex");
}
