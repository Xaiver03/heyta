/**
 * 产品截图目标注册表 —— **站点/视图结构的唯一事实源**（截图用）。
 *
 * 移植自 SSOS 的 `scripts/screenshot-targets.mjs`。那边用「显式 path 列表」，
 * 但本仓库的形态不一样，所以这里如实反映两处差异：
 *
 *   1. **`apps/landing` 是路径式的**（`/`、`/pricing` …），可直接 goto；
 *   2. **`apps/web` 的视图是 React state，不是 URL 路由**
 *      （`App.tsx` 里 `useState<ViewKey>('tasks')`）——
 *      所以 web 的目标用 `openVia: 'tab'`，靠**点击导航标签**切换，不能靠改 URL。
 *      这一点如果照抄 SSOS 的 path 写法，会截到同一个视图 8 次还不报错。
 *
 * 🔴 **为什么要有 `readyText` 而不是 `sleep(3000)`**：
 * 固定等待在快机器上浪费、在慢机器上截到半成品。等**某段真实文案出现**
 * 才叫就绪 —— 它同时验证了"页面渲染出来了"和"渲染的是对的页面"。
 * 这里所有 `readyText` 都取自 `packages/i18n/src/locales/zh-CN.ts` 的真实文案，
 * **不是编的**；改文案时这里会失配，正好提醒同步（见 verify-preflight）。
 *
 * ⚠️ 产品尚未完成时，本文件只是**结构**：`pnpm screenshot:list` 能列出目标，
 * 但真正截图要等对应界面稳定（见 README 的"何时开始截图"）。
 */

/** 通用设备预设（网页截图，不考虑 App Store 的尺寸要求）。 */
export const DEVICES = {
  desktop: {
    id: 'desktop',
    label: '桌面 1440×900',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  mobile: {
    id: 'mobile',
    label: '移动 390×844',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  },
};

/**
 * App Store 截图设备预设。
 *
 * 🔴 `output` 是 **Apple 要求的上传尺寸**，`viewport` 是浏览器视口 ——
 * 两者靠 `deviceScaleFactor` 对上（如 iPhone 6.9"：440 × 3 = 1320）。
 * 尺寸不对会在 App Store Connect 上传时被拒，所以校验门禁逐张比对像素尺寸。
 */
// 🔴 `deviceScaleFactor` / `isMobile` / `hasTouch` / `userAgent` 一律放**设备层**，
//    不要塞进 `viewport` —— 那是 Playwright `newContext` 的形状。
//    之前两边放法不一致，验证器从 `viewport.deviceScaleFactor` 读，算出 `NaN×NaN`。
export const APP_STORE_DEVICES = {
  'iphone-6.9': {
    id: 'iphone-6.9',
    label: 'iPhone 6.9 英寸',
    deviceType: 'APP_IPHONE_69',
    output: { width: 1320, height: 2868 },
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  },
  'ipad-13': {
    id: 'ipad-13',
    label: 'iPad 13 英寸',
    deviceType: 'APP_IPAD_PRO_3GEN_129',
    output: { width: 2064, height: 2752 },
    viewport: { width: 1032, height: 1376 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  },
  desktop: {
    id: 'desktop',
    label: 'Mac 12.9 英寸',
    deviceType: 'APP_DESKTOP',
    output: { width: 1440, height: 900 },
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  },
};

/**
 * 站点基址。
 *
 * ⚠️ 一律走环境变量覆盖，**不硬编码生产域名** —— 截图应当打本地或预览环境，
 * 免得截到真实用户数据（更别把它写进仓库）。
 */
export const SITES = {
  landing: {
    id: 'landing',
    label: '官网',
    baseUrl: process.env.HEYTA_LANDING_URL ?? 'http://localhost:4173',
    authRequired: false,
  },
  web: {
    id: 'web',
    label: '应用',
    baseUrl: process.env.HEYTA_WEB_URL ?? 'http://localhost:5173',
    authRequired: false,
  },
};

/**
 * 目标清单。
 *
 * 字段说明：
 *   - `site`       → SITES 里的键
 *   - `path`       → 站点内的路径（`openVia: 'path'` 时使用）
 *   - `view`       → `apps/web` 的 ViewKey（`openVia: 'tab'` 时使用）
 *   - `openVia`    → `'path'`（goto）| `'tab'`（点导航标签）
 *   - `readyText`  → **必须出现**的真实文案，用来判定"渲染好了"
 *   - `dismissTexts` → 出现就点掉的按钮（引导弹窗、公告等遮挡物）
 *   - `device`     → DEVICES 的键
 *   - `fullPage`   → 是否截整页
 *   - `appStore`   → 是否纳入 App Store 截图集
 */
export const TARGETS = [
  // ── 官网（路径式）────────────────────────────────────────────────
  { id: 'L01', name: '官网首屏', site: 'landing', openVia: 'path', path: '/', readyText: 'heyta' },
  { id: 'L02', name: '功能', site: 'landing', openVia: 'path', path: '/features', readyText: '功能' },
  { id: 'L03', name: '平台', site: 'landing', openVia: 'path', path: '/platforms', readyText: '平台' },
  { id: 'L04', name: '定价', site: 'landing', openVia: 'path', path: '/pricing', readyText: '价格' },
  { id: 'L05', name: '帮助', site: 'landing', openVia: 'path', path: '/help', readyText: '帮助' },
  { id: 'L06', name: '更新日志', site: 'landing', openVia: 'path', path: '/changelog', readyText: '更新' },
  { id: 'L07', name: '登录', site: 'landing', openVia: 'path', path: '/signin', readyText: '登录' },

  // ── 应用（标签式；readyText 取自 packages/i18n/src/locales/zh-CN.ts）──
  { id: 'W01', name: '任务', site: 'web', openVia: 'tab', view: 'tasks', readyText: '任务', appStore: true },
  { id: 'W02', name: '四象限', site: 'web', openVia: 'tab', view: 'quadrant', readyText: '四象限', appStore: true },
  { id: 'W03', name: '习惯', site: 'web', openVia: 'tab', view: 'habits', readyText: '习惯', appStore: true },
  { id: 'W04', name: '番茄钟', site: 'web', openVia: 'tab', view: 'focus', readyText: '番茄钟', appStore: true },
  { id: 'W05', name: '时间线', site: 'web', openVia: 'tab', view: 'timeline', readyText: '时间线', appStore: true },
  { id: 'W06', name: '成长', site: 'web', openVia: 'tab', view: 'growth', readyText: '成长', appStore: true },
  { id: 'W07', name: '回收站', site: 'web', openVia: 'tab', view: 'trash', readyText: '回收站' },
  { id: 'W08', name: '设置', site: 'web', openVia: 'tab', view: 'settings', readyText: '设置' },

  // ── 移动端（标签式的移动视口）────────────────────────────────────
  { id: 'MW01', name: '移动端任务', site: 'web', openVia: 'tab', view: 'tasks', device: 'mobile', readyText: '任务', appStore: true },
  { id: 'MW02', name: '移动端四象限', site: 'web', openVia: 'tab', view: 'quadrant', device: 'mobile', readyText: '四象限', appStore: true },
  { id: 'MW03', name: '移动端习惯', site: 'web', openVia: 'tab', view: 'habits', device: 'mobile', readyText: '习惯', appStore: true },
].map((target) => ({
  device: 'desktop',
  fullPage: false,
  authRequired: false,
  dismissTexts: [],
  appStore: false,
  ...target,
}));

/** 截图产物的落盘根目录（相对仓库根）。 */
export const ARTIFACT_ROOT = 'screenshots';

/** 校验门禁用的期望集合。 */
export function expectedGroups() {
  return [
    { label: '官网', folder: 'landing', device: DEVICES.desktop, targets: TARGETS.filter((t) => t.site === 'landing') },
    { label: '应用-桌面', folder: 'web-desktop', device: DEVICES.desktop, targets: TARGETS.filter((t) => t.site === 'web' && t.device === 'desktop') },
    { label: '应用-移动', folder: 'web-mobile', device: DEVICES.mobile, targets: TARGETS.filter((t) => t.site === 'web' && t.device === 'mobile') },
  ];
}

/** 截图文件名：`<id>-<name>.png`（与 SSOS 同款约定）。 */
export function artifactName(target) {
  return `${target.id}-${target.name}.png`;
}

/**
 * 原生壳的**窗口证据**：必须来自已被验证忠实的采集路径。
 *
 * 🔴 这一条是**防回归的核心**，不是锦上添花。
 * 实测过一次很贵的教训：macOS 壳的自截屏用 `cacheDisplay` 把 SwiftUI 文字
 * 渲染成横向色带，而那张图尺寸对、内容比例 96%、色阶 255，
 * **像素级检查全部通过** —— 只有人眼能发现字全是坏的。
 * 所以真正能挡住它的是"**这份证据是怎么来的**"，而不是"它长什么样"。
 */
export const SHELL_EVIDENCE = [
  {
    label: 'macOS 原生壳',
    png: 'apps/desktop-macos/evidence/window-first-run.png',
    note: 'apps/desktop-macos/evidence/window-first-run.txt',
    // 窗口截图**必须**交叉验证：存在"应用自己重绘"这条会把 SwiftUI 渲染坏的歧路
    methods: ['screencapturekit', 'screencapture-window'],
    requiresCrosscheck: true,
  },
  {
    label: 'Linux 原生壳',
    png: 'apps/desktop-linux/evidence/window-first-run.png',
    note: 'apps/desktop-linux/evidence/window-first-run.txt',
    // Xvfb 里 `import -window root` 再裁到窗口。设备/虚拟屏截图是权威来源。
    methods: ['xvfb-import-crop'],
    requiresCrosscheck: false,
  },
  {
    label: 'Windows 原生壳',
    png: 'apps/desktop-windows/evidence/window-first-run.png',
    note: 'apps/desktop-windows/evidence/window-first-run.txt',
    methods: ['winui-schtasks-copyfromscreen'],
    requiresCrosscheck: false,
  },
  {
    // 🔴 这条不是上一条的重复：上面那张是 `dotnet build` 产物（开发路径），
    //    这张是**装进机器之后的 MSIX**（Add-AppxPackage → shell:appsFolder）。
    //    「装上了」不等于「跑得起来」—— 本轮实测就栽在这条上：MSIX 装成功、
    //    进程也拉起来了，但 `dotnet publish` 丢掉了应用自己的 XBF/PRI，
    //    窗口从来没出现。所以打包产物必须单独留一份"能起来"的证据。
    //    采集方式同上：schtasks /it 投进交互式会话 + CopyFromScreen 只截窗口。
    label: 'Windows MSIX 安装包',
    png: 'apps/desktop-windows/evidence/packaged-first-run.png',
    note: 'apps/desktop-windows/evidence/packaged-first-run.txt',
    methods: ['winui-schtasks-copyfromscreen'],
    requiresCrosscheck: false,
  },
  {
    label: '鸿蒙端',
    png: 'apps/mobile/evidence/harmonyos.png',
    note: 'apps/mobile/evidence/harmonyos.txt',
    methods: ['hdc-snapshot-display'],
    requiresCrosscheck: false,
  },
  {
    label: 'iOS release 包',
    png: 'apps/mobile/evidence/ios-release.png',
    note: 'apps/mobile/evidence/ios-release.txt',
    // 设备截图是权威来源，没有"重绘"歧路，所以采集方式登记即可、不需交叉验证
    methods: ['simctl-screenshot'],
    requiresCrosscheck: false,
  },
  {
    label: 'Android release 包',
    png: 'apps/mobile/evidence/android-release.png',
    note: 'apps/mobile/evidence/android-release.txt',
    methods: ['adb-screencap'],
    requiresCrosscheck: false,
  },
];

/**
 * 采集方式里的已知坏值。列出来是为了把失败信息说清楚 ——
 * 这些方式都实测会把 SwiftUI 的 Text 渲染坏。
 */
export const KNOWN_BAD_CAPTURE_METHODS = new Map([
  ['cache-display', 'AppKit draw(_) 路径，拿不到 SwiftUI 的 CGDisplayList ⇒ 文字糊成色带'],
  ['calayer-render', '图层树里没有 CGDisplayList，且是左下原点 ⇒ 既糊又上下翻转'],
  ['image-renderer', '渲染不了 List / TextField / Toggle ⇒ 整片变成禁止占位符'],
]);

/** 采集方式里的已知坏值，单独列出来是为了把失败信息说清楚。 */
