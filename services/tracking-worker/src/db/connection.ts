import { Pool, type QueryResult, type PoolClient } from 'pg';
import pino from 'pino';

const logger = pino({ name: 'db' });

const pool = new Pool({
  user: process.env['POSTGRES_USER'] ?? 'fleet_user',
  password: process.env['POSTGRES_PASSWORD'] ?? 'fleet_pass_change_me',
  database: process.env['POSTGRES_DB'] ?? 'fleet_db',
  host: process.env['POSTGRES_HOST'] ?? 'localhost',
  port: parseInt(process.env['POSTGRES_PORT'] ?? '5432', 10),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err: Error) => {
  logger.error({ action: 'db_pool_error', error: err.message }, 'Unexpected PostgreSQL pool error');
});

/**
 * Executa uma query SQL usando o pool de conexões.
 */
export async function query(text: string, params?: unknown[]): Promise<QueryResult> {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const latency = Date.now() - start;
    logger.debug({ action: 'db_query', latency_ms: latency, rows: result.rowCount }, 'Query executed');
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ action: 'db_query_error', error: message, query: text }, 'Query failed');
    throw err;
  }
}

/**
 * Obtém um cliente do pool para uso em transações.
 * Lembre-se de chamar client.release() após o uso.
 */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

/**
 * Encerra o pool de conexões (graceful shutdown).
 */
export async function closePool(): Promise<void> {
  await pool.end();
  logger.info({ action: 'db_pool_closed' }, 'PostgreSQL pool closed');
}

export default pool;
