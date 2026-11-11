"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInBackground = runInBackground;
const functions_1 = require("@vercel/functions");
const logger_1 = require("../observability/logger");
// Runs work AFTER the HTTP response has been sent (for example the AI agents
// that start when a ticket or dispute arrives).
//
// On Vercel a function can be stopped as soon as it has replied, so plain
// "fire and forget" work may never finish. waitUntil() tells Vercel to keep
// the function alive until the work is done. Anywhere else (local dev, Render,
// tests) there is no Vercel context, waitUntil does nothing, and the promise
// simply runs on its own as before.
function runInBackground(work, label) {
    const safe = work.catch((err) => logger_1.logger.error({ err }, `${label} failed`));
    try {
        (0, functions_1.waitUntil)(safe);
    }
    catch {
        // Not running on Vercel: nothing to extend.
    }
}
