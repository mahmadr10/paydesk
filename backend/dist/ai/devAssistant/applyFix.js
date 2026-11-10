"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyFix = applyFix;
// The ONLY place in this entire feature that writes to a source file - and
// even here, only when a human has explicitly reviewed a diff and clicked
// "Apply" (see controllers/adminController.ts / the frontend's Suggested
// Fix panel). Everything below exists to make that one write as safe as a
// deliberately-triggered, reviewable, auto-verified write CAN be:
//   1. Path validation - can only target real .ts/.tsx application source
//      under backend/src or frontend/src, never this tool's own code,
//      never .env/config/package.json/node_modules.
//   2. Exact-match validation - `oldCode` must appear in the CURRENT file
//      content EXACTLY ONCE. Zero matches (file changed, hallucinated
//      snippet) or multiple matches (ambiguous - which one?) both reject
//      outright rather than guess.
//   3. Apply, then IMMEDIATELY run the real test suite. Tests fail →
//      automatic revert to the original content, nothing durable happens.
//      Tests pass → the change is kept.
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const AppError_1 = require("../../utils/AppError");
const tools_1 = require("./tools");
const REPO_ROOT = path_1.default.join(__dirname, "..", "..", "..", "..");
const ALLOWED_ROOTS = ["backend/src", "frontend/src"].map((d) => path_1.default.join(REPO_ROOT, d));
const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx"]);
function resolveAndValidateTarget(targetFile) {
    // path.resolve collapses ".."/"." segments - this is what makes the
    // "starts with an allowed root" check below actually meaningful instead
    // of trivially bypassable with "../../../etc/whatever".
    const resolved = path_1.default.resolve(REPO_ROOT, targetFile);
    const withinAllowedRoot = ALLOWED_ROOTS.some((root) => resolved === root || resolved.startsWith(root + path_1.default.sep));
    if (!withinAllowedRoot) {
        throw new AppError_1.AppError(400, "INVALID_TARGET_FILE", "Target file must be inside backend/src or frontend/src.");
    }
    if (resolved.includes(`${path_1.default.sep}ai${path_1.default.sep}devAssistant${path_1.default.sep}`)) {
        throw new AppError_1.AppError(400, "INVALID_TARGET_FILE", "The Dev Assistant cannot modify its own implementation.");
    }
    if (!ALLOWED_EXTENSIONS.has(path_1.default.extname(resolved))) {
        throw new AppError_1.AppError(400, "INVALID_TARGET_FILE", "Only .ts/.tsx source files can be targeted.");
    }
    return resolved;
}
async function applyFix(input) {
    const resolvedPath = resolveAndValidateTarget(input.targetFile);
    if (!input.oldCode.trim() || !input.newCode.trim()) {
        throw new AppError_1.AppError(400, "INVALID_FIX", "oldCode and newCode must both be non-empty.");
    }
    const originalContent = await promises_1.default.readFile(resolvedPath, "utf-8").catch(() => {
        throw new AppError_1.AppError(404, "NOT_FOUND", `Target file does not exist: ${input.targetFile}`);
    });
    const occurrences = originalContent.split(input.oldCode).length - 1;
    if (occurrences === 0) {
        throw new AppError_1.AppError(400, "FIX_NOT_APPLICABLE", "The suggested old code no longer matches the current file content exactly - the file may have changed, or the suggestion wasn't precise. Re-run the investigation.");
    }
    if (occurrences > 1) {
        throw new AppError_1.AppError(400, "FIX_AMBIGUOUS", `The suggested old code appears ${occurrences} times in the file - refusing to guess which one. A more specific snippet is needed.`);
    }
    // Refuses to replace almost-the-whole-file - a real, minimal fix touches
    // a small, identifiable region; anything else is more likely a runaway
    // generation than a considered patch.
    if (input.oldCode.length > originalContent.length * 0.8) {
        throw new AppError_1.AppError(400, "FIX_TOO_BROAD", "The suggested change covers most of the file - refusing to apply something this broad automatically.");
    }
    const newContent = originalContent.replace(input.oldCode, input.newCode);
    await promises_1.default.writeFile(resolvedPath, newContent, "utf-8");
    const { passed, summary } = await (0, tools_1.runTestSuiteVerbose)();
    if (!passed) {
        // The auto-rollback: applying a plausible-looking fix that turns out to
        // break something is not a "well, we tried" outcome - the whole point
        // of running tests immediately after applying is to make that
        // recoverable automatically, not left for a human to notice later.
        await promises_1.default.writeFile(resolvedPath, originalContent, "utf-8");
        return { applied: false, testsPassed: false, testSummary: summary };
    }
    return { applied: true, testsPassed: true, testSummary: summary };
}
