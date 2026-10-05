# 帮助中心 → SSOS 式文档中心（结构搬运 + 内容写满 + 双语）

> 状态：**进行中**

## 0. 这活为什么干

访客在 `/help` 上看到的是"十条速答 + 六篇文章"，读完就断了：五个分类里只有两个有深读，
没有分类页、没有页内目录、没有搜索、没有一张真界面截图。
SSOS 的帮助中心已经跑通了那个形态（hub → 分类 → 文章 → 侧栏地图 → 页内 TOC → 搜索 → 配图）。
干完之后：heyta 的公开文档中心是**一条能从头读到尾的路**，五个分类都有真内容，中英两版同时存在。

三个已经拍定的决策（2026-09-30，产品负责人）：

| 决策 | 取值 |
|---|---|
| 承载形态 | `apps/landing` 注册表内扩文章路由（**不**新建第二套路由/入口生成） |
| 改造对象 | 公开用户面：`/help` 扩成 SSOS 式文档中心（内部工程文档仍走 `docs/DOCUMENTATION_STANDARD.md`） |
| 内容深度 | 五个分类都写满真内容，配真界面素材 |

让步顺序：**内容说得对 > 结构齐全 > 页面数量多**。写一句产品做不到的事，比少一个分类页严重得多。

---

## 1. 承载形态的硬约束（先读，否则一定返工）

- **页面结构唯一事实源** = `SITE_PAGES`（`apps/landing/src/site/pages.ts`）。
  入口 HTML、`<title>`/description、canonical、hreflang、sitemap、语言切换器落点、
  "没有孤立路由"判据，全部由它派生。
- **文章 id 清单是派生的，不许再抄一份**：`docs.ts:60` 用模板字面量类型
  `Extract<(typeof SITE_PAGES)[number], { path: \`/help/${string}\` }>` 抽出 `DocsArticleId`，
  `DOCS_ENTRIES: Record<DocsArticleId, DocsEntry>` 使得**注册了文章却没写正文 ⇒ 编译不过**。
- **正文分区复用同一套渲染器**：`SectionSpec`（`apps/landing/src/site/PageSections.tsx:112`）
  + `PageSections.tsx`。文章与 `/features`、`/platforms` 用同一个分区形状，
  否则就是"两个站点拼起来"。
- **文案零硬编码**：`check:ui-language`（`scripts/check-ui-language.mjs`）拦硬编码，
  词条表 `packages/i18n` 是唯一事实源，中英**必须同时**给（`satisfies Record<MessageKey,string>` ⇒
  缺英文 = 编译错）。基线（2026-09-30 实测）：`site.*` 中文 **305** 条、英文 **305** 条。
- **产物字节对账**：`pnpm check:entries` = `apps/landing/scripts/gen-entries.mjs --check`，
  重新生成后与提交物逐字节比对。**改注册表或词条后必须重跑 `pnpm --filter @heyta/landing gen:entries`**。

---

## 2. SSOS 结构对照：哪些已有、哪些是缺口

| # | SSOS 的那件事 | heyta 现状（2026-09-30 实测） | 结论 |
|---|---|---|---|
| 1 | hub 页 | `/help`（`pages.ts:214`） | ✅ 已有 |
| 2 | **分类索引页** `/help/<category>/` | 没有。6 篇文章直接挂 `/help/<slug>`（`pages.ts:291-360`） | 🔴 缺 |
| 3 | 侧栏树（分组 + 折叠 + 当前项高亮） | `DocsNav.tsx` 有分组与当前高亮（e2e 断言在 `e2e/landing/docs-centre.spec.ts:154`），**无折叠、无移动端抽屉** | 🟡 半个 |
| 4 | **页内 TOC**（自动从 `h2/h3` 生成） | 全仓 0 处 TOC（`grep -i toc apps/landing/src/` 只命中注释） | 🔴 缺 |
| 5 | 顶栏搜索 + `search-index.json` | 没有（`apps/landing/scripts/` 只有 gen-entries / gen-og-card） | 🔴 缺 |
| 6 | 文章配图 + 图号 `图 <章>-<n>` + 注入器 | 文章里**一张图都没有**；`SectionSpec` 只有 `mockView`（DOM 复现件） | 🔴 缺 |
| 7 | FOOTER_SCHEMA / 结构化数据 | 已有：每个入口 HTML 内嵌 `<script type="application/ld+json">`（`apps/landing/index.html:81`） | ✅ 已有 |
| 8 | 中英双语 | SSOS **没有**英文（无 `/en/`、无 `?lang=`、零 hreflang），只有地区模型 | heyta 更强，直接沿用现有 i18n 机制 |

> ⚠️ 第 6 条与本仓一条既有立场相撞，见 §5。

---

## 3. 内容配额：五个分类写满

分类词表**一个新词都不造**：`HelpModuleId = 'start' | 'sync' | 'organize' | 'data' | 'trust'`
（`apps/landing/src/site/content.ts:274`，`HELP_MODULES` 在 :304-349，五个分类各两条速答 = 10 条）。

| 分类 id | 现有文章 | 硬下限 | 目标 |
|---|---|---|---|
| `start` | 0 | **2** | 3：装完第一步 / 任务·清单·标签·习惯的模型 / 功能模块开关怎么关 |
| `sync` | 4（how / account / passphrase / conflict） | 已达标 | +1：设备增删与"退出所有设备"到底存不存在 |
| `organize` | 0 | **2** | 3：重复任务 / 提醒与通知投递 / 四象限·日历·时间线·搜索各解决什么 |
| `data` | 2（selfhost / transfer） | 已达标 | +2：导出导入的真实边界 / 回收站与"彻底删除"为什么不清标志位 |
| `trust` | 0 | **2** | 3：服务端到底看得到什么 / 端到端加密与托管 AI 的例外 / 口令丢了会怎样 |

⇒ **下限 = 新增 6 篇（start / organize / trust 各 2），目标 = 新增 9 篇。** 写不满目标就交下限，
**宁 2 篇实的不要 3 篇凑的**。

**内容纪律**：一个分类**没有文章就不许出现分类页链接**（沿用 `/features` 那条纪律，
`docs.ts:36` 明写"没有内容就不许出现链接，所以空分类不渲染卡片"）。

---

## 4. 事实清单：公开文案可以说什么

正面能力（每条都有代码证据，2026-09-30 复核）：

- **实时通道已接**：`apps/web/src/features/sync/store.ts:252` 调 `createHostRealtimeClient`，
  `apps/web/src/main.tsx:133` 冷启动起连，`onNewOps → syncNow()`；移动端同
  （`apps/mobile/src/sync/realtime.ts:83`）。⇒ 可以写"**另一台设备的改动会自己出现在这边**"。
  ⚠️ `AGENTS.md` §9 里"没有任何宿主 `createRealtimeClient()`"这句**已过期**，别照它写。
- **本地写入自动上传只有移动端**：`startAutoSync` 调用点仅 `apps/mobile/src/App.tsx:84`，
  `apps/web|desktop*|node-host` **0 处**；web 的 `syncNow()` 只有手动按钮
  （`apps/web/src/features/sync/SyncBar.tsx:228/365`）与实时信号两个来源，
  `startAutoRetry` 是失败重试不是写入去抖。⇒ **不许**写"你的改动会自动上传"。
- **服务端看得到什么**：`server/prisma/schema.prisma` 的 `Operation` 表里
  `actionType / opType / entityType / entityId / entityIds[] / vectorClock / clientTimestamp /
  payloadBytes / isPayloadEncrypted` 都是**明文列**，只有 `payload` 是密文。
  ⇒ 诚实说法：看得见"动了哪类实体、多少条、什么时候、多大"，看不见内容明文。
- **模块开关是设备本地偏好**：`apps/web/src/features/shell/modules.ts:24-33` 明写
  不进 op-log、不跨设备同步。
- **导入只能还原到空库**：`packages/app-host/src/import-dump.ts:18/40/91`
  —— 合并被**明确拒绝**（理由是"会静默丢数据"，是产品结论不是排期）。
- **通行密钥全生命周期在应用里有**：新增/列出/改名/删除在
  `packages/app-host/src/hosted-auth.ts` + `apps/web/src/features/settings/PasskeyPanel.tsx`；
  **找回**是服务端渲染页 `/recover-passkey`（不在 SPA 里）。

## 5. 负面清单：这些句子一句都不许出现

逐条都是实测出来的"产品现在做不到"或"会误导"：

1. 🔴 不许把**托管/云端 AI** 说成端到端加密（ADR-0005/0006；词条已写：
   `packages/i18n/src/locales/zh-CN.ts:209`、`:1047`；门禁 `scripts/check-ai-coverage.mjs`）。
2. 🔴 不许说"服务端完全看不到你做了什么" —— 见 §4 的明文列。
3. 🔴 不许说"改动自动上传到云端"（web/桌面不做写入去抖）。
4. 🔴 不许出现"一键退出所有设备"：`/api/replace-token` 的真实调用点只有
   `server/public/app.js:253`（服务端找回页），`apps/`、`packages/` **0 处**。
5. 🔴 不许说导入能合并到已有数据的库。
6. 🔴 不许说移动端能导入（导出三端都有，导入只有 Web + CLI）。
7. 🔴 不许承诺口令找回：端到端加密口令**没有任何找回路径**（丢了就是解不开）。
8. 🔴 不许把模块开关说成跨设备同步。
9. 🔴 不许写 `hosted-ai-monthly`（¥12 档）在卖：ADR-0023 —— 计量存在之前不得售卖，
   `pnpm check:ai-quota` 会拦。
10. 🔴 不许出现第三个权益种类：只有 `hosting` 与 `ai` 两种 kind。
11. 🔴 不许说鸿蒙能用：`apps/mobile/harmony/` 工程目录**确实存在**（AppScope /
    build-profile.json5 / entry / hvigor，2026-09-30 实测），但**没有模拟器系统镜像 + 签名**，
    产物 unsigned，从未跑起来。措辞只能是"构建链已打通、尚未运行验证"。
12. 🔴 不许出现发布 tag / 版本号承诺（还没有正式发布）。
13. 🔴 不许把 SMTP 写"可选"：自建栈的邮件链路需要它。
14. 🔴 不许说自建是"一条命令"：`server/scripts/deploy.sh` 会拉起整个 compose 栈（含 caddy）。
15. 🔴 不许把 IP 字面量上的通行密钥说成能用：Chromium 拒收非安全上下文里的 IP 作 RP ID
    （`VITE_APP_URL` 类讨论见 `docs/runbooks/deployment.md` §3.7）。
16. 🔴 不许出现内部标识：SSH 别名、公网 IP、密钥路径、ZeroTier ID
    （`docs/runbooks/deployment.md` §1、`docs/reference/build-matrix.md` §1 的内容**禁止**进公开页）。
17. 🔴 不许出现内部证据文件路径（`evidence/…`、`/tmp/…`）当用户可见步骤。
18. 🔴 不许写"已上线的邮箱域名/服务商"具体配置。
19. 🔴 不许写死实时数字（测试数、页面数、条目数）——会腐坏。
20. 🔴 不许把 PWA 说成能用：`SW_URL = '/sw.js'` 与 manifest 的 `start_url`/`scope` 是根绝对路径，
    而应用挂在 `/app/` ⇒ 线上 `/sw.js` 返回落地页 HTML，**已知未修**
    （`docs/runbooks/deployment.md` §3.7「还没做的」）。
21. 🔴 不许说"通知会弹出来"：投递路径刚接，且移动端**没有**本地通知依赖（2026-09-30 实测）。
22. 🔴 不许说回收站能彻底删除数据：`purgedAt` 只是**标记**，不清 `deletedAt`
    （清了会让离线对端复活已删数据）。
23. 🔴 不许说"多设备冲突会自动合并"：向量时钟判并发 + LWW 加 `clientId` 决胜，
    冲突要用户在 `ConflictDialog` 里选。
24. 🔴 不许出现"用户数据"字样的截图或示例：产品还在开发阶段、不可能有用户（AGENTS §0），
    示例数据必须明显是演示数据。
25. 🔴 不许承诺 AI 的结果自动写入：AI 只产出建议，写入必须 `dispatch()` + 用户确认。
26. 🔴（2026-10-01 产品负责人新增）**文档中心不许出现开发向内容**：内部字段名
    （`purgedAt` / `repeatRule`）、存储引擎（SQLite）、规范编号（RFC 5545）、
    同步内核词汇（向量时钟 / LWW / 因果历史）、加密算法名（Argon2id / AES-GCM）、
    CLI flag（`--due` / `--out`）、部署名词（Docker / JWT / env）—— 一律不行。
    **唯一豁免 = 自托管相关的文案**（`site.docs.selfhost.*` 与平台页/集成页的
    selfhost 段）：自托管说明就是写给动手的人看的，那一块反而**要**写详细。
    执行闸门：`pnpm check:docs-voice`（禁词表 30 项，变异验证见 §11）。

---

## 6. 截图方式：SSOS 的做法在本仓已经有了，复用它

`scripts/screenshots/` **本身就是 SSOS 那套的移植**（README 第一行写明），
且已产出并**提交**了 18 张真界面截图。基线（2026-09-30 实测）：

```
pnpm screenshot:verify  →  ✅ 截图校验通过（注册表共 18 个目标；已生成的均尺寸正确、无 alpha、非空白）
screenshots/landing/     L01-官网首屏 … L07-登录            （7）
screenshots/web-desktop/ W01-任务 … W08-设置                 （8）
screenshots/web-mobile/  MW01 … MW03                         （3）
```

- 目标注册表：`scripts/screenshots/targets.mjs`（字段 `id/name/site/openVia/path|view/readyText/dismissTexts/device/appStore`）。
- 与 SSOS 的三处差异（**照抄会踩**）：① `apps/web` 的视图是 React state 不是 URL 路由，
  web 目标必须 `openVia: 'tab'`；② `readyText` 取 `packages/i18n` 真实词条做就绪门控，
  不用 `sleep(3000)`；③ 用本仓已有 Playwright，不引入 puppeteer。
- 判据：`contentRatio` / `colorSpan` / `hasAlpha` + 糊字启发式，算法在 `png-stats.mjs`，
  校验器自身由 `png-stats.test.mjs` 用 `magick` + IHDR 字节**双向**验证。
  ⚠️ **不要靠调低阈值让它变绿**（README 明写）。

### heyta 的图号与注入器（本轮新增的部分）

1. 图号 = `图 <章>-<序>`：**章 = 文章在 `SITE_PAGES` 注册表里的序号**（从 1，含分类页顺序），
   **序 = 该文章内第几张**（从 1）。两个都由脚本算，人不手写编号，只写 caption key。
2. 资产落点：`apps/landing/public/assets/docs/<articleId>/<file>.png`（`screenshots/` 在仓库根，
   落地页构建够不着，必须复制进 `public/`）。
   ⚠️ 2026-10-03 从 `assets/help/` 改成 `assets/docs/`：**用户可见的 URL 跟着页面所在的
   `/docs/` 走**；`f82ace65`（10-02 08:46）把页面搬到 `/docs/`、把 e2e 判据写成 `/assets/docs/`，
   却没搬产物目录，于是那条判据一直断在一个不存在的目录名上（取证见 `BLOCKED.md` B24）。
   内部标识（`helpFigures.ts`、`HELP_FIGURE_ROOT`、`gen-help-figures.mjs`、词条 key `site.help.*`）
   **仍叫 help** —— 它们命名的是内容种类（帮助文章），不是 URL；这条分叉是登记过的。
   改名只动了一行：URL 前缀与磁盘前缀现在同住 `helpFigures.ts:232`（`ON_DISK_PREFIX` 由它派生），
   生成器与孤儿扫描都 import 同一处。
3. 生成器：`apps/landing/scripts/gen-help-figures.mjs` —— 读一张**文章 → 图**映射表
   （`src/site/helpFigures.ts`），把 `screenshots/**` 的对应文件复制进 `public/assets/docs/`，
   并把 caption/alt **词条 key** 与算好的图号注入分区。要求：
   - 源文件不存在 ⇒ **响亮失败**（不写半成品）；
   - 每张复制后跑 `inspectPng`：尺寸符合目标设备预设、`hasAlpha=false`、非空白；
   - `--check` 模式：与提交物比 **sha256**，源变了没重跑 ⇒ 红（这是"不许漂移"的那道闸）。
4. 与既有立场的关系：`SectionSpec.mockView`（DOM 复现件）是 `/features`、`/platforms` 的
   "真实界面素材"答案，**不推翻**；文档中心文章需要的是**产品真界面**，
   两者是不同表面。⚠️ 但必须承认代价：**截图会过期** ⇒ 靠 `screenshot:verify` + `readyText`
   失配 + `gen-help-figures --check` 三处把"过期"变成**会红的事件**，而不是悄悄挂着旧图。
5. 🔴 禁止事项（与 SSOS 一致）：不截 docs 页自己当文章配图；不截含真实用户/账号/
   税务/发票/合同/证件/银行/手机号/token/工作区数据的图；不做装饰性配图；
   **不提交整页滚动长图**（`fullPage: true` 只允许临时 QA 用途）。

---

## 7. 双语

沿用现有机制，不新造一套：`LOCALES`（zh-CN / en）、`siteHref`/`localeFromPath`（`paths.ts`）、
`/en/…` 目录形态、canonical + hreflang 由注册表派生。SSOS 没有英文版本，
**它的结构可以搬、双语机制不能用它的** —— heyta 的词条表已经是双语的。

新增分类页/文章/图号 caption/alt/搜索占位文案，**每条都要有 `en` 值**，
否则 `satisfies Record<MessageKey,string>` 直接编译不过。

---

## 8. 门禁与判据

必跑（每条都必须**真的贴出输出**）：

```bash
pnpm -r typecheck
pnpm --filter @heyta/landing gen:entries
pnpm check:entries        # 产物字节对账
pnpm check:ui-language    # 零硬编码
pnpm check:docs           # 死链（node research/tools/docs-link-check.mjs）
pnpm screenshot:verify    # 素材门禁
pnpm check:landing-e2e    # 真浏览器 + 截图（e2e/playwright.landing.config.ts）
```

现有 landing e2e 基线：`e2e/landing/docs-centre.spec.ts` **6 条**（394 行），
截图落在 `e2e/landing-results/`（**专用目录**，因为 `e2e/test-results/` 被六个 config 共用会互删取证）。
新增判据必须**能失败**：每条新 e2e 断言配一次变异验证（制造失败 → 贴变红输出 → 还原 → 贴全绿）。

按 `AGENTS.md` §6.2 规定一：**先截图再断言、固定路径、抓 `console`/`pageerror`、人真的打开那张图看**。
规定二：**不抢前台**，验收一律后台跑；串行跑，一次只跑一条 e2e/门禁（并发会互杀取证并造出假红灯）。

## 9. 共享工作树的边界（本轮实况）

`git status` 实测另一条线正在改：`packages/design-system/**`（tokens/typography）、
`packages/i18n/src/locales/{zh-CN,en}.ts`、`apps/web/src/App.tsx`、
`apps/web/src/features/inbox/InboxBell.tsx`、`apps/web/styles/app.css`、`BLOCKED.md`、
未跟踪 `scripts/tmp-text-color-audit.mjs`。

⇒ **i18n 两个 locale 文件是本轮的共享碰撞面**。纪律：
提交时按 hunk / 行过滤（`git hash-object -w -t blob` + `git update-index --cacheinfo`），
绝不裸 `git stash`、绝不 `--amend`/`--force`；`git diff --cached` 里不得出现别人的标记；
push 只在用户明确要求时做。

## 10. 未决 / 需裁决

- ~~macOS 壳门禁 `check:macos-window` 的**跳过分支返回 `exit 0`**（非 darwin / 无 swift /
  取证 `exit 4` / 非 Aqua）⇒ `pnpm check` 可全绿而这条从未执行。改它需要一个裁决，
  建议分界：非 darwin 与无 swift 保持跳过，`exit 4` 与"有 Aqua 会话却取不到图"判红。**尚未拍**。~~
  ✅ **已拍并已落地**（本笔写于 10-01 03:38，裁决在九小时后由 `1030a560` 落进代码）：
  现在**只有**"平台不符"与"没有 `swift`"两条返回 `exit 0`（工具链不存在，这台机器上本来就不可能跑），
  `exit 4`（无屏幕录制权限）与"有 Aqua 会话却取不到图"**都判红**，分界就写在那条门禁的文件头
  （`scripts/check-macos-window.mjs:40-54`）。⚠️ 本条被 `goal-multi-end-coverage.md` §7.18 的
  "尚未拍"**照抄过一次**（10-03，比落地晚两天）—— 那句也一并更正在那里。
- `check:shell-unicode` 的红来自另一条线未提交的 `scripts/reinstall-all.sh:174` hunk
  （HEAD 干净），归属那条线，本轮不动。
- `pnpm check` 是 46 段 `&&` 链，**只暴露第一个红**；断点之后的段"没跑过"不等于"过了"。

---

## 11. 整改轮（2026-10-01，代码质量审查的产出）

上一轮交付在任务书自己的标准下全绿（独立复验过），但产品负责人复查后补了一条标准
（§5 第 26 条），据此对已交付内容做一轮整改：

**内容侧（中英同步）**

| 类别 | 处理 |
|---|---|
| 内部字段名见客（`purgedAt` ×2、`repeatRule`） | 改成访客视角说法（「已清除」标记；"界面上自定义规则里写的那种 RRULE"） |
| 整段实现语义（trash.s4p3 的 schema 演进论证） | 改写成产品语义："标记是无害的，旧版本应用也不会被弄坏" |
| 同步内核词汇（向量时钟 / 因果历史 / 随机编号 / floating 语义） | 换成行为描述（"各设备之间的先后关系"、"没有可靠依据判断该信哪一边"） |
| 算法名（Argon2id / AES-GCM） | how 篇只说"端到端加密、服务端拒收明文"；算法细节下沉到自托管篇 |
| CLI 细节（`export --out` / `--due` / "Node 宿主"） | 从 transfer / repeat 篇摘除，指向自托管篇的命令行一节（命令行入口只在自托管篇教）；hub 速答 `site.help.a.repeat` 同病同修 |
| SQLite | first-run 篇改"应用自己的本地数据库" |
| 包/文件头结构（privacy.s6p1） | 改成"四条路各有开关、默认关着" |

**自托管篇扩写（豁免区内，写开发者级）**：6 节 → 11 节。新增：
怎么装（无版本号镜像 / 钉 `SUPERSYNC_IMAGE` / `docker compose up` 不是部署 /
`--build` 的内存与缓存代价）、环境变量逐个说（`DOMAIN` / `JWT_SECRET` 换掉的代价 /
`WEBAUTHN_*` 换域名的代价 / `CORS_ORIGINS` 默认指上游演示站 / SMTP 六件套），
数据库与迁移（只向前、迁移超时与退出码）、服务端存了什么（Argon2id + AES-GCM、
明文拒收、元数据落在谁手里）、命令行宿主（十条命令 + `HEYTA_*` 环境变量 +
"设不了重复规则"的边界）。**每一条都对着 `server/env.example` / `server/README.md` /
`server/docker-compose.yml` / `apps/node-host/src/cli.ts` 核过。**

**门禁侧**：新增 `scripts/check-docs-voice.mjs`（`pnpm check:docs-voice`，已接入
`pnpm check` 链，紧跟 `check:ui-language`）。扫描两个 locale 的全部 `site.*` 词条，
禁词表 30 项，豁免 `isSelfhostKey`（自托管篇 + 平台/集成页 selfhost 段）。
两条防呆判据：解析出的 `site.*` 词条 < 100 或豁免 < 20 时响亮失败（扫描器坏掉
不得静默通过）。**变异验证**：往 `site.docs.trash.s3p1` 注入 `purgedAt` + `SQLite`
⇒ 恰好 2 红且指到同一个 key；往豁免区 `site.docs.selfhost.s9p1` 注入 `Docker`
⇒ 不误杀；还原后逐字复绿。第一轮真跑还抓到 5 处漏网（含 hub 速答里的
「命令行宿主」）—— 门禁不是仪式，是真的在拦。

**边界裁决（产品负责人口径的落地）**：RRULE / JSON / Markdown / MCP / API
**不在**禁词表 —— 界面里就有"自定义 RRULE"输入框、导出的文件就是 JSON、
本机 API / MCP 是设置里的真实开关。禁它们会把正确的产品文案误杀。
"开发向"指的是：只在代码/部署里存在、访客无法在界面上遇到的东西。
