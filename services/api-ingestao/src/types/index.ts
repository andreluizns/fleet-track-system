export interface GpsEvent {
  veiculo_id: string;       // UUID v4
  placa: string;            // Mercosul (ABC1D23) ou antigo (ABC-1234)
  lat: number;              // -25.65 a -25.35 (Curitiba)
  lng: number;              // -49.42 a -49.18 (Curitiba)
  velocidade?: number | null;
  ignicao?: boolean | null;
  heading?: number | null;
  precisao_metros?: number | null;
  timestamp: string;        // ISO 8601 UTC
}

export interface HealthStatus {
  status: 'ok' | 'degraded';
  services: {
    redis: 'ok' | 'down';
    rabbitmq: 'ok' | 'down';
  };
}

export interface IngestaoResponse {
  status: 'accepted' | 'duplicate';
  message?: string;
  veiculo_id?: string;
  timestamp?: string;
}
