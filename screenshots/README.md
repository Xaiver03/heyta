# screenshots/ —— 截图产物

> ⚠️ **本目录里没有一张图能代表"今天的界面"**，除非它的拍摄日就是今天。
> 它们是一次次 `pnpm screenshot:capture` 跑出来的产物，跨过三代 shell。
>
> 想说明"产品现在长什么样" ⇒ 用 `docs/operations/software-copyright/evidence/screenshots/`
> （2026-11-08 拍，1920×1080，每张带断言），或**重新拍**（见下）。

---

## 怎么重新拍

```bash
pnpm screenshot:list                          # 列出全部目标（不启动浏览器）
pnpm screenshot:capture -- --only W01,W02     # 多个 id 用逗号
pnpm screenshot:app-store                     # 拍 App Store 三尺寸（27 张）
pnpm screenshot:verify                        # 校验产物尺寸与空白
```

### 🔴 用**静态 preview**，不要用 dev server

```bash
cd apps/web && pnpm build && npx vite preview --port 5174 &
HEYTA_WEB_URL=http://localhost:5174/ HEYTA_SHOT_CHANNEL=chrome pnpm screenshot:capture
```

两条都是 2026-11-14 实测出来的，不是风格偏好：

| 问题 | 现象 | 做法 |
|---|---|---|
| **dev server 撑不住长任务** | `npx vite --port 5173` 跑到第 8–9 张时进程消失，之后全部 `ERR_CONNECTION_REFUSED`；`--app-store` 27 张必然中途挂 | 改用 `vite preview` 对**已构建产物**（静态文件，无 HMR/编译） |
| **后台进程会被回收** | `nohup ... &` 起在**上一次** bash 调用里，下一次调用时它已经没了 | **起 server 与跑截图放在同一次调用里**，跑完再 kill |

### 🔴 浏览器从哪来

默认用 Playwright 自带 chromium。受限环境（文件沙箱 / CI 只给 workspace 写权限）下
`npx playwright install` 会在 `mkdir ~/Library/Caches/ms-playwright` 那步 EPERM，此时：

```bash
HEYTA_SHOT_CHANNEL=chrome ...
```

用本机已装的 Chrome（同引擎，尺寸与 `deviceScaleFactor` 由 context 决定，产物口径不变）。

---

## 🔴 每张图对应哪一代 shell

| 代 | 分界 | 形状 |
|---|---|---|
| **A** | 2026-09-29 之前 | **顶部横向 tab + 宽侧栏** |
| **B** | 2026-09-29 起 | tab 挪进侧栏；rail 上段 = 4 项 + 「更多」 |
| **C** | 2026-11-02 起 | 页头五组控件收进一枚 `⋯`；任务行动作收进详情面 |

### 现量（2026-11-14 全量重拍，代 C）

| 组 | 张数 | 状态 |
|---|---|---|
| `web-desktop/W01…W08` | 8 | ✅ 2026-11-14 |
| `web-mobile/MW01…MW03` | 3 | ✅ 2026-11-14 |
| `web-desktop/*-en-*` | 4 | ✅ 2026-11-14（W07-en 未拍：它走 seed 通道，本轮没跑） |
| `app-store/{iphone-6.9,ipad-13,desktop}/**` | 27 | ✅ 2026-11-14（**iOS 提审前请再确认一次**，见下） |
| `landing/L0*.png` | 7 | ⚠️ 2026-10-05，官网自有版本节奏，与 shell 无关 |

### 三件在这一轮修掉的事（都能复现）

| 原阻塞 | 根因 | 修法 |
|---|---|---|
| W04 / W06 空白 | `enableTargetModules()` 点开头像**之前没关首启遮罩**，`force:true` 点到的是遮罩 | 开头先 `dismissOverlays`；勾完模块**切回任务视图**（设置是 view，留着它会截到设置面） |
| 模块开关点不动 | `feature-modules-*` 是**视觉隐藏**的 `<input role="switch">`，`check({force:true})` 仍报 not visible | 用元素自身 `click()`（走产品 onChange）+ **回读 `isChecked()`**，读不到就抛 |
| W07 回收站失败 | 它住在**侧栏底部**（`NavButton`），而**侧栏只在任务视图渲染** —— 点下去视图真的切了，侧栏连同按钮一起被卸载，控件回读永远拿不到 | 回读改成"每轮重新查 + 控件没了就用**页面标题**（`.ht-header__title`）对账" |
| MW01–MW03 全挂 | 窄屏 tab 用 `aria-current="page"`（脚本只读 `aria-selected`）；抽屉里是 `<button data-testid="rail-view-*">`（不是 `menuitem`） | 两处都改成"两种形状都认" |

### 首启引导会被跳过

2026-11-14 加了首启引导（收集箱空态里的三条示例）。`dismissOverlays` 之后会点掉
`first-run-dismiss` —— 因为 W01 的 `readyText` 是「任务」，那张图要展示**任务视图本身**，
不是"新用户第一眼"。走的是真实按钮，不注入 localStorage。

### ⚠️ 已被证伪的旧观察（别再照它改布局）

脚本注释里曾写"390px 下标签栏溢出屏幕外，是真实的移动端布局缺陷"。
2026-11-14 用 `node scripts/screenshots/probe-mobile-rail.mjs` 复量：
`total=19 · overflowRight=0 · overflowLeft=0` —— 窄屏改抽屉后**不成立**。

---

## `manifest.json` 是什么

它是**最后一次** `screenshot:capture` 的运行记录，**不是本目录的清单**。
现量 `targets: 11`（最后一次跑的是 web 那 11 张）。

"manifest 里没有某张图" ≠ "那张图不存在"。要看全目录时效，读上面那张表。

---

## 与软著材料的关系（别混用）

`docs/operations/software-copyright/evidence/screenshots/` 是**另一套**：
按"一个人怎么用它"的 10 段旅程编排、1920×1080、每张拍完立刻断言关键词。
那套是**备案材料**；本目录是**产品/官网/商店**用的，判据是 `readyText`。
