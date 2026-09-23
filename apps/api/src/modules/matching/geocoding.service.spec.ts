import { CensusGeocoderAdapter } from './geocoding.service';

/**
 * Checkpoint 11 follow-up — failure-injection: "Census geocoder unavailable"
 * must degrade to no-coordinate-available, never throw into the matching
 * pipeline (docs/01 §7/§12). This is the actual external boundary
 * (global fetch), mocked directly rather than re-testing MatchingService's
 * internals again.
 */
describe('CensusGeocoderAdapter (failure injection)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns null (not a throw) when the network request itself fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    const adapter = new CensusGeocoderAdapter();
    await expect(adapter.geocode('1 Main St, Worcester, MA')).resolves.toBeNull();
  });

  it('returns null when the geocoder responds with a non-OK status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as any;
    const adapter = new CensusGeocoderAdapter();
    await expect(adapter.geocode('1 Main St, Worcester, MA')).resolves.toBeNull();
  });

  it('returns null when the response body is malformed JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('Unexpected token')),
    }) as any;
    const adapter = new CensusGeocoderAdapter();
    await expect(adapter.geocode('1 Main St, Worcester, MA')).resolves.toBeNull();
  });

  it('returns null when the request is aborted (the same rejection shape the internal 5s timeout produces)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')) as any;
    const adapter = new CensusGeocoderAdapter();
    await expect(adapter.geocode('1 Main St, Worcester, MA')).resolves.toBeNull();
  });
});
