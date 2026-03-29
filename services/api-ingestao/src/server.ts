import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { gpsRoutes, healthRoute } from './routes/gps';
import { closeRedis } from './lib/redis';
import { initRabbitMq, closeRabbitMq } from './lib/rabbitmq';
import { registry, httpRequestsTotal, httpRequestDuration } from './lib/metrics';

const API_PORT = parseInt(process.env['API_PORT'] ?? '3000', 10);
const API_HOST = process.env['API_HOST'] ?? '0.0.0.0';

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      // Formato JSON estruturado via pino
      transport:
        process.env['NODE_ENV'] === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    ajv: {
      customOptions: {
        formats: {
          // Aceita formatos uuid e date-time para validação do JSON Schema
        },
      },
      plugins: [
        // Plugin ajv-formats para suporte a "uuid" e "date-time"
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('ajv-formats'),
      ],
    },
  });

  // Plugins
  await fastify.register(sensible);

  // Hook: mede latência e incrementa contadores Prometheus em cada requisição
  fastify.addHook('onRequest', (request, _reply, done) => {
    (request as unknown as Record<string, number>)['_metricsStart'] = Date.now();
    done();
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    const start = (request as unknown as Record<string, number>)['_metricsStart'] ?? Date.now();
    const durationSec = (Date.now() - start) / 1000;
    const route = request.routerPath ?? request.url ?? 'unknown';
    const method = request.method;
    const statusCode = String(reply.statusCode);

    httpRequestsTotal.inc({ method, route, status_code: statusCode });
    httpRequestDuration.observe({ method, route, status_code: statusCode }, durationSec);
    done();
  });

  // Rota GET /metrics — expõe métricas Prometheus
  fastify.get('/metrics', { schema: { hide: true } }, async (_request, reply) => {
    const metrics = await registry.metrics();
    void reply.header('Content-Type', registry.contentType).send(metrics);
  });

  // Rotas de saúde (sem prefixo)
  await fastify.register(healthRoute);

  // Rotas de ingestão GPS (prefixo /api/v1)
  await fastify.register(gpsRoutes, { prefix: '/api/v1' });

  return fastify;
}

async function main(): Promise<void> {
  const fastify = await buildServer();

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    fastify.log.info({ action: 'shutdown_initiated', signal }, `Received ${signal} — shutting down gracefully`);

    try {
      await fastify.close();
      await closeRedis();
      await closeRabbitMq();
      fastify.log.info({ action: 'shutdown_complete' }, 'Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fastify.log.error({ action: 'shutdown_error', error: message }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Inicializa conexão RabbitMQ em background (com retry automático)
  initRabbitMq().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    fastify.log.warn(
      { action: 'rabbitmq_init_failed', error: message },
      'RabbitMQ initial connection failed — will retry with exponential backoff'
    );
  });

  try {
    await fastify.listen({ port: API_PORT, host: API_HOST });
    fastify.log.info(
      { action: 'server_started', port: API_PORT, host: API_HOST },
      `Fleet Track API de Ingestão listening on ${API_HOST}:${API_PORT}`
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Exporta buildServer para uso nos testes
export { buildServer };

// Executa apenas se for o módulo principal
if (require.main === module) {
  void main();
}
