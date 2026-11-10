"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Must be the very first import in the process - see the file's own comment
// for why (auto-instrumentation patches modules at require-time).
require("./observability/tracing");
const http_1 = require("http");
const env_1 = require("./config/env");
const db_1 = require("./config/db");
const seed_1 = require("./config/seed");
const sockets_1 = require("./sockets");
const app_1 = require("./app");
const logger_1 = require("./observability/logger");
const slaBreachJob_1 = require("./jobs/slaBreachJob");
async function main() {
    await (0, db_1.connectDB)();
    await (0, seed_1.seedDefaults)();
    const app = (0, app_1.createApp)();
    const httpServer = (0, http_1.createServer)(app);
    (0, sockets_1.initSockets)(httpServer);
    (0, slaBreachJob_1.startSlaBreachJob)();
    httpServer.listen(env_1.env.PORT, () => {
        logger_1.logger.info(`Backend listening on http://localhost:${env_1.env.PORT}`);
    });
}
main().catch((err) => {
    console.error("Fatal startup error:", err); // logger itself may not be safely usable if startup failed this early
    process.exit(1);
});
