# screenshots/ —— 截图产物（**不是产品现状**）

> ⚠️ **本目录里没有一张图能代表"今天的界面"**，除非它的拍摄日就是今天。
> 它们是一次次 `pnpm screenshot:capture` 跑出来的**历史产物**，跨越了至少三代 shell。
>
> 想说明"产品现在长什么样" ⇒ 用 `docs/operations/software-copyright/evidence/screenshots/`
> （2026-11-08 拍，1920×1080，每张带断言），或**重新拍**（见下）。

---

## 怎么重新拍

```bash
pnpm screenshot:list                          # 列出全部目标（不启动浏览器）
pnpm screenshot:capture                       # 拍 web + landing（应用要在 localhost 跑起来）
pnpm screenshot:capture -- --only W01,W02     # 多个 id 用逗号（单值写法照旧）
pnpm screenshot:app-store                     # 拍 App Store 三尺寸
pnpm screenshot:verify                        # 校验产物尺寸与空白
```

- 目标注册表：`scripts/screenshots/targets.mjs`（**唯一事实源**）
- 拍摄实现：`scripts/screenshots/capture.mjs`
- 就绪判据是 `readyText`（真实词条），不是 `sleep` —— 所以**改文案会让重拍失败**，那是设计如此。

### 🔴 浏览器从哪来

默认用 Playwright 自带的 chromium。**受限环境**（文件沙箱 / CI 只给 workspace 写权限）下
`npx playwright install` 会在 `mkdir ~/Library/Caches/ms-playwright` 这一步 EPERM，此时：

```bash
HEYTA_SHOT_CHANNEL=chrome pnpm screenshot:capture
```

用**本机已装的 Chrome**（同一引擎，尺寸与 `deviceScaleFactor` 由 context 决定，产物口径不变）。
判据是 `--only W01` 能出图且 `screenshot:verify` 照样判尺寸。

---

## 🔴 每张图对应哪一代 shell（引用前必读）

三代分界线（都记在 `apps/web/src/features/shell/view-tabs.ts` 与 `App.tsx` 的注释里）：

| 代 | 分界 | 形状 |
|---|---|---|
| **A** | 2026-09-29 之前 | **顶部横向 tab + 宽侧栏**（左侧是带文字的完整导航） |
| **B** | 2026-09-29 起 | tab 挪进侧栏；rail 上段 = 4 项 + 「更多」 |
| **C** | 2026-11-02 起 | 页头五组控件收进一枚 `⋯`；任务行动作收进详情面 |

### 现量（2026-11-14 重拍）

| 文件 | 拍摄日 | 代 | 能引用吗 |
|---|---|---|---|
| `web-desktop/W01-任务.png` | **2026-11-14** | C | ✅ |
| `web-desktop/W02-四象限.png` | **2026-11-14** | C | ✅ |
| `web-desktop/W03-习惯.png` | **2026-11-14** | C | ✅（原 09-28 那张 A 代图已被覆盖） |
| `web-desktop/W04-番茄钟.png` | **2026-11-14** | C | ✅ |
| `web-desktop/W05-时间线.png` | **2026-11-14** | C | ✅ |
| `web-desktop/W06-成长.png` | **2026-11-14** | C | ✅ |
| `web-desktop/W08-设置.png` | **2026-11-14** | C | ✅ |
| `web-mobile/MW01-移动端任务.png` | **2026-11-14** | C | ✅（原 09-28 那张 A 代图已被覆盖） |
| `web-mobile/MW02-移动端四象限.png` | **2026-11-14** | C | ✅ |
| `web-mobile/MW03-移动端习惯.png` | **2026-11-14** | C | ✅（原 09-28 那张 A 代图已被覆盖） |
| `web-desktop/W07-回收站.png` | 2026-10-06 | B | ❌ 见下「唯一的阻塞」 |
| `web-desktop/*-en-*.png` | 2026-10-01 / 10-10 | B | ❌ 未重拍（同一套 `readyText`，改 `locale` 即可） |
| `app-store/**` | 2026-10-06 | B | 🔴 **iOS 提审前必须重拍**（现在流水线已能拍 web，差 app-store 那一档） |
| `landing/L0*.png` | 2026-10-05 | — | ⚠️ 官网自有版本节奏，与 shell 无关 |

### 唯一的阻塞：W07（回收站）

夹具走产品自己的「从备份还原」通道（`seed-trash-fixture.json`），seed 那一段已经通了，
卡在**导航**：回收站 2026-11-04 从 rail 搬到了**侧栏底部**（`SIDEBAR_TOOL_TABS`，
渲染成 `NavButton`），既不是 `role="tab"` 也不在「更多」菜单里，
`openViewControl` 的两条路都够不到它。

修法（下一轮直接照这个做）：在 `openViewControl` 的"直接控件"那一支之前，
先试 `page.locator('.ht-sidebar').getByRole('button', { name: '回收站' })`；
`selectedControl` 的回读要认 `aria-current="page"`（`NavButton` 用的是这个，不是 `aria-selected`）。

### 已修掉的三个阻塞（2026-11-14）

| 原阻塞 | 根因 | 修法 |
|---|---|---|
| W04 / W06 空白 | `enableTargetModules()` 点开头像**之前没关首启遮罩**，`force:true` 点到的是遮罩 | 开头先 `dismissOverlays`；勾完模块**切回任务视图**（设置是 view，留着它会截到设置面） |
| W04 / W06 模块开关点不动 | `feature-modules-*` 是**视觉隐藏**的 `<input role="switch">`，`check({force:true})` 仍报 "not visible" | 用元素自身 `click()`（走产品 onChange，不注入状态）+ **回读 `isChecked()`**，读不到就抛 |
| MW01–MW03 全部失败 | ① 窄屏 tab 用 `aria-current="page"`，脚本只读 `aria-selected`；② 窄屏抽屉里的目的地是普通 `<button data-testid="rail-view-*">`，不是 `role="menuitem"` | 两处都改成"两种形状都认" |

⚠️ **顺带记一条已被证伪的旧观察**：脚本注释里曾写"390px 下标签栏溢出屏幕外，是真实的
移动端布局缺陷"。2026-11-14 用 `node scripts/screenshots/probe-mobile-rail.mjs` 复量：
`total=19 · overflowRight=0 · overflowLeft=0` —— 窄屏改抽屉后**不成立**，别再照它改布局。

---

## `manifest.json` 是什么

它是**最后一次** `screenshot:capture` 的运行记录（`capturedAt` + 那一次的产物），
**不是本目录的清单**。

- 现量：`targets: 10` —— 最后一次跑的是 `--only W01,…,MW03` 那 10 张。
- 所以"manifest 里没有某张图" ≠ "那张图不存在"；反过来"manifest 说某天"也
  ≠ "目录里每张都是那天拍的"（`W07` 就不在里面，它是 10-06 的旧图）。

要看全目录的时效，读上面那张表，不要读 manifest。

---

## 与软著材料的关系（别混用）

`docs/operations/software-copyright/evidence/screenshots/` 是**另一套**：
按"一个人怎么用它"的 10 段旅程编排、1920×1080、每张拍完立刻断言关键词。
那套是**备案材料**，有它自己的判据（`shoot.mjs` 的 `must` 数组）。
本目录是**产品/官网/商店**用的，判据是 `readyText`。两套不要互相替代。
