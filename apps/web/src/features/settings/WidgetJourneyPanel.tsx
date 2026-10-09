import { ICON_SIZE } from '@heyta/design-system';
/** The installed shell's actual widget bridge determines native instructions.
 * Browser/PWA installation remains a separate path; capability never means
 * the user has already added a widget in the operating system gallery. */

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
  nativeWidgetSteps,
  isNativeShellHost,
  isRunningStandalone,
  resolveWidgetJourneyHost,
  SHELL_MESSAGE_HANDLER_NAMES,
} from '../../pwa/widget-install.js';
import { nativeWidgetBridge } from '../../lib/native-widgets.js';

/** 取当前平台名。⚠️ `userAgentData` 在部分浏览器没有，回落到 `platform`。 */
function currentPlatformName(): string {
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  return uaData?.platform ?? navigator.platform ?? '';
}

/**
 * 读壳注入到页面里的身份信号。
 *
 * 不读 `resolveStorageBackend()`：那是存储层的分流结果，而存储宿主有一条
 * `HEYTA_SHELL_STORAGE=0` 逃生门 —— 门一关，原生窗口就会被当成浏览器。
 */
function shellHostSignals() {
  const w = window as Window & {
    chrome?: { webview?: unknown };
    webkit?: { messageHandlers?: Record<string, unknown> };
    __heytaHostStoragePort?: unknown;
  };
  return {
    storagePort: w.__heytaHostStoragePort !== undefined,
    webview2Host: w.chrome?.webview !== undefined,
    shellMessageHandlers: SHELL_MESSAGE_HANDLER_NAMES.filter(
      (name) => w.webkit?.messageHandlers?.[name] !== undefined,
    ),
  };
}

export function WidgetJourneyPanel(): React.JSX.Element {
  const { t } = useI18n();
  const [standalone, setStandalone] = useState(false);
  // 原生壳通过真实端口注入能力；不要用 UA 把原生窗口当成浏览器标签页。
  const nativeShell = isNativeShellHost(shellHostSignals());

  useEffect(() => {
    // ⚠️ 放进 effect 而不是渲染期：`matchMedia` 在 SSR / 无 DOM 环境下不存在，
    //    渲染期调用会在导入时就炸（而 `isRunningStandalone` 内部已兜住抛异常）。
    setStandalone(isRunningStandalone((q) => window.matchMedia(q).matches));
  }, []);

  const hostState = resolveWidgetJourneyHost(currentPlatformName(), standalone, nativeShell, nativeWidgetBridge() !== undefined);
  const nativeAvailable = hostState.provider === 'native';
  const steps = nativeAvailable ? nativeWidgetSteps(hostState.platform) : installSteps(hostState.platform);
  // Installation and native widget capability are independent facts.
  const showInstall = hostState.showInstallGuide;
  const statusKey =
    hostState.host === 'native-shell'
      ? 'web.widgetJourney.status.native'
      : hostState.host === 'windows-pwa' || hostState.host === 'standalone'
        ? 'web.widgetJourney.status.standalone'
        : 'web.widgetJourney.status.browser';
  const introKey =
    nativeAvailable
      ? 'web.widgetJourney.intro.nativeAvailable'
      : hostState.host === 'native-shell'
      ? 'web.widgetJourney.intro.native'
      : hostState.provider !== 'none'
        ? 'web.widgetJourney.intro'
        : 'web.widgetJourney.intro.unsupported';
  const noteKey =
    nativeAvailable
      ? 'web.widgetJourney.note.nativeAvailable'
      : hostState.host === 'native-shell'
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
    ...(showInstall || nativeAvailable
      ? ([
          { kind: 'heading', text: t(nativeAvailable ? 'mobile.widgetJourney.howTo' : 'web.widgetJourney.howToInstall'), divider: true },
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
