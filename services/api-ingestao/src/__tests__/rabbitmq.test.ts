/**
 * Testes do cliente RabbitMQ com circuit breaker e buffer in-memory.
 *
 * Estratégia: mock global do amqplib + closeRabbitMq() entre testes para reset do singleton.
 */

import type { GpsEvent } from '../types/index';

// --- Mocks de amqplib ---
const mockPublish = jest.fn().mockReturnValue(true);
const mockAssertExchange = jest.fn().mockResolvedValue({});
const mockChannelClose = jest.fn().mockResolvedValue(undefined);
const mockConnectionClose = jest.fn().mockResolvedValue(undefined);
const mockOn = jest.fn();

const mockCreateChannel = jest.fn().mockResolvedValue({
  assertExchange: mockAssertExchange,
  publish: mockPublish,
  close: mockChannelClose,
});

const mockConnect = jest.fn().mockResolvedValue({
  createChannel: mockCreateChannel,
  close: mockConnectionClose,
  on: mockOn,
});

jest.mock('amqplib', () => ({
  connect: (...args: unknown[]) => mockConnect(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rabbitmq = require('../lib/rabbitmq') as typeof import('../lib/rabbitmq');

const TEST_EVENT: GpsEvent = {
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

beforeEach(async () => {
  jest.clearAllMocks();

  // Restaura comportamento padrão (conexão bem-sucedida)
  mockConnect.mockResolvedValue({
    createChannel: mockCreateChannel,
    close: mockConnectionClose,
    on: mockOn,
  });
  mockCreateChannel.mockResolvedValue({
    assertExchange: mockAssertExchange,
    publish: mockPublish,
    close: mockChannelClose,
  });
  mockPublish.mockReturnValue(true);

  // Reseta o singleton fechando conexões abertas
  await rabbitmq.closeRabbitMq();
});

describe('RabbitMQ Client', () => {
  describe('publishGpsEvent com conexão ativa', () => {
    it('deve publicar o evento e resolver a Promise', async () => {
      await rabbitmq.initRabbitMq();
      await rabbitmq.publishGpsEvent(TEST_EVENT);

      expect(mockPublish).toHaveBeenCalledTimes(1);

      const [exchange, routingKey, buffer, options] = mockPublish.mock.calls[0] as [
        string,
        string,
        Buffer,
        { deliveryMode: number },
      ];
      expect(exchange).toBe('tx.logistics.main');
      expect(routingKey).toBe('pinheirinho.gps.raw');
      expect(buffer).toBeInstanceOf(Buffer);
      expect(JSON.parse(buffer.toString())).toMatchObject({ veiculo_id: TEST_EVENT.veiculo_id });
      expect(options.deliveryMode).toBe(2);
    });
  });

  describe('publishGpsEvent com RabbitMQ offline', () => {
    it('deve enfileirar o evento no buffer in-memory quando a conexão está indisponível', async () => {
      // Canal está null (closeRabbitMq foi chamado no beforeEach) — vai direto para o buffer
      await rabbitmq.publishGpsEvent(TEST_EVENT);

      expect(rabbitmq.getBufferSize()).toBe(1);
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it('deve incrementar o buffer a cada evento publicado quando offline', async () => {
      await rabbitmq.publishGpsEvent(TEST_EVENT);
      await rabbitmq.publishGpsEvent({ ...TEST_EVENT, timestamp: '2026-03-28T14:31:00.000Z' });
      await rabbitmq.publishGpsEvent({ ...TEST_EVENT, timestamp: '2026-03-28T14:32:00.000Z' });

      expect(rabbitmq.getBufferSize()).toBe(3);
    });
  });

  describe('Reconexão e flush do buffer', () => {
    it('deve fazer flush do buffer ao reconectar com sucesso', async () => {
      // Acumula evento no buffer (sem conexão)
      await rabbitmq.publishGpsEvent(TEST_EVENT);
      expect(rabbitmq.getBufferSize()).toBe(1);

      // Agora reconecta — deve fazer flush
      await rabbitmq.initRabbitMq();

      expect(rabbitmq.getBufferSize()).toBe(0);
      expect(mockPublish).toHaveBeenCalledTimes(1);
    });
  });

  describe('isRabbitMqConnected', () => {
    it('retorna true quando conexão e canal estão ativos', async () => {
      await rabbitmq.initRabbitMq();
      expect(rabbitmq.isRabbitMqConnected()).toBe(true);
    });

    it('retorna false quando não há conexão', () => {
      // closeRabbitMq foi chamado no beforeEach — estado limpo
      expect(rabbitmq.isRabbitMqConnected()).toBe(false);
    });
  });
});
