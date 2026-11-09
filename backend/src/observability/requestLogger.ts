import pinoHttp from "pino-http";
import crypto from "crypto";
import { logger } from "./logger";

// pino-http wraps every request in a log line with the fields the spec
// asks for: timestamp, level, requestId, method, route, statusCode,
// duration - automatically, plus we attach userId ourselves once
// requireAuth has run (see customProps below). One log line per request,
// not one per println - that's what keeps a busy server's logs readable.
export const requestLogger = pinoHttp({
  logger,
  // A random id per request, exposed as req.id - this is what lets you
  // grep logs for one specific request, and what the error response's
  // "requestId" field (see middleware/errorHandler.ts) points back to.
  genReqId: (req, res) => {
    const existing = req.headers["x-request-id"];
    const id = (Array.isArray(existing) ? existing[0] : existing) || crypto.randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
  customProps: (req) => ({
    userId: (req as any).user?.userId ?? null,
  }),
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  // Keep noisy, low-value request/response detail out of every line - we
  // already get method/url/statusCode/responseTime from pino-http's
  // defaults, we don't need full headers dumped on every request too.
  serializers: {
    req: (req) => ({ method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
