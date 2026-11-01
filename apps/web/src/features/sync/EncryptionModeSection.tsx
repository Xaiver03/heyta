import { useState } from 'react';

import { useI18n } from '@heyta/i18n';

import { DangerConfirmDialog } from '../../lib/dialog/DangerConfirmDialog.js';
import { FormField } from '../../lib/form/FormField.js';
import { SettingsInfoTip } from '../settings/SettingsInfoTip.js';

/**
 * ADR-0080 的第一个轴：**同步加密开 / 关**。
 *
 * 第二个轴（钥匙放在哪）不在这里：它只在"加密=开"时才有意义，
 * 且完全不改变"谁能读"。两个轴混在一个控件里，用户会以为
 * "记住解锁"就等于"不加密"——那是这份 ADR 要消灭的那类误解。
 *
 * ## 这一层只做三件事
 *
 * 1. 显示当前模式（**只写谁能读**，不写"更安全/更私密"这类比较）；
 * 2. 关闭前过一次危险确认，逐条列出三个后果；
 * 3. 把动作交给宿主（真正的迁移在宿主里做，界面不做密码学）。
 *
 * 危险确认复用共享的那枚 `DangerConfirmDialog`（危险四档里的 `alert`：
 * 它不可撤销，但不需要用户输入文字才能继续）。
 */
export interface EncryptionModeSectionProps {
  mode: 'e2ee' | 'plain';
  busy?: boolean;
  /** 关闭：整库解密重传。**不可撤回**（已进备份的明文收不回来）。 */
  onDisable: () => Promise<void> | void;
  /**
   * 重新开启：新 root + 全量加密迁移（两段）。
   *
   * ⚠️ **不传就不画那个按钮**。画一个按下去没反应（或只做完第一段）的按钮，
   * 比不画更糟。
   */
  enable?: {
    /** 第一步：生成本地 root 与包，返回**只显示一次**的恢复码。 */
    begin: (passphrase: string) => Promise<{ recoveryCode: string }>;
    /** 第二步：用户回填恢复码后，真的开始整库重加密。 */
    confirm: (enteredRecoveryCode: string) => Promise<void>;
  };
  /** 迁移进度（可选显示）。 */
  progress?: { completed: number; total: number };
  /**
   * 第二个轴（ADR-0080 §5.5）：钥匙放在哪。
   *
   * ⚠️ **不传就不画这一行**（与 `enable` 同一条规矩）：没有落地的偏好读取点，
   * 画出来就是一个不生效的开关。
   */
  keyPlacement?: {
    value: 'device' | 'ask';
    onChange: (next: 'device' | 'ask') => void;
  };
}

export function EncryptionModeSection({
  mode,
  busy = false,
  onDisable,
  enable,
  progress,
  keyPlacement,
}: EncryptionModeSectionProps) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  // 开启方向的两段状态：null = 还没开始；否则是"待回填恢复码"。
  const [enableStep, setEnableStep] = useState<
    { recoveryCode: string; passphrase: string } | undefined
  >(undefined);
  const [enablePassphrase, setEnablePassphrase] = useState('');
  const [enableCodeInput, setEnableCodeInput] = useState('');
  const [enableError, setEnableError] = useState<string | undefined>(undefined);

  const startDisable = (): void => {
    setConfirming(false);
    void onDisable();
  };

  return (
    <section className="ht-settings__group" data-testid="encryption-mode-section" data-mode={mode}>
      <h3 className="ht-settings__h3">{t('web.sync.encryption.title')}</h3>
      <p className="ht-settings__hint" role="status" data-testid="encryption-mode-status">
        {t(mode === 'e2ee' ? 'web.sync.encryption.on' : 'web.sync.encryption.off')}
      </p>

      {busy ? (
        <p className="ht-settings__hint" role="status" data-testid="encryption-mode-status-busy">
          {t('web.sync.encryption.busy')}
          {progress === undefined ? null : ` ${String(progress.completed)}/${String(progress.total)}`}
        </p>
      ) : null}

      <div className="ht-settings__actions">
        {mode === 'e2ee' ? (
          <button
            type="button"
            className="ht-btn ht-btn--ghost"
            data-testid="encryption-mode-disable"
            disabled={busy}
            onClick={() => { setConfirming(true); }}
          >
            {t('web.sync.encryption.disable')}
          </button>
        ) : (
          enable === undefined ? null : (
            enableStep === undefined ? (
              <button
                type="button"
                className="ht-btn ht-btn--primary"
                data-testid="encryption-mode-enable"
                disabled={busy}
                onClick={() => { setEnableStep({ recoveryCode: '', passphrase: '' }); }}
              >
                {t('web.sync.encryption.enable')}
              </button>
            ) : null
          )
        )}
      </div>

      {/*
        第二个轴：**只决定要不要每次输口令**，不改变"谁能读"。
        它排在开关下面，与开关分开 —— 混在一个控件里，用户会以为"记住解锁"＝"不加密"。
      */}
      {keyPlacement === undefined || mode !== 'e2ee' ? null : (
        <fieldset className="ht-settings__section" data-testid="encryption-key-placement">
          <legend className="ht-settings__h3">
            {t('web.sync.encryption.placementTitle')}
            <SettingsInfoTip
              testId="tip-encryption-placement"
              label={t('web.sync.encryption.placementTitle')}
              text={t('web.sync.encryption.placementHint')}
            />
          </legend>
          <div className="ht-settings__actions">
            <button
              type="button"
              className={keyPlacement.value === 'device' ? 'ht-btn ht-btn--primary' : 'ht-btn ht-btn--ghost'}
              data-testid="encryption-placement-device"
              aria-pressed={keyPlacement.value === 'device'}
              onClick={() => { keyPlacement.onChange('device'); }}
            >
              {t('web.sync.encryption.placementDevice')}
            </button>
            <button
              type="button"
              className={keyPlacement.value === 'ask' ? 'ht-btn ht-btn--primary' : 'ht-btn ht-btn--ghost'}
              data-testid="encryption-placement-ask"
              aria-pressed={keyPlacement.value === 'ask'}
              onClick={() => { keyPlacement.onChange('ask'); }}
            >
              {t('web.sync.encryption.placementAsk')}
            </button>
          </div>
        </fieldset>
      )}

      {/*
        开启方向的两段（ADR-0080 §5.3）：先设口令拿到一次性恢复码，回填之后才真的迁移。
        🔴 第二段不可跳过：恢复码是"忘记口令"时唯一退路，而它只显示一次。
      */}
      {enable !== undefined && enableStep !== undefined ? (
        <div className="ht-settings__section" data-testid="encryption-mode-enable-form">
          {enableStep.recoveryCode === '' ? (
            <>
              <FormField id="encryption-enable-passphrase" label={t('web.sync.encryption.enablePassphrase')}>
                {(field) => (
                  <input
                    {...field}
                    data-testid="encryption-enable-passphrase"
                    type="password"
                    autoComplete="new-password"
                    value={enablePassphrase}
                    onChange={(event) => { setEnablePassphrase(event.target.value); }}
                  />
                )}
              </FormField>
              <div className="ht-settings__actions">
                <button
                  type="button"
                  className="ht-btn ht-btn--primary"
                  data-testid="encryption-enable-start"
                  disabled={busy || enablePassphrase.length === 0}
                  onClick={() => {
                    void (async () => {
                      const started = await enable.begin(enablePassphrase);
                      setEnableStep({ recoveryCode: started.recoveryCode, passphrase: enablePassphrase });
                    })();
                  }}
                >
                  {t('web.sync.encryption.enableStart')}
                </button>
                <button
                  type="button"
                  className="ht-btn ht-btn--ghost"
                  data-testid="encryption-enable-abort"
                  onClick={() => { setEnableStep(undefined); setEnablePassphrase(''); }}
                >
                  {t('web.sync.encryption.enableCancel')}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="ht-settings__hint" data-settings-disclosure>
                {t('web.sync.encryption.enableRecoveryHint')}
              </p>
              <p className="ht-settings__notice" data-testid="encryption-enable-recovery-code">
                {enableStep.recoveryCode}
              </p>
              <FormField id="encryption-enable-recovery" label={t('web.sync.encryption.enableRecoveryInput')}>
                {(field) => (
                  <input
                    {...field}
                    data-testid="encryption-enable-recovery"
                    type="text"
                    autoComplete="off"
                    value={enableCodeInput}
                    onChange={(event) => { setEnableCodeInput(event.target.value); }}
                  />
                )}
              </FormField>
              {enableError === undefined ? null : (
                <p className="ht-settings__hint" role="alert" data-testid="encryption-enable-error">{enableError}</p>
              )}
              <div className="ht-settings__actions">
                <button
                  type="button"
                  className="ht-btn ht-btn--primary"
                  data-testid="encryption-enable-confirm"
                  disabled={busy || enableCodeInput.length === 0}
                  onClick={() => {
                    void (async () => {
                      try {
                        await enable.confirm(enableCodeInput);
                        setEnableStep(undefined);
                        setEnableCodeInput('');
                        setEnablePassphrase('');
                        setEnableError(undefined);
                      } catch {
                        setEnableError(t('web.sync.encryption.enableMismatch'));
                      }
                    })();
                  }}
                >
                  {t('web.sync.encryption.enableConfirm')}
                </button>
                <button
                  type="button"
                  className="ht-btn ht-btn--ghost"
                  data-testid="encryption-enable-abort-2"
                  onClick={() => { setEnableStep(undefined); setEnableCodeInput(''); setEnableError(undefined); }}
                >
                  {t('web.sync.encryption.enableCancel')}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {confirming ? (
        <DangerConfirmDialog
          testId="encryption-mode-confirm"
          labelledBy="encryption-mode-confirm-title"
          cancelLabel={t('web.sync.encryption.cancel')}
          confirmLabel={t('web.sync.encryption.confirmAction')}
          onCancel={() => { setConfirming(false); }}
          onConfirm={startDisable}
        >
          <h2 id="encryption-mode-confirm-title" className="ht-settings__h3">
            {t('web.sync.encryption.confirmTitle')}
          </h2>
          {/*
            🔴 三条后果各自一条，**不许合并**：合并之后用户只能看到"会变得不加密"，
            而真正要他承担的是"备份里那份也收不回来"。
            判据：apps/web/tests/encryption-mode-section.spec.tsx 逐条数。
          */}
          <ul className="ht-settings__list" data-testid="encryption-mode-consequences">
            <li data-testid="encryption-mode-consequence-1">{t('web.sync.encryption.c1')}</li>
            <li data-testid="encryption-mode-consequence-2">{t('web.sync.encryption.c2')}</li>
            <li data-testid="encryption-mode-consequence-3">{t('web.sync.encryption.c3')}</li>
          </ul>
        </DangerConfirmDialog>
      ) : null}
    </section>
  );
}
