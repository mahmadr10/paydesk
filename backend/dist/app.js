"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const mongoose_1 = __importDefault(require("mongoose"));
const routes_1 = __importDefault(require("./routes"));
const cronRoutes_1 = __importDefault(require("./routes/cronRoutes"));
const errorHandler_1 = require("./middleware/errorHandler");
const rateLimit_1 = require("./middleware/rateLimit");
const requestLogger_1 = require("./observability/requestLogger");
const db_1 = require("./config/db");
const seed_1 = require("./config/seed");
let initPromise = null;
async function ensureInitialized() {
    if (mongoose_1.default.connection.readyState >= 1) {
        return;
    }
    if (!initPromise) {
        initPromise = (async () => {
            await (0, db_1.connectDB)();
            await (0, seed_1.seedDefaults)();
        })();
    }
    await initPromise;
}
function createApp() {
    const app = (0, express_1.default)();
    // Trust proxy headers (e.g. Vercel, Render reverse proxies) so express-rate-limit
    // and req.ip use the real client IP instead of the edge proxy IP.
    app.set("trust proxy", 1);
    // Logging goes FIRST, before anything else touches the request
    app.use(requestLogger_1.requestLogger);
    app.use((0, helmet_1.default)({
        crossOriginResourcePolicy: false,
    }));
    // Allow from all origins by dynamically reflecting the request origin (supports credentials / cookies)
    const corsOptions = {
        origin: true,
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Cookie"],
        exposedHeaders: ["Set-Cookie"],
        optionsSuccessStatus: 200,
    };
    app.use((0, cors_1.default)(corsOptions));
    app.use((0, cookie_parser_1.default)());
    app.use(express_1.default.json());
    // Ensure database and initial defaults are loaded (especially for serverless cold starts)
    app.use(async (req, _res, next) => {
        // Skip DB connection wait for raw root ping if disconnected to allow fast diagnostics
        if (req.path === "/" && mongoose_1.default.connection.readyState === 0) {
            return next();
        }
        try {
            await ensureInitialized();
            next();
        }
        catch (err) {
            initPromise = null;
            next(err);
        }
    });
    app.use(rateLimit_1.generalLimiter);
    // Health and root diagnostics
    app.get("/", (_req, res) => {
        res.json({
            success: true,
            message: "PayDesk API is running",
            database: mongoose_1.default.connection.readyState >= 1 ? "connected" : "disconnected",
            timestamp: new Date().toISOString(),
        });
    });
    const healthHandler = (_req, res) => {
        res.json({
            success: true,
            message: "PayDesk backend is running",
            database: mongoose_1.default.connection.readyState >= 1 ? "connected" : "disconnected",
            uptime: process.uptime(),
        });
    };
    app.get("/health", healthHandler);
    app.get("/api/health", healthHandler);
    // Gracefully respond to Socket.IO polling in serverless environments (avoids console 404 noise)
    app.all("/socket.io*", (_req, res) => {
        res.status(200).json({ success: true, message: "Socket.IO real-time is disabled in serverless mode" });
    });
    // Cron jobs (e.g. Vercel Cron)
    app.use("/api/cron", cronRoutes_1.default);
    app.use("/cron", cronRoutes_1.default);
    // Main API routes
    app.use("/api/v1", routes_1.default);
    app.use("/v1", routes_1.default);
    app.use(errorHandler_1.notFoundHandler);
    app.use(errorHandler_1.errorHandler);
    return app;
}
