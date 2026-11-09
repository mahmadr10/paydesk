import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Navbar } from "./components/Navbar";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useSocketSync } from "./hooks/useSocketSync";
import { useNotificationSocketSync } from "./hooks/useNotifications";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { CreateTicketPage } from "./pages/CreateTicketPage";
import { MyTicketsPage } from "./pages/MyTicketsPage";
import { TicketQueuePage } from "./pages/TicketQueuePage";
import { TicketDetailPage } from "./pages/TicketDetailPage";
import { ProfilePage } from "./pages/ProfilePage";
import { AssistantPage, MyOrdersPage, SellerDashboardPage, ShopPage } from "./pages/PayDeskPages";

// Charts (recharts) and the admin screens are the heaviest, least-often-hit
// part of the bundle — a customer or agent who never opens Analytics
// shouldn't have to download it. React.lazy + Suspense splits each into
// its own chunk, fetched only the first time its route is actually visited.
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const UsersPage = lazy(() => import("./pages/admin/UsersPage").then((m) => ({ default: m.UsersPage })));
const AnalyticsPage = lazy(() => import("./pages/admin/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })));
const AuditLogsPage = lazy(() => import("./pages/admin/AuditLogsPage").then((m) => ({ default: m.AuditLogsPage })));
const SettingsPage = lazy(() => import("./pages/admin/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const DevAssistantPage = lazy(() => import("./pages/admin/DevAssistantPage").then((m) => ({ default: m.DevAssistantPage })));

function PageFallback() {
  return <p className="mt-8 text-center text-sm text-slate-500">Loading…</p>;
}

// The "home" route ("/") shows a different page per role — a customer's own
// tickets, an agent's queue, or the admin dashboard. One URL, three
// components, decided by who's logged in.
// PayDesk: sellers (agent/admin) land on the co-pilot, buyers on their orders.
function Home() {
  const { user } = useAuth();
  if (user?.role === "AGENT" || user?.role === "ADMIN") return <SellerDashboardPage />;
  return <MyOrdersPage />;
}

function AppRoutes() {
  const { user } = useAuth();
  useSocketSync(); // mounted once, near the root — see hooks/useSocketSync.ts
  useNotificationSocketSync();

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route path="/shop" element={<ProtectedRoute roles={["CUSTOMER"]}><ShopPage /></ProtectedRoute>} />
        <Route path="/orders" element={<ProtectedRoute roles={["CUSTOMER"]}><MyOrdersPage /></ProtectedRoute>} />
        <Route path="/my-tickets" element={<ProtectedRoute roles={["CUSTOMER"]}><MyTicketsPage /></ProtectedRoute>} />
        <Route path="/queue" element={<ProtectedRoute roles={["AGENT", "ADMIN"]}><TicketQueuePage /></ProtectedRoute>} />
        <Route path="/assistant" element={<ProtectedRoute roles={["AGENT", "ADMIN"]}><AssistantPage /></ProtectedRoute>} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute roles={["AGENT", "ADMIN"]}>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tickets/new"
          element={
            <ProtectedRoute roles={["CUSTOMER"]}>
              <CreateTicketPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tickets/:id"
          element={
            <ProtectedRoute>
              <TicketDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/tickets"
          element={
            <ProtectedRoute roles={["ADMIN"]}>
              <TicketQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute roles={["ADMIN"]}>
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/analytics"
          element={
            <ProtectedRoute roles={["ADMIN"]}>
              <AnalyticsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/audit-logs"
          element={
            <ProtectedRoute roles={["ADMIN"]}>
              <AuditLogsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <ProtectedRoute roles={["ADMIN"]}>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/dev-assistant"
          element={
            <ProtectedRoute roles={["ADMIN"]}>
              <DevAssistantPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Navbar />
        <main className="min-h-screen bg-slate-50 px-4 pb-16">
          <AppRoutes />
        </main>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
