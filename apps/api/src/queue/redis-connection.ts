export const PROPERTY_MATCH_QUEUE = 'property-match';
export const ANALYSIS_QUEUE = 'analysis';

/** BullMQ connection options — shared shape between the API (producer) and
 * the worker (consumer) entrypoints. docs/01 §9 / ADR-0004. */
export function redisConnectionOptions() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
  };
}
