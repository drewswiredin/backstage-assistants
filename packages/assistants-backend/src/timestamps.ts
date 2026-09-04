/**
 * A timestamp column value as an ISO string. Postgres returns a `Date` for
 * `timestamp` columns while SQLite returns the stored text — normalize both to
 * ISO. Critical for portability: a raw `Date.toString()` (e.g.
 * "… GMT-0400 (Eastern Daylight Time)") is NOT valid timestamp input, so a
 * pg `Date` round-tripped through `String()` would be rejected on the next
 * write; it also drops the milliseconds and does not sort lexicographically,
 * which the client relies on when ordering by recency.
 */
export function toIsoTimestamp(v: unknown): string | undefined {
  if (v === null || v === undefined) {
    return undefined;
  }
  if (v instanceof Date) {
    return v.toISOString();
  }
  return String(v);
}
