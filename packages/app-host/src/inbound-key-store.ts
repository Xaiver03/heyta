import { unwrapInboundKey, wrapInboundKey, type InboundWrappedKey } from '@heyta/inbound-core';
import { inboundKeyScopeSchema, inboundWrappedKeySchema } from '@heyta/shared-schema';
import { META_KEYS, STORES, type DbAdapter } from '@heyta/storage';

export interface InboundRecipientKeyScope {
  accountId: string;
  serverOrigin: string;
  keyEpoch: number;
}

interface StoredInboundRecipientKeyV1 {
  version: 1;
  scope: InboundRecipientKeyScope;
  wrapped: InboundWrappedKey;
}

interface StoredInboundRecipientKeyEntry {
  scope: InboundRecipientKeyScope;
  wrapped: InboundWrappedKey;
}

interface StoredInboundRecipientKeysV2 {
  version: 2;
  entries: Record<string, StoredInboundRecipientKeyEntry>;
}

type StoredInboundRecipientKeys = StoredInboundRecipientKeyV1 | StoredInboundRecipientKeysV2;

const scopeKey = (scope: InboundRecipientKeyScope): string =>
  `${scope.accountId}\u0000${scope.serverOrigin}\u0000${scope.keyEpoch}`;

function normalizeStored(value: unknown): StoredInboundRecipientKeysV2 {
  if (value === undefined) return { version: 2, entries: {} };
  if (value === null || typeof value !== 'object') throw new Error('Invalid stored inbound keys');
  const raw = value as Partial<StoredInboundRecipientKeys>;
  let entries: Record<string, StoredInboundRecipientKeyEntry>;
  if (raw.version === 1 && raw.scope !== undefined && raw.wrapped !== undefined) {
    entries = { [scopeKey(raw.scope)]: { scope: raw.scope, wrapped: raw.wrapped } };
  } else if (raw.version === 2 && raw.entries !== null && typeof raw.entries === 'object' && !Array.isArray(raw.entries)) {
    entries = raw.entries;
  } else throw new Error('Invalid stored inbound keys');
  for (const [key, entry] of Object.entries(entries)) {
    const scope = inboundKeyScopeSchema.safeParse(entry?.scope);
    const wrapped = inboundWrappedKeySchema.safeParse(entry?.wrapped);
    if (!scope.success || !wrapped.success || key !== scopeKey(scope.data) || wrapped.data.keyEpoch !== scope.data.keyEpoch) {
      throw new Error('Invalid stored inbound keys');
    }
  }
  return { version: 2, entries: { ...entries } };
}

/** Persist only a root-wrapped recipient private key in the local meta store. */
export function createInboundRecipientKeyStore(adapter: DbAdapter) {
  return {
    async save(scope: InboundRecipientKeyScope, privateKey: Uint8Array, rootKey: Uint8Array): Promise<void> {
      const wrapped = await wrapInboundKey(privateKey, rootKey, scope);
      await adapter.transaction([STORES.META], 'readwrite', async (tx) => {
        const row = await tx.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.INBOUND_RECIPIENT_KEY);
        const stored = normalizeStored(row?.value);
        const prior = stored.entries[scopeKey(scope)];
        if (prior !== undefined && prior.wrapped.publicKey !== wrapped.publicKey) throw new Error('Inbound recipient epoch already has another key');
        stored.entries[scopeKey(scope)] = { scope: { ...scope }, wrapped };
        await tx.put(STORES.META, { key: META_KEYS.INBOUND_RECIPIENT_KEY, value: stored });
      });
    },
    async load(scope: InboundRecipientKeyScope, rootKey: Uint8Array): Promise<Uint8Array | undefined> {
      const row = await adapter.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.INBOUND_RECIPIENT_KEY);
      const stored = normalizeStored(row?.value);
      const entry = stored?.entries[scopeKey(scope)];
      if (entry === undefined) return undefined;
      return unwrapInboundKey(entry.wrapped, rootKey, scope);
    },
    async clear(): Promise<void> { await adapter.delete(STORES.META, META_KEYS.INBOUND_RECIPIENT_KEY); },
    /** Remove one candidate epoch after a CAS race. Other epochs remain intact. */
    async remove(scope: InboundRecipientKeyScope): Promise<void> {
      await adapter.transaction([STORES.META], 'readwrite', async (tx) => {
        const row = await tx.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.INBOUND_RECIPIENT_KEY);
        const stored = normalizeStored(row?.value);
        const key = scopeKey(scope);
        if (stored.entries[key] === undefined) return;
        const entries = { ...stored.entries };
        delete entries[key];
        if (Object.keys(entries).length === 0) await tx.delete(STORES.META, META_KEYS.INBOUND_RECIPIENT_KEY);
        else await tx.put(STORES.META, { key: META_KEYS.INBOUND_RECIPIENT_KEY, value: { version: 2, entries } });
      });
    },
    /** Re-wrap the existing private key after a Vault root rotation. */
    async rewrap(oldRoot: Uint8Array, newRoot: Uint8Array, binding: Pick<InboundRecipientKeyScope, 'accountId' | 'serverOrigin'>): Promise<boolean> {
      const row = await adapter.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.INBOUND_RECIPIENT_KEY);
      const stored = normalizeStored(row?.value);
      const snapshot = JSON.stringify(row?.value);
      const next: StoredInboundRecipientKeysV2 = { version: 2, entries: { ...stored.entries } };
      let changed = false;
      for (const [key, entry] of Object.entries(stored.entries)) {
        if (entry.scope.accountId !== binding.accountId || entry.scope.serverOrigin !== binding.serverOrigin) continue;
        changed = true;
        const privateKey = await unwrapInboundKey(entry.wrapped, oldRoot, entry.scope);
        try {
          next.entries[key] = { scope: entry.scope, wrapped: await wrapInboundKey(privateKey, newRoot, entry.scope) };
        } finally { privateKey.fill(0); }
      }
      if (!changed) return false;
      // Crypto awaits must stay outside IndexedDB transactions. CAS refuses
      // a concurrent save instead of overwriting its newly stored epoch.
      await adapter.transaction([STORES.META], 'readwrite', async (tx) => {
        const current = await tx.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.INBOUND_RECIPIENT_KEY);
        if (JSON.stringify(current?.value) !== snapshot) throw new Error('Inbound key store changed during rotation');
        await tx.put(STORES.META, { key: META_KEYS.INBOUND_RECIPIENT_KEY, value: next });
      });
      return true;
    },
  };
}
