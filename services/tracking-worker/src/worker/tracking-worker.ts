import pino from 'pino';
import { isInsidePinheirinho } from '../geofence/pinheirinho';
import { query } from '../db/connection';
import { emitVehiclePosition, emitGeofenceAlert } from '../server/socket-server';
import { publishGeofenceAlert } from '../lib/rabbitmq';
import type { GpsEvent, GeofenceAlert, VehiclePosition } from '../types/index';
import { gpsEventsProcessed, geofenceAlertsTotal, gpsProcessingDuration } from '../lib/metrics';

const logger = pino({ name: 'tracking-worker' });

/**
 * Processa um evento GPS da fila:
 * 1. Calcula geofencing com Turf.js
 * 2. Emite posição via Socket.io (ANTES da persistência para UI responsiva)
 * 3. Persiste em gps_events
 * 4. Se fora da cerca: persiste alerta, publica na fila e emite via Socket.io
 *
 * ACK só ocorre APÓS persistência bem-sucedida (conforme emergency-protocol.md).
 * Em caso de falha de DB, lança erro para que o consumer faça NACK + requeue=true.
 */
export async function processGpsEvent(event: GpsEvent): Promise<void> {
  const start = Date.now();
  const endTimer = gpsProcessingDuration.startTimer();

  // 1. Calcula se está dentro da cerca eletrônica do Pinheirinho
  const dentroDaCerca = isInsidePinheirinho(event.lat, event.lng);

  logger.info(
    {
      action: 'gps_event_processing',
      veiculo_id: event.veiculo_id,
      placa: event.placa,
      lat: event.lat,
      lng: event.lng,
      dentro_da_cerca: dentroDaCerca,
    },
    'Processing GPS event'
  );

  // 2. Emite posição via Socket.io ANTES da persistência (UI responsiva)
  const position: VehiclePosition = {
    veiculo_id: event.veiculo_id,
    placa: event.placa,
    lat: event.lat,
    lng: event.lng,
    velocidade: event.velocidade,
    ignicao: event.ignicao,
    timestamp: event.timestamp,
    dentro_da_cerca: dentroDaCerca,
  };

  emitVehiclePosition(position);

  // 3. Persiste em gps_events (PostGIS)
  // Em caso de falha aqui, o erro se propaga para o consumer → NACK + requeue=true
  await query(
    `INSERT INTO gps_events
      (veiculo_id, placa, location, velocidade, ignicao, heading, precisao_metros, dentro_da_cerca, captured_at)
     VALUES
      ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8, $9, $10)`,
    [
      event.veiculo_id,
      event.placa,
      event.lng,        // ST_MakePoint(lng, lat) — padrão PostGIS (X=lng, Y=lat)
      event.lat,
      event.velocidade ?? null,
      event.ignicao ?? null,
      event.heading ?? null,
      event.precisao_metros ?? null,
      dentroDaCerca,
      event.timestamp,
    ]
  );

  logger.info(
    { action: 'gps_event_persisted', veiculo_id: event.veiculo_id, placa: event.placa },
    'GPS event persisted in gps_events'
  );

  // 4. Se fora da cerca: gera alerta de geofencing
  if (!dentroDaCerca) {
    const alert: GeofenceAlert = {
      veiculo_id: event.veiculo_id,
      placa: event.placa,
      geofence_id: 'pinheirinho',
      geofence_name: 'Pinheirinho - Curitiba',
      tipo: 'exit',
      timestamp: event.timestamp,
    };

    // 4a. Persiste alerta no banco
    await query(
      `INSERT INTO geofence_alerts
        (veiculo_id, placa, geofence_id, geofence_name, tipo, triggered_at)
       VALUES
        ($1, $2, $3, $4, $5, $6)`,
      [
        alert.veiculo_id,
        alert.placa,
        alert.geofence_id,
        alert.geofence_name,
        alert.tipo,
        alert.timestamp,
      ]
    );

    logger.warn(
      {
        action: 'geofence_alert_persisted',
        veiculo_id: alert.veiculo_id,
        placa: alert.placa,
        tipo: alert.tipo,
      },
      'Geofence alert persisted — vehicle outside Pinheirinho'
    );

    // 4b. Publica alerta na fila RabbitMQ
    publishGeofenceAlert(alert);

    // 4c. Emite alerta via Socket.io para o Frontend
    emitGeofenceAlert(alert);

    geofenceAlertsTotal.inc();
  }

  gpsEventsProcessed.inc({ dentro_da_cerca: String(dentroDaCerca) });
  endTimer();

  const latency = Date.now() - start;
  logger.info(
    {
      action: 'gps_event_processed',
      veiculo_id: event.veiculo_id,
      placa: event.placa,
      dentro_da_cerca: dentroDaCerca,
      latency_ms: latency,
    },
    'GPS event processing complete'
  );
}
