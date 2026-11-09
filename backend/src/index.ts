// Must be the very first import in the process - see the file's own comment
// for why (auto-instrumentation patches modules at require-time).
import "./observability/tracing";

import { createServer } from "http";
import { env } from "./config/env";
import { connectDB } from "./config/db";
import { seedDefaults } from "./config/seed";
import { initSockets } from "./sockets";
import { createApp } from "./app";
import { logger } from "./observability/logger";
import { startSlaBreachJob } from "./jobs/slaBreachJob";

async function main() {
  await connectDB();
  await seedDefaults();

  const app = createApp();
  const httpServer = createServer(app);
  initSockets(httpServer);
  startSlaBreachJob();

  httpServer.listen(env.PORT, () => {
    logger.info(`Backend listening on http://localhost:${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err); // logger itself may not be safely usable if startup failed this early
  process.exit(1);
});
