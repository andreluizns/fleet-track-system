export interface GpsEvent {
  veiculo_id: string;          // UUID v4
  placa: string;               // Mercosul (ABC1D23) ou antigo (ABC-1234)
  lat: number;                 // -25.65 a -25.35 (Curitiba)
  lng: number;                 // -49.42 a -49.18 (Curitiba)
  velocidade?: number | null;
  ignicao?: boolean | null;
  heading?: number | null;
  precisao_metros?: number | null;
  timestamp: string;           // ISO 8601 UTC
}

export interface GeofenceAlert {
  veiculo_id: string;
  placa: string;
  geofence_id: string;
  geofence_name: string;
  tipo: 'entry' | 'exit';
  timestamp: string;
}

export interface ViolationReport {
  veiculo_id: string;
  placa: string;
  geofence_id: string;
  duracao_ms: number;
  registrado_em: string;
}

export interface VehiclePosition {
  veiculo_id: string;
  placa: string;
  lat: number;
  lng: number;
  velocidade?: number | null;
  ignicao?: boolean | null;
  timestamp: string;
  dentro_da_cerca: boolean;
}
