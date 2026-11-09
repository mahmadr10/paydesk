import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import type { UserRole } from "../types";

// Wraps a page and only renders it if the user is logged in (and, if
// `roles` is given, has one of the allowed roles). This is a UX
// convenience only - it stops a customer from even SEEING the agent
// queue page, but it is NOT the real security boundary. The real
// boundary is requireAuth/requireRole on the backend, which checks
// every request regardless of what the frontend shows or hides.
export function ProtectedRoute({ children, roles }: { children: ReactNode; roles?: UserRole[] }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
