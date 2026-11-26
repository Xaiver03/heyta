/**
 * 本地应用锁的锁屏遮罩（#61）
 * ===========================
 *
 * 开启应用锁后，每次冷启动把整个应用挡在这一层后面，直到输入正确的 PIN。
 * 它是**纯客户端 gate**：不加密数据、不碰同步，只回答"这台设备上现在谁能进来"
 * （见 `apps/web/src/lib/app-lock.ts` 文件头对强度边界的说明）。
 *
 * ## 浮层 / 焦点纪律
 *
 * 外壳走 Web 的共享模态壳 `WebModalShell`（不是自绘一层）：它内置焦点隔离
 * （初始焦点给 PIN 输入框、Tab 不外逃、关闭归还触发者），三条关闭通道**全部查
 * 共享关闭策略表**。这里选 `modal-forced-read` 那一行 —— 背景 / Esc / 返回键全 `deny`、
 * 不给 ×，**唯一出口是输对 PIN**。这正是"锁屏"需要的语义：没有旁路。
 *
 * ## 为什么没有 `?` / 说明文字
 *
 * 锁屏只有一件事要做：输 PIN。标题已经说明"已锁定"，多写一句就是噪音（§0.2）。
 * 唯一的文字反馈是**错误**（`role="alert"`），那是必须的（用户要知道刚才那串不对）。
 */

import { useRef, useState } from 'react';

import { useI18n } from '@heyta/i18n';

import { Button } from '../../components/hta/index.js';
import { WebModalShell } from '../../lib/dialog/WebModalShell.js';
import { FormField } from '../../lib/form/FormField.js';
import { verifyPin } from '../../lib/app-lock.js';

export interface LockScreenProps {
  /** 输对 PIN 之后调用，由 App 摘掉这层遮罩。 */
  readonly onUnlocked: () => void;
}

export function LockScreen({ onUnlocked }: LockScreenProps): React.JSX.Element {
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await verifyPin(pin);
      if (ok) {
        onUnlocked();
        return;
      }
      setError(t('web.settings.appLock.errWrong'));
      setPin('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <WebModalShell
      policy="modal-forced-read"
      testId="app-lock-screen"
      labelledBy="app-lock-screen-title"
      overlayClass="ht-app__lock-scrim"
      dialogClass="ht-app__lock-dialog"
      modalCommitment
      initialFocusRef={inputRef}
      onCancel={() => {
        /* modal-forced-read 的三条关闭通道全是 deny，这个出口永远不该被调用。 */
      }}
    >
      <h2 id="app-lock-screen-title" className="ht-type-panel-title" data-testid="app-lock-screen-title">
        {t('web.settings.appLock.unlockTitle')}
      </h2>
      <FormField
        id="app-lock-pin"
        label={t('web.settings.appLock.pinLabel')}
        layout="stacked"
        error={error}
        testID="app-lock-pin-field"
      >
        {(field) => (
          <input
            {...field}
            ref={inputRef}
            data-testid="app-lock-pin"
            className="ht-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(event) => {
              setPin(event.target.value);
              setError(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
          />
        )}
      </FormField>
      <div className="ht-app__lock-form-actions">
        <Button tone="primary" loading={busy} data-testid="app-lock-submit" onClick={() => void submit()}>
          {t('web.settings.appLock.unlockAction')}
        </Button>
      </div>
    </WebModalShell>
  );
}
