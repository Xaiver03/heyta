# 帮助入口（设置 →「关于与帮助」）深浅主题 × 窄宽屏取证

**产出者**：`scripts/qa/reminders-data-responsive.mjs` 的 `help` 腿（`HEYTA_RESPONSIVE_LEGS=help`）。

| 文件 | 视口 | 主题 |
|---|---|---|
| `help-375-light.png` / `help-375-dark.png` | 375（窄屏，设置面板整屏、导航塌缩） | 亮 / 暗 |
| `help-1440-light.png` / `help-1440-dark.png` | 1440（两栏：左分组导航 + 右内容） | 亮 / 暗 |

🔴 **这四张拍的是"主检出的工作树"，不是任何一棵已提交的树** —— 这一句是这批证据的承重部分，删掉它这四张图就会变成假证据：
画面里的第四条 **「投诉与举报」** 在 `HEAD` 上不存在（取现量：
`git show HEAD:apps/web/src/features/settings/HelpPanel.tsx | grep -c about-link-feedback` 报 **0**、
`git show HEAD:packages/i18n/src/locales/zh-CN.ts | grep -c 投诉与举报` 报 **0**，而工作树各命中 1）。
⇒ 拿这四张去对"HEAD 长什么样"会得出一个 HEAD 兑现不了的承诺；它们证的只是**当前源码（含未提交的帮助面那半）渲染成什么样**。

## 人打开看过（AGENTS §6.2 规定一）

四张里两张逐张核过（`help-375-dark`、`help-1440-light`），结论：
暗色不是亮色的反相 —— 卡片有自己的深底一档、标题与副文案是两级灰、四枚图标与右上的外链箭头都跟着走主蓝（**这句只说到"看得出层级"为止，色值没有在这里取现量**）；
亮色那一档里第一张卡（帮助中心）带选中态底色，与其余三张区分得开。
窄屏那一档四条行的标题与副文案都在卡片内换行、没有压到右侧箭头（这一条的**尺**不在这里，
在 [`../settings-group-theme-sweep/README.md`](../settings-group-theme-sweep/README.md) 的「长标题自然换行」那一节，
它量的是同一枚 `.ht-type-row` 版面）。

## 这一格不证明的三件事

1. **不证明"干净检出上有一道门"**：钉这张界面的 Playwright 用例 `e2e/tests/help-entry-ux.spec.ts` **至今未入库**
   （`git log --diff-filter=A -- e2e/tests/help-entry-ux.spec.ts` 为空）。它和它判的那半产品代码必须**同一方一起落**，
   单独提交它就得到一枚在干净检出上必红的 spec —— 这条写在计划里，不在这里改判。
2. **不证明外链真的打得开**：这四张是静态渲染取证，`href` 与 `rel` 由那枚未入库的 spec 判。
3. **不证明四端**：Web 一栏。iOS / Android / 两个桌面的帮助入口见台账 UX-S9-09 那一行的"完整四端容器矩阵待验"。
