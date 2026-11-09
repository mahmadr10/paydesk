import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vitest (via Vite) auto-loads a ".env" file and injects it into
  // process.env before tests run - great for a real app, but it means a
  // developer's real backend/.env (with a real Mongo URI, real secrets)
  // would leak into test runs and fight with the in-memory test database
  // globalSetup configures below. Tests should be hermetic - their
  // environment should come from globalSetup ONLY, never from whatever
  // happens to be sitting in a developer's local .env.
  envDir: false,
  test: {
    // globalSetup runs ONCE, before any test file is loaded, in time to
    // start an in-memory MongoDB and set process.env.MONGODB_URI before
    // config/env.ts (imported transitively by nearly everything) parses
    // process.env. Without this, integration tests would need a real
    // database just to import the app.
    globalSetup: "./src/test/globalSetup.ts",
    testTimeout: 20000,
    // All files share one test database and each drops it when done, so
    // run files one after another (tests inside a file still run in order).
    fileParallelism: false,
  },
});
