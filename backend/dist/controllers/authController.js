"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.login = login;
exports.refresh = refresh;
exports.logout = logout;
exports.me = me;
const authService_1 = require("../services/authService");
const User_1 = require("../models/User");
const AppError_1 = require("../utils/AppError");
const env_1 = require("../config/env");
// Centralizing the cookie options in one place means the "set" and "clear"
// calls can never accidentally disagree on path/sameSite/secure and leave a
// cookie the browser won't actually delete.
// In production (e.g. Vercel backend + Vercel frontend), sameSite: "none" and secure: true
// are required for cross-domain credentials to work.
const REFRESH_COOKIE_OPTIONS = {
    httpOnly: true, // frontend JS can never read this - the whole point of using a cookie instead of localStorage for it
    secure: env_1.isProduction, // only sent over HTTPS in production; localhost dev has no TLS
    sameSite: env_1.isProduction ? "none" : "lax",
    path: "/api/v1/auth", // only sent back to auth endpoints, not every API call
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days, matches REFRESH_TOKEN_TTL_MS in utils/jwt.ts
};
function sendAuthResponse(res, status, user, accessToken, refreshToken) {
    res.cookie(env_1.env.JWT_REFRESH_COOKIE_NAME, refreshToken, REFRESH_COOKIE_OPTIONS);
    res.status(status).json({ success: true, data: { user, accessToken } });
}
async function register(req, res) {
    const { user, accessToken, refreshToken } = await (0, authService_1.registerUser)(req.body);
    sendAuthResponse(res, 201, user, accessToken, refreshToken);
}
async function login(req, res) {
    const { user, accessToken, refreshToken } = await (0, authService_1.loginUser)(req.body);
    sendAuthResponse(res, 200, user, accessToken, refreshToken);
}
async function refresh(req, res) {
    const rawRefreshToken = req.cookies?.[env_1.env.JWT_REFRESH_COOKIE_NAME];
    if (!rawRefreshToken) {
        throw new AppError_1.AppError(401, "INVALID_REFRESH_TOKEN", "No refresh token provided.");
    }
    const { user, accessToken, refreshToken } = await (0, authService_1.refreshTokens)(rawRefreshToken);
    sendAuthResponse(res, 200, user, accessToken, refreshToken);
}
async function logout(req, res) {
    const rawRefreshToken = req.cookies?.[env_1.env.JWT_REFRESH_COOKIE_NAME];
    await (0, authService_1.logoutUser)(rawRefreshToken);
    res.clearCookie(env_1.env.JWT_REFRESH_COOKIE_NAME, {
        path: REFRESH_COOKIE_OPTIONS.path,
        secure: REFRESH_COOKIE_OPTIONS.secure,
        sameSite: REFRESH_COOKIE_OPTIONS.sameSite,
    });
    res.status(200).json({ success: true, data: null });
}
async function me(req, res) {
    const user = await User_1.User.findById(req.user.userId);
    if (!user)
        throw new AppError_1.AppError(404, "NOT_FOUND", "User not found.");
    res.status(200).json({ success: true, data: { user } });
}
