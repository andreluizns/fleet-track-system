import amqplib, { type ChannelModel, type Channel, type ConsumeMessage, type Options } from 'amqplib';
import pino from 'pino';
import type { GpsEvent, GeofenceAlert } from '../types/index';

const logger = pino({ name: 'rabbitmq-worker' });

// Configuração via variáveis de ambiente
const RABBITMQ_USER = process.env['RABBITMQ_USER'] ?? 'guest';
const RABBITMQ_PASS = process.env['RABBITMQ_PASS'] ?? 'guest';
const RABBITMQ_HOST = process.env['RABBITMQ_HOST'] ?? 'localhost';
const RABBITMQ_PORT = parseInt(process.env['RABBITMQ_PORT'] ?? '5672', 10);

const AMQP_URL = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;

const EXCHANGE_NAME = 'tx.logistics.main';
const CONSUME_QUEUE = 'q.pinheirinho.gps.raw';
const ALERT_ROUTING_KEY = 'pinheirinho.alert.geofence';

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

      // Verifica que a fila existe (criada pelo setup-rabbitmq.sh) sem redeclará-la
      // assertQueue causaria 406 PRECONDITION_FAILED se os argumentos divergirem
      await channel.checkQueue(CONSUME_QUEUE);

      // Prefetch: processa uma mensagem por vez (respeita ACK manual)
      await channel.prefetch(1);

      reconnectAttempt = 0;
      isConnecting = false;

      logger.info(
        { action: 'rabbitmq_connected', exchange: EXCHANGE_NAME, queue: CONSUME_QUEUE },
        'RabbitMQ connection established'
      );

      // Trata desconexão inesperada
      connection.on('close', () => {
        logger.warn({ action: 'rabbitmq_disconnected' }, 'RabbitMQ connection lost — scheduling reconnect');
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

/**
 * Consome a fila q.pinheirinho.gps.raw com ACK manual.
 * - Se handler resolver: ACK ✅
 * - Se handler lançar erro: NACK com requeue=true ❌
 */
export async function consumeGpsQueue(handler: (event: GpsEvent) => Promise<void>): Promise<void> {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized. Call initRabbitMq() first.');
  }

  await channel.consume(
    CONSUME_QUEUE,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;

      const start = Date.now();
      let event: GpsEvent | null = null;

      try {
        event = JSON.parse(msg.content.toString()) as GpsEvent;

        logger.info(
          { action: 'rabbitmq_message_received', veiculo_id: event.veiculo_id },
          'Processing GPS event from queue'
        );

        await handler(event);

        channel?.ack(msg);

        const latency = Date.now() - start;
        logger.info(
          { action: 'rabbitmq_ack', veiculo_id: event.veiculo_id, latency_ms: latency },
          'GPS event processed and ACKed'
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const veiculo_id = event?.veiculo_id ?? 'unknown';

        logger.error(
          { action: 'rabbitmq_nack', veiculo_id, error: message },
          'Error processing GPS event — NACKing with requeue=true'
        );

        // NACK com requeue=true: mensagem permanece na fila (protocolo de emergência)
        channel?.nack(msg, false, true);
      }
    },
    { noAck: false } // ACK manual obrigatório
  );

  logger.info({ action: 'rabbitmq_consumer_started', queue: CONSUME_QUEUE }, 'Consumer started');
}

/**
 * Publica um alerta de geofence na exchange tx.logistics.main
 * com routing key pinheirinho.alert.geofence.
 */
export function publishGeofenceAlert(alert: GeofenceAlert): void {
  if (!channel) {
    logger.warn(
      { action: 'rabbitmq_alert_publish_skipped', veiculo_id: alert.veiculo_id },
      'RabbitMQ channel not available — geofence alert not published'
    );
    return;
  }

  const messageBuffer = Buffer.from(JSON.stringify(alert));
  const publishOptions: Options.Publish = {
    deliveryMode: 2,        // Persistente
    contentType: 'application/json',
    timestamp: Math.floor(Date.now() / 1000),
  };

  channel.publish(EXCHANGE_NAME, ALERT_ROUTING_KEY, messageBuffer, publishOptions);

  logger.info(
    {
      action: 'rabbitmq_alert_published',
      veiculo_id: alert.veiculo_id,
      placa: alert.placa,
      tipo: alert.tipo,
      routing_key: ALERT_ROUTING_KEY,
    },
    'Geofence alert published to RabbitMQ'
  );
}

/**
 * Verifica se o canal RabbitMQ está ativo.
 */
export function isRabbitMqConnected(): boolean {
  return channel !== null && connection !== null;
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
    logger.info({ action: 'rabbitmq_closed' }, 'RabbitMQ connection closed gracefully');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ action: 'rabbitmq_close_error', error: message }, 'Error closing RabbitMQ connection');
  }
}
