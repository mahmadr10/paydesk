import { trace, SpanStatusCode } from "@opentelemetry/api";

// The auto-instrumentation wired up in tracing.ts covers "HTTP Request",
// "Express Route", and "MongoDB" for free (patched libraries). The "Service"
// layer in between is just plain TypeScript function calls - nothing to
// auto-patch - so a handful of representative service functions wrap
// themselves in an explicit span via this helper, which is what makes that
// layer visible in a trace waterfall (see BUILD_LOG.md's OpenTelemetry
// entry for what the resulting trace actually looks like).
const tracer = trace.getTracer("servicedesk-backend");

export async function withSpan<T>(name: string, fn: () => Promise<T>, attributes?: Record<string, string | number | boolean>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) span.setAttributes(attributes);
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      // Records the error ON the span (visible in Jaeger's UI as a red span
      // with the exception attached) - separate from, not instead of, the
      // Pino error log the errorHandler middleware already writes.
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
