import {
  vaultKeyMigrationChunkSchema,
  vaultKeyMigrationManifestSchema,
  vaultKeyMigrationRequestIdSchema,
  vaultKeyMigrationStageResponseSchema,
  type VaultKeyMigrationChunk,
  type VaultKeyMigrationManifest,
  type VaultKeyMigrationResponse,
  type VaultKeyMigrationStageResponse,
  vaultKeyMigrationInventoryPageSchema,
  type VaultKeyMigrationInventoryPage,
} from '@heyta/shared-schema';
import {
  createVaultPayloadCipher,
  type SyncPayloadIdentity,
} from '@heyta/sync-client';
import { vaultRootKeyFingerprint, type VaultKeyPackage } from '@heyta/sync-core';
import { META_KEYS, STORES, type DbAdapter } from '@heyta/storage';
import { randomId } from './ids.js';
import { joinEndpointUrl } from './endpoint-url.js';

/**
 * The migration inventory is a server-owned view.  A host must not replace it
 * with `getAllOps()` from its local store: drained operations are precisely the
 * records this flow is meant to cover.
 */
export interface VaultMigrationInventoryOperation extends SyncPayloadIdentity {
  serverSeq: number;
  payload: string;
  causalFullState: boolean;
}

export interface VaultMigrationInventorySnapshot {
  /** True means the server still has a retained snapshot boundary. */
  present: boolean;
  lastSnapshotSeq?: number;
  /** A retained causal full-state op proves the cache can be rebuilt after publish. */
  replayBaseServerSeq?: number;
}

export interface VaultMigrationInventoryPage {
  operations: VaultMigrationInventoryOperation[];
  latestSeq: number;
  /** First retained operation sequence, or latestSeq + 1 for an empty history. */
  retainedFromSeq: number;
  complete: boolean;
  nextCursor?: string;
  snapshot: VaultMigrationInventorySnapshot;
}

export interface VaultMigrationJournalRecord {
  /** Canonical authenticated account/server scope; never infer this from clientId. */
  scope: string;
  requestId: string;
  manifest: VaultKeyMigrationManifest;
  /** Ciphertext-only chunks. This record contains no root, password, or plaintext. */
  chunks: VaultKeyMigrationChunk[];
}

export interface VaultMigrationJournal {
  /** With no request id, return the sole unfinished migration for this scope. */
  load(scope: string, requestId?: string): Promise<VaultMigrationJournalRecord | undefined>;
  save(record: VaultMigrationJournalRecord): Promise<void>;
  clear(scope: string, requestId: string): Promise<void>;
}

/** IndexedDB/SQLite durable journal. It stores only encrypted chunks. */
export const createVaultMigrationJournal = (adapter: DbAdapter): VaultMigrationJournal => ({
  async load(scope, requestId) {
    const record = await adapter.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.VAULT_MIGRATION_JOURNAL);
    if (!record || typeof record.value !== 'object' || record.value === null || Array.isArray(record.value)) return undefined;
    const value = record.value as Record<string, unknown>;
    if (typeof value.scope !== 'string' || typeof value.requestId !== 'string' ||
        value.scope !== scope || (requestId !== undefined && value.requestId !== requestId)) return undefined;
    const storedRequestId = value.requestId;
    const manifest = vaultKeyMigrationManifestSchema.safeParse(value.manifest);
    if (!manifest.success || !Array.isArray(value.chunks)) throw new Error('Invalid persisted vault migration journal');
    const chunks = value.chunks.map((chunk) => vaultKeyMigrationChunkSchema.safeParse(chunk));
    if (chunks.some((chunk) => !chunk.success)) throw new Error('Invalid persisted vault migration journal');
    return {
      scope,
      requestId: storedRequestId,
      manifest: manifest.data,
      chunks: chunks.filter((chunk): chunk is { success: true; data: VaultKeyMigrationChunk } => chunk.success).map((chunk) => chunk.data),
    };
  },
  async save(record) {
    if (!vaultKeyMigrationRequestIdSchema.safeParse(record.requestId).success ||
        typeof record.scope !== 'string' || record.scope.length === 0 || record.scope.length > 512) {
      throw new Error('Invalid vault migration journal scope');
    }
    const manifest = vaultKeyMigrationManifestSchema.safeParse(record.manifest);
    if (!manifest.success || record.chunks.some((chunk) => !vaultKeyMigrationChunkSchema.safeParse(chunk).success)) {
      throw new Error('Invalid vault migration journal');
    }
    // JSON clone prevents later caller mutation from changing the bytes that
    // make a chunk retry idempotent.
    const value = JSON.parse(JSON.stringify({
      scope: record.scope,
      requestId: record.requestId,
      manifest: manifest.data,
      chunks: record.chunks,
    })) as unknown;
    await adapter.put(STORES.META, { key: META_KEYS.VAULT_MIGRATION_JOURNAL, value });
  },
  async clear(scope, requestId) {
    const current = await adapter.get<{ key: string; value: unknown }>(STORES.META, META_KEYS.VAULT_MIGRATION_JOURNAL);
    if (!current || typeof current.value !== 'object' || current.value === null) return;
    const value = current.value as Record<string, unknown>;
    if (value.scope === scope && value.requestId === requestId) {
      await adapter.delete(STORES.META, META_KEYS.VAULT_MIGRATION_JOURNAL);
    }
  },
});

export interface VaultMigrationInventorySource {
  getPage(cursor?: string): Promise<VaultMigrationInventoryPage>;
}

export interface VaultKeyMigrationRemote {
  begin(manifest: VaultKeyMigrationManifest): Promise<VaultKeyMigrationStageResponse>;
  uploadChunk(chunk: VaultKeyMigrationChunk): Promise<VaultKeyMigrationStageResponse>;
  status(requestId: string): Promise<VaultKeyMigrationStageResponse>;
  commit(requestId: string): Promise<VaultKeyMigrationStageResponse>;
  cancel(requestId: string): Promise<VaultKeyMigrationStageResponse>;
}

export interface VaultMigrationProgress {
  phase: 'inventory' | 'encrypting' | 'staging' | 'committing';
  completed: number;
  total: number;
}

export interface VaultMigrationOptions {
  inventory: VaultMigrationInventorySource;
  remote: VaultKeyMigrationRemote;
  /** The package that will be published atomically with the new payloads. */
  package: VaultKeyPackage;
  expectedKeyVersion: number;
  expectedLatestSeq?: number;
  /** Null means the retained payloads are legacy password ciphertexts. */
  currentPayloadKeyVersion: number | null;
  targetPayloadKeyVersion: number;
  currentRootKey: Uint8Array;
  targetRootKey: Uint8Array;
  /** Required when the retained inventory contains legacy password payloads. */
  legacyPassword?: string;
  requestId?: string;
  /** Durable ciphertext-only journal. Required for cross-process resume. */
  journal: VaultMigrationJournal;
  /** Stable account/server scope used to bind the journal. */
  journalScope: string;
  /** Keep below the server's 32 MiB payload budget to leave HTTP body headroom. */
  maxChunkPayloadBytes?: number;
  /**
   * The low-level orchestrator historically acknowledged a published
   * migration itself. Production hosts disable that behaviour so the journal
   * remains durable until the new package/root has been installed locally.
   */
  clearJournalOnPublished?: boolean;
  onProgress?: (progress: VaultMigrationProgress) => void;
}

export class VaultMigrationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_inventory'
      | 'snapshot_boundary'
      | 'inventory_changed'
      | 'invalid_key'
      | 'migration_failed',
  ) {
    super(message);
    this.name = 'VaultMigrationError';
  }
}

const DEFAULT_CHUNK_PAYLOAD_BYTES = 24 * 1024 * 1024;
const MAX_CHUNK_OPERATIONS = 1_000;

const jsonBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value ?? null) ?? 'null').byteLength;

const assertSafeNonNegative = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new VaultMigrationError(`Invalid ${name} in migration inventory`, 'invalid_inventory');
  }
};

const assertIdentity = (operation: VaultMigrationInventoryOperation): void => {
  if (!operation.id || !operation.clientId || !operation.actionType || !operation.opType ||
      !operation.entityType || !Number.isSafeInteger(operation.timestamp) ||
      !Number.isSafeInteger(operation.schemaVersion)) {
    throw new VaultMigrationError('Migration inventory contains incomplete operation identity', 'invalid_inventory');
  }
};

const collectInventory = async (
  source: VaultMigrationInventorySource,
  onProgress?: VaultMigrationOptions['onProgress'],
): Promise<{ operations: VaultMigrationInventoryOperation[]; latestSeq: number }> => {
  const operations: VaultMigrationInventoryOperation[] = [];
  const ids = new Set<string>();
  const sequences = new Set<number>();
  let cursor: string | undefined;
  let latestSeq: number | undefined;
  let retainedFromSeq: number | undefined;
  let previousSeq = 0;
  let pageCount = 0;
  let snapshot: VaultMigrationInventorySnapshot | undefined;

  for (;;) {
    const page = await source.getPage(cursor);
    pageCount += 1;
    if (pageCount > 1_000_000) {
      throw new VaultMigrationError('Migration inventory pagination did not terminate', 'invalid_inventory');
    }
    const parsedPage = vaultKeyMigrationInventoryPageSchema.safeParse(page);
    if (!parsedPage.success) {
      throw new VaultMigrationError('Malformed migration inventory page', 'invalid_inventory');
    }
    const validatedPage = parsedPage.data;
    if (!Array.isArray(validatedPage.operations) || typeof validatedPage.complete !== 'boolean' ||
        typeof validatedPage.snapshot !== 'object' || validatedPage.snapshot === null ||
        typeof validatedPage.snapshot.present !== 'boolean') {
      throw new VaultMigrationError('Malformed migration inventory page', 'invalid_inventory');
    }
    assertSafeNonNegative(validatedPage.latestSeq, 'latestSeq');
    assertSafeNonNegative(validatedPage.retainedFromSeq, 'retainedFromSeq');
    if (latestSeq === undefined) latestSeq = validatedPage.latestSeq;
    if (latestSeq !== validatedPage.latestSeq) {
      throw new VaultMigrationError('Server history changed during migration inventory', 'inventory_changed');
    }
    if (retainedFromSeq === undefined) retainedFromSeq = validatedPage.retainedFromSeq;
    if (retainedFromSeq !== validatedPage.retainedFromSeq) {
      throw new VaultMigrationError('Server retained-history boundary changed during inventory', 'inventory_changed');
    }
    if (snapshot === undefined) snapshot = validatedPage.snapshot;
    else if (JSON.stringify(snapshot) !== JSON.stringify(validatedPage.snapshot)) {
      throw new VaultMigrationError('Migration snapshot boundary changed during inventory', 'inventory_changed');
    }
    if (validatedPage.nextCursor !== undefined && validatedPage.nextCursor === cursor) {
      throw new VaultMigrationError('Migration inventory cursor did not advance', 'invalid_inventory');
    }
    for (const operation of validatedPage.operations) {
      assertIdentity(operation);
      if (!Number.isSafeInteger(operation.serverSeq) || operation.serverSeq <= previousSeq ||
          typeof operation.payload !== 'string' || operation.payload.length === 0) {
        throw new VaultMigrationError('Migration inventory operations are not strictly ordered', 'invalid_inventory');
      }
      if (ids.has(operation.id) || sequences.has(operation.serverSeq)) {
        throw new VaultMigrationError('Migration inventory contains duplicate operation identity', 'invalid_inventory');
      }
      ids.add(operation.id);
      sequences.add(operation.serverSeq);
      previousSeq = operation.serverSeq;
      operations.push(operation);
    }
    onProgress?.({ phase: 'inventory', completed: operations.length, total: operations.length });
    if (validatedPage.complete) {
      if (validatedPage.nextCursor !== undefined) {
        throw new VaultMigrationError('Complete inventory unexpectedly returned a cursor', 'invalid_inventory');
      }
      break;
    }
    if (validatedPage.nextCursor === undefined) {
      throw new VaultMigrationError('Incomplete migration inventory omitted its cursor', 'invalid_inventory');
    }
    cursor = validatedPage.nextCursor;
  }

  const resolvedLatestSeq = latestSeq ?? 0;
  if (operations.length > 0 && retainedFromSeq !== undefined &&
      operations[0]!.serverSeq !== retainedFromSeq) {
    throw new VaultMigrationError('Migration inventory does not start at the retained-history boundary', 'invalid_inventory');
  }
  if (snapshot?.present &&
      (snapshot.replayBaseServerSeq === undefined ||
       operations[0]?.serverSeq !== snapshot.replayBaseServerSeq ||
       operations[0]?.causalFullState !== true)) {
    throw new VaultMigrationError('Server returned a snapshot without a retained causal replay base', 'snapshot_boundary');
  }
  if (operations.length > 0 && operations[operations.length - 1]!.serverSeq > resolvedLatestSeq) {
    throw new VaultMigrationError('Migration inventory contains an operation beyond latestSeq', 'invalid_inventory');
  }
  if (operations.length === 0 && resolvedLatestSeq > 0 && (retainedFromSeq ?? 0) <= resolvedLatestSeq) {
    throw new VaultMigrationError('Empty inventory does not explain the retained history boundary', 'invalid_inventory');
  }
  return { operations, latestSeq: resolvedLatestSeq };
};

const toIdentity = (operation: VaultMigrationInventoryOperation): SyncPayloadIdentity => ({
  id: operation.id,
  clientId: operation.clientId,
  actionType: operation.actionType,
  opType: operation.opType,
  entityType: operation.entityType,
  ...(operation.entityId !== undefined ? { entityId: operation.entityId } : {}),
  ...(operation.entityIds !== undefined ? { entityIds: operation.entityIds } : {}),
  timestamp: operation.timestamp,
  schemaVersion: operation.schemaVersion,
});

const validateStage = (
  stage: VaultKeyMigrationStageResponse,
  expectedRequestId: string,
): VaultKeyMigrationStageResponse => {
  const parsed = vaultKeyMigrationStageResponseSchema.safeParse(stage);
  if (!parsed.success) throw new VaultMigrationError('Malformed key migration stage response', 'migration_failed');
  if (parsed.data.requestId !== expectedRequestId) {
    throw new VaultMigrationError('Key migration stage response request id does not match the request', 'migration_failed');
  }
  return parsed.data;
};

/**
 * Re-encrypt and stage a complete server inventory. Root keys and plaintext
 * never cross the transport and no intermediate record is written to storage.
 * A dropped commit response is recovered by querying the same requestId.
 */
export async function migrateVaultPayloads(options: VaultMigrationOptions): Promise<VaultKeyMigrationResponse> {
  if (options.currentRootKey.length !== 32 || options.targetRootKey.length !== 32) {
    throw new VaultMigrationError('Vault root keys must be 32 bytes', 'invalid_key');
  }
  const maxChunkPayloadBytes = options.maxChunkPayloadBytes ?? DEFAULT_CHUNK_PAYLOAD_BYTES;
  if (!Number.isSafeInteger(maxChunkPayloadBytes) || maxChunkPayloadBytes <= 0 || maxChunkPayloadBytes > 32 * 1024 * 1024) {
    throw new VaultMigrationError('Invalid migration chunk byte budget', 'invalid_inventory');
  }
  if (!options.journalScope || options.journalScope.length > 512) {
    throw new VaultMigrationError('Invalid migration journal scope', 'invalid_inventory');
  }
  const priorByScope = options.requestId === undefined
    ? await options.journal.load(options.journalScope)
    : undefined;
  const requestId = options.requestId ?? priorByScope?.requestId ?? randomId();
  const prior = priorByScope ?? await options.journal.load(options.journalScope, requestId);
  if (prior !== undefined) {
    if (prior.scope !== options.journalScope || prior.requestId !== requestId) {
      throw new VaultMigrationError('Migration journal scope mismatch', 'invalid_inventory');
    }
    // A journal is the sole resume source after a process restart. It is
    // intentionally checked before inventory/decryption so ciphertext and its
    // nonce are reused byte-for-byte rather than randomly re-encrypted.
    const journalMatchesRequest = JSON.stringify(prior.manifest.package) === JSON.stringify(options.package) &&
      prior.manifest.expectedKeyVersion === options.expectedKeyVersion &&
      prior.manifest.targetPayloadKeyVersion === options.targetPayloadKeyVersion;
    if (!journalMatchesRequest) {
      // A process can die after saveBound() commits the new package but before
      // the host acknowledges the journal. There is then no pending draft,
      // and a subsequent rotation must not be blocked by that completed old
      // request. Only self-heal when all local-generation evidence matches
      // the old manifest *and* the authenticated server says it is PUBLISHED.
      const priorWasInstalled = options.requestId === undefined &&
        prior.manifest.package.keyVersion === options.expectedKeyVersion &&
        prior.manifest.targetPayloadKeyVersion === options.currentPayloadKeyVersion &&
        vaultRootKeyFingerprint(options.currentRootKey) === prior.manifest.package.rootKeyFingerprint;
      if (priorWasInstalled) {
        try {
          const published = validateStage(await options.remote.status(prior.requestId), prior.requestId);
          if (published.state === 'PUBLISHED' &&
              published.requestId === prior.requestId &&
              published.keyVersion === prior.manifest.package.keyVersion &&
              published.payloadKeyVersion === prior.manifest.targetPayloadKeyVersion) {
            await options.journal.clear(options.journalScope, prior.requestId);
            return migrateVaultPayloads(options);
          }
        } catch {
          // Keep the journal on an unavailable/malformed status response;
          // clearing it without server confirmation would lose resumability.
        }
      }
      throw new VaultMigrationError('Migration journal does not match the requested key transition', 'inventory_changed');
    }
    let resumedStage = validateStage(await options.remote.begin(prior.manifest), requestId);
    if (resumedStage.state === 'PUBLISHED') {
      if (options.clearJournalOnPublished !== false) {
        await options.journal.clear(options.journalScope, requestId);
      }
      return {
        requestId: resumedStage.requestId,
        keyVersion: resumedStage.keyVersion,
        payloadKeyVersion: resumedStage.payloadKeyVersion,
        latestSeq: resumedStage.latestSeq,
        migratedOperationCount: resumedStage.migratedOperationCount,
      };
    }
    for (const chunk of prior.chunks) {
      resumedStage = validateStage(await options.remote.uploadChunk(chunk), requestId);
    }
    try {
      resumedStage = validateStage(await options.remote.commit(requestId), requestId);
    } catch (error) {
      resumedStage = validateStage(await options.remote.status(requestId), requestId);
      if (resumedStage.state !== 'PUBLISHED') throw error;
    }
    if (resumedStage.state !== 'PUBLISHED') {
      throw new VaultMigrationError('Server did not publish the resumed key migration', 'migration_failed');
    }
    if (options.clearJournalOnPublished !== false) {
      await options.journal.clear(options.journalScope, requestId);
    }
    return {
      requestId: resumedStage.requestId,
      keyVersion: resumedStage.keyVersion,
      payloadKeyVersion: resumedStage.payloadKeyVersion,
      latestSeq: resumedStage.latestSeq,
      migratedOperationCount: resumedStage.migratedOperationCount,
    };
  }
  const inventory = await collectInventory(options.inventory, options.onProgress);
  const expectedLatestSeq = options.expectedLatestSeq ?? inventory.latestSeq;
  if (expectedLatestSeq !== inventory.latestSeq) {
    throw new VaultMigrationError('Migration expectedLatestSeq does not match server inventory', 'inventory_changed');
  }
  if (!Number.isSafeInteger(options.expectedKeyVersion) || options.expectedKeyVersion < 0 ||
      options.package.keyVersion !== options.expectedKeyVersion + 1 ||
      !Number.isSafeInteger(options.targetPayloadKeyVersion) || options.targetPayloadKeyVersion <= 0) {
    throw new VaultMigrationError('Migration key versions are not a single forward step', 'invalid_key');
  }

  const sourceCipher = createVaultPayloadCipher({
    current: {
      keyVersion: options.currentPayloadKeyVersion ?? 1,
      rootKey: options.currentRootKey,
    },
    ...(options.legacyPassword !== undefined ? { legacyPassword: options.legacyPassword } : {}),
  });
  const targetCipher = createVaultPayloadCipher({
    current: { keyVersion: options.targetPayloadKeyVersion, rootKey: options.targetRootKey },
  });

  const replacements: VaultKeyMigrationChunk['operations'] = [];
  let expectedPayloadBytes = 0;
  for (let index = 0; index < inventory.operations.length; index += 1) {
    const operation = inventory.operations[index]!;
    const identity = toIdentity(operation);
    let plaintext: string;
    try {
      plaintext = await sourceCipher.decrypt(operation.payload, identity);
      const payload = await targetCipher.encrypt(plaintext, identity);
      replacements.push({ id: operation.id, serverSeq: operation.serverSeq, payload });
      expectedPayloadBytes += jsonBytes(payload);
    } catch (error) {
      const wrapped = new VaultMigrationError(`Could not re-encrypt operation ${operation.id}`, 'migration_failed');
      (wrapped as Error & { cause?: unknown }).cause = error;
      throw wrapped;
    }
    options.onProgress?.({ phase: 'encrypting', completed: index + 1, total: inventory.operations.length });
  }

  const manifest: VaultKeyMigrationManifest = vaultKeyMigrationManifestSchema.parse({
    requestId,
    expectedKeyVersion: options.expectedKeyVersion,
    expectedLatestSeq,
    targetPayloadKeyVersion: options.targetPayloadKeyVersion,
    package: options.package,
    expectedOperationCount: replacements.length,
    expectedPayloadBytes,
  });
  const journalChunks: VaultKeyMigrationChunk[] = [];
  let journalChunk: VaultKeyMigrationChunk['operations'] = [];
  let journalChunkBytes = 0;
  let journalChunkIndex = 0;
  for (const replacement of replacements) {
    const bytes = jsonBytes(replacement.payload);
    if (bytes > maxChunkPayloadBytes) {
      throw new VaultMigrationError(`Operation ${replacement.id} exceeds the migration chunk budget`, 'migration_failed');
    }
    if (journalChunk.length >= MAX_CHUNK_OPERATIONS ||
        (journalChunk.length > 0 && journalChunkBytes + bytes > maxChunkPayloadBytes)) {
      journalChunks.push(vaultKeyMigrationChunkSchema.parse({ requestId, chunkId: `${requestId}-${String(journalChunkIndex)}`, chunkIndex: journalChunkIndex, operations: journalChunk }));
      journalChunk = [];
      journalChunkBytes = 0;
      journalChunkIndex += 1;
    }
    journalChunk.push(replacement);
    journalChunkBytes += bytes;
  }
  if (journalChunk.length > 0) {
    journalChunks.push(vaultKeyMigrationChunkSchema.parse({ requestId, chunkId: `${requestId}-${String(journalChunkIndex)}`, chunkIndex: journalChunkIndex, operations: journalChunk }));
  }
  await options.journal.save({ scope: options.journalScope, requestId, manifest, chunks: journalChunks });
  let stage = validateStage(await options.remote.begin(manifest), requestId);
  if (stage.state === 'PUBLISHED') {
    if (options.clearJournalOnPublished !== false) {
      await options.journal.clear(options.journalScope, requestId);
    }
    return {
      requestId: stage.requestId,
      keyVersion: stage.keyVersion,
      payloadKeyVersion: stage.payloadKeyVersion,
      latestSeq: stage.latestSeq,
      migratedOperationCount: stage.migratedOperationCount,
    };
  }

  for (const payload of journalChunks) {
    stage = validateStage(await options.remote.uploadChunk(payload), requestId);
    options.onProgress?.({ phase: 'staging', completed: stage.uploadedOperationCount, total: replacements.length });
  }

  options.onProgress?.({ phase: 'committing', completed: replacements.length, total: replacements.length });
  try {
    stage = validateStage(await options.remote.commit(requestId), requestId);
  } catch (error) {
    // The commit is idempotent. A response lost after the database commit must
    // never cause a second request or tell the UI that migration failed.
    stage = validateStage(await options.remote.status(requestId), requestId);
    if (stage.state !== 'PUBLISHED') throw error;
  }
  if (stage.state !== 'PUBLISHED') {
    throw new VaultMigrationError('Server did not publish the complete key migration', 'migration_failed');
  }
  if (options.clearJournalOnPublished !== false) {
    await options.journal.clear(options.journalScope, requestId);
  }
  return {
    requestId: stage.requestId,
    keyVersion: stage.keyVersion,
    payloadKeyVersion: stage.payloadKeyVersion,
    latestSeq: stage.latestSeq,
    migratedOperationCount: stage.migratedOperationCount,
  };
}

/** Explicit user/host cancellation. This releases the server reservation. */
export const cancelVaultPayloadMigration = async (
  remote: VaultKeyMigrationRemote,
  requestId: string,
): Promise<VaultKeyMigrationStageResponse> => validateStage(await remote.cancel(requestId), requestId);

/** Cancel the unfinished server reservation identified by the local journal. */
export const cancelVaultPayloadMigrationForScope = async (
  remote: VaultKeyMigrationRemote,
  journal: VaultMigrationJournal,
  journalScope: string,
): Promise<VaultKeyMigrationStageResponse | undefined> => {
  const pending = await journal.load(journalScope);
  if (pending === undefined) return undefined;
  const stage = await cancelVaultPayloadMigration(remote, pending.requestId);
  await journal.clear(journalScope, pending.requestId);
  return stage;
};

/**
 * Acknowledge a migration only after the host has installed its published
 * package and payload generation. Keeping this explicit prevents a process
 * exit or credential invalidation between server commit and local install
 * from destroying the only retry record.
 */
export async function acknowledgeVaultPayloadMigration(
  journal: VaultMigrationJournal,
  journalScope: string,
  requestId: string,
): Promise<void> {
  await journal.clear(journalScope, requestId);
}

export const VAULT_KEY_MIGRATION_INVENTORY_PATH = '/api/sync/key-migration/inventory';
export const VAULT_KEY_MIGRATION_PATH = '/api/sync/key-migration';

export interface VaultKeyMigrationRemoteOptions {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
}

const body = async (response: Response): Promise<unknown> => {
  try { return await response.json(); } catch { return undefined; }
};

const httpRequest = (options: VaultKeyMigrationRemoteOptions, path: string, init: RequestInit): Promise<Response> => {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) throw new Error('Vault key migration fetch is unavailable');
  return options.getToken().then((token) => {
    if (!token) throw new Error('Vault key migration token is unavailable');
    return fetchImpl(joinEndpointUrl(options.baseUrl, path), {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
  });
};

const parseResponse = async <T>(response: Response, parser: (value: unknown) => T): Promise<T> => {
  const value = await body(response);
  if (!response.ok) throw new Error(`Vault key migration request failed (${response.status})`);
  return parser(value);
};

export const createVaultMigrationInventorySource = (
  options: VaultKeyMigrationRemoteOptions,
): VaultMigrationInventorySource => ({
  async getPage(cursor) {
    const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
    return parseResponse(await httpRequest(options, `${VAULT_KEY_MIGRATION_INVENTORY_PATH}${query}`, { method: 'GET' }), (value) => {
      const parsed = vaultKeyMigrationInventoryPageSchema.safeParse(value);
      if (!parsed.success) throw new VaultMigrationError('Malformed migration inventory response', 'invalid_inventory');
      return parsed.data;
    });
  },
});

export const createVaultKeyMigrationRemote = (options: VaultKeyMigrationRemoteOptions): VaultKeyMigrationRemote => ({
  async begin(manifest) {
    return parseResponse(await httpRequest(options, VAULT_KEY_MIGRATION_PATH, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(manifest),
    }), (value) => validateStage(value as VaultKeyMigrationStageResponse, manifest.requestId));
  },
  async uploadChunk(chunk) {
    return parseResponse(await httpRequest(options, `${VAULT_KEY_MIGRATION_PATH}/${encodeURIComponent(chunk.requestId)}/chunks`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(chunk),
    }), (value) => validateStage(value as VaultKeyMigrationStageResponse, chunk.requestId));
  },
  async status(requestId) {
    return parseResponse(await httpRequest(options, `${VAULT_KEY_MIGRATION_PATH}/${encodeURIComponent(requestId)}`, { method: 'GET' }), (value) => validateStage(value as VaultKeyMigrationStageResponse, requestId));
  },
  async commit(requestId) {
    return parseResponse(await httpRequest(options, `${VAULT_KEY_MIGRATION_PATH}/${encodeURIComponent(requestId)}/commit`, { method: 'POST' }), (value) => validateStage(value as VaultKeyMigrationStageResponse, requestId));
  },
  async cancel(requestId) {
    return parseResponse(await httpRequest(options, `${VAULT_KEY_MIGRATION_PATH}/${encodeURIComponent(requestId)}`, { method: 'DELETE' }), (value) => validateStage(value as VaultKeyMigrationStageResponse, requestId));
  },
});
