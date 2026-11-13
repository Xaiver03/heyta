# screenshots/ —— 截图产物（**不是产品现状**）

> ⚠️ **本目录里没有一张图能代表"今天的界面"。** 它们是一次次 `pnpm screenshot:capture`
> 跑出来的**历史产物**，跨越了至少三代 shell。引用前先读下面的时间表。
>
> 想说明"产品现在长什么样" ⇒ 用 `docs/operations/software-copyright/evidence/screenshots/`
> （2026-11-08 拍，1920×1080，每张带断言），或**重新拍**（见下）。

---

## 怎么重新拍

```bash
pnpm screenshot:list        # 列出全部目标（不启动浏览器）
pnpm screenshot:capture     # 拍 web + landing（需要应用在 localhost 跑起来）
pnpm screenshot:capture -- --only W01
pnpm screenshot:app-store   # 拍 App Store 三尺寸
pnpm screenshot:verify      # 校验产物尺寸与空白
```

- 目标注册表：`scripts/screenshots/targets.mjs`（**唯一事实源**）
- 拍摄实现：`scripts/screenshots/capture.mjs`
- 就绪判据是 `readyText`（真实词条），不是 `sleep` —— 所以**改文案会让重拍失败**，那是设计如此。

---

## 🔴 每张图对应哪一代 shell（引用前必读）

三代分界线（都记在 `apps/web/src/features/shell/view-tabs.ts` 与 `App.tsx` 的注释里）：

| 代 | 分界 | 形状 |
|---|---|---|
| **A** | 2026-09-29 之前 | **顶部横向 tab + 宽侧栏**（左侧是带文字的完整导航） |
| **B** | 2026-09-29 起 | tab 挪进侧栏；rail 上段 = 4 项 + 「更多」 |
| **C** | 2026-11-02 起 | 页头五组控件收进一枚 `⋯`；任务行动作收进详情面 |

| 文件 | 拍摄日 | 代 | 还能用吗 |
|---|---|---|---|
| `web-desktop/W03-习惯.png` | 2026-09-28 | **A** | ❌ 画的是已废弃的顶部 tab 形态 |
| `web-mobile/MW01-移动端任务.png` | 2026-09-28 | **A** | ❌ 同上，且当次布局有溢出（「AI 工具调用」被挤成竖排） |
| `web-mobile/MW03-移动端习惯.png` | 2026-09-28 | **A** | ❌ |
| `web-desktop/W02-四象限.png` | 2026-10-06 | B | ⚠️ 结构对，但四象限后来有改动 |
| `web-desktop/W04-番茄钟.png` | 2026-10-06 | B | ⚠️ |
| `web-desktop/W05-时间线.png` | 2026-10-06 | B | ⚠️ |
| `web-desktop/W07-回收站.png` | 2026-10-06 | B | ⚠️ |
| `web-mobile/MW02-移动端四象限.png` | 2026-10-06 | B | ⚠️ |
| `web-desktop/W01-任务.png` | 2026-11-02 | **C 前夜** | ❌ 任务行还挂着 9 个动作、页头 3 个控件 —— 这两样都在 11-02 当天被收走 |
| `web-desktop/W06-成长.png` | 2026-11-02 | C | ✅ 结构可用 |
| `web-desktop/W08-设置.png` | 2026-11-09 | C | ✅ 结构可用（但内容密度只有 8.6%，见 `manifest.json`） |
| `web-desktop/*-en-*.png` | 2026-10-01 / 10-10 | B | ⚠️ 英文版，结构同 B 代 |
| `landing/L0*.png` | 2026-10-05 | — | ⚠️ 官网自有版本节奏，与 shell 无关 |
| `app-store/**` | 2026-10-06 | B | 🔴 **iOS 提审前必须重拍** —— 展示 B 代界面等于展示一个两个月前、中间改过两次的产品 |

---

## `manifest.json` 是什么

它是**最后一次** `screenshot:capture` 的运行记录（`capturedAt` + 那一次的产物），
**不是本目录的清单**。

- 现量：`targets: 1`、只登记 `W08-设置.png` ⇒ 最后一次跑的是 `--only W08`。
- 所以"manifest 里没有某张图" ≠ "那张图不存在"；反过来"manifest 说 11-02"也
  ≠ "那张图是 11-02 拍的"（`W08` 的 mtime 是 11-09）。

要看全目录的时效，读上面那张表，不要读 manifest。

---

## 与软著材料的关系（别混用）

`docs/operations/software-copyright/evidence/screenshots/` 是**另一套**：
按"一个人怎么用它"的 10 段旅程编排、1920×1080、每张拍完立刻断言关键词。
那套是**备案材料**，有它自己的判据（`shoot.mjs` 的 `must` 数组）。
本目录是**产品/官网/商店**用的，判据是 `readyText`。两套不要互相替代。
