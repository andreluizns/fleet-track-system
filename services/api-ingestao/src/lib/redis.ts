import Redis from 'ioredis';
import pino from 'pino';

const logger = pino({ name: 'redis' });

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(REDIS_URL, {
      lazyConnect: false,
      retryStrategy: (times: number): number => {
        const delay = Math.min(times * 500, 5000);
        logger.warn({ action: 'redis_reconnect', attempt: times, delay_ms: delay }, 'Redis reconnecting');
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
    });

    redisClient.on('connect', () => {
      logger.info({ action: 'redis_connected' }, 'Redis connection established');
    });

    redisClient.on('error', (err: Error) => {
      logger.warn({ action: 'redis_error', error: err.message }, 'Redis error — idempotency checks may be skipped');
    });

    redisClient.on('close', () => {
      logger.warn({ action: 'redis_disconnected' }, 'Redis connection closed');
    });
  }

  return redisClient;
}

/**
 * Verifica idempotência para um evento GPS.
 *
 * Chave: `idempotency:{veiculo_id}:{timestamp}`
 * - Se a chave existir: retorna true (duplicata — descartar evento)
 * - Se não existir: seta com SET NX EX 300 (5 min TTL) e retorna false (novo evento)
 * - Se Redis estiver offline: loga warn e retorna false (não bloqueia ingestão)
 */
export async function checkIdempotency(veiculoId: string, timestamp: string): Promise<boolean> {
  const key = `idempotency:${veiculoId}:${timestamp}`;

  try {
    const client = getRedisClient();
    // SET key "1" NX EX 300 — retorna "OK" se setou (não existia), null se já existia
    const result = await client.set(key, '1', 'EX', 300, 'NX');

    if (result === null) {
      // Chave já existia → duplicata
      logger.info({ action: 'idempotency_duplicate', veiculo_id: veiculoId, key }, 'Duplicate GPS event detected');
      return true;
    }

    // Chave não existia → evento novo, foi registrado
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { action: 'idempotency_redis_error', veiculo_id: veiculoId, error: message },
      'Redis offline — skipping idempotency check, allowing event through'
    );
    return false;
  }
}

/**
 * Verifica se o Redis está respondendo (para o health check).
 */
export async function pingRedis(): Promise<boolean> {
  try {
    const client = getRedisClient();
    const result = await client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Fecha a conexão Redis (graceful shutdown).
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info({ action: 'redis_closed' }, 'Redis connection closed gracefully');
  }
}
