// Vite exposes any environment variable prefixed VITE_ to the browser
// bundle via import.meta.env, resolved at BUILD time (not runtime - this is
// baked into the compiled JS, which is why Docker/deployment need to set it
// at image-build time, not just at container-start time). Defaults match
// local development (backend on :4000) so `npm run dev` needs no .env at all.
export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api/v1";
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
