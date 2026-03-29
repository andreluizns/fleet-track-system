// Mocks devem ser declarados antes dos imports do módulo testado

// Mock do módulo de geofencing
jest.mock('../geofence/pinheirinho', () => ({
  isInsidePinheirinho: jest.fn(),
}));

// Mock do módulo de DB
jest.mock('../db/connection', () => ({
  query: jest.fn(),
}));

// Mock do Socket.io server
jest.mock('../server/socket-server', () => ({
  emitVehiclePosition: jest.fn(),
  emitGeofenceAlert: jest.fn(),
}));

// Mock do RabbitMQ
jest.mock('../lib/rabbitmq', () => ({
  publishGeofenceAlert: jest.fn(),
}));

import { processGpsEvent } from '../worker/tracking-worker';
import { isInsidePinheirinho } from '../geofence/pinheirinho';
import { query } from '../db/connection';
import { emitVehiclePosition, emitGeofenceAlert } from '../server/socket-server';
import { publishGeofenceAlert } from '../lib/rabbitmq';
import type { GpsEvent } from '../types/index';

// Cast para jest.Mock para facilitar configuração dos mocks
const mockIsInsidePinheirinho = isInsidePinheirinho as jest.Mock;
const mockQuery = query as jest.Mock;
const mockEmitVehiclePosition = emitVehiclePosition as jest.Mock;
const mockEmitGeofenceAlert = emitGeofenceAlert as jest.Mock;
const mockPublishGeofenceAlert = publishGeofenceAlert as jest.Mock;

// Fixture: evento GPS base
const baseEvent: GpsEvent = {
  veiculo_id: '550e8400-e29b-41d4-a716-446655440000',
  placa: 'ABC1D23',
  lat: -25.490,
  lng: -49.315,
  velocidade: 60,
  ignicao: true,
  heading: 90,
  precisao_metros: 5.2,
  timestamp: '2026-03-28T12:00:00.000Z',
};

describe('processGpsEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Por padrão, query resolve com sucesso
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  describe('evento dentro da cerca (Pinheirinho)', () => {
    beforeEach(() => {
      mockIsInsidePinheirinho.mockReturnValue(true);
    });

    it('deve emitir posicao_veiculo com dentro_da_cerca=true', async () => {
      await processGpsEvent(baseEvent);

      expect(mockEmitVehiclePosition).toHaveBeenCalledTimes(1);
      expect(mockEmitVehiclePosition).toHaveBeenCalledWith(
        expect.objectContaining({
          veiculo_id: baseEvent.veiculo_id,
          placa: baseEvent.placa,
          lat: baseEvent.lat,
          lng: baseEvent.lng,
          dentro_da_cerca: true,
        })
      );
    });

    it('deve persistir evento em gps_events', async () => {
      await processGpsEvent(baseEvent);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO gps_events'),
        expect.arrayContaining([baseEvent.veiculo_id, baseEvent.placa])
      );
    });

    it('NAO deve emitir alerta_geofence', async () => {
      await processGpsEvent(baseEvent);

      expect(mockEmitGeofenceAlert).not.toHaveBeenCalled();
    });

    it('NAO deve publicar alerta no RabbitMQ', async () => {
      await processGpsEvent(baseEvent);

      expect(mockPublishGeofenceAlert).not.toHaveBeenCalled();
    });

    it('NAO deve persistir em geofence_alerts', async () => {
      await processGpsEvent(baseEvent);

      // Apenas 1 query (gps_events), sem query de geofence_alerts
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(callArgs[0]).not.toContain('geofence_alerts');
    });
  });

  describe('evento fora da cerca (saiu do Pinheirinho)', () => {
    const outsideEvent: GpsEvent = {
      ...baseEvent,
      lat: -25.428,
      lng: -49.271, // Centro de Curitiba — fora do Pinheirinho
    };

    beforeEach(() => {
      mockIsInsidePinheirinho.mockReturnValue(false);
    });

    it('deve emitir posicao_veiculo com dentro_da_cerca=false', async () => {
      await processGpsEvent(outsideEvent);

      expect(mockEmitVehiclePosition).toHaveBeenCalledTimes(1);
      expect(mockEmitVehiclePosition).toHaveBeenCalledWith(
        expect.objectContaining({
          veiculo_id: outsideEvent.veiculo_id,
          dentro_da_cerca: false,
        })
      );
    });

    it('deve persistir evento em gps_events', async () => {
      await processGpsEvent(outsideEvent);

      const firstCall = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(firstCall[0]).toContain('INSERT INTO gps_events');
    });

    it('deve persistir alerta em geofence_alerts', async () => {
      await processGpsEvent(outsideEvent);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      const secondCall = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(secondCall[0]).toContain('INSERT INTO geofence_alerts');
    });

    it('deve publicar alerta no RabbitMQ com tipo exit', async () => {
      await processGpsEvent(outsideEvent);

      expect(mockPublishGeofenceAlert).toHaveBeenCalledTimes(1);
      expect(mockPublishGeofenceAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          veiculo_id: outsideEvent.veiculo_id,
          placa: outsideEvent.placa,
          geofence_id: 'pinheirinho',
          geofence_name: 'Pinheirinho - Curitiba',
          tipo: 'exit',
          timestamp: outsideEvent.timestamp,
        })
      );
    });

    it('deve emitir alerta_geofence via Socket.io', async () => {
      await processGpsEvent(outsideEvent);

      expect(mockEmitGeofenceAlert).toHaveBeenCalledTimes(1);
      expect(mockEmitGeofenceAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          veiculo_id: outsideEvent.veiculo_id,
          tipo: 'exit',
        })
      );
    });
  });

  describe('falha de banco de dados', () => {
    beforeEach(() => {
      mockIsInsidePinheirinho.mockReturnValue(true);
    });

    it('deve propagar erro quando INSERT em gps_events falha', async () => {
      const dbError = new Error('connection refused: ECONNREFUSED');
      mockQuery.mockRejectedValueOnce(dbError);

      // O erro deve se propagar para que o consumer faça NACK + requeue=true
      await expect(processGpsEvent(baseEvent)).rejects.toThrow('connection refused: ECONNREFUSED');
    });

    it('deve emitir posicao_veiculo mesmo quando DB falha (Socket.io é chamado antes da persistencia)', async () => {
      const dbError = new Error('DB timeout');
      mockQuery.mockRejectedValueOnce(dbError);

      try {
        await processGpsEvent(baseEvent);
      } catch {
        // esperado
      }

      // Socket.io é chamado ANTES da persistência (regra da squad)
      expect(mockEmitVehiclePosition).toHaveBeenCalledTimes(1);
    });

    it('deve propagar erro quando INSERT em geofence_alerts falha', async () => {
      mockIsInsidePinheirinho.mockReturnValue(false);

      // Primeiro query (gps_events) sucede, segundo (geofence_alerts) falha
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockRejectedValueOnce(new Error('geofence_alerts insert failed'));

      await expect(processGpsEvent(baseEvent)).rejects.toThrow('geofence_alerts insert failed');
    });

    it('NAO deve publicar alerta no RabbitMQ se persistencia de geofence_alerts falhar', async () => {
      mockIsInsidePinheirinho.mockReturnValue(false);

      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockRejectedValueOnce(new Error('DB error'));

      try {
        await processGpsEvent(baseEvent);
      } catch {
        // esperado
      }

      // Alerta NÃO deve ser publicado se a persistência falhou
      expect(mockPublishGeofenceAlert).not.toHaveBeenCalled();
    });
  });

  describe('campos opcionais', () => {
    it('deve processar evento sem campos opcionais', async () => {
      mockIsInsidePinheirinho.mockReturnValue(true);

      const minimalEvent: GpsEvent = {
        veiculo_id: '550e8400-e29b-41d4-a716-446655440001',
        placa: 'XYZ9W87',
        lat: -25.490,
        lng: -49.315,
        timestamp: '2026-03-28T13:00:00.000Z',
      };

      await expect(processGpsEvent(minimalEvent)).resolves.toBeUndefined();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO gps_events'),
        expect.arrayContaining([null, null, null, null]) // campos opcionais como null
      );
    });
  });
});
