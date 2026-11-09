import { Notification, NotificationType } from "../models/Notification";

export function createNotification(data: { user: string; type: NotificationType; message: string; ticket?: string | null }) {
  return Notification.create({ ...data, ticket: data.ticket ?? null });
}

export function listForUser(userId: string, { page, limit }: { page: number; limit: number }) {
  const skip = (page - 1) * limit;
  return Promise.all([
    Notification.find({ user: userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments({ user: userId }),
  ]);
}

export function countUnread(userId: string) {
  return Notification.countDocuments({ user: userId, read: false });
}

export function markRead(id: string, userId: string) {
  // Scoped to the requesting user - one user can never mark another's
  // notification read (and there's nothing sensitive to leak by a 404 vs
  // 403 distinction here, so a plain "not found for you" no-op-if-absent
  // is fine, unlike ticket ownership checks elsewhere in this app).
  return Notification.findOneAndUpdate({ _id: id, user: userId }, { read: true }, { returnDocument: "after" });
}

export function markAllRead(userId: string) {
  return Notification.updateMany({ user: userId, read: false }, { read: true });
}
