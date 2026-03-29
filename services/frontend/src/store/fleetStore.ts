'use client';

import { create } from 'zustand';
import { VehiclePosition, GeofenceAlert, ToastAlert } from '@/types';

interface FleetStore {
  vehicles: Record<string, VehiclePosition>;
  alerts: ToastAlert[];
  connected: boolean;
  updateVehicle: (pos: VehiclePosition) => void;
  addAlert: (alert: GeofenceAlert) => void;
  dismissAlert: (id: string) => void;
  setConnected: (v: boolean) => void;
  setVehicles: (vehicles: Record<string, VehiclePosition>) => void;
}

export const useFleetStore = create<FleetStore>((set) => ({
  vehicles: {},
  alerts: [],
  connected: false,

  updateVehicle: (pos) =>
    set((state) => ({
      vehicles: { ...state.vehicles, [pos.veiculo_id]: pos },
    })),

  addAlert: (alert) =>
    set((state) => {
      const toastAlert: ToastAlert = {
        ...alert,
        id: `${alert.veiculo_id}-${alert.timestamp}-${Date.now()}`,
      };
      return { alerts: [...state.alerts, toastAlert] };
    }),

  dismissAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.filter((a) => a.id !== id),
    })),

  setConnected: (v) => set({ connected: v }),

  setVehicles: (vehicles) => set({ vehicles }),
}));
