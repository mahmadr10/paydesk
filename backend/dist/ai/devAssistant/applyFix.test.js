"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const applyFix_1 = require("./applyFix");
const AppError_1 = require("../../utils/AppError");
// These cover every REJECTION path - all of which throw before ever
// spawning the nested `npm test` run, so they stay fast here. The actual
// successful-apply-then-verify-with-tests and the
// applies-then-auto-reverts-on-test-failure paths were verified live
// against real Groq-generated fixes on disposable scratch files (see
// BUILD_LOG.md) rather than automated here - a nested `npm test` inside
// this already-running test suite would work, but at ~10-15s per
// assertion for marginal benefit over what was already proven live.
(0, vitest_1.describe)("applyFix: safety rejections", () => {
    (0, vitest_1.it)("rejects a target file outside backend/src or frontend/src", async () => {
        await (0, vitest_1.expect)((0, applyFix_1.applyFix)({ targetFile: "../../../.env", oldCode: "x", newCode: "y" })).rejects.toThrow(AppError_1.AppError);
    });
    (0, vitest_1.it)("rejects a non-.ts/.tsx target file", async () => {
        await (0, vitest_1.expect)((0, applyFix_1.applyFix)({ targetFile: "backend/package.json", oldCode: "x", newCode: "y" })).rejects.toMatchObject({
            code: "INVALID_TARGET_FILE",
        });
    });
    (0, vitest_1.it)("refuses to modify its own implementation (self-modification protection)", async () => {
        await (0, vitest_1.expect)((0, applyFix_1.applyFix)({ targetFile: "backend/src/ai/devAssistant/tools.ts", oldCode: "x", newCode: "y" })).rejects.toMatchObject({ code: "INVALID_TARGET_FILE" });
    });
    // A real, stable, small file OUTSIDE ai/devAssistant/ - using anything
    // inside that directory here would hit the self-modification rejection
    // first, before ever reaching the checks these tests actually exercise.
    const REAL_TARGET = "backend/src/utils/AppError.ts";
    (0, vitest_1.it)("rejects when oldCode doesn't match the current file content", async () => {
        await (0, vitest_1.expect)((0, applyFix_1.applyFix)({ targetFile: REAL_TARGET, oldCode: "this string does not exist anywhere in this file, guaranteed", newCode: "y" })).rejects.toMatchObject({ code: "FIX_NOT_APPLICABLE" });
    });
    (0, vitest_1.it)("rejects when oldCode appears more than once (ambiguous which occurrence)", async () => {
        // "AppError" appears multiple times in its own definition file - a
        // real, not contrived, example of an ambiguous snippet.
        await (0, vitest_1.expect)((0, applyFix_1.applyFix)({ targetFile: REAL_TARGET, oldCode: "AppError", newCode: "y" })).rejects.toMatchObject({
            code: "FIX_AMBIGUOUS",
        });
    });
    (0, vitest_1.it)("rejects an empty oldCode or newCode", async () => {
        await (0, vitest_1.expect)((0, applyFix_1.applyFix)({ targetFile: REAL_TARGET, oldCode: "", newCode: "y" })).rejects.toMatchObject({ code: "INVALID_FIX" });
    });
});
