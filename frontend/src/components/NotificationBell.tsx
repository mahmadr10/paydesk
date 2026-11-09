import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications, useUnreadCount } from "../hooks/useNotifications";

// Every notification today comes from the SLA breach background job
// (jobs/slaBreachJob.ts) - the shape is generic (Notification model isn't
// SLA-specific), this component just renders whatever's there.
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data: unreadCount } = useUnreadCount();
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const navigate = useNavigate();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded p-1.5 text-slate-500 hover:bg-slate-100"
        aria-label="Notifications"
      >
        🔔
        {!!unreadCount && unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-80 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-xs font-semibold text-slate-600">Notifications</span>
            {!!unreadCount && unreadCount > 0 && (
              <button onClick={() => markAllRead.mutate()} className="text-xs text-blue-600 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {(!data || data.notifications.length === 0) && <p className="p-3 text-xs text-slate-400">No notifications yet.</p>}
            {data?.notifications.map((n) => (
              <button
                key={n._id}
                onClick={() => {
                  if (!n.read) markRead.mutate(n._id);
                  if (n.ticket) navigate(`/tickets/${n.ticket}`);
                  setOpen(false);
                }}
                className={`block w-full border-b border-slate-50 px-3 py-2 text-left text-xs last:border-0 hover:bg-slate-50 ${
                  n.read ? "text-slate-400" : "font-medium text-slate-700"
                }`}
              >
                {!n.read && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500" />}
                {n.message}
                <span className="mt-0.5 block text-[10px] font-normal text-slate-400">
                  {new Date(n.createdAt).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
