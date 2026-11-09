import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as notificationsApi from "../api/notifications";
import { socket } from "../socket";
import type { Notification } from "../types";

export function useUnreadCount() {
  return useQuery({ queryKey: ["notifications", "unread-count"], queryFn: notificationsApi.getUnreadCountRequest });
}

export function useNotifications(page = 1) {
  return useQuery({ queryKey: ["notifications", "list", page], queryFn: () => notificationsApi.listNotificationsRequest(page) });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markNotificationReadRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.markAllNotificationsReadRequest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

// Mounted once near the root (same pattern as useSocketSync) - a live
// "notification:new" event means a NEW row exists server-side that no
// query has seen yet, so just invalidate rather than trying to splice the
// payload into the cache by hand.
export function useNotificationSocketSync() {
  const qc = useQueryClient();
  useEffect(() => {
    function handleNew(_notification: Notification) {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    }
    socket.on("notification:new", handleNew);
    return () => {
      socket.off("notification:new", handleNew);
    };
  }, [qc]);
}
