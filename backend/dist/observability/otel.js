"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withSpan = withSpan;
const api_1 = require("@opentelemetry/api");
// The auto-instrumentation wired up in tracing.ts covers "HTTP Request",
// "Express Route", and "MongoDB" for free (patched libraries). The "Service"
// layer in between is just plain TypeScript function calls - nothing to
// auto-patch - so a handful of representative service functions wrap
// themselves in an explicit span via this helper, which is what makes that
// layer visible in a trace waterfall (see BUILD_LOG.md's OpenTelemetry
// entry for what the resulting trace actually looks like).
const tracer = api_1.trace.getTracer("servicedesk-backend");
async function withSpan(name, fn, attributes) {
    return tracer.startActiveSpan(name, async (span) => {
        if (attributes)
            span.setAttributes(attributes);
        try {
            const result = await fn();
            span.setStatus({ code: api_1.SpanStatusCode.OK });
            return result;
        }
        catch (err) {
            // Records the error ON the span (visible in Jaeger's UI as a red span
            // with the exception attached) - separate from, not instead of, the
            // Pino error log the errorHandler middleware already writes.
            span.recordException(err);
            span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: err.message });
            throw err;
        }
        finally {
            span.end();
        }
    });
}
