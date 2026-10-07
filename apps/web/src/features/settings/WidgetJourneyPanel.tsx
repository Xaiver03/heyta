import { ICON_SIZE } from '@heyta/design-system';
/**
 * Web/Windows 的小组件旅程（设置页）。
 * ====================================
 *
 * 补的是一个很具体的缺口：**Web 端此前只讲"推送开关"，一个字都没说卡片从哪来。**
 * 而 Windows 的卡片**只来自已安装的 PWA** —— 用户不先把 heyta 装成应用，
 * 去小组件面板里找一个不存在的条目，只会以为功能坏了。
 *
 * ## 分层（AGENTS.md §3.5）
 *
 * 这里**没有一行平台知识**：平台三分支、步骤表、"要不要教怎么装"全在
 * `../pwa/widget-install.js`（纯逻辑，测试覆盖宿主与平台分支）。本文件只把状态渲染成句子。
 *
 * ## 🔴 两个界面决定
 *
 * **（1）已经装成应用在跑时，第一段不再画。**
 *
 * 用户已经在应用窗口里了，再教他"怎么装成应用"是荒谬的。但**整段不消失** ——
 * 小组件那一段（怎么加到面板、推送开关）仍然有用。所以分开判断。
 *
 * **（2）"卡片只来自已安装的应用"这句话必须写在界面上，不能只写在文档里。**
 *
 * 这是用户最容易误解的一点：他在浏览器里打开了 heyta，去小组件面板里找不到它，
 * 就会认为"这功能没做"。**说清约束比描述功能更重要。**
 *
 * ## 🔴 M3 第五刀（settings）：骨架已收进共享层
 *
 * 标题 / 说明 / 状态 / 步骤 / 结尾那句，现在都由 `@heyta/ui` 的
 * `SettingsSection` 渲染（与 mobile 的「我的」屏同一份实现）；本文件不再自己
 * 拼 `<section class="ht-panel">` / `<h2>` / `<ol class="ht-panel__steps">`。
 *
 * ⚠️ 每个面板各自包一层 `<HeytaUiProvider>`：`view === 'settings'` 那棵子树在
 * `App.tsx` 里没有 Provider（它只覆盖 `tasks` 与 `focus`），而 `App.tsx` 不在
 * 本刀白名单。**不要**提成一个只渲染 `{children}` 的包装组件 ——
 * `check:ui-provider` 的"消费者在不在 Provider 子树内"按**同一文件内的配对标签**
 * 判断，隔一个文件就判成"在之外"。
 *
 * ⚠️ 两个字形（`LayoutGrid` / `MonitorCheck`）走 `leading` 插槽保留下来了：
 * web 的字形来自 `lucide-react` 的组件，共享层吃的是 `lucide` 的数据，
 * 两端不同源。
 *
 * ⚠️ **一处真实的外观变化**：原来的步骤是 `<ol>`（浏览器给有序编号），
 * 现在是共享的说明行 + 共享层画的 `index`（"1." 是一个 `numeric-body`
 * 文字节点，不再是浏览器的 list marker）。序号仍然在、顺序仍然一样；
 * 少掉的是 `<ol>` 的语义角色 —— **读屏不再把这一组报成"有序列表"**。
 * 这是这次迁移的一处真实损失，最小可行的一步：给 `SettingsSection` 加一个
 * `ordered` 开关，用 `role="list"` + `role="listitem"` 把语义补回来
 * （`EmptyState` / `TaskList` 已有同类做法）。
 */

import { useEffect, useState } from 'react';

import { useI18n } from '@heyta/i18n';
import { LayoutGrid, MonitorCheck } from 'lucide-react';
import {
  HeytaUiProvider,
  SettingsSection,
  type SettingsRowModel,
} from '@heyta/ui';

import {
  installSteps,
  isRunningStandalone,
  resolveWidgetJourneyHost,
} from '../../pwa/widget-install.js';
import { resolveStorageBackend } from '../../lib/oplog.js';

/** 取当前平台名。⚠️ `userAgentData` 在部分浏览器没有，回落到 `platform`。 */
function currentPlatformName(): string {
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  return uaData?.platform ?? navigator.platform ?? '';
}

export function WidgetJourneyPanel(): React.JSX.Element {
  const { t } = useI18n();
  const [standalone, setStandalone] = useState(false);
  // 原生壳通过真实端口注入能力；不要用 UA 把原生窗口当成浏览器标签页。
  const nativeShell = resolveStorageBackend() === 'shell';

  useEffect(() => {
    // ⚠️ 放进 effect 而不是渲染期：`matchMedia` 在 SSR / 无 DOM 环境下不存在，
    //    渲染期调用会在导入时就炸（而 `isRunningStandalone` 内部已兜住抛异常）。
    setStandalone(isRunningStandalone((q) => window.matchMedia(q).matches));
  }, []);

  const hostState = resolveWidgetJourneyHost(currentPlatformName(), standalone, nativeShell);
  const steps = installSteps(hostState.platform);
  // 网页小组件目前只有 Windows PWA 这条宿主链路。原生桌面窗口已经安装，
  // 但“应用已安装”与“系统小组件可用”是两个独立事实，不能混成一个状态。
  const showInstall = hostState.showInstallGuide;
  const statusKey =
    hostState.host === 'native-shell'
      ? 'web.widgetJourney.status.native'
      : hostState.host === 'windows-pwa' || hostState.host === 'standalone'
        ? 'web.widgetJourney.status.standalone'
        : 'web.widgetJourney.status.browser';
  const introKey =
    hostState.host === 'native-shell'
      ? 'web.widgetJourney.intro.native'
      : hostState.provider !== 'none'
        ? 'web.widgetJourney.intro'
        : 'web.widgetJourney.intro.unsupported';
  const noteKey =
    hostState.host === 'native-shell'
      ? 'web.widgetJourney.note.nativeShell'
      : hostState.provider !== 'none'
        ? 'web.widgetJourney.note.widgetSource'
        : 'web.widgetJourney.note.unsupportedPlatform';

  /**
   * 整段内容 → 共享的类型化行（与 mobile 的「我的」屏同一份骨架）。
   *
   * ⚠️ "装好了没有"那一句每次重渲染都要重算（`standalone` 只影响它），
   *    所以它作为行而不是提前算好的常量。
   */
  const rows: readonly SettingsRowModel[] = [
    // 状态先给出来：用户最想知道的是"我现在算装好了没有"。
    {
      kind: 'note',
      testID: 'widget-journey-status',
      leading: <MonitorCheck aria-hidden="true" size={ICON_SIZE.xs} />,
      text: t(statusKey),
    },
    ...(showInstall
      ? ([
          { kind: 'heading', text: t('web.widgetJourney.howToInstall'), divider: true },
          // ⚠️ `testID` 用词条 key 而不是下标：步骤表是常量，
          //    用下标会在将来插入步骤时让 React 复用错的行。
          // 🔴 序号走共享层的 `index`，不在宿主里拼 —— 原来的 `<ol>` 是浏览器
          //    生成编号，而 mobile 拼的是字符串；那是同一件事的两份实现。
          ...steps.map((key, index) => ({
            kind: 'note' as const,
            testID: key,
            index: index + 1,
            text: t(key),
          })),
        ] as const)
      : []),
    // 原生壳与非 Windows 浏览器不共用 Windows PWA 的能力边界。
    {
      kind: 'note',
      testID: 'widget-journey-capability',
      text: t(noteKey),
      divider: true,
    },
  ];

  return (
    <HeytaUiProvider>
      <SettingsSection
        testID="widget-journey-panel"
        title={t('web.widgetJourney.sectionTitle')}
        note={t(introKey)}
        leading={<LayoutGrid aria-hidden="true" size={ICON_SIZE.md} />}
        rows={rows}
      />
    </HeytaUiProvider>
  );
}
