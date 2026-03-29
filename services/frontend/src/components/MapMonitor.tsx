'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { useFleetStore } from '@/store/fleetStore';
import { VehiclePosition } from '@/types';

// Pinheirinho geofence perimeter
const PINHEIRINHO_PERIMETER: [number, number][] = [
  [-25.508, -49.333],
  [-25.508, -49.300],
  [-25.470, -49.300],
  [-25.470, -49.333],
  [-25.508, -49.333],
];

function createVehicleIcon(insideFence: boolean, moving: boolean): L.DivIcon {
  const color = insideFence ? '#22c55e' : '#ef4444';

  const pulse = moving ? `
    <circle cx="20" cy="20" r="12" fill="${color}" opacity="0.4">
      <animate attributeName="r" values="12;20;12" dur="1.6s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.4;0;0.4" dur="1.6s" repeatCount="indefinite"/>
    </circle>` : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    ${pulse}
    <circle cx="20" cy="20" r="10" fill="${color}" stroke="white" stroke-width="2"/>
    <circle cx="20" cy="20" r="4" fill="white"/>
  </svg>`;

  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -22],
  });
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface VehicleMarkerProps {
  vehicle: VehiclePosition;
}

function VehicleMarker({ vehicle }: VehicleMarkerProps) {
  const moving = vehicle.velocidade != null && vehicle.velocidade > 0;
  const icon = createVehicleIcon(vehicle.dentro_da_cerca, moving);

  return (
    <Marker position={[vehicle.lat, vehicle.lng]} icon={icon}>
      <Popup>
        <div className="text-slate-900 text-sm min-w-[160px]">
          <p className="font-bold text-base mb-1">{vehicle.placa}</p>
          <p>
            <span className="font-semibold">Status:</span>{' '}
            <span className={vehicle.dentro_da_cerca ? 'text-green-600' : 'text-red-600'}>
              {vehicle.dentro_da_cerca ? 'Dentro da cerca' : 'Fora da cerca'}
            </span>
          </p>
          <p>
            <span className="font-semibold">Velocidade:</span>{' '}
            {vehicle.velocidade != null ? `${vehicle.velocidade.toFixed(0)} km/h` : '—'}
          </p>
          <p>
            <span className="font-semibold">Ignição:</span>{' '}
            {vehicle.ignicao == null ? '—' : vehicle.ignicao ? 'Ligada' : 'Desligada'}
          </p>
          <p className="text-xs text-slate-500 mt-1">{formatTimestamp(vehicle.timestamp)}</p>
        </div>
      </Popup>
    </Marker>
  );
}

export default function MapMonitor() {
  const { vehicles } = useFleetStore();

  useEffect(() => {
    // Import Leaflet CSS on client side only via link element
    const id = 'leaflet-css';
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
  }, []);

  return (
    <MapContainer
      center={[-25.490, -49.315]}
      zoom={14}
      className="w-full h-full"
      style={{ background: '#1e293b' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Polyline
        positions={PINHEIRINHO_PERIMETER}
        pathOptions={{ color: '#38bdf8', weight: 2, opacity: 0.7 }}
      />

      {Object.values(vehicles).map((vehicle) => (
        <VehicleMarker key={vehicle.veiculo_id} vehicle={vehicle} />
      ))}
    </MapContainer>
  );
}
