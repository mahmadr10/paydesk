"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RefreshToken = void 0;
const mongoose_1 = require("mongoose");
const refreshTokenSchema = new mongoose_1.Schema({
    user: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revoked: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
});
// MongoDB TTL index: automatically deletes the document once expiresAt has
// passed, so expired refresh tokens don't pile up forever.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
exports.RefreshToken = (0, mongoose_1.model)("RefreshToken", refreshTokenSchema);
