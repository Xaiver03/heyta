# 英文版命名与文案规范

> 适用：`packages/i18n/src/locales/en.ts` 里所有用户可见的英文词条（Web / 移动 / 桌面 / 落地页 / 邮件）。
> 中文侧是唯一事实源（`zh-CN.ts` 定义 `MessageKey`），本规范只约束**英文怎么译、怎么命名**。
> 目标只有一句：**同一概念在英文界面里永远用同一个词，同一类标点永远只用一种写法。**

---

## 1. 依据（best practice 从哪来）

英文界面的写法不是审美问题，主流规范有明确结论，这里只取可直接落地的几条：

| 结论 | 来源（一手） |
|---|---|
| 界面标题、按钮、标签、菜单**一律句首大写（sentence case）**，专有名词除外；不要全大写、也不要整句首字母大写（Title Case） | [Microsoft Writing Style Guide · Capitalization](https://learn.microsoft.com/en-us/style-guide/capitalization)；现代设计系统的默认亦为 sentence case（[Sentence Case vs Title Case in UI](https://typenorm.com/articles/sentence-case-vs-title-case-in-ui)） |
| 标题、UI 元素名、≤3 词的短项**不加句末句号**；完整句子加句号 | [Microsoft Mechanics · Punctuation](https://diginsight.github.io/knowledgehub/03.00-tech/40.00-technical-writing/microsoft-writing-style-guide/02-microsoft-mechanics-and-formatting.html) |
| 破折号用 **em dash（—）**，不用半角连字符 `-` 充当破折号；同一产品内只允许一种破折号形态 | 同上 |
| 省略号用**单字符 `…`**，不用三个点 `...`（尤其 `Loading…`） | 同上 |
| 引号用弯引号 `“ ” ‘ ’`，不用直引号 | 同上 |
| 术语**一致性高于多样性**：同一个东西只有一个名字，翻遍全库都对得上 | [Nielsen Norman Group · 一致性原则](https://www.nngroup.com/articles/consistency-and-standards/)；Microsoft 术语表纪律同源 |
| 艾森豪威尔四象限的英文惯用命名与动作词：`Do first / Schedule / Delegate / Eliminate`，象限轴为 `Urgent + Important` 的组合 | [The Eisenhower Matrix（Situational Leadership）](https://situational.com/blog/the-eisenhower-matrix-explained/)、[Asana 指南](https://asana.com/resources/eisenhower-matrix) |

> 本仓历史调研 [`docs/research/ticktick-copy-tone.md`](../research/ticktick-copy-tone.md) 给的是**结构**结论（标签 vs 句子、疑问句占比、危险动作载体），可作为文案形态的补充参照。

---

## 2. 通用规则（逐条可判）

1. **大小写**：句首大写。例：`Next 7 days`（不是 `Next 7 Days`）、`Get it out of your head`、`Add a task`。专有名词保留原样：`heyta`、`AI`、`Web / iOS / Android`。
2. **句末标点**：标题/标签/按钮/≤3 词短项**不加句号**；成句加句号。
3. **破折号**：统一 ` — `（em dash，两侧各一空格）。**全库禁止**用 ` - `（半角连字符 + 空格）当破折号。`e-mail`、`to-do`、版本号、URL 里的原生连字符不受影响。
4. **省略号**：统一 `…`（单字符）。**禁止** `...`。
5. **引号**：`“ ”`、`‘ ’`。**禁止**直引号 `" '` 出现在正文里（代码片段/命令除外）。
6. **术语一致**：见 §3 术语表。一个概念只允许一个英文词；同义词只用于**确实不同的**东西。
7. **数字与单位**：阿拉伯数字；`KB / MB / GB`、`%`、`×` 等符号保留，不译。

---

## 3. heyta 英文术语表（canonical glossary）

> 「规范英文」是唯一写法；「不要用」列出常见误译或旧写法，出现在新文案里应当改回。

| 概念 | 中文 | 规范英文 | 不要用 |
|---|---|---|---|
| 任务 | 任务 | **task** | to-do, todo, item（指代任务时）, entry |
| 清单 | 清单 | **List** | project, folder（当指"清单"时） |
| 文件夹 | 文件夹 | **Folder** | — |
| 标签 | 标签 | **Tag** | label |
| 收件箱 | 收件箱 | **Inbox** | — |
| 今天 / 明天 / 最近 7 天 / 已完成 | — | **Today / Tomorrow / Next 7 days / Completed** | — |
| 四象限（功能名） | 四象限 | **Quadrants** | Priority matrix, Eisenhower matrix（对外解释可用，界面标签不用） |
| 象限一｜重要且紧急 | 重要且紧急 | **Important and urgent** | — |
| 象限二｜重要不紧急 | 重要不紧急 | **Important, not urgent** | — |
| 象限三｜紧急不重要 | 紧急不重要 | **Urgent, not important** | — |
| 象限四｜不重要不紧急 | 不重要不紧急 | **Neither important nor urgent** | Not important, not urgent |
| 象限动作：马上做 / 计划做 / 交给别人 / 先不做 | — | **Do now / Schedule / Delegate / Drop** | Do not do（旧）, Eliminate（外部解释可用） |
| 优先级 | 优先级 | **Priority** | — |
| 截止日期 | 截止日期 | **Due date** | deadline（避免混用） |
| 看板 | 看板 | **Board** | Kanban（内部可用，界面用 Board） |
| 时间线 | 时间线 | **Timeline** | — |
| 专注计时 | 专注计时 | **Focus timer** | Pomodoro（仅解释用） |
| 习惯 | 习惯 | **Habits** | — |
| 笔记 | 笔记 | **Notes** | memo |
| 倒数日 | 倒数日 | **Countdowns** | — |
| 回收站 | 回收站 | **Trash** | Recycle bin |
| AI 助手（对话面板/入口） | 对话助手 | **AI assistant** | Chat assistant（旧）, assistant（口语可，标题用全称） |
| 视图（保存的筛选视图） | 视图 | **View** | filter（筛选 ≠ 视图） |

> 表中 `AI assistant` 与落地页/侧栏/移动端共用同一个名字；同一条概念**不允许**在 Web 叫 `Chat assistant`、在移动端叫 `AI assistant`。

---

## 4. 现状盘点（本次改动依据）

改动前的英文表（4858 条）里，可以直接量出来的不一致：

| 项 | 改动前 | 说明 |
|---|---:|---|
| 用 ` - ` 当破折号 | **86 条** | 与另一种写法 ` — `（309 条）并存，同库两套破折号 |
| 用 `...` 当省略号 | **14 条** | 与 `…`（74 条）并存，且集中在 `Loading…` 一类加载态 |
| 象限四名称 | 2 套 | landing 用 `Neither important nor urgent`，Web 用 `Not important, not urgent` |
| 象限「先不做」动作 | 2 套 | landing 用 `Do not do`，Web 用 `Drop` |
| AI 助手名称 | 2 套 | Web 两处 `Chat assistant`，移动端 `AI assistant` |
| 大小写 | 1 处 | `Next 7 Days`（Title Case）与全站 sentence case 不一致 |

---

## 5. 本次已应用

- 破折号 ` - ` → ` — `：**86 条**一次性归一。
- 省略号 `...` → `…`：**14 条**。
- 象限四统一为 `Neither important nor urgent`（`web.shell.nav.q4`、`web.quadrant.q4`；landing 原本已如此）。
- 象限「先不做」统一为 `Drop`（`landing.quadrant.drop`：`Do not do` → `Drop`）。
- AI 助手统一为 `AI assistant`（`web.ai.chat.title`、`web.ai.assistant.title`：`Chat assistant` → `AI assistant`）。
- 大小写：`web.shell.nav.next7Days` `Next 7 Days` → `Next 7 days`。
- 顺带补齐 4 个「本来就不可译」的词条到两处白名单（`web.admin.aiGateway.id/baseUrl/apiKey`、`mobile.tab.ai`），修掉既有的门禁/测试红。

校验：`check:i18n-vars` 通过、`@heyta/i18n` 测试 30/30、`@heyta/web` language-switcher 14/14、i18n typecheck 通过；`check:ui-language` 除一条**与本次无关、属另一条工作流未提交改动**的 `apps/landing/pages/DownloadPage.tsx` 硬编码 `heyta` 外，无新增违规。

---

## 6. 后续建议（把规范变成可判红）

1. **加一条「标点/句式一致性」门禁**：逐键校验英文值的终止标点类别、是否疑问、破折号字符（`—` vs `-`）、省略号字符（`…` vs `...`），不一致报红并列键。规范写得再好，不进门禁就会漂 —— 参照 [`ticktick-copy-tone.md`](../research/ticktick-copy-tone.md) §6 R4 的做法。
2. **侧栏象限标签换行**：窄栏里 `Urgent, not important` / `Neither important nor urgent` 会折行。这是**布局**问题（不是文案），建议对侧栏标签加 `white-space: nowrap; text-overflow: ellipsis`，或在该处改用动作名（`Do now / Schedule / Delegate / Drop`）。两选一，不混用。
3. **落地页与邮件文案**同受本规范约束；下一轮按本表统一（营销长句可例外于"≤3 词不加句号"，但术语与破折号仍须一致）。
