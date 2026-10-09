/**
 * Web/PWA 的「把 heyta 装成应用、再放到小组件面板」引导 —— **纯逻辑，零 DOM 依赖**。
 * ==================================================================================
 *
 * ## 这一段为什么和手机端**不是同一段**
 *
 * `apps/mobile` 那段讲的是"长按桌面 → 选小部件 → 拖上去"。**在 Windows 上这三步全都不存在。**
 * Windows 的小组件面板里的卡片**来自已安装的 PWA**（Edge 从 manifest 的 `widgets` 注册它），
 * 所以用户真正要做的是**先把 heyta 装成应用**，卡片才会出现在面板里。
 *
 * ⚠️ **不要把手机端那套文案搬过来** —— 那会给 Windows 用户一条走不通的路径，
 * 而这正是"平台判定必须是真实分支而不是兜底"那条纪律的具体一次发作。
 *
 * ## 🔴 一个必须对用户诚实的平台事实
 *
 * Windows 的小组件面板**只接受两种来源**：已安装的 PWA，或 MSIX 打包的应用。
 * 一个没安装的网页**不可能**出现在面板里。所以引导的第一步必须是"装成应用"，
 * 而不是"去面板里找 heyta" —— 后者会让用户在一个空列表里找一个不存在的东西。
 */

/** 引导要分平台。`other` 是**真实分支**，不是兜底 —— 理由见文件头。 */
export type InstallPlatform = 'windows' | 'macos' | 'other';

/**
 * 小组件旅程所在的宿主状态。
 *
 * `nativeShell` 只说明当前页面被原生壳托管；它不等于原生壳已经提供了
 * Windows WidgetKit / Widget Provider。把“应用已安装”和“系统小组件可用”
 * 分成两个字段，避免设置页把原生窗口误报成已有桌面小组件。
 */
export type WidgetHostKind = 'native-shell' | 'windows-pwa' | 'standalone' | 'browser';

/**
 * `windows-pwa-candidate` 只表示当前平台有一条可能的 PWA 入口；它不证明
 * manifest 已注册、Edge 已安装或 Widget Board 已经能读到卡片。
 */
export type WidgetProviderKind = 'native' | 'windows-pwa' | 'windows-pwa-candidate' | 'none';

export interface WidgetJourneyHostState {
  readonly platform: InstallPlatform;
  readonly host: WidgetHostKind;
  readonly provider: WidgetProviderKind;
  readonly standalone: boolean;
  readonly showInstallGuide: boolean;
}

/** 三个分支各自的词条 key。先后顺序就是用户该做的顺序。 */
export type InstallStepKey =
  | 'web.widgetJourney.windows.step1'
  | 'web.widgetJourney.windows.step2'
  | 'web.widgetJourney.windows.step3'
  | 'web.widgetJourney.macos.step1'
  | 'web.widgetJourney.macos.step2'
  | 'web.widgetJourney.other.step1'
  | 'web.widgetJourney.other.step2';

/**
 * `navigator.userAgentData.platform` / `navigator.platform` → 我们的三分支。
 *
 * ⚠️ 大小写与空白容错：这个值来自运行时而非常量。
 * ⚠️ **不要用 `userAgent` 里的 "Windows" 字样之外的东西判断** ——
 *    UA 字符串被大量伪装，但"我是不是在 Windows 上"这件事对引导文案够用了：
 *    判错的最坏后果是给了一条不精确的步骤，而不是一个会崩的操作。
 */
export function resolveInstallPlatform(platform: string | null | undefined): InstallPlatform {
  const p = typeof platform === 'string' ? platform.trim().toLowerCase() : '';
  if (p.includes('win')) return 'windows';
  if (p.includes('mac')) return 'macos';
  return 'other';
}

/** 壳注册给页面的 `WKScriptMessageHandler` 名字；新增一个要同时在这里登记。 */
export const SHELL_MESSAGE_HANDLER_NAMES = ['heytaStorage', 'heytaWidget'] as const;

/** 页侧能观察到的宿主信号，全部来自壳**实际注入的东西**，不做 UA 猜测。 */
export interface ShellHostSignals {
  readonly storagePort: boolean;
  readonly webview2Host: boolean;
  readonly shellMessageHandlers: readonly string[];
}

/**
 * 这一页是不是跑在**我们的原生壳**里。
 *
 * 🔴 不能只认 `__heytaHostStoragePort`：那是**存储宿主**的信号，而它带着一条排查用的
 * 逃生门（`HEYTA_SHELL_STORAGE=0`，macOS 与 Windows 同语义）。门一关，同一个原生窗口
 * 就被识别成浏览器，于是已经在 MSIX 应用里的用户看到的是"先把 heyta 装成应用"那三步 ——
 * 这正是本计划 §8.2「Widget 环境识别」记着的那条残留。
 *
 * 三条信号各自只可能来自我们的壳：
 * · `chrome.webview` 只存在于 WebView2（Chrome/Edge 浏览器里没有这个名字）；
 * · `webkit.messageHandlers` 里那两个名字由 macOS/Linux 壳注册 ——
 *   `heytaStorage`（`ShellStorageHost.swift` / `heyta_web.c` 的 `HANDLER_NAME`）与
 *   `heytaWidget`（`ShellWidgetBridge.swift`）。Safari 自己不会注册它们。
 */
export function isNativeShellHost(signals: ShellHostSignals): boolean {
  if (signals.storagePort) return true;
  if (signals.webview2Host) return true;
  return SHELL_MESSAGE_HANDLER_NAMES.some((name) => signals.shellMessageHandlers.includes(name));
}

/**
 * 解析设置页应该告诉用户的真实宿主能力。
 *
 * 原生壳必须实际注入 Widget IO 桥才提供原生添加引导。安装状态本身不证明
 * 小组件支持；桥存在也不代表用户已经在系统中添加了小组件。
 */
export function resolveWidgetJourneyHost(
  platformName: string | null | undefined,
  standalone: boolean,
  nativeShell: boolean,
  nativeWidgetsAvailable = false,
): WidgetJourneyHostState {
  const platform = resolveInstallPlatform(platformName);

  if (nativeShell) {
    return {
      platform,
      host: 'native-shell',
      provider: nativeWidgetsAvailable ? 'native' : 'none',
      standalone: true,
      showInstallGuide: false,
    };
  }

  if (standalone && platform === 'windows') {
    return {
      platform,
      host: 'windows-pwa',
      provider: 'windows-pwa',
      standalone: true,
      showInstallGuide: false,
    };
  }

  if (standalone) {
    return {
      platform,
      host: 'standalone',
      provider: 'none',
      standalone: true,
      showInstallGuide: false,
    };
  }

  return {
    platform,
    host: 'browser',
    provider: platform === 'windows' ? 'windows-pwa-candidate' : 'none',
    standalone: false,
    showInstallGuide: platform === 'windows',
  };
}

/**
 * 某个平台上「装成应用」的步骤。
 *
 * ⚠️ Windows 那三步里**第 3 步是"卡片才会出现在小组件面板里"** —— 它不是操作，
 * 但它必须说出来：用户装完应用后会去找卡片，不告诉他"面板里现在应该有 heyta 了"，
 * 他就不知道这一步到底成没成功。
 */
export function installSteps(platform: InstallPlatform): readonly InstallStepKey[] {
  switch (platform) {
    case 'windows':
      return [
        'web.widgetJourney.windows.step1',
        'web.widgetJourney.windows.step2',
        'web.widgetJourney.windows.step3',
      ];
    case 'macos':
      return ['web.widgetJourney.macos.step1', 'web.widgetJourney.macos.step2'];
    default:
      // ⚠️ 刻意只给两步通用说明，**不套用 Windows 的三步** —— 见文件头。
      return ['web.widgetJourney.other.step1', 'web.widgetJourney.other.step2'];
  }
}

/**
 * 现在是不是**已经装成应用**在跑。
 *
 * 判据是 `display-mode: standalone`（PWA 被安装后启动时会匹配）。
 * ⚠️ 不用"有没有安装过"那种需要 `getInstalledRelatedApps()` 的判据：
 * 那个 API 在桌面 Edge 上支持情况不稳，而"我现在是不是应用窗口"是**当场可测**的。
 * **宁可只答一个窄问题，也不要答一个会撒谎的宽问题。**
 */
export function isRunningStandalone(matches: (query: string) => boolean): boolean {
  try {
    return matches('(display-mode: standalone)') || matches('(display-mode: window-controls-overlay)');
  } catch {
    return false;
  }
}

/**
 * 这一整段引导该不该画。
 *
 * 🔴 **已经装成应用在跑时，第一段（怎么装）就没有意义了** —— 用户已经在里面了。
 * 但**整段不该消失**：小组件那一段（怎么加到面板、推送开关）仍然有用。
 * 所以这里返回的是"要不要画**安装**那一段"，而不是"要不要画整个面板"。
 */
export function shouldShowInstallGuide(standalone: boolean): boolean {
  return !standalone;
}

/** OS-specific entry, shown only when the installed shell provides native widget IO. */
export function nativeWidgetSteps(platform: InstallPlatform): readonly ('web.widgetJourney.native.macos.step1' | 'web.widgetJourney.native.windows.step1' | 'web.widgetJourney.native.choose')[] {
  if (platform === 'macos') return ['web.widgetJourney.native.macos.step1', 'web.widgetJourney.native.choose'];
  if (platform === 'windows') return ['web.widgetJourney.native.windows.step1', 'web.widgetJourney.native.choose'];
  return [];
}
