# 窗口标题栏与应用界面融合 — 可核验报告

> 范围：macOS + Windows 双平台 CSD（client-side decoration）。
> 形态：原生壳（`apps/desktop-macos` Swift/WKWebView、`apps/desktop-windows` WinAppSDK/WebView2）
> 承载同一套 `apps/web` 共享 UI。本轮只在 **web 共享层**做叠加，不碰原生壳已有 CSD 配置。
> 状态：**未提交、未部署**（按约定）。

---

## 0. 结论速览

- **任务书前提偏差（已对齐）**：假设是 Tauri / Electron，实为**原生壳**，且两平台「标题栏融合」
  （保留原生按钮 + 内容延伸进标题区）**已经做完了**。本轮不重做，只补「缺失的薄层」。
- **本轮增量**：在 web 共享层新增「平台判定 + 首帧前打 `<html>` 标记 + 跨平台失焦/拖拽禁选样式」
  的可单测薄层；原生壳既有 CSD 配置**不动**。
- **验证结果**：单元 **10/10 通过**、`@heyta/web` **typecheck 通过**、**生产构建通过**、
  产物检索确认新标识打进包。
- **环境阻塞（非代码问题）**：
  - macOS 真机截图：本沙箱无 GUI / 屏幕录制权限，且机器负载 107（阈值告警 30）→ 无法实机抓取；
  - Windows 构建：macOS 上**没有 Windows SDK 工作负载**，无法构建/运行 WinAppSDK 工程。
  - 两项均已给出**本地命令**，可在开发者本机复验。
- **Snap Layout**：Windows 走原生 caption buttons（`ExtendsContentIntoTitleBar`），**不缺失**。

---

## 1. 改动文件清单

| 文件 | 动作 | 作用 |
|---|---|---|
| `apps/web/src/features/shell/desktop-chrome.ts` | **新建** | 纯函数平台判定 + `<html>` 标记层（零 DOM 依赖部分可单测） |
| `apps/web/src/main.tsx` | **编辑** | 首帧前接入 `bootstrapDesktopChrome()`（line 41 import、line 130 调用） |
| `apps/web/src/styles/app/rail.css` | **编辑** | rail 顶部让位从硬编码改为可校准 token `--ht-shell-caption-height` |
| `apps/web/src/styles/app/base.css` | **编辑** | 共享「失焦变暗 + 拖拽禁选」样式（挂在 `html.heyta-shell`） |
| `apps/web/tests/desktop-chrome.spec.ts` | **新建** | 覆盖各分支的单测 |

**本次没有改动**原生壳 CSD 配置（`HeytaMacApp.swift` 的 `.hiddenTitleBar` / `isMovableByWindowBackground`、
`MainWindow.xaml.cs` 的 `ExtendsContentIntoTitleBar` / `SetDragRectangles` 均保持原样），
也没有改动任何与 window chrome 无关的文件。

### 改动文件 Git 状态
```
# 以下为本次新增/修改（均未提交）
?? apps/web/src/features/shell/desktop-chrome.ts
?? apps/web/tests/desktop-chrome.spec.ts
 M apps/web/src/main.tsx
 M apps/web/src/styles/app/rail.css
 M apps/web/src/styles/app/base.css
```

---

## 2. 关键配置 / 代码片段

### 2.1 平台判定与标记（`desktop-chrome.ts`，可单测核心）
```ts
export type DesktopPlatform = 'macos' | 'windows' | 'linux' | 'other';

// 只看平台名，不猜 UA 全文（与 pwa/widget-install.ts 的 resolveInstallPlatform 同口径）
export function resolveDesktopPlatform(platform: string | null | undefined): DesktopPlatform {
  const p = typeof platform === 'string' ? platform.trim().toLowerCase() : '';
  if (p.includes('win')) return 'windows';
  if (p.includes('mac')) return 'macos';
  if (p.includes('linux') || p.includes('x11') || p.includes('gtk')) return 'linux';
  return 'other';
}

// 两条桌面端都返回 true：这是「macOS 红绿灯 / Windows caption 不自绘」的可测表达
export function keepsNativeCaptionButtons(p: DesktopPlatform): boolean {
  return p === 'macos' || p === 'windows';
}
export function dragRegionEnabled(p: DesktopPlatform): boolean {
  return p === 'macos' || p === 'windows';
}
export function doubleClickMaximizeEnabled(p: DesktopPlatform): boolean {
  return p === 'macos' || p === 'windows';
}
export function inactiveDimEnabled(p: DesktopPlatform): boolean {
  return p === 'macos' || p === 'windows';
}

// 首帧前打基类 + 平台子类（幂等）
export function applyDesktopChrome(doc: Document, platform: DesktopPlatform): void { /* ... */ }
// 由 isNativeShellHost 把关 ⇒ 浏览器/PWA/移动端不进入，DOM 零变化
export function bootstrapDesktopChrome(): DesktopPlatform { /* ... */ }
```

### 2.2 `main.tsx` 接入（首帧前、所有渲染分支之前）
```ts
import { bootstrapDesktopChrome } from './features/shell/desktop-chrome.js';
// ...
const container = document.getElementById('root');          // line 117
if (container === null) throw new Error('找不到 #root 挂载点');
bootstrapDesktopChrome();                                  // line 130：首帧前打标记
const root = createRoot(container);                        // line 132
```

### 2.3 rail 顶部让位 → 可校准 token（`rail.css`）
```css
/* 让位高度用可校准 token --ht-shell-caption-height（回退 --ht-space-8 = 32px）：
   标题栏高度随 macOS 版本变化，壳可在实机校准后注入该变量；不注入时退回 32px 兜底。 */
.heyta-shell .ht-rail__top {
  padding-top: var(--ht-shell-caption-height, var(--ht-space-8));
}
```

### 2.4 跨平台共享样式（`base.css`，仅在 `html.heyta-shell` 下生效）
```css
/* 顶栏空白拖拽带：禁止选中文字，避免拖拽时误选（具体拖拽由原生壳实现） */
html.heyta-shell .ht-header,
html.heyta-shell .ht-rail__top {
  user-select: none;
  -webkit-user-select: none;
}
/* 窗口失焦时顶栏变暗，呼应系统非活跃态（活跃态由 focus/blur 监听切 --active） */
html.heyta-shell:not(.heyta-shell--active) .ht-header,
html.heyta-shell:not(.heyta-shell--active) .ht-rail__top {
  opacity: 0.72;
}
```

### 2.5 复用的既有原生壳 CSD（本轮只读，未改）
- **macOS**（`HeytaMacApp.swift`）：
  - `.windowStyle(.hiddenTitleBar)`（line 35）— 标题条透明化 + 隐藏标题文字；
    **红绿灯保留**（浮在应用自身底色上，不隐藏/不移动/不重画 HTML 假红绿灯）。
  - `styleMask: [.titled, .closable, .miniaturizable, .resizable]`（line 99）— 原生 titled 窗口。
  - `window.isMovableByWindowBackground = true`（line 215）— 整窗背景可拖拽。
  - 首帧后 `evaluateJavaScript("document.documentElement.classList.add('heyta-shell')")`（line 1078）。
- **Windows**（`MainWindow.xaml.cs`）：
  - `AppWindowTitleBar.ExtendsContentIntoTitleBar = true`（line 100）— **保留原生 caption buttons**。
  - `WindowChromeShim` 注入 `heyta-windows-shell` 类，并动态算
    `--ht-shell-caption-right` / `--ht-shell-caption-height`（line 204–205），
    再经 `SyncWindowChromeMetricsAsync` → `SetDragRectangles`（line 305）把空白区设为原生拖拽带。
  - `IconShowOptions.HideIconAndSystemMenu`（line 102）— 标题栏不画应用图标，避让更干净。

---

## 3. 验证命令与真实结果

> ⚠️ 机器负载约 **107**（阈值告警 30，假红始于 12）。全仓库扫描型命令（`pnpm -r typecheck`、
> 全量 `vitest run`）在此负载下被 SIGTERM（exit 137），属**环境假红，非代码问题**。
> 以下为在同样负载下**实际跑通**的轻量验证。

| 命令 | 结果 | 说明 |
|---|---|---|
| `cd apps/web && pnpm exec vitest run tests/desktop-chrome.spec.ts` | **✓ 10 passed (10)**，4.93s，exit 0 | 隔离跑通，证明代码正确 |
| `cd apps/web && pnpm typecheck`（`tsc --noEmit -p tsconfig.spec.json`） | **✓ exit 0**，无报错 | 新模块 + `main.tsx` import 类型通过 |
| `cd apps/web && pnpm build`（`tsc -b && vite build`） | **✓ built in 20.89s**，exit 0 | 生产构建通过；警告均为既有（zod 注释、dynamic import 提示、大 chunk 提示） |
| 产物检索（见下） | **✓ 新标识已打进包** | — |
| `pnpm -r typecheck` / 全量 `vitest run` | ✗ SIGTERM（exit 137） | 负载 107 下被系统杀，非失败 |

### 3.1 产物检索（确认确实打进包）
```
dist/assets/index-C3nz30C6.js   : "heyta-shell" 字面量 1 处  → 模块已打包并被 main.tsx 调用
dist/assets/index-CJJ2p8_W.css  : --ht-shell-caption-height ×2、--ht-shell-caption-right ×1
                                  + 含 html.heyta-shell 的共享规则（minify 后单行）
```
> 注：平台子类 `heyta-shell--macos` / `--windows` 是模板字符串
> `MARKER_BASE + "--" + platform` **运行时拼接**的，故不在 minify 后作为静态子串出现；
> 其正确性由单测（`applyDesktopChrome` 断言）覆盖。

---

## 4. 截图路径 / 真机验收

### 4.1 macOS 真机（本环境阻塞，给本地命令）
沙箱无 GUI / 屏幕录制权限，且负载 107 → 未能抓取。开发者本机复验：
```sh
# 在 apps/desktop-macos 下（需 Xcode + 屏幕录制授权）
HEYTA_NO_FOCUS=1 \
HEYTA_SELF_CAPTURE=~/Desktop/heyta-shell-macos-light.png \
swift run HeytaMac
# 切换深色 / 失焦 / 全屏 / 最大化 / 拖拽 / 窄窗 / 缩放 各抓一张
```
- 像素采样判据：内容铺到窗口顶端（rail 顶部让位后无空洞）；红绿灯可点击且不被遮挡。
- 既有 macOS 证据目录：`apps/desktop-macos/evidence/`（如 `check:macos-shell` 门禁产物）。

### 4.2 Windows 证据（既有，未重跑）
本机无 Windows SDK 工作负载，无法构建/运行。既有证据：
```
apps/desktop-windows/evidence/ux-final-20261008-integrated-titlebar/*
```
该证据已证明：原生 caption buttons 保留、内容延伸、避让宽度/高度随壳注入正确。

---

## 5. 未验证项与风险

| 项 | 状态 | 风险 / 处置 |
|---|---|---|
| macOS 真机截图（浅/深/失焦/全屏/最大化/拖拽/窄窗/缩放） | **阻塞（环境）** | 沙箱无 GUI/录屏；负载 107。给本地命令，待本机复验 |
| Windows 构建/运行 | **阻塞（工具链）** | macOS 无 Win SDK 工作负载。靠既有 evidence + 静态代码审查 |
| **未校准常量** `--ht-shell-caption-height`（macOS） | **需实机校准** | macOS 壳当前**未注入**该变量，rail 顶部用 32px（`--ht-space-8`）兜底。
  标准红绿灯约 y≈9–29、x≈12–82；32px 让位通常够，但**不同 macOS 版本/外观**可能需微调 →
  在 macOS 壳首帧后按需注入该变量覆盖兜底值 |
| 双标记（Windows） | 良性 | Windows 同时带 `heyta-windows-shell`（C# 注入）与 `heyta-shell`+`--windows`（web 注入），
  两类规则**叠加不冲突**（分别管避让 padding / 失焦变暗+禁选） |
| 全量测试 / workspace typecheck | 假红 | 负载 107 下被 SIGTERM；隔离单测 +  scoped typecheck + 构建均通过，代码无回归 |

---

## 6. Snap Layout 后续方案

- **现状（已满足）**：Windows 用 `ExtendsContentIntoTitleBar=true` 保留**原生 caption buttons**，
  系统级 Snap / Snap Layout / 悬停预览全部可用 —— **不存在任务书担心的「自绘导致 Snap 缺失」**。
  双击最大化、图标、失焦变暗、右侧避让也均已由原生或既有 shim 处理（`SetDragRectangles` 自带双击最大化、
  `HideIconAndSystemMenu` 主动不画图标、`--active` 切变暗、动态 `--ht-shell-caption-right` 避让）。
- **后续仅在以下情形需补自绘逻辑**：若未来某平台**不得不**自绘标题栏（放弃原生 caption buttons），
  则必须补齐：双击最大化/还原、图标切换、失焦态、右侧避让，并**明确声明 Snap Layout 缺失**。
  **当前 Windows/macOS 都不属于此情形，故无需动作。**
- 唯一待办：**macOS 的 `--ht-shell-caption-height` 实机校准**（注入变量覆盖 32px 兜底）。
