import { defineConfig, devices } from "@playwright/test";

// The one mandatory E2E workflow the spec asks for: login → create ticket
// → agent login → assign → update status → resolve → customer closes.
// Playwright drives a REAL browser against the REAL running app (both
// servers below), so this is the closest thing to "does the whole system
// actually work" - as opposed to unit tests (one function) or integration
// tests (one API call at a time, no browser/UI involved at all).
//
// Ports 4001/5175 (not the usual 4000/5173) are deliberate - dedicated
// ports nothing else on the machine would already be using, so Playwright
// can never accidentally attach to an unrelated already-running server
// (which is exactly what happened during development here: another
// project's dev server was already on 5173).
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // the flow tests share ticket state across steps - parallel workers would race each other
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "html",
  // Default per-test timeout (30s) is tuned for FULL SPEED runs - with
  // SLOWMO on, a single test's handful of actions (register() alone does
  // 6: goto, 3 fills, a select, a click) can burn through 30s of pure
  // artificial delay before the page even finishes loading, failing the
  // test on a timeout that has nothing to do with the app actually working
  // (hit this for real - see BUILD_LOG.md). Generous 5-minute budget
  // whenever SLOWMO is set; untouched (30s) otherwise.
  timeout: process.env.SLOWMO ? 300_000 : 30_000,
  use: {
    baseURL: "http://localhost:5175",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Demo mode: `SLOWMO=5000 npx playwright test --headed` adds a pause
    // (in ms) between every single Playwright action - a click, a fill, a
    // navigation - so a human watching (e.g. presenting to a reviewer) can
    // actually follow what's happening and narrate over it, instead of the
    // whole 4-test flow finishing in under a minute. Opt-in only: unset
    // (the normal/CI case) runs at full speed, no pause.
    launchOptions: {
      slowMo: process.env.SLOWMO ? Number(process.env.SLOWMO) : undefined,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      command: "node scripts/startBackendForE2E.cjs",
      url: "http://localhost:4001/api/health",
      // 90s, not 60s - mongodb-memory-server's cold start (first launch
      // after a while, antivirus scanning the cached mongod binary, etc.)
      // has been observed taking longer than 60s on this machine; 60s was
      // cutting it close enough to occasionally time out for no real reason.
      timeout: 90_000,
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 5175 --strictPort",
      cwd: "../frontend",
      url: "http://localhost:5175",
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        VITE_API_URL: "http://localhost:4001/api/v1",
        VITE_SOCKET_URL: "http://localhost:4001",
      },
    },
  ],
});
