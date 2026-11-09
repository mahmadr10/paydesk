import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import { verifyAccessToken } from "../utils/jwt";
import { env } from "../config/env";
import { setIO } from "./io";

export function initSockets(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.FRONTEND_ORIGIN, credentials: true },
  });

  // Same JWT the REST API uses, sent once at connection time and verified
  // with the SAME access-token secret/verifier as requireAuth - one
  // definition of "is this token valid," reused everywhere.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Missing auth token"));
    try {
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.userId;
      socket.data.role = payload.role;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    const role = socket.data.role as string;

    socket.join(`user:${userId}`);
    // Agents and admins additionally join a shared "agents" room - this is
    // what makes the Ticket Queue and cross-agent reassignment updates
    // live, on top of the per-customer updates the earlier build had.
    if (role === "AGENT" || role === "ADMIN") {
      socket.join("agents");
    }

    // Nothing to clean up on disconnect - Socket.IO removes the socket from
    // all its rooms automatically, and a reconnect (e.g. page refresh)
    // creates a brand new socket that joins fresh. That's what prevents
    // "ghost" duplicate listeners from accumulating across reconnects.
  });

  setIO(io);
  return io;
}
