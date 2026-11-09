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
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

const otelEnabled = (process.env.OTEL_ENABLED ?? "true") !== "false";
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
    ? new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })
    : new ConsoleSpanExporter();

  // Metrics: PrometheusExporter starts its own tiny HTTP server and serves
  // metrics in Prometheus's scrape format directly - no collector needed,
  // Prometheus (or a curl in the demo video) can hit it as-is. This is a
  // deliberate choice, not the only valid one: an OTLP metrics exporter
  // (paired with the trace exporter above) would also work and would let a
  // full OTel Collector pipeline handle both signals uniformly - chosen
  // Prometheus's pull model instead because it needs nothing running to be
  // useful (`curl localhost:9464/metrics` works with zero other services up),
  // where OTLP metrics would need a collector or backend already listening.
  const metricReader = new PrometheusExporter({ port: metricsPort });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: "1.0.0",
    }),
    traceExporter,
    metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
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
  console.log(
    `[otel] tracing started (service=${serviceName}, traces=${otlpEndpoint ? `OTLP ${otlpEndpoint}` : "console"}, metrics=http://localhost:${metricsPort}/metrics)`
  );

  process.on("SIGTERM", () => {
    sdk.shutdown().finally(() => process.exit(0));
  });
} else {
  console.log("[otel] tracing disabled (OTEL_ENABLED=false)");
}
