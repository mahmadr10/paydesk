import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "../types";
import { loginRequest, registerRequest, logoutRequest, silentRefresh } from "../api/auth";
import { registerAuthFailureHandler, setAccessToken, getAccessToken } from "../api/client";
import { connectSocket, disconnectSocket } from "../socket";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; password: string; role: "CUSTOMER" | "AGENT" }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function connectSocketIfPossible() {
  const token = getAccessToken();
  if (token) connectSocket(token);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On first load there's no access token in memory yet (a page refresh
  // wipes it - see api/client.ts) - but if the httpOnly refresh cookie is
  // still valid, this silently exchanges it for a new one, restoring the
  // session with no password re-entry and no token ever touching
  // localStorage.
  useEffect(() => {
    silentRefresh()
      .then(({ user: refreshedUser }) => {
        setUser(refreshedUser);
        connectSocketIfPossible();
      })
      .catch(() => {
        // No valid refresh cookie (never logged in, or it expired) - a
        // normal, expected outcome, not an error to surface.
      })
      .finally(() => setLoading(false));

    // If any API call's silent-refresh-and-retry also fails (the refresh
    // token itself expired/was revoked), the client tells us to fully log
    // out rather than leaving the UI in a broken half-logged-in state.
    registerAuthFailureHandler(() => {
      setUser(null);
      disconnectSocket();
    });
  }, []);

  async function login(email: string, password: string) {
    const loggedInUser = await loginRequest({ email, password });
    setUser(loggedInUser);
    connectSocketIfPossible();
  }

  async function register(input: { name: string; email: string; password: string; role: "CUSTOMER" | "AGENT" }) {
    const registeredUser = await registerRequest(input);
    setUser(registeredUser);
    connectSocketIfPossible();
  }

  async function logout() {
    await logoutRequest().catch(() => {});
    setAccessToken(null);
    setUser(null);
    disconnectSocket();
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
