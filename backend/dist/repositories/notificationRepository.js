"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotification = createNotification;
exports.listForUser = listForUser;
exports.countUnread = countUnread;
exports.markRead = markRead;
exports.markAllRead = markAllRead;
const Notification_1 = require("../models/Notification");
function createNotification(data) {
    return Notification_1.Notification.create({ ...data, ticket: data.ticket ?? null });
}
function listForUser(userId, { page, limit }) {
    const skip = (page - 1) * limit;
    return Promise.all([
        Notification_1.Notification.find({ user: userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
        Notification_1.Notification.countDocuments({ user: userId }),
    ]);
}
function countUnread(userId) {
    return Notification_1.Notification.countDocuments({ user: userId, read: false });
}
function markRead(id, userId) {
    // Scoped to the requesting user - one user can never mark another's
    // notification read (and there's nothing sensitive to leak by a 404 vs
    // 403 distinction here, so a plain "not found for you" no-op-if-absent
    // is fine, unlike ticket ownership checks elsewhere in this app).
    return Notification_1.Notification.findOneAndUpdate({ _id: id, user: userId }, { read: true }, { returnDocument: "after" });
}
function markAllRead(userId) {
    return Notification_1.Notification.updateMany({ user: userId, read: false }, { read: true });
}
