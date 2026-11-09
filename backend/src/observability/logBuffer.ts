// An in-memory ring buffer of recent log lines - what gives the AI Dev
// Assistant's Log Agent (see ai/devAssistant/) something REAL to search,
// without standing up a log file / log aggregator just for this. Capped at
// a fixed size so a busy server can't leak memory here; oldest entries
// silently fall off once full. Process-local and lost on restart - this is
// a debugging convenience, not a durable audit trail (that's AuditLog, a
// real Mongo collection, for actual state-changing actions).
export interface LogEntry {
  time: number;
  level: number;
  msg: string;
  [key: string]: unknown;
}

const MAX_ENTRIES = 500;
const buffer: LogEntry[] = [];

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
function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    return val;
  });
}

export function pushLogEntry(entry: LogEntry) {
  let safe: LogEntry;
  try {
    safe = JSON.parse(safeStringify(entry));
  } catch {
    safe = { time: entry.time, level: entry.level, msg: entry.msg }; // last resort: keep at least the basics
  }
  buffer.push(safe);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

export function getRecentLogs(query?: string, limit = 30): LogEntry[] {
  const pool = query
    ? buffer.filter((e) => JSON.stringify(e).toLowerCase().includes(query.toLowerCase()))
    : buffer;
  return pool.slice(-limit);
}
