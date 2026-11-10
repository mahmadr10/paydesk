"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushLogEntry = pushLogEntry;
exports.getRecentLogs = getRecentLogs;
const MAX_ENTRIES = 500;
const buffer = [];
// Real bug this fixes (caught during live verification of the Dev
// Assistant's Log Agent - see BUILD_LOG.md): the Pino `hooks.logMethod`
// runs on the RAW arguments passed to logger.info/error/etc., BEFORE Pino
// applies its own configured serializers (see requestLogger.ts's `req`/`res`
// serializers) - those only run at actual output-serialization time. So a
// request-completion log's raw merging object still had real Express
// `req`/`res` objects attached, which are circular (`res.req` -> `req` ->
// ... -> `res`), and a later `JSON.stringify` on a stored entry (to search
// it) threw "Converting circular structure to JSON" and crashed the caller.
// This sanitizes at STORE time, once, so every stored entry is guaranteed
// JSON-safe forever after - searching never needs to know this history.
function safeStringify(value) {
    const seen = new WeakSet();
    return JSON.stringify(value, (_key, val) => {
        if (typeof val === "object" && val !== null) {
            if (seen.has(val))
                return "[Circular]";
            seen.add(val);
        }
        return val;
    });
}
function pushLogEntry(entry) {
    let safe;
    try {
        safe = JSON.parse(safeStringify(entry));
    }
    catch {
        safe = { time: entry.time, level: entry.level, msg: entry.msg }; // last resort: keep at least the basics
    }
    buffer.push(safe);
    if (buffer.length > MAX_ENTRIES)
        buffer.shift();
}
function getRecentLogs(query, limit = 30) {
    const pool = query
        ? buffer.filter((e) => JSON.stringify(e).toLowerCase().includes(query.toLowerCase()))
        : buffer;
    return pool.slice(-limit);
}
