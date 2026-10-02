import { ICON_SIZE } from '@heyta/design-system';
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
 *
 * ## 🔴 M3 第五刀（settings）：骨架已收进共享层
 *
 * 标题 / 说明 / 开关 / 两条错误 / 两句 note，现在都由 `@heyta/ui` 的
 * `SettingsSection` 渲染（与 mobile 的「我的」屏同一份实现）；本文件不再自己
 * 拼 `<section class="ht-panel">` 与 `<button class="ht-button--row">`。
 * "整个面板不画"这条判据**没有动** —— 它在渲染之前（`visibility !== 'shown'`
 * 直接 `return null`），与行的实现无关。
 *
 * ⚠️ **两处真实差异，都记在这里**：
 *
 *   1. **`disabled` 在 web 上只产出 `aria-disabled`**（RNW 的 `Pressable`
 *      白名单里没有 `disabled`）。忙时点击确实被拦住、读屏也报"已禁用"，
 *      但 `element.disabled` 读不到。本面板没有 DOM 级测试，所以这不是损失，
 *      只是已知边界；要写断言就用 `aria-disabled`。
 *   2. **开关的角色从 `aria-pressed` 变成了 `role="switch"` + `aria-checked`。**
 *      两者都能表达"开/关"，但**不是同一个 ARIA 语义**：`role="switch"`
 *      要求命名不带状态（名字是"允许后台刷新小组件"，状态在 `aria-checked`），
 *      这正是这里要的。原来那对组合的意图相同，所以这次换的是**更标准**的
 *      那一件；如果将来有人写断言，用 `role="switch"`。
 *
 * ⚠️ 每个面板各自包一层 `<HeytaUiProvider>`（理由见 `HelpPanel.tsx` 文件头）。
 */

import { useCallback, useEffect, useState } from 'react';

import { useI18n, type MessageKey } from '@heyta/i18n';
import { BellRing, Loader2, RefreshCw } from 'lucide-react';
import {
  HeytaUiProvider,
  SettingsSection,
  type SettingsRowModel,
} from '@heyta/ui';

import {
  probeWidgetPush,
  subscribeToWidgetPush,
  unsubscribeFromWidgetPush,
  type PushFailureReason,
  type PushReasonVars,
} from '../../pwa/push-subscribe.js';

/** 面板的可见性。`null` = 还在探测（**不画**）。 */
type Visibility = null | 'hidden' | 'shown';

/**
 * 原因码 → 词条 key。
 *
 * 🔴 **穷尽的 `Record`，不是查不到就原样打印**：生产原因的那一层
 * （`apps/web/src/pwa/push-subscribe.ts`）只出码、不出句子，句子住在这里。
 * 用穷尽 Record 而不是 `Record<string, MessageKey | undefined>` + 兜底，
 * 是因为「漏一条」的正确发生地点是**编译期**，不是某个用户的界面 ——
 * 兜底路径等于把「英文界面露出内部码」变成一个正常状态。
 *
 * ⚠️ 其中六条（`insecure-context` / `no-service-worker` / `no-notification-api`
 *    / `permission-denied` / `server-not-configured` / `needs-login`）目前
 *    **只在探测阶段用**，那条路径下面板整体不画，所以用户看不到它们。
 *    词条仍然要给：面板消失本身就是一次解释失败，将来要把原因画出来时
 *    不该再回头补表。
 */
const PUSH_REASON_MESSAGE_KEY: Record<PushFailureReason, MessageKey> = {
  'insecure-context': 'web.widgetPush.reason.insecureContext',
  'no-service-worker': 'web.widgetPush.reason.noServiceWorker',
  'no-notification-api': 'web.widgetPush.reason.noNotificationApi',
  'permission-denied': 'web.widgetPush.reason.permissionDenied',
  'server-not-configured': 'web.widgetPush.reason.serverNotConfigured',
  'needs-login': 'web.widgetPush.reason.needsLogin',
  'vapid-key-http': 'web.widgetPush.reason.pushKeyHttp',
  'vapid-key-malformed': 'web.widgetPush.reason.pushKeyMalformed',
  'vapid-key-length': 'web.widgetPush.reason.pushKeyLength',
  'no-subscription': 'web.widgetPush.reason.noSubscription',
  'incomplete-subscription': 'web.widgetPush.reason.incompleteSubscription',
  'register-http': 'web.widgetPush.reason.registerHttp',
  'unregister-http': 'web.widgetPush.reason.unregisterHttp',
  'probe-http': 'web.widgetPush.reason.probeHttp',
  unexpected: 'web.widgetPush.reason.unexpected',
};

export function WidgetPushPanel(): React.JSX.Element | null {
  const { t } = useI18n();
  const [visibility, setVisibility] = useState<Visibility>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 上一次操作的结果。`null` = 还没有操作过。 */
  const [error, setError] = useState<{
    key: 'failed' | 'failedOff';
    reason: PushFailureReason;
    vars?: PushReasonVars;
  } | null>(null);
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
        // ⚠️ 权限被拒之后**开关要收掉**（留一个永远失败的开关只会让人反复点），
        //    但**面板必须留下来把原因说清楚**。
        //    原来这里还顺手 `setVisibility('hidden')` —— 于是组件在第 149 行
        //    就返回 `null`，下面那条 `widget-push-denied` 提示行**从来没被画过**，
        //    用户看到的只是「开关自己消失了」。而这条纪律恰好写在
        //    `push-subscribe.ts` 文件头：**一个会静默关掉自己的安全开关比没有更糟**。
        setDenied(true);
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
          reason: result.reason,
          vars: result.vars,
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

  /**
   * 面板内容 → 共享的类型化行（与 mobile 的「我的」屏同一份骨架）。
   *
   * 🔴 开关行的 `disabled` 在 web 上**只产出 `aria-disabled`**，不产出 DOM 的
   * `disabled` —— RNW 的 `Pressable` 白名单里没有它。完整取舍与影响面写在
   * `packages/ui/src/settings/Settings.tsx` 的文件头（本面板没有 DOM 级测试，
   * 所以这一条目前不是损失，只是已知边界）。
   */
  const toggleRow: SettingsRowModel = {
    kind: 'toggle',
    testID: 'widget-push-toggle',
    label: t('web.widgetPush.rowLabel'),
    // 这一行是**状态**，不是提示：开关的标签永远不变，状态只能靠它传达。
    // 忙的时候让字形转圈（图标属于外壳，所以由宿主给）。
    hint: t(statusKey),
    checked: subscribed,
    onToggle: () => void toggle(),
    disabled: busy,
    busy,
    leading: busy ? (
      <Loader2 aria-hidden="true" size={ICON_SIZE.sm} className="ht-spin" />
    ) : (
      <RefreshCw aria-hidden="true" size={ICON_SIZE.sm} />
    ),
  };

  const rows: readonly SettingsRowModel[] = [
    // 🔴 权限已被拒 ⇒ **不再给开关**（它点了也只会再被拒一次），
    //    改由下面那条 `widget-push-denied` 说明该去哪儿改。
    ...(denied ? [] : [toggleRow]),
    ...(error
      ? ([
          {
            kind: 'note',
            testID: 'widget-push-error',
            role: 'alert',
            tone: 'danger',
            // ⚠️ `{reason}` 插进来的是**已经翻译过的那半句**，不是原始码：
            //    码在 `PUSH_REASON_MESSAGE_KEY` 查词条，数字与浏览器原话作为
            //    参数跟着词条走。
            text: t(
              error.key === 'failedOff'
                ? 'web.widgetPush.status.failedOff'
                : 'web.widgetPush.status.failed',
              { reason: t(PUSH_REASON_MESSAGE_KEY[error.reason], error.vars) },
            ),
          },
        ] as const)
      : []),
    ...(denied
      ? ([
          {
            kind: 'note',
            testID: 'widget-push-denied',
            role: 'alert',
            tone: 'danger',
            text: t('web.widgetPush.status.denied'),
          },
        ] as const)
      : []),
    // 载荷里没有任务内容 —— 用户没有别的途径知道这件事。见文件头。
    { kind: 'note', text: t('web.widgetPush.note.privacy'), divider: true },
    { kind: 'note', text: t('web.widgetPush.note.windowsOnly') },
  ];

  return (
    <HeytaUiProvider>
      <SettingsSection
        testID="widget-push-panel"
        title={t('web.widgetPush.title')}
        note={t('web.widgetPush.description')}
        leading={<BellRing aria-hidden="true" size={ICON_SIZE.md} />}
        rows={rows}
      />
    </HeytaUiProvider>
  );
}
