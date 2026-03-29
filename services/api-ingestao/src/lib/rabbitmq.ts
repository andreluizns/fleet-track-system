import amqplib, { type ChannelModel, type Channel, type Options } from 'amqplib';
import pino from 'pino';
import type { GpsEvent } from '../types/index';

const logger = pino({ name: 'rabbitmq' });

// Configuração via variáveis de ambiente
const RABBITMQ_USER = process.env['RABBITMQ_USER'] ?? 'guest';
const RABBITMQ_PASS = process.env['RABBITMQ_PASS'] ?? 'guest';
const RABBITMQ_HOST = process.env['RABBITMQ_HOST'] ?? 'localhost';
const RABBITMQ_PORT = parseInt(process.env['RABBITMQ_PORT'] ?? '5672', 10);

const AMQP_URL = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;

const EXCHANGE_NAME = 'tx.logistics.main';
const ROUTING_KEY = 'pinheirinho.gps.raw';

// Buffer in-memory para eventos acumulados enquanto o RabbitMQ estiver offline
const inMemoryBuffer: GpsEvent[] = [];

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let isConnecting = false;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Exponential backoff: 2s, 4s, 8s... máx 30s
function getBackoffDelay(attempt: number): number {
  return Math.min(2000 * Math.pow(2, attempt), 30000);
}

async function connect(): Promise<void> {
  if (isConnecting) return;
  isConnecting = true;

  while (true) {
    try {
      logger.info(
        { action: 'rabbitmq_connect_attempt', attempt: reconnectAttempt, url: `amqp://${RABBITMQ_HOST}:${RABBITMQ_PORT}` },
        'Attempting RabbitMQ connection'
      );

      connection = await amqplib.connect(AMQP_URL);
      channel = await connection.createChannel();

      // Declara a exchange como topic (idempotente)
      await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

      reconnectAttempt = 0;
      isConnecting = false;

      logger.info({ action: 'rabbitmq_connected', exchange: EXCHANGE_NAME }, 'RabbitMQ connection established');

      // Flush do buffer in-memory acumulado durante a indisponibilidade
      await flushBuffer();

      // Trata desconexão inesperada da conexão
      connection.on('close', () => {
        logger.warn({ action: 'rabbitmq_disconnected' }, 'RabbitMQ connection lost — activating in-memory buffer');
        connection = null;
        channel = null;
        scheduleReconnect();
      });

      connection.on('error', (err: Error) => {
        logger.error({ action: 'rabbitmq_connection_error', error: err.message }, 'RabbitMQ connection error');
        connection = null;
        channel = null;
      });

      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const delay = getBackoffDelay(reconnectAttempt);
      reconnectAttempt++;

      logger.warn(
        { action: 'rabbitmq_connect_failed', attempt: reconnectAttempt, delay_ms: delay, error: message },
        'RabbitMQ connection failed — retrying with exponential backoff'
      );

      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}

function scheduleReconnect(): void {
  const delay = getBackoffDelay(reconnectAttempt);
  reconnectAttempt++;

  logger.warn(
    { action: 'rabbitmq_schedule_reconnect', attempt: reconnectAttempt, delay_ms: delay },
    'Scheduling RabbitMQ reconnect'
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ action: 'rabbitmq_reconnect_error', error: message }, 'Failed to reconnect to RabbitMQ');
    });
  }, delay);
}

async function flushBuffer(): Promise<void> {
  if (inMemoryBuffer.length === 0) return;

  logger.info(
    { action: 'rabbitmq_flush_buffer', buffered_events: inMemoryBuffer.length },
    'Flushing in-memory GPS event buffer to RabbitMQ'
  );

  const toFlush = [...inMemoryBuffer];
  inMemoryBuffer.length = 0;

  for (const event of toFlush) {
    try {
      await publishToChannel(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { action: 'rabbitmq_flush_error', veiculo_id: event.veiculo_id, error: message },
        'Failed to flush buffered event — re-queuing'
      );
      inMemoryBuffer.push(event);
    }
  }

  if (inMemoryBuffer.length === 0) {
    logger.info({ action: 'rabbitmq_flush_complete' }, 'In-memory buffer flushed successfully');
  }
}

async function publishToChannel(event: GpsEvent): Promise<void> {
  if (!channel) {
    throw new Error('No active RabbitMQ channel');
  }

  const messageBuffer = Buffer.from(JSON.stringify(event));
  const publishOptions: Options.Publish = {
    deliveryMode: 2,        // Persistente
    contentType: 'application/json',
    timestamp: Math.floor(Date.now() / 1000),
  };

  channel.publish(EXCHANGE_NAME, ROUTING_KEY, messageBuffer, publishOptions);
}

/**
 * Publica um GpsEvent na exchange tx.logistics.main com routing key pinheirinho.gps.raw.
 * Se o RabbitMQ estiver offline, o evento é enfileirado no buffer in-memory (circuit breaker).
 */
export async function publishGpsEvent(event: GpsEvent): Promise<void> {
  if (!channel || !connection) {
    logger.warn(
      { action: 'rabbitmq_buffering', veiculo_id: event.veiculo_id, buffer_size: inMemoryBuffer.length + 1 },
      'RabbitMQ offline — buffering GPS event in memory'
    );
    inMemoryBuffer.push(event);

    // Inicia reconexão se não estiver em andamento
    if (!isConnecting) {
      scheduleReconnect();
    }
    return;
  }

  try {
    await publishToChannel(event);
    logger.info(
      {
        action: 'rabbitmq_published',
        veiculo_id: event.veiculo_id,
        exchange: EXCHANGE_NAME,
        routing_key: ROUTING_KEY,
      },
      'GPS event published to RabbitMQ'
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { action: 'rabbitmq_publish_error', veiculo_id: event.veiculo_id, error: message },
      'Failed to publish — buffering event in memory'
    );
    inMemoryBuffer.push(event);
    channel = null;

    if (!isConnecting) {
      scheduleReconnect();
    }
  }
}

/**
 * Verifica se o canal RabbitMQ está ativo (para o health check).
 */
export function isRabbitMqConnected(): boolean {
  return channel !== null && connection !== null;
}

/**
 * Retorna o tamanho atual do buffer in-memory.
 */
export function getBufferSize(): number {
  return inMemoryBuffer.length;
}

/**
 * Inicia a conexão com o RabbitMQ.
 */
export async function initRabbitMq(): Promise<void> {
  await connect();
}

/**
 * Fecha a conexão com o RabbitMQ (graceful shutdown).
 */
export async function closeRabbitMq(): Promise<void> {
  // Cancela qualquer timer de reconexão pendente
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  isConnecting = false;
  reconnectAttempt = 0;

  try {
    if (channel) {
      await channel.close();
      channel = null;
    }
    if (connection) {
      await connection.close();
      connection = null;
    }
    // Limpa o buffer in-memory ao fechar — eventos não enviados são descartados
    inMemoryBuffer.length = 0;
    logger.info({ action: 'rabbitmq_closed' }, 'RabbitMQ connection closed gracefully');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ action: 'rabbitmq_close_error', error: message }, 'Error closing RabbitMQ connection');
  }
}
