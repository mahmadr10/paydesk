import { useEffect } from "react";
import type { Ticket } from "../types";
import { socket } from "../socket";
import { queryClient } from "../queryClient";

// One centralized place that listens for server-pushed events and tells
// TanStack Query which cached data is now stale - instead of every page
// having its own socket.on/off pair (as the earlier build did). Mounted
// once, near the root, whenever a user is logged in.
//
// Avoiding duplicate/ghost updates: this effect's cleanup (`return () =>
// socket.off(...)`) removes the exact same handler reference it registered.
// Because this hook is mounted exactly once (not once per page), the
// listener is never registered more than once in the first place - the
// bug class the earlier per-page version had to guard against structurally
// can't happen here.
export function useSocketSync() {
  useEffect(() => {
    function handleTicketUpdated(ticket: Ticket) {
      // Invalidate the specific ticket (detail view) and every ticket LIST
      // query (queue, my-tickets, admin tickets - they all share the
      // "tickets" key prefix) plus the dashboard, since a status change
      // shifts the summary counts too.
      queryClient.invalidateQueries({ queryKey: ["ticket", ticket._id] });
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }
    function handleTicketCreated() {
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }

    socket.on("ticket:updated", handleTicketUpdated);
    socket.on("ticket:created", handleTicketCreated);
    return () => {
      socket.off("ticket:updated", handleTicketUpdated);
      socket.off("ticket:created", handleTicketCreated);
    };
  }, []);
}
