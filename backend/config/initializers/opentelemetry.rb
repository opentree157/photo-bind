require "opentelemetry/sdk"
require "opentelemetry/exporter/otlp"
require "opentelemetry/instrumentation/rails"
require "opentelemetry/instrumentation/active_record"
require "opentelemetry/instrumentation/rack"

resource_attributes = {
  "service.name" => ENV.fetch("OTEL_SERVICE_NAME", "photobind-api"),
  "service.version" => ENV.fetch("PHOTOBIND_RELEASE", "development"),
  "deployment.environment" => Rails.env.to_s
}

OpenTelemetry::SDK.configure do |config|
  config.service_name = resource_attributes["service.name"]
  config.resource = OpenTelemetry::SDK::Resources::Resource.create(resource_attributes)
  if ENV["OTEL_EXPORTER_OTLP_ENDPOINT"].present?
    exporter_options = { endpoint: ENV["OTEL_EXPORTER_OTLP_ENDPOINT"] }
    exporter_options[:headers] = ENV["OTEL_EXPORTER_OTLP_HEADERS"] if ENV["OTEL_EXPORTER_OTLP_HEADERS"].present?
    config.add_span_processor(
      OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
        OpenTelemetry::Exporter::OTLP::Exporter.new(**exporter_options)
      )
    )
  end
  config.use "OpenTelemetry::Instrumentation::Rails"
  config.use "OpenTelemetry::Instrumentation::ActiveRecord"
  config.use "OpenTelemetry::Instrumentation::Rack"
end
