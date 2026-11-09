// Every tool here is READ-ONLY, by construction - there is no write/apply/
// patch tool in this file, and the graph (orchestratorGraph.ts) never
// exposes one to the LLM. That's a deliberate, structural safety boundary,
// not just a prompt instruction an LLM could be talked out of: the Dev
// Assistant can investigate and recommend, a human applies any fix. See
// ARCHITECTURE.md's AI Dev Assistant section and DECISIONS.md for why.
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { getRecentLogs } from "../../observability/logBuffer";

const execFileAsync = promisify(execFile);

// backend/src/ai/devAssistant/tools.ts -> repo root is 4 levels up.
const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");
const SEARCHABLE_DIRS = ["backend/src", "frontend/src"];
const SEARCHABLE_EXTENSIONS = new Set([".ts", ".tsx"]);
const MAX_MATCHES = 15;

// Shared by both the real graph and the mock fallback - a natural-language
// question like "Where is authentication implemented in this codebase?"
// isn't a search string, it's a question ABOUT one. This strips filler
// words and keeps the handful that actually carry meaning (longest-first,
// since "authentication" is a far better search term than "this").
//
// Bug this fixes (found during live verification, not assumed away): the
// first version passed the WHOLE cleaned phrase to searchRepo as one
// literal substring - "authentication implemented codebase" never appears
// verbatim anywhere, so a real, answerable question (there absolutely IS
// auth code in this repo) came back "no matches" every time. Search tools
// now take a LIST of keywords and match ANY of them (OR), not one exact
// phrase (AND-as-a-single-string).
const STOPWORDS = new Set([
  "why", "are", "is", "the", "a", "an", "do", "does", "sometimes", "occasionally", "when", "how", "what",
  "in", "on", "of", "to", "and", "or", "where", "this", "these", "those", "it", "its", "there", "here",
  "codebase", "code", "implemented", "implementation",
]);

// Real code rarely spells out the same word a question would use ("Where is
// AUTHENTICATION implemented" - but the file is auth.ts, using "JWT",
// "login", "token"). A general semantic/embedding search would solve this
// properly; that's real added complexity for a bonus feature. This is the
// honest, bounded middle ground instead - a small synonym table for the
// vocabulary THIS specific codebase actually uses, expanding a question's
// keyword into terms the code is more likely to literally contain. Found
// necessary by testing a real question ("where is authentication
// implemented") and watching it come back empty against real code that
// obviously does implement authentication - see BUILD_LOG.md.
const SYNONYMS: Record<string, string[]> = {
  authentication: ["auth", "login", "jwt", "token"],
  authorization: ["auth", "role", "permission", "requirerole"],
  duplicate: ["duplicated", "duplication", "twice"],
  duplicated: ["duplicate", "duplication", "twice"],
  realtime: ["socket", "websocket"],
  websocket: ["socket", "realtime"],
  status: ["transition", "state"],
  priority: ["sla"],
  assignment: ["assign", "assigned"],
  notification: ["emit", "socket"],
};

export function extractSearchKeywords(question: string, max = 4): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const base = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, max);
  const expanded = base.flatMap((w) => [w, ...(SYNONYMS[w] ?? [])]);
  return [...new Set(expanded)];
}

// --- Repo search: plain-text/regex search across our own source, without
// depending on `grep`/`ripgrep` being installed - this walks the tree in
// pure Node so it works identically on every OS and inside a minimal
// Docker image with no shell utilities at all. ---
// Real bug this scoring fixes, found in live testing (see BUILD_LOG.md):
// the original version stopped at the first MAX_MATCHES lines found,
// walking directories in filesystem order. A question mentioning a
// specific function name ALSO naturally contains generic words ("function",
// "returns", "expected") - and because those generic words match constantly
// throughout a codebase, the match cap filled up with noise from files
// earlier in the walk order, before ever reaching the file the SPECIFIC
// keyword (the actual identifier) would have found. Fixed by scoring every
// candidate line by the combined LENGTH of the keywords it matches (a
// longer, rarer keyword like a specific identifier outweighs several
// matches of a short, generic word) and keeping the highest-scoring lines,
// not just the first ones encountered.
const MAX_SCAN_MATCHES = 500; // safety cap on total candidates scored, not the final result size

export async function searchRepo(keywords: string[]): Promise<string> {
  if (!keywords.length) return "No meaningful search keywords could be extracted from the question.";
  const escaped = keywords.map((k) => ({ length: k.length, re: new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") }));

  // Score = sum of the LENGTHS of every distinct keyword that matches this
  // line - not just a count of how many matched. A line matching one long,
  // specific keyword (an actual identifier) outscores several matches of a
  // short, generic word; a line matching multiple keywords scores highest
  // of all, since that's the strongest signal it's actually relevant.
  function scoreLine(line: string): number {
    let score = 0;
    for (const { re, length } of escaped) {
      re.lastIndex = 0;
      if (re.test(line)) score += length;
    }
    return score;
  }

  const candidates: { line: string; score: number }[] = [];

  async function walk(dir: string) {
    if (candidates.length >= MAX_SCAN_MATCHES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // directory doesn't exist in this environment - skip, don't crash
    }
    for (const entry of entries) {
      if (candidates.length >= MAX_SCAN_MATCHES) return;
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      // Excludes the Dev Assistant's OWN implementation - its comments are
      // dense with exactly the vocabulary ("authentication", "duplicate",
      // "search") a real question would use, which crowded out actual
      // application code within the match cap during live testing (see
      // BUILD_LOG.md). Asking "where is X implemented" should point at
      // application code, not this tool's internal notes about itself.
      if (full.includes(`${path.sep}ai${path.sep}devAssistant${path.sep}`)) continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else if (SEARCHABLE_EXTENSIONS.has(path.extname(entry.name))) {
        const content = await fs.readFile(full, "utf-8").catch(() => "");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length && candidates.length < MAX_SCAN_MATCHES; i++) {
          const score = scoreLine(lines[i]);
          if (score > 0) {
            candidates.push({ line: `${path.relative(REPO_ROOT, full)}:${i + 1}: ${lines[i].trim().slice(0, 160)}`, score });
          }
        }
      }
    }
  }

  for (const dir of SEARCHABLE_DIRS) await walk(path.join(REPO_ROOT, dir));

  const top = candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHES)
    .map((c) => c.line);

  return top.length ? top.join("\n") : `No matches for [${keywords.join(", ")}] in backend/src or frontend/src.`;
}

// --- Git history: best-effort. A deployed backend image typically ships
// only compiled dist/ + node_modules (see backend/Dockerfile) - no .git
// directory, often no `git` binary either - so this degrades to a clear
// "unavailable" message rather than throwing, exactly like the AI feature's
// own no-API-key fallback degrades instead of erroring. ---
export async function getRecentGitLog(count = 10): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["log", `-n${count}`, "--oneline"], { cwd: REPO_ROOT, timeout: 5000 });
    return stdout.trim() || "No commits found.";
  } catch {
    return "Git history unavailable in this environment (no .git directory or no `git` binary on PATH - expected in a deployed container).";
  }
}

export async function getUncommittedDiff(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--stat"], { cwd: REPO_ROOT, timeout: 5000 });
    return stdout.trim() || "No uncommitted changes.";
  } catch {
    return "Git diff unavailable in this environment.";
  }
}

// --- Recent logs: searches the in-memory ring buffer (logBuffer.ts), which
// mirrors every structured log line this process has emitted since it
// started (capped at 500 entries). Matches ANY keyword - same OR-not-AND
// reasoning as searchRepo above. ---
export function searchRecentLogs(keywords: string[]): string {
  if (!keywords.length) return "No meaningful search keywords could be extracted from the question.";
  const entries = keywords.flatMap((k) => getRecentLogs(k, 10));
  const unique = [...new Map(entries.map((e) => [`${e.time}-${e.msg}`, e])).values()].slice(-20);
  if (!unique.length) return `No recent log lines matched [${keywords.join(", ")}].`;
  return unique.map((e) => `[${new Date(e.time).toISOString()}] ${e.msg}${e.err ? ` - ${JSON.stringify(e.err).slice(0, 200)}` : ""}`).join("\n");
}

// --- Test suite: the ONE tool here with a real side effect (it actually
// runs the backend's Vitest suite), but it's still read-only with respect
// to the CODEBASE - it doesn't write anything, doesn't apply a fix, and its
// own in-memory MongoDB is thrown away when the run ends. Capped with a
// generous timeout since a full run (unit + integration) takes ~10-15s. ---
interface TestRunResult {
  passed: boolean;
  summary: string;
}

// The shared implementation - `npm test` exits non-zero (execFile throws)
// exactly when Vitest found a failure, which is the real, authoritative
// pass/fail signal (not string-matching "FAIL" in the output, which could
// theoretically appear in a passing run's incidental text). Two exported
// wrappers over this: `runTestSuite()` returns just the summary string (the
// Test Agent's existing shape, used for investigation); `runTestSuiteVerbose()`
// returns the structured `{ passed, summary }` the apply-fix flow needs to
// actually decide keep-vs-revert on.
async function runTestSuiteInternal(): Promise<TestRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync("npm", ["test"], {
      cwd: path.join(REPO_ROOT, "backend"),
      timeout: 60_000,
      shell: true,
    });
    const output = stdout + stderr;
    const summaryLine = output.split("\n").find((l) => /Tests\s+\d+/.test(l)) ?? "";
    return { passed: true, summary: summaryLine.trim() || "Tests passed; no summary line parsed." };
  } catch (err) {
    const stdout = (err as { stdout?: string }).stdout ?? "";
    const summaryLine = stdout.split("\n").find((l) => /Tests\s+\d+/.test(l)) ?? "";
    const failures = stdout
      .split("\n")
      .filter((l) => l.includes("FAIL") || l.trim().startsWith("×"))
      .slice(0, 10);
    return {
      passed: false,
      summary: [summaryLine.trim(), ...failures].filter(Boolean).join("\n") || `Test run failed to complete: ${(err as Error).message}`,
    };
  }
}

export async function runTestSuite(): Promise<string> {
  const { summary } = await runTestSuiteInternal();
  return summary;
}

export async function runTestSuiteVerbose(): Promise<TestRunResult> {
  return runTestSuiteInternal();
}
