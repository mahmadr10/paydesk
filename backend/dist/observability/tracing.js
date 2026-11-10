"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// OpenTelemetry bootstrap - MUST be imported before anything else in the
// process (see src/index.ts, where this is the literal first import). Node's
// auto-instrumentation works by monkey-patching modules (http, express,
// mongodb, ...) the moment they're `require`d; if app.ts or any of its
// dependencies were imported first, those specific modules would already be
// bound to their un-patched originals and would silently produce no spans.
//
// Demonstrates the exact chain the spec asks for:
//   HTTP Request → Express Route → Service → MongoDB
// "HTTP Request" and "Express Route" and "MongoDB" come for free from the
// auto-instrumentations below (http, express, mongodb - mongoose sits on top
// of the mongodb driver, so instrumenting the driver covers it). "Service" is
// NOT auto-instrumented (it's just plain function calls, nothing to patch) -
// see observability/otel.ts's `withSpan()`, used explicitly in a handful of
// representative service functions so that layer shows up in the trace too.
const sdk_node_1 = require("@opentelemetry/sdk-node");
const auto_instrumentations_node_1 = require("@opentelemetry/auto-instrumentations-node");
const exporter_trace_otlp_http_1 = require("@opentelemetry/exporter-trace-otlp-http");
const sdk_trace_node_1 = require("@opentelemetry/sdk-trace-node");
const exporter_prometheus_1 = require("@opentelemetry/exporter-prometheus");
const resources_1 = require("@opentelemetry/resources");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const otelEnabled = (process.env.OTEL_ENABLED ?? (isServerless ? "false" : "true")) !== "false";
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT; // e.g. http://jaeger:4318
const metricsPort = Number(process.env.OTEL_METRICS_PORT ?? 9464);
const serviceName = process.env.OTEL_SERVICE_NAME ?? "servicedesk-backend";
if (otelEnabled) {
    // Traces: if a real collector/Jaeger endpoint is configured (docker-compose
    // sets this to Jaeger's OTLP HTTP receiver), export there over OTLP/HTTP.
    // With NO endpoint configured - the zero-setup default for `npm run dev`,
    // no collector required - fall back to printing spans to the console, so
    // "with trace information where practical" is true even without any extra
    // infrastructure running.
    const traceExporter = otlpEndpoint
        ? new exporter_trace_otlp_http_1.OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })
        : new sdk_trace_node_1.ConsoleSpanExporter();
    // Metrics: PrometheusExporter starts its own HTTP server on metricsPort.
    // In serverless environments (e.g. Vercel), don't bind a separate port.
    const metricReader = isServerless ? undefined : new exporter_prometheus_1.PrometheusExporter({ port: metricsPort });
    const sdk = new sdk_node_1.NodeSDK({
        resource: (0, resources_1.resourceFromAttributes)({
            [semantic_conventions_1.ATTR_SERVICE_NAME]: serviceName,
            [semantic_conventions_1.ATTR_SERVICE_VERSION]: "1.0.0",
        }),
        traceExporter,
        metricReader,
        instrumentations: [
            (0, auto_instrumentations_node_1.getNodeAutoInstrumentations)({
                // The fs instrumentation generates a span for every single file
                // read/write on the process (including ones Node itself does
                // internally) - overwhelming noise with near-zero diagnostic value
                // for this app. Everything else (http, express, mongodb, dns, ...)
                // stays on.
                "@opentelemetry/instrumentation-fs": { enabled: false },
            }),
        ],
    });
    sdk.start();
    // Plain console.log, not the Pino logger - this runs before the logger
    // module (and its env-driven config) is even imported.
    console.log(`[otel] tracing started (service=${serviceName}, traces=${otlpEndpoint ? `OTLP ${otlpEndpoint}` : "console"}${metricReader ? `, metrics=http://localhost:${metricsPort}/metrics` : ""})`);
    process.on("SIGTERM", () => {
        sdk.shutdown().finally(() => process.exit(0));
    });
}
else {
    console.log(`[otel] tracing disabled (OTEL_ENABLED=${otelEnabled})`);
}
