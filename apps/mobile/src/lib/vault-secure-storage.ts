/**
 * Opt-in mobile vault-root-key storage.
 *
 * This port is deliberately a narrow platform boundary. It never writes by
 * itself, has no startup side effect, and does not know about sync. Callers
 * explicitly invoke `save` only after a user has enabled remembered unlock;
 * logout explicitly invokes `remove`. A failed sync must leave the previous
 * secure-store item untouched.
 *
 * Android stores an AES-GCM envelope whose wrapping key lives in Android
 * Keystore. iOS stores the root key in Keychain with
 * `WhenUnlockedThisDeviceOnly`. In both cases the root key is returned only to
 * the caller's unlocked in-memory session.
 */

import { readDevicePref, writeDevicePref } from '../prefs/device-prefs';

const MODULE_NAME = 'HeytaVaultSecureStorage';
const REMEMBERED_UNLOCK_DISABLED_PREFIX = 'vault.rememberedUnlockDisabled:';
const rememberedUnlockEpochs = new Map<string, number>();

// This marker is deliberately a non-secret device preference. It fences a
// secure-store item after logout even when native deletion fails. A missing
// marker is the safe state: remembered unlock must be explicitly opted in.
function rememberedUnlockMarkerKey(scope: VaultSecureStorageScope): string {
  const normalized = normalizeVaultSecureStorageScope(scope);
  return `${REMEMBERED_UNLOCK_DISABLED_PREFIX}${normalized.serverOrigin}\u0000${normalized.accountId}`;
}

function rememberedUnlockEpoch(scope: VaultSecureStorageScope): { key: string; value: number } {
  const key = rememberedUnlockMarkerKey(scope);
  return { key, value: rememberedUnlockEpochs.get(key) ?? 0 };
}

function fenceRememberedUnlock(scope: VaultSecureStorageScope): void {
  const { key, value } = rememberedUnlockEpoch(scope);
  rememberedUnlockEpochs.set(key, value + 1);
}

export interface VaultSecureStorageScope {
  serverOrigin: string;
  accountId: string;
}

/** The native bridge intentionally transports base64, never JSON or a file path. */
export interface VaultSecureStorageNative {
  load(serverOrigin: string, accountId: string): Promise<string | null>;
  save(serverOrigin: string, accountId: string, rootKeyBase64: string): Promise<boolean>;
  remove(serverOrigin: string, accountId: string): Promise<boolean>;
}

export interface VaultSecureStorage {
  load(scope: VaultSecureStorageScope): Promise<string | undefined>;
  save(scope: VaultSecureStorageScope, rootKeyBase64: string): Promise<void>;
  remove(scope: VaultSecureStorageScope): Promise<void>;
}

export interface VaultRememberedUnlockPrefs {
  read(key: string): string | undefined;
  write(key: string, value: string): boolean;
}

/**
 * Normalize and validate scope at the JS boundary as well as in native code.
 * Keeping this check duplicated is intentional: malformed scope must fail
 * before a platform bridge call, while native callers still cannot bypass it.
 */
export function normalizeVaultSecureStorageScope(
  scope: VaultSecureStorageScope,
): VaultSecureStorageScope {
  if (scope === null || typeof scope !== 'object') {
    throw new TypeError('vault secure storage scope 必须是对象');
  }
  const serverOrigin = typeof scope.serverOrigin === 'string' ? scope.serverOrigin.trim() : '';
  const accountId = typeof scope.accountId === 'string' ? scope.accountId.trim() : '';
  if (serverOrigin === '') throw new TypeError('serverOrigin 不能为空');
  if (accountId === '') throw new TypeError('accountId 不能为空');
  if (/^[\u0000-\u001f]/u.test(serverOrigin) || /[\u0000-\u001f]/u.test(serverOrigin)) {
    throw new TypeError('serverOrigin 不能包含控制字符');
  }
  if (/^[\u0000-\u001f]/u.test(accountId) || /[\u0000-\u001f]/u.test(accountId)) {
    throw new TypeError('accountId 不能包含控制字符');
  }
  return { serverOrigin, accountId };
}

function requireRootKey(rootKeyBase64: string): string {
  if (typeof rootKeyBase64 !== 'string' || rootKeyBase64.trim() === '') {
    throw new TypeError('vault root key 不能为空');
  }
  return rootKeyBase64;
}

function nativeModule(): VaultSecureStorageNative | undefined {
  try {
    const rn = require('react-native') as { NativeModules?: Record<string, unknown> };
    return rn.NativeModules?.[MODULE_NAME] as VaultSecureStorageNative | undefined;
  } catch {
    // Node-based package tests do not load react-native. Production calls fail
    // explicitly below instead of pretending that no key exists.
    return undefined;
  }
}

function requireNative(native: VaultSecureStorageNative | undefined): VaultSecureStorageNative {
  if (
    native === undefined ||
    typeof native.load !== 'function' ||
    typeof native.save !== 'function' ||
    typeof native.remove !== 'function'
  ) {
    throw new Error(`${MODULE_NAME} 原生模块不可用`);
  }
  return native;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Build an injectable port for tests without mocking the React Native package. */
export function createVaultSecureStorage(native: VaultSecureStorageNative): VaultSecureStorage {
  const bridge = requireNative(native);
  return {
    async load(scope) {
      const normalized = normalizeVaultSecureStorageScope(scope);
      const rootKey = await bridge.load(normalized.serverOrigin, normalized.accountId);
      return rootKey === null ? undefined : rootKey;
    },
    async save(scope, rootKeyBase64) {
      const normalized = normalizeVaultSecureStorageScope(scope);
      const rootKey = requireRootKey(rootKeyBase64);
      const saved = await bridge.save(normalized.serverOrigin, normalized.accountId, rootKey);
      if (saved !== true) throw new Error('vault root key 未能写入安全存储');
    },
    async remove(scope) {
      const normalized = normalizeVaultSecureStorageScope(scope);
      const removed = await bridge.remove(normalized.serverOrigin, normalized.accountId);
      if (removed !== true) throw new Error('vault root key 未能从安全存储清除');
    },
  };
}

/**
 * Compose the native port with the non-secret opt-in fence. Kept injectable so
 * the ordering (fence before delete, opt-in after save) is testable without a
 * React Native runtime.
 */
export function createRememberedUnlockVaultStorage(
  storage: VaultSecureStorage,
  prefs: VaultRememberedUnlockPrefs,
): VaultSecureStorage {
  return {
    async load(scope) {
      const key = rememberedUnlockMarkerKey(scope);
      if (prefs.read(key) !== '0') return undefined;
      return storage.load(scope);
    },
    async save(scope, rootKeyBase64) {
      const before = rememberedUnlockEpoch(scope);
      await storage.save(scope, rootKeyBase64);
      const after = rememberedUnlockEpoch(scope);
      if (after.value !== before.value) {
        throw new Error('vault remembered-unlock 状态在保存期间已失效');
      }
      if (!prefs.write(after.key, '0')) {
        throw new Error('vault remembered-unlock 状态未能写入设备偏好');
      }
    },
    async remove(scope) {
      fenceRememberedUnlock(scope);
      const { key } = rememberedUnlockEpoch(scope);
      if (!prefs.write(key, '1')) {
        throw new Error('vault remembered-unlock 禁用状态未能写入设备偏好');
      }
      await storage.remove(scope);
    },
  };
}

/** Resolve the real native port lazily; importing this file never touches RN. */
export function getVaultSecureStorage(): VaultSecureStorage {
  return createVaultSecureStorage(requireNative(nativeModule()));
}

/** Explicit logout operation. This is the only convenience alias for `remove`. */
export async function clearVaultRootKey(scope: VaultSecureStorageScope): Promise<void> {
  await rememberedUnlockStorage().remove(scope);
}

/**
 * Read the persisted remembered-unlock fence. Missing or unreadable state is
 * intentionally fail-closed so a stale native item cannot unlock on startup.
 */
export function isVaultRootAutoUnlockDisabled(scope: VaultSecureStorageScope): boolean {
  try {
    return readDevicePref(rememberedUnlockMarkerKey(scope)) !== '0';
  } catch {
    return true;
  }
}

function rememberedUnlockStorage(): VaultSecureStorage {
  return createRememberedUnlockVaultStorage(getVaultSecureStorage(), {
    read: readDevicePref,
    write: writeDevicePref,
  });
}

/** Persist the explicit opt-in which permits remembered root loading. */
export function enableVaultRootAutoUnlock(scope: VaultSecureStorageScope): void {
  if (!writeDevicePref(rememberedUnlockMarkerKey(scope), '0')) {
    throw new Error('vault remembered-unlock 状态未能写入设备偏好');
  }
}

/** Fence remembered unlock before attempting native deletion. */
export function disableVaultRootAutoUnlock(scope: VaultSecureStorageScope): void {
  fenceRememberedUnlock(scope);
  if (!writeDevicePref(rememberedUnlockMarkerKey(scope), '1')) {
    throw new Error('vault remembered-unlock 禁用状态未能写入设备偏好');
  }
}

/** Explicit opt-in operation; there is no implicit call from startup or sync. */
export async function saveVaultRootKey(
  scope: VaultSecureStorageScope,
  rootKeyBase64: string,
): Promise<void> {
  await rememberedUnlockStorage().save(scope, rootKeyBase64);
}

export async function loadVaultRootKey(
  scope: VaultSecureStorageScope,
): Promise<string | undefined> {
  try {
    return await rememberedUnlockStorage().load(scope);
  } catch (error) {
    throw new Error(`读取 vault root key 失败：${errorText(error)}`);
  }
}

export async function removeVaultRootKey(scope: VaultSecureStorageScope): Promise<void> {
  await clearVaultRootKey(scope);
}
