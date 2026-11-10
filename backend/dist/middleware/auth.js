"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireRole = requireRole;
const jwt_1 = require("../utils/jwt");
const AppError_1 = require("../utils/AppError");
function requireAuth(req, _res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        throw new AppError_1.AppError(401, "UNAUTHORIZED", "Missing or malformed Authorization header.");
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
        req.user = (0, jwt_1.verifyAccessToken)(token);
        next();
    }
    catch {
        throw new AppError_1.AppError(401, "UNAUTHORIZED", "Invalid or expired token.");
    }
}
function requireRole(...roles) {
    return (req, _res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            throw new AppError_1.AppError(403, "FORBIDDEN", `This action requires role: ${roles.join(" or ")}.`);
        }
        next();
    };
}
