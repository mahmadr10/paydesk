import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { NotificationBell } from "./NotificationBell";

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="text-slate-600 hover:text-slate-900">
      {children}
    </Link>
  );
}

export function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isSeller = user?.role === "AGENT" || user?.role === "ADMIN";

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-6 py-3">
      <Link to="/" className="flex items-center gap-2 text-lg font-bold text-slate-800">
        <span className="rounded-lg bg-gradient-to-br from-indigo-600 to-sky-500 px-2 py-0.5 text-white">P</span>
        PayDesk
        <span className="hidden text-xs font-normal text-slate-400 sm:inline">AI co-pilot for PayPal sellers</span>
      </Link>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {user?.role === "CUSTOMER" && (
          <>
            <NavLink to="/shop">Shop</NavLink>
            <NavLink to="/orders">My orders</NavLink>
            <NavLink to="/my-tickets">My cases</NavLink>
          </>
        )}
        {isSeller && (
          <>
            <NavLink to="/">Co-pilot</NavLink>
            <NavLink to="/queue">All cases</NavLink>
            <NavLink to="/assistant">Ask PayPal</NavLink>
          </>
        )}
        {user?.role === "ADMIN" && (
          <>
            <NavLink to="/admin/audit-logs">Audit log</NavLink>
            <NavLink to="/admin/users">Team</NavLink>
          </>
        )}
        {user && <NotificationBell />}
        {user && (
          <>
            <span className="text-slate-400">
              {user.name} · {isSeller ? "Seller" : "Buyer"}
            </span>
            <button onClick={handleLogout} className="rounded bg-slate-100 px-3 py-1.5 text-slate-700 hover:bg-slate-200">
              Log out
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
