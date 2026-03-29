import { polygon, point } from '@turf/helpers';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Feature, Polygon } from '@turf/helpers';

// Polígono aproximado do bairro Pinheirinho, Curitiba - PR
// Coordenadas em [lng, lat] (padrão GeoJSON)
const PINHEIRINHO_COORDINATES: number[][] = [
  [-49.333, -25.508],
  [-49.300, -25.508],
  [-49.300, -25.470],
  [-49.333, -25.470],
  [-49.333, -25.508], // fecha o polígono
];

export const pinheirinhoGeoJson: Feature<Polygon> = polygon([PINHEIRINHO_COORDINATES], {
  geofence_id: 'pinheirinho',
  geofence_name: 'Pinheirinho - Curitiba',
  regiao: 'Curitiba - PR',
});

/**
 * Verifica se um ponto (lat, lng) está dentro do polígono do Pinheirinho.
 * @param lat Latitude WGS84
 * @param lng Longitude WGS84
 * @returns true se o ponto estiver dentro da cerca, false caso contrário
 */
export function isInsidePinheirinho(lat: number, lng: number): boolean {
  const pt = point([lng, lat]);
  return booleanPointInPolygon(pt, pinheirinhoGeoJson);
}
