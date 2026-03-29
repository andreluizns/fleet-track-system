import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ app: 'api-ingestao' });

collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total de requisições HTTP',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duração das requisições HTTP em segundos',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const gpsEventsIngested = new Counter({
  name: 'gps_events_ingested_total',
  help: 'Total de eventos GPS ingeridos com sucesso',
  registers: [registry],
});

export const gpsEventsDuplicate = new Counter({
  name: 'gps_events_duplicate_total',
  help: 'Total de eventos GPS duplicados descartados (idempotência Redis)',
  registers: [registry],
});

export const rabbitmqBufferSize = new Counter({
  name: 'rabbitmq_buffer_events_total',
  help: 'Total de eventos enfileirados no buffer in-memory (RabbitMQ offline)',
  registers: [registry],
});
