import express, { Request, Response, NextFunction } from "express";
import cors, { CorsOptions } from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import { env, isProduction } from "./config/env";
import routes from "./routes";
import cronRoutes from "./routes/cronRoutes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { generalLimiter } from "./middleware/rateLimit";
import { requestLogger } from "./observability/requestLogger";
import { connectDB } from "./config/db";
import { seedDefaults } from "./config/seed";

let initPromise: Promise<void> | null = null;

async function ensureInitialized() {
  if (mongoose.connection.readyState >= 1) {
    return;
  }
  if (!initPromise) {
    initPromise = (async () => {
      await connectDB();
      await seedDefaults();
    })();
  }
  await initPromise;
}

export function createApp() {
  const app = express();

  // Trust proxy headers (e.g. Vercel, Render reverse proxies) so express-rate-limit
  // and req.ip use the real client IP instead of the edge proxy IP.
  app.set("trust proxy", 1);

  // Logging goes FIRST, before anything else touches the request
  app.use(requestLogger);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  // Parse comma-separated origins from FRONTEND_ORIGIN (e.g. "https://app.vercel.app,http://localhost:5173")
  // Strip trailing slashes so comparisons with browser Origin headers (which never have trailing slashes) succeed.
  const configuredOrigins = env.FRONTEND_ORIGIN.split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, server-to-server, curl, Postman)
      if (!origin) return callback(null, true);

      const normalizedOrigin = origin.trim().replace(/\/+$/, "");

      // 1. Allow all if wildcard configured
      if (configuredOrigins.includes("*")) {
        return callback(null, true);
      }

      // 2. Allow if explicitly matched in FRONTEND_ORIGIN
      if (configuredOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      // 3. Automatically allow all Vercel deployments (*.vercel.app)
      if (normalizedOrigin.endsWith(".vercel.app") || normalizedOrigin === "https://vercel.app") {
        return callback(null, true);
      }

      // 4. Allow localhost in development
      if (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedOrigin)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Cookie"],
    exposedHeaders: ["Set-Cookie"],
    optionsSuccessStatus: 200,
  };

  app.use(cors(corsOptions));
  app.use(cookieParser());
  app.use(express.json());

  // Ensure database and initial defaults are loaded (especially for serverless cold starts)
  app.use(async (req: Request, _res: Response, next: NextFunction) => {
    // Skip DB connection wait for raw root ping if disconnected to allow fast diagnostics
    if (req.path === "/" && mongoose.connection.readyState === 0) {
      return next();
    }
    try {
      await ensureInitialized();
      next();
    } catch (err) {
      initPromise = null;
      next(err);
    }
  });

  app.use(generalLimiter);

  // Health and root diagnostics
  app.get("/", (_req, res) => {
    res.json({
      success: true,
      message: "PayDesk API is running",
      database: mongoose.connection.readyState >= 1 ? "connected" : "disconnected",
      timestamp: new Date().toISOString(),
    });
  });

  const healthHandler = (_req: Request, res: Response) => {
    res.json({
      success: true,
      message: "PayDesk backend is running",
      database: mongoose.connection.readyState >= 1 ? "connected" : "disconnected",
      uptime: process.uptime(),
    });
  };

  app.get("/health", healthHandler);
  app.get("/api/health", healthHandler);

  // Cron jobs (e.g. Vercel Cron)
  app.use("/api/cron", cronRoutes);
  app.use("/cron", cronRoutes);

  // Main API routes
  app.use("/api/v1", routes);
  app.use("/v1", routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
