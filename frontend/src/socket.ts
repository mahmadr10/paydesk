import { io, Socket } from "socket.io-client";
import { SOCKET_URL } from "./config";

// A single shared socket instance for the whole app, created once (not
// re-created on every render/component). We connect manually (autoConnect:
// false) and call connect() ourselves once we actually have a token - a
// logged-out user shouldn't hold an open socket at all.
export const socket: Socket = io(SOCKET_URL, {
  autoConnect: false,
});

export function connectSocket(token: string) {
  // Socket.IO sends this "auth" payload once, at connection time - the
  // backend's io.use() middleware reads it and verifies the JWT before
  // accepting the connection (see backend/src/sockets/index.ts).
  socket.auth = { token };
  socket.connect();
}

export function disconnectSocket() {
  socket.disconnect();
}
