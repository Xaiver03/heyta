/**
 * Mobile vault lifecycle controls.
 *
 * The package and session live in `@heyta/app-host`; this component only owns
 * the user journey and the explicit mobile secure-storage opt-in. Root keys,
 * passphrases and recovery codes never enter SQLite, sync config, or React
 * persistence. The native bridge receives a base64 root key only when the
 * user enables remembered unlock.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  type AppHost,
  VaultSessionError,
  type PendingVaultCreation,
  type VaultKeySession,
  type VaultMigrationProgress,
} from '@heyta/app-host';
import { decodeBase64, encodeBase64 } from '@heyta/sync-core';
import { useI18n, type MessageKey } from '@heyta/i18n';

import { Button, Card, Checkbox, SectionHeader, Stack, Text, TextField } from '../ui/kit';
import { readSyncConfig } from '../sync/config';
import { openTaskHost } from '../db/open-host';
import {
  loadVaultRootKey,
  removeVaultRootKey,
  saveVaultRootKey,
  type VaultSecureStorageScope,
} from '../lib/vault-secure-storage';

type PendingAction = 'create' | 'change' | 'rotate';

function currentScope(): VaultSecureStorageScope | undefined {
  const config = readSyncConfig();
  const accountId = config?.accountId?.trim();
  if (config === undefined || config.serverUrl.trim() === '' || accountId === undefined || accountId === '') {
    return undefined;
  }
  try {
    return { serverOrigin: new URL(config.serverUrl).origin, accountId };
  } catch {
    return undefined;
  }
}

function decodeRootKey(value: string): Uint8Array {
  const bytes = new Uint8Array(decodeBase64(value));
  if (bytes.length !== 32) throw new Error('Invalid remembered vault root key');
  return bytes;
}

function errorKey(error: unknown): MessageKey {
  if (!(error instanceof VaultSessionError)) return 'mobile.vault.error';
  switch (error.code) {
    case 'recovery-confirmation-mismatch':
      return 'mobile.vault.errorMismatch';
    case 'root-key-mismatch':
      return 'mobile.vault.errorRememberedKey';
    case 'remote-publish-conflict':
    case 'remote-downgrade':
    case 'remote-root-conflict':
      return 'mobile.vault.errorConflict';
    case 'root-rotation-required':
      return 'mobile.vault.errorRotation';
    default:
      return 'mobile.vault.error';
  }
}

export function VaultSettingsSection(): React.JSX.Element {
  const { t } = useI18n();
  const [session, setSession] = useState<VaultKeySession>();
  const [host, setHost] = useState<AppHost>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey>();
  const [passphrase, setPassphrase] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  // Legacy password is a migration-only bridge. It is deliberately separate
  // from the new root passphrase and is never persisted in sync config.
  const [legacyPassphrase, setLegacyPassphrase] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [pendingCode, setPendingCode] = useState('');
  const [pending, setPending] = useState<PendingVaultCreation>();
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [rememberUnlock, setRememberUnlock] = useState(false);
  const [revision, setRevision] = useState(0);
  const [migrationProgress, setMigrationProgress] = useState<{ completed: number; total: number }>();

  const accountId = readSyncConfig()?.accountId;
  const serverUrl = readSyncConfig()?.serverUrl;
  const scope = useMemo(currentScope, [accountId, serverUrl]);

  const rememberCurrentRoot = useCallback(async (nextSession: VaultKeySession, enabled = rememberUnlock): Promise<void> => {
    // A recovery unlock is deliberately a bridge to rotation. Never persist
    // the old root before the user publishes a new passphrase/recovery code.
    if (!enabled || scope === undefined || nextSession.requiresRecoveryRotation) return;
    const root = nextSession.copyUnlockedRootKey();
    try {
      await saveVaultRootKey(scope, encodeBase64(root));
    } finally {
      root.fill(0);
    }
  }, [rememberUnlock, scope]);

  useEffect(() => {
    let cancelled = false;
    setSession(undefined);
    setHost(undefined);
    setPending(undefined);
    setPendingAction(undefined);
    setError(undefined);
    setRememberUnlock(false);
    setLegacyPassphrase('');
    setMigrationProgress(undefined);
    if (scope === undefined || accountId === undefined || accountId.trim() === '' || serverUrl === undefined) {
      return undefined;
    }
    setLoading(true);
    void openTaskHost()
      .then(async (nextHost) => {
        if (cancelled) return;
        setHost(nextHost);
        const next = await nextHost.getVaultSession();
        if (cancelled || next === undefined) return;
        setSession(next);
        if (next.keyPackage === undefined) return;
        let remembered: string | undefined;
        try {
          remembered = await loadVaultRootKey(scope);
        } catch (caught: unknown) {
          // An absent item is a normal locked state; an unavailable/broken
          // bridge must remain visible so the user does not mistake it for a
          // wrong passphrase.
          if (!cancelled) setError(errorKey(caught));
          return;
        }
        if (cancelled || remembered === undefined) return;
        const root = decodeRootKey(remembered);
          try {
            next.unlockWithRootKey(root);
            await next.restorePendingRootRotation();
            setRememberUnlock(true);
            const restored = next.getPendingRootRotation();
            if (restored !== undefined) {
              setPending(restored);
              setPendingAction('rotate');
            }
            setRevision((value) => value + 1);
        } finally {
          root.fill(0);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorKey(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, scope, serverUrl]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      setRevision((value) => value + 1);
    } catch (caught) {
      setError(errorKey(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggleRemember = (): void => {
    if (busy || scope === undefined) return;
    if (rememberUnlock) {
      void run(async () => {
        await removeVaultRootKey(scope);
        setRememberUnlock(false);
      });
      return;
    }
    if (session?.state !== 'unlocked') {
      // The choice is remembered in this screen and is applied immediately
      // after the next successful unlock/creation confirmation.
      setRememberUnlock(true);
      return;
    }
    void run(async () => {
      await rememberCurrentRoot(session, true);
      setRememberUnlock(true);
    });
  };

  const unlock = (action: () => Promise<void>): void => {
    void run(async () => {
      await action();
      if (session !== undefined && session.requiresRecoveryRotation) {
        // A remembered root may predate this recovery. Remove it now so a
        // restart cannot bypass the mandatory wrapper rotation.
        if (scope !== undefined) await removeVaultRootKey(scope);
        setRememberUnlock(false);
        return;
      }
      if (session !== undefined) await rememberCurrentRoot(session);
    });
  };

  const unlocked = session?.state === 'unlocked';
  const requiresRecoveryRotation = session?.requiresRecoveryRotation === true;
  const legacyPayloadMigrationRequired = session?.payloadKeyVersion === null;
  const hasPackage = session?.keyPackage !== undefined;
  // Session state is a live getter; this counter gives React a repaint after
  // lock/unlock without introducing a second session state machine.
  void revision;

  return (
    <Stack gap="loose" testID="mobile-vault-settings">
      <SectionHeader icon="privacy.consent" title={t('mobile.vault.title')} />
      <Text variant="caption" tone="subtle">
        {t('mobile.vault.description')}
      </Text>
      {loading ? <Text variant="caption" tone="subtle">{t('mobile.vault.busy')}</Text> : null}
      {scope === undefined ? (
        <Text variant="caption" tone="subtle">{t('mobile.vault.accountRequired')}</Text>
      ) : null}
      {error !== undefined ? <Text variant="caption" tone="danger">{t(error)}</Text> : null}

      {!loading && session !== undefined && !hasPackage && pending === undefined ? (
        <Card>
          <Stack>
            <Text variant="row-title">{t('mobile.vault.createTitle')}</Text>
            <TextField
              label={t('mobile.vault.passphrase')}
              value={passphrase}
              onChangeText={setPassphrase}
              secure
              testID="mobile-vault-create-passphrase"
            />
            <Checkbox
              checked={rememberUnlock}
              onToggle={toggleRemember}
              label={t('mobile.vault.remember')}
            />
            <Button
              label={t('mobile.vault.create')}
              onPress={() => void run(async () => {
                const next = await session.beginCreation(passphrase);
                setPending(next);
                setPendingAction('create');
                setPendingCode('');
              })}
              tone="primary"
              disabled={busy || passphrase.length === 0}
            />
          </Stack>
        </Card>
      ) : null}

      {!loading && session !== undefined && hasPackage && !unlocked && pending === undefined ? (
        <Card>
          <Stack>
            <Text variant="row-title">{t('mobile.vault.unlockTitle')}</Text>
            <TextField
              label={t('mobile.vault.passphrase')}
              value={passphrase}
              onChangeText={setPassphrase}
              secure
            />
            <Button
              label={t('mobile.vault.unlock')}
              onPress={() => unlock(() => session.unlockWithPassphrase(passphrase))}
              tone="primary"
              disabled={busy || passphrase.length === 0}
            />
            <TextField
              label={t('mobile.vault.recoveryCode')}
              value={recoveryCode}
              onChangeText={setRecoveryCode}
            />
            <Button
              label={t('mobile.vault.unlockRecovery')}
              onPress={() => unlock(() => session.unlockWithRecoveryCode(recoveryCode))}
              disabled={busy || recoveryCode.length === 0}
            />
            <Checkbox
              checked={rememberUnlock}
              onToggle={toggleRemember}
              label={t('mobile.vault.remember')}
            />
          </Stack>
        </Card>
      ) : null}

      {pending !== undefined ? (
        <Card>
          <Stack>
            <Text variant="row-title">{t('mobile.vault.recoveryLabel')}</Text>
            {pending.recoveryCode !== '' ? <Text selectable>{pending.recoveryCode}</Text> : <Text variant="caption" tone="subtle">{t('mobile.vault.recoveryResume')}</Text>}
            <Text variant="caption" tone="subtle">{t('mobile.vault.recoveryHint')}</Text>
            <TextField
              label={t('mobile.vault.recoveryConfirm')}
              value={pendingCode}
              onChangeText={setPendingCode}
              testID="mobile-vault-recovery-confirm"
            />
            <Button
              label={t('mobile.vault.confirm')}
              onPress={() => void run(async () => {
                const activeHost = host ?? await openTaskHost();
                if (pendingAction === 'rotate') {
                  await activeHost.confirmVaultRootRotation(pending, pendingCode, (progress: VaultMigrationProgress) => {
                    setMigrationProgress({ completed: progress.completed, total: progress.total });
                  }, legacyPayloadMigrationRequired && legacyPassphrase !== ''
                    ? { legacyPassword: legacyPassphrase }
                    : undefined);
                } else {
                  await session!.confirmAndPublish(pending, pendingCode, activeHost.getVaultKeyPackageRemote());
                }
                // The server/package commit is the durable boundary. Clear the
                // one-shot pending UI before the optional secure-store write:
                // a Keychain/Keystore failure must not make an already-consumed
                // recovery code look retryable (the next click would be
                // `pending-invalid`). The error remains visible and the user
                // can explicitly retry the remember toggle afterwards.
                setPending(undefined);
                setPendingAction(undefined);
                setMigrationProgress(undefined);
                setPendingCode('');
                setPassphrase('');
                setLegacyPassphrase('');
                await rememberCurrentRoot(session!);
              })}
              tone="primary"
              disabled={busy || pendingCode.length === 0 ||
                (pendingAction === 'rotate' && legacyPayloadMigrationRequired && legacyPassphrase.length === 0)}
            />
            <Button
              label={t('mobile.vault.cancel')}
              onPress={() => void run(async () => {
                // This is migration-only input. Drop it before attempting
                // remote cancellation so a failed cancel cannot retain an old
                // password in the component state while the pending operation
                // remains visible for retry.
                setLegacyPassphrase('');
                if (pendingAction === 'rotate') {
                  const activeHost = host ?? await openTaskHost();
                  await activeHost.cancelVaultRootRotation();
                }
                setPending(undefined);
                setPendingAction(undefined);
                setMigrationProgress(undefined);
              })}
              disabled={busy}
            />
            {pendingAction === 'change' ? <Text variant="caption">{t('mobile.vault.changeTitle')}</Text> : null}
            {pendingAction === 'rotate' ? <Text variant="caption">{t('mobile.vault.rootRotationHint')}</Text> : null}
            {pendingAction === 'rotate' && legacyPayloadMigrationRequired ? (
              <>
                <TextField
                  label={t('web.sync.vault.legacyPassphrase')}
                  value={legacyPassphrase}
                  onChangeText={setLegacyPassphrase}
                  secure
                  testID="mobile-vault-legacy-passphrase"
                />
                <Text variant="caption" tone="subtle">
                  {t('web.sync.vault.legacyPassphraseHint')}
                </Text>
              </>
            ) : null}
            {migrationProgress !== undefined ? <Text>{t('mobile.vault.rootRotationProgress', migrationProgress)}</Text> : null}
          </Stack>
        </Card>
      ) : null}

      {!loading && session !== undefined && unlocked && pending === undefined ? (
        <Card>
          <Stack>
            <View testID={legacyPayloadMigrationRequired ? 'mobile-vault-legacy-migration' : 'mobile-vault-status'}>
              <Text
                variant={requiresRecoveryRotation || legacyPayloadMigrationRequired ? 'caption' : 'row-title'}
                tone={requiresRecoveryRotation || legacyPayloadMigrationRequired ? 'warning' : undefined}
              >
                {requiresRecoveryRotation
                  ? t('mobile.vault.recoveryRotationRequired')
                  : legacyPayloadMigrationRequired
                    ? t('mobile.vault.legacyMigrationRequired')
                    : t('mobile.vault.ready')}
              </Text>
            </View>
            <Button
              label={t('mobile.vault.lock')}
              onPress={() => {
                session.lock();
                setRevision((value) => value + 1);
              }}
            />
            <Checkbox
              checked={rememberUnlock}
              onToggle={toggleRemember}
              label={t('mobile.vault.remember')}
            />
            <TextField
              label={t('mobile.vault.newPassphrase')}
              value={newPassphrase}
              onChangeText={setNewPassphrase}
              secure
            />
            <Button
              label={t('mobile.vault.change')}
              onPress={() => void run(async () => {
                const next = await session.beginPassphraseChange(newPassphrase);
                setPending(next);
                setPendingAction('change');
                setPendingCode('');
              })}
              disabled={busy || newPassphrase.length === 0 || legacyPayloadMigrationRequired}
            />
            <Button
              label={t('mobile.vault.rotateRoot')}
              onPress={() => void run(async () => {
                const activeHost = host ?? await openTaskHost();
                const next = await activeHost.beginVaultRootRotation(newPassphrase);
                if (next === undefined) throw new Error('Vault session is unavailable');
                setPending(next);
                setPendingAction('rotate');
                setPendingCode('');
              })}
              disabled={busy || newPassphrase.length === 0 || host === undefined}
            />
          </Stack>
        </Card>
      ) : null}

    </Stack>
  );
}
