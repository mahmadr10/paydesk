"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
exports.notFoundHandler = notFoundHandler;
const AppError_1 = require("../utils/AppError");
// Express recognizes this as an error handler specifically because it takes
// 4 arguments (err, req, res, next). It must be registered LAST, after all
// routes - Express routes any error passed to next(err) here.
//
// The whole point: never leak raw stack traces or internal error messages to
// the client (that can expose file paths, library versions, etc. to an
// attacker). Always return the same JSON shape, and always include the
// requestId - so a user reporting "I got an error" can hand support that id,
// and support can find the FULL error (with stack trace) in the structured
// logs by searching for it, without ever exposing that detail to the client.
function errorHandler(err, req, res, _next) {
    const requestId = req.id;
    if (err instanceof AppError_1.AppError) {
        // 4xx errors are expected/handled (bad input, wrong password, etc.) -
        // log at "warn", not "error", so alerting on real errors isn't
        // drowned out by routine "user typed the wrong password" noise.
        req.log?.warn({ code: err.code }, err.message);
        return res.status(err.statusCode).json({
            success: false,
            error: { code: err.code, message: err.message },
            requestId,
        });
    }
    // Anything we didn't throw on purpose (a bug, a library error) - log the
    // FULL error (stack trace included) for ourselves, but show the client
    // only a generic message plus the requestId to look it up by.
    req.log?.error({ err }, "Unexpected error");
    return res.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
        requestId,
    });
}
function notFoundHandler(req, res) {
    res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: `No route: ${req.method} ${req.originalUrl}` },
        requestId: req.id,
    });
}
