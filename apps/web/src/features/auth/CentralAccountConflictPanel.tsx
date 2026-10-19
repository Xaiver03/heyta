import { useState } from 'react';
import { useI18n } from '@heyta/i18n';

import { centralAccountBindingSnapshot } from '../../lib/central-account-binding.js';
import { ExportPanel } from '../settings/ExportPanel.js';
import { useSyncStore } from '../sync/store.js';
import { clearLocalDataForCentralAccountSwitch, type CentralAccountSwitchResult } from './central-account-switch.js';

export function CentralAccountConflictPanel({ baseUrl, onClose }: {
  baseUrl: string;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const conflict = useSyncStore((state) => state.centralBindingConflict);
  const [bindingAtOpen] = useState(() => centralAccountBindingSnapshot());
  const [exported, setExported] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Exclude<CentralAccountSwitchResult, 'cleared'> | undefined>();
  const storageUnavailable = conflict === 'unavailable' || bindingAtOpen === 'unavailable';

  const switchAccount = async (): Promise<void> => {
    if (!exported || !confirmed || busy || storageUnavailable) return;
    setBusy(true);
    setFailure(undefined);
    const result = await clearLocalDataForCentralAccountSwitch(baseUrl, bindingAtOpen);
    if (result === 'cleared') {
      window.location.reload();
      return;
    }
    setFailure(result);
    setBusy(false);
  };

  return (
    <section className="ht-auth-central ht-auth-central--conflict" data-testid="central-account-conflict" aria-labelledby="central-account-conflict-title">
      <button type="button" className="ht-auth-central__link ht-auth-central__close" disabled={busy} onClick={onClose}>
        {t('web.auth.central.switchLater')}
      </button>
      <h2 id="central-account-conflict-title" className="ht-type-section-title">
        {t(storageUnavailable ? 'web.auth.central.storageUnavailableTitle' : 'web.auth.central.accountConflictTitle')}
      </h2>
      <p className="ht-auth-central__body">
        {t(storageUnavailable ? 'web.auth.central.storageUnavailable' : 'web.auth.central.accountConflict')}
      </p>
      {!storageUnavailable && (
        <>
          <ExportPanel onlyJson onJsonExported={() => { setExported(true); setConfirmed(false); }} />
          <label className="ht-auth-central__consent">
            <input type="checkbox" data-testid="central-switch-confirm" disabled={!exported || busy}
              checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} />
            <span>{t('web.auth.central.switchConfirm')}</span>
          </label>
          <button type="button" className="ht-auth-central__button" data-testid="central-switch-clear"
            disabled={!exported || !confirmed || busy} onClick={() => void switchAccount()}>
            {busy ? t('web.auth.central.switchClearing') : t('web.auth.central.switchClear')}
          </button>
        </>
      )}
      {failure && <p className="ht-auth-central__error" role="alert" data-testid="central-switch-error">
        {t(failure === 'session-changed' ? 'web.auth.central.switchSessionChanged' : 'web.auth.central.switchEraseFailed')}
      </p>}
    </section>
  );
}
