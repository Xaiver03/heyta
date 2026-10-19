# SEO：heyta 落地站点的审计、已改项与待拍项

> 状态：**进行中**（2026-10-19 立项，同一轮内已完成 §2 的全部改动与线上复验）

范围：**`apps/landing`**（线上 `https://heyta.waytofuture.cn`）—— 站点、sitemap、robots、
nginx 路由与各搜索引擎/站长平台的关系。**不含** `apps/web`（私有 SPA，`robots.txt` 已
`Disallow: /app/`）与 `docs.finlaw.cloud`（那是 SSOS 的文档站，另一套）。

配套决策草案：[ADR-0065](../adr/0065-prerender-for-non-js-crawlers.md)（预渲染，**待拍**）。

---

## §0 这份文档怎么读

分三块，**不要混着读**：

| 段 | 是什么 | 能不能当现状 |
|---|---|---|
| §1 | **实测基线**：2026-10-19 现量，每条带取证命令 | ✅ 可以，但要按命令复跑（会漂） |
| §2 | **这一轮已经落地的东西**（含线上读数） | ✅ 已改完并复验 |
| §3 | **明确不做 / 不能做的事**，逐条附理由 | ✅ 是结论，别"顺手"加回来 |
| §4 | **证据强度声明** —— 关键词那部分有多不可靠 | 🔴 必读，否则会把弱证据当结论 |
| §5 | 关键词方向与**缺页**（优先级建议） | ⚠️ 方向性，需在百度/Google 复核 |
| §6 | **要人拍的决策** | ⏳ 未拍 |
| §7 | 未闭合的读数 | ⏳ |

---

## §1 实测基线（2026-10-19）

### 1.1 站点的技术 SEO 基建**已经很厚**，不是从零开始

生成式入口（`apps/landing/scripts/gen-entries.mjs`）把 `<html lang>` / `<title>` /
description / canonical / hreflang 三件套 / `og:*` / JSON-LD 全部从
`src/site/pages.ts` + `packages/i18n` 派生。现量 **38 页 × 2 语言 = 76 份入口**
（`gen-entries.mjs --check` 报 **80 份产物**，多出来的 4 份是 sitemap、robots 与两张 404 页）。

| 项 | 读数 | 怎么取的 |
|---|---|---|
| sitemap 条数 | **76** `<loc>` | `curl -s …/sitemap.xml \| grep -c '<loc>'` |
| sitemap 里每一条是否真的 200 | **76 / 76 全 200** | 逐条 `curl -o /dev/null -w '%{http_code}'` |
| robots.txt | 200、1236 B、`Allow: /` + `Disallow: /app/` + 绝对 Sitemap | `curl -s …/robots.txt` |
| 头部契约（canonical / hreflang / og:url / JSON-LD） | 76 份入口逐份成立 | `pnpm --filter @heyta/landing test`（`tests/seo-head.spec.ts`，1414 条全绿） |
| JSON-LD 里的假数据 | `offers` / `aggregateRating` / `review` **0 处** | 同上，判据作用在**解析后的数据**上 |

### 1.2 🔴 最大的结构性缺口：**正文全靠 JS，非 JS 爬虫拿到 0 字节正文**

```
$ curl -s https://heyta.waytofuture.cn/features/ | grep -o 'id="root"[^>]*>[^<]*'
id="root">
```

`#root` 是空容器（ADR-0033 §7.1 早就如实登记过这件事）。用不执行 JS 的抓取器取
`/features/`，**只有 `<title>`，正文一个字节都没有**。

⇒ 对 **Google / Bing**（会执行 JS）影响有限；对**百度 / 搜狗 / 360**（JS 渲染不可靠或没有）
就是"这一页没有内容"。这一条已单列成 [ADR-0065](../adr/0065-prerender-for-non-js-crawlers.md) 待拍。

### 1.3 整站软 404（**已修**，读数见 §2.1）

改前：`/no-such-page-xyz/`、`/docs/no-such/` 一律 **200 + 7022 B 落地页字节**。
`docs/runbooks/deployment.md` 自己就把这个现象叫**软 404**（G-25b 那一节），只是当时只修了
`/legal/*` 一个前缀。

### 1.4 站长平台：**一个都没接**

| 平台 | 现状 | 证据 |
|---|---|---|
| Google Search Console | **未验证本域名** | ✅ **已独立核验（不是抄手册）**：`dig +short TXT waytofuture.cn @223.5.5.5`、`@119.29.29.29` 以及 DoH `https://dns.alidns.com/resolve?name=waytofuture.cn&type=TXT` 三方一致，**只有一条** `"v=spf1 include:qcloudmail.com ~all"` —— 没有任何 `google-site-verification`。（手册里那条验证 TXT 挂在 **`litopia.space`** 区，见 `deployment.md` §5.1）⇒ 接 GSC 时要在 **`waytofuture.cn`（DNSPod `waytofuture` 账号）新增**一条 TXT，不是"迁移已有的" |
| Bing / IndexNow | 未接 | 仓库里 `IndexNow` 零命中；`public/` 下无 key 文件 |
| 百度 / 搜狗 | 未接 | 无验证文件、无 `主动推送` token、无 `baidu-site-verification` meta |
| 流量分析 | **零**（刻意的？见 §6.3） | 仓库里 `gtag` / `plausible` / `umami` 零命中 |

🔴 **这一条才是"有没有流量"的总闸**：站点再怎么优化，没提交就基本不会被收。
它同时是 §6.2 那条待办。

---

## §2 这一轮已经落地的东西

### 2.1 整站软 404 → 诚实 404（**已上线**）

`server/deploy/nginx/heyta.waytofuture.cn.conf`：`location /` 与 `location /en/` 的
`try_files $uri $uri/ /index.html` → **`=404`**（`/en/` 另加 `error_page 404 /en/404.html`）。
按仓库纪律走完 **`--check` → `--apply`**（备份 → 写入 → `nginx -t` 通过才 reload），
`ssh finlaw` 与线上零漂移。

**线上读数（改前 → 改后）**：

| 地址 | 改前 | 改后 |
|---|---|---|
| `/no-such-page-xyz/` · `/docs/no-such/` | **200** + 7022 B（= 首页） | **404** + 5764 B（中文品牌 404 页） |
| `/en/no-such-page-xyz/` | **200** + 6976 B（= 英文首页） | **404** + 5786 B（**英文** 404 页） |
| sitemap 76 条 | 全 200 | **仍全 200** |
| `/`、`/en/` | 200 | **逐字节未变** |
| `/features`（无尾斜杠） | 301 | **301 → `/features/`** |
| `/app/`、`/app/nope-route` | 200 | **200**（前端路由未受牵连） |
| `/legal/nope-not-a-doc/` | 404 | **404**（G-25b 未被回滚） |
| `/api/nope` | 404 JSON | **404 JSON** |
| `/health` | 200 JSON | **200 JSON** |

⚠️ 本机先在 `nginx:alpine` 容器里验过语义（含**根路径 `/`** —— 线上没有先例），
线上复核后又逐条真取了一遍。详见 [`deployment.md`](../runbooks/deployment.md) §3.11。

**常驻判据**：`e2e/live-site/live-seo.spec.ts`（新增，7 条）。
⚠️ 我第一版把"本页地址"当成了"本页中文版的地址"，英文页因此变红 —— 那次红**恰好证明这条
判据能失败**，已改正并留注释。

### 2.2 `og:locale:alternate`（仓库已改，**要重新发布落地页才到线上**）

与 hreflang 说的是同一件事，但出口不同：hreflang 给搜索引擎，这一条给**分享卡片的抓取器**
（Slack / 微信读 OG）。76 份入口现在都带着它（中→`en_US`、英→`zh_CN`）。
映射收敛成 `gen-entries.mjs` 的 `ogLocale()` **一份**，并对没登记的语言**响亮失败**。

### 2.3 三个页面的 meta 标题（纯 SEO，**不动可见文案**）

只有 `site.*.seo.title` 变了 —— 它们只进 `<head>`（浏览器标签 + og:title），
页面上的 `<h1>` 走的是另一组键。**描述一律没动**：原文已经逐项列全，比新写一句更好核对。

| 页 | 改前 | 改后 |
|---|---|---|
| `/features/` | 功能介绍 —— heyta | heyta 功能：任务管理、四象限、番茄钟与习惯打卡 |
| `/platforms/` | 平台状态 —— heyta | heyta 支持的平台：Web、Windows、macOS、Linux、Android、iOS 的真实进度 |
| `/integrations/` | 数据在你手里 —— heyta | heyta 的差别：端到端加密、可自建服务器、数据在你手里 |

英文侧同步改（`en.ts`）。`/`、`/download/`、`/docs/`、`/changelog/`、`/signin/` 的标题
**已经含真实查询词或品牌词，故未动**。

### 2.4 顺带修掉的三类**已在仓库里说谎的话**

1. **写死的份数**：`entry-template.html` 与 `seo-head.spec.ts` 都写着"7 个页面 × 2 种语言 = 14 份"，
   而注册表早已 38 页 / 76 份 ⇒ 改成"由 `SITE_PAGES` 与 `LOCALES` 决定，这里刻意不写数字"。
2. **"nginx 的 SPA 兜底本来也是这样"**：`src/main.tsx`、`src/site/paths.ts`、
   `tests/locale.spec.ts` 三处拿它当客户端回落的**理由**。§2.1 之后那句不成立了 ⇒
   改成"理由只剩渲染树不能白屏"。
3. `gen-entries.mjs` 的 robots.txt 注释、nginx 的 robots/sitemap 与 `/legal/` 注释：
   凡引用兜底的地方都标成**历史形状**，并写明今天的事实。

### 2.5 新增两条真判据

- `tests/seo-head.spec.ts`：**生成物里不许残留没被替换的 `{{占位符}}`**
  （形状取 `\{\{[A-Z_]+\}\}`，**故意不匹配 `{{T:…}}`** —— 那是 404 模板注释里另一个替换器的写法，
  笼统匹配会对着注释假红，而假红会逼下一个人删注释）。
- `e2e/live-site/live-legal.spec.ts` 的**阳性对照换了机制**：原来探"根下未知路径仍须 200"，
  那**把整站兜底当成了被测对象的前提** ⇒ 修好软 404 时它按设计假红。现在探**已注册的真实页面**
  `/features/`（须 200 且字节里没有 404 页标记），两个架构下都成立。

### 2.6 description 那半：量出来只有一个真异常，已修

③ 要求"优化各页 title/**description**"。我一开始把英文侧当成了问题（它每条都是中文的 2–3 倍字符），
**这个读法是错的** —— 按页算 `英文/中文` 比值，九页全在 **2.23 ~ 2.97** 之间，那只是
"中文字符 → 拉丁字符"的正常膨胀，**不存在英文特有缺陷**。

按**相对**口径（避免自己发明"至少/至多 N 个字符"这类阈值 —— 那是本仓库明确拒绝过的写法）重算，
真正的异常只有一个：

| | 改前 | 改后 |
|---|---|---|
| 九个页面中文描述的中位数 | 63 字符 | 63 |
| 次长的一条 | 85（`help`） | 85 |
| **`/platforms/`** | 🔴 **163 字符**（英 363） | ✅ **67**（英 170） |

`/platforms/` 是**两种语言里唯一的离群值**（2.6× 中位数），而它逾出的部分**恰好是后半句那些
如实标注**（"Linux 的 .deb 还差一次装进系统的实测""鸿蒙能出包但还跑不起来"）——
也就是说**被截断掉的是最该被看到的那半边**。已改短两语言各一份，
逐端细节**没有丢**：它们本来就在这一页的状态表里逐条列着（那正是这一页存在的意义）。

`help`（85）**刻意留着**：它逐项列了帮助中心覆盖的主题，是那一页唯一的关键词载体。

复量命令（改完 description 后跑，不要抄上面的数字）：

```bash
# 打印九页中英描述长度 + 中位数 + 英文/中文比值，离群值自己会跳出来
node -e '
const fs=require("fs");
const load=f=>{const s=fs.readFileSync(f,"utf8"),m={},re=/^\s*.(site\.[a-z-]+\.seo\.description).:\s*.((?:[^\x27\\\\]|\\\\.)*).,/gm;let x;while((x=re.exec(s)))m[x[1]]=x[2];return m};
const zh=load("packages/i18n/src/locales/zh-CN.ts"),en=load("packages/i18n/src/locales/en.ts");
const rows=Object.keys(zh).map(k=>k.split(".")[1]).map(id=>[id,[...zh["site."+id+".seo.description"]].length,[...en["site."+id+".seo.description"]].length]);
const zs=rows.map(r=>r[1]).sort((a,b)=>a-b);
console.log("中文中位数 =",zs[Math.floor(zs.length/2)]);
for(const [id,z,e] of rows.sort((a,b)=>b[1]-a[1]))console.log(String(z).padStart(4),String(e).padStart(5),(e/z).toFixed(2),id);'
```

---

## §3 明确**不做**的事（逐条附理由，别顺手加回来）

结构化数据那四条已在 `entry-template.html` 里就地登记（避免下一个人重新讨论一遍）：

| 没做 | 理由 |
|---|---|
| `BreadcrumbList` | 文档页**没有可见面包屑**（`DocsShell` 只有顶栏 logo→枢纽 + 一个首页链接）。给页面上不存在的层级做标记 = "给搜索引擎看、给用户看不了" |
| `Organization` | 没有 ≥112×112 的**方形位图**商标（只有 SVG favicon 与 1200×630 分享卡）；且 heyta 目前不是一个已登记的组织实体 |
| `WebSite.potentialAction`（SearchAction） | 站内搜索是**纯前端**的，没有可被抓取的搜索 URL 形状 ⇒ 声明一个不存在的端点就是编数据 |
| `Article` / `TechArticle` | 帮助文章**没有逐篇的发布/更新时间**，而那是这两个类型的承重字段 |
| sitemap 的 `<lastmod>` | 这份 sitemap 是**签进仓库的生成物**、由 `--check` **逐字节**对账。lastmod 只有两个来源，都会把对账变噪音：构建时刻（同 commit 不同机器不同字节）与 `git log`（浅克隆/无 `.git` 取不到）。而 Google 只采信"可核实的准确"lastmod |
| 在**生成的 HTML** 里写价格（JSON-LD 那处） | 价格只在词条表里写一次，`check:pricing` 核对那几处。写进生成物就是**又一处**，而**门禁扫不到生成的 HTML** |
| ~~在 `pricing` 的 meta 描述里写价格~~ | 🔴 **这一条是我写错了，已撤回。** 我按"meta 在生成的 HTML 里 ⇒ 扫不到"推理，但**它的源在 `packages/i18n/src/locales/*.ts`，而那整张表是被扫的**（`check-pricing-consistency.mjs` 的 `sweepNoUnapproved(read(file), '全表')`）。用变异证实：把 meta 描述里的托管价 `¥5` 改成 `¥9`（四处事实源一字未动），门禁立刻红在「zh catalog 全表 里有 ¥9」。⇒ 价格写进 i18n 词条可以（现存的 `site.pricing.seo.description` 本来就写着 ¥5/¥12 并通过），**写进 JSON-LD 不行** |
| ~~IndexNow key + 推送脚本~~ | 🔴 **已撤回（2026-10-19 当天就做了，读数见 §8.5）。** 原判断是"现阶段价值低 + 不建没人跑的自动化"。撤回的理由不是"价值变高了"，而是那个前提**被证伪**：它零账号、零登录、零前台，是 objective ② 里唯一不需要人介入的一格 ⇒ "没人跑的自动化"不成立。⚠️ 但它**不是 Google 的通道**（Google 不参与 IndexNow），**不能替代** GSC / Bing 的所有权验证 —— 那两件事仍然要做 |
| 给 `/signin/` 加 `noindex` | 它是真页面、用户会搜"heyta 登录"；"页面短"不是 noindex 的理由（移出 sitemap 也不等于禁止索引） |

---

## §4 🔴 证据强度声明（关键词那部分）

这一轮的关键词调研**不能当结论用**，原因有三条，都是实测的：

1. **`web_search` 是坏的**：调用返回
   `HTTP 401 Authentication Fails … endpoint "https://api.deepseek.com/anthropic/v1/messages"`。
   ⇒ 拿不到任何搜索量数据，也拿不到 Google/百度侧证据。
   **修法只有你能做**：Settings → Plugins → Plugin configuration → **Web search** 换一个
   可信的 Anthropic 兼容端点（或设 `DEEPSEEK_SEARCH_BASE_URL`）。
2. **绕道 `cn.bing.com` 抓 SERP 的结果不可靠**，而且这一点我**自己复现了**：
   用站点的**精确标题**`"heyta：本地优先的任务管理"`去搜，Bing CN 返回的十条里**全是
   BOSS直聘 / 游戏 boss 攻略** —— 分词退化到把查询切成了 `boss`。
   ⇒ 那份调研里所有"这个词下没有对应内容"的结论，**都可能只是 Bing 分词问题**。
3. **`site:heyta.waytofuture.cn` 显示 0 条**，但基于第 2 条，这条**不能当"未被收录"的事实**。
   已在 §7 记为未闭合。

⇒ **凡是"搜索量""排名""有没有收录"这类判断，本轮一条都没有成立。** 下面 §5 是**方向**，
不是测量结果；要做真判断，得先修好 `web_search` 并在百度/Google 侧复核。

---

## §5 关键词方向与**缺页**（方向性，需复核）

### 5.1 现有页面的主打词（建议，尚未落地到文案）

| 页 | 主打词 | 为什么是它 |
|---|---|---|
| `/` | heyta、本地优先 任务管理 | 品牌词零覆盖，先占品牌 |
| `/features/` | 四象限 任务管理、番茄钟、习惯打卡 | 已在 §2.3 落到标题上 |
| `/download/` | 待办事项 app 下载、离线 待办 | 下载意图明确、竞争相对小 |
| `/platforms/` | 多端同步、电脑版 待办 | 已在 §2.3 落到标题上 |
| `/pricing/` | 自建 免费、开源 待办 免费 | 承接"免费/不收费"意图 |
| `/docs/selfhost/` | 自托管 任务管理、自建 待办 服务器、NAS 部署 | 站内已有这篇，但标题未按此写 |

### 5.2 🔴 真正的缺口是**页不存在**（这才是内容侧的最大杠杆）

| 建议新页 | 优先级 | 依据（**弱证据**，见 §4） |
|---|---|---|
| `/compare/ticktick/`（滴答清单替代/对比） | **最高** | "滴答清单替代"的几个变体在 Bing CN 上的 top10 里**没有一篇真正的对比文**，被 dida365 官网 + 百科占据 |
| `/self-host/`（自建/NAS 部署落点页） | 高 | "自托管 任务管理""NAS 待办清单 自托管"的 SERP 上**没有具体应用的落地页**，全是 NAS 厂商与泛开源内容 |
| `/focus/`、`/habits/`（场景页） | 中 | 四象限 / 习惯打卡两个词没有落点 |
| `/alternatives/`（替代品枢纽） | 中 | 内链枢纽，喂给 compare 页 |

🔴 **写 compare 页的三条硬约束**（否则会同时被读者和搜索引擎判成不可信）：
① 必须写出滴答清单**真实的优势**（生态、协作、日历集成），不是软文；
② 不许出现"最好的""第一""吊打"这类无据断语；
③ **不许造搜索量数字** —— 本仓库的判据是"说了的必须能核对"。

🔴 **不要用模板批量产出几十个"XX替代/XX对比"页**：那是这类站点被判低质最常见的方式，
而 heyta 现在**没有任何自然搜索资产**可用来扛一次低质判定。

---

## §6 要你拍的决策

| # | 决策 | 状态 |
|---|---|---|
| 6.1 | **预渲染**（让非 JS 爬虫看到正文）—— 方案与取舍写在 [ADR-0065](../adr/0065-prerender-for-non-js-crawlers.md) 草案里 | ⏳ **待拍** |
| 6.2 | **站长平台接入**：Google Search Console、Bing（可从 GSC 导入）+ IndexNow、百度搜索资源平台（验证 + `主动推送`）。**都需要你的账号会话**，我做不了。🔴 已核实两个起点：① **GSC 的 DNS 验证要在 `waytofuture.cn` 区「新增」一条 TXT** —— 三方独立查过（§1.4），那个区现在**只有 SPF 一条**，没有可迁移的验证记录；② 站点已具备落地条件：站点根下任意真文件都会被 `try_files $uri` 正常服务（`favicon.svg`、`og-card.png` 都 200），所以 **HTML 文件验证那条路不需要改 nginx** | ⏳ **待你给会话** |
| 6.3 | **要不要装流量分析**：现在全站**零分析**。没有它，"这条改动有没有用"永远只能靠猜；但装任何第三方都会与"本地优先/不追踪"的产品口径**直接冲突** —— 这是一条产品决策，不是技术决策 | ⏳ **待拍** |
| 6.4 | §5.2 那两个缺页要不要立项（尤其 compare 页） | ⏳ **待拍** |
| 6.5 | §2.3 的三个新标题是否认可（可随时改回，纯 meta） | ⏳ **待你过目** |

---

## §7 未闭合的读数

| # | 是什么 | 为什么没闭合 | 怎么闭合 |
|---|---|---|---|
| 7.1 | 站点到底有没有被 Google/Bing 收录 | `web_search` 401；Bing CN 分词退化（§4） | 修好 `web_search`，或接上 GSC/Bing 后看"覆盖率"报告 |
| 7.2 | 百度/搜狗能不能抓到正文 | 无法在本地判断百度的 JS 渲染行为 | 接上百度站长平台后用"抓取诊断"跑一次 `/features/` |
| 7.3 | `og:locale:alternate` 的**线上**读数 | 落地页**未发布**（发布脚本 `publish-public-sites.mjs` 拒绝发"不是正好 `main` 那一笔"的字节） | 提交后跑 `node research/tools/publish-public-sites.mjs --confirm`；`live-seo.spec.ts` 里那条会随之转绿 |
| 7.4 | §5 的关键词方向 | 单一引擎 + 分词退化 | 修好 `web_search`，在百度/Google 侧复核 |
| 7.5 | 结构化数据的效果 | 无数据源 | 与 7.3 同批 |

---

## §8 2026-10-19 第二轮：落地页已发布；站长平台卡在一个可复现的技术点上

### 8.1 §7.3 已闭合：落地页发布了，那条"按设计红"的判据转绿

`node research/tools/publish-public-sites.mjs --confirm` **九步全过**（守卫读数：`HEAD=main=8f1b6b87`、
构建输入脏条目 0 条），第 9 步线上验收 **43 项全过**（含 `live-seo.spec.ts` 里原来那条
`og:locale:alternate`）。独立复验（`curl --noproxy '*' --resolve …`）：

| 读数 | 值 |
|---|---|
| `/features/` 的 `<title>` | heyta 功能：任务管理、四象限、番茄钟与习惯打卡 |
| `og:locale:alternate` | `en_US`（中文页） |
| `/platforms/` 描述长度 | **67 字符**（改前 163） |
| `/app/` 的 asset | `index-98hf1W_J.js` —— **与发布前逐字相同** |
| `/`、`/features`、`/nope-xyz/` | 200 / **301** / **404**（软 404 修复未回退） |

🔴 **发布前我先证明了"这次发布对应用是空操作"**：从 HEAD 构建 `apps/web` 得到的 asset 是
`index-98hf1W_J.js`，与线上正在服务的那一枚逐字相同 ⇒ 发布只会更新落地页。
这条判据值得复用 —— 发布脚本会**同时**发两个站点，而"应用会不会被顺带换掉"是个必须回答的问题。

### 8.2 站长平台：卡在"Wiz 浮层在隐藏标签页里不生成"

取证（每一步都是回读，不是推断）：

1. 登录态**一直是好的**：页面里 `accounts.google.com/RotateCookiesPage` iframe 在、顶栏有
   `manage_accounts` 用户设置入口。⚠️ 我先前两次凭 **URL 没变** 报"你还没登录"是**错的**
   （`/search-console/welcome` 登录前后同一条 URL，它就是登录后的「添加资源」页）。
   这条教训已反哺进 `portal-form-filling` skill。
2. 点「添加网站」会弹出**资源类型选择层**（网域 / 网址前缀）—— 我在 Chrome 处于前台时
   成功弹出过一次，并读到了两张卡与两个输入框（`aria-label` 分别是 `example.com` 与
   `https://www.example.com`）。
3. 🔴 **⚠️ 这一条我最初判错了，已于 2026-10-19 当天证伪并重写。** 我先据两次观察认为
   "后台标签页里浮层不生成"，并据此给了用户一条**错误的出路**（见 §8.3，已撤回）。
   **实测证伪**：浮层在 `document.visibilityState === 'hidden'` 的标签页里**照样完整渲染** ——
   链上每层 `visibility:visible`、`opacity:1`、`transform:none`。**窗口可见性从来不是成因。**
4. **真正的成因**：那个「继续」是 Wiz 的 `div[role="button"] jsaction="click:cOuCgd; …"`，
   **不吃合成事件**（`isTrusted:false` 改不了）。证据链见 §8.8 —— 其中决定性的一条是
   **点击后 `performance` 零新请求**，证明处理器根本没被调用。
   ⚠️ 注意区分控件族：同一页上的真 `<button>`（「添加网站」）用 `.click()` **是打得动的**
   （浮层就是它打开的）。
5. 而用户的规则（也已写进 skill）是：**只有登录/验证码才抢前台，代理填表必须后台运行。**
   ⇒ 在"合成事件无效"这一格上，规则与能力**并不冲突**（冲突是我误判出来的），
   真正需要的是**换通道**（CDP）或**交还用户**。

### 8.3 两个都不需要我抢前台的出路（任选一条，我立刻继续）

1. ~~**把 Chrome 窗口挪到屏幕一角/缩小，让它在你的 App 旁边"不全被遮挡"**~~
   🔴 **已撤回（2026-10-19 当天证伪）**：挪窗口**没有用**。它当初基于的机制判断
   （"隐藏标签页不生成浮层"）是错的；实测浮层在隐藏标签页里照样完整渲染（§8.2 第 3 条），
   而卡点是**控件不吃合成事件**（§8.2 第 4 条 / §8.8）—— 与窗口位置、与前台都无关。
   **替代出路**：让 Chrome 用 `--remote-debugging-port=9222` 重启（C2/CDP；
   `Input.dispatchMouseEvent` 是可信事件，且 CDP **不需要窗口在前台**）。
   代价：需要你重启一次 Chrome（标签会被 Chrome 自己恢复），且这是**你**的动作。
2. 或者你亲手做 3 下（你已在登录态，10 秒）：点「添加网站」→ 在**右边那张「网址前缀」卡**里
   输入 `https://heyta.waytofuture.cn/` → 点该卡的「继续」。然后把验证方式那一步的
   **HTML 文件内容**（形如 `google-site-verification: googleXXXX.html`）贴给我，
   **剩下全是我做**：写进 `apps/landing/public/`、提交、一条命令发布、点验证。

### 8.4 本轮顺带查实的环境事实（会复现，值得记）

- 🔴 **`tccli` 对 `waytofuture.cn` 无权限**：`DescribeRecordList` 回
  `OperationDenied.NoPermissionToOperateDomain`，而本机只有一套凭据（带 STS token 的临时凭据）。
  ⇒ **GSC/百度若要 DNS TXT 验证，得先换成拥有 `waytofuture.cn` 的那个腾讯云账号**；
  也正因如此，§8.7 的作战图走的是 **HTML 文件**验证而不是 DNS。
- ⚠️ **代理会瞬时抖**：`location.reload()` 曾把 GSC 标签打成
  `chrome-error://chromewebdata/` + `ERR_PROXY_CONNECTION_FAILED`；同一分钟内复测
  `curl -x http://127.0.0.1:7890 https://www.google.com/` 回 **302**（通），
  直连则是 connection reset（大陆常态）。⇒ 那次是抖动，不是配置错；标签已恢复。
  系统代理是 `127.0.0.1:7890`（iKuuuVPNC 在听）。

### 8.5 ✅ IndexNow 已接入（objective ② 里第一格真正闭合的，也是唯一不需要人介入的一格）

IndexNow 是**不需要账号**的索引提交协议：站点根放一枚 `<key>.txt`（内容就是 key 本身），
之后把 URL POST 给 `https://api.indexnow.org/indexnow` 即可。它覆盖 **Bing / Yandex /
Seznam / Naver**；🔴 **Google 不参与 IndexNow**，所以它不替代 GSC/Bing 的所有权验证。

**做法**（按仓库纪律做成生成物，而不是 `public/` 下手写一份）：

| 落点 | 作用 |
|---|---|
| `apps/landing/src/site/indexnow.ts` | 键值的**唯一一份定义点**（含"为什么可以签进仓库"：按协议它必须公开可取） |
| `gen-entries.mjs` 生成 `public/<key>.txt` | 与 sitemap / robots 走**同一条** `check:entries` 逐字节对账；内容**刻意不加结尾换行**（精确值在"会 trim"与"逐字节比"两种校验器下都成立） |
| `tests/seo-head.spec.ts` | 离线判据：内容逐字等于 key 且符合协议字符集/长度。⚠️ 它与 `--check` **管的不是同一件事** —— 有人给它包 JSON 或补换行时，生成器与生成物一起变、`--check` 照样绿，而协议就不认了 |
| `e2e/live-site/live-seo.spec.ts` | 线上判据：键文件真能取到且内容一致（**刚把整站兜底改成 `=404`，"站点根下的单个文件"正是最容易被顺手 404 掉的东西**） |

**读数（全部实测）**：

| 项 | 值 |
|---|---|
| `check:entries` | 81 份（加这一枚键文件） |
| 落地页测试 | **1415 条全绿** |
| 线上 `GET /5df57f5b75d4db6e6aaa93c188a4f9b9.txt` | **200**、**32 字节**、内容逐字一致 |
| 发布链 | `publish-public-sites.mjs --confirm` **九步全过**、线上验收 **44 项全绿** |
| **IndexNow 提交** | `POST https://api.indexnow.org/indexnow`，**76 条 URL**（取自 sitemap），**HTTP 202 Accepted** |

⚠️ **202 的含义**：URL 已接收，key 校验随后生效（不是 200，也不是失败；403 = key 找不到、
422 = URL 不属于该 host）。**「已提交」不等于「已收录」** —— 收录要等，且只能从
Bing 站长平台的覆盖率报告里读，那一格仍属于 §6.2。

#### 这一格顺带留了一个值得复用的判据形状

我第一版线上判据用 `filter(f => f.endsWith('.txt'))` 挑键文件 ⇒ **`robots.txt` 也被收进来**，
判据因为**自己的探针**变红、发布链卡在第 9 步，而同一时刻 `curl` 那枚键文件回
200 / 32 字节 / 内容逐字一致 —— **红的不是被测对象**（元规则 1 的又一实例）。
改用**协议自身的性质**当判据：键文件按定义就是「一个 `.txt`，其内容等于它自己去掉后缀的文件名」。
既不靠"排除 robots.txt"这类会漂的白名单，也能在未来往 `public/` 加别的 `.txt` 时保持正确。

### 8.6 Bing 站长平台：已就位，等一次登录

`open_owned_tab.sh` 开了一枚**自己认领的**标签（没碰用户原有的 7 枚），URL
`https://www.bing.com/webmasters/home` → 落到 `…/webmasters/about?from=home`，
页面标题 `Bing Webmaster Tools`、**未登录**、登录入口是 `Sign In`。
Chrome 已被顶到前台并选中该标签（**登录是唯一允许抢前台的场景**，规则见 skill）。

为什么值得先做 Bing 而不是等 GSC：**它能拿自己的验证文件（`BingSiteAuth.xml` 或 meta 标记），
不依赖 GSC** —— 而"把文件发到站点根"这件事我完全能自己做（刚做过一次 IndexNow 键文件）。
它另外支持**用 Google 账号一键登录**，而用户的 Google 已经登录着。

**2026-10-19 12:5x 的实际进展（用户已开始登录）**：那枚标签落到了
`https://login.microsoft.com/consumers/fido/create?mkt=zh-CN`，页面标题「登录到您的帐户」、
正文「**正在设置密钥**…你的设备正在打开安全窗口。按照说明完成密钥设置。」、按钮「下一步」
—— 也就是微软在请用户**创建通行密钥（passkey）**。

🔴 **这是只有用户能做的身份动作，我停手**（objective ③ + skill 的交还用户清单：密码/证书/
实名或人脸核身/短信与语音验证码/滑块/签名/正式提交/缴款）。本轮我对浏览器**一个动作都没做**，
连切标签都没切 —— 用户正走在这个流程里，切前台或切标签都会打断他。
我只做了**一次后台只读的 DOM 读**（读是代理动作，不需要前台，也不改变页面状态）。

⚠️ 顺带一条现场事实：Chrome 现在有**两扇窗口**（id `1403923272` 与 `1403923025`），
我认领的那两枚标签都在后者里（GSC 在 7 号、Bing 在 8 号）。
⇒ 按标签投 JS 时窗口 id 必须**现取**，别缓存（`tab_inventory` 第二列是**序号**不是 id，见陷阱 #491）。

登录完成后我做的第一件事是读 DOM 确认登录态（**不拿 URL 当证据**，见 §8.2 第 1 条），
然后取验证文件 → 写进 `apps/landing/public/` → 提交 → 一条命令发布 → 点验证 → 提交 sitemap。

#### 8.5.1 追加读数：IndexNow **key 校验已通过**（202 + 200 是两件事，别混）

| 动作 | 端点 | 读数 | 含义 |
|---|---|---|---|
| 批量提交 76 条 URL（POST JSON） | `api.indexnow.org/indexnow` | **202 Accepted** | URL 已接收，**key 校验待定** |
| 单条 URL（GET `?url=&key=`） | 同上 | **200 OK** | key **已校验通过**，提交生效 |

⚠️ **202 与 200 不是同一件事**：202 只说"收到了"，200 才说"key 有效、这次提交算数"。
按协议其它取值：400 = 请求格式错、**403 = key 找不到**（键文件没发出去或被路由吃掉）、
422 = URL 不属于该 host / key 与 host 不匹配、429 = 提交过频。
⇒ 所以"提交成功"的正确判据是 **200**，不是"请求没报错"。

### 8.7 逐字段作战图（通道推不动门户时的规定交付，按 skill 的 `field-evidence-template.md` 形状）

**为什么要有它**：GSC 的浮层在**隐藏标签页里不生成**（§8.2 第 3 条），而规则不允许我为了填表抢前台。
所以这里有两条路，任选：
**(甲) 你把 Chrome 窗口挪到不完全被遮挡 ⇒ 我全程后台自己做完**（§8.3 出路 1，机制已确认、仍待实测）；
**(乙) 你按下面这张表点几下，把平台给的 token 贴给我 ⇒ 剩下全是我做**（写文件、提交、发布、点验证）。

#### 甲表 · Google Search Console（目标：**网址前缀**资源 + **HTML 文件**验证）

| # | 你做什么 | 值 / 形状 | 证据来源与备注 |
|---|---|---|---|
| 1 | 在 `search.google.com/search-console/welcome` 点 **「添加网站」** | — | 会弹出「请选择资源类型」两张卡 |
| 2 | 在**右侧那张「网址前缀」卡**的输入框里填 | `https://heyta.waytofuture.cn/` | 🔴 **不要用左侧「网域」**——那条**必须 DNS 验证**，而本机 `tccli` 对 `waytofuture.cn` **无权限**（§8.4，实测 `OperationDenied.NoPermissionToOperateDomain`） |
| 3 | 点**该卡**的「继续」 | — | ⚠️ 两张卡**各有一个「继续」**，位置分别约在 x=674 / x=1054（2026-10-19 实测坐标，会随窗口大小变）；点错就走到网域那条路 |
| 4 | 验证方式选 **「HTML 文件」** | 会给你形如 `googleXXXXXXXX.html` 的文件，内容一行 `google-site-verification: googleXXXXXXXX.html` | **把文件名 + 那一行内容原样贴给我** |
| 5 | 剩下我来 | — | 写进 `apps/landing/public/<文件名>` → 提交 → `node research/tools/publish-public-sites.mjs --confirm` → 我点「验证」→ 提交 sitemap |

#### 乙表 · Bing Webmaster Tools（目标：`BingSiteAuth.xml` 验证）

| # | 你做什么 | 值 / 形状 | 备注 |
|---|---|---|---|
| 1 | 登录（**进行中**：微软在请你创建通行密钥，见 §8.6） | 可用 **Google 账号**一键登录（你的 Google 已登录） | 通行密钥属**只有你能做**的动作，我不代做 |
| 2 | 「添加网站」→ 填 | `https://heyta.waytofuture.cn/` | 也可只填域名，但与我们 canonical 一致更省事 |
| 3 | 验证方式选 **「XML 文件」** | 会给你 `BingSiteAuth.xml` 与一个 `<user>` token | **把 token 贴给我**（形状：`<users><user>TOKEN</user></users>`） |
| 4 | 剩下我来 | — | 生成 `public/BingSiteAuth.xml` → 提交 → 发布 → 我点验证 → 提交 sitemap（Bing 也吃 IndexNow，那半边已通，见 §8.5） |

#### 丙表 · 百度搜索资源平台（可选，但中文市场主要入口）

| # | 你做什么 | 值 / 形状 | 备注 |
|---|---|---|---|
| 1 | 登录 `ziyuan.baidu.com` → 添加站点 | `https://heyta.waytofuture.cn` | 需要百度账号 |
| 2 | 验证方式选 **「文件验证」** | 会给你 `baidu_verify_codeva-XXXXXX.html`，内容一行 `codeva-XXXXXX` | 把文件名 + 内容贴给我（也可选 CNAME 或 meta 标签，那两种要么要 DNS 权限、要么要改模板） |
| 3 | 剩下我来 | — | 同上 |
| 4 | 之后（需要你） | 「普通收录 → sitemap」提交 `https://heyta.waytofuture.cn/sitemap.xml`；若要「API 提交」需在平台上取 token | 主动推送是**需要账号**的动作，§6.2 |

**搜狗 / 360**：同样是登录 + meta/文件验证，形态与上面一致。**建议等 GSC/Bing/百度三家跑通再开**，
避免同时维护四个平台的验证状态（这不是技术限制，是注意力成本）。

#### 🔴 这些验证文件与仓库其他生成物**形状不同**，别套用

- **必须逐字节等于平台给的内容**：`BingSiteAuth.xml`、`baidu_verify_codeva-*.html`、
  `google*.html` 都不许加注释头、不许加结尾换行、不许"顺手格式化"。它们的**事实源是平台**，
  不是仓库里的某个常量 —— 所以它们**不进** `gen-entries.mjs` 的生成集，也不受 `--check` 保护。
- 代价是它们**没有逐字节对账**：所以每加一枚，就同时加一条 `e2e/live-site/live-seo.spec.ts` 判据
  「线上可取 + 内容逐字相等」（形状照 §8.5 那条 IndexNow 判据抄，**挑文件要用协议自身的性质，
  别用白名单** —— 我第一版就是死在 `endsWith('.txt')` 收进 `robots.txt`）。
- 🔴 **不要删**已生效的验证文件：删了等于撤回所有权，平台会在下次复核时取消已验证状态。

⏳ **两条路都等你**：甲路你挪一下窗口；乙路你贴 token（Bing 的登录你已经开了头）。我这边随时可以一条命令接着做。

### 8.8 决定性判据：Wiz 的 `jsaction` 按钮**不吃合成事件**（三条排他 + 一条正面证伪）

这一节是上一条结论的证据链。它值得单独留着，因为**三条"看起来像"的成因都被排除了**，
而排除手法本身可复用。

| 试过的 | 结果 |
|---|---|
| 裸 `element.click()` | ❌ 没前进 |
| `pointerdown→mousedown→pointerup→mouseup→click` 完整序列（带坐标、`composed:true`、`pointerId/isPrimary`） | ❌ 没前进 |
| `pointerdown+mousedown` 与 `pointerup+mouseup+click` **拆两次投递、中间隔 600ms**（怀疑"按下/抬起要有时间差"） | ❌ 没前进 |

**排他 1 · 不是没渲染**：浮层链上每层 `visibility:visible`、`opacity:1`、`transform:none`；
按钮矩形正常（`x=1009, y=636, w=90, h=38`）。

**排他 2 · 不是按钮禁用，而且受控输入那一步是成功的**：目标按钮的 `aria-disabled` 已从 `"true"`
变成 `null`，而同一浮层里**另一张卡**的按钮仍是 `"true"` —— 说明应用确实按我填的值重新校验过。
输入框的 `data-initial-value` 也已落上 `https://heyta.waytofuture.cn/`。
⚠️ **别拿 class 里的 `RDPZE` 当禁用判据**：两张卡的按钮**都带它**，它不区分。

**排他 3 · 不是网络失败 —— 判据在这里**：

```js
window.__netBefore = performance.getEntriesByType('resource').map(e => e.name);
// …派发点击…
performance.getEntriesByType('resource').filter(n => !window.__netBefore.includes(n))
```

实测 **59 → 59、零条新请求** ⇒ **动作处理器根本没有被调用**。
这条判据把"事件没被接受"与"处理器跑了但请求失败"分开了 —— 两者在界面上**同形**（什么都不发生）。

**正面证伪（同一页、同一刻的对照）**：页面上的**真 `<button>`**（「添加网站」）用裸 `.click()`
**就打开了浮层**。⇒ 差别在**控件族**，不在"能不能发事件"：真 `<button>` 有原生 click，
而 Wiz 的 `div[role="button"]`（`jsaction="click:cOuCgd; mousedown:UX7yZ; mouseup:lbsD7e"`）不接受
`isTrusted:false` 的事件。

🔴 **连带撤回我自己的一条机制判断**：我先前据两次观察认为"后台标签页不生成浮层"，
并据此把"挪窗口"当成出路（§8.3 第 1 条，已撤回）。**实测证伪**：浮层在
`document.visibilityState === 'hidden'` 的标签页里照样完整渲染，`raf` 补丁也不是必需。
**窗口可见性从来不是成因。**

**反哺**：这一条已写进 skill 的通道能力边界
（`portal-form-filling/references/chrome-applescript-channel.md` 的
「2026-10-19 补测」小节）—— 那里原先把这类控件标成"**仍属未测，别外推**"，现在成了**已证实**。
