import { toIsoTimestamp } from './timestamps';

describe('toIsoTimestamp', () => {
  it('renders a Date as ISO 8601 with milliseconds', () => {
    const d = new Date('2026-09-03T14:05:06.789Z');
    expect(toIsoTimestamp(d)).toBe('2026-09-03T14:05:06.789Z');
  });

  it('passes a stored string through unchanged', () => {
    expect(toIsoTimestamp('2026-09-03T14:05:06.789Z')).toBe(
      '2026-09-03T14:05:06.789Z',
    );
  });

  it('is undefined for null and undefined', () => {
    expect(toIsoTimestamp(null)).toBeUndefined();
    expect(toIsoTimestamp(undefined)).toBeUndefined();
  });

  it('sorts lexicographically in time order across Date inputs', () => {
    const earlier = toIsoTimestamp(new Date('2026-09-03T23:59:59.000Z'))!;
    const later = toIsoTimestamp(new Date('2026-09-04T00:00:00.001Z'))!;
    expect(earlier < later).toBe(true);
  });
});
