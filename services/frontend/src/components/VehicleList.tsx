'use client';

import { useFleetStore } from '@/store/fleetStore';
import { VehiclePosition } from '@/types';

function formatSpeed(v?: number | null): string {
  if (v == null) return '— km/h';
  return `${v.toFixed(0)} km/h`;
}

interface VehicleRowProps {
  vehicle: VehiclePosition;
}

function VehicleRow({ vehicle }: VehicleRowProps) {
  const isOutside = !vehicle.dentro_da_cerca;

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
        isOutside
          ? 'border-red-500/50 bg-red-500/10'
          : 'border-slate-700 bg-slate-800/50'
      }`}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-sky-400 text-sm">
            {vehicle.placa}
          </span>
          {isOutside && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
          )}
        </div>
        <span
          className={`text-xs ${isOutside ? 'text-red-400' : 'text-slate-400'}`}
        >
          {isOutside ? 'Fora da cerca' : 'Dentro da cerca'}
        </span>
      </div>

      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className="text-xs text-slate-300">
          {formatSpeed(vehicle.velocidade)}
        </span>
        <span className="text-xs">
          {vehicle.ignicao == null ? (
            <span className="text-slate-500">—</span>
          ) : vehicle.ignicao ? (
            <span className="text-green-400" title="Ignição ligada">
              <svg className="w-4 h-4 inline" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
          ) : (
            <span className="text-slate-500" title="Ignição desligada">
              <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" strokeWidth={2} />
                <path strokeLinecap="round" strokeWidth={2} d="M9 9l6 6M15 9l-6 6" />
              </svg>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

export default function VehicleList() {
  const { vehicles } = useFleetStore();

  const sortedVehicles = Object.values(vehicles).sort((a, b) => {
    if (a.dentro_da_cerca !== b.dentro_da_cerca) {
      return a.dentro_da_cerca ? 1 : -1;
    }
    return a.placa.localeCompare(b.placa);
  });

  if (sortedVehicles.length === 0) {
    return (
      <div className="text-center text-slate-500 py-8 text-sm">
        Nenhum veículo ativo
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {sortedVehicles.map((v) => (
        <VehicleRow key={v.veiculo_id} vehicle={v} />
      ))}
    </div>
  );
}
