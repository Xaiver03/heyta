/**
 * 设置 → 账号：本地应用锁（#61）
 * ==============================
 *
 * "这台设备上，谁现在能打开这个应用" —— 纯客户端 gate，设备本地偏好、零 op
 * （见 `apps/web/src/lib/app-lock.ts` 的文件头：派生值只存本机，不上传、不同步）。
 *
 * ## 为什么放在「账号」这一组
 *
 * 这一组已经住着"谁能用这个账号登录"的四块（通行密钥 / 密码 / 两步验证 / 已登录设备）。
 * 应用锁回答的是同一句话的**设备版本**："谁能在这台设备上打开它"。放进别的组
 * （外观 / 数据 / 通知）都答非所问。
 *
 * 🔴 它**不**受登录门槛约束：应用锁是设备属性，未登录时也该能开 —— 所以它在
 * `SettingsAccountGate`（账号那一段的登录门槛）**之外**渲染。
 *
 * ## 形状
 *
 * - 一枚 `role="switch"` 的开 / 关；
 * - 开 ⇒ 先**设置 PIN**（新 PIN + 确认），提交成功才真正开启；
 * - 关 ⇒ 必须先输入**当前 PIN**（否则谁拿到解锁中的设备都能一拨关掉）；
 * - 已开启时另给「更改 PIN」与「立即锁定」。
 *
 * 所有解释（数据去哪、为什么离线可枚举不算强加密）都进 `?`，不内联（§0.2）。
 * PIN 非法 / 两次不一致 / 当前 PIN 错误，就地用 `role="alert"` 反馈。
 */

import { useState } from 'react';

import { useI18n } from '@heyta/i18n';

import { Button } from '../../components/hta/index.js';
import { Switch } from '../../components/hta/Switch.js';
import { FormField } from '../../lib/form/FormField.js';
import { clearPin, setPin, validatePin, verifyPin } from '../../lib/app-lock.js';
import { SettingsInfoTip } from './SettingsInfoTip.js';

/** 当前正在做哪一件事。`idle` = 只显示开关（以及已开启时的两枚动作）。 */
type Flow = 'idle' | 'set' | 'change' | 'disable';

export interface AppLockPanelProps {
  /** 这台设备是否已上锁（由 App 持有：锁屏遮罩要读同一个状态）。 */
  readonly enabled: boolean;
  /** 开启 / 关闭成功后，把新状态同步给 App。 */
  readonly onChangeEnabled: (enabled: boolean) => void;
  /** 「立即锁定」：立刻弹锁屏（需要已开启）。 */
  readonly onLockNow: () => void;
}

export function AppLockPanel({ enabled, onChangeEnabled, onLockNow }: AppLockPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [flow, setFlow] = useState<Flow>('idle');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const reset = (): void => {
    setFlow('idle');
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setError(undefined);
  };

  const switchOn = enabled ? flow !== 'disable' : flow === 'set';

  const handleToggle = (next: boolean): void => {
    if (busy) return;
    if (next) {
      if (!enabled) {
        reset();
        setFlow('set');
      }
      return;
    }
    reset();
    if (enabled) setFlow('disable');
  };

  const submitSet = async (): Promise<void> => {
    if (busy) return;
    setError(undefined);
    const validation = validatePin(newPin);
    if (!validation.ok) {
      setError(validation.reason === 'nondigit' ? t('web.settings.appLock.errNondigit') : t('web.settings.appLock.errLength'));
      return;
    }
    if (newPin !== confirmPin) {
      setError(t('web.settings.appLock.errMismatch'));
      return;
    }
    setBusy(true);
    try {
      if (flow === 'change') {
        const ok = await verifyPin(currentPin);
        if (!ok) {
          setError(t('web.settings.appLock.errWrong'));
          return;
        }
      }
      await setPin(newPin);
      if (!enabled) onChangeEnabled(true);
      reset();
    } finally {
      setBusy(false);
    }
  };

  const submitDisable = async (): Promise<void> => {
    if (busy) return;
    setError(undefined);
    setBusy(true);
    try {
      const ok = await verifyPin(currentPin);
      if (!ok) {
        setError(t('web.settings.appLock.errWrong'));
        return;
      }
      clearPin();
      onChangeEnabled(false);
      reset();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ht-settings" data-testid="app-lock-panel">
      <h2 className="ht-settings__title ht-type-section-title">
        {t('web.settings.appLock.title')}
        <SettingsInfoTip
          testId="tip-app-lock"
          label={t('web.settings.appLock.title')}
          text={t('web.settings.appLock.tip')}
        />
      </h2>

      <div className="ht-settings__preference-row">
        <h3 className="ht-settings__h3 ht-type-row-title">{t('web.settings.appLock.enable')}</h3>
        <Switch
          checked={switchOn}
          onChange={handleToggle}
          ariaLabel={t('web.settings.appLock.title')}
          testID="app-lock-toggle"
        />
      </div>

      {flow === 'set' || flow === 'change' ? (
        <form
          className="ht-app__lock-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitSet();
          }}
        >
          {flow === 'change' ? (
            <FormField id="app-lock-current" label={t('web.settings.appLock.currentPinLabel')} layout="stacked">
              {(field) => (
                <input
                  {...field}
                  className="ht-input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={currentPin}
                  onChange={(event) => {
                    setCurrentPin(event.target.value);
                  }}
                />
              )}
            </FormField>
          ) : null}
          <FormField id="app-lock-new" label={t('web.settings.appLock.newPinLabel')} layout="stacked">
            {(field) => (
              <input
                {...field}
                className="ht-input"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={newPin}
                onChange={(event) => {
                  setNewPin(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField id="app-lock-confirm" label={t('web.settings.appLock.confirmPinLabel')} layout="stacked">
            {(field) => (
              <input
                {...field}
                className="ht-input"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={confirmPin}
                onChange={(event) => {
                  setConfirmPin(event.target.value);
                }}
              />
            )}
          </FormField>
          {error === undefined ? null : (
            <p className="ht-settings__danger" role="alert" data-testid="app-lock-error">
              {error}
            </p>
          )}
          <div className="ht-app__lock-form-actions">
            <Button
              tone="ghost"
              onClick={() => {
                reset();
              }}
            >
              {t('web.settings.appLock.cancel')}
            </Button>
            <Button
              tone="primary"
              type="submit"
              loading={busy}
              data-testid="app-lock-save"
            >
              {t('web.settings.appLock.save')}
            </Button>
          </div>
        </form>
      ) : null}

      {flow === 'disable' ? (
        <form
          className="ht-app__lock-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitDisable();
          }}
        >
          <FormField id="app-lock-disable" label={t('web.settings.appLock.currentPinLabel')} layout="stacked">
            {(field) => (
              <input
                {...field}
                className="ht-input"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={currentPin}
                onChange={(event) => {
                  setCurrentPin(event.target.value);
                }}
              />
            )}
          </FormField>
          {error === undefined ? null : (
            <p className="ht-settings__danger" role="alert" data-testid="app-lock-error">
              {error}
            </p>
          )}
          <div className="ht-app__lock-form-actions">
            <Button
              tone="ghost"
              onClick={() => {
                reset();
              }}
            >
              {t('web.settings.appLock.cancel')}
            </Button>
            <Button
              tone="primary"
              type="submit"
              loading={busy}
              data-testid="app-lock-save"
            >
              {t('web.settings.appLock.disableAction')}
            </Button>
          </div>
        </form>
      ) : null}

      {flow === 'idle' && enabled ? (
        <div className="ht-app__lock-form-actions">
          <Button
            tone="secondary"
            data-testid="app-lock-change"
            onClick={() => {
              reset();
              setFlow('change');
            }}
          >
            {t('web.settings.appLock.changePin')}
          </Button>
          <Button tone="secondary" data-testid="app-lock-now" onClick={onLockNow}>
            {t('web.settings.appLock.lockNow')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
