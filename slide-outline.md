# Slide Outline

## Meta
- Topic: heyta 产品介绍 —— 一款本地优先、端到端加密、可自建自托管的任务/习惯/专注管理应用（对标滴答清单）
- Scenario: 产品介绍 deck —— 面向潜在用户、自建爱好者与早期投资人，20 分钟讲述
- Content Source: provided（仓库内 README / roadmap / i18n 定价词条 / design-system tokens）+ light 检索
- Research: light — 2 次检索，对齐 2026 年 SaaS 产品介绍 deck 的叙事顺序与页数纪律
- Style: heyta 原生蓝白 —— 严格取用 `packages/design-system/src/tokens.css` 的 blue-600 / slate 色阶，不另造色系
- Slide Count: 15
- Generated At: 2026-10-24T11:10:00+08:00

## 交付形式（本轮修订）

**界面页不再是手画的示意图，而是直接渲染真实复现件。**

第一版把产品界面照着重画了一遍，结果与真实界面不一致（用户一眼看出）。第二版改为
在 `apps/landing/pitch/` 下建入口，import `apps/landing/src/mockup/AppWindow.tsx`，
由它渲染五个真实视图；样式全部来自 `mockup.css`，与官网首屏那一块**是同一份组件**。

- 源码：`apps/landing/pitch/`（`PitchDeck.tsx` + `pitch.css` + `vite.config.ts`）
- 产物：`pitch/dist/index.html`（含 assets，`base: './'` 可直接 file:// 打开）
- 重新构建：`cd apps/landing/pitch && node ../node_modules/vite/bin/vite.js build`
- 交互：← → 翻页 · F 全屏 · A 自动播放（9s）· G 总览

界面页的 DOM 由 `app-shell-shape.ts` 的登记处派生，而那份登记由
`apps/landing/tests/mockup-shell-shape.spec.tsx` 与 `apps/web/src/App.tsx` 逐项对账 ——
所以 deck 里的界面**跟着产品改**，不会单独漂移。

## Source Materials
- `README.md` —— 项目原则 7 条（功能等价不抄皮 / 复用优先 / 本地优先 / 隐私优先 / 导出自由 / 许可证干净 / 可维护优先）
- `docs/plans/roadmap.md` —— P0 奠基 ✅ / P1 单端闭环 ✅ / P2 多端补齐 🔄；AI 线 AI-0/1/2/5/6 已实现
- `packages/i18n/src/locales/zh-CN.ts` —— 定价三档：开源自建 免费永久 / 官方托管 ¥5·月 / 官方托管+云端 AI ¥12·月（AI 每月 300 次）
- `apps/landing/src/mockup/app-shell-shape.ts` —— 真实外壳结构：rail 6 项 + 帮助/同步、主导航 3 项、四象限 4 项、面板 2 块（清单/标签）
- `apps/landing/src/mockup/showcase-data.ts` —— 演示任务集，四象限计数由它派生（2 / 4 / 1）
- `packages/design-system/src/tokens.css` —— 品牌色 blue-600 #2563eb、surface #ffffff、background slate-50 #f8fafc

## Slide-by-Slide Outline
1. **封面** — 「你的清单，不该是别人的资产」+ 定位：功能对标滴答清单，但可以自建自托管 | Image: no
2. **问题（暗色）** — 订阅制任务工具的三笔账：年费越涨、数据在别人服务器上、想自建没得选 | Image: no
3. **为什么是现在** — 三步推进：本地优先成为共识 → 加密与同步工程成熟 → AI 需要可控的数据入口 | Image: no
4. **解决方案** — 一句话主张：清单+日历+四象限+习惯+专注，一套体验，数据默认落在你自己设备上 | Image: no
5. **任务视图（真实界面）** — `AppWindow view="tasks"`：rail、主导航、四象限计数、清单+标签、任务行、右侧详情列 | Image: 真实 DOM
6. **四象限（真实界面）** — `AppWindow view="quadrant"`：四格看板，计数与侧栏同源 | Image: 真实 DOM
7. **习惯（真实界面）** — `AppWindow view="habits"`：连续天数 + 热力图 | Image: 真实 DOM
8. **专注（真实界面）** — `AppWindow view="focus"`：番茄钟计数环、关联任务、时长设置 | Image: 真实 DOM
9. **时间线（真实界面）** — `AppWindow view="timeline"`：任务/习惯/专注汇入同一条甘特时间线 | Image: 真实 DOM
10. **五种视图，一份数据** — 五个真实窗口 3+2 排布 + 一句「切视图只是换投影，不换数据」 | Image: 真实 DOM ×5
11. **隐私架构（暗色）** — 本地存储 → op-log 事件溯源 → 端到端加密 → 云端只是通道 | Image: no
12. **AI 能力** — 2×2：捕获 / 拆解 / 优先级 / 时长估算；脚注：本地 API + MCP 30 个工具、9/10 实体、只监听回环 | Image: no
13. **多端覆盖** — Web / macOS / Windows / Linux / Android / iOS / 鸿蒙，一份 UI 单源 | Image: no
14. **商业模式** — 免费永久（MIT 自建）/ ¥5 月（托管）/ ¥12 月（托管+云端 AI 300 次）；付费不阉割功能 | Image: no
15. **路线图与邀请（暗色）** — P0 ✅ P1 ✅ P2 进行中 → 开始自建 / GitHub | Image: no

## Visual Rhythm Notes
- 界面页从 3 页扩到 6 页（5 个视图 + 1 个总览），集中在 5–10，连续六页让听众"看见产品"
- 暗色强调页放在 2（问题）、11（隐私架构）、15（结尾）—— 三次节奏转折
- 左右分栏交替：任务/习惯/时间线（左文右窗），四象限/专注（镜像，窗左文右）
- 全 deck 字号：主标题 ≥46px，正文 ≥26px；浏览器按视口等比缩放 1920×1080 舞台
- 界面窗口宽度由列宽决定（`1fr`），不写死 —— 写死会溢出页外
