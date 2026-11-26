/**
 * 两步验证（TOTP）—— 账号安全设置面板
 * ==================================
 *
 * 补的是登录 2FA 格 #62 缺的 TOTP 一档。算法在 `lib/totp.ts`（RFC 6238，纯函数、已用官方向量自测）；
 * 本文件只把"添加验证器 → 输入验证码 → 启用 / 关闭"这条**绑定流程**接进账号安全页。
 *
 * ## 🔴 边界（不假装）
 *
 * 真正的两步验证由**服务端**保存密钥并在登录时校验。本期只做**本机验证性实现**：
 * 密钥只落在本机（`totp-local.ts`），"启用"也只影响这台机器。面板标题旁的 `?`
 * 对用户说的是同一句话（`web.totp.lead`）。接服务端前，它**不是**账号级强制 2FA。
 *
 * ## 纪律
 *
 * - 未登录不画可操作控件（`SettingsAccountGate` 承接，与 PasskeyPanel 同一形状）；
 * - 校验失败是**反馈**（`role="alert"`），不是说明文字（§0.2）；
 * - 密钥与状态都是事实数据，直接呈现；解释一律进 `?`。
 */

import { useState } from 'react';

import { useI18n, type MessageKey } from '@heyta/i18n';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';

import { Button } from '../../components/hta/index.js';
import { FormField } from '../../lib/form/FormField.js';
import { ICON_SIZE } from '@heyta/design-system';
import { generateSecret, verifyTotp } from '../../lib/totp.js';
import { SettingsAccountGate } from './SettingsAccountGate.js';
import { SettingsInfoTip } from './SettingsInfoTip.js';
import { clearTotp, loadTotp, saveTotp, type TotpBinding } from './totp-local.js';
import { useSyncStore } from '../sync/store.js';

export function TotpPanel({ active = true }: { active?: boolean }): React.JSX.Element {
  const { t } = useI18n();
  const token = useSyncStore((s) => s.token);
  const signedIn = typeof token === 'string' && token !== '';

  const [binding, setBinding] = useState<TotpBinding | null>(loadTotp);
  /** 新绑定流程里临时生成的密钥（尚未启用；取消即丢弃）。 */
  const [pendingSecret, setPendingSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [justDisabled, setJustDisabled] = useState(false);
  /** 关闭是两段式（与 PasskeyPanel 的删除同一条纪律：一个单击就生效的开关会被误触）。 */
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  const resetFlow = (): void => {
    setPendingSecret(null);
    setCode('');
    setError(null);
    setBusy(false);
  };

  const startAdd = (): void => {
    if (!active) return;
    setJustDisabled(false);
    setError(null);
    setCode('');
    setPendingSecret(generateSecret());
  };

  const verifyAndEnable = async (): Promise<void> => {
    if (pendingSecret === null) return;
    setBusy(true);
    setError(null);
    const ok = await verifyTotp(pendingSecret, code, Date.now());
    setBusy(false);
    if (!ok) {
      setError('web.totp.error');
      return;
    }
    const next: TotpBinding = { enabled: true, secret: pendingSecret };
    saveTotp(next);
    setBinding(next);
    resetFlow();
  };

  const disable = (): void => {
    clearTotp();
    setBinding(null);
    setConfirmingDisable(false);
    setJustDisabled(true);
  };

  return (
    <div className="ht-settings" data-testid="totp-panel">
      <h2 className="ht-settings__title ht-type-section-title">
        {t('web.totp.title')}
        <SettingsInfoTip testId="tip-totp" label={t('web.totp.title')} text={t('web.totp.lead')} />
      </h2>

      {!signedIn ? (
        <SettingsAccountGate messageKey="web.totp.needsSignIn" testId="totp-needs-sign-in" />
      ) : (
        <>
          {justDisabled && (
            <p className="ht-settings__notice" role="status" data-testid="totp-disabled">
              <CheckCircle2 size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.totp.disabled')}
            </p>
          )}

          {binding?.enabled === true ? (
            <>
              <p className="ht-settings__notice" role="status" data-testid="totp-enabled">
                <ShieldCheck size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.totp.enabled')}
              </p>
              {confirmingDisable ? (
                <div className="ht-settings__actions">
                  <Button tone="danger" data-testid="totp-disable-confirm" onClick={disable}>
                    {t('web.totp.confirmDisable')}
                  </Button>
                  <Button
                    tone="ghost"
                    data-testid="totp-disable-cancel"
                    onClick={() => setConfirmingDisable(false)}
                  >
                    {t('web.totp.cancel')}
                  </Button>
                </div>
              ) : (
                <div className="ht-settings__actions">
                  <Button
                    tone="ghost"
                    data-testid="totp-disable"
                    onClick={() => {
                      setJustDisabled(false);
                      setConfirmingDisable(true);
                    }}
                  >
                    {t('web.totp.disable')}
                  </Button>
                </div>
              )}
            </>
          ) : pendingSecret === null ? (
            <div className="ht-settings__actions">
              <Button tone="primary" data-testid="totp-add" onClick={startAdd}>
                {t('web.totp.add')}
              </Button>
            </div>
          ) : (
            <>
              {/* 密钥是**事实数据**：直接给用户照抄进验证器应用。 */}
              <div className="ht-settings__preference-row">
                <h3 className="ht-settings__h3 ht-type-row-title">{t('web.totp.secretLabel')}</h3>
                <code className="ht-settings__value" data-testid="totp-secret">
                  {pendingSecret}
                </code>
              </div>
              <FormField id="totp-code" label={t('web.totp.codeLabel')} layout="inline">
                {(fieldProps) => (
                  <input
                    {...fieldProps}
                    className="ht-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    data-testid="totp-code-input"
                    value={code}
                    placeholder={t('web.totp.codePlaceholder')}
                    disabled={busy}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  />
                )}
              </FormField>
              {error !== null && (
                <p className="ht-settings__danger" role="alert" data-testid="totp-error">
                  <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" /> {t(error)}
                </p>
              )}
              <div className="ht-settings__actions">
                <Button
                  tone="primary"
                  data-testid="totp-verify"
                  disabled={busy || code.length !== 6}
                  onClick={() => {
                    void verifyAndEnable();
                  }}
                >
                  {busy ? (
                    <Loader2 size={ICON_SIZE.xs} className="ht-settings__busy" aria-hidden="true" />
                  ) : (
                    <ShieldCheck size={ICON_SIZE.xs} aria-hidden="true" />
                  )}{' '}
                  {t('web.totp.verify')}
                </Button>
                <Button tone="ghost" data-testid="totp-cancel" onClick={resetFlow} disabled={busy}>
                  {t('web.totp.cancel')}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
