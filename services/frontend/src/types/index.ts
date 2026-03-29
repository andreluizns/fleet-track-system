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

export interface GeofenceAlert {
  veiculo_id: string;
  placa: string;
  geofence_id: string;
  geofence_name: string;
  tipo: 'entry' | 'exit';
  timestamp: string;
}

export interface ToastAlert extends GeofenceAlert {
  id: string;
}
