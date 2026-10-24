/**
 * 「提醒通知」设置节
 * ==================
 *
 * 它存在的理由是**权限只能由用户手势申请**（见 `notify.ts` 的
 * `requestNotificationPermission`）。没有这个按钮的话，那条投递路径
 * 永远停在 `permission !== 'granted'` —— 而它的表现是"什么都不会发生"，
 * 用户完全无从知道为什么。
 *
 * ## 🔴 三种状态各自说清楚，而不是只有一个开关
 *
 * | 状态 | 显示 | 为什么 |
 * |---|---|---|
 * | 不支持 | 一句说明 | http:// 自托管实例、旧浏览器 —— 是**环境**问题，不是用户能改的 |
 * | 未授权 | **申请按钮** | 唯一能改变它的动作（必须在手势里） |
 * | 已授权 | 一句"已开启" | 不需要按钮；再给一个只会让人去点 |
 * | 已拒绝 | 一句说明 | ⚠️ **浏览器不允许再次弹框** —— 给按钮就是给一个点了没反应的按钮 |
 *
 * ⚠️ 这一段还**如实写出局限**（应用没开就不响）：不说的话，
 * 用户会把它当成系统级闹钟，然后在某次没响时认为应用坏了。
 */

import { useEffect, useState } from 'react';

import { useI18n } from '@heyta/i18n';

import type { NotificationRequestResult } from './notify.js';
import { resolveReminderCenter } from './shell-reminder-center.js';
import { SettingsNotice } from '../settings/SettingsNotice.js';

export function ReminderNotifyPanel(): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 初值是 `default`（"还不知道"）而不是同步读一次：壳那条腿
   *（`heytaReminder` 消息通道）一问一答是**异步**的，渲染期拿不到同步答案。
   * 第一拍交给下面那个 effect —— 它本来就是干这件事的。
   */
  const [permission, setPermission] = useState<NotificationRequestResult>('default');

  // 权限可能在系统设置里被改掉；用户切回 heyta 时要读一次真实状态。
  useEffect(() => {
    const refresh = (): void => {
      if (document.visibilityState !== 'visible') return;
      void Promise.resolve(resolveReminderCenter().permission()).then(setPermission);
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);

  /**
   * 🔴 只能在**用户手势里**调 —— 这两个按钮存在的全部理由。
   *
   * ⚠️ 浏览器那条腿在没有 `requestPermission` 时退回"再读一次"，而不是给一个
   * 点了没反应的按钮；壳那条腿的 `request` 由壳决定它到底能不能问
   *（macOS 能弹系统询问；Windows/Linux 没有应用内询问，只回当前状态 —— 不许为了变绿说谎）。
   */
  const ask = (): void => {
    const center = resolveReminderCenter();
    const pending = center.request ? center.request() : Promise.resolve(center.permission());
    void Promise.resolve(pending).then(setPermission);
  };

  return (
    <section className="ht-settings" data-testid="reminder-notify-panel">
      <h2 className="ht-settings__title ht-type-section-title">{t('web.reminder.notify.title')}</h2>

      {permission === 'granted' ? (
        <SettingsNotice
          tone="success"
          title={t('web.reminder.notify.granted')}
          testId="reminder-notify-granted"
        />
      ) : permission === 'denied' ? (
        <SettingsNotice
          tone="danger"
          title={t('web.reminder.notify.denied')}
          testId="reminder-notify-denied"
        />
      ) : permission === 'unsupported' ? (
        <SettingsNotice
          tone="info"
          title={t('web.reminder.notify.unsupported')}
          testId="reminder-notify-unsupported"
        />
      ) : permission === 'error' ? (
        <SettingsNotice
          tone="danger"
          title={t('web.reminder.notify.requestFailed')}
          testId="reminder-notify-request-failed"
          actions={
            <button
              type="button"
              className="ht-btn ht-btn--primary"
              data-testid="reminder-notify-request"
              onClick={ask}
            >
              {t('web.reminder.notify.request')}
            </button>
          }
        />
      ) : (
        <>
          <p className="ht-settings__hint">{t('web.reminder.notify.intro')}</p>
          <div className="ht-settings__actions">
            <button
              type="button"
              className="ht-btn ht-btn--primary"
              data-testid="reminder-notify-request"
              onClick={ask}
            >
              {t('web.reminder.notify.request')}
            </button>
          </div>
        </>
      )}

      {/* 局限必须说出来，否则用户会把它当系统级闹钟。 */}
      <p className="ht-settings__hint" data-testid="reminder-notify-limit">
        {t('web.reminder.notify.limit')}
      </p>
    </section>
  );
}
