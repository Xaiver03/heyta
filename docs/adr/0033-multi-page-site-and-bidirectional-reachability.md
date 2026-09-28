# ADR-0033：站点多页架构 = **单一页面注册表驱动的静态入口**，且站点与应用互为可达

> 状态：**已接受**（2026-09-28 起按此实施，落实记录见 §6）
> 日期：2026-09-28
> 相关：[ADR-0003](0003-multi-platform-strategy.md)（分层）、
> [ADR-0024](0024-desktop-shell-and-ui-convergence.md)（壳与 UI 收敛）、
> [ADR-0032](0032-windows-native-via-rnw.md)（原生优先）
> 计划：[`docs/plans/site-and-parity-alignment.md`](../plans/site-and-parity-alignment.md) D1 / A0 / A8
> 调研：[`docs/research/site-ia-and-landing-audit.md`](../research/site-ia-and-landing-audit.md)

---

## 1. 背景与约束

### 1.1 触发

对标滴答清单的站点后，heyta 落地页缺五块：**功能介绍、下载/平台、高级会员、帮助中心、登录**。
而落地页现在是**单页 SPA + 双静态入口**（`index.html` / `en/index.html`），
`Landing.tsx` 文件头明确写着"到 P2 需要深链接时再引入路由" —— **现在就是那个时候**。

### 1.2 🔴 产品负责人给的四条硬约束（原话）

> 「一定要作为完整的产品及路由实现，**禁止出现孤立的产品路由、产品孤岛**。
> 然后要完美的**融入现有的产品界面**。」

落成四条可验收的判据：

| # | 约束 | 判据 |
|---|---|---|
| **N1** | 完整的产品与路由实现 | 每个页面有**明确的上级入口**与**明确的去向**；不存在只能靠手打 URL 到达的页面 |
| **N2** | 🔴 禁止孤立的产品路由 | 每条路由都必须出现在 **导航或页脚**，或被某个可达页面正文链接指向 |
| **N3** | 🔴 禁止产品孤岛 | 站点 ↔ 应用**双向可达** |
| **N4** | 完美融入现有产品界面 | 复用同一个 `BrandMark` / 设计 token / 动效预设 / **词条表**；不新建第二套导航体系 |

### 1.3 🔴 N3 有一半是**零** —— 这是本节最重要的事实

实测（2026-09-28，全仓 grep）：

| 检查 | 结果 |
|---|---|
| `apps/web/src` 里 `href=` | **0 处** |
| `apps/web/src` 里 `window.open` / `openURL` / `Linking` | **0 处** |
| `apps/mobile/src` 里 `Linking.openURL` | **0 处** |
| `apps/web/src/features/subscription/SubscriptionNotice.tsx:16` 自述 | 「**现在不存在可跳转的续费地址**」 |

也就是说：**应用本体对外一个链接都没有。**

我们此前花了很大力气打通"落地页 → 应用"（构建期 `VITE_APP_URL`，
见 [`apps/landing/src/lib/app-url.ts`](../../apps/landing/src/lib/app-url.ts)），
却**从来没有反向的那一半**。后果是具体的：

- 用户在应用里遇到问题 → 找不到帮助；
- 想知道要不要付费 → 找不到价格；
- 想知道产品还在不在维护 → 找不到更新动态；
- 订阅到期提示说"数据不会丢"，却没有任何地方能解释这件事。

🔴 **这不叫"还没有帮助中心"，这叫两个产品孤岛。**
而"孤岛"不会被任何现有门禁发现 —— `render.spec.tsx` 查的是**页内锚点**，
它对"应用里根本没有指向站点的链接"完全无感。

### 1.4 现有形态的硬事实（选型要基于它们）

| 事实 | 来源 |
|---|---|
| 落地页**无路由库**，整站一页，导航全是页内锚点 | `apps/landing/src/Landing.tsx` |
| 两个 HTML 入口**共用同一份 bundle**，只有头部元信息不同 | `apps/landing/vite.config.ts` 的 `input: { main, en }` |
| 语言由**路径**决定（SEO 要求），两版 hreflang 三件套逐条一致 | `src/lib/locale.ts` + `tests/seo-head.spec.ts`（12 条） |
| nginx `location /` 有 SPA 兜底：**任何不存在的路径都返回 200 + 落地页 HTML** | `docs/runbooks/deployment.md` §3.7、`apps/landing/public/robots.txt` 文件头 |
| 站点与应用**同源**（`/` 与 `/app/`），passkey 依赖这一点 | [ADR-0012](0012-self-host-transport-policy.md)、deployment §3.7.1 |
| 文案**唯一事实源**是 `packages/i18n`，硬编码由 `check:ui-language` 拦 | `AGENTS.md` §2 |

> 🔴 第 4 条（SPA 兜底返回 200）是关键：**"URL 能打开"不是"路由存在"的证据。**
> 一个拼错的路由会安静地渲染首页 —— 这正是 N1/N2 必须靠门禁而不是靠肉眼的原因。

---

## 2. 选项

### 选项 A：继续多 HTML 入口（Vite `input` 每页一项）

| 优点 | 缺点 |
|---|---|
| 每页是**真静态**：SEO 最好、首屏最快、无客户端路由开销 | 入口数 = 页数 × 语言数（6 页 × 2 = 12） |
| 与现有双入口形态**一致**，不需要推翻 `Landing.tsx` 的裁决 | 导航是**整页跳转**（内容站可接受） |
| 静态 HTML 的 `<title>`/`description`/`hreflang` 天然逐页可控 | 手写 12 份 HTML 必然漂移 |

### 选项 B：引入客户端路由（React Router）

| 优点 | 缺点 |
|---|---|
| 导航无刷新、入口数少 | SEO 依赖预渲染；与现有"不引入路由"的裁决冲突 |
| 路由表集中，便于生成导航 | 🔴 **更容易出孤岛**：路由表可以存在而没人链过去，而 SPA 兜底会让"手打 URL 能通"掩盖它 |

### 选项 C：混合（静态入口 + 页内轻量路由）

| 优点 | 缺点 |
|---|---|
| 兼顾首屏与无刷新导航 | 🔴 **两套导航语汇 = N4 直接不满足**；两套心智必然漂移 |

---

## 3. 结论

**选 A，但"多 HTML 入口"必须由一份注册表生成，而不是手写。**

### 3.1 单一页面注册表（本决策的核心机制）

新增 `apps/landing/src/site/pages.ts`，**它是站点页面清单的唯一事实源**：

```ts
// 形状示意（不是最终代码）
export const SITE_PAGES = [
  { id: 'home',     path: '/',          group: 'product', labelKey: 'site.nav.home' },
  { id: 'features', path: '/features',  group: 'product', labelKey: 'site.nav.features' },
  { id: 'platforms',path: '/platforms', group: 'product', labelKey: 'site.nav.platforms' },
  { id: 'pricing',  path: '/pricing',   group: 'product', labelKey: 'site.nav.pricing' },
  { id: 'help',     path: '/help',      group: 'support', labelKey: 'site.nav.help' },
  { id: 'changelog',path: '/changelog', group: 'support', labelKey: 'site.nav.changelog' },
  { id: 'signin',   path: '/signin',    group: 'account', labelKey: 'site.nav.signin' },
] as const;
```

它**同时驱动五件事**：

1. **Vite 的多入口配置**（`vite.config.ts` 直接 import 它生成 `input`）；
2. **生成的 HTML 文件**（一个模板 × N 页 × 2 语言，头部元信息从 i18n 取）；
3. **导航与页脚**（`Nav.tsx` / `Footer.tsx` 由 `group` 字段渲染）；
4. **`sitemap.xml`**（构建期生成，不再手写两个 URL）；
5. **可达性门禁**（§4 / A8）。

> 🔴 **这就是 N2 从"主张"变成"结构"的地方**：
> **没有一条路径能新增一个页面而不出现在导航里** —— 因为导航是注册表的**函数**，
> 不是另一份手写的清单。手写清单必然漂移，而漂移的清单正是孤岛的成因。

### 3.2 为什么不引入路由库

- 落地页是**内容站**不是应用，整页跳转完全可接受；
- 静态产物对 SEO 与 Core Web Vitals 都更好（这是这个页面存在的理由）；
- **不推翻**原裁决："不引入路由库"仍然成立，只是入口从 2 个变成 N 个；
- 🔴 而且多 HTML 入口让孤岛**更容易被门禁抓住**（§4 的 A8-1 可以纯静态扫描文件与链接）。

### 3.3 双语言怎么办：**语言是路径维度，不是入口维度**

保持现有约定（`/x` 与 `/en/x`）。注册表**不含语言**，语言由 `locale.ts` 的路径解析决定；
HTML 生成时为每个 locale 各生成一份。

### 3.4 🔴 N3 的另一半：应用 → 站点

新增构建期变量 `VITE_SITE_URL`，与现有 `VITE_APP_URL` **完全对称**：

| | 站点侧 | 应用侧 |
|---|---|---|
| 变量 | `VITE_APP_URL` | `VITE_SITE_URL` |
| 读用 | `apps/landing/src/lib/app-url.ts` | **新增** `apps/web/src/lib/site-url.ts` |
| 未配置时 | **整条入口不渲染** | **整条链接不渲染** |
| 校验 | 非 `http(s)` 一律当没配置 | **同一条规则** |

应用里的落点（**三个，不是一堆**）：

| 落点 | 指向 | 理由 |
|---|---|---|
| 设置页的「帮助与关于」区块 | `/help`、`/changelog` | 用户主动求助的位置 |
| 订阅/到期提示（`SubscriptionNotice`） | `/pricing` | 它自述"不存在可跳转的续费地址" —— 至少该指向价格页解释清楚 |
| 同步出错时的那句提示 | `/help` 的对应文章 | 出错那一刻是用户最需要帮助的时刻 |

🔴 **未配置时不渲染，而不是渲染一个猜测的地址。** 理由与 `app-url.ts` 文件头完全一致：
一个指向 404 的链接比没有链接更坏。**默认构建就是未配置**，这是刻意的。

---

## 4. 后果

### 4.1 必须配套的东西（否则这条决策落不了地）

| # | 配套 | 不做会怎样 |
|---|---|---|
| 1 | **A8 可达性门禁**（`check:site-reachability`） | N1–N3 只是几句主张；下一个人加页面时不会记得 |
| 2 | `seo-head.spec.ts` 从 2 个入口扩展到**全部页面** | 新增页面的 hreflang 会静默漂移 |
| 3 | `render.spec.tsx` 的"页内锚点"判据改成**整站链接图** | 孤岛照旧发现不了 |
| 4 | `sitemap.xml` 由注册表生成 | 手写的 sitemap 一定会漏页 |
| 5 | 部署 runbook 增加 `VITE_SITE_URL` 构建参数 | 应用侧链接永远不渲染 |
| 6 | 词条按页面分命名空间（`site.features.*` 等） | 词条表失控；`check:ui-language` 会成为噪音 |

### 4.2 接受的代价

- **入口数变多**（页数 × 语言数）。这是"真静态"的必要成本，且由生成器消化，不是人工维护量。
- **导航整页跳转**。对内容站可接受；不接受就得走选项 B，而那会牺牲 SEO 与 N2 的可验证性。
- **`VITE_SITE_URL` 未配置时应用里看不到那些链接**（默认构建）。这是刻意的诚实取舍，
  代价是"默认构建下 N3 不成立" —— 由 A8 门禁区分"**未配置**（跳过）"与
  "**配了但没人链过去**（报错）"。

### 4.3 🔴 与既有裁决的关系

- **不取代** `Landing.tsx` "不引入路由库" —— 那条仍然成立，本 ADR 只是把入口从 2 个扩到 N 个；
- **不取代** `app-url.ts` 的设计 —— 本 ADR 给它加了**镜像的一半**；
- **收窄**了"落地页是一个独立页面"这个隐含前提：从现在起它是**站点**，
  且站点与应用**同属一个产品的两张皮**。

---

## 5. 未核实项

1. **Vite `input` 是否支持"构建期从 TS 模块生成入口"** —— 倾向于支持
   （`vite.config.ts` 本身是 TS，可 import `src/` 下的模块），但**未实测**。
   若不支持，退路是一段小构建脚本在 `vite build` 之前生成 HTML 与入口清单。
2. **生成的 HTML 里的内联主题引导脚本**（防 FOUC）能否跨 12 个入口保持**逐字一致** ——
   现在 `seo-head.spec.ts` 有一条断言"两版引导脚本完全一致"，扩展后要按同一判据查全部入口。
3. **A8 门禁的形态**：是纯静态扫描（读注册表 + 读 `apps/web/src` 的链接），
   还是要真起浏览器走一遍？倾向前者 —— 更快、更稳，且"链接存在"本就是静态事实。
4. **应用侧三个落点的最终位置**未定，需要看过 `SettingsScreen` / `SubscriptionNotice`
   的实际布局后再定；本 ADR 只定**必须存在且指向哪里**。
5. **`/signin` 是跳板而不是真登录页**（理由见计划 D5），
   因此它**不需要**服务端改动 —— 但它仍然必须出现在导航里（N2）。

---

## 6. 落实记录（2026-09-28，**不改写上面的原文**）

§5 里那五条"未核实项"在实施中全部有了答案。按本仓库对 ADR 的规则
（[`docs/README.md`](../README.md)：ADR 原文不可改，更正以**勘误段**追加），
结论记在这里，而不是回改 §5。

| §5 | 问题 | 结论 |
|---|---|---|
| 1 | Vite `input` 能否从 TS 模块生成 | ✅ **能，而且比预期干净**：`vite.config.ts` 直接 `import { viteInputEntries } from './src/site/pages.ts'`。注册表只用 `import type` 引词条类型（编译期擦除），所以配置文件不依赖 `@heyta/i18n` 的运行时 |
| 2 | 14 份入口的引导脚本能否逐字一致 | ✅ 由 `scripts/entry-template.html` 保证（引导脚本只有一份），`tests/seo-head.spec.ts` 逐入口断言"与主入口逐字相同" |
| 3 | A8 门禁的形态 | ✅ **静态扫描**（与 ADR 的倾向一致），但**分成了两半**：站点内部的可达性由 `render.spec.tsx` 从**渲染出来的 DOM** 走（比读源码强：它连"组件存在但没挂上去"都能发现）；`apps/web` 那一半由 `app-mount.spec.tsx` 走真实 App。`check:site-reachability` 这条独立脚本**尚未落地**（归 W4/A8），当前两半都在测试层 |
| 4 | 应用侧三个落点的位置 | ✅ 定为：**设置页「帮助与关于」**（三个链接：帮助 / 更新动态 / 价格）+ **同步出错时**的「查看帮助」（直接落到 `/help#sync`）+ **托管到期提示**里的「价格与订阅」。第三处只放**说明**、不放续费入口（渠道未接通，`check:payment-entry` 会红） |
| 5 | `/signin` 是跳板且不需服务端改动 | ✅ 确认。它还**不进导航链接组**，而是挂在导航操作位（`inNav: false` + `Nav.tsx` 里显式渲染），因为「登录」与「立即使用」是两个意图，混进一列同质链接就没人找得到了 |

### 6.1 🔴 实施中发现的三件原文没预料到的事

1. **语言切换器会把人丢回首页。** `otherLocaleHref(locale)` 返回写死的 `/` 或 `/en/` ——
   站点只有一页时它是对的，有了子页面之后就成了"在 `/features` 点 English → 去英文首页"。
   地址栏看起来完全合理（`/en/` 确实存在），所以人工点几下不会发现。
   修法是把寻址收进 `src/site/paths.ts`，并加了一条**回归钉**
   （`tests/locale.spec.ts`："切语言保持当前页面"）。
2. **入口 HTML 不能手写。** §4.1 第 4 条只说了 sitemap 要生成；实际实施时
   入口 HTML 也必须生成 —— 14 份 × 六处头部差异 = 84 处可漂移点，
   而每一处的失败方式都是**静默少收一份流量**。现在由 `gen-entries.mjs` 生成，
   并签进仓库（`--check` 进 CI，拦住"改了注册表忘了重新生成"）。
3. **子页面上 `#selfhost` 是个死锚点。** 首页那一节的锚点被 `startCta()` 的
   退回分支复用之后，同一段代码搬到 `/features` 上就变成"点了没反应"。
   修法是退回目标改为**首页的绝对地址**（`/#selfhost`，见 `src/site/cta.ts`）。

### 6.2 与 §4.2 那笔代价的一处修正

§4.2 写的是"`VITE_SITE_URL` 未配置时应用里看不到那些链接（默认构建）"。
实施时没有这么做，理由是一个**已知事实**而不是猜测：`deployment.md` §3.3.1 定的是
**唯一域名**（站点 `/`、应用 `/app/`），所以站点就在**应用所在来源的根上**。
于是 `apps/web/src/lib/site-url.ts` 默认取 `window.location.origin`，
`VITE_SITE_URL` 只给**分域名部署**留口子。

这比原文的方案更符合 N3：默认构建下应用里的帮助入口**也存在**，
不必依赖"记得加构建参数"。代价是开发环境下那个链接会落回应用自己
（Vite 的 SPA 兜底），已在文件头如实写明。
