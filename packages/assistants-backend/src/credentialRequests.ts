import {
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  randomUUID,
  type KeyObject,
} from 'crypto';
import type { Knex } from 'knex';
import type { CredentialsRequest } from '@drewswiredin/backstage-plugin-assistants-common';
import { SecretBox } from './secretBox';

/**
 * Credential requests: a per-user MCP server refused the token the browser
 * sent with the turn (401), so the backend asks the browser for a new one
 * and the call is retried. A provider can revoke a token long before it
 * expires (GitHub App user tokens are revoked when another tab refreshes
 * the sign-in), and only the browser can get the next one.
 *
 * The request shows on the tool call as a preliminary output
 * (`{ _credentialsRequest }`). The browser claims it, so that one tab
 * answers, then posts the new token in the credentials header. Each request
 * is a row in `credential_requests`, so the answer can reach any replica:
 * the replica running the call polls its row. The token in the row is
 * encrypted to a key pair that exists only in that replica's memory, so the
 * database never holds a usable token. Once settled the row keeps only that
 * it was answered, until it expires.
 */

/** How long a request waits for the browser. */
export const CREDENTIAL_REQUEST_TIMEOUT_MS = 30_000;
const POLL_MS = 500;
/** The answer of a browser that couldn't get a token. */
const NONE = 'none';
const SETTLED = 'settled';

interface CredentialRequestRow {
  id: string;
  user_ref: string;
  server_id: string;
  public_key: string;
  claimed: boolean | number;
  response: string | null;
  expires_at: Date | string;
}

export interface CredentialRequestBrokerOptions {
  db: Knex;
  timeoutMs?: number;
  pollMs?: number;
}

export class CredentialRequestBroker {
  private readonly db: Knex;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly waiting = new Map<string, (response: string) => void>();
  private keys?: { publicKey: string; privateKey: KeyObject };

  constructor(options: CredentialRequestBrokerOptions) {
    this.db = options.db;
    this.timeoutMs = options.timeoutMs ?? CREDENTIAL_REQUEST_TIMEOUT_MS;
    this.pollMs = options.pollMs ?? POLL_MS;
  }

  /** This process's key pair, made on first use and never stored. */
  private keyPair() {
    if (!this.keys) {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      this.keys = {
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        privateKey,
      };
    }
    return this.keys;
  }

  /**
   * Ask `userEntityRef`'s browser for a new token for `serverId`. `show`
   * puts the request on the tool call. Resolves with the token, or
   * undefined when the browser has none, doesn't answer in time, or the
   * turn stops (`signal`).
   */
  async request(call: {
    userEntityRef: string;
    serverId: string;
    signal?: AbortSignal;
    show: (request: CredentialsRequest) => void;
  }): Promise<string | undefined> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + this.timeoutMs);
    // Settled requests past their expiry, and rows a crashed replica left.
    await this.db('credential_requests')
      .where('expires_at', '<', new Date(Date.now() - 60_000))
      .delete();
    await this.db('credential_requests').insert({
      id,
      user_ref: call.userEntityRef,
      server_id: call.serverId,
      public_key: this.keyPair().publicKey,
      claimed: false,
      response: null,
      expires_at: expiresAt,
    });
    call.show({ id, server: call.serverId, status: 'open' });
    try {
      const response = await this.wait(id, expiresAt, call.signal);
      return response === undefined ? undefined : this.open(response);
    } finally {
      this.waiting.delete(id);
      await this.db('credential_requests')
        .where({ id })
        .update({ response: SETTLED });
      call.show({ id, server: call.serverId, status: 'settled' });
    }
  }

  /**
   * A browser tab taking the request, before it gets a token: getting one
   * revokes the last, so only the first tab may. 204 for the first claim,
   * 404 for an unknown request, 403 for another user's, 410 otherwise.
   */
  async claim(id: string, userEntityRef: string): Promise<{ status: number }> {
    const row = await this.row(id);
    if (!row) return { status: 404 };
    if (row.user_ref !== userEntityRef) return { status: 403 };
    if (row.response !== null || expired(row)) return { status: 410 };
    const claimed = await this.db('credential_requests')
      .where({ id, claimed: false })
      .update({ claimed: true });
    return { status: claimed === 1 ? 204 : 410 };
  }

  /**
   * The browser's answer: `tokenFor` picks the new token for the request's
   * server out of what the browser sent, or undefined when it got none. 204
   * when taken, 404 for an unknown request, 403 for another user's, 410 for
   * one already answered or expired.
   */
  async respond(
    id: string,
    userEntityRef: string,
    tokenFor: (serverId: string) => string | undefined,
  ): Promise<{ status: number }> {
    const row = await this.row(id);
    if (!row) return { status: 404 };
    if (row.user_ref !== userEntityRef) return { status: 403 };
    if (row.response !== null || expired(row)) return { status: 410 };
    const token = tokenFor(row.server_id);
    const response = token ? seal(row.public_key, token) : NONE;
    const taken = await this.db('credential_requests')
      .where({ id })
      .whereNull('response')
      .update({ response });
    if (taken !== 1) return { status: 410 };
    this.waiting.get(id)?.(response);
    return { status: 204 };
  }

  private async row(id: string): Promise<CredentialRequestRow | undefined> {
    return this.db('credential_requests').where({ id }).first();
  }

  /** The token of a stored response; undefined for none, or one not ours. */
  private open(response: string): string | undefined {
    if (response === NONE || response === SETTLED) return undefined;
    try {
      const [wrapped, sealed] = response.split('|');
      const key = privateDecrypt(
        this.keyPair().privateKey,
        Buffer.from(wrapped, 'base64'),
      );
      return new SecretBox([key]).open(sealed);
    } catch {
      return undefined;
    }
  }

  /** The stored response, or undefined on timeout or when the turn stops. */
  private wait(
    id: string,
    expiresAt: Date,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    return new Promise(resolve => {
      const cleanup: Array<() => void> = [];
      let finished = false;
      const finish = (response: string | undefined) => {
        if (finished) return;
        finished = true;
        cleanup.forEach(fn => fn());
        resolve(response);
      };
      const onAbort = () => finish(undefined);
      this.waiting.set(id, finish);
      const timer = setTimeout(
        () => finish(undefined),
        Math.max(0, expiresAt.getTime() - Date.now()),
      );
      // An answer posted to another replica lands in the row.
      const poll = setInterval(() => {
        this.row(id)
          .then(row => {
            if (row?.response) finish(row.response);
          })
          .catch(() => {});
      }, this.pollMs);
      cleanup.push(
        () => clearTimeout(timer),
        () => clearInterval(poll),
        () => signal?.removeEventListener('abort', onAbort),
      );
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort);
    });
  }
}

function expired(row: CredentialRequestRow): boolean {
  return new Date(row.expires_at).getTime() < Date.now();
}

/** `token` under a one-off key, itself encrypted to `publicKey`. */
function seal(publicKey: string, token: string): string {
  const key = randomBytes(32);
  return `${publicEncrypt(publicKey, key).toString('base64')}|${new SecretBox([
    key,
  ]).seal(token)}`;
}
