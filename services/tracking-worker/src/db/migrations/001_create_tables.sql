-- Migration 001: Criação das tabelas principais do tracking-worker
-- Requer extensão PostGIS instalada no PostgreSQL

-- Habilita a extensão PostGIS (idempotente)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Tabela de eventos GPS históricos com suporte espacial
CREATE TABLE IF NOT EXISTS gps_events (
  id BIGSERIAL PRIMARY KEY,
  veiculo_id UUID NOT NULL,
  placa VARCHAR(8) NOT NULL,
  location GEOMETRY(Point, 4326) NOT NULL,
  velocidade NUMERIC(6,2),
  ignicao BOOLEAN,
  heading SMALLINT,
  precisao_metros NUMERIC(8,2),
  dentro_da_cerca BOOLEAN NOT NULL DEFAULT true,
  captured_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gps_events_veiculo_id ON gps_events(veiculo_id);
CREATE INDEX IF NOT EXISTS idx_gps_events_captured_at ON gps_events(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_gps_events_location ON gps_events USING GIST(location);

-- Tabela de alertas de geofencing
CREATE TABLE IF NOT EXISTS geofence_alerts (
  id BIGSERIAL PRIMARY KEY,
  veiculo_id UUID NOT NULL,
  placa VARCHAR(8) NOT NULL,
  geofence_id VARCHAR(64) NOT NULL DEFAULT 'pinheirinho',
  geofence_name VARCHAR(128) NOT NULL DEFAULT 'Pinheirinho - Curitiba',
  tipo VARCHAR(8) NOT NULL CHECK (tipo IN ('entry', 'exit')),
  triggered_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geofence_alerts_veiculo_id ON geofence_alerts(veiculo_id);
CREATE INDEX IF NOT EXISTS idx_geofence_alerts_triggered_at ON geofence_alerts(triggered_at DESC);
