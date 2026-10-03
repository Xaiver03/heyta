/**
 * Host-owned E2EE vault session.
 *
 * The wrapped package is durable and opaque; the root key exists only in this
 * object while unlocked.  This file deliberately contains no UI and no
 * platform secure-storage implementation.  A native host may keep the access
 * token in Keychain/Keystore, but it must only inject the package store and
 * the HTTP transport here.
 */

import {
  assertVaultKeyPackage,
  createVaultKeyPackage,
  rewrapVaultKeyPackage,
  rotateVaultKey,
  unlockVaultWithPassphrase,
  unlockVaultWithRecoveryCode,
  vaultRootKeyFingerprint,
  type CreatedVaultKeyPackage,
  type VaultKeyPackage,
} from '@heyta/sync-core';
import { vaultKeyPackageResponseSchema, vaultKeyPackageSchema } from '@heyta/shared-schema';
import {
  createVaultPayloadCipher,
  type SyncPayloadCipher,
  type SyncPayloadIdentity,
  type VaultSyncKey,
} from '@heyta/sync-client';
import { joinEndpointUrl } from './endpoint-url.js';
import {
  type VaultKeyPackageScope,
  type VaultKeyPackageStore,
} from './vault-key-package-store.js';

export type { VaultKeyPackageScope } from './vault-key-package-store.js';

export const VAULT_KEY_PACKAGE_PATH = '/api/sync/key-package';

export type VaultSessionState = 'locked' | 'unlocked';

export class VaultSessionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'scope-mismatch'
      | 'unbound-local-package'
      | 'missing-package'
      | 'remote-downgrade'
      | 'remote-root-conflict'
      | 'remote-publish-conflict'
      | 'pending-invalid'
      | 'recovery-confirmation-mismatch'
      | 'root-key-mismatch'
      | 'vault-locked'
      | 'root-rotation-required',
  ) {
    super(message);
    this.name = 'VaultSessionError';
  }
}

/** A transport is bound to one authenticated account/server session. */
export interface VaultKeyPackageRemote {
  /** Canonical origin this transport is authenticated against. */
  readonly serverOrigin: string;
  get(): Promise<VaultKeyPackage | undefined>;
  /** Read the package together with the active ciphertext generation. */
  getState?(): Promise<VaultKeyPackageRemoteState | undefined>;
  /** A modern server must return the active payload generation with the package. */
  put(keyPackage: VaultKeyPackage, expectedKeyVersion: number): Promise<VaultKeyPackageRemoteState>;
}

export interface VaultKeyPackageRemoteState {
  package: VaultKeyPackage;
  /** Null means no atomic payload migration has published a generation yet. */
  payloadKeyVersion: number | null;
}

/**
 * Reserved port for the separate root-rotation/atomic ciphertext migration.
 * The ordinary session intentionally does not implement this as a wrapper-only
 * operation: publishing a new root before all ciphertext is migrated strands
 * the vault.  The migration owner must provide this port and then install the
 * resulting package through the same CAS path.
 */
export interface VaultRootRotationPort {
  rotateRoot(input: {
    currentPackage: VaultKeyPackage;
    currentRootKey: Uint8Array;
    newPassphrase: string;
  }): Promise<PendingVaultCreation>;
}

export interface VaultRootRotationMigrationInput {
  currentPackage: VaultKeyPackage;
  currentRootKey: Uint8Array;
  targetPackage: VaultKeyPackage;
  targetRootKey: Uint8Array;
}

export interface VaultRootRotationMigrationResult {
  keyVersion: number;
  payloadKeyVersion: number;
}

/** Host-owned executor for the atomic ciphertext migration protocol. */
export type VaultRootRotationMigration = (
  input: VaultRootRotationMigrationInput,
) => Promise<VaultRootRotationMigrationResult>;

export interface VaultKeyPackageRemoteOptions {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  path?: string;
}

export interface PendingVaultCreation {
  /** Opaque package that may be published after the user confirms the code. */
  readonly package: VaultKeyPackage;
  /** Display once; never persist or send this value to the server. */
  readonly recoveryCode: string;
}

export interface VaultKeySession {
  readonly scope: VaultKeyPackageScope;
  readonly state: VaultSessionState;
  readonly keyPackage: VaultKeyPackage | undefined;
  /** Recovery unlock is a one-time bridge; a new wrapper must be published before data use. */
  readonly requiresRecoveryRotation: boolean;
  /** Published ciphertext generation, if the server has migrated this vault. */
  readonly payloadKeyVersion: number | null | undefined;
  /** A root-rotation draft recovered from the local encrypted journal. */
  getPendingRootRotation(): PendingVaultCreation | undefined;
  unlockWithPassphrase(passphrase: string): Promise<void>;
  unlockWithRecoveryCode(recoveryCode: string): Promise<void>;
  /** Install a root key obtained from an explicitly opted-in native secure store. */
  unlockWithRootKey(rootKey: Uint8Array): void;
  /** Hydrate an encrypted pending root rotation after a synchronous root install. */
  restorePendingRootRotation(): Promise<void>;
  /** Return a disposable copy for an explicitly opted-in native secure-store save. */
  copyUnlockedRootKey(): Uint8Array;
  lock(): void;
  /** Undefined while locked is intentional: vault mode must fail closed. */
  getPayloadCipher(): Promise<SyncPayloadCipher | undefined>;
  beginCreation(passphrase: string): Promise<PendingVaultCreation>;
  beginPassphraseChange(newPassphrase: string): Promise<PendingVaultCreation>;
  /** Generate a new root and wrappers; no server mutation occurs yet. */
  beginRootRotation(newPassphrase: string): Promise<PendingVaultCreation>;
  /** Cancel a local root-rotation draft after releasing any server staging. */
  cancelPendingRootRotation(pending?: PendingVaultCreation): Promise<void>;
  confirmAndPublish(
    pending: PendingVaultCreation,
    enteredRecoveryCode: string,
    remote?: VaultKeyPackageRemote,
  ): Promise<void>;
  /** Confirm the displayed recovery code, migrate all ciphertext, then install the new package. */
  confirmAndMigrateRootRotation(
    pending: PendingVaultCreation,
    enteredRecoveryCode: string,
    migrate: VaultRootRotationMigration,
  ): Promise<VaultRootRotationMigrationResult>;
  refreshFromRemote(remote: VaultKeyPackageRemote): Promise<VaultKeyPackage | undefined>;
}

const scopeEqual = (a: VaultKeyPackageScope, b: VaultKeyPackageScope): boolean =>
  a.accountId === b.accountId && a.serverOrigin === b.serverOrigin;

const packageSame = (a: VaultKeyPackage, b: VaultKeyPackage): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const canonicalOrigin = (baseUrl: string): string => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('Invalid vault server URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Invalid vault server URL protocol');
  }
  return url.origin;
};

const validatePackage = (value: unknown): VaultKeyPackage => {
  const parsed = vaultKeyPackageSchema.safeParse(value);
  if (!parsed.success) throw new Error('Invalid remote vault key package');
  assertVaultKeyPackage(parsed.data);
  return parsed.data;
};

const validateRemoteState = (value: unknown): VaultKeyPackageRemoteState => {
  const parsed = vaultKeyPackageResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error('Invalid remote vault key-package response');
  assertVaultKeyPackage(parsed.data.package);
  return parsed.data;
};

const responseBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

/** HTTP port for the server's opaque GET/PUT key-package endpoints. */
export const createVaultKeyPackageRemote = (
  options: VaultKeyPackageRemoteOptions,
): VaultKeyPackageRemote => {
  const path = options.path ?? VAULT_KEY_PACKAGE_PATH;
  const serverOrigin = canonicalOrigin(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (fetchImpl === undefined) throw new Error('Vault key-package fetch is unavailable');

  const request = async (init: RequestInit): Promise<Response> => {
    const token = await options.getToken();
    if (token === undefined || token === '') throw new Error('Vault key-package token is unavailable');
    return fetchImpl(joinEndpointUrl(options.baseUrl, path), {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
  };

  const getState = async (): Promise<VaultKeyPackageRemoteState | undefined> => {
      const response = await request({ method: 'GET' });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`Vault key-package GET failed (${response.status})`);
      const body = await responseBody(response);
      return validateRemoteState(body);
  };

  return {
    serverOrigin,
    getState,
    async get() {
      return (await getState())?.package;
    },
    async put(keyPackage, expectedKeyVersion) {
      assertVaultKeyPackage(keyPackage);
      const response = await request({
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ package: keyPackage, expectedKeyVersion }),
      });
      const body = await responseBody(response);
      if (!response.ok) {
        const error = new VaultSessionError(
          `Vault key-package PUT failed (${response.status})`,
          response.status === 409 ? 'remote-publish-conflict' : 'remote-publish-conflict',
        );
        (error as Error & { responseBody?: unknown }).responseBody = body;
        throw error;
      }
      return validateRemoteState(body);
    },
  };
};

const cloneKey = (rootKey: Uint8Array): Uint8Array => rootKey.slice();

const wipe = (key: Uint8Array | undefined): void => {
  if (key !== undefined) key.fill(0);
};

class VaultKeySessionImpl implements VaultKeySession {
  readonly scope: VaultKeyPackageScope;
  private currentPackage: VaultKeyPackage | undefined;
  private rootKey: Uint8Array | undefined;
  private recoveryRotationRequired = false;
  /** Invalidates in-flight KDFs when the host locks this session. */
  private lifecycleEpoch = 0;
  private activePayloadKeyVersion: number | null | undefined;
  private pendingRootRotation: PendingVaultCreation | undefined;
  private pendingRoots = new WeakMap<object, Uint8Array>();
  private pendingCodes = new WeakMap<object, string>();
  private pendingPackages = new WeakMap<object, VaultKeyPackage>();
  private pendingConsumed = new WeakSet<object>();
  private pendingKeys = new Set<object>();

  constructor(
    scope: VaultKeyPackageScope,
    currentPackage: VaultKeyPackage | undefined,
    private readonly store: VaultKeyPackageStore,
    activePayloadKeyVersion?: number | null,
  ) {
    this.scope = scope;
    this.currentPackage = currentPackage;
    this.activePayloadKeyVersion = activePayloadKeyVersion;
  }

  get state(): VaultSessionState {
    return this.rootKey === undefined ? 'locked' : 'unlocked';
  }

  get keyPackage(): VaultKeyPackage | undefined {
    return this.currentPackage;
  }

  get requiresRecoveryRotation(): boolean {
    return this.recoveryRotationRequired;
  }

  get payloadKeyVersion(): number | null | undefined {
    return this.activePayloadKeyVersion;
  }

  getPendingRootRotation(): PendingVaultCreation | undefined {
    return this.pendingRootRotation;
  }

  async unlockWithPassphrase(passphrase: string): Promise<void> {
    if (this.currentPackage === undefined) throw new VaultSessionError('Vault key package is missing', 'missing-package');
    const epoch = this.lifecycleEpoch;
    const keyPackage = this.currentPackage;
    const rootKey = await unlockVaultWithPassphrase(keyPackage, passphrase);
    if (epoch !== this.lifecycleEpoch || keyPackage !== this.currentPackage) {
      wipe(rootKey);
      throw new VaultSessionError('Vault session was locked during unlock', 'vault-locked');
    }
    this.replaceRoot(rootKey);
    this.recoveryRotationRequired = false;
    await this.restorePendingRootRotation();
  }

  async unlockWithRecoveryCode(recoveryCode: string): Promise<void> {
    if (this.currentPackage === undefined) throw new VaultSessionError('Vault key package is missing', 'missing-package');
    const epoch = this.lifecycleEpoch;
    const keyPackage = this.currentPackage;
    const rootKey = await unlockVaultWithRecoveryCode(keyPackage, recoveryCode);
    if (epoch !== this.lifecycleEpoch || keyPackage !== this.currentPackage) {
      wipe(rootKey);
      throw new VaultSessionError('Vault session was locked during unlock', 'vault-locked');
    }
    this.replaceRoot(rootKey);
    this.recoveryRotationRequired = true;
    await this.restorePendingRootRotation();
  }

  unlockWithRootKey(rootKey: Uint8Array): void {
    if (this.currentPackage === undefined) {
      throw new VaultSessionError('Vault key package is missing', 'missing-package');
    }
    if (rootKey.length !== 32 || vaultRootKeyFingerprint(rootKey) !== this.currentPackage.rootKeyFingerprint) {
      throw new VaultSessionError('Vault root key fingerprint mismatch', 'root-key-mismatch');
    }
    this.replaceRoot(rootKey);
    this.recoveryRotationRequired = false;
    // Synchronous secure-store unlock callers explicitly await
    // restorePendingRootRotation() when they need the recovered draft.
  }

  copyUnlockedRootKey(): Uint8Array {
    if (this.rootKey === undefined) throw new VaultSessionError('Vault is locked', 'vault-locked');
    return cloneKey(this.rootKey);
  }

  lock(): void {
    this.lifecycleEpoch += 1;
    wipe(this.rootKey);
    this.rootKey = undefined;
    for (const key of this.pendingKeys) {
      wipe(this.pendingRoots.get(key));
      this.pendingRoots.delete(key);
      this.pendingCodes.delete(key);
      this.pendingPackages.delete(key);
      this.pendingConsumed.add(key);
    }
    this.pendingKeys.clear();
    this.pendingRootRotation = undefined;
  }

  async getPayloadCipher(): Promise<SyncPayloadCipher | undefined> {
    // A known null generation means the server still has legacy ciphertext.
    // Do not let ordinary sync write a new-root envelope into that cohort;
    // the explicit root migration path must establish the first generation.
    if (this.rootKey === undefined || this.currentPackage === undefined ||
        this.recoveryRotationRequired || this.activePayloadKeyVersion === null) return undefined;
    // Return a session-bound façade, rather than a cipher that captures a root
    // forever. A caller may retain this object across lock(); every operation
    // re-checks the live session and therefore fails closed after locking.
    const session = this;
    const facadeEpoch = this.lifecycleEpoch;
    const withLiveCipher = (): SyncPayloadCipher => {
      const rootKey = session.rootKey;
      const keyPackage = session.currentPackage;
      if (rootKey === undefined || keyPackage === undefined ||
          session.recoveryRotationRequired || session.lifecycleEpoch !== facadeEpoch) {
        throw new Error('Vault is locked');
      }
      const payloadKeyVersion = session.activePayloadKeyVersion ?? keyPackage.keyVersion;
      const current: VaultSyncKey = {
        keyVersion: payloadKeyVersion,
        rootKey: cloneKey(rootKey),
      };
      // A passphrase re-wrap keeps the root, so old operation envelopes remain
      // decryptable. Resolve those generations lazily: keyVersion is an
      // authenticated envelope value, but it is still untrusted input and must
      // never turn into a 1..N allocation/loop. Root rotation must supply an
      // explicit migration/history implementation; this session intentionally
      // does not pretend to do so.
      const currentVersion = keyPackage.keyVersion;
      return createVaultPayloadCipher({
        current,
        resolveKeyVersion: (version) => {
          // Once the server has published a payload generation, only an
          // explicit historical-key provider may resolve older generations.
          // Reusing the current root for an old generation would make a root
          // rotation appear decryptable while silently producing bad data.
          if (session.activePayloadKeyVersion !== undefined) return undefined;
          if (!Number.isSafeInteger(version) || version < 1 || version > currentVersion) {
            return undefined;
          }
          return cloneKey(rootKey);
        },
      });
    };
    return {
      encrypt: async (payload: string, identity: SyncPayloadIdentity) =>
        withLiveCipher().encrypt(payload, identity),
      decrypt: async (payload: string, identity: SyncPayloadIdentity) =>
        withLiveCipher().decrypt(payload, identity),
    };
  }

  async beginCreation(passphrase: string): Promise<PendingVaultCreation> {
    if (this.currentPackage !== undefined) {
      throw new Error('Vault key package already exists');
    }
    const epoch = this.lifecycleEpoch;
    const created = await createVaultKeyPackage(passphrase);
    if (epoch !== this.lifecycleEpoch) {
      wipe(created.rootKey);
      throw new VaultSessionError('Vault session was locked during key creation', 'vault-locked');
    }
    return this.makePending(created);
  }

  async beginPassphraseChange(newPassphrase: string): Promise<PendingVaultCreation> {
    if (this.currentPackage === undefined || this.rootKey === undefined) {
      throw new VaultSessionError('Unlock the vault before changing its passphrase', 'missing-package');
    }
    const epoch = this.lifecycleEpoch;
    const sourceRoot = cloneKey(this.rootKey);
    let created: CreatedVaultKeyPackage | undefined;
    try {
      created = await rewrapVaultKeyPackage(this.currentPackage, sourceRoot, newPassphrase);
    } finally {
      wipe(sourceRoot);
    }
    if (created === undefined) throw new Error('Vault root rotation did not create a package');
    if (epoch !== this.lifecycleEpoch) {
      wipe(created.rootKey);
      throw new VaultSessionError('Vault session was locked during key change', 'vault-locked');
    }
    return this.makePending(created);
  }

  async beginRootRotation(newPassphrase: string): Promise<PendingVaultCreation> {
    if (this.pendingRootRotation !== undefined) return this.pendingRootRotation;
    if (this.currentPackage === undefined || this.rootKey === undefined) {
      throw new VaultSessionError('Unlock the vault before rotating its root', 'missing-package');
    }
    const epoch = this.lifecycleEpoch;
    const sourceRoot = cloneKey(this.rootKey);
    let created: CreatedVaultKeyPackage | undefined;
    try {
      created = await rotateVaultKey(this.currentPackage, sourceRoot, newPassphrase);
      if (epoch !== this.lifecycleEpoch) {
        wipe(created.rootKey);
        throw new VaultSessionError('Vault session was locked during root rotation', 'vault-locked');
      }
      // The draft is encrypted under the current root. Keep that disposable
      // copy alive until the local transaction has completed; wiping it in a
      // finally immediately after rotateVaultKey would persist a draft that
      // can never be decrypted after restart.
      await this.store.savePendingRootRotation(created.package, this.scope, sourceRoot, created.rootKey);
    } catch (error) {
      // The session owns the generated target root until makePending() takes
      // ownership of it. Do not leave it live when staging fails.
      wipe(created?.rootKey);
      throw error;
    } finally {
      wipe(sourceRoot);
    }
    if (epoch !== this.lifecycleEpoch) {
      await this.store.clearPendingRootRotation();
      wipe(created.rootKey);
      throw new VaultSessionError('Vault session was locked during root rotation', 'vault-locked');
    }
    const pending = this.makePending(created);
    this.pendingRootRotation = pending;
    return pending;
  }

  async confirmAndPublish(
    pending: PendingVaultCreation,
    enteredRecoveryCode: string,
    remote?: VaultKeyPackageRemote,
  ): Promise<void> {
    this.assertRemoteScope(remote);
    const key = pending as object;
    if (this.pendingConsumed.has(key)) throw new VaultSessionError('Pending vault package was already consumed', 'pending-invalid');
    const pendingPackage = this.pendingPackages.get(key);
    const pendingRoot = this.pendingRoots.get(key);
    const pendingCode = this.pendingCodes.get(key);
    if (pendingPackage === undefined || pendingRoot === undefined || pendingCode === undefined) {
      throw new VaultSessionError('Pending vault package is no longer available', 'pending-invalid');
    }
    if (enteredRecoveryCode.replaceAll('-', '').replaceAll(' ', '').toUpperCase() !== pendingCode) {
      throw new VaultSessionError('Recovery code confirmation did not match', 'recovery-confirmation-mismatch');
    }

    const expected = this.currentPackage?.keyVersion ?? 0;
    if (pendingPackage.keyVersion !== expected + 1) {
      throw new VaultSessionError('Pending package does not advance the local version', 'remote-publish-conflict');
    }

    let committedPackage = pendingPackage;
    let committedPayloadKeyVersion = this.activePayloadKeyVersion;
    const epoch = this.lifecycleEpoch;
    if (remote !== undefined) {
      try {
        const publishedState = validateRemoteState(await remote.put(pendingPackage, expected));
        committedPackage = publishedState.package;
        committedPayloadKeyVersion = publishedState.payloadKeyVersion;
        if (!packageSame(committedPackage, pendingPackage)) {
          throw new VaultSessionError('Remote returned a different package', 'remote-publish-conflict');
        }
      } catch (error) {
        // A lost response is recoverable: read the authenticated endpoint and
        // accept only an exact package match. The old local package remains in
        // place until this check succeeds.
        try {
          const observedState = remote.getState !== undefined ? await remote.getState() : undefined;
          const observed = observedState?.package ?? await remote.get();
          if (observed !== undefined && packageSame(observed, pendingPackage)) {
            committedPackage = observed;
            if (observedState !== undefined) committedPayloadKeyVersion = observedState.payloadKeyVersion;
          } else {
            throw error;
          }
        } catch (readError) {
          if (readError === error) throw error;
          throw error;
        }
      }
    }

    if (epoch !== this.lifecycleEpoch || this.pendingConsumed.has(key)) {
      throw new VaultSessionError('Vault session was locked during key publication', 'vault-locked');
    }

    // The local old package is never cleared before the remote CAS succeeds.
    // saveBound is a single local transaction for package + account binding.
    // The server owns payload-generation assignment. In particular, a first
    // wrapper can legitimately return null when legacy ciphertext exists;
    // never derive a generation from the wrapper revision.
    await this.store.saveBound(committedPackage, this.scope, committedPayloadKeyVersion);
    if (epoch !== this.lifecycleEpoch || this.pendingConsumed.has(key)) {
      throw new VaultSessionError('Vault session was locked during key publication', 'vault-locked');
    }
    this.currentPackage = committedPackage;
    this.activePayloadKeyVersion = committedPayloadKeyVersion;
    this.replaceRoot(pendingRoot);
    this.recoveryRotationRequired = false;
    this.pendingConsumed.add(key);
    wipe(pendingRoot);
    this.pendingRoots.delete(key);
    this.pendingCodes.delete(key);
    this.pendingPackages.delete(key);
    this.pendingKeys.delete(key);
    if (this.pendingRootRotation === pending) this.pendingRootRotation = undefined;
  }

  async confirmAndMigrateRootRotation(
    pending: PendingVaultCreation,
    enteredRecoveryCode: string,
    migrate: VaultRootRotationMigration,
  ): Promise<VaultRootRotationMigrationResult> {
    const key = pending as object;
    if (this.pendingConsumed.has(key)) throw new VaultSessionError('Pending vault package was already consumed', 'pending-invalid');
    const pendingPackage = this.pendingPackages.get(key);
    const pendingRoot = this.pendingRoots.get(key);
    const pendingCode = this.pendingCodes.get(key);
    const currentPackage = this.currentPackage;
    const currentRoot = this.rootKey;
    if (pendingPackage === undefined || pendingRoot === undefined ||
        currentPackage === undefined || currentRoot === undefined) {
      throw new VaultSessionError('Vault root rotation requires an unlocked session', 'missing-package');
    }
    if (pendingCode === undefined) {
      let recovered: Uint8Array | undefined;
      try {
        recovered = await unlockVaultWithRecoveryCode(pendingPackage, enteredRecoveryCode);
        if (vaultRootKeyFingerprint(recovered) !== pendingPackage.rootKeyFingerprint) {
          throw new Error('Recovery code fingerprint mismatch');
        }
      } catch {
        throw new VaultSessionError('Recovery code confirmation did not match', 'recovery-confirmation-mismatch');
      } finally {
        wipe(recovered);
      }
    } else if (enteredRecoveryCode.replaceAll('-', '').replaceAll(' ', '').toUpperCase() !== pendingCode) {
      throw new VaultSessionError('Recovery code confirmation did not match', 'recovery-confirmation-mismatch');
    }
    if (pendingPackage.keyVersion !== currentPackage.keyVersion + 1) {
      throw new VaultSessionError('Pending root package does not advance the local version', 'remote-publish-conflict');
    }
    if (pendingPackage.rootKeyFingerprint === currentPackage.rootKeyFingerprint) {
      throw new VaultSessionError('Root rotation must publish a different root', 'root-rotation-required');
    }
    const epoch = this.lifecycleEpoch;
    const currentRootCopy = cloneKey(currentRoot);
    const targetRootCopy = cloneKey(pendingRoot);
    let result: VaultRootRotationMigrationResult;
    try {
      result = await migrate({
        currentPackage,
        currentRootKey: currentRootCopy,
        targetPackage: pendingPackage,
        targetRootKey: targetRootCopy,
      });
    } finally {
      // The executor receives disposable copies; the session keeps the
      // pending root until the atomic server commit and local install succeed.
      wipe(currentRootCopy);
      wipe(targetRootCopy);
    }
    if (epoch !== this.lifecycleEpoch || this.pendingConsumed.has(key)) {
      throw new VaultSessionError('Vault session was locked during root migration', 'vault-locked');
    }
    if (result.keyVersion !== pendingPackage.keyVersion || result.payloadKeyVersion <= 0) {
      throw new VaultSessionError('Root migration returned an invalid published generation', 'remote-publish-conflict');
    }
    await this.store.saveBound(pendingPackage, this.scope, result.payloadKeyVersion);
    if (epoch !== this.lifecycleEpoch || this.pendingConsumed.has(key)) {
      throw new VaultSessionError('Vault session was locked while installing migrated root', 'vault-locked');
    }
    this.currentPackage = pendingPackage;
    this.activePayloadKeyVersion = result.payloadKeyVersion;
    this.replaceRoot(pendingRoot);
    this.recoveryRotationRequired = false;
    this.pendingConsumed.add(key);
    wipe(pendingRoot);
    this.pendingRoots.delete(key);
    this.pendingCodes.delete(key);
    this.pendingPackages.delete(key);
    this.pendingKeys.delete(key);
    this.pendingRootRotation = undefined;
    return result;
  }

  async cancelPendingRootRotation(pending?: PendingVaultCreation): Promise<void> {
    const target = pending ?? this.pendingRootRotation;
    if (target !== undefined) {
      const key = target as object;
      const root = this.pendingRoots.get(key);
      wipe(root);
      this.pendingRoots.delete(key);
      this.pendingCodes.delete(key);
      this.pendingPackages.delete(key);
      this.pendingKeys.delete(key);
      this.pendingConsumed.add(key);
    }
    this.pendingRootRotation = undefined;
    await this.store.clearPendingRootRotation();
  }

  async refreshFromRemote(remote: VaultKeyPackageRemote): Promise<VaultKeyPackage | undefined> {
    this.assertRemoteScope(remote);
    let remoteState: VaultKeyPackageRemoteState | undefined;
    if (remote.getState !== undefined) {
      remoteState = await remote.getState();
    } else {
      const remotePackage = await remote.get();
      remoteState = remotePackage === undefined
        ? undefined
        : { package: remotePackage, payloadKeyVersion: null };
    }
    if (remoteState === undefined) return undefined;
    const remotePackage = remoteState.package;
    validatePackage(remotePackage);
    const local = this.currentPackage;
    // A server commit may have completed after the process died but before
    // saveBound() installed the new local package. Preserve the old package
    // here: it is the only context that can decrypt the pending target root
    // draft, and the durable migration journal must resume with its requestId.
    // Never let refresh turn a recoverable local transition into an apparent
    // ordinary remote rotation.
    const pendingPackage = await this.store.peekPendingRootRotationPackage(this.scope);
    if (pendingPackage !== undefined && local !== undefined &&
        packageSame(remotePackage, pendingPackage)) {
      return local;
    }
    if (pendingPackage !== undefined && local !== undefined &&
        remotePackage.keyVersion > local.keyVersion &&
        remotePackage.rootKeyFingerprint !== pendingPackage.rootKeyFingerprint) {
      throw new VaultSessionError('Remote package conflicts with the pending root rotation', 'remote-publish-conflict');
    }
    if (local !== undefined) {
      if (remotePackage.keyVersion < local.keyVersion) {
        throw new VaultSessionError('Remote vault key package is older than the local pin', 'remote-downgrade');
      }
      if (remotePackage.keyVersion === local.keyVersion &&
          remotePackage.rootKeyFingerprint !== local.rootKeyFingerprint) {
        throw new VaultSessionError('Remote package has a different root at the same version', 'remote-root-conflict');
      }
      if (this.state === 'unlocked' && remotePackage.rootKeyFingerprint !== local.rootKeyFingerprint) {
        throw new VaultSessionError('Root rotation requires an atomic ciphertext migration', 'root-rotation-required');
      }
      if (remotePackage.keyVersion === local.keyVersion) {
        // Persist the server-owned generation without using saveBound(): a
        // same-package refresh must not erase an encrypted pending rotation
        // draft that is waiting for the user's confirmation after restart.
        await this.store.savePayloadKeyVersion(remoteState.payloadKeyVersion);
        this.activePayloadKeyVersion = remoteState.payloadKeyVersion;
        return local;
      }
    }
    await this.store.saveBound(remotePackage, this.scope, remoteState.payloadKeyVersion);
    this.currentPackage = remotePackage;
    this.activePayloadKeyVersion = remoteState.payloadKeyVersion;
    return remotePackage;
  }

  private replaceRoot(next: Uint8Array): void {
    wipe(this.rootKey);
    this.rootKey = cloneKey(next);
    wipe(next);
  }

  async restorePendingRootRotation(): Promise<void> {
    if (this.currentPackage === undefined || this.rootKey === undefined || this.pendingRootRotation !== undefined) return;
    const epoch = this.lifecycleEpoch;
    const currentPackage = this.currentPackage;
    const currentRoot = cloneKey(this.rootKey);
    const persisted = await this.store.loadPendingRootRotation(this.scope, currentRoot);
    wipe(currentRoot);
    if (epoch !== this.lifecycleEpoch || currentPackage !== this.currentPackage) {
      wipe(persisted?.rootKey);
      return;
    }
    if (persisted === undefined) return;
    try {
      if (persisted.package.keyVersion !== this.currentPackage.keyVersion + 1 ||
          persisted.package.rootKeyFingerprint === this.currentPackage.rootKeyFingerprint) {
        await this.store.clearPendingRootRotation();
        wipe(persisted.rootKey);
        return;
      }
      const pending = Object.freeze({ package: persisted.package, recoveryCode: '' });
      const key = pending as object;
      this.pendingRoots.set(key, persisted.rootKey);
      this.pendingPackages.set(key, persisted.package);
      this.pendingKeys.add(key);
      this.pendingRootRotation = pending;
    } catch (error) {
      wipe(persisted.rootKey);
      throw error;
    }
  }

  private assertRemoteScope(remote: VaultKeyPackageRemote | undefined): void {
    if (remote === undefined) return;
    if (remote.serverOrigin !== this.scope.serverOrigin) {
      throw new VaultSessionError('Vault key-package transport targets another server', 'scope-mismatch');
    }
  }

  private makePending(created: CreatedVaultKeyPackage): PendingVaultCreation {
    const pending: PendingVaultCreation = Object.freeze({
      package: created.package,
      recoveryCode: created.recoveryCode,
    });
    const key = pending as object;
    this.pendingRoots.set(key, cloneKey(created.rootKey));
    this.pendingCodes.set(key, created.recoveryCode);
    this.pendingPackages.set(key, created.package);
    this.pendingKeys.add(key);
    wipe(created.rootKey);
    return pending;
  }
}

export async function createVaultKeySession(options: {
  store: VaultKeyPackageStore;
  scope: VaultKeyPackageScope;
}): Promise<VaultKeySession> {
  const scope = {
    accountId: options.scope.accountId.trim(),
    serverOrigin: canonicalOrigin(options.scope.serverOrigin),
  };
  if (scope.accountId === '') throw new Error('Vault account id is required');
  const [localPackage, persistedScope, payloadKeyVersion] = await Promise.all([
    options.store.load(),
    options.store.loadScope(),
    options.store.loadPayloadKeyVersion(),
  ]);
  if (localPackage !== undefined && persistedScope === undefined) {
    throw new VaultSessionError('Local vault package has no account/server binding', 'unbound-local-package');
  }
  if (persistedScope !== undefined && !scopeEqual(scope, persistedScope)) {
    throw new VaultSessionError('Local vault package belongs to another account/server', 'scope-mismatch');
  }
  return new VaultKeySessionImpl(scope, localPackage, options.store, payloadKeyVersion);
}
