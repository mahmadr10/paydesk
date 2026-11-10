"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeRefreshToken = storeRefreshToken;
exports.findActiveRefreshToken = findActiveRefreshToken;
exports.revokeRefreshToken = revokeRefreshToken;
exports.revokeAllForUser = revokeAllForUser;
const RefreshToken_1 = require("../models/RefreshToken");
function storeRefreshToken(userId, tokenHash, expiresAt) {
    return RefreshToken_1.RefreshToken.create({ user: userId, tokenHash, expiresAt });
}
function findActiveRefreshToken(tokenHash) {
    return RefreshToken_1.RefreshToken.findOne({ tokenHash, revoked: false, expiresAt: { $gt: new Date() } });
}
function revokeRefreshToken(tokenHash) {
    return RefreshToken_1.RefreshToken.updateOne({ tokenHash }, { revoked: true });
}
// Used on logout-everywhere / password-change scenarios (not currently
// exposed via an endpoint, but here so the seam exists if that's needed).
function revokeAllForUser(userId) {
    return RefreshToken_1.RefreshToken.updateMany({ user: userId, revoked: false }, { revoked: true });
}
