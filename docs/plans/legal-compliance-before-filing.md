# 备案前合规：全套对外法务文本与接线

> 状态：**进行中**（2026-10-01 立）
>
> 本文件是"备案之前要把哪些协议补齐"这件事的**唯一执行入口**。
> 🔴 **它不复述事实** —— 事实住在 §1 那六份调研文件里，本文件只负责
> **谁要求哪份文本 → 文本落在哪个文件 → 怎么接线 → 什么算做完 → 还缺什么**。
> 在本文件里写第二条清单就是制造漂移点，那正是本仓库最忌讳的失效形状。
>
> 📌 **进度（2026-10-01）**：九份文本齐（中英逐段结构对账全绿，条数随文档数走所以这里不记数）；**链 1 已上线**
>（组件、九条注册、样式、入口与 sitemap、`/legal/*` 页脚组），并有一道**做过变异验证**
> 的判据守着（`apps/landing/tests/legal-pages.spec.ts` 42 条 +
> `apps/landing/tests/mutate-legal-gate.mjs` 六个变异全部被抓到）。
> **链 2 已落地**（2026-10-01）：真浏览器两种 baseUrl 各跑通一次 + 第四个变异（M4）验证了
> 那套浏览器判据是承重的，详见「链 2 已落地」小节；✅ **官方域的 `/legal/*` 也已发布**
>（2026-10-01 晚，九份中英 18 个入口在线上，判据是新增的 `e2e/live-site/live-legal.spec.ts` 10 条），
> ✅ **剩下的那半边也已闭合**（2026-10-02）：nginx 对未命中的 `/legal/*` 返回**真 404**，
> 而 `/app/` 的前端路由兜底**没有被牵连**（判据是那条套件的**第 12 条**，两个变异臂精确报红；
> 取证与回滚命令见 **G-25b**）。
> ✅ **链 3 已落地并在生产上生效**（2026-10-01 实现，2026-10-02 进库 + 部署 + 线上复验）：
> `users.terms_document_version` 可空列 + 唯一判决方 `server/src/legal-consent.ts` +
> 三个写入口成对落库 + 两道互补门禁（`check:server-legal` / `check:legal-host` 三方对账），
> 两次变异注入各自精确报红。🔴 **它曾经只在**这台机器的工作树**里**（HEAD 里查不到那个迁移、
> 那个文件和那一列，生产库里该列计数 0、部署镜像 grep 0 —— 当时的原判"✅ 已落地"就是把
> "本机跑得通"读成"已交付"，2026-10-02 先撤回、再真的交付）：进库 `ad8d9222` + `31b6b1c3`，
> 部署见 deployment §3.8 第四次重建，判据是 `pnpm verify:consent-trail`（**14/14、退出码 0**）
> 加一条人工 L4（取证见 **G-32**）。
> 详见「链 3 —— 同意留痕要能记下"哪一版"」小节。它带出三条新缺口 **G-27 / G-28 / G-29**。
> ✅ **链 5 已落地**（2026-10-02）：首启隐私同意做成**真的闸门** —— 判定只有一份
> （`packages/app-host/src/privacy-consent.ts`），web 壳的四个出站口与移动壳的自动同步
> 都挡在它后面，
> 「不同意」是一个走得完的选项（只用本机 = 同一个完整产品），**闭合 G-11 / G-12**；
> 判据数的是**出站调用次数**，30 个变异臂全部被抓到。✅ **真浏览器那一层也补上了**（2026-10-02：
> `e2e/tests/privacy-consent-zero-egress.spec.ts` 7 条跑在**生产构建**上、已挂进 `pnpm check`，
> 而它当场抓出一条真缺陷 —— 闸门把 SW 注册推迟到 `load` 之后 ⇒ 生产构建里**再也不注册、且零报错**
> （§7 第 103 条）。🟡 只剩移动壳那半（模拟器截图）留在 **G-33**。
> 🔴 **§5 已列出 12 条需要拍板的事**（`D-01`–`D-12`）：
> 它们**不是缺口**，是决定 —— 每条都给了"没人拍就走这条"的默认值，所以本文件不因它们悬空而卡住任何工程。

---

## 0. 一句话结论

**工信部 APP 备案一个文本字段都不缺，缺文本卡的是备案之后的两道门。**

调研（[`../research/legal-filing-prerequisites.md`](../research/legal-filing-prerequisites.md) §1）实测推翻了那个流行假设：
"隐私政策 URL"**不是**备案表单字段。要求它的是**另一批规则** —— PIPL +
四部门《App 违法违规收集使用个人信息行为认定方法》+ Apple 中国区提审（必填）+ 安卓商店资质页。

所以真实的顺序是：

```
今天就能做完（纯写作 + 纯工程）           只能本人点一下            备案之后立刻要
──────────────────────────────           ──────────────           ─────────────────
九份对外文本（@heyta/legal）        →     勾选同意 + 提交审核   →   App Store 提审要隐私政策 URL
五处接线（页 /legal/*、勾选框、           （B1，全链唯一硬阻塞）      安卓商店要软著 + 备案号
同意留痕版本、同意闸门、投诉入口）                                  公安备案要"三个角色"归属
```

🔴 **在法务签字之前，这些文本一律是 `status: 'draft'`、不得对外发布。**
"写完了"和"能公开"是两件事，中间隔着 C1（执业律师复核）。本文件把这条纪律
编码进数据（`status` 字段 + 页面横幅），而不是写在一句嘱咐里。

---

## 1. 事实源在哪（写任何一句话前先查这张表）

| 文件 | 管什么 | 状态 |
|---|---|---|
| [`../research/legal-dataflow-server.md`](../research/legal-dataflow-server.md) | 服务端每列存什么、每次对外请求发什么、留多久 | ✅ A1–A10 + 政策撰写提示 |
| [`../research/legal-dataflow-client.md`](../research/legal-dataflow-client.md) | 各端本地存什么、明文还是密文、权限清单实际内容 | ✅ |
| [`../research/legal-dataflow-ai-rights.md`](../research/legal-dataflow-ai-rights.md) | AI 逐字段出境、权利实现到什么程度 | ✅ |
| [`../research/legal-pipl-baseline.md`](../research/legal-pipl-baseline.md) | PIPL 条款级必备内容、认定方法六类对照、三清单模板与放置位置 | ✅ §1–§6（尾部章节补全中） |
| [`../research/legal-filing-prerequisites.md`](../research/legal-filing-prerequisites.md) | 备案 → 提审的依赖顺序、动作编号 **A1–A11 / B1–B8 / C1–C8 / D** | ✅ |
| [`../research/legal-consumer-contract-terms.md`](../research/legal-consumer-contract-terms.md) | 格式条款、自动续费、退款、同意留痕 **层 0–层 6** | ✅ |

🔴 **全套文本里最容易写成虚假陈述的一条**（每个起草者都撞过一次）：
**端到端加密只覆盖同步通道，不覆盖本地存储。** 本地 SQLite / IndexedDB 里是**明文**
（`legal-dataflow-client.md` B12）。写成"你的数据始终加密"就是虚假陈述。

同类还有两条：不得写"服务端完全看不到任何数据"（11 项明文同步元数据）、
不得写"不与任何第三方共享"（四类对外请求）。三处的准确表述以对应研究文件为准。

---

## 2. 九份对外文本

**唯一事实源：`packages/legal`**（结构化数据，不是 Markdown）。注册表在
`packages/legal/src/index.ts`，schema 与"为什么不进 i18n"的论证在 `src/types.ts`。

| id | 文本 | 主要法定出处 | 落地页 URL | 备案表单必填 | 谁在等它 |
|---|---|---|---|---|---|
| `terms` | 用户协议 / 服务条款 | 民法典 496/497；消保法实施条例（2024-07-01） | `/legal/terms/` | ❌ 不收 | 安卓商店资质页、订阅纠纷处理基础 |
| `privacy` | 隐私政策 | PIPL 7/17/18/19；认定方法第二类 | `/legal/privacy/` | ❌ **不收**（本轮实测推翻的假设） | 🔴 **App Store 中国区必填 URL**、公安备案字段、算法备案拟公示 |
| `personal-info-list` | 个人信息收集清单 | 认定方法第一/二类；三清单模板见 baseline §5.2 A | `/legal/personal-info-list/` | ❌ 不收 | 应用商店检测逐项比对、备案"规则说明"一致性 |
| `permissions` | 应用权限清单 | 认定方法第二类第 3 项；必要信息范围规定第四条 | `/legal/permissions/` | ❌ 不收 | 同上（**唯一已完成的一份**） |
| `third-parties` | 第三方与共享清单 | PIPL 20/21/23；baseline §5.2 B | `/legal/third-parties/` | ❌ 不收 | 同上；HIBP / SMTP / 微信支付 / Web Push 四类要逐项 |
| `ai-and-transfer` | AI 功能与数据流向 | PIPL 55（影响评估）；生成式 AI 办法；深度合成规定 | `/legal/ai-and-transfer/` | ❌ 不收 | 🔴 算法备案拟公示内容、出境定性 |
| `minors` | 未成年人保护 | PIPL 28/31；未成年人网络保护条例 | `/legal/minors/` | ❌ 不收 | 苹果年龄分级、安卓商店 |
| `subscription-refund` | 订阅、计费与退款 | 互联网平台价格行为规则（2026-04-10）第 18/20 条 | `/legal/subscription-refund/` | ❌ 不收 | ¥5/$5 那档的争议处理基础 |
| `data-rights` | 个人权利行使与请求响应 | PIPL 44–50；认定方法第五类 | `/legal/data-rights/` | ❌ 不收 | 苹果审核问询、监管现场检查 |

🔴 **"备案表单必填"这一整列都是 ❌ —— 这不是好消息，是警告。**
它意味着**没有任何一道流程会替我们拦住"文本没写"**：备案能过、应用能上架、
而文本仍然缺席。要求它们的是**事后的**检查与投诉。所以"什么时候必须存在"
由**发布动作**决定，而发布动作是我们自己的手。

### 2.1 为什么文本住在 `@heyta/legal` 而不是 i18n，也不是 `docs/legal/*.md`

`legal-consumer-contract-terms.md` 层 0 当时建议 `docs/legal/*.md`。落地时改成了结构化 TS 包，
理由三条，其中两条是那篇文档自己列出的需求逼出来的：

1. **同意留痕要一个能写进数据库的版本号**（层 2 的 `documentVersion`）。Markdown + git 记录
   给不出"当前是哪一版"的运行时答案，要么手写常量（必然漂移），要么算哈希（要构建期清单）。
   包直接给 `legalSetVersion()`：`id@version` 排序拼接，**一套文本一个指纹**。
2. **三个消费面要同一份正文**：落地页、服务端对外页、应用内链接。放 `docs/` 则服务端读不到
   （`server/Dockerfile` 不打包 `docs/`，与 i18n / design-system 同一个约束，见
   [`../runbooks/deployment.md`](../runbooks/deployment.md) §3.9.2）。
3. **中英逐段对齐**在 Markdown 里没有任何闸门，在 TS 里可以用一条测试判红。
   🔴 代价说清楚：`check:ui-language` **不扫本包**（它扫各端的 `apps` 下的 `src`）。
   本包的闸门换成两样 —— 结构对账测试 + "每条断言要能指回 §1 某节"的纪律。

行内标记复用落地页的 `RichText`（`**粗**` 与 `` `代码` ``），**不新造第二种标记语言**，
因此也不需要第二个解析器和第二个渲染器。链接**故意不支持**：法务文本里的链接会随改版失效，
而"点了没反应的法律链接"与"没有链接"是同一类可达性缺陷 —— 指向同包另一份文件走 `docRef` 块，
`docId` 由注册表解析，目标不存在则测试判红。

---

## 3. 接线：五条链，缺一条就是"写了没人能读到"

### 链 1 —— 落地页 `/legal/<id>/`

✅ **2026-10-01 已上线**（下面每一条都已落地并有判据；写在这里是为了让后来者知道
"这一条已经不再是计划"）：

- 九条注册在 `apps/landing/src/site/pages.ts`（`group: 'legal'`、`inNav: false`、
  `inFooter: true`、`legalDocId`），页脚 legal 组因此出现。
- 组件 `apps/landing/src/pages/LegalDocumentPage.tsx`：**九份文本共用一个组件**，
  从 `legalDocumentById(id)` 读、按 `Locale` 取段落，块级 `switch` 覆盖
  `p|ul|ol|callout|docRef|table`，**未覆盖的 `kind` 抛错而不是静默丢内容** ——
  静默丢内容的后果是一句用户看得见的法律承诺**凭空消失**，而页面其余部分完全正常。
- 判据 `apps/landing/tests/legal-pages.spec.ts`（42 条）四个方向：清单 ↔ 注册表 ↔
  组件登记表 ↔ **投影进词条表的站点文案**，外加 URL 形状与"除这九条外没有页面带
  `legalDocId`"的负半边。
- 🔴 **这道判据被证明会失败**：`apps/landing/tests/mutate-legal-gate.mjs` 注入六个
  真实漏法（删一份 / `legalDocId` 拼错 / 改 `path` / `inFooter: false` /
  组件换成营销页 / 手改一条投影出来的词条），六个全部报红、每次还原后回到全绿，
  且 M6 那次改动**同时**让 `gen-site-copy.mjs --check` 报红（两处必须一起红）。
  这个脚本会临时改写工作树，所以它带了一道**并发写入闸门**：还原前比对磁盘字节，
  不一致就停手不覆盖（共享工作树里别人正在改同一批文件）。
- 门禁接线：`pnpm check:legal-copy`（`gen-site-copy.mjs --check`）已挂进根 `check` 链，
  位置紧跟 `check:docs-voice`。

站点结构由注册表派生，**加页面只改一处**（[`../adr/0033-multi-page-site-and-bidirectional-reachability.md`](../adr/0033-multi-page-site-and-bidirectional-reachability.md)）：

- 入口 HTML 与 sitemap 由 `gen:entries` 从注册表生成（本轮 73 份入口一致）；
  `check:entries` 是 `pnpm check` 的第一道门禁，漏生成会当场红。
- 🔴 **URL 必须永久稳定**：苹果的隐私政策 URL 会随下个版本发布，版本只能体现在
  **页面内容**里，不能体现在 URL 上（`legal-consumer-contract-terms.md` 层 1）。
  所以 `/legal/privacy/` 只有一条路径，历史版本另建 `/legal/changelog/`。
- `draft` 状态的文档要在页面上**显示"尚未生效"横幅** —— 让"没签字"这件事在 URL 可见，
  而不是靠人记得。

### 链 2 —— 注册勾选框指向真实文本

现状（实测）：两侧文案都是"我同意**该服务端**提供的服务条款与隐私政策"
（`web.auth.terms.label`、`mobile.auth.terms.label`；🔴 **按词条 key 引，行号会漂** ——
本表原来写的 `:525` / `:2132` 到本轮已漂到 `:536` / `:2147`），但——

| 端 | 文件 | 现状 | 要改成 |
|---|---|---|---|
| Web | `apps/web/src/features/auth/AuthPanel.tsx:306` | 🔴 标签是**纯文本，没有任何链接** | 渲染成两条链接；**且按用户所连的 baseUrl 决定指向哪一份** |
| 移动 | `apps/mobile/src/screens/AuthScreen.tsx:155,183` | 会阻断（未勾不让注册），但同样没有可读文本可达 | 同上 |

🔴 **"在应用里把 heyta 的条款显示成'该服务端的条款'，是替别人作出没有依据的承诺"** ——
这条顾虑成立，它约束的是**链接落点**（不许把官方文本冒充成别人实例的文本）。
但**"所以措辞不能改"那半句已被 §5 的 D-01 推翻**：`legal-consumer-contract-terms.md`
§7.3 给出的是第三条路 —— 按**角色**拆两层（账号与订阅协议永远由 heyta 发布并带版本，
同步服务按官方 / 自建 / 第三方三档写明运营者），既保住"不替别人承诺"，又消掉
"主体不确定的指代"。这是 G-22 同族的老毛病：**一条裁定只写在一个地方，两处就会互相指认对方错。**

工程含义：勾选框旁边的链接是**运行期的相对 URL**（`<baseUrl>/terms.html`、
`<baseUrl>/privacy.html`），**不是**落地页 URL；只有当 baseUrl 是官方托管域时才等价 ——
而那个等价关系恰好就是 D-09 要拍的东西。

#### 链 2 已落地（2026-10-01）

分流规则**只有一份**，住在 `packages/app-host/src/legal-links.ts` 的
`resolveLegalLinks(baseUrl, locale)`（AGENTS §3.5：哪份文本适用于这台服务端是**协议知识**，
四个壳各写一遍必然漂移）。壳里零协议知识：web 只渲染 `<a>`，移动壳只调 `Linking.openURL`。

| baseUrl | 两条链接落点 | 为什么 |
|---|---|---|
| 官方托管域（`hostFromServerUrl` **逐字相等**） | `https://heyta.waytofuture.cn[/en]/legal/{terms,privacy}/` | 那份必然是 heyta 署名的，且是**目录形带尾斜杠**的站点地址 |
| 其他任何 host（自建 / 第三方 / `127.0.0.1:3000`） | `<baseUrl>/terms.html`、`<baseUrl>/privacy.html` | 那台服务端**自己**发布的；没配 `PRIVACY_*` 就是 404，**不兜底回落地页** |
| 空 | 两条链接**不渲染**（勾选框照旧在） | 没有端点就没有"该服务端的条款"，不承诺读不到的东西 |

三处刻意的取舍，都值得记下来而不是重踩：

- 🔴 **不发任何探测请求**去问"这台服务端有没有 `/privacy.html`"（同意前不得发起请求，G-12 同族；
  而且探测会把"对方实例"这件事变成一次可被观测的出站行为）。
- **不用 `new URL`** —— Hermes 没有这个构造器，全仓 URL 处理一律纯字符串
  （先例：`packages/sync-client/src/server-url.ts`）。主机名提取抽成
  `hostFromServerUrl()` 并被 `classifyTransportSecurity` 复用，**同一个判断不许有两套答案**。
- **不 import `@heyta/legal`**：那会把六千余行的 AST 打进 RN bundle；
  壳只想要两个 URL。代价是官方域名常量出现两处（`@heyta/legal` 的 `OPERATOR.hostedDomain`
  与 app-host 的 `OFFICIAL_SITE_ORIGIN`），由 **`pnpm check:legal-host`** 逐字对账钉住
  （它还顺带查 `/legal/terms`、`/legal/privacy` 在落地页注册表里、以及服务端还在装那两个文件）。

判据分三层，每层都做过变异验证（`node scripts/mutate-legal-links-gate.mjs`，**4/4 被抓到**）：

| 层 | 文件 | 条数 | 抓什么 |
|---|---|---|---|
| 决策 | `packages/app-host/tests/legal-links.spec.ts` | 10 | 兄弟域名（`heyta.waytofuture.cn.evil.net`）、大小写、端口、userinfo、`/api` 后缀、`?lang=`、`en` 前缀、空地址 |
| 渲染 | `apps/web/tests/auth-panel.spec.tsx`（新增一组 7 条） | 7 | 两条 `<a>` 的地址/`target`/`rel`、**不在 `<label>` 里**、点链接不切换勾选、改地址即改落点 |
| 真浏览器 | `e2e/legal-links/legal-links.spec.ts` + `playwright.legal-links.config.ts` | 5 | **点得开**：新标签真的导航到那个地址、落地页真的渲染出 `h1`（含 `.lp-mask` 落位判据）、那台自建服务端真的答 **404** 而不是兜底 |

变异清单：M1 官方判定改前缀匹配 → 决策层红；M2 整块删链接 → 渲染层红；
M3 把链接移进 `<label>` → "点链接不切勾选"红；
M4 **把 host 比较整个拿掉**（一律按官方域处理）→ **真浏览器那一组红**。
M4 单独跑了一次 `pnpm` 重 build：改的是 `src/` 而浏览器加载的是 `dist/`，
不重 build 这个变异根本不生效（AGENTS §7 第 27 条同一种失效形态）。

截图（AGENTS §6.2 规定一，人已看）：`e2e/legal-links-results/legal-official-panel.png`、
`legal-official-terms-page.png`、`legal-official-privacy-page.png`、
`legal-other-server-404.png`（Chrome 的 JSON 视图里就是
`{"message":"Route GET:/privacy.html not found",…,"statusCode":404}`）、`legal-no-base-url.png`。

**没做的事**（不要读成做了）：措辞 `我同意该服务端提供的…` **一个字没动** —— 那是 D-01；
移动壳的链接**没做真机/模拟器验收**（G-26）；桌面四个壳里只有
**Windows** 会拿到这一组改动 —— 它的 WebView2 里跑的就是 `apps/web/dist`，
所以是**跟着产物过去**的，本轮没有在 Windows 上单独复验（固定收尾见 §6.1.1）；
macOS 原生壳是手写 UI、**根本没有注册面板**；鸿蒙壳未建。

### 链 3 —— 同意留痕要能记下"哪一版" ✅ **已进 `main`、已上线**（2026-10-01 实现；2026-10-02 交付）

🔴 **本节 2026-10-02 之前写的是"工作树里的代码，不是 `main`"**，那句话当时是对的（HEAD 里查不到
那个迁移、`legal-consent.ts` 与那一列），现在已不成立：进库 `ad8d9222`（实现 + 迁移 + schema +
判据）与 `31b6b1c3`（上一笔漏带的迁移数据库层证据），生产侧第四次重建见 deployment §3.8。
**留这一行是为了让"本机跑得通 ≠ 已交付"这个错法留下名字。** 判据：`pnpm verify:consent-trail`
四条自动腿 **14/14、退出码 0**，加一条人工 L4（取证见 **G-32**）。

按 `legal-consumer-contract-terms.md` **层 0–层 6** 执行，三处裁决与它们的落地形态：

- **不进同步实体** → ✅ 落在 `users.terms_document_version String?`（`server/prisma/schema.prisma:54`）。
  `CURRENT_SCHEMA_VERSION`、线协议、op-log **一个字没动**。
- **新字段一律可选**（AGENTS §3.3）→ ✅ 采**过渡形态**：一列存整套指纹，不是逐份建行。
  理由写进迁移文件头 —— 勾选时用户同意的是一**组**文件，逐份建行会让人以为可以只同意其中一份。
  独立 `UserConsent` 表留给层 4 的 A 档阻断确认（那需要同时定 kind 词表、通知与比对）。
- 🔴 **老账号不回填** → ✅ 迁移是**无默认值的可空列**（catalog-only，不重写表）。
  PGlite 证据钉在"存量行读出来必须是 NULL"这一侧：`server/tests/terms-version-migration.pglite.spec.ts` 5 条。

**唯一判决方**：`server/src/legal-consent.ts` 的 `consentedLegalSetVersion()` —— 只有
`PUBLIC_URL` 的 **hostname 逐字等于** `OPERATOR.hostedDomain` 才返回整套指纹，其余一律 `null`。
🔴 这不是洁癖：自托管机器对外发布的是运营者自己的 `terms.html` / `PRIVACY_*` 模板，
给那台机器上的记录盖上 heyta 的版本号 = **替别人宣告他发布了什么**（与 D-01 同一条错误，
只是这次写进了数据库，三年后它会被当成证据读）。

**三个写入口共用这一个判决方**（漏一条就会出现"某条路上注册的用户没有版本"）：
`server/src/auth.ts`（magic-link 注册 + 重发）、`server/src/passkey.ts`、
`server/src/password/service.ts`（委托给 `registerWithMagicLink`，所以自动同规则）。
🔴 **第三个入口是一个字都没提版本的**：它里面没有任何 `termsDocumentVersion`，
成对这件事**只由那条委托保证**（实测：`git grep -n consentedLegalSetVersion HEAD -- server/src`
只有 `auth.ts` 与 `passkey.ts` 两处直接调用）。所以它需要一条自己的判据 ——
"把委托换成自己建号"这种改动不会碰 `auth.ts` 里被钉住的那两行，
只有直接打第三个入口才会红（见下面判据那段），并在生产上实跑过一次（**G-32** 的 L4
走的就是邮箱+口令这条路）。
🔴 **时刻与版本必须成对**：没有 `termsAcceptedAt` 却单独写一列版本号，
是一条"没有同意时刻的同意记录"，比两列都空更误导人 —— 判据是那条"重发但没勾 ⇒
**两个 key 都不出现**"。

**生成物 + 门禁**（与 `copy.generated.ts` / `design.generated.ts` 同一套取向，
因为 `server/Dockerfile` 不打包 `@heyta/legal`）：`server/src/legal.generated.ts` 由
`server/scripts/gen-server-legal.mjs` 生成，`pnpm check:server-legal` 钉它与真源一致，
两者都挂进了 `pnpm check`。官方域名这件事从此有**两道互补的闸**：

| 闸 | 对的是 | 它**看不到**的 |
|---|---|---|
| `check:server-legal` | 生成物 ↔ `@heyta/legal` 当前产物 | `packages/app-host` 那份拷贝 |
| `check:legal-host` | `@heyta/legal` ↔ `app-host` ↔ `server` **三方**逐字 | —— |

🔴 所以第三份拷贝必须进 `check:legal-host`：只靠前一道闸时，`app-host` 那份改成别的域名
**两道闸会同时绿**，而那时用户点开的是 A 的文本、留痕里写的是 B 的版本 —— 正是留痕要防的失效。

**判据**：`server/tests/terms-consent-version.spec.ts` 14 条（官方域 ⇒ 指纹 / 别的域与 localhost
与坏 URL ⇒ `null` / 兄弟域名 ⇒ `false` / 大小写与端口与尾斜杠 / 没勾 ⇒ 两列都不写 /
指纹形状含 `terms@` / **第三个注册入口成对** / 同一条入口没勾 ⇒ 两列仍然都空）
+ `passkey.spec.ts` 新增 1 条（passkey 这条路也成对落库）
+ 上面那 5 条迁移证据。全量服务端 **103 文件 / 2007 passed / 1 skipped**（2026-10-02 实测）。

**三次变异（都是当场改源码、跑完立刻还原）**：

| 注入 | 结果 |
|---|---|
| `isOfficialHostedInstance` 的 `===` 改成 `.includes()` | 🔴 **恰好 1 红**：「兄弟域名不算官方：逐字相等，不是前缀或 includes」 |
| `consentedLegalSetVersion()` 恒返回指纹（拿掉判决） | 🔴 **3 红**：「别的域名 ⇒ null」「localhost / 缺失 / 坏掉的 URL ⇒ null（fail-closed）」「勾了 + 自建实例 ⇒ 只有时间，版本是 null」 |
| `registerWithEmailPassword` 委托时**不传**同意时刻 | 🔴 **恰好 1 红**：「第三个注册入口（邮箱+口令）也成对 —— 它靠委托，不靠自己也写一遍」。前两条变异都抓不到这一种失效，因为它们打在 `auth.ts` 与判决方身上，而这条路的问题在**委托断掉** |

⚠️ 变异还原时踩到自己写的坑：`perl -0pi -e 's/    undefined,\n/…/'` 把 6 空格缩进的那行
当成了匹配目标（`"      undefined,"` 里包含 `"    undefined,"` 这个子串），于是**还原到了
错误的行** —— 靠"提交前逐文件比对磁盘 blob == HEAD blob"才发现并精确改回。
判据：**还原要按 md5 验收，不能按"命令退出码 0"验收**（§7 第 105 条）。

后台侧：`admin.routes.ts` 的 `select` 与投影带上这两列（`2e6f87f7`），`admin-client` 类型同步。
🔴 **界面那一半还没进库**：`apps/web/src/features/admin/AdminPanel.tsx:334` 的
`data-testid="admin-user-consent"` 与 4 条中英词条此刻与另一批改版的 hunk 混在同一份文件里，
不拆开提（拆开就是把别人的中间态提交成"已完成"）⇒ 登记为 **G-36**。
⚠️ 投影里**不许**出现 `passwordHash` —— 那条白名单判据是后台既有的，本轮没放松。

### 链 4 —— 投诉举报入口（动作 A3，不是文本）

`legal-filing-prerequisites.md` A3 实测：四查里 heyta **代码 / 配置 / 入口三项全无**。
链 1–3 做得再好也补不了这一条，它要的是**一个真实接收地址 + 一条路由 + 用户可见的页面**。
本轮交付到"文本里承诺了渠道与 15 个工作日"，页面与路由列为缺口 **G-02**。

### 链 5 —— 首启同意闸门：决定之前一个请求都不发 ✅ **已落地**（2026-10-02，闭合 **G-11 / G-12**）

链 1–3 管的是"写了用户读得到、同意了记得下哪一版"，这一条管的是更前一步：
**那份决定得先真的拦得住出站行为**。它此前是全计划里唯一一处"文本承诺了、代码没有"的
反向缺口 —— 隐私政策第 12 条写着"同意之前不发请求"，而 `main.tsx` 在用户还没看到
任何界面时就把 Service Worker 注册掉了。

**闸门是共享的，壳里没有判定**。`packages/app-host/src/privacy-consent.ts` 是唯一判决方
（纯逻辑 + 持久化，`PRIVACY_CONSENT_KEY = 'privacy.consent'`；对外只有
`current() / networkAllowed() / undecided() / decide() / revoke()` 这几个动作），
两个壳的带闸 fetch 由 `createConsentGatedFetch(() => privacyConsent.networkAllowed(), …)`
装配 —— 按 AGENTS §3.5，"能不能发请求"是产品语义，不许出现在 `apps/`。

| 出口 | 闸在哪 | 谁拦的 |
|---|---|---|
| HTTP `fetch` | `apps/web/src/features/privacy/consent-gate.ts`（带闸 fetch，进程级 + 注入两处） | 没同意 ⇒ 请求根本不出栈，抛 `PrivacyConsentBlockedError`（marker `privacy-consent-not-granted`），界面显示 `*.error.consentRequired` |
| `WebSocket` | `apps/web/src/features/sync/store.ts` 的 `restartRealtime()`（全仓唯一构造点） | 建连之前重新查一次；撤回时**当场关掉**已建立的连接 |
| `serviceWorker.register()` | `apps/web/src/features/privacy/startup-network.ts` | 没同意就不调它。这一步**不可逆**（注册了就一直在），所以"每次启动最多一次"的守卫只给它 |
| 采用待消费的登录（会发请求） | 同上文件的 `holdPendingLogin`（"收"与"用"分离） | 收到但不消费，同意之后才用 |
| 注册 / 登录 / 未读数拉取 | `packages/app-host/src/hosted-auth.ts` 走的就是那把带闸 fetch | 闸门抛 `PrivacyConsentBlockedError` ⇒ 映射成 `failure('consent-required')`，界面显示 `common.auth.error.consentRequired`。**不会因为换了入口就能绕过去** |
| 移动壳的自动同步与实时通道 | `apps/mobile/src/sync/auto-sync.ts` + `apps/mobile/src/privacy/{startup,consent-gate,consent-ui}.ts` | `startAutoSync()` 内部门 + **订阅同意变化**（点了同意不必重启才起连） |

五裁决，每条都有反例撑着：

1. 🔴 **词表是封闭的两值**（`accepted` / `local-only`）。读侧严格判定：读不到、存的是表外值、
   存储整个不可用 ⇒ 一律按"没同意"。`null`（没问过）与 `local-only`（明确不同意）在
   "能不能发请求"这一问上**同一个答案**，但在"要不要再问一次"上不是 —— 所以拒绝对外
   不联网、对内不再反复弹窗，两件事不能混成一个布尔值。
2. **`local-only` 是一个完整的决定，不是降级模式**。它之所以能这么写，是因为 heyta 本地优先
   是架构事实：新建、编辑、日历、四象限、番茄钟、习惯、导出一个都不少。少了这个前提，
   面板上那句"一个都不少"就是假话 —— 这也是 PIPL 第 16 条"不得因拒绝处理而拒绝提供服务"
   在这里唯一可满足的形状。
3. **撤回 = 清回"还没问过"，不是记成"不同意"**。撤回之后界面重新问一次；
   把撤回写成 `local-only` 会让人永远看不到那个面板。
4. **关掉不等于同意**：Esc 与点 X 收起面板，磁盘上**一条记录都不许多**，下次冷启动再问。
   点背景（遮罩）**不许**关闭 —— 同意不能靠点空白处作出。
5. 🔴 **决定没能落盘时必须说出口**（`persisted:false`）。隐私模式下 `localStorage` 会静默
   不落地；这种情况下 `store.ts` **不收起面板**，把两个决定按钮换成一个确认出口 ——
   此前这里是坏的：警告写在面板里，而面板在同一次点击里就收起了，那句话永远不会出现。

**与链 3 的边界（不要读成"同意留痕做完了"）**：面板上那个决定**只记在本机**，没有服务器副本，
因此**说不出它对应哪一版文本** —— 所以界面与文本里都不许给它编一个版本号。
带整套指纹（`legalSetVersion()`）的那笔留痕来自**注册时的勾选**，且只有官方托管实例写得出来
（链 3 的 `consentedLegalSetVersion()`）。这是两笔记录，隐私政策第 12 条现在按两笔写。

**判据**（**99 条单测级 + 7 条真浏览器 = 106 条**，全部能失败）：

| 层 | 文件 | 条数 | 抓什么 |
|---|---|---|---|
| 决策 | `packages/app-host/tests/privacy-consent.spec.ts` | 26 | 词表两值 / 表外值与损坏与存储不可用一律 fail-closed / 撤回清回 `null` / **数的是出站调用次数**，不是"有没有抛错" / `formatPrivacyDecisionTime` 不许用 `Intl` |
| Web 壳 | `consent-gate.spec.ts` + `privacy-consent-sheet.spec.tsx` + `startup-network.spec.ts` + `pwa-register-readystate.spec.ts` | 8 + 17 + 9 + 4 | 带闸 `fetch` 未同意时一次都不放行；两个按钮管的确实是那一道闸；Esc / X / 点背景三种关法都不产生记录；`persisted:false` 时面板不收起；**注册 SW / 采用登录 / 建实时连接三步在同意之前各被调 0 次**；注册对"什么时候被调"免疫（§7 第 103 条） |
| 真浏览器（**生产构建**）| `e2e/tests/privacy-consent-zero-egress.spec.ts` | 7 | 首启面板出现之前：出站清单为空、`getRegistration()` 为 `null`、无记录；点「同意并联网」之后**同一个量翻过来**（正向对照）；预置「已同意」冷启动 ⇒ 当场注册；X / Esc 不产生记录且下次冷启动仍问；点遮罩不关面板；条款链接只是字符串 |
| 移动壳 | `apps/mobile/tests/privacy-consent-gate.spec.ts` | 35 | 同一道闸在 RN 侧的形状（含 `Linking` 与冷启动顺序） |

**变异验证：`node scripts/mutate-privacy-consent-gate.mjs` ⇒ 30 个臂全部被抓到**
（M1–M8 决策层 / W1–W6 Web 壳 / R1–R16 移动壳），每个臂只改一处源码、跑完按 md5 还原。
其中最有价值的三个：把"未同意"判成 `!== 'local-only'`（反向判定）、把词表校验拿掉
（表外值被当成同意）、把决定时间改用 `Intl`（Hermes 上 `Intl` 可能整个不存在 ⇒
抛在设置页 = 那一页打不开）。

真浏览器那一层**不做源码变异**（一轮要重打产物，太慢），它的反证是**结构性**的：
每条"零"都配一条"同一个可观测量在同意之后不为零"的对照臂，而那两臂在 §7 第 103 条
那次真缺陷上**实测各红一次** —— 也就是"能失败"这件事不是推的，是发生过的。

**词条**：`common.privacy.consent.*` 14 条 + `common.privacy.settings.*` 8 条，
**中英同批**（各 22 条），另有 `common.sync.error.consentRequired` 与
`common.auth.error.consentRequired` 两条错误态；`check:ui-language` 覆盖。

**法务文本跟着事实改**（不留假话）：`privacy@1.1`（第 10 条补这一项自己的撤回入口与它
撤回时实际发生的事、第 12 条拆成两笔留痕、"默认关"改成"默认没有同意这回事"）、
`data-rights@1.1`（第六节闸门表把「联网同意」列为**第一行**）、
`minors@1.1`（第四节"在线状态"那行的前提从"开启同步后"改成"同意联网并且开启同步后"）。
三份都带 2026-10-02 的改版行，理由写的是**代码变了**而不是措辞变了。
⇒ `legalSetVersion()` 指纹变，两份生成物已重跑，`check:legal-copy` / `check:server-legal` /
`check:legal-host` 与 `pnpm --filter @heyta/legal test`（中英逐段结构对账）全绿。

🔴 **真浏览器那一层（2026-10-02 补，G-33 的 web 半边）**：`e2e/tests/privacy-consent-zero-egress.spec.ts`
7 条，跑在**生产构建**（`vite preview` + `apps/web/dist`）上，入口是 `pnpm check:privacy-consent-e2e`
（已挂进 `pnpm check`），它**先重打产物再跑** —— 因为"门禁绿 ≠ 装/测的是当前产物"（§7 元规则 3）。
为什么必须是生产构建：`register.ts` 在 dev 下**早退**，而 jsdom 根本没有 service worker，
所以"同意之前 SW 那条口开没开"这句话在单测里**数不到**。🟡 **移动壳那 35 条仍没有模拟器截图**
（AGENTS §6.2 规定一）⇒ 留在 **G-33**。
覆盖写清楚：带闸 fetch 与首启面板接在**web 壳与移动壳各一处**。**macOS 与 Windows 两个原生壳**
把同一份 `apps/web/dist` 装进包里加载（mac 是 `Contents/Resources/web-dist` + WKWebView，
Windows 是 web-dist + WebView2），因此走的是 web 那道闸；🔴 **Linux 壳不是** —— 它是手写 GTK
界面、不加载共享 UI，而它唯一的 JS 入口 `packages/app-host/src/native-bridge.ts` **一个出站能力
都没有**（全文件无 `fetch` / 无 `WebSocket`，只有本地读写与 op-log 消息），所以那里
"同意前零请求"是**结构上成立**而不是被闸门挡住的 —— 但也因此**没有首启面板可弹**；
`apps/node-host` 是开发用 CLI、不是用户端，本轮**没有**为它接闸。
⇒ 缺的那份（**移动壳界面取证**）登记为 **G-33**。web 侧现在**可以**写"真浏览器实测"，
移动侧**不许**。

---

## 4. 缺口登记（编号只增不改）

🔴 **规则：每条要么有"谁解 + 怎么解"，要么有"为什么现在解不了"。空着的编号比没有编号更糟。**

| 号 | 缺口 | 卡谁 | 谁能解 | 本轮怎么办 |
|---|---|---|---|---|
| **G-01** | 九份文本全部 `status: 'draft'`，**未经执业律师复核不得对外**（动作 C1） | 所有发布动作 | 中国执业律师 | 页面上显示"尚未生效"横幅；`draftDocumentIds()` 可枚举 |
| **G-02** | 应用内**没有投诉/举报/反馈入口**（A3 四查缺三项） | 公安备案字段、算法自评估的作答诚实性 | 工程 + 一个真实接收地址 | 文本先写邮箱 `heyta@waytofuture.cn`；页面与路由本轮不做 |
| **G-03** | **"15 个工作日内答复"是承诺，不是事实** —— 目前没有受理流程 | 写了就得兑现 | 产品负责人拍板 | 文本按 15 写；改数字只改一处 |
| **G-04** | **App 备案号尚未核准** | 链 1 页脚展示、提审 | 等管局（C4，≤20 工作日） | `OPERATOR.appFilingNumber = null`，**文本里不出现具体编号** |
| **G-05** | 公安备案"30 日"从哪天起算**未核实**，而该时限可能已在跑（域名 9-30 已切） | 公安备案是否要写情况说明 | 本人提交时当面问（B3） | 不猜 |
| **G-06** | 算法备案材料：自评估六章正文槽位、拟公示 6 行、**DeepSeek 协议缺**（C2） | 算法备案第二步 | A4 写作 + C2 补签 | 起草 `ai-and-transfer` 时不宣称已备案 |
| **G-07** | ~~ASC 账号级协议 **403**（`REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`），全部 API 不可用~~ ✅ **已不成立（2026-10-01 直接复测推翻）**：`asc apps list` / `certificates list --paginate` / `builds list` 三条**全部返回真数据**（8 张证书、1 个构建）。当年那条 403 是**账号级协议**未接受时的形态，现在协议状态已不是那个 | Apple 侧一切操作（原判定"全阻塞"） | —— | 结论改写成"可用"，并按它取了苹果备案的四个值（见 `docs/runbooks/icp-app-filing.md` §一 后「苹果备案取值」）。📌 留原文是为了记住这条的**保质期**：它曾是"Apple 侧什么都做不了"的唯一依据，而推翻它只需要跑一次 `asc apps list` —— **旧结论里"不能"的断言，复测成本要先算**（§7 元规则 1） |
| **G-08** | 🔴 **界面上没有注销账号入口**，而服务端 `DELETE /api/account` 是真实硬删除 | 苹果审核（账号删除是硬性要求）、PIPL 删除权 | 工程 | 文本写"通过邮件申请注销"，**不把不存在的按钮写成存在** |
| **G-09** | 移动端**没有导入入口**（导出三端都有） | 可携带权的完整度 | 工程 | `data-rights` 如实写明这一限制 |
| **G-10** | 邮箱**不可更换**（没有换绑能力） | 更正权的完整度 | 工程 | `personal-info-list` / `data-rights` 如实写 |
| **G-11** | 首次启动**未弹隐私政策**（baseline §2.7「现在就会被判红的 7 条」之一） | ✅ **已闭合（2026-10-02，链 5）**：首启面板在 web 壳与移动壳各有一处，两个并排同等可达的动作「同意并联网」/「只用本机」+ 一个不算决定的「以后再说」 | —— | 机制、判据与词条见 §3 链 5。✅ web 侧界面取证已做（真浏览器 3 张截图，人已看过）；移动壳那半 ⇒ **G-33**；"认定方法"第一类第 2 项要的"4 次点击内可达"另有一条既有的隐私政策入口链（链 2），本轮没动 |
| **G-12** | **同意前不得发起任何请求**：Service Worker 注册与自动同步目前在同意之前发生（同上第 5 条） | ✅ **已闭合（2026-10-02，链 5）**：四个出站口（`fetch` / `WebSocket` / `serviceWorker.register()` / 待消费登录的采用）各自有一道闸，移动壳 `startAutoSync()` 同一道 | —— | 判据是**数出站调用次数**（未同意必须数出 0），不是"有没有报错"；30 个变异臂全部被抓到。✅ 真浏览器那条计数判据已补（7 条、生产构建、进 `pnpm check`；它抓出并修掉一条"生产构建里 SW 从不注册"的真缺陷，§7 第 103 条）。🟡 移动壳截图仍缺 ⇒ **G-33** |
| **G-13** | 生产服务端 `PRIVACY_*` 配置 **0 条** ⇒ `/privacy.html`、`/terms.html` 双双 404；且 `isConsentRequired` 为 `false` ⇒ **服务端今天根本不强制同意** | 链 2 的落点 | 发布（deployment §3.11） | 保持 404 —— 那是**诚实的失败**；发布要等 G-01 |
| **G-14** | `server/templates/privacy.template.html` 是**英文 / GDPR 体裁 / 上游品牌**，与我们的文本不是一套 | 自建实例拿到的第一份政策 | 工程（重做模板）或明确边界 | 本轮不改模板，登记为"待重做" |
| **G-15** | 仓库既有文档引的《网络安全法》是**旧条号**（2025-10-28 修正、2026-01-01 施行：21→23、24→26） | 对外文本写错条号 = 暴露是旧模板抄的 | 动作 A11 | 新文本一律用现行条号 |
| **G-16** | 落地页英雄区（`landing.privacy.*`）与产品文档（`site.docs.privacy.*`）关于加密的表述**互相矛盾**，且**没有任何门禁覆盖**（`check:claims` 的举证半边 2026-09-29 已退役） | 强承诺被稀释 | 工程（把两处都指向 `@heyta/legal` 的同一事实） | 登记；本轮先不动营销文案 |
| **G-17** | `check:server-copy` 当前红：`server/src/copy.generated.ts` 缺 `server.email.reset.*` / `passwordChanged.*` | `pnpm check` 全绿 | **另一个在飞的会话**（`server/src/password/recovery.ts` 未跟踪） | 🔴 不去"顺手修红" —— 那是别人的生产者 |
| **G-18** | 结构对账测试 `packages/legal/tests/structure.spec.ts` 尚未跑过（九份文本没齐） | 中英漂移没有闸门 | 本轮 | 测试与文本同批交付 |
| **G-19** | 退款政策（7 日全额 / 按比例 / 7 个工作日处理）**是草稿提案**，含税与否亦待确认 | 对外收费 | 法务 + 财务 | 沿用 `server/legal/terms-of-service.heyta.md` 的数字，**不新造** |
| **G-20** | 软著与"AI 辅助编码"的申报口径冲突（§4 那个分叉），唯一解法是**问清窗口**（B8） | 安卓商店上架 | 本人 | 不猜、不润色绕过 |
| **G-21** | 🔴 **PIPL 第 55 条的 PIA（个人信息保护影响评估）一份都没有**，而它**不等算法备案** —— 法条时点是"事前"，而同步与 AI 功能**已经在跑**（台账里 `registeredNonBannedAccountCount = 8`）。baseline §8.3 第 2 条明确点名：**G-06 追的是算法自评估正文与拟公示内容，不含 PIA**，两者不能共用一个缺口号 | 认定方法第五类、算法自评估里"个人信息保护"那一段的举证来源 | 工程 + 运营（按 baseline §8.2 的四份分别产出，落 `docs/compliance/pia/`） | 本轮只登记；⚠️ PIA-2（AI 出境）要先证"出境确实发生"——按 ADR-0021 平台侧 provider 是**境内主体**，所以那份评估的前提 today 不成立，要拆成"前提 + 条件成立时"两段写 |
| **G-22** | 同一块内容被**两道合规门禁判成相反结论**：`check:docs-voice` 按 2026-10-01 的产品裁定把自托管篇整篇豁免，而 2026-09-30 立的公页语域闸 `public-copy-register` 不知道有豁免，于是 `selfhost / zh-CN`、`selfhost / en` 判红、整条 `pnpm check` 带着红 —— 症状是"内容合规门禁在拦一份被裁定为合规的内容" | ✅ **本轮已闭合** | —— | 豁免判据抽成**唯一一份** `scripts/selfhost-voice.mjs`（词条 key 形状 + 页面 id 形状两个入口），两道闸都从这里取；防呆断言钉住"豁免区恰好是 `['selfhost']` 且这个 id 真在注册表里"。变异验证：`selfhostt`（不存在的 id）与 `['selfhost','features']`（范围被扩大）**两种注入都报红**，还原后回到全绿。🟡 遗留：平台页与集成页的自托管段在**词条侧豁免、页面侧不豁免**，这是刻意比词条闸更严（理由写在模块头），不是漏网 |
| **G-23** | 法律文本里残留**贡献者语气标记**：九份文档渲染出来的字符串里共 **190 处** 🔴/✅/❌/⚠️/🟡（🔴 132、❌ 22、⚠️ 16、✅ 14、🟡 6，2634 条字符串实测计数）。这些记号在本仓库是"这条最关键"的编辑批注，出现在对外法律页面上则是**内部工作语言泄漏** —— 与 G-15/G-16 同族，但**没有任何一道闸覆盖**：`public-copy-register` 的词表拦的是工具链名词，不含记号 | 对外文本的读感与可信度（用户会问"这个红圈是什么意思"） | 工程（一次批量改写 + 把"标记不进对外文本"做成判据） | 本轮**不动 190 处**：那是逐段语义判断，不是查找替换；登记编号与口径，改法与验证一起做。✅ **同族的另一例本轮被抓到并当场修掉**（2026-10-02）：给隐私政策补"修订记录"时把内部缺口编号与仓库路径写进了对外正文，`public-copy-register` 的「公页不许说贡献者语言」两条（`legal-privacy / zh-CN`、`/ en`）**判红** —— 那道闸拦得住"路径 / 编号"这一形状，只是拦不住记号。修法在**源**不在测试：privacy / data-rights / minors 三份共六处去掉编号与路径，重跑两个生成器 + `@heyta/i18n` build，`check:legal-copy` / `check:server-legal` / `check:legal-host` / `check:entries` 与 legal 57、landing 1303 全绿 |
| **G-24** | 🔴 **隐私政策把 App 备案号的权威公布位置指向了两个不发布它的地方**：`privacy.ts:109` 逐字写"**App 备案号以应用内「关于」页与服务端对外页公布者为准**"，而全仓检索显示 ICP 类编号只出现在 `@heyta/legal` 的正文、它的测试与 `docs/runbooks/icp-app-filing.md` 里 —— web 侧最接近的面板是「帮助与关于」（`web.about.title`），里面**没有任何备案信息**；服务端对外页今天根本没有 `PRIVACY_*`（G-13） | 核准那天这句话就变成假话：把权威指向一个不发布的页面，等于"哪儿都没有" | 工程（选一个展示位并实现）+ 产品（选哪个位，见 **D-11**） | 现在**不印编号是对的**（`structure.spec.ts:292` 那条判据钉住"未核准不许出现编号"，且 `mutate-gate.mjs:53` 已验证塞一个假编号会红）；本轮改不了指向，因为展示位还不存在 —— 登记，随 D-11 一起解 |
| **G-25** | 🔴 **官方域的 `/legal/*` 还没发布**：那批页面目前只在工作树里（`apps/landing/legal/`、`apps/landing/en/legal/` 未提交、未部署）。线上实测（2026-10-01，`curl`）`/legal/terms/` 与 `/legal/privacy/` 回 **200 + 落地页首页外壳**（`<title>heyta：本地优先的任务管理…`，正文里"隐私政策"**0 次**）—— nginx 的 SPA 兜底把一个**不存在的路径**答成了一次成功。链 2 的真浏览器验收因此只能把官方域那一侧**转发到本地构建产物**（理由写在 `e2e/playwright.legal-links.config.ts` 文件头） | 用户在官方实例上点《隐私政策》，今天读到的是首页 —— 比 404 更糟，因为它**看起来像成功**；Apple 3.1.1 与备案材料都要求这个链接可达 | 发布（部署落地页构建）+ 工程（部署后删掉那条转发，让验收直连线上） | ✅ **"没发布"这一半已闭合**（2026-10-01）：批次进库 `2dac3fa3` → 干净检出重建产物 → 发布 → 线上判据。判据不是 `curl` 而是新增的 **`e2e/live-site/live-legal.spec.ts`（10 条真浏览器，10 passed）**：九份 × 中英各自的 `<html lang>`、每页一个 `h1`、顶层小节数==目录数、**中英小节数与版本号/日期两侧相等**、"尚未生效"横幅在，第一条是**字节必须与首页不同**。变异验证：`/legal/terms-typo/` 精确红在"与首页完全相同"。截图两张人已看过。**转发没删，理由换了**：链 2 判的是"代码把点击带到哪"，必须离线；线上字节改由上面那条套件直连真服务器（见其配置头） |
| **G-25b** ✅ **已闭合**（2026-10-02） | 原事实：nginx 的 SPA 兜底把不存在的 `/legal/*` 答成 **200 + 首页字节**。2026-10-01 实测 `/legal/nope-not-a-doc/` 返回 200、**7022 字节与中文首页逐字相同**，`/en/legal/nope-not-a-doc/` 同理（6976 = 英文首页） | 搜索引擎把软 404 当正常页收录；用户转错一个字母得到首页而没有任何提示；备案与 Apple 材料里"政策链接可达"这句话的强度取决于**这一半** | 运维（nginx） | ✅ **已改**：在 `heyta.waytofuture.cn` 的站点配置里加了两条 prefix location（`/legal/`、`/en/legal/`），`try_files $uri $uri/ =404` —— 保留 `$uri/` 是因为那 18 个入口是**磁盘上的真实目录**，去掉它会把好页也变 404。线上复验：两条未命中各 **404 / 162 字节**；18 份真实入口仍全 200 且 title 各异；`/`、`/en/`、`/app/`、`/app/nope-route`、`/health`、`/robots.txt` **逐字节未受影响**（⇒ 前端路由的兜底没被牵连）。改动前备份：`/etc/nginx/sites-available/heyta.waytofuture.cn.bak-g25b-20261001T165913Z`，回滚 = 覆盖回去 + `nginx -t` + `systemctl reload nginx`。**判据**：`live-legal.spec.ts` **第 12 条**（含"未命中 404"、"404 的字节不是首页"、"同层未知路径仍 200"的阳性对照、"`/app/nope-route` 仍 200"、"注册表 id 逐条被取到"的清单漂移对照五层），**两个变异臂精确报红**：把 404 断言改成 200 ⇒ 红在 G-25b 那句；把阳性对照换成 `/legal/` 那条 ⇒ 红在"整站都在 404"那句。⚠️ **两条边界**：① 裸 `/legal/` 仍 **403**（目录无 index.html 且列表关闭，那是诚实回答而非假成功，**刻意不改**）；② 回滚站点 `heyta.finlaw.cloud` 的配置**没动**（它本来就真 404）。🔴 这一轮查出新缺口 **G-35**：404 现在是真的，但答的是 nginx 裸默认页 |
| **G-26** | 移动壳的条款链接（`apps/mobile/src/screens/AuthScreen.tsx` 的 `Pressable` + `Linking.openURL`）**只过了类型检查，没有真机/模拟器验收**。打开失败时的可见文案 `mobile.auth.link.unopenable` 是**推演出来的**，不是实测的 | 移动端是备案材料里"应用内可读到政策"那一条的主要载体 | 工程（`verify:mobile-*` 加一步点条款链接 → 系统浏览器真的起来） | 刻意**没有**用 `canOpenURL()` 做预检：iOS 13+ 未登记 `LSApplicationQueriesSchemes` 时它恒为 `false`，那会让一个**由 Info.plist 决定的假红**替用户判断"能不能打开"。真机验收没做，所以这条挂着 |
| **G-27** | 🔴 **补签流程在整个仓库里不存在**。链 3 交付的纪律是"老账号一律 `null`、不许回填"，而 `null` 那批账号的定义就是"无法证明他同意的是哪一版"—— 要把它变成可证明，需要**登录后置顶 + A 档式阻断确认**（形态在 `legal-consumer-contract-terms.md` 层 3 那句"补签流程"里）。现在既没有重新提示的路由，也没有同意历史表 | 版本一 bump（`terms@1.1`）之后，`null` 那批人新同意的是哪一版就说不清了 | 工程（置顶 + 阻断确认）+ 产品（**D-04** 那一档 A/B/C 的提示形态与公示天数） | 本轮**只登记，不做机制**：线上今天有 10 个账号，但**全部是本仓库自己跑注册旅程留下的测试账号**（`select count(*) from users` = 10，2026-10-01 只读实测），没有任何外部用户；而且它们**连"同意过哪一版"都没被记下**（生产服务端仍是链 3 之前的版本，见 **G-32**）。⇒ 补签的对象数量对**外部用户**是 0，做出来无法验收；⚠️ 但它**必须赶在第一次文本改版之前**落地 —— 那时才第一次有"版本对不上的人"。 |
| **G-28** | 同意记录里**没有"来自哪个端"**这一项。§6 第 5 条原本把这句话写进了验收标准，实际**九份文本没有任何一处承诺记来源端**（`privacy.ts` 第 12 条逐字只承诺"同意时刻 + 那一套文件的版本号"） | 若将来要按端区分同意（例如移动端与 Web 的勾选文案不同），现有留痕答不了 | 法务（先改文本）→ 工程（再加列） | 判据里那句"来自哪个端"**已从 §6 删掉**（不是没做，是不该按它验收）。🔴 要真记：**先改 `personal-info-list` 表 C 与 `privacy.ts` 第 12 条并 bump 版本**，再按 `privacy.ts:533` 那条"采集**种类**变化必须有一次独立的重新提示"取一次新同意 —— 顺序反了就是先采集后告知 |
| **G-29** | 链 2 / 链 3 的改动只到**库与产物层**：`packages/app-host/dist` 与 `server/src/*` 是新的，但**四个端的安装包没有重打、没有重装**（AGENTS §6.1.1 的固定收尾没跑） | 手机/桌面里现在装着的仍是**改动前的 JS**，"移动端链接可用"这类结论对旧产物成立与否无从判断 | 本人执行 `pnpm reinstall:all`（会起模拟器与远端 Windows） | 本轮**不跑**：`reinstall:all` 会清掉并重装四端、且会把并行会话在飞的半成品一起装上去（本项目已知碰撞面）。📌 与 §7 第 27 条同一种失效：`packages/` 改了而壳里是旧 bundle，**门禁全绿也照不出来** |
| **G-30** | 🔴 **Apple 开发者账号的实名主体与备案主体不是同一个法人**：签发苹果发布证书（`2R8LJZ6Q36`）的 Team `V5S2LT9YV8` 主体是「Xiaoli Creativity Culture Industry Development (**beijing**) Co., Ltd.」（= SSOS 那家北京公司），而备案主体是「晓黎（**杭州**）人工智能科技有限公司」。对照：华为侧 heyta 用的是**杭州**账号（§四 已核），安卓签名证书 subject 也是 `L=Hangzhou` —— **三个渠道里只有苹果落在北京主体上** | 苹果中国区提审要求填 App 备案号；备案号的主办者是杭州公司，而渠道运营者是北京公司 —— 若管局或 Apple 核验渠道主体，这是**说不清的那一环** | 产品负责人（要么用杭州主体新注册 Apple 开发者账号并迁 App/重签发布证书，要么确认"渠道主体不必与备案主体一致"后按现状提交） | **不猜、不自己拍**。已核清的是事实部分：表单四个字段（包名/公钥/SHA-1）不收 subject，所以**填表不会因为这条被打回**；未核清的是"管局审核与 Apple 中国区渠道核验会不会看主体一致性" —— 本轮没有查到任何成文依据，而**代办机构的口径不算依据**（D-01 那条裁决同样适用）。取值与四源对账记在 `docs/runbooks/icp-app-filing.md`「苹果备案取值」 |
| **G-31** ✅ **已闭合**（2026-10-02） | 原事实：`privacy.ts`、`third-parties.ts`、`subscription-refund.ts` 的英文栏都逐字并列着登记中文名「晓黎（杭州）人工智能科技有限公司」，而 `terms.ts` 的英文栏**只有**转写名 `Xiaoli (Hangzhou) Artificial Intelligence Technology Co., Ltd.` —— 九份里**唯一规定合同主体**的那一份恰恰没有它。现在英文栏 s1 与其余三份同口径：登记名在前、转写名在后，并写明"以登记的中文名称为准" | 判据分两层，两层都做过变异：① **库内** —— `structure.spec.ts` 新增一条**按栏取文**的闸门（英文栏凡引用信用代码处必须同时给出登记名称；`allTexts` 是两栏合并的，用它判"某一栏"会得到永远满足的假绿），并断言"至少有一份在引用"否则判据悬空。拿掉登记名称 ⇒ **恰好 1 红**，消息点名 `terms`。② **线上** —— `e2e/live-site/live-legal.spec.ts` 里唯一一条"本地真源 ↔ 线上"对照，参照物取自 `@heyta/legal` 的构建产物而不是抄字面量。两次变异（把线上产物整份复制到本地静态服务器、只改副本）：删登记名 ⇒ 红在①；版本退回 `1.0` ⇒ 红在②；复原后回绿 | 法务口径由产品负责人拍板（"中英两侧都要有登记主体名"）→ 工程改 `terms.ts` 英文栏 + 同批改判据 | 三步落地：`d606e605`（正文 + 按本文件自己的纪律 bump 到 **1.1**、`updatedDate` 2026-10-02、两栏版本记录表各加一行 + 库内闸门 + 自洽的 `LEGAL_SET_VERSION`）→ **增量发布**（`rsync -azc` **不带 `--delete`**，只推 `legal/`、`en/legal/`、`assets/`；那台机器上同时跑着另一条会话的站点产物，整站 `--delete` 会把他们的在制品从生产抹掉）→ `458a0f34`（线上判据，11 passed + 截图人已看过）。⚠️ 这次改版让 `legalSetVersion()` 的指纹变了一次，而生产**还没开始记版本号**（**G-32**）⇒ 没有人被记下"同意过 1.0"，这正是 G-32 要闭合的东西。🔴 **改版先落地、留痕后上线这个先后顺序是有代价的**：等 G-32 闭合（同日），第一条被记下版本的同意记录带的就是 `terms@1.1`，而**改版之前勾过框的那批人一个版本号都没有** —— 那是 G-27 补签要面对的真实对象，不是零。📌 顺带纠正 `i18n-multilingual.md` §7.15 那行"英文正文残留汉字 1 处"—— 实测 3 处，本次改版后是 4 处且**全部是刻意的** |
| **G-32** ✅ **已闭合**（2026-10-02：四条自动腿 14/14 退出码 0，L4 人工实跑） | 🔴 **链 3 的同意留痕在生产上一条都没生效**。🔴 **2026-10-02 复验：本行原先的前提是错的** —— 原写「仓库里有迁移 `20261006000000_add_terms_document_version`…链 3 的代码与判据都在库里，缺的**只有这一步部署**」，实测**不是**：`git ls-tree --name-only HEAD server/prisma/migrations/` 最新一条是 `20261005000000_invalidate_stored_auth_tokens`，**没有** `20261006` 那个目录；HEAD 的 `schema.prisma` 只有 `termsAcceptedAt`（第 43 行）**没有** `terms_document_version`；`git grep -c -i termsDocument HEAD -- server/src/auth.ts server/src/passkey.ts` = **0 命中**。⇒ 缺的不是"跑一次迁移"，而是**那条批次根本没进版本库**（见 **G-34**）。线上四项只读实测（2026-10-02）：`_prisma_migrations` 最新 `20261005000000_invalidate_stored_auth_tokens`（`finished_at` 2026-10-01 13:06:30Z）、`information_schema.columns` 里 `users.terms_document_version` 计数 **0**、部署镜像内 `grep -rl termsDocumentVersion dist | wc -l` = **0**、`select count(*) from users` = **10** | 线上今天这 10 个账号（全部是本仓库自己跑注册旅程留下的测试账号）点过的那个勾选框**没有任何一处记得"同意的是哪一版"** —— 生产仍在记 `termsAcceptedAt` 这个时间戳，但那一列在 HEAD 里根本不存在；§6 第 5 条"任一真实用户能答出版本号 + 确认时间"在生产上**无处可查** | ~~运维~~ → **那条批次的所有者**（先让链 3 进 `main`，见 **G-34**），之后才是 `sh scripts/migrate-deploy.sh` + 重建镜像（[`runbooks/deployment.md`](../runbooks/deployment.md) §3.8） | 🔴 **本轮不部署，且本轮结构上部署不了**：`deploy.sh` 与 `git archive HEAD` 只带**已跟踪**文件，未跟踪的 `legal-consent.ts` 与那个迁移目录**带不出去**；把工作树里别人在飞的半成品送上生产违反既定立场（与 G-25 那次「等那条批次提交后再发」同一条）。⚠️ 但**不能等到转 `effective` 那天再做**：注册页的勾选框今天就在让用户同意一份 draft 文本，而什么都没留下。📌 **探针修正（本轮踩到，是 §7 元规则一的形状）**：查 `_prisma_migrations` 用 `select name …` 会得 `ERROR: column "name" does not exist` —— 真实列名是 **`migration_name`**；那是**探针写错**，不是生产缺列，别把它读成结论。🔴 **2026-10-02：本行的结论从散文变成了一条命令** —— `pnpm verify:consent-trail`（`scripts/verify-consent-trail-production.mjs`）。四条自动腿 L0 版本库 / L1 生产库有列 / L2 已应用迁移 / L3 镜像里有代码，**退出码分五种**：`0`=全绿只剩 L4、**`2`=批次没进库（G-34，运维此刻无事可做）**、`3`=迁移没应用、`4`=镜像没重建、`1`=探针自己坏。本轮实测 **记账 8/14、退出码 2**，L0 三条红；每条判据配**独立于被测值**的阳性对照，实测值 `users.locale`=1、`users.terms_accepted_at`=1、`_prisma_migrations` 共 44 条且 `20261005000000_*` 命中 1、`/app/dist` 有 93 个 `.js`、`requireAdmin` 命中 3 个文件 ⇒ 目标列与目标符号的 **0** 是证据不是探针坏。`--self-test` **9/9 个变异臂会红**，且自检当场抓出我自己写错的三处：① 拿 camelCase 去查 `information_schema` 会**永远**得 0（库里的列是 snake_case，JS 字段才是 camelCase —— 一条永远红的假判据恰好和结论一致，最危险）；② **SQL 的 `case when` 挡不住不存在的列**，PostgreSQL 在解析期就拒绝那个分支，只能用 shell 的 `if` 分两次查；③ 远端 `echo "k\tv"` 在 dash 下不解释 `\t`，按 tab 切分会把整行当噪声 ⇒ 远端一律 `printf`。L4（注册一条真账号、看那一行等于当前 `legalSetVersion()` 的指纹）**不在脚本里冒充绿**：它要动生产数据，脚本只打印该跑的 psql。命令与退出码表在 [`runbooks/deployment.md`](../runbooks/deployment.md) §3.7。**闭合过程与实测（2026-10-02）**：① 批次进库 `ad8d9222`（实现 + 迁移 + schema + 判据）与 `31b6b1c3`（上一笔漏带的迁移数据库层证据）、`66e2d8e9`（第三个注册入口的判据）、`2e6f87f7`（后台把这一列带出 API）；② 生产侧走 deployment §3.8 **第四次重建** —— 回滚标签 `supersync:rollback-20261002-consent`（`b98b7b4d9d2b`）→ `git archive HEAD` 打包 → 构建（`APK_MIRROR` + `NPM_REGISTRY` 两个镜像变量都带）→ **先迁移后换容器**（`MIGRATE_RC=0`）→ 新容器 `2b0018b113315` `healthy`，`server/.env` 的 sha256 换前换后逐字相同（没有覆盖生产配置）；③ 门禁从**记账 8/14、退出码 2** 走到 **14/14、退出码 0**（本轮重取的实测值：HEAD 迁移命中 1 / schema 声明 1 / server/src 写入点 3 个文件 / 生产列 1 / 对照 `locale`=1、`terms_accepted_at`=1 / `_prisma_migrations` 共 **45** 条且含 `20261006000000` / 镜像 `/app/dist` 有 **95** 个 `.js`、grep `termsDocumentVersion` 命中 **3** 个文件、对照 `requireAdmin` 命中 3）；④ 🔴 **L4 实跑**（脚本刻意不代跑，因为它动生产数据）：`POST /api/register/email-password` 带 `termsAccepted:true` → **201**，那一行读出 `terms_accepted_at=1790878335391`、`terms_document_version=` 与 HEAD 的 `LEGAL_SET_VERSION` **逐字相同** ⇒ 这条同时证明"第三个入口靠委托成对"在生产上成立；再做一次**三方对账**：从线上落地页的 JS 产物（`/assets/main-W06aXnAC.js`）里数出九份 `id:"…",version:"…"`，排序拼出后与那一行**逐字相同**（`terms@1.1`，其余八份 `1.0`）⇒ 记下的版本 = 用户当时点开的那一版，不是构建期的一个巧合；⑤ 收尾：11 张带 `user_id` 的子表逐张计数全 **0** ⇒ `DELETE 1`，`users` 回到 **10**、带指纹行数回到 **0**（这是设计：现在还没有外部用户）。🔴 **换镜像之后把 §3.8.1 那五条线上判据重跑一遍，全绿**（`/health` 200、不存在的账号登录 **401** `invalid_credentials`、注册 201、`magic-login-confirm.js` 里 `sessionToken` ≥1、启动日志有 `Password hashing backend verified`）⇒ 这次重建没有把 ADR-0040 的口令登录、fragment 投递或 Argon2 known-answer 自检碰坏。⚠️ **闭合之后仍然留下的**：G-27 补签流程照旧没做（现在生产开始记版本了，它的前置条件已经满足，只剩"第一次文本改版"这个时点），以及新登记的 **G-36**（后台界面那一半与发布顺序）。 |

| **G-33** | 🟡 **链 5 的界面取证只剩移动壳那半**：① ~~真浏览器里"同意之前数网络请求"~~ ✅ **已补**（2026-10-02，`e2e/tests/privacy-consent-zero-egress.spec.ts` 7 条跑在**生产构建**上，`pnpm check:privacy-consent-e2e` 已进 `pnpm check`：未同意时出站清单为空且 `getRegistration()` 为 `null`，同意之后**同一个量翻过来** ⇒ 那条"零"不是恒真）；② **移动壳那 35 条仍没有模拟器截图**（AGENTS §6.2 规定一：任何"界面能用"的结论只有截图算证据） | 面板在**移动壳**上的渲染目前只有 RN 单测级证据；商店检测与备案材料按的是**运行中的客户端** | 工程（`verify:mobile-*` 加一步：首启面板截图 + 点「只用本机」之后仍零请求） | **本轮不做**：要 iOS 模拟器与 Android 实机各跑一轮，而这条链上的移动产物还没重装（§6.1.1 的 `pnpm reinstall:mobile`）。⚠️ 它不是"以后再说"——**转 `effective` 之前必须补上**，因为那是第一次有真实用户按这条走 |
| **G-34** | 🔴 **链 3 的实现整体没有进版本库 —— 这是 G-32 唯一的硬前置，且没有任何门禁会自动提醒**。2026-10-02 用 `git status --porcelain -- server packages/legal` 逐条实测：未跟踪（`??`）= `server/prisma/migrations/20261006000000_add_terms_document_version/`、`server/src/legal-consent.ts`、`server/tests/terms-consent-version.spec.ts`、`server/tests/terms-version-migration.pglite.spec.ts`；已跟踪但未提交（`M`）= `server/prisma/schema.prisma`、`server/src/auth.ts`、`server/src/passkey.ts`、`server/src/legal.generated.ts`、`server/src/design.generated.ts`、`server/src/admin/admin.routes.ts`、`packages/legal/src/documents/{privacy,minors,data-rights}.ts`。HEAD 里 `git grep -l legal-consent` 只命中两份**文档**与 `server.ts` 的一句**注释**（不是 import）。📌 **同一次实测顺带查到链 5 也不是提交态**：`packages/app-host/src/privacy-consent.ts` 用 `git ls-tree HEAD` 查同样**不在 HEAD** ⇒ 这不是链 3 单独的漏提交，而是"批次在工作树里推进、提交落后于实现"的通用形状（本行只登记事实，不代提交别人的在制品） | 链 3 目前只活在这台机器上：CI、干净检出、以及**生产镜像的构建归档**里都不存在它。后果不止"生产没生效"（G-32）：`pnpm check` 在这台机器上跑的是**工作树**，所以它绿的时候证明的是"别人在飞的代码没问题"，而不是"`main` 没问题" —— 这是 §7 第 57 条那类"门禁跑的不是版本库里的东西"的又一副面目 | 那条批次的所有者（同一会话）：把这些文件作为一笔提交进 `main`，随后在**干净检出**里跑 `pnpm check` + `pnpm --filter @heyta/server test`，再走 deployment §3.8 重建与迁移 | 🟡 **本行登记的那件"整体没进库"已经按归属拆开放开**（2026-10-02）：链 3 自己的部分进库了（`ad8d9222` + `31b6b1c3` + `66e2d8e9` + `2e6f87f7`），链 5 的生成物与后台界面那一半**仍然不在** —— 见下面这段的实测归属。⚠️ 原来那句"本轮不代提"的理由（"那是别人正在写的批次"）是**整批一刀切**，实测站不住，已按 hunk 逐条改判：归属的实测方法：`git diff -U0 -- <文件> | grep '^+'` —— **只看新增行**（第一版扫了整个 diff 含上下文行，把 `auth.ts` 误判成"含外来标记"，那是探针写错而不是批次混了）。逐文件结论：`server/src/legal-consent.ts`、`auth.ts`、`passkey.ts`、迁移目录、`schema.prisma` 那 11 行、两份 spec 的新增行**全部只谈版本指针** ⇒ 归属明确，已提；`packages/legal/src/documents/{privacy,minors,data-rights}.ts` 与它派生的 `server/src/legal.generated.ts`（工作树是 `privacy@1.1` 那一套）是链 5 的在制品，**故意不带** —— 带上去等于把别人未完成的改版宣告成"已生效"，而线上镜像此刻仍是 `privacy@1.0`（本轮从 `/assets/main-W06aXnAC.js` 里数出来的就是 1.0）；`admin.routes.ts` + `admin-client.ts` 同样只谈版本指针 ⇒ 已提，`AdminPanel.tsx` 的新增行里同时出现 图标尺寸常量（另一批设计 token 改动）⇒ **不拆 hunk**，那半登记为 **G-36**。这道归属判断本身也验过能不能失败：把 `AdminPanel.tsx` 交给它 ⇒ `GATE1_FAIL … 含外来标记`（那个标记名是另一批的图标尺寸常量）、exit 1、HEAD 未动。⚠️ 剩下的那批未入库文件**能不能被门禁抓到：部分能**。本轮用临时变异实测 —— 把本行里 `server/src/legal-consent.ts` 从内联代码改成指向它的相对链接，`node research/tools/docs-link-check.mjs` **exit=1、恰好报 1 处**，逐字是 `（解析到 server/src/legal-consent.ts，本机存在，但 git 没有跟踪它）`；还原后同一命令 **exit=0**。⇒ 它能拦"**文档链接**指向未入库的产物"，拦不住"未入库的实现本身没被链接"，所以这条缺口要靠人而不是靠闸。**HEAD 里刻意没有留下红灯**：那会让干净检出的 `pnpm check` 因别人未提交的代码而红 |
| **G-35** | 🔴 **未命中的 `/legal/*` 现在诚实 404，但答的是 nginx 的裸默认页** —— 截图 `e2e/live-site-results/live-legal-404.png`（人已看过）里只有 `404 Not Found` 与 `nginx/1.18.0 (Ubuntu)` 两行：没有品牌、没有回首页/回法务清单的入口、**并且把服务器版本暴露给任意外部访客** | G-25b 修的是"说谎"（假成功），这一条是"说了真话但没人接"：备案与 Apple 材料要核对的正是这些政策链接，转错一个字母的人看到的是裸页，等于把可达性验收的最后一公里交给 nginx 默认模板；版本号外露属运维卫生问题 | 运维 + 落地页（**归到国际化主线**：自建 404 页要中英双语，而它现在既不在 `packages/i18n` 词表里、也不在落地页的注册表里） | **本轮不补**：G-25b 的判据只承诺"真 404 且不牵连前端路由"，两样都已复验；把 404 页做成品牌页要新增一份 `404.html` 产物 + `error_page` 指令 + 双语词条，那是落地页的一次功能改动，不该塞进一次 nginx 修复里。**注意它不能靠 `try_files … /404.html` 实现** —— 那会把状态码又变回 200，正是 G-25b 刚修掉的那个坏法；要用 `error_page 404 /404.html;` + 内部跳转 |

| **G-36** | 🔴 **同意留痕"读"的那一半只进库了一半，而"文本改版"与"镜像重建"之间没有任何闸钉住先后**。① `apps/web/src/features/admin/AdminPanel.tsx` 的后台显示行与它需要的 4 条中英词条仍在工作树（与另一批界面改动（图标尺寸常量）的 hunk 混在同一份文件里，本轮不拆 hunk）⇒ 库里和 API 都能答"哪一版"，界面上还没有那一行；② 🔴 更要紧的是顺序：`privacy`/`minors`/`data-rights` 在工作树里已被链 5 bump 到 **1.1** 而未进库、未发布，而此刻线上九份是「`terms@1.1`，其余八份 `1.0`」，与镜像里的 `LEGAL_SET_VERSION` **逐字相同**（本轮实跑到的一次三方对账）。链 5 落地时如果**只发落地页**（用户读到 1.1）而**没有重建服务端镜像**（新注册仍记 1.0），落库那条指纹就指错了文本 —— 而 `check:server-legal` 只比"生成物 ↔ `@heyta/legal` 真源"，**看不见线上部署的是哪一版** ⇒ 两道闸会同时绿 | 顺序一旦错，此后每一条同意记录都是**版本号写错了的证据**，而且没有任何一层会报错 —— 那正是链 3 立起来要防的"读的是 A、记的是 B" | 链 5 的所有者（文本改版必须与 deployment §3.8 的镜像重建同一批）+ 运维 | **建议的钉法（本轮没做，登记）**：给 `verify:consent-trail` 加第五条腿 —— 从线上 `/assets/main-*.js` 数出九份 `id:"…",version:"…"` 排序拼串，与镜像 `/app/dist/src/legal.generated.js` 里的 `LEGAL_SET_VERSION` 逐字对账，不一致即红。⚠️ **它能不能失败尚未验证**（按 AGENTS §8.3 那不算门禁，只算一条待办）；但两侧取值本轮已各实测到一次（线上串 == HEAD 串 == 那一行落库的值），所以这条判据不会空转。另需注意取证形状：🔴 **不能拿页面 HTML 去 grep** —— 那 18 个入口是客户端渲染的外壳（实测 7259 字节、里面一个版本号都没有），必须打 JS 产物 |

## 5. 需要拍板（agent 不能替产品决定，也不能替法律决定）

🔴 **这一节和 §4 那张表是两类东西。** `G-*` 是**缺口**：知道怎么补，只是没补或补不了；
`D-*` 是**决定**：两条路都合法，选哪条是商业与风险偏好 —— 不是工程问题，也不是能从代码里读出来的东西。
每条给出：文本**当前逐字怎么写**（位置可核）、调研给的相反口径与出处、**不拍会卡住什么**、
以及"一直没人拍就按这条走"的默认值。有默认值不等于这条不重要 —— 它只说明"停在原地"是一个
**可执行的状态**，而不是悬空。

| 号 | 要拍什么 | 文本现在怎么写（可逐字核对） | 调研的相反口径（出处） | 不拍的后果 | 本轮默认 |
|---|---|---|---|---|---|
| **D-01** | 🔴 **注册勾选那句措辞的指代**："该服务端"要不要改成"确定主体 + 确定版本" | `web.auth.terms.label` / `mobile.auth.terms.label` 均为"我同意该服务端提供的服务条款与隐私政策"，另有 `site.docs.account.s4` / `.s4p1` **一整节**向用户解释这句话为什么这么写 | `legal-consumer-contract-terms.md` §7.3（三处必须处理）+ §7.4 起草纪律第 3 条 + §8.4 阻塞项 9：合同必须有确定发布主体与确定版本，"该服务端"在用户尚未选择端点时是**主体不确定的指代**；建议按**角色**拆两层（账号与订阅协议永远由 heyta 发布并带版本；同步服务按官方 / 自建 / 第三方三档写明运营者） | **链 2 不能定稿**：改文案 = i18n 中英同批 + docs 那一节 + 服务端 consent 语义三处联动 | 先只**加链接**、不动文案；链接落点按 D-09 分流，那条不需要先赢这个争论 |
| **D-02** | 退款那道"**未实际使用**"门槛留不留 | `subscription-refund.ts:173`"支付后 **7 日内**提出，且**未实际使用托管同步的**：**全额退款**"；`:174` 7 日后按剩余未使用天数比例 | §11 行 5：预付式消费解释第 14 条的要件是"除缔约前已享受同类服务外"，用"未使用"卡人**落进解释第 9 条**"排除消费者请求返还预付款的权利"的射程；建议"7 日内无条件返还本金，已使用部分按未使用天数折算注销" | 一条**可能被整条判无效**的格式条款，同时是收入侧的防滥用闸门 —— 只有产品能权衡 | 保留现写法，交 G-01 律师判；⚠️ 不新造数字 |
| **D-03** | 约定管辖（杭州西湖区）留不留 | `terms.ts:365`"协商不成的，任何一方可向**杭州市西湖区有管辖权的人民法院**提起诉讼"。同节 `terms.ts:295` **已有**《民法典》506 条例外句 ⇒ §11 行 7 的 (a) 半边**已闭合**，只剩 (b) | §11 行 7(b) + §10.2：格式管辖条款未以合理方式提示即可能无效（《民诉法解释》第 31 条）；heyta 是面向全国消费者的低客单价服务，**约定管辖收益极小** ⇒ 建议删掉，改为"依法向有管辖权的人民法院起诉，并保留投诉、调解等法定途径" | 保留就必须"加粗 + 独立确认"（清单 H 节），而那个确认面今天不存在 | 保留，并在送审材料里**显式标出这一条待判**，不替律师悄悄决定 |
| **D-04** | 条款变更的 **A / B / C 三档 + 公示天数** | `terms.ts` s10 只有两句："涉及数据用途、责任范围或退款政策的**重大变更**，我们需要你在应用内**重新确认**" + "变更**不溯及**你已经购买的期间"。🔴 **没有分档、没有天数** | §11 行 8 + 清单 G 节：≥15 日 / ≥7 日 / 补发通知三档；A 档须阻断式明示同意 + 不同意可退出并退未消费余额（解释第 9 条第(四)项：约定经营者有权单方变更实质性内容 ⇒ 无效）；还要与 PIPL 第 14 条第 2 款对齐 | 写了天数就得发得出去 —— 变更通知要新增一个 `AccountNotification` kind，**发送管道今天没有** | 不写具体天数，只写"重大变更须重新确认"（比"继续使用即视为同意"强，且没许诺发不出的东西） |
| **D-05** | 🔴 **iOS / 商店渠道到底卖不卖订阅** | `subscription-refund.ts` s6 整节标题就是「关于自动续费：我们没有，所以那一套义务不适用」，正文"heyta **不发生任何自动扣款**"；`third-parties.ts:529` 把 Apple / Google / 华为的商店内购通道标 **No**（"no store IAP is wired up"）⇒ **今天这两句都是真的** | §8.1（Apple 3.1.1 订阅必须有恢复机制、元数据要给条款与政策链接；3.1.2 要写清名称 / 时长 / 完整续费价 / 计费周期）+ §8.2（Google 开发者是 **merchant of record**）+ §11 行 9：**不得**在 iOS 版本里继续宣称"不自动扣款" —— 商店订阅天然自动续费，不一致即构成误导 + 元数据不符 | 一旦有人接 IAP，那句"不发生任何自动扣款"**当场变成假话**，且商店字段、自定 EULA、App 内文案三处必须逐字一致（498 条不利解释会咬回来） | 按"商店版不提供付费入口"交付；⚠️ **接 IAP 之前必须先改这一节并 bump 版本**，不能先用起来再补文本 |
| **D-06** | 年龄条款要不要落到**界面** | `minors.ts` 文件头第 ③ 条已把话说死："注册流程里**没有**年龄自述勾选（它是待办，不是现状）⇒ 文本不许写'注册时我们会请你声明年龄'"；正文用的分界是法定线**不满十四周岁**（PIPL 28 / 31），并坦白"**我们不核验年龄**" | §9.2 路线 (a)：**最低年龄 18 周岁**（"不涉及监护人同意机制、不触发未成年人模式的产品改造"），并建议给出理由句"本服务涉及付费订阅与用户自行保管不可恢复的加密口令，需由具备完全民事行为能力的人作出"；§9.3 界面侧要求"注册确认项里加'我已年满 18 周岁'的**独立勾选**（`consents.kind` 增加一项 `age_declaration`，🔴 **不合并进主协议勾选**）"；§11 行 10 + 清单 H 节：监护人主张时款项要退（自我声明**不能对抗**《民法典》第 19、145 条） | 加勾选 = 界面改动面 +1（中英同批、无障碍名、留痕），**且它依赖链 3 的形状** —— 🔴 链 3 今天落的是**一列** `users.terms_document_version String?`（`server/prisma/schema.prisma:54`，2026-10-01 已上线），它存的是"同意的**是哪一版文本**"，**装不下**"同意了**哪一类事项**"：把 `age_declaration` 塞进同一列会让两个问题的答案共用一个格子，而那正是留痕唯一要防的事。所以年龄声明要留痕，只有两条路：① 再加一列可空的 `age_declared_at`（同样**不回填**，成本最低）；② 正式建 `UserConsent(kind, …)` 表（层 4 的 A 档形态，形状已在 `legal-consumer-contract-terms.md` 层 3–4 那两段 `model UserConsent` 里给出）。这两个决定有先后顺序，不能各改各的。不加则是"对外写面向成年人、界面无一句年龄提示" | 不加，文本按现状写"不核验、依赖声明" |
| **D-07** | 要不要设**隐私专用邮箱**与公开**个人信息保护负责人** | 一个信箱 `heyta@waytofuture.cn` 兼任四件事，文本里**自己承认**了：`privacy.ts:555`"它同时是权利请求受理入口与投诉举报入口" | baseline §2.6 第六类第 5 项：必须公布**隐私专用邮箱（不是通用 support 邮箱）**，且它"与 §1.7 的'处理者联系方式'是**两个东西**（第 17 条要联系+方式，第六类第 5 项要投诉举报渠道），文本里要分开写"；§8.1：建议现在就指定负责人并在隐私政策末尾公开**姓名 + 专用邮箱**（例如 `privacy@waytofuture.cn`），"成本极低" | 建了 `privacy@` 就得有人读 —— 与 **G-03** 同一类"写了就得兑现"；公开自然人姓名则有不可撤销的代价 | 沿用单信箱，文本如实写明它兼任（**不把没设的信箱写成已设**）；负责人姓名**不写** |
| **D-08** | 🔴 对外承诺**备份保留 14 天**，而这个 14 天不是从生产读来的 | `privacy.ts:397`"你的数据仍可能在 **14 天内**的备份副本里存到该备份过期"，`:476` 注销一节再引一次；`data-rights.ts`、`personal-info-list.ts` 同口径 | `legal-dataflow-ai-rights.md:604`：`server/scripts/backup.sh:34` 是 `RETENTION_DAYS="${RETENTION_DAYS:-14}"` ⇒ 默认 14 天**但可被环境变量覆盖**；同文件 :693 记下 `server/docs/backup-and-recovery.md:31-34` 的示例写 **3 天**，两处口径不一致，建议"具体天数**先不写**" | 政策印 14、生产实际配 7（或文档示例那个 3 才是真的）⇒ **一个可核验的假承诺**，而且它出现在"删除权"那一节 | 保留"14 天"+ 那句"不承诺删除穿透备份"；🔴 **发布前必须去那台机器读实际 cron** —— 那是这条决定的前提，不是可选步骤 |
| **D-09** | 官方托管实例的 `/privacy.html`、`/terms.html` **由谁生成** | `server/src/server.ts:204` 的 `generatePrivacyHtml` 只在 `PRIVACY_*` 五项配齐时产出 ⇒ 生产配了 **0 条**（G-13），两个 URL 双双 404；`:310` 的 `installOperatorLegalPages` 拷的是运营者自己放进 `<dataDir>/legal/terms.html` 的文件 | §11 行 1（**最高优先**：发布链路与仓库脱钩 ⇒ 运行时那份文本没有版本、没有哈希）+ §8.4 阻塞项 2（Apple 3.1.1 要 App 内**和**元数据都有 Terms 链接）：把发布源纳入构建产物 + SHA-256 manifest + 部署时指纹校验 | 链 2 的链接在**官方域**上现在点开就是 404；而代发 heyta 那份，又会让自建部署者拿到一份**heyta 署名的**政策当默认页（正是 §3 链 2 顾虑的那件事） | **不动服务端**。链 2 按 baseUrl 分流：官方托管域 → 落地页 `/legal/*`（那份必然是 heyta 的）；其他 host → `<baseUrl>/privacy.html`，404 就让它 404（诚实的失败） |
| **D-10** | **含税口径** | `subscription-refund.ts` s2 表第四列"⚠️ 是否含税**以支付页标示为准**"，`:101` 明写"我们**不在本文件里替你算税**" | 清单 B 节 🔴 把"含税口径"列为要式内容；baseline:1474 记下上游草稿原文"（含税与否待确认）"，并建议**扩展 `scripts/check-pricing-consistency.mjs`** —— 它今天只比**金额**一致性，不比含税口径 | 🔴 **这是回避，不是答案**。带着它进正式发布 = 明码标价缺一要件 | 维持"以支付页为准"；⚠️ 送 G-01 时单列，并让财务给大陆 6% 与开票主体的真口径 |
| **D-11** | App 备案号**核准后展示在哪** | `privacy.ts:109` 把权威指向"应用内「关于」页与服务端对外页" —— 那两处**今天都不展示任何备案信息**（见 **G-24**） | `legal-filing-prerequisites.md` 对同品类的实测：滴答清单中国版 `dida365.com` **页脚**公开了运营主体「杭州随笔记网络技术有限公司」与「**浙ICP备12005180号-3**」，法律文本链接标注为 [Terms] / [Privacy]（`dida365-help-center-ia.md:593` 另记有「© 2026 …」与「浙公网安备 33010602005056号」）⇒ 同品类的落点就是**页脚**；⚠️ 两处抓取都标了"需人工复核、可能不完整"。清单 A 节把"备案信息在页脚展示"列为 ⚪ | 核准那天这句话变成假话（把权威指向一个不发布的页面） | 落地页页脚加一行（**有号才显示**，沿用 G-04 那条"未核准不印"的判据）；应用内是否再放一份，等展示位定了再说 |
| **D-12** | 🔴 腾讯云那份**委托处理合同附件**到不到位 | `third-parties.ts:112` 如实披露腾讯云持有整库所在机器（含邮箱明文与口令散列的每日快照），`:159` 写明它是**受托方**而非"提供给的第三方"，并留下"必须有约定目的、方式、范围与安全义务的合同附件"这句**要求** | PIPL 第 21 条（委托处理应约定目的、期限、方式、种类、保护措施与双方权利义务，并**对受托方的处理活动进行监督**；baseline:1296 记为"不需要单独同意但要披露 + 合同约定"）；网数条例（baseline:1307 逐字："向其他网络数据处理者提供、委托处理个人信息和重要数据的，应当通过**合同等**约定处理目的、方式、范围以及安全保护义务"） | 披露是真的（这条没问题），但**法定要件里"合同"那一份我们没核过** —— 监管要出示的是那份附件，不是"我们写了受托方" | 🔴 **agent 办不了**：要看实际签署的腾讯云协议正文。文本里**没有**宣称"已签附件"（已核对），所以今天不构成假话；核对动作归本人 |

🔴 **D 与 G-01（律师复核）的顺序不能倒。** `D-*` 回答"我们**想**怎么做"，
G-01 回答"这么做**合法吗**"。送审前先把能拍的拍完，否则律师要替我们做商业决定 ——
那既不是他的职责，回复也会变成一堆"取决于你的业务模式"。

### 5.1 六条已经自己闭合、不必再讨论的

- 🔴 **ICP 经营许可证（B25 信息服务）不在 heyta 的备案前置里** —— 2026-10-01 产品负责人拍板：
  **卖自己的服务只需要 ICP 备案 + App 备案，不需要许可**。
  这条原先被 `licensing-and-compliance.md` §5.3 写成"很可能是硬门槛（100 万注册资本 + 3 人社保）"，
  而那两个数字的来源是**知乎 + 代办机构页**："3 人社保"在《电信业务经营许可管理办法》**第六条全文里不存在**
  （第六条只有注册资本 / 可研报告与技术方案 / 场地设施 / 无重大违法四项），
  同品类收订阅费的滴答清单中国版页脚也只公示备案号、**未公示许可证号**。
  依据链与翻脸条件（托管 AI 收费 / 内容面向多用户分发 / 广告 / 卖内容订阅 ⇒ 任一命中即重判）在
  [`legal-filing-prerequisites.md`](../research/legal-filing-prerequisites.md) §5 与
  [`icp-app-filing.md`](../runbooks/icp-app-filing.md)「办什么、不办什么」。
  ⚠️ **代办机构把"备案"和"许可"混着卖是这一带最常见的误导源** —— 本项目今后任何合规结论
  **不接受**代办页与知乎作为依据（与本文 G-4 的处置同一口径）。
- **《民法典》第 506 条例外句**已在 `terms.ts:295`（"我们依法应当承担的责任不因本节而免除或限制，
  包括因我们故意或重大过失造成你损失"）—— §11 行 7 的 (a) 半边已解。
- **¥12 云端 AI 不在可购买清单里**：`subscription-refund.ts:96` 那行是"暂未提供 / 暂未提供 / —"，
  符合 ADR-0023"计量存在之前不得售卖"。
- **备份不承诺"删除穿透"**：`data-rights.ts:175`、`privacy.ts:397` 都写"整库快照、没有单点删除能力"。
- **45 天保留期写成"产品当前设定、不是用户可自选的选项、改它要发版"**（`privacy.ts:371`、
  `personal-info-list.ts:536`），且 :412 把"运维侧可以把清扫预算设成 0 令其停摆"这条诚实边界一起写了。
- **passkey 不自称敏感个人信息**，同时把关键事实写全：`privacy.ts:508`、`personal-info-list.ts:481`
  写明"生物特征的比对全部在设备安全芯片内完成，我们不持有、也无法获取任何指纹或人脸模板"。

---

## 6. 什么算做完

按顺序，前一条不成立则后面的都不算：

1. **九份文本齐**（`pnpm --filter @heyta/legal build` 通过），每份中英逐段对齐，
   `packages/legal/tests/structure.spec.ts` 判得住：故意删掉英文版一段 ⇒ 必须红。
2. **每条事实断言指得回 §1** —— 抽查方式：任一"我们做/不做 X"的句子，
   能在某份 `legal-dataflow-*.md` 里找到对应小节；找不到的**删掉**，而不是补一句论证。
3. **链 1 上线**：`/legal/<id>/` 九条入口生成、页脚 legal 组出现、
   `render.spec.tsx` 的 N2（可达性）判据覆盖这九条；`check:entries` 绿。
4. **链 2 上线**：两侧勾选框旁边的链接**在真浏览器里点得开**（截图为证，AGENTS §6.2 规定一）。
   🔴 验收必须**分两种 baseUrl 各跑一次**（按 D-09 的分流）：连官方域 ⇒ 打开的是落地页
   `/legal/*`；连一台自建 / 测试 server ⇒ 打开的是 `<baseUrl>/privacy.html`，
   而那台没配 `PRIVACY_*` 时**必须是 404**，不是悄悄退回落地页 ——
   把别人的实例渲染成我们的政策，就是 D-01 里那句"替别人作出没有依据的承诺"。
   ✅ **已满足**（2026-10-01）：`e2e/legal-links/legal-links.spec.ts` 5 条全绿，五种形态各有截图
   （`e2e/legal-links-results/legal-*.png`，人已看过）；自建侧零转发，真 404 由
   `heyta.finlaw.cloud` 现场作答。⚠️→✅ **官方侧的"内容"这一半原先不在本套件里证明**（它顶替成
   本地构建），现在由**另一条直连真服务器**的套件补上：`e2e/live-site/live-legal.spec.ts` 12 条
   （九份 × 中英，判到渲染后的 `h1`/目录/小节数/版本行/横幅，第一条是"字节必须与首页不同"；
   另两条是部署级复验：**线上英文 terms 逐字 = 本地真源**（G-31）、**未命中的 `/legal/*` 是真 404**（G-25b））。
   两侧分工写死在各自配置头：**这里红了是代码坏，那里红了是部署没跟上。**
5. **链 3 上线**：任一真实用户能在后台答出"他同意的版本号 + 确认时间"；
   回归断言"客户端没勾 ⇒ 数据库没有同意记录"。
   🟡 **原判"✅ 已满足（2026-10-01）"里只有"代码与判据"那一半成立，"上线"那一半不成立**
   （2026-10-02 复验后改判，见 **G-32**/**G-34**）：链 3 的实现整体**不在 `main` 上** ——
   HEAD 里没有那个迁移目录、没有 `legal-consent.ts`、`schema.prisma` 里只有 `termsAcceptedAt`
   而没有 `terms_document_version`；生产库里该列计数 0、部署镜像 `dist` grep 0。
   ⇒ 这条**重新变为未满足**，硬前置是那条批次进版本库，之后才是迁移 + 重建镜像。
   （实现细节在「链 3 —— 同意留痕要能记下哪一版」小节，该小节顶部已标注它描述的是工作树不是 `main`。）
   🔴 **原文里那句"来自哪个端"已经从验收标准中去掉** —— 不是没做，是它压根不是对外文本的承诺：
   `privacy.ts` 第 12 条逐字只承诺"记下同意时刻，以及当时那一套文件的版本号"，
   九份文本没有任何一句说我们会记"这次同意来自哪个端"。把它写进验收标准
   等于用工程口径给对外文本加一条它没做过的声明。**要真记来源端，得先改文本再重新取同意**
   （`privacy.ts:533`：处理的**种类**变化必须有一次独立的重新提示，不能随版本静默发布）
   —— 登记为 **G-28**。
6. **链 5 上线**：决定作出之前**一个请求都不发**，且"不同意"是一个走得通的完整选项。
   ✅ **机制与判据已满足**（2026-10-02，见「链 5 —— 首启同意闸门」小节：86 条判据 +
   30 个变异臂全部被抓到 + 文本三份同步改版）。
   ✅ **真浏览器取证已满足**（2026-10-02：7 条跑在生产构建上、进 `pnpm check`，而且它抓出并修掉了
   一条"生产构建里 SW 从不注册、零报错"的真缺陷 ⇒ §7 第 103 条）。这半补的是**闸门把代码搬动之后
   的真实行为**，不是把单测换个跑法。
   🟡 **移动壳面板的模拟器截图仍缺** ⇒ **G-33**。在它补上之前，web 侧可以写"真浏览器实测"，
   **移动侧不许**写成"已按客户端实测验证"。
7. **§5 那张表每条都有归宿**：要么拍了（写回该行"本轮默认"列并 bump 相关文本版本），
   要么带着默认值进送审材料。🔴 **不许出现"表里还有空的 D"**就送律师。
8. `pnpm check` 全绿（G-17 那条红**不算**本轮的，但要在交付说明里写明）。
9. 🔴 **最后一步不是工程**：律师复核（C1）→ 把 `status` 改成 `effective` → 走发布。
   在那之前，链 1 的九条 URL 存在**不等于**可以对外宣传。

**验收载体**：文本类改动看渲染出的页面（截图 + 人真的看），不看 TS 是否编译过。
编译过只证明结构对，不证明"这话是真的"。

---

## 7. 与并行会话的碰撞面

- 🔴 `server/src/copy.generated.ts`、`server/src/password/recovery.ts` 属另一会话在飞的工作（G-17），本轮不碰。
- `packages/i18n` 只在**新增界面词条**时改（导航/页脚/法务页外壳的标签），
  且**中英同批**；🔴 **不要**把法务正文塞进词条表（理由见 §2.1）。
- `apps/landing/src/site/pages.ts` 与 `main.tsx` 是**注册表驱动**的：加九条 legal 页会与
  同时在改站点结构的会话撞同一处，改前先 `git diff` 该文件。
- 本文件不动 `AGENTS.md` / `CONTRIBUTING.md` 的规则部分。

- ✅ **两条 `pnpm check` 红灯已归因，都不是本工作流的**（2026-10-01 逐条查到机制，
  不是"大概是并行会话"那种推测）：
  1. `check:landing-e2e` —— 实跑 **15 passed / 2 failed**，两条失败全在
     `e2e/landing/docs-centre.spec.ts` 的**配图**断言上
     （`first-run：指向复制品的 <img> 数必须等于配图数`，期望 1 实得 0）。
     这套是并行会话在飞的 **help → docs 迁移**：工作树里 65 处 landing 变更，其中
     `apps/landing/help/*` 与 `apps/landing/en/help/*` 共 40+ 个 `index.html` **已 staged 删除**，
     新增未跟踪 `apps/landing/docs/` 与 `apps/landing/en/docs/`。**没有一条失败与 `/legal/*` 有关。**
  2. `check:web-storage` —— **一条断言都没跑到**。`scripts/verify-web-storage-backend.mjs:50-54`
     自己 spawn `vite --port 4321 --strictPort`，而 :4321 被另一条会话的 vite 占了约 10 小时
     （PID 25572，`--strictPort`）。本机只读探一次 bind 即 `EADDRINUSE`。
     ⇒ 这类红**没有产品含义**，判它之前先 `lsof -nP -iTCP:4321 -sTCP:LISTEN`；
     🔴 **不要**为了让它变绿去 kill 别人的 server —— 与 §7 第 87 条同一家族、方向相反
     （那条是门禁 kill 别人，这条是被别人占着而死）。
- ⚠️ **`apps/mobile/harmony/` 现在存在**（`AppScope/app.json5` 已注册 `com.heyta.app`，
  见 [`runbooks/icp-app-filing.md`](../runbooks/icp-app-filing.md) §2.5），
  而 `AGENTS.md` §1 那张仓库地图仍写着"`apps/mobile` 下没有鸿蒙工程"。
  **不动 AGENTS 的规则部分**（§8「不要擅自做的事」），在此登记那条描述已过期：
  准确说法是"鸿蒙工程已建、JS→unsigned release HAP 的构建链已实测打通，
  但缺模拟器系统镜像与签名 ⇒ **仍然跑不起来**"。
- ✅ **`check:docs` 那 4 条死链的修法不是放宽门禁**：实跑输出（2026-10-01，`node research/tools/docs-link-check.mjs`）
  报的是「**本机有、仓库里没有**」4 处，目标只有**两份**文档 —— 本工作流新增、尚未 `git add` 的
  `docs/plans/legal-compliance-before-filing.md`（就是本文件）与 `docs/research/legal-filing-prerequisites.md`；
  引用它们的四个来源是 `docs/plans/README.md:20`、`docs/research/licensing-and-compliance.md:256/358`、
  `docs/runbooks/icp-app-filing.md:40`。检查器判的是**链接目标未被 git 跟踪 ⇒ 干净检出（CI 的唯一形态）上是死链**，
  不是文件不存在。⇒ 走它自己给的出路 ①：**提交时把这两份 `git add`**（它们本来就该入库），门禁随之转绿。
  ⚠️ 九份法务 HTML 目录（`apps/landing/legal/`、`apps/landing/en/legal/`）**不是**这条判据的对象 ——
  它们是站点入口，由 `check:entries` 与注册表管。本轮**没有提交授权**，且共享 index 里已经带着
  上面那 40+ 条 staged 删除 —— 往同一个 index 里加东西会把对方的删除与我的新增绑成一次提交。
  ✅ **该授权已于 2026-10-01 拿到并落地**（`2dac3fa3`），走的是 plumbing 逐条拼树 + `update-ref` CAS，
  **没有**把对方那 40+ 条 staged 删除吸进同一笔（收尾复验：`git diff --cached` 里 legal 命中 0）。

- 🔴 **线上落地页在本轮发布之后又被另一条会话换掉了一次**（2026-10-01 23:19:07 +0800）。
  取证：服务器 `/var/www/heyta-landing/**` 全部文件 mtime 同一秒，主 chunk 是 `main-CSL_7LHx.js`，
  而本地那份构建是 `main-BnOUISMc.js`（字节数也不同：811 079 vs 813 993）。
  后果是 `e2e/live-site/live-domain.spec.ts` **三条现在红**：英雄区主按钮 `href` 是 `#showcase`
  （文案「看看它长什么样」）而不是 `${ORIGIN}/app`，且 `/app/` 在 60 秒内没渲染出任务输入框。
  **与法务批次无关**，本轮没有为此改任何东西 —— 但两件事要那条会话自己确认：
  ① 那次 landing 构建有没有带 `VITE_APP_URL`（`AGENTS.md` §2 明写"未配置时整条入口不渲染，
  这是故意的"，而默认构建就是未配置）；② `/app/` 是不是正处在部署中间态。
  ✅ **法务九页在这次替换前后都活着**：`live-legal.spec.ts` 的 10 passed 是**跑在新构建上**的，
  九份中英目录在服务器上逐个 `ls` 得到。

- 🔴 **`e2e/test-results/` 是多条套件共用的 outputDir，而 Playwright 每次运行开始删除并重建它** ——
  本轮线上验收连跑三次，把另一条会话还没看的 `live-app-pwa.png` 与自己的 `live-legal-terms-*.png`
  各抹掉一次；两条会话同时跑时还会互相删 trace，症状是**断言全过却判红**
  （`browserContext.close: ENOENT …/.playwright-artifacts-*/…trace`）。
  ✅ 已把 live-site 这条套件隔离到 `outputDir: './live-site-results'`（截图也落那里，
  与 `playwright.legal-links.config.ts` 同一模式）；⚠️ **其余套件仍然共用 `test-results/`**，
  谁先撞谁知道 —— 与 §7 第 87 条（门禁 SIGKILL 别人的 dev server）同一家族：**验收载体自带破坏性**。

- 📌 **干净检出（`git archive 2dac3fa3`）上进库时实测到的他线红**，全部**不是**本提交造成的
  （本提交 0 处删除、不含下列文件），列出来是给下一条接手的人省一次归因：
  `apps/web` typecheck 的 `signin-entry.spec.tsx(89,76) 'query'`；`@heyta/landing` 5 条
  （`PRIMARY_NAV` 4-vs-3、changelog「门禁」×2、selfhost「PostgreSQL」「建索引」×2）；
  `check:docs` 余 2 条指向**未跟踪**的 `docs/adr/0042-glass-material-boundary.md`
  （同一个"本机有、仓库里没有"判据，见上一条的出路 ①）。
