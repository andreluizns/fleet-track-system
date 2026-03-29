import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { gpsEventSchema } from '../schemas/gps-event';
import { checkIdempotency, pingRedis } from '../lib/redis';
import { publishGpsEvent, isRabbitMqConnected } from '../lib/rabbitmq';
import type { GpsEvent, HealthStatus, IngestaoResponse } from '../types/index';
import { gpsEventsIngested, gpsEventsDuplicate } from '../lib/metrics';

export async function gpsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/gps
   * Ingestão de coordenadas GPS.
   *
   * Fluxo:
   * 1. Valida payload contra GpsEvent JSON Schema (Fastify schema validation)
   * 2. Checa idempotência no Redis
   * 3. Publica evento no RabbitMQ
   * 4. Responde 202 Accepted ou 200 Duplicate
   */
  fastify.post<{ Body: GpsEvent }>(
    '/gps',
    {
      schema: {
        body: gpsEventSchema,
        response: {
          202: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              veiculo_id: { type: 'string' },
              timestamp: { type: 'string' },
            },
          },
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: GpsEvent }>, reply: FastifyReply): Promise<IngestaoResponse> => {
      const start = Date.now();
      const event = request.body;

      // Checa idempotência
      const isDuplicate = await checkIdempotency(event.veiculo_id, event.timestamp);

      if (isDuplicate) {
        gpsEventsDuplicate.inc();

        request.log.info({
          action: 'gps_duplicate',
          veiculo_id: event.veiculo_id,
          placa: event.placa,
          latency_ms: Date.now() - start,
        });

        return reply.code(200).send({
          status: 'duplicate',
          message: 'Coordenada já processada',
        });
      }

      // Publica no RabbitMQ (com circuit breaker e buffer in-memory se offline)
      await publishGpsEvent(event);
      gpsEventsIngested.inc();

      const latencyMs = Date.now() - start;

      request.log.info({
        action: 'gps_ingested',
        veiculo_id: event.veiculo_id,
        placa: event.placa,
        lat: event.lat,
        lng: event.lng,
        timestamp: event.timestamp,
        latency_ms: latencyMs,
      });

      return reply.code(202).send({
        status: 'accepted',
        veiculo_id: event.veiculo_id,
        timestamp: event.timestamp,
      });
    }
  );
}

export async function healthRoute(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /health
   * Verifica o status dos serviços dependentes (Redis e RabbitMQ).
   */
  fastify.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              services: {
                type: 'object',
                properties: {
                  redis: { type: 'string' },
                  rabbitmq: { type: 'string' },
                },
              },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              services: {
                type: 'object',
                properties: {
                  redis: { type: 'string' },
                  rabbitmq: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply): Promise<HealthStatus> => {
      const [redisOk, rabbitOk] = await Promise.all([
        pingRedis(),
        Promise.resolve(isRabbitMqConnected()),
      ]);

      const healthStatus: HealthStatus = {
        status: redisOk && rabbitOk ? 'ok' : 'degraded',
        services: {
          redis: redisOk ? 'ok' : 'down',
          rabbitmq: rabbitOk ? 'ok' : 'down',
        },
      };

      const httpStatus = healthStatus.status === 'ok' ? 200 : 503;
      return reply.code(httpStatus).send(healthStatus);
    }
  );
}
