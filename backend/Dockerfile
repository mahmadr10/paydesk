# ── Stage 1: build ───────────────────────────────────────────────────────
# Needs the full devDependencies (typescript, @types/*) to compile - this
# stage's output (dist/) is copied into the final image, but the stage
# itself (and its ~300MB of devDependencies) is discarded.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────────────────
# A fresh, minimal image with ONLY production dependencies and the compiled
# JS - no TypeScript compiler, no source files, no test files ship here.
# This is what keeps the final image small and reduces attack surface (dev
# tooling that isn't in the image can't be exploited in the image).
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# Uploaded ticket attachments live here - mounted as a volume in
# docker-compose.yml so they survive a container restart/rebuild.
RUN mkdir -p /app/uploads

# Runs as a non-root user - if the process is ever compromised, it doesn't
# have root inside the container. "node" is a built-in user on this image.
USER node

EXPOSE 4000
CMD ["node", "dist/index.js"]
