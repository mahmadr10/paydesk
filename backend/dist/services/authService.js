"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerUser = registerUser;
exports.loginUser = loginUser;
exports.refreshTokens = refreshTokens;
exports.logoutUser = logoutUser;
exports.getUserFromAccessToken = getUserFromAccessToken;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const AppError_1 = require("../utils/AppError");
const jwt_1 = require("../utils/jwt");
const userRepo = __importStar(require("../repositories/userRepository"));
const refreshTokenRepo = __importStar(require("../repositories/refreshTokenRepository"));
const auditLogService_1 = require("./auditLogService");
const SALT_ROUNDS = 10;
async function issueTokenPair(userId, role) {
    const accessToken = (0, jwt_1.signAccessToken)({ userId, role });
    const refresh = (0, jwt_1.generateRefreshToken)();
    await refreshTokenRepo.storeRefreshToken(userId, refresh.hash, refresh.expiresAt);
    return { accessToken, refreshToken: refresh.raw };
}
async function registerUser(input) {
    const existing = await userRepo.findUserByEmail(input.email);
    if (existing) {
        throw new AppError_1.AppError(409, "EMAIL_IN_USE", "An account with this email already exists.");
    }
    const passwordHash = await bcryptjs_1.default.hash(input.password, SALT_ROUNDS);
    const user = await userRepo.createUser({
        name: input.name,
        email: input.email,
        passwordHash,
        role: input.role,
    });
    await (0, auditLogService_1.logAction)({
        actor: user._id.toString(),
        action: "USER_REGISTERED",
        entity: "User",
        entityId: user._id.toString(),
        newValue: { name: user.name, email: user.email, role: user.role },
    });
    const tokens = await issueTokenPair(user._id.toString(), user.role);
    return { user, ...tokens };
}
async function loginUser(input) {
    const user = await userRepo.findUserByEmail(input.email);
    if (!user || !user.isActive) {
        // Same generic message whether the account doesn't exist, is
        // deactivated, or the password is wrong - an attacker probing emails
        // learns nothing from the response either way.
        throw new AppError_1.AppError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
    }
    const passwordMatches = await user.comparePassword(input.password);
    if (!passwordMatches) {
        throw new AppError_1.AppError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
    }
    const tokens = await issueTokenPair(user._id.toString(), user.role);
    return { user, ...tokens };
}
// Rotation: every refresh call revokes the token it was given and issues a
// brand new one. Why rotate instead of reusing the same refresh token for
// 30 days? If a refresh token is ever stolen (e.g. from a compromised
// machine) and BOTH the attacker and the real user try to use it, the
// second use fails (already revoked) - an app that checks for that reuse
// can detect the theft. We don't build the theft-detection alerting here
// (out of scope for this build), but rotation is what makes it *possible*.
async function refreshTokens(rawRefreshToken) {
    const tokenHash = (0, jwt_1.hashToken)(rawRefreshToken);
    const stored = await refreshTokenRepo.findActiveRefreshToken(tokenHash);
    if (!stored) {
        throw new AppError_1.AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or has expired.");
    }
    const user = await userRepo.findUserById(stored.user.toString());
    if (!user || !user.isActive) {
        throw new AppError_1.AppError(401, "INVALID_REFRESH_TOKEN", "Account no longer available.");
    }
    await refreshTokenRepo.revokeRefreshToken(tokenHash);
    const tokens = await issueTokenPair(user._id.toString(), user.role);
    return { user, ...tokens };
}
async function logoutUser(rawRefreshToken) {
    if (!rawRefreshToken)
        return;
    await refreshTokenRepo.revokeRefreshToken((0, jwt_1.hashToken)(rawRefreshToken));
}
async function getUserFromAccessToken(token) {
    const payload = (0, jwt_1.verifyAccessToken)(token);
    const user = await userRepo.findUserById(payload.userId);
    if (!user)
        throw new AppError_1.AppError(404, "NOT_FOUND", "User not found.");
    return user;
}
