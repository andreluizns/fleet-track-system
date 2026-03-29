'use client';

import { useEffect, useRef } from 'react';
import { useFleetStore } from '@/store/fleetStore';
import { ToastAlert } from '@/types';

const MAX_VISIBLE = 5;
const AUTO_DISMISS_MS = 8000;

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface ToastItemProps {
  alert: ToastAlert;
  onDismiss: (id: string) => void;
}

function ToastItem({ alert, onDismiss }: ToastItemProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onDismiss(alert.id);
    }, AUTO_DISMISS_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [alert.id, onDismiss]);

  const isExit = alert.tipo === 'exit';
  const tipoLabel = isExit ? 'Saiu da cerca' : 'Entrou na cerca';

  const bgClass = isExit
    ? 'bg-red-600 border-red-500'
    : 'bg-yellow-600 border-yellow-500';

  const animClass = isExit ? 'animate-pulse' : '';

  return (
    <div
      className={`${bgClass} ${animClass} border rounded-lg p-3 shadow-lg text-white flex items-start justify-between gap-3 min-w-[280px] max-w-[360px]`}
      role="alert"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm">{alert.placa}</span>
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
              isExit ? 'bg-red-800 text-red-100' : 'bg-yellow-800 text-yellow-100'
            }`}
          >
            {tipoLabel}
          </span>
        </div>
        <span className="text-xs opacity-90">{alert.geofence_name}</span>
        <span className="text-xs opacity-75">{formatTime(alert.timestamp)}</span>
      </div>
      <button
        onClick={() => onDismiss(alert.id)}
        className="text-white opacity-75 hover:opacity-100 transition-opacity shrink-0 mt-0.5"
        aria-label="Fechar alerta"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}

export default function AlertToaster() {
  const { alerts, dismissAlert } = useFleetStore();
  const visible = alerts.slice(-MAX_VISIBLE);

  if (visible.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-auto">
      {visible.map((alert) => (
        <ToastItem key={alert.id} alert={alert} onDismiss={dismissAlert} />
      ))}
    </div>
  );
}
