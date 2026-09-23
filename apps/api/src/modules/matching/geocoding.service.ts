import { Injectable, Logger } from '@nestjs/common';
import { Geocoder, GeocodeResult } from './geocoder.interface';

/**
 * US Census Bureau geocoder adapter — ONE implementation of the `Geocoder`
 * interface (geocoder.interface.ts). Free, public, no API key, verified
 * reachable and working (docs/05/06). If this needs to be replaced later
 * (a paid provider, a state-run geocoder, etc.), write a new class
 * implementing `Geocoder` and change the binding in matching.module.ts —
 * nothing in matching.service.ts references this class name.
 *
 * Wrapped with a timeout and try/catch per docs/01 §7/§12 — a failure here
 * degrades the matching pipeline to "no coordinate available for spatial
 * search," it never throws up into the job handler or crashes the
 * investigation.
 */
@Injectable()
export class CensusGeocoderAdapter implements Geocoder {
  private readonly logger = new Logger(CensusGeocoderAdapter.name);
  private readonly baseUrl = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

  async geocode(address: string): Promise<GeocodeResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const url = new URL(this.baseUrl);
      url.searchParams.set('address', address);
      url.searchParams.set('benchmark', 'Public_AR_Current');
      url.searchParams.set('format', 'json');

      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) {
        this.logger.warn(`Census geocoder returned ${res.status} for "${address}"`);
        return null;
      }
      const data = await res.json();
      const match = data?.result?.addressMatches?.[0];
      if (!match) return null;

      return {
        lat: match.coordinates.y,
        lng: match.coordinates.x,
        matchedAddress: match.matchedAddress,
      };
    } catch (err) {
      this.logger.warn(`Geocoding failed for "${address}": ${(err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
