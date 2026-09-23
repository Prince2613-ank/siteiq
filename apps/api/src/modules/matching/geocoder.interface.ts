/**
 * Provider-agnostic geocoder boundary (client requirement, Checkpoint 6
 * review: "don't make the implementation dependent on Census specifically").
 * MatchingService depends only on this interface + the GEOCODER token —
 * never on CensusGeocoderAdapter directly. Swapping providers later means
 * writing one new class and changing one line in matching.module.ts.
 */
export const GEOCODER = Symbol('GEOCODER');

export interface GeocodeResult {
  lat: number;
  lng: number;
  matchedAddress: string;
}

export interface Geocoder {
  geocode(address: string): Promise<GeocodeResult | null>;
}
