"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
const env_1 = require("../config/env");
const logBuffer_1 = require("./logBuffer");
// One shared, structured logger for the whole backend. "Structured" means
// every log line is a JSON object with consistent fields (timestamp,
// level, message, plus whatever context we attach) - not free-form text.
// That's what makes logs actually SEARCHABLE in a real deployment (e.g.
// "show me every error for userId X in the last hour") instead of just
// scrollback you read with your eyes.
//
// In development we pipe through pino-pretty for a human-readable
// colorized line-by-line view; in production we emit raw JSON (what a log
// aggregator like Datadog/CloudWatch/Grafana Loki actually wants).
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
exports.logger = (0, pino_1.default)({
    level: process.env.LOG_LEVEL || "info",
    redact: {
        // Defense in depth: even if a future call accidentally logs a full
        // request body or headers object, these specific paths are scrubbed to
        // "[Redacted]" rather than ever reaching a log file or log aggregator.
        paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.passwordHash", "*.token"],
        censor: "[Redacted]",
    },
    // Mirrors every log call into the in-memory ring buffer (logBuffer.ts) -
    // runs BEFORE serialization/output, so it works the same whether we're
    // pretty-printing to the console (dev) or emitting raw JSON (prod), and
    // regardless of `transport` config. try/catch because a bug in the buffer
    // must never be the thing that breaks actual application logging.
    hooks: {
        logMethod(inputArgs, method, level) {
            try {
                const [first, second] = inputArgs;
                const mergingObject = typeof first === "object" && first !== null ? first : {};
                const msg = typeof first === "string" ? first : typeof second === "string" ? second : "";
                (0, logBuffer_1.pushLogEntry)({ time: Date.now(), level, msg, ...mergingObject });
            }
            catch {
                // never let buffering itself break logging
            }
            return method.apply(this, inputArgs);
        },
    },
    transport: env_1.isProduction || isServerless
        ? undefined
        : {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
});
