import { Schema, model, Document, Types } from "mongoose";

// We never store the raw refresh token - only a SHA-256 hash of it (see
// utils/jwt.ts hashToken). Same principle as password hashing: if this
// collection ever leaked, the tokens inside it would be useless to an
// attacker. The raw token is a random 40-byte string, never a JWT - there's
// nothing to "decode", it's just a bearer secret we look up by its hash.
export interface IRefreshToken extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  revoked: boolean;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  revoked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// MongoDB TTL index: automatically deletes the document once expiresAt has
// passed, so expired refresh tokens don't pile up forever.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<IRefreshToken>("RefreshToken", refreshTokenSchema);
