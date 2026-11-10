"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSockets = initSockets;
const socket_io_1 = require("socket.io");
const jwt_1 = require("../utils/jwt");
const io_1 = require("./io");
function initSockets(httpServer) {
    const io = new socket_io_1.Server(httpServer, {
        cors: { origin: true, credentials: true },
    });
    // Same JWT the REST API uses, sent once at connection time and verified
    // with the SAME access-token secret/verifier as requireAuth - one
    // definition of "is this token valid," reused everywhere.
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token)
            return next(new Error("Missing auth token"));
        try {
            const payload = (0, jwt_1.verifyAccessToken)(token);
            socket.data.userId = payload.userId;
            socket.data.role = payload.role;
            next();
        }
        catch {
            next(new Error("Invalid or expired token"));
        }
    });
    io.on("connection", (socket) => {
        const userId = socket.data.userId;
        const role = socket.data.role;
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
    (0, io_1.setIO)(io);
    return io;
}
