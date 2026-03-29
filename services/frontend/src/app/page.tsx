'use client';

import dynamic from 'next/dynamic';
import AlertToaster from '@/components/AlertToaster';
import VehicleList from '@/components/VehicleList';
import ReportExporter from '@/components/ReportExporter';
import { useFleetSocket } from '@/hooks/useFleetSocket';
import { useFleetStore } from '@/store/fleetStore';

// Leaflet does not work with SSR — must be loaded client-side only
const MapMonitor = dynamic(() => import('@/components/MapMonitor'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-slate-900">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <svg
          className="animate-spin h-8 w-8 text-sky-400"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v8H4z"
          />
        </svg>
        <span className="text-sm">Carregando mapa...</span>
      </div>
    </div>
  ),
});

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`relative flex h-2.5 w-2.5 ${connected ? '' : 'opacity-50'}`}
      >
        {connected && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
            connected ? 'bg-green-500' : 'bg-slate-500'
          }`}
        />
      </span>
      <span
        className={`text-xs font-medium uppercase tracking-wider ${
          connected ? 'text-green-400' : 'text-slate-500'
        }`}
      >
        {connected ? 'Conectado' : 'Desconectado'}
      </span>
    </div>
  );
}

export default function DashboardPage() {
  const { connected, vehicleCount } = useFleetSocket();
  const { alerts } = useFleetStore();
  const pendingAlerts = alerts.length;

  return (
    <div className="flex flex-col h-screen bg-slate-950 overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-slate-900 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg
              className="w-6 h-6 text-sky-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
              />
            </svg>
            <h1 className="text-lg font-bold tracking-tight text-slate-100">
              Fleet Track
            </h1>
          </div>
          <span className="text-slate-700">|</span>
          <ConnectionBadge connected={connected} />
        </div>

        <div className="flex items-center gap-3">
          {pendingAlerts > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-red-500/20 border border-red-500/40 rounded-full">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              <span className="text-xs text-red-400 font-medium">
                {pendingAlerts} alerta{pendingAlerts !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          <span className="text-xs text-slate-500">
            Pinheirinho, Curitiba — PR
          </span>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map area */}
        <main className="flex-1 relative overflow-hidden">
          <MapMonitor />
        </main>

        {/* Sidebar */}
        <aside className="w-72 bg-slate-800 border-l border-slate-700 flex flex-col overflow-hidden shrink-0">
          {/* Vehicles header */}
          <div className="px-4 py-3 border-b border-slate-700 shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Veículos
              </h2>
              <span className="text-xs bg-sky-500/20 text-sky-400 border border-sky-500/30 px-2 py-0.5 rounded-full font-mono font-bold">
                {vehicleCount}
              </span>
            </div>
          </div>

          {/* Vehicle list */}
          <div className="flex-1 overflow-y-auto p-3">
            <VehicleList />
          </div>

          {/* Export button */}
          <div className="p-3 border-t border-slate-700 shrink-0">
            <ReportExporter />
          </div>
        </aside>
      </div>

      {/* Alert toaster overlay */}
      <AlertToaster />
    </div>
  );
}
