"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = setup;
const mongodb_memory_server_1 = require("mongodb-memory-server");
// This is Vitest's "globalSetup" hook - code that runs exactly once before
// ANY test file is imported, in time to set environment variables the rest
// of the app depends on. We start a real (but temporary, in-memory) MongoDB
// server here instead of mocking the database, so integration tests
// exercise the actual Mongoose queries/indexes/validation, not a fake.
async function setup() {
    // Generous timeout: the first launch on Windows can be slow while the
    // antivirus scans the freshly downloaded mongod binary.
    const mongod = await mongodb_memory_server_1.MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    process.env.NODE_ENV = "test";
    process.env.MONGODB_URI = mongod.getUri("servicedesk_test");
    process.env.JWT_ACCESS_SECRET = "test-only-secret-do-not-use-in-production";
    process.env.FRONTEND_ORIGIN = "http://localhost:5173";
    process.env.LOG_LEVEL = "silent"; // the per-request log lines are real signal in dev/prod, just noise in a test run's console output
    // Force the AI feature's mock fallback regardless of whether a real
    // GROQ_API_KEY happens to be sitting in a developer's local .env - the
    // integration suite is testing the STAFF-ONLY authorization and the
    // response shape, not live LLM output, and it needs to behave identically
    // here and in CI (which genuinely has no key) rather than silently
    // depending on whoever's machine happens to run it.
    process.env.AI_ENABLED = "false";
    // The returned function is Vitest's teardown - runs once after the whole
    // test run finishes, so the in-memory server's process is cleaned up
    // instead of lingering.
    return async () => {
        await mongod.stop();
    };
}
