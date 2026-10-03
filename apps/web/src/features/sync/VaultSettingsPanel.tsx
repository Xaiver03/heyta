import { useEffect, useState } from 'react';
import { useI18n } from '@heyta/i18n';
import {
  VaultSessionError,
  type PendingVaultCreation,
  type VaultKeySession,
} from '@heyta/app-host';
import { cancelWebVaultRootRotation, confirmWebVaultRootRotation, getWebVaultRemote, getWebVaultSession } from '../../lib/vault-session.js';
import { useSyncStore } from './store.js';

type PendingAction = 'create' | 'change' | 'rotate';

function errorKey(error: unknown): string {
  if (!(error instanceof VaultSessionError)) return 'web.sync.vault.error';
  switch (error.code) {
    case 'recovery-confirmation-mismatch':
      return 'web.sync.vault.errorMismatch';
    case 'remote-publish-conflict':
    case 'remote-downgrade':
    case 'remote-root-conflict':
      return 'web.sync.vault.errorConflict';
    case 'root-rotation-required':
      return 'web.sync.vault.errorRotation';
    default:
      return 'web.sync.vault.error';
  }
}

export function VaultSettingsPanel() {
  const { t } = useI18n();
  const sync = useSyncStore();
  const [session, setSession] = useState<VaultKeySession>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [passphrase, setPassphrase] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [legacyPassphrase, setLegacyPassphrase] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [pendingCode, setPendingCode] = useState('');
  const [pending, setPending] = useState<PendingVaultCreation>();
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [revision, setRevision] = useState(0);
  const [migrationProgress, setMigrationProgress] = useState<{ completed: number; total: number }>();

  useEffect(() => {
    let cancelled = false;
    setSession(undefined);
    setPending(undefined);
    setPendingAction(undefined);
    setError(undefined);
    setMigrationProgress(undefined);
    setLegacyPassphrase('');
    if (sync.accountId === undefined || sync.accountId === '' || sync.baseUrl === '' || sync.token === undefined) {
      return undefined;
    }
    setLoading(true);
    void getWebVaultSession(sync.accountId, sync.baseUrl, async () => sync.token)
      .then((next) => {
        if (!cancelled) {
          setSession(next);
          const restored = next.getPendingRootRotation();
          if (restored !== undefined) {
            setPending(restored);
            setPendingAction('rotate');
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError('web.sync.vault.error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sync.accountId, sync.baseUrl, sync.token]);

  const run = async (action: () => Promise<void>, fallbackError?: string): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      setRevision((value) => value + 1);
      void sync.syncNow();
    } catch (caught) {
      setError(caught instanceof VaultSessionError ? errorKey(caught) : (fallbackError ?? 'web.sync.vault.error'));
    } finally {
      setBusy(false);
    }
  };

  const remote = session === undefined || sync.baseUrl === '' || sync.token === undefined
    ? undefined
    : getWebVaultRemote(sync.baseUrl, async () => sync.token);
  const hasPackage = session?.keyPackage !== undefined;
  const unlocked = session?.state === 'unlocked';
  // `revision` is intentionally read here: session state is a live getter.
  void revision;

  return (
    <section
      aria-labelledby="vault-settings-title"
      data-testid="vault-settings"
      className="ht-settings ht-settings__vault"
    >
      <h3 id="vault-settings-title" className="ht-settings__h3 ht-type-headline">
        {t('web.sync.vault.title')}
      </h3>
      <p className="ht-settings__hint">
        {t('web.sync.vault.description')}
      </p>

      {loading ? <p data-testid="vault-loading">{t('web.sync.vault.busy')}</p> : null}
      {sync.accountId === undefined || sync.accountId === '' ? (
        <p data-testid="vault-account-required">{t('web.sync.vault.accountRequired')}</p>
      ) : null}
      {error !== undefined ? (
        <p role="alert" data-testid="vault-error" className="ht-settings__danger">{t(error as never)}</p>
      ) : null}

      {!loading && session !== undefined && !hasPackage && pending === undefined ? (
        <div data-testid="vault-create-form" className="ht-settings__section">
          <strong>{t('web.sync.vault.createTitle')}</strong>
          <label className="ht-settings__field">
            {t('web.sync.vault.passphrase')}
            <input
              data-testid="vault-create-passphrase"
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              className="ht-input"
            />
          </label>
          <div className="ht-settings__actions">
            <button
              type="button"
              className="ht-btn ht-btn--primary"
              data-testid="vault-create"
              disabled={busy || passphrase.length === 0}
              onClick={() => void run(async () => {
                const next = await session.beginCreation(passphrase);
                setPending(next);
                setPendingAction('create');
                setPendingCode('');
              })}
            >
              {t('web.sync.vault.create')}
            </button>
          </div>
        </div>
      ) : null}

      {!loading && session !== undefined && hasPackage && !unlocked && pending === undefined ? (
        <div data-testid="vault-unlock-form" className="ht-settings__section">
          <strong>{t('web.sync.vault.unlockTitle')}</strong>
          <label className="ht-settings__field">
            {t('web.sync.vault.passphrase')}
            <input
              data-testid="vault-passphrase"
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              className="ht-input"
            />
          </label>
          <div className="ht-settings__actions">
            <button type="button" className="ht-btn ht-btn--primary" data-testid="vault-unlock" disabled={busy || passphrase.length === 0} onClick={() => void run(async () => {
              await session.unlockWithPassphrase(passphrase);
              const restored = session.getPendingRootRotation();
              if (restored !== undefined) {
                setPending(restored);
                setPendingAction('rotate');
              }
            })}>
              {t('web.sync.vault.unlock')}
            </button>
          </div>
          <label className="ht-settings__field">
            {t('web.sync.vault.recoveryCode')}
            <input data-testid="vault-recovery-code" type="text" autoComplete="off" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} className="ht-input" />
          </label>
          <button type="button" className="ht-btn ht-btn--ghost" data-testid="vault-unlock-recovery" disabled={busy || recoveryCode.length === 0} onClick={() => void run(async () => {
            await session.unlockWithRecoveryCode(recoveryCode);
            const restored = session.getPendingRootRotation();
            if (restored !== undefined) {
              setPending(restored);
              setPendingAction('rotate');
            }
          }, 'web.sync.vault.errorMismatch')}>
            {t('web.sync.vault.unlockRecovery')}
          </button>
        </div>
      ) : null}

      {pending !== undefined ? (
        <div data-testid="vault-pending" className="ht-settings__section">
          <strong>{t('web.sync.vault.recoveryLabel')}</strong>
          {pending.recoveryCode !== '' ? (
            <code data-testid="vault-recovery-display" className="ht-settings__vault-code">{pending.recoveryCode}</code>
          ) : (
            <p data-testid="vault-recovery-resume" className="ht-settings__hint">{t('web.sync.vault.recoveryResume')}</p>
          )}
          <p className="ht-settings__hint">{t('web.sync.vault.recoveryHint')}</p>
          <label className="ht-settings__field">
            {t('web.sync.vault.recoveryConfirm')}
            <input data-testid="vault-recovery-confirm" type="text" autoComplete="off" value={pendingCode} onChange={(event) => setPendingCode(event.target.value)} className="ht-input" />
          </label>
          <div className="ht-settings__actions">
            <button
              type="button"
              className="ht-btn ht-btn--primary"
              data-testid="vault-publish"
              disabled={busy || pendingCode.length === 0 || remote === undefined}
              onClick={() => void run(async () => {
                if (pendingAction === 'rotate') {
                  await confirmWebVaultRootRotation(session!, pending, pendingCode, {
                    baseUrl: sync.baseUrl,
                    token: sync.token!,
                    ...(legacyPassphrase !== '' ? { password: legacyPassphrase } : {}),
                    onProgress: (progress) => setMigrationProgress({ completed: progress.completed, total: progress.total }),
                  });
                } else {
                  await session!.confirmAndPublish(pending, pendingCode, remote);
                }
                setPending(undefined);
                setPendingAction(undefined);
                setMigrationProgress(undefined);
                setPassphrase('');
                setNewPassphrase('');
                setLegacyPassphrase('');
                setPendingCode('');
              })}
            >
              {t('web.sync.vault.confirm')}
            </button>
            <button type="button" className="ht-btn ht-btn--ghost" data-testid="vault-cancel-pending" disabled={busy} onClick={() => void run(async () => {
              if (pendingAction === 'rotate' && session !== undefined && sync.token !== undefined) {
                await cancelWebVaultRootRotation(session, { baseUrl: sync.baseUrl, token: sync.token });
              }
              setPending(undefined);
              setPendingAction(undefined);
              setMigrationProgress(undefined);
              setLegacyPassphrase('');
            })}>
              {t('web.sync.vault.cancel')}
            </button>
          </div>
          {pendingAction === 'change' ? <p className="ht-settings__hint">{t('web.sync.vault.changeTitle')}</p> : null}
          {pendingAction === 'rotate' ? (
            <>
              <p className="ht-settings__hint">{t('web.sync.vault.rootRotationHint')}</p>
              <label className="ht-settings__field">
                {t('web.sync.vault.legacyPassphrase')}
                <input
                  data-testid="vault-legacy-passphrase"
                  type="password"
                  autoComplete="off"
                  value={legacyPassphrase}
                  onChange={(event) => setLegacyPassphrase(event.target.value)}
                  className="ht-input"
                />
              </label>
              <p className="ht-settings__hint">
                {t('web.sync.vault.legacyPassphraseHint')}
              </p>
            </>
          ) : null}
          {migrationProgress !== undefined ? <p className="ht-settings__hint" data-testid="vault-migration-progress">{t('web.sync.vault.rootRotationProgress', migrationProgress)}</p> : null}
        </div>
      ) : null}

      {!loading && session !== undefined && unlocked && pending === undefined ? (
        <div data-testid="vault-unlocked" className="ht-settings__section">
          <p className="ht-settings__hint" data-testid={session.requiresRecoveryRotation ? 'vault-recovery-rotation' : 'vault-ready'}>
            {session.requiresRecoveryRotation ? t('web.sync.vault.recoveryRotationRequired') : t('web.sync.vault.ready')}
          </p>
          <div className="ht-settings__actions">
            <button type="button" className="ht-btn ht-btn--ghost" data-testid="vault-lock" onClick={() => { session.lock(); setRevision((value) => value + 1); }}>
              {t('web.sync.vault.lock')}
            </button>
          </div>
          <label className="ht-settings__field">
            {t('web.sync.vault.newPassphrase')}
            <input data-testid="vault-new-passphrase" type="password" autoComplete="new-password" value={newPassphrase} onChange={(event) => setNewPassphrase(event.target.value)} className="ht-input" />
          </label>
          <button type="button" className="ht-btn ht-btn--ghost" data-testid="vault-change-passphrase" disabled={busy || newPassphrase.length === 0} onClick={() => void run(async () => {
            const next = await session.beginPassphraseChange(newPassphrase);
            setPending(next);
            setPendingAction('change');
            setPendingCode('');
          })}>
            {t('web.sync.vault.change')}
          </button>
          <button type="button" className="ht-btn ht-btn--ghost" data-testid="vault-rotate-root" disabled={busy || newPassphrase.length === 0 || remote === undefined} onClick={() => void run(async () => {
            const next = await session.beginRootRotation(newPassphrase);
            setPending(next);
            setPendingAction('rotate');
            setPendingCode('');
          })}>
            {t('web.sync.vault.rotateRoot')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
