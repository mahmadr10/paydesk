"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = void 0;
const pino_http_1 = __importDefault(require("pino-http"));
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("./logger");
// pino-http wraps every request in a log line with the fields the spec
// asks for: timestamp, level, requestId, method, route, statusCode,
// duration - automatically, plus we attach userId ourselves once
// requireAuth has run (see customProps below). One log line per request,
// not one per println - that's what keeps a busy server's logs readable.
exports.requestLogger = (0, pino_http_1.default)({
    logger: logger_1.logger,
    // A random id per request, exposed as req.id - this is what lets you
    // grep logs for one specific request, and what the error response's
    // "requestId" field (see middleware/errorHandler.ts) points back to.
    genReqId: (req, res) => {
        const existing = req.headers["x-request-id"];
        const id = (Array.isArray(existing) ? existing[0] : existing) || crypto_1.default.randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
    },
    customProps: (req) => ({
        userId: req.user?.userId ?? null,
    }),
    customLogLevel: (_req, res, err) => {
        if (res.statusCode >= 500 || err)
            return "error";
        if (res.statusCode >= 400)
            return "warn";
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
