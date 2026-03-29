import Fastify, { type FastifyInstance } from 'fastify';
import { gpsRoutes, healthRoute } from '../routes/gps';

// Mock dos módulos de infra
jest.mock('../lib/redis.js', () => ({
  checkIdempotency: jest.fn().mockResolvedValue(false),
  pingRedis: jest.fn().mockResolvedValue(true),
}));

jest.mock('../lib/rabbitmq.js', () => ({
  publishGpsEvent: jest.fn().mockResolvedValue(undefined),
  isRabbitMqConnected: jest.fn().mockReturnValue(true),
}));

import { checkIdempotency } from '../lib/redis';
import { publishGpsEvent } from '../lib/rabbitmq';

const mockCheckIdempotency = checkIdempotency as jest.MockedFunction<typeof checkIdempotency>;
const mockPublishGpsEvent = publishGpsEvent as jest.MockedFunction<typeof publishGpsEvent>;

const VALID_PAYLOAD = {
  veiculo_id: '550e8400-e29b-41d4-a716-446655440000',
  placa: 'ABC1D23',
  lat: -25.5163,
  lng: -49.2916,
  velocidade: 45.5,
  ignicao: true,
  heading: 90,
  precisao_metros: 5.2,
  timestamp: '2026-03-28T14:30:00.000Z',
};

async function buildTestServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: false,
    ajv: {
      plugins: [require('ajv-formats')],
    },
  });

  await fastify.register(healthRoute);
  await fastify.register(gpsRoutes, { prefix: '/api/v1' });

  return fastify;
}

describe('GPS Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckIdempotency.mockResolvedValue(false);
    mockPublishGpsEvent.mockResolvedValue(undefined);
  });

  describe('POST /api/v1/gps', () => {
    it('deve retornar 202 com payload válido', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/gps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(VALID_PAYLOAD),
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body) as { status: string; veiculo_id: string; timestamp: string };
      expect(body.status).toBe('accepted');
      expect(body.veiculo_id).toBe(VALID_PAYLOAD.veiculo_id);
      expect(body.timestamp).toBe(VALID_PAYLOAD.timestamp);
      expect(mockPublishGpsEvent).toHaveBeenCalledTimes(1);
    });

    it('deve retornar 202 com payload mínimo (apenas campos obrigatórios)', async () => {
      const minimalPayload = {
        veiculo_id: '550e8400-e29b-41d4-a716-446655440000',
        placa: 'ABC1D23',
        lat: -25.5163,
        lng: -49.2916,
        timestamp: '2026-03-28T14:30:00.000Z',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/gps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(minimalPayload),
      });

      expect(response.statusCode).toBe(202);
    });

    it('deve retornar 400 quando veiculo_id está ausente', async () => {
      const invalidPayload = { ...VALID_PAYLOAD };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (invalidPayload as any).veiculo_id;

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/gps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(invalidPayload),
      });

      expect(response.statusCode).toBe(400);
    });

    it('deve retornar 400 quando lat está fora do bounding box de Curitiba', async () => {
      const invalidPayload = {
        ...VALID_PAYLOAD,
        lat: -23.5505, // São Paulo — fora do range de Curitiba (-25.65 a -25.35)
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/gps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(invalidPayload),
      });

      expect(response.statusCode).toBe(400);
    });

    it('deve retornar 400 quando lng está fora do bounding box de Curitiba', async () => {
      const invalidPayload = {
        ...VALID_PAYLOAD,
        lng: -46.6333, // São Paulo — fora do range de Curitiba (-49.42 a -49.18)
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/gps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(invalidPayload),
      });

      expect(response.statusCode).toBe(400);
    });

    it('deve retornar 400 quando placa tem formato inválido', async () => {
      const invalidPayload = {
        ...VALID_PAYLOAD,
        placa: 'INVALIDA123',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/gps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(invalidPayload),
      });

      expect(response.statusCode).toBe(400);
    });

    it('deve retornar 200 com status duplicate quando evento já foi processado', async () => {
      mockCheckIdempotency.mockResolvedValue(true);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/gps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(VALID_PAYLOAD),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { status: string; message: string };
      expect(body.status).toBe('duplicate');
      expect(body.message).toBe('Coordenada já processada');
      // Não deve publicar no RabbitMQ
      expect(mockPublishGpsEvent).not.toHaveBeenCalled();
    });

    it('deve aceitar placa no formato antigo (ABC-1234)', async () => {
      const payloadPlacaAntiga = {
        ...VALID_PAYLOAD,
        placa: 'XYZ-9876',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/gps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payloadPlacaAntiga),
      });

      expect(response.statusCode).toBe(202);
    });

    it('deve retornar 400 quando timestamp não é ISO 8601', async () => {
      const invalidPayload = {
        ...VALID_PAYLOAD,
        timestamp: '28/03/2026 14:30:00', // formato inválido
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/gps',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(invalidPayload),
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /health', () => {
    it('deve retornar 200 com status ok quando Redis e RabbitMQ estão ativos', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { status: string; services: { redis: string; rabbitmq: string } };
      expect(body.status).toBe('ok');
      expect(body.services.redis).toBe('ok');
      expect(body.services.rabbitmq).toBe('ok');
    });
  });
});
