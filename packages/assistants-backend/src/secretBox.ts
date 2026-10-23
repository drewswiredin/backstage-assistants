import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

/**
 * AES-256-GCM encryption for the secrets the plugin stores: users' OAuth
 * tokens for MCP servers, registered client secrets, and PKCE verifiers.
 * Sealed values are `v1.<key id>.<iv>.<tag>.<ciphertext>` (base64url parts);
 * the key id is a short hash of the key, so a value sealed under a previous
 * key still opens after a rotation.
 */
export class SecretBox {
  private readonly keys: Array<{ id: string; key: Buffer }>;

  /** `keys`: 32-byte keys, the current one first. */
  constructor(keys: Buffer[]) {
    if (keys.length === 0) throw new Error('SecretBox needs a key');
    this.keys = keys.map(key => ({
      id: createHash('sha256').update(key).digest('base64url').slice(0, 8),
      key,
    }));
  }

  seal(plaintext: string): string {
    const { id, key } = this.keys[0];
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return [
      'v1',
      id,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  /** The plaintext, or throws when no configured key opens the value. */
  open(sealed: string): string {
    const [version, id, iv, tag, ciphertext] = sealed.split('.');
    const entry = this.keys.find(k => k.id === id);
    if (version !== 'v1' || !entry || ciphertext === undefined) {
      throw new Error('stored secret was sealed with an unknown key');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      entry.key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** True when `sealed` was sealed under a previous key. */
  isStale(sealed: string): boolean {
    return sealed.split('.')[1] !== this.keys[0].id;
  }
}
