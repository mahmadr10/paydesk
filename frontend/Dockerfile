# ── Stage 1: build ───────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Vite bakes VITE_* env vars into the compiled JS at BUILD time (there's no
# "runtime config" for a static site - the files are just HTML/CSS/JS served
# as-is) - so these must be passed as Docker build args, not regular
# container environment variables set later.
ARG VITE_API_URL=http://localhost:4000/api/v1
ARG VITE_SOCKET_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL

RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────────────────
# nginx serves the static files directly - no Node.js needed at all to run
# a built React app, which is what keeps this final image tiny (~25MB vs
# hundreds of MB for a Node-based static server).
FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
