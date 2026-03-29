'use client';

import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useFleetStore } from '@/store/fleetStore';
import { VehiclePosition, GeofenceAlert } from '@/types';

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:3001';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

let socketInstance: Socket | null = null;

function playAlertBeep(): void {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.1);

    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);

    oscillator.onended = () => {
      ctx.close();
    };
  } catch {
    // Web Audio API might not be available in all environments
  }
}

async function syncState(
  setVehicles: (vehicles: Record<string, VehiclePosition>) => void
): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/status-atual`);
    if (!res.ok) return;
    const data = await res.json() as { vehicles: (VehiclePosition & { captured_at?: string })[] };
    const list = Array.isArray(data) ? data : (data.vehicles ?? []);
    const vehicleMap: Record<string, VehiclePosition> = {};
    for (const v of list) {
      vehicleMap[v.veiculo_id] = {
        ...v,
        // /status-atual retorna captured_at; normaliza para timestamp
        timestamp: v.timestamp ?? v.captured_at ?? new Date().toISOString(),
        // PostgreSQL NUMERIC retorna string; converte para number
        velocidade: v.velocidade != null ? parseFloat(String(v.velocidade)) : null,
      };
    }
    setVehicles(vehicleMap);
  } catch {
    // Silently fail — will retry on next reconnect
  }
}

export function useFleetSocket(): { connected: boolean; vehicleCount: number } {
  const { updateVehicle, addAlert, setConnected, setVehicles, connected, vehicles } =
    useFleetStore();

  useEffect(() => {
    if (socketInstance) {
      socketInstance.disconnect();
      socketInstance = null;
    }

    const socket = io(SOCKET_URL, {
      reconnection: true,
      reconnectionDelay: 5000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
    });

    socketInstance = socket;

    socket.on('connect', () => {
      setConnected(true);
      void syncState(setVehicles);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('reconnect', () => {
      setConnected(true);
      void syncState(setVehicles);
    });

    socket.on('posicao_veiculo', (pos: VehiclePosition) => {
      updateVehicle(pos);
    });

    socket.on('alerta_geofence', (alert: GeofenceAlert) => {
      addAlert(alert);
      playAlertBeep();
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('reconnect');
      socket.off('posicao_veiculo');
      socket.off('alerta_geofence');
      socket.disconnect();
      socketInstance = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    connected,
    vehicleCount: Object.keys(vehicles).length,
  };
}
