import { waitUntil } from "@vercel/functions";
import { logger } from "../observability/logger";

// Runs work AFTER the HTTP response has been sent (for example the AI agents
// that start when a ticket or dispute arrives).
//
// On Vercel a function can be stopped as soon as it has replied, so plain
// "fire and forget" work may never finish. waitUntil() tells Vercel to keep
// the function alive until the work is done. Anywhere else (local dev, Render,
// tests) there is no Vercel context, waitUntil does nothing, and the promise
// simply runs on its own as before.
export function runInBackground(work: Promise<unknown>, label: string): void {
  const safe = work.catch((err) => logger.error({ err }, `${label} failed`));
  try {
    waitUntil(safe);
  } catch {
    // Not running on Vercel: nothing to extend.
  }
}
