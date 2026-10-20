# Goal：设置的信息架构 —— **移动端优先**，电脑端验证收尾

> 状态：✅ **完成（2026-09-29）** —— ①②③ 判据全绿，证据如下；
> 权威任务条目：[`multi-end-unified-strategy.md`](multi-end-unified-strategy.md) **§7.1e**（本文件是它的执行 goal；证据不在这里重复）
> 规律证据：[`../research/dida-capture/INTERFACE-NOTES.md`](../research/dida-capture/INTERFACE-NOTES.md) **§11.5**
> 🔴 **排序由产品负责人 2026-09-29 拍板：主战场是移动端 + 电脑端，web 不是。**
> 上一轮把 IA 做成"web 先行"——顺序错了，本 goal 改正。
>
> ## 完成事实（逐条判据）
>
> | 步 | 判据 | 结果 |
> |---|---|---|
> | ① M1 | 「我的」首屏有设置入口 | ✅ `profile-entry-settings` 排入口行第一（`check:mobile-settings` R2） |
> | ① M2 | 设置面独立 surface、下层不卸载 | ✅ `SettingsScreen` = RN Modal（R1）；Profile 常驻持有表单状态 |
> | ① M3 | 注入验证可红 | ✅ 两种注入（表单塞回 Profile / Modal 拆成 View）→ 门禁红，还原→绿 |
> | ① M4 | 词条中英同步 | ✅ i18n 配平 10/10、`check:ui-language` ✅ |
> | ② D1 | 壳内设置浮层截图 + 人看 | ✅ `apps/desktop-macos/evidence/settings-sheet-in-shell.png`（rail 在、下层透出） |
> | ② D2 | 壳级门禁 | ✅ `check:macos-window`（含 M2 前置断言） |
> | ③ W1 | 未提交浮层过 typecheck/test/e2e | ✅ 965 web 测试 + 浏览器 e2e 29 过 |
> | ③ W2 | 可注入结构判据 | ✅ `settings-sheet-ia.spec.tsx`（contentView→view 注入已验红→绿） |
>
> ## 运行时判据的如实边界
>
> M2 的"下层未卸载"在**移动端真机**上未跑（iOS 夹具被系统弹窗/滚动问题阻塞，
> 见主计划 §5.1n）—— 移动端判据由**结构门禁**（`check:mobile-settings`）与
> RN Modal 的组件语义承担，真机验证留给 iOS 夹具修复那轮。
>
> ## 验证中连带修掉的问题（都由"人真的看图"发现）
>
> 1. **进度卡与采集条贴死**（产品负责人截图指出）：`.ht-content` 无 gap、
>    两头都没声明间距 → `.ht-progress-banner` 用 `--ht-space-4` 站位
>    + e2e `progress-spacing.spec.ts` 截图钉住。
> 2. **macOS 壳默认窗口太大**：1280×820 → **1120×720**（默认值不是审计画布）。
> 3. **注册/登录入口搬家**：顶栏大主按钮 → rail 顶部账号区（未登录才出现的
>    紧凑入口，`sync-signin-entry` testID 保留）；面板开合提升为 store 的
>    `signInOpen`；J1 规格夹具随行为搬家。
> 4. **壳级验证工具链三处**：自截屏 scale 取值（离屏窗口恒 1x）；
>    交叉验证的**陈旧证据**（旧图没删）与 1x/2x 判等；启动抢前台
>    （`HEYTA_NO_FOCUS=1`）。**验证载体默认顺序**改为：外接浏览器（Playwright）
>    优先，原生壳截图必要时才做 —— 已立为 `AGENTS.md §6.2` 规定二的明文。

---

## 0. 为什么 apps/web 的改动仍然算**电脑端**的（架构事实，先说清）

当前 M2 路线下，macOS 壳删掉了手写原生 UI，画面就是 apps/web 的共享 UI：

```
apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift:270
  webView.load(URLRequest(url: URL(string: "heyta-local://app/index.html")!))
```

⇒ **改 apps/web 的设置 IA = 改电脑端的设置 IA。**
工作区里已有一份**未提交**的 web 浮层实现（`apps/web/src/App.tsx` 的
`settingsBaseView` / `contentView` / `.ht-sheet`，注释引 §11.5；`role="dialog"`
+ `aria-modal="false"` + `data-testid="settings-sheet"`）—— 它服务的正是电脑端。
本 goal 对它**只做验证收尾，不再加新东西**。

⚠️ 这**不**构成"继续投入 web"的理由：web 侧剩下的只有"证明它没坏"，新功能一律在移动端。

---

## 1. 要做什么（按优先级）

### ① 移动端（**主攻**）

**现状**（§7.1e 实测 + 本轮盘点）：**没有独立设置屏**。
`apps/mobile/src/screens/ProfileScreen.tsx`（899 行）把账号 / 同步凭据表单 /
同步状态 / 偏好 / 关于全部内联在自己的滚动流里 ——「我的」既是身份页又是设置页，
与 §11.5 的规律（次级表面独立成面）相反。

**要做**：设置收进**独立表面**（本仓已有 sheet 先例：`TaskDetailSheet` /
`ConflictSheet` 走 RN 原生 modal），「我的」回归「身份 + 同步状态 + 设置入口」。

**判据（结构性、可注入故障）**：

| # | 判据 |
|---|---|
| M1 | 「我的」**首屏**有「设置」入口（≤1 次点击到达设置面） |
| M2 | 设置面是**独立 surface**（RN Modal），不随「我的」滚动 —— 打开设置后「我的」的身份区**仍在组件树里**（下层未卸载） |
| M3 | **注入验证**：把设置行塞回「我的」主滚动流 ⇒ 判据红 |
| M4 | 新词条中英同步（`packages/i18n`），`check:ui-language` 绿 |

### ② 电脑端（**验证已完成的浮层**，不新做）

| # | 判据 |
|---|---|
| D1 | 在 macOS 壳里实测：打开设置后 **rail 与下层视图仍可见**（截图入库 `evidence/`，人真的看） |
| D2 | `check:macos-window` 与既有门禁全绿 |

### ③ web（**只收尾** —— 桌面端吃它的产物，坏了直接坏电脑端）

| # | 判据 |
|---|---|
| W1 | 未提交改动过 `pnpm -r typecheck && pnpm -r test` + 浏览器 e2e（照 §6.2 规定一：**截图 + 人看**） |
| W2 | §7.1e 的结构判据落成**可注入故障**的测试：打开设置后 rail（`role="tablist"`）与下层视图标记**仍在 DOM**；把它改回"替换内容区"必须红 |

---

## 2. 非目标

- **不动设置内容本身**（分组与行仍是共享 `SettingsSection` / 各 Panel，只动"装在哪儿"）。
- **不做 Dida 移动端设置的采集**（没有证据；移动端形态按本仓已有 sheet 先例与 RN
  惯例定，理由写进实现注释 —— 不假装它有对标截图）。
- **不动 iOS 夹具**（handoff §5.1n 那条是独立的线，别混进本 goal）。
- 桌面 Windows / Linux 壳：本轮不验（它们的壳级门禁各自独立；macOS 先立形态）。

---

## 3. 交付定义（本轮做完 = ）

①②③ 三张判据表全绿；本文件状态行改成**事实**；
主计划 §7.1e 状态从「未开工」改为「移动端 ✅ / 电脑端 ✅（指到本 goal）」。
