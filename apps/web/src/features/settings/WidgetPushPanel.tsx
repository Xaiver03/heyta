/**
 * Windows 小组件的后台刷新开关（设置页）。
 * ==========================================
 *
 * 这是 Web Push 那条链（⑬–⑰）的**最后一个缺口**：服务端能推、浏览器能订阅，
 * 但**没有任何界面能让用户开启它** —— 也就是说，前面全部就绪而这个功能
 * 对用户来说不存在。
 *
 * ## 分层（AGENTS.md §3.5）
 *
 * 这里**没有一行 Web Push 协议知识**：
 *   - `pushManager` / `userVisibleOnly` / base64url 公钥 → `../pwa/push-subscribe.js`；
 *   - "谁该看到这个开关" → `probeWidgetPush`；
 *   - 本文件只把状态渲染成句子、把点击转成调用。
 *
 * ## 🔴 两个承重的界面决定
 *
 * **（1）能力不可用时整个面板不画。**
 *
 * 在 `http://` 上、在没配 VAPID 的自托管实例上、在权限被拒之后，
 * 这个能力**根本不存在**。画一个开关让用户点、点了必然失败，
 * 用户只会以为应用坏了。这与 iOS 侧 `readWidgetPrivacy()` 返回 `null` 时
 * 省略开关是**同一条纪律**（见进度账本里"一个会静默关掉自己的安全开关
 * 比没有更糟"）。
 *
 * ⚠️ 探测中（`null`）也**不画** —— 画一个"先显示关闭、一秒后跳成开启"的
 * 开关会让用户以为它在自己乱动。宁可晚半秒出现。
 *
 * **（2）失败必须说出来，而且要说清是哪一步失败。**
 *
 * 开启失败与关闭失败的后果**方向相反**，不能共用一句话：
 * "开启失败"意味着组件不会自动更新（用户该重试）；
 * "关闭失败"意味着**它还在后台刷新**（用户以为已经关了）——
 * 后者更糟，因为它是一个**没生效的隐私选择**。
 *
 * ## 与"推送内容"有关的一句话为什么必须在这里
 *
 * `note.privacy` 不是营销文案。用户看到"允许后台刷新"时最自然的担心是
 * "我的任务会不会被传到服务器"。答案是**不会**（载荷只是一句"有更新了"，
 * 服务端没有密钥），而用户**没有任何别的途径知道这件事** ——
 * 不说，他就只能猜。
 */

import { useCallback, useEffect, useState } from 'react';

import { useI18n } from '@heyta/i18n';
import { BellRing, Loader2, RefreshCw } from 'lucide-react';

import {
  probeWidgetPush,
  subscribeToWidgetPush,
  unsubscribeFromWidgetPush,
} from '../../pwa/push-subscribe.js';

/** 面板的可见性。`null` = 还在探测（**不画**）。 */
type Visibility = null | 'hidden' | 'shown';

export function WidgetPushPanel(): React.JSX.Element | null {
  const { t } = useI18n();
  const [visibility, setVisibility] = useState<Visibility>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 上一次操作的结果。`null` = 还没有操作过。 */
  const [error, setError] = useState<{ key: 'failed' | 'failedOff'; reason: string } | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    // ⚠️ `alive` 守卫：探测是异步的，而设置页可以被很快地切走。
    //    没有它就会在已卸载的组件上 setState（React 会警告，且状态是垃圾）。
    let alive = true;
    void (async () => {
      const probe = await probeWidgetPush();
      if (!alive) return;
      if (!probe.available) {
        // 🔴 不画。见文件头（1）。
        setVisibility('hidden');
        return;
      }
      setSubscribed(probe.subscribed);
      setVisibility('shown');
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = subscribed ? await unsubscribeFromWidgetPush() : await subscribeToWidgetPush();
    // ⚠️ `busy` 在**所有**分支都要复位 —— 漏一条就会让开关永远转圈。
    setBusy(false);

    switch (result.status) {
      case 'subscribed':
        setSubscribed(true);
        return;
      case 'unsubscribed':
        setSubscribed(false);
        return;
      case 'denied':
        // ⚠️ 权限被拒之后**面板要消失**：能力还在，但用户在我们这里点不出结果，
        //    该做的是去浏览器设置里改。留一个永远失败的开关只会让人反复点。
        setDenied(true);
        setVisibility('hidden');
        return;
      case 'disabled':
        setVisibility('hidden');
        return;
      case 'unsupported':
        setVisibility('hidden');
        return;
      default:
        setError({
          key: subscribed ? 'failedOff' : 'failed',
          reason: result.status === 'failed' ? result.reason : '',
        });
        return;
    }
  }, [subscribed]);

  if (visibility !== 'shown') {
    // `hidden` 与 `null`（探测中）都返回 `null`，但含义不同 ——
    // `null` 只持续到探测结束，`hidden` 是终态。
    return null;
  }

  const statusKey = busy
    ? 'web.widgetPush.status.working'
    : subscribed
      ? 'web.widgetPush.status.subscribed'
      : 'web.widgetPush.status.off';

  return (
    <section className="ht-panel" aria-labelledby="ht-widget-push-title">
      <h2 className="ht-panel__title" id="ht-widget-push-title">
        <BellRing aria-hidden="true" size={18} />
        {t('web.widgetPush.title')}
      </h2>
      <p className="ht-panel__description">{t('web.widgetPush.description')}</p>

      <button
        type="button"
        className="ht-button ht-button--row"
        onClick={() => void toggle()}
        disabled={busy}
        // 🔴 `aria-pressed` 让读屏用户能听出当前状态 —— 这个开关的**标签不变**
        //    （永远叫"允许后台刷新小组件"），所以状态只能靠它传达。
        aria-pressed={subscribed}
        aria-busy={busy}
      >
        {busy ? (
          <Loader2 aria-hidden="true" size={16} className="ht-spin" />
        ) : (
          <RefreshCw aria-hidden="true" size={16} />
        )}
        <span>{t('web.widgetPush.rowLabel')}</span>
        <span className="ht-button__hint">{t(statusKey)}</span>
      </button>

      {error ? (
        <p className="ht-panel__error" role="alert">
          {t(error.key === 'failedOff' ? 'web.widgetPush.status.failedOff' : 'web.widgetPush.status.failed', {
            reason: error.reason,
          })}
        </p>
      ) : null}

      {denied ? (
        <p className="ht-panel__error" role="alert">
          {t('web.widgetPush.status.denied')}
        </p>
      ) : null}

      {/* 载荷里没有任务内容 —— 用户没有别的途径知道这件事。见文件头。 */}
      <p className="ht-panel__note">{t('web.widgetPush.note.privacy')}</p>
      <p className="ht-panel__note">{t('web.widgetPush.note.windowsOnly')}</p>
    </section>
  );
}
