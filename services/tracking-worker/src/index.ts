import http from 'http';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { query, closePool } from './db/connection';
import { initSocketServer, closeSocketServer } from './server/socket-server';
import { initRabbitMq, closeRabbitMq, consumeGpsQueue, isRabbitMqConnected } from './lib/rabbitmq';
import { processGpsEvent } from './worker/tracking-worker';
import { registry } from './lib/metrics';

const logger = pino({ name: 'tracking-worker-main', level: process.env['LOG_LEVEL'] ?? 'info' });

const WORKER_PORT = parseInt(process.env['WORKER_PORT'] ?? '3001', 10);

/**
 * Executa a migration SQL de criação de tabelas.
 * Idempotente — usa IF NOT EXISTS em todas as instruções.
 */
async function runMigrations(): Promise<void> {
  const migrationPath = path.join(__dirname, 'db', 'migrations', '001_create_tables.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  logger.info({ action: 'migration_start', file: '001_create_tables.sql' }, 'Running database migrations');

  await query(sql);

  logger.info({ action: 'migration_complete', file: '001_create_tables.sql' }, 'Database migrations completed');
}

/**
 * Endpoint GET /status-atual — retorna a última posição conhecida de cada veículo.
 */
async function handleStatusAtual(res: http.ServerResponse): Promise<void> {
  const result = await query(
    `SELECT DISTINCT ON (veiculo_id)
       veiculo_id,
       placa,
       ST_Y(location::geometry) AS lat,
       ST_X(location::geometry) AS lng,
       velocidade,
       ignicao,
       dentro_da_cerca,
       captured_at
     FROM gps_events
     ORDER BY veiculo_id, captured_at DESC`
  );

  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ vehicles: result.rows, total: result.rowCount, timestamp: new Date().toISOString() }));
}

/**
 * Endpoint GET /geofence-alerts — retorna os últimos 100 alertas de geofence.
 */
async function handleGeofenceAlerts(res: http.ServerResponse): Promise<void> {
  const result = await query(
    `SELECT
       veiculo_id,
       placa,
       geofence_id,
       geofence_name,
       tipo,
       triggered_at AS timestamp
     FROM geofence_alerts
     ORDER BY triggered_at DESC
     LIMIT 100`
  );

  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(result.rows));
}

/**
 * Handler HTTP para rotas internas (/health, /status-atual, /geofence-alerts).
 */
function createHttpHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = req.url ?? '/';

    // Preflight CORS — browsers enviam OPTIONS antes de fetch cross-origin
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          services: {
            rabbitmq: isRabbitMqConnected() ? 'ok' : 'down',
          },
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    if (req.method === 'GET' && url === '/status-atual') {
      handleStatusAtual(res).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ action: 'status_atual_error', error: message }, 'Error fetching current status');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error', message }));
      });
      return;
    }

    if (req.method === 'GET' && url === '/geofence-alerts') {
      handleGeofenceAlerts(res).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ action: 'geofence_alerts_error', error: message }, 'Error fetching geofence alerts');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error', message }));
      });
      return;
    }

    if (req.method === 'GET' && url === '/metrics') {
      registry.metrics().then((metrics) => {
        res.writeHead(200, { 'Content-Type': registry.contentType });
        res.end(metrics);
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ action: 'metrics_error', error: message }, 'Error generating metrics');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error', message }));
      });
      return;
    }

    // Para rotas não reconhecidas, não responder aqui — deixar o Socket.io processar
    // (evita ERR_HTTP_HEADERS_SENT quando Socket.io também tenta responder)
    if (!url.startsWith('/socket.io') && !url.startsWith('/engine.io')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    }
  };
}

/**
 * Substitui o handler padrão do servidor HTTP criado pelo Socket.io
 * para suportar rotas HTTP adicionais.
 */
function attachHttpRoutes(server: http.Server): void {
  const handler = createHttpHandler();
  // O servidor HTTP do Socket.io já existe; adicionamos listener de request
  server.on('request', handler);
}

/**
 * Graceful shutdown: fecha conexões em ordem inversa de abertura.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ action: 'shutdown_start', signal }, 'Graceful shutdown initiated');

  try {
    await closeRabbitMq();
    await closeSocketServer();
    await closePool();
    logger.info({ action: 'shutdown_complete' }, 'Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ action: 'shutdown_error', error: message }, 'Error during shutdown');
    process.exit(1);
  }
}

/**
 * Entry point principal.
 */
async function main(): Promise<void> {
  logger.info({ action: 'startup' }, 'tracking-worker starting up');

  // 1. Executa migrations (idempotente)
  await runMigrations();

  // 2. Inicializa servidor Socket.io
  const httpServer = initSocketServer();

  // 3. Registra rotas HTTP (/health, /status-atual) no mesmo servidor
  attachHttpRoutes(httpServer);

  // 4. Inicializa conexão RabbitMQ
  await initRabbitMq();

  // 5. Inicia consumo da fila
  await consumeGpsQueue(processGpsEvent);

  logger.info(
    { action: 'startup_complete', port: WORKER_PORT },
    'tracking-worker ready — consuming q.pinheirinho.gps.raw'
  );

  // Graceful shutdown
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ action: 'startup_error', error: message }, 'Fatal error during startup');
  process.exit(1);
});
