import { randomBytes } from 'crypto';
import { SecretBox } from './secretBox';

describe('SecretBox', () => {
  const current = randomBytes(32);
  const previous = randomBytes(32);

  it('round-trips, with a fresh IV each time', () => {
    const box = new SecretBox([current]);
    const a = box.seal('refresh-token');
    expect(a).not.toContain('refresh-token');
    expect(a).not.toBe(box.seal('refresh-token'));
    expect(box.open(a)).toBe('refresh-token');
    expect(box.isStale(a)).toBe(false);
  });

  it('opens values sealed under a previous key and marks them stale', () => {
    const sealed = new SecretBox([previous]).seal('x');
    const rotated = new SecretBox([current, previous]);
    expect(rotated.open(sealed)).toBe('x');
    expect(rotated.isStale(sealed)).toBe(true);
  });

  it('refuses an unknown key and a tampered value', () => {
    const sealed = new SecretBox([previous]).seal('x');
    expect(() => new SecretBox([current]).open(sealed)).toThrow(/unknown key/);
    const parts = new SecretBox([current]).seal('secret').split('.');
    parts[4] = Buffer.from('other!').toString('base64url');
    expect(() => new SecretBox([current]).open(parts.join('.'))).toThrow();
  });
});
