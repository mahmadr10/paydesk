import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { AppError } from "../utils/AppError";
import { UserRole } from "../models/User";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    throw new AppError(401, "UNAUTHORIZED", "Missing or malformed Authorization header.");
  }

  const token = header.slice("Bearer ".length);

  try {
    // Note: this only checks the JWT's signature and expiry, not whether
    // the user has been deactivated since the token was issued (that would
    // need a DB read on every single request, which defeats the point of a
    // stateless access token). Worst case, a deactivated user's *existing*
    // access token stays valid for up to 15 minutes - an accepted trade-off
    // given how short-lived access tokens are; /auth/refresh DOES check
    // isActive, so it's revoked within one refresh cycle at most.
    req.user = verifyAccessToken(token);
    next();
  } catch {
    throw new AppError(401, "UNAUTHORIZED", "Invalid or expired token.");
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError(403, "FORBIDDEN", `This action requires role: ${roles.join(" or ")}.`);
    }
    next();
  };
}
