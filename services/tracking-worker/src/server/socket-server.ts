import http from 'http';
import { Server } from 'socket.io';
import pino from 'pino';
import type { VehiclePosition, GeofenceAlert } from '../types/index';
import { activeSocketConnections } from '../lib/metrics';

const logger = pino({ name: 'socket-server' });

const WORKER_PORT = parseInt(process.env['WORKER_PORT'] ?? '3001', 10);
const FRONTEND_URL = process.env['FRONTEND_URL'] ?? '*';

let io: Server | null = null;
let httpServer: http.Server | null = null;

/**
 * Inicializa o servidor HTTP + Socket.io.
 * Retorna o servidor HTTP para integração com rotas Express/HTTP nativas.
 */
export function initSocketServer(): http.Server {
  httpServer = http.createServer();

  io = new Server(httpServer, {
    cors: {
      origin: FRONTEND_URL,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    activeSocketConnections.inc();
    logger.info(
      { action: 'socket_connected', socket_id: socket.id },
      'Frontend client connected'
    );

    socket.on('disconnect', (reason: string) => {
      activeSocketConnections.dec();
      logger.info(
        { action: 'socket_disconnected', socket_id: socket.id, reason },
        'Frontend client disconnected'
      );
    });
  });

  httpServer.listen(WORKER_PORT, () => {
    logger.info(
      { action: 'socket_server_started', port: WORKER_PORT, cors_origin: FRONTEND_URL },
      'Socket.io server started'
    );
  });

  return httpServer;
}

/**
 * Retorna a instância do Socket.io (lança erro se não inicializado).
 */
export function getIo(): Server {
  if (!io) {
    throw new Error('Socket.io server not initialized. Call initSocketServer() first.');
  }
  return io;
}

/**
 * Emite a posição atual de um veículo para todos os clientes conectados.
 * Evento: posicao_veiculo
 */
export function emitVehiclePosition(position: VehiclePosition): void {
  if (!io) {
    logger.warn(
      { action: 'socket_emit_skipped', event: 'posicao_veiculo', veiculo_id: position.veiculo_id },
      'Socket.io not initialized — skipping emit'
    );
    return;
  }

  io.emit('posicao_veiculo', position);

  logger.debug(
    {
      action: 'socket_emit',
      event: 'posicao_veiculo',
      veiculo_id: position.veiculo_id,
      placa: position.placa,
      dentro_da_cerca: position.dentro_da_cerca,
    },
    'Vehicle position emitted'
  );
}

/**
 * Emite um alerta de geofence para todos os clientes conectados.
 * Evento: alerta_geofence
 */
export function emitGeofenceAlert(alert: GeofenceAlert): void {
  if (!io) {
    logger.warn(
      { action: 'socket_emit_skipped', event: 'alerta_geofence', veiculo_id: alert.veiculo_id },
      'Socket.io not initialized — skipping emit'
    );
    return;
  }

  io.emit('alerta_geofence', alert);

  logger.info(
    {
      action: 'socket_emit',
      event: 'alerta_geofence',
      veiculo_id: alert.veiculo_id,
      placa: alert.placa,
      tipo: alert.tipo,
      geofence_id: alert.geofence_id,
    },
    'Geofence alert emitted'
  );
}

/**
 * Fecha o servidor Socket.io e HTTP (graceful shutdown).
 */
export async function closeSocketServer(): Promise<void> {
  return new Promise((resolve) => {
    if (io) {
      io.close(() => {
        logger.info({ action: 'socket_server_closed' }, 'Socket.io server closed');
        resolve();
      });
      io = null;
    } else {
      resolve();
    }
  });
}
