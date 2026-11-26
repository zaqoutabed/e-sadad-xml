import type { AccessTokenRecord, AccessTokenStore } from '../types';

/**
 * Keeps access tokens in memory. Fine for development and single-server
 * setups; tokens are lost on restart. Expired tokens are removed as new ones
 * are saved.
 */
export class InMemoryAccessTokenStore implements AccessTokenStore {
  private readonly tokens = new Map<string, AccessTokenRecord>();

  saveAccessToken(record: AccessTokenRecord): void {
    const now = Date.now();
    for (const [hash, saved] of this.tokens) {
      if (saved.expiresAt.getTime() <= now) this.tokens.delete(hash);
    }
    this.tokens.set(record.tokenHash, { ...record });
  }

  findAccessToken(tokenHash: string): AccessTokenRecord | undefined {
    const record = this.tokens.get(tokenHash);
    return record ? { ...record } : undefined;
  }
}
