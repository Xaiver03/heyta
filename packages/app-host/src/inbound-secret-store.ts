import { unwrapInboundKey, wrapInboundKey } from '@heyta/inbound-core';
import { META_KEYS, STORES, type DbAdapter } from '@heyta/storage';
import type { AutomationCommitJournal, AutomationWorkerCredential, AutomationWorkerSecretStore } from './inbound-worker.js';

interface StoredCredential {
  version: 1;
  credential: Omit<AutomationWorkerCredential, 'workerToken'>;
  wrappedToken: Awaited<ReturnType<typeof wrapInboundKey>>;
}
const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const unhex = (value: string): Uint8Array | undefined => {
  if (!/^[0-9a-f]{64}$/.test(value)) return undefined;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/**
 * Portable durable store for hosts that can provide a Vault root. Native
 * shells may replace it with Keychain/Keystore, while Web/Node can use the
 * same shape without ever putting the worker token in an op or sync payload.
 */
export function createVaultWrappedAutomationWorkerStore(adapter: DbAdapter, rootKey: () => Promise<Uint8Array | undefined>): AutomationWorkerSecretStore {
  const scope = (credential: Pick<AutomationWorkerCredential, 'userId' | 'serverOrigin'>) => ({
    accountId: credential.userId, serverOrigin: credential.serverOrigin, keyEpoch: 1,
  });
  return {
    async load(binding) {
      const row = await adapter.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.INBOUND_WORKER_CREDENTIAL);
      const stored = row?.value as Partial<StoredCredential> | undefined;
      if (!stored || stored.version !== 1 || !stored.credential || stored.credential.userId !== binding.userId ||
          stored.credential.clientId !== binding.clientId || stored.credential.serverOrigin !== binding.serverOrigin || stored.wrappedToken === undefined) return undefined;
      const root = await rootKey();
      if (!root) return undefined;
      try {
        const token = await unwrapInboundKey(stored.wrappedToken, root, scope(stored.credential));
        const workerToken = hex(token);
        token.fill(0);
        return { ...stored.credential, workerToken };
      } catch { return undefined; }
      finally { root.fill(0); }
    },
    async save(credential) {
      const token = unhex(credential.workerToken);
      if (!token) throw new Error('Invalid worker token');
      let root: Uint8Array | undefined;
      try {
        root = await rootKey();
        if (!root) throw new Error('Vault is locked');
        const wrappedToken = await wrapInboundKey(token, root, scope(credential));
        await adapter.put(STORES.META, { key: META_KEYS.INBOUND_WORKER_CREDENTIAL, value: {
          version: 1,
          credential: { workerId: credential.workerId, userId: credential.userId, clientId: credential.clientId,
            databaseEpoch: credential.databaseEpoch, serverOrigin: credential.serverOrigin },
          wrappedToken,
        } satisfies StoredCredential });
      } finally { token.fill(0); root?.fill(0); }
    },
    async clear(binding) {
      // Erasure must work while locked and must not delete a replacement
      // credential that was saved between a separate load and delete.
      await adapter.transaction([STORES.META], 'readwrite', async (tx) => {
        const row = await tx.get<{ key: string; value: StoredCredential }>(STORES.META, META_KEYS.INBOUND_WORKER_CREDENTIAL);
        const current = row?.value?.credential;
        if (current?.userId === binding.userId && current.clientId === binding.clientId && current.serverOrigin === binding.serverOrigin) {
          await tx.delete(STORES.META, META_KEYS.INBOUND_WORKER_CREDENTIAL);
        }
      });
    },
    /** Re-wrap the token during a Vault root rotation without exposing it to a host. */
    async rewrap(binding: { userId: string; clientId: string; serverOrigin: string }, oldRoot: Uint8Array, newRoot: Uint8Array): Promise<boolean> {
      const row = await adapter.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.INBOUND_WORKER_CREDENTIAL);
      const stored = row?.value as Partial<StoredCredential> | undefined;
      const snapshot = JSON.stringify(row?.value);
      if (!stored || stored.version !== 1 || !stored.credential || stored.wrappedToken === undefined ||
          stored.credential.userId !== binding.userId || stored.credential.clientId !== binding.clientId ||
          stored.credential.serverOrigin !== binding.serverOrigin) return false;
      const token = await unwrapInboundKey(stored.wrappedToken, oldRoot, scope(stored.credential));
      try {
        const wrappedToken = await wrapInboundKey(token, newRoot, scope(stored.credential));
        await adapter.transaction([STORES.META], 'readwrite', async (tx) => {
          const current = await tx.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.INBOUND_WORKER_CREDENTIAL);
          if (JSON.stringify(current?.value) !== snapshot) throw new Error('Inbound worker changed during rotation');
          await tx.put(STORES.META, { key: META_KEYS.INBOUND_WORKER_CREDENTIAL, value: {
            version: 1, credential: stored.credential!, wrappedToken,
          } satisfies StoredCredential });
        });
        return true;
      } finally { token.fill(0); }
    },
  };
}

/** Plain opaque receipt journal; it contains no task content or credentials. */
export function createInboundCommitJournal(adapter: DbAdapter): AutomationCommitJournal {
  type Journal = Record<string, string>;
  const parse = (value: unknown): Journal => {
    if (value === undefined) return Object.create(null) as Journal;
    if (value === null || typeof value !== 'object' || Array.isArray(value) ||
        Object.values(value).some((proof) => typeof proof !== 'string')) throw new Error('Invalid inbound commit journal');
    return Object.assign(Object.create(null) as Journal, value);
  };
  return {
    async load(eventId) {
      const row = await adapter.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.INBOUND_COMMIT_JOURNAL);
      return parse(row?.value)[eventId];
    },
    async save(eventId, proof) {
      await adapter.transaction([STORES.META], 'readwrite', async (tx) => {
        const row = await tx.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.INBOUND_COMMIT_JOURNAL);
        const journal = parse(row?.value); journal[eventId] = proof;
        await tx.put(STORES.META, { key: META_KEYS.INBOUND_COMMIT_JOURNAL, value: journal });
      });
    },
    async remove(eventId) {
      await adapter.transaction([STORES.META], 'readwrite', async (tx) => {
        const row = await tx.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.INBOUND_COMMIT_JOURNAL);
        const journal = parse(row?.value); delete journal[eventId];
        await tx.put(STORES.META, { key: META_KEYS.INBOUND_COMMIT_JOURNAL, value: journal });
      });
    },
  };
}
