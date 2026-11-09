import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import routes from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { generalLimiter } from "./middleware/rateLimit";
import { requestLogger } from "./observability/requestLogger";

export function createApp() {
  const app = express();

  // Logging goes FIRST, before anything else touches the request - that
  // way it wraps the entire lifecycle (including time spent in helmet,
  // CORS, rate limiting) and reports the true end-to-end duration.
  app.use(requestLogger);

  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
  app.use(cookieParser());
  app.use(express.json());
  app.use(generalLimiter);

  app.get("/api/health", (_req, res) => {
    res.json({ success: true, message: "ServiceDesk backend is running" });
  });

  app.use("/api/v1", routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
