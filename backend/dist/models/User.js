"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const mongoose_1 = require("mongoose");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const userSchema = new mongoose_1.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["CUSTOMER", "AGENT", "ADMIN"], required: true },
    // Lets an admin deactivate an account (e.g. an agent who left) without
    // deleting their history - deactivated users can't log in, but their
    // name still shows correctly on old tickets/comments/audit entries.
    isActive: { type: Boolean, default: true },
}, { timestamps: true });
userSchema.methods.comparePassword = function (candidate) {
    return bcryptjs_1.default.compare(candidate, this.passwordHash);
};
userSchema.set("toJSON", {
    transform: (_doc, ret) => {
        delete ret.passwordHash;
        return ret;
    },
});
exports.User = (0, mongoose_1.model)("User", userSchema);
