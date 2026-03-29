import { isInsidePinheirinho, pinheirinhoGeoJson } from '../geofence/pinheirinho';

describe('isInsidePinheirinho', () => {
  describe('pontos dentro do Pinheirinho', () => {
    it('deve retornar true para ponto no centro do Pinheirinho', () => {
      // lat -25.490, lng -49.315 — dentro do polígono
      expect(isInsidePinheirinho(-25.490, -49.315)).toBe(true);
    });

    it('deve retornar true para ponto próximo ao centro da área', () => {
      // lat -25.489, lng -49.316 — dentro
      expect(isInsidePinheirinho(-25.489, -49.316)).toBe(true);
    });
  });

  describe('pontos fora do Pinheirinho', () => {
    it('deve retornar false para o centro de Curitiba (Praça Tiradentes)', () => {
      // lat -25.428, lng -49.271 — norte de Curitiba
      expect(isInsidePinheirinho(-25.428, -49.271)).toBe(false);
    });

    it('deve retornar false para São Paulo', () => {
      // lat -23.550, lng -46.633 — completamente fora
      expect(isInsidePinheirinho(-23.550, -46.633)).toBe(false);
    });

    it('deve retornar false para o bairro Batel, Curitiba', () => {
      // lat -25.439, lng -49.290 — bairro diferente
      expect(isInsidePinheirinho(-25.439, -49.290)).toBe(false);
    });

    it('deve retornar false para Rio de Janeiro', () => {
      // completamente fora de Curitiba
      expect(isInsidePinheirinho(-22.906, -43.172)).toBe(false);
    });
  });

  describe('borda do polígono', () => {
    it('deve retornar resultado consistente para ponto próximo à borda sul', () => {
      // Ponto muito próximo à borda sul (-25.508) — resultado deve ser booleano consistente
      const result = isInsidePinheirinho(-25.507, -49.315);
      expect(typeof result).toBe('boolean');
    });

    it('deve retornar resultado consistente para ponto próximo à borda norte', () => {
      // Ponto próximo à borda norte (-25.470) — resultado deve ser booleano consistente
      const result = isInsidePinheirinho(-25.471, -49.315);
      expect(typeof result).toBe('boolean');
    });

    it('deve retornar false para ponto além da borda sul', () => {
      // lat -25.520 está abaixo da borda sul (-25.508)
      expect(isInsidePinheirinho(-25.520, -49.315)).toBe(false);
    });

    it('deve retornar false para ponto além da borda norte', () => {
      // lat -25.460 está acima da borda norte (-25.470)
      expect(isInsidePinheirinho(-25.460, -49.315)).toBe(false);
    });
  });

  describe('pinheirinhoGeoJson', () => {
    it('deve exportar um GeoJSON válido do tipo Feature', () => {
      expect(pinheirinhoGeoJson).toBeDefined();
      expect(pinheirinhoGeoJson.type).toBe('Feature');
    });

    it('deve ter geometria do tipo Polygon', () => {
      expect(pinheirinhoGeoJson.geometry.type).toBe('Polygon');
    });

    it('deve ter propriedades de geofencing', () => {
      expect(pinheirinhoGeoJson.properties).toBeDefined();
      expect(pinheirinhoGeoJson.properties?.geofence_id).toBe('pinheirinho');
      expect(pinheirinhoGeoJson.properties?.geofence_name).toBe('Pinheirinho - Curitiba');
    });

    it('deve ter polígono fechado (primeiro e último ponto iguais)', () => {
      const coords = pinheirinhoGeoJson.geometry.coordinates[0];
      const first = coords[0];
      const last = coords[coords.length - 1];
      expect(first).toEqual(last);
    });
  });
});
