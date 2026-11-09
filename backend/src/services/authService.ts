import bcrypt from "bcryptjs";
import { AppError } from "../utils/AppError";
import { signAccessToken, generateRefreshToken, hashToken, verifyAccessToken } from "../utils/jwt";
import { RegisterInput, LoginInput } from "../validators/authValidators";
import * as userRepo from "../repositories/userRepository";
import * as refreshTokenRepo from "../repositories/refreshTokenRepository";
import { logAction } from "./auditLogService";

const SALT_ROUNDS = 10;

async function issueTokenPair(userId: string, role: "CUSTOMER" | "AGENT" | "ADMIN") {
  const accessToken = signAccessToken({ userId, role });
  const refresh = generateRefreshToken();
  await refreshTokenRepo.storeRefreshToken(userId, refresh.hash, refresh.expiresAt);
  return { accessToken, refreshToken: refresh.raw };
}

export async function registerUser(input: RegisterInput) {
  const existing = await userRepo.findUserByEmail(input.email);
  if (existing) {
    throw new AppError(409, "EMAIL_IN_USE", "An account with this email already exists.");
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await userRepo.createUser({
    name: input.name,
    email: input.email,
    passwordHash,
    role: input.role,
  });

  await logAction({
    actor: user._id.toString(),
    action: "USER_REGISTERED",
    entity: "User",
    entityId: user._id.toString(),
    newValue: { name: user.name, email: user.email, role: user.role },
  });

  const tokens = await issueTokenPair(user._id.toString(), user.role);
  return { user, ...tokens };
}

export async function loginUser(input: LoginInput) {
  const user = await userRepo.findUserByEmail(input.email);
  if (!user || !user.isActive) {
    // Same generic message whether the account doesn't exist, is
    // deactivated, or the password is wrong - an attacker probing emails
    // learns nothing from the response either way.
    throw new AppError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
  }

  const passwordMatches = await user.comparePassword(input.password);
  if (!passwordMatches) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
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
export async function refreshTokens(rawRefreshToken: string) {
  const tokenHash = hashToken(rawRefreshToken);
  const stored = await refreshTokenRepo.findActiveRefreshToken(tokenHash);
  if (!stored) {
    throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or has expired.");
  }

  const user = await userRepo.findUserById(stored.user.toString());
  if (!user || !user.isActive) {
    throw new AppError(401, "INVALID_REFRESH_TOKEN", "Account no longer available.");
  }

  await refreshTokenRepo.revokeRefreshToken(tokenHash);
  const tokens = await issueTokenPair(user._id.toString(), user.role);
  return { user, ...tokens };
}

export async function logoutUser(rawRefreshToken: string | undefined) {
  if (!rawRefreshToken) return;
  await refreshTokenRepo.revokeRefreshToken(hashToken(rawRefreshToken));
}

export async function getUserFromAccessToken(token: string) {
  const payload = verifyAccessToken(token);
  const user = await userRepo.findUserById(payload.userId);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found.");
  return user;
}
