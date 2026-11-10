"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Notification = void 0;
const mongoose_1 = require("mongoose");
const notificationSchema = new mongoose_1.Schema({
    user: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, required: true },
    message: { type: String, required: true },
    ticket: { type: mongoose_1.Schema.Types.ObjectId, ref: "Ticket", default: null },
    read: { type: Boolean, default: false, index: true },
    createdAt: { type: Date, default: Date.now, index: true },
});
// Serves "my unread notifications, newest first" - the one query pattern
// the notification bell actually runs.
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
exports.Notification = (0, mongoose_1.model)("Notification", notificationSchema);
