import { Request, Response } from "express";
import { registerUser, loginUser, refreshTokens, logoutUser } from "../services/authService";
import { User } from "../models/User";
import { AppError } from "../utils/AppError";
import { env, isProduction } from "../config/env";

// Centralizing the cookie options in one place means the "set" and "clear"
// calls can never accidentally disagree on path/sameSite/secure and leave a
// cookie the browser won't actually delete.
// In production (e.g. Vercel backend + Vercel frontend), sameSite: "none" and secure: true
// are required for cross-domain credentials to work.
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true, // frontend JS can never read this - the whole point of using a cookie instead of localStorage for it
  secure: isProduction, // only sent over HTTPS in production; localhost dev has no TLS
  sameSite: isProduction ? ("none" as const) : ("lax" as const),
  path: "/api/v1/auth", // only sent back to auth endpoints, not every API call
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days, matches REFRESH_TOKEN_TTL_MS in utils/jwt.ts
};

function sendAuthResponse(res: Response, status: number, user: unknown, accessToken: string, refreshToken: string) {
  res.cookie(env.JWT_REFRESH_COOKIE_NAME, refreshToken, REFRESH_COOKIE_OPTIONS);
  res.status(status).json({ success: true, data: { user, accessToken } });
}

export async function register(req: Request, res: Response) {
  const { user, accessToken, refreshToken } = await registerUser(req.body);
  sendAuthResponse(res, 201, user, accessToken, refreshToken);
}

export async function login(req: Request, res: Response) {
  const { user, accessToken, refreshToken } = await loginUser(req.body);
  sendAuthResponse(res, 200, user, accessToken, refreshToken);
}

export async function refresh(req: Request, res: Response) {
  const rawRefreshToken = req.cookies?.[env.JWT_REFRESH_COOKIE_NAME];
  if (!rawRefreshToken) {
    throw new AppError(401, "INVALID_REFRESH_TOKEN", "No refresh token provided.");
  }
  const { user, accessToken, refreshToken } = await refreshTokens(rawRefreshToken);
  sendAuthResponse(res, 200, user, accessToken, refreshToken);
}

export async function logout(req: Request, res: Response) {
  const rawRefreshToken = req.cookies?.[env.JWT_REFRESH_COOKIE_NAME];
  await logoutUser(rawRefreshToken);
  res.clearCookie(env.JWT_REFRESH_COOKIE_NAME, {
    path: REFRESH_COOKIE_OPTIONS.path,
    secure: REFRESH_COOKIE_OPTIONS.secure,
    sameSite: REFRESH_COOKIE_OPTIONS.sameSite,
  });
  res.status(200).json({ success: true, data: null });
}

export async function me(req: Request, res: Response) {
  const user = await User.findById(req.user!.userId);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found.");
  res.status(200).json({ success: true, data: { user } });
}
