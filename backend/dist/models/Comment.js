"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Comment = void 0;
const mongoose_1 = require("mongoose");
const commentSchema = new mongoose_1.Schema({
    ticket: { type: mongoose_1.Schema.Types.ObjectId, ref: "Ticket", required: true, index: true },
    author: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    authorRole: { type: String, enum: ["CUSTOMER", "AGENT", "ADMIN"], required: true },
    text: { type: String, required: true, trim: true },
    isInternal: { type: Boolean, default: false },
}, { timestamps: { createdAt: true, updatedAt: false } });
exports.Comment = (0, mongoose_1.model)("Comment", commentSchema);
