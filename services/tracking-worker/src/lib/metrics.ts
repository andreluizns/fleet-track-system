import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ app: 'tracking-worker' });

collectDefaultMetrics({ register: registry });

export const gpsEventsProcessed = new Counter({
  name: 'gps_events_processed_total',
  help: 'Total de eventos GPS processados pelo worker',
  labelNames: ['dentro_da_cerca'],
  registers: [registry],
});

export const geofenceAlertsTotal = new Counter({
  name: 'fleet_geofence_alerts_total',
  help: 'Total de alertas de geofence gerados (veículo saiu da cerca)',
  registers: [registry],
});

export const gpsProcessingDuration = new Histogram({
  name: 'gps_processing_duration_seconds',
  help: 'Duração do processamento completo de um evento GPS (fila → DB → ACK)',
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const activeSocketConnections = new Gauge({
  name: 'socket_active_connections',
  help: 'Número de clientes Socket.io conectados atualmente',
  registers: [registry],
});
