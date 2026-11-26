# 英文 i18n 全站扫描与验收报告（2026-11-24）

> 触发：产品负责人「全面扫描所有国际化组件，英文尽善尽美，全部通过视觉检验」。
> 范围：`packages/i18n/src/locales/en.ts` 全部词条 + Web 全站英文界面（逐页截图）。
> 规范依据：`docs/reference/english-copy-naming-standard.md`（本次同时落地）。

---

## 1. 方法

1. **静态词条审计**：对 en / zh 两份表逐键比对，机器扫描——占位符是否一致、未翻译、
   双空格、标点前空格、直引号/直撇号、三点省略号、半角破折号、残留汉字、英式/美式拼写、术语并存。
2. **真浏览器视觉取证**：Playwright（Chromium，`e2e/playwright.config.ts` 起真 vite + 假端点），
   把界面钉到英文（`localStorage['heyta.locale']='en'`），逐视图 / 逐设置分类截图，并抓 `main` 可见文本。
   脚本：`e2e/tests/english-copy-audit.spec.ts`、`e2e/tests/english-copy-audit-panels.spec.ts`。
   证据：`e2e/en-audit/*.png` 与 `e2e/en-audit/text/*.txt`。

## 2. 覆盖（视觉取证，共 23 张截图）

| 类别 | 覆盖 |
|---|---|
| 主视图（11） | Tasks、Calendar、Quadrants、Habits、Timeline、Focus timer、Growth、Sticky notes、Countdowns、Board、Search |
| 任务态 | 空态、填充 3 条任务、任务详情 |
| 账户 | 头像菜单、**个人中心（Profile/Account）** |
| 设置 7 分类 | Profile、Subscription、Data & sync、Reminders & notifications、Personalization、Features & AI、About & help |
| AI | AI assistant 助手面板 |
| 主题 | 亮色全集 + 暗色首页 |

可见文本自动判据：**残留汉字 = 0；未替换 `{}` 占位符 = 0**。

## 3. 发现并修复（分类）

| # | 类别 | 处理 | 说明 |
|---|---|---|---|
| 1 | 破折号 | ` - ` → ` — `（em dash） | 全库统一；半角连字符当破折号会显得杂乱 |
| 2 | 省略号 | `...` → `…` | 尤其 `Auto-syncing…` / `Loading…` |
| 3 | 引号体例 | 应用/移动/共享等 UI 命名空间：直引号 `"` / 直撇号 `'` → 弯引号 `“ ” ’` | `site.*` 文档/代码区保留直引号（避免破坏命令与代码片段） |
| 4 | 英式/美式拼写 | 统一为**美式**：centre→center、colour→color、recognise→recognize、organise→organize、labelled→labeled、cancelled→canceled、licence→license、grey→gray、summarise→summarize | 原文混用两套，读起来不一致 |
| 5 | email | `e-mail` → `email` | 全文一致 |
| 6 | 命名统一 | 四象限 Q4 统一 `Neither important nor urgent`；动作 `Drop`；AI 助手统一 `AI assistant`；`Next 7 days` | 见术语表 |
| 7 | 语法修正 | `the model general judgement`→`the model’s general judgement`；`Sign in in the app`→`Sign in from the app`；`on on your computer`→`on for your computer`；`Auto-syncing...`→`Auto-syncing…` | |
| 8 | 并发新增/回退键 | 期间其他工作流新增/回退的词条（含 `web.calendar.hub.lastSync*`、`web.ai.inbound.events.*`）按同一规范再清一遍 | 见 §5 |

占位符：仅 3 条**英文单数专用**键（`web.sync.shareAttentionOne`、`web.conflict.titleOne`、`mobile.conflict.titleOne`）
与中文表 `{count}` 不同——英文写作「One shared change / this one place」不带数字，渲染正确，**保留**。

## 4. 门禁（全绿）

| 门禁 | 结果 |
|---|---|
| `check:ui-language` | ✅ 0 违规 |
| `check:i18n-vars` | ✅ |
| `check:crosslang-contract` | ✅ |
| `@heyta/i18n` tests | ✅ 30 / 30 |
| `@heyta/web` language-switcher | ✅ 14 / 14 |
| `@heyta/i18n` typecheck | ✅ |

## 5. 边界与后续

- **分支在并发改动**：本分支同时有其他工作流在改 i18n（期间新增若干键、并回退过个别拼写）。
  本次已按规范清理到当前快照；**后续新增词条请照 `docs/reference/english-copy-naming-standard.md` 写**，
  否则会漂。建议把「句式/标点一致性」做成门禁（该规范 §6 已列）。
- **法律文书** `packages/legal/src/documents/*` 仍含 `colour`/`recognise` 等英式拼写（如个人信息清单、
  隐私政策正文）。属法务措辞，**未擅改**；建议法务侧按美式统一后再动。
- **移动端（React Native）** 未在本环境做像素截图（需模拟器）；其词条已纳入同一套静态规范与门禁。
- **布局项（非文案）**：侧栏象限 `Neither important nor urgent`、设置里 `Reminders & notifications`
  在窄栏会折行。若要单行，用 CSS `white-space: nowrap; text-overflow: ellipsis`，或该处改用动作名
  （Do now / Schedule / Delegate / Drop）。这是布局决策，未擅自改视觉。
- 轻微措辞冗余（非错误）：设置 `Follow system` 行的值又写 `Follow system (off)`；可后续优化。

## 6. 证据清单

截图与文本：`e2e/en-audit/`（23 张 PNG + 每页 `text/*.txt`）。
复跑：`cd e2e && ./node_modules/.bin/playwright test tests/english-copy-audit.spec.ts tests/english-copy-audit-panels.spec.ts`。
