import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../src/db/open-host', () => ({
  invalidateTaskHostVaultSession: vi.fn(),
}));

import { createDeviceRevocationGuidanceStore } from '../src/lib/device-revocation-guidance';
import { clearMobileVaultSession } from '../src/lib/vault-session-cleanup';

describe('mobile device-revocation behavior', () => {
  it('keeps native cleanup retryable through the existing settings owner', () => {
    const source = (name: string): string => readFileSync(new URL(`../src/screens/${name}`, import.meta.url), 'utf8');
    const vault = source('VaultSettingsSection.tsx');
    const settings = source('SettingsScreen.tsx');
    const profile = source('ProfileScreen.tsx');

    expect(vault).toMatch(/cleanup\.secureStorageError !== undefined[\s\S]*onVaultCleanupPending\?\./u);
    expect(settings).toContain('<VaultSettingsSection onVaultCleanupPending={onVaultCleanupPending} />');
    expect(profile).toContain('onVaultCleanupPending={setVaultCleanupPending}');
  });

  it('keeps rotation guidance across a settings remount and clears it after rotation', () => {
    const values = new Map<string, string>();
    const store = createDeviceRevocationGuidanceStore({
      read: (key) => values.get(key),
      write: (key, value) => {
        values.set(key, value);
        return true;
      },
      remove: (key) => values.delete(key),
    });

    expect(store.has('account-1', 'https://sync.example.test/')).toBe(false);
    expect(store.save('account-1', 'https://sync.example.test/')).toBe(true);
    // A newly mounted settings screen reads the same device preference.
    expect(store.has('account-1', 'https://sync.example.test')).toBe(true);
    expect(store.has('account-2', 'https://sync.example.test')).toBe(false);
    expect(store.clear('account-1', 'https://sync.example.test')).toBe(true);
    expect(store.has('account-1', 'https://sync.example.test')).toBe(false);
  });

  it('fences and clears credentials before awaiting native root deletion', async () => {
    const events: string[] = [];
    let releaseDelete!: () => void;
    const deleting = new Promise<void>((resolve) => { releaseDelete = resolve; });
    const cleanup = clearMobileVaultSession(
      { serverOrigin: 'https://sync.example.test', accountId: 'account-1' },
      {
        disableAutoUnlock: () => { events.push('fence'); },
        invalidateSession: () => { events.push('invalidate'); },
        clearCredentials: () => { events.push('clear'); },
        removeRootKey: async () => {
          events.push('remove-start');
          await deleting;
          events.push('remove-done');
        },
      },
    );
    await Promise.resolve();
    expect(events).toEqual(['fence', 'invalidate', 'clear', 'remove-start']);
    releaseDelete();
    await expect(cleanup).resolves.toEqual({});
    expect(events).toEqual(['fence', 'invalidate', 'clear', 'remove-start', 'remove-done']);
  });

  it('keeps the local auth fence when native deletion fails', async () => {
    const events: string[] = [];
    await expect(clearMobileVaultSession(
      { serverOrigin: 'https://sync.example.test', accountId: 'account-1' },
      {
        disableAutoUnlock: () => { events.push('fence'); },
        invalidateSession: () => { events.push('invalidate'); },
        clearCredentials: () => { events.push('clear'); },
        removeRootKey: async () => { throw new Error('keystore unavailable'); },
      },
    )).resolves.toMatchObject({ secureStorageError: expect.any(Error) });
    expect(events).toEqual(['fence', 'invalidate', 'clear']);
  });

});
