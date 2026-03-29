import type { GpsEvent } from '../types/index';

export type { GpsEvent };

/**
 * JSON Schema canônico para GpsEvent v1.0.0
 * SSOT: infrastructure/contracts/gps-event.schema.json
 * Compatível com Fastify (ajv) — adiciona $id para referência interna.
 */
export const gpsEventSchema = {
  $id: 'GpsEvent',
  title: 'GpsEvent',
  description:
    'Payload canônico de telemetria GPS para o sistema Fleet Track. SSOT v1.0.0',
  type: 'object',
  required: ['veiculo_id', 'placa', 'lat', 'lng', 'timestamp'],
  additionalProperties: false,
  properties: {
    veiculo_id: {
      type: 'string',
      format: 'uuid',
      description:
        "UUID v4 do veículo. Utilizado como parte da chave de idempotência no Redis: '{veiculo_id}:{timestamp}' com TTL de 5 minutos.",
    },
    placa: {
      type: 'string',
      description: 'Placa do veículo. Aceita formato Mercosul (ABC1D23) ou formato antigo (ABC-1234).',
      pattern: '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$|^[A-Z]{3}-[0-9]{4}$',
    },
    lat: {
      type: 'number',
      description: 'Latitude WGS84. Range: -25.65 a -25.35 (Curitiba).',
      minimum: -25.65,
      maximum: -25.35,
    },
    lng: {
      type: 'number',
      description: 'Longitude WGS84. Range: -49.42 a -49.18 (Curitiba).',
      minimum: -49.42,
      maximum: -49.18,
    },
    velocidade: {
      type: ['number', 'null'],
      description: 'Velocidade instantânea em km/h. null = sensor offline.',
      minimum: 0,
      maximum: 300,
    },
    ignicao: {
      type: ['boolean', 'null'],
      description: 'Estado da ignição. true = ligado, false = desligado, null = sensor indisponível.',
    },
    heading: {
      type: ['integer', 'null'],
      description: 'Direção em graus (0–359). 0 = Norte, 90 = Leste.',
      minimum: 0,
      maximum: 359,
    },
    precisao_metros: {
      type: ['number', 'null'],
      description: 'Precisão GPS em metros. > 50 = sinal degradado.',
      minimum: 0,
    },
    timestamp: {
      type: 'string',
      format: 'date-time',
      description: 'Timestamp de captura em ISO 8601 UTC.',
    },
  },
} as const;

/**
 * Schema Fastify para o body do POST /api/v1/gps
 */
export const postGpsBodySchema = {
  body: gpsEventSchema,
};
