/**
 * 专注手动补录（覆盖图谱 #50 的「手动补录入口」）
 * ==============================================
 *
 * 滴答的专注页右上 `⋯` 有「添加专注记录（补录）」。这里给一个最小的补录表单：
 * 选日期 + 填分钟数 → 写一条已完成的工作段。
 *
 * 🔴 写路径走 op-log：`logManualFocus` → `@heyta/app-host#manualFocusSession`
 * （构造语义在 packages/）+ `focusActions.log()`（唯一写入口）。本组件只收集
 * 两个用户输入并做**交互校验**（空/非正数直接说），业务校验（时长必须为正）
 * 由动作层抛错，这里接住并用词条说清。
 */
import { useState } from 'react';

import { toLocalDate } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';

import { logManualFocus } from './store.js';

export function FocusManualEntry(): React.JSX.Element {
  const { t } = useI18n();
  const [date, setDate] = useState(() => toLocalDate(Date.now()));
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = async (): Promise<void> => {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value <= 0) {
      setError(t('web.focus.manual.invalid'));
      return;
    }
    // 归属日由 endedAt 决定（统计同口径，`focusSessionDay`）。补录只精确到日，
    // 取当天正午作为该段的结束时刻 —— 日粒度统计不受影响。
    const endedAt = new Date(`${date}T12:00:00`).getTime();
    if (!Number.isFinite(endedAt)) {
      setError(t('web.focus.manual.invalid'));
      return;
    }
    setBusy(true);
    try {
      await logManualFocus(value, endedAt);
      setMinutes('');
      setError(undefined);
    } catch {
      setError(t('web.focus.manual.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ht-app__focus-stats" data-testid="focus-manual">
      <h3 className="ht-app__detail-heading">{t('web.focus.manual.title')}</h3>
      <form
        className="ht-app__focus__manual"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="ht-app__focus__manual-field">
          {t('web.focus.manual.date')}
          <input
            type="date"
            className="ht-input"
            value={date}
            onChange={(e) => { setDate(e.target.value); }}
          />
        </label>
        <label className="ht-app__focus__manual-field">
          {t('web.focus.manual.minutes')}
          <input
            type="number"
            min={1}
            className="ht-input"
            value={minutes}
            onChange={(e) => { setMinutes(e.target.value); }}
          />
        </label>
        <button type="submit" className="ht-btn ht-btn--primary" disabled={busy}>
          {t('web.focus.manual.submit')}
        </button>
        {error === undefined ? null : (
          <span className="ht-app__focus__manual-error" role="alert">
            {error}
          </span>
        )}
      </form>
    </section>
  );
}
