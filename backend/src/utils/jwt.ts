import jwt from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../config/env";
import { UserRole } from "../models/User";

export interface JwtPayload {
  userId: string;
  role: UserRole;
}

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

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
}

export function generateRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = crypto.randomBytes(40).toString("hex");
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
export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
