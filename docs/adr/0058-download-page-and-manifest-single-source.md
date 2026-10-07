# ADR-0058：下载面与状态面分家，直链只由发布清单决定

- 状态：已接受（2026-10-07）
- 相关：[ADR-0033](0033-multi-page-site-and-bidirectional-reachability.md)（多 HTML 入口 + 注册表派生）、
  [ADR-0035](0035-ai-tool-calling-reuses-local-api.md)（同一能力不许长第二份实现，同一个理由）
- 被改写的既有裁决：`docs/research/site-ia-and-landing-audit.md` §3.2 第 3 行
  与 §4 表里那一句「下载页 → 改形态做成平台状态页，**不叫下载**」

## 1. 问题

落地页原先只有一张 `/platforms`，它同时被要求回答两个不同的问题：

1. 「**我现在这台机器怎么拿到它**」（首访访客的问题，要的是出口）；
2. 「**五个端各到哪一步了**」（进度问题，要的是诚实的状态）。

2026-09-29 那一轮按对标结论选了 (2)，并把 (1) 判为"现在做不了"——依据是当时**没有可发布的包**
（桌面包未签名未公证）。这个依据当时成立，今天只对一半：

| 事实 | 证据（2026-10-07 现量） |
|---|---|
| macOS 包已 Developer ID 签名并通过 Apple 公证 | `codesign -dvv` 的 `Authority=Developer ID Application: …(V5S2LT9YV8)`；`spctl -a -t install` → `accepted / source=Notarized Developer ID`；`xcrun stapler validate` → worked |
| 公开分发通道早就在线 | 桶 `heyta-dist-1380503169` 整桶公开读，`app-releases/heyta/latest/latest.json` 自 2026-09-30 起匿名 200（`docs/runbooks/app-distribution.md` §2/§4） |
| 其余各端仍不可直链 | Android 当前产物 `apksigner` 读出的证书是 `CN=Android Debug`；Windows MSIX 由 `New-SelfSignedCertificate` 签；`.deb` 的 `dpkg -i` 那一格未验；iOS 无 ipa |

⇒ 继续用"没有包"这一条挡住下载面，就会**主动放弃唯一一个已经成立的事实**，
而产品负责人 2026-10-07 明确要求五端都要发布。

## 2. 决定

1. **新增 `/download` 作为唯一的"获取"目的地**，进顶部导航；`/platforms` 保留为进度页，
   退到页脚（`inFooter: true`，且被正文链住 ⇒ 不是孤立路由，N2 判据从渲染出的 DOM 走）。
   导航项数不变（原先「平台」那一格换成「下载」）。
2. **下载动作只住在 `/download`**：`/platforms` 上不许出现任何一条直链。
3. **进度口径只住在 `/platforms`**：`/download` 不许自带一份状态徽标
   （既有不变量 `render.spec.tsx`「状态徽标只属于 /platforms」因此继续成立）。
4. 🔴 **页面上每一条直链都必须是发布清单的函数**，源码里不许手写：
   - 真源 = 分发桶的 `latest.json`（由 `scripts/upload-dist.sh` 写并匿名回读验证）；
   - 仓库里那份 `apps/landing/src/site/release-manifest.json` 是它的**逐字快照**，
     唯一写者是 `apps/landing/scripts/gen-downloads.mjs`；
   - 组件只消费 `resolveRows(清单)` 的结果。清单里没有的端，画不出按钮。
5. **版本号挂在每一枚文件上，不挂在批次上**（§4 第 1 条的直接推论：合并清单里各端不同轮）。
6. **预发布通道的字节不算产物**：`version` 不是 `主.次.修订` 形状（`0.0.0-dev` 等）时，
   该端退回"没有出口"，即使桶里那个文件真的能下载。

## 3. 为什么不是更简单的两种做法

- **「就在 `/platforms` 上加几个按钮」**：那一页的正文是按"进度"组织的散文，
  加按钮会得到一页既有进度叙述又有出口的东两，而访客首访要的是后者；
  更糟的是它会与 `/download` 成为**同一意图的两个目的地**——这正是本仓库反复根除的形状。
- **「把 `/platforms` 改名成下载页」**：会毁掉一个已经在线、已被应用内链引用的地址，
  并把"鸿蒙还跑不起来"这类进度事实挤出去。
- **让页面自己判断"这一端能不能下"**（写个布尔值）：那会有第二份"能不能下"，
  而它漂移的形态是**页面上有按钮、点了 404**。本仓库已经吃过同族三次
  （`AGENTS.md` §7 第 27/82 条与门禁 `check:legal-tools` 的成因）。

## 4. 代价与闸门

代价是**发布这一步多了一个动作**（跑 `gen-downloads.mjs` 刷快照），
以及一份多出来的快照文件。换来的是三条可执行的闸门：

| 闸门 | 抓什么 | 怎么证明它会红 |
|---|---|---|
| `scripts/check-downloads.mjs` 臂 A | 组件里手写分发桶 URL | `--self-test` 注入一条直链 |
| 臂 B | `channels`（唯一允许手写的字段）指到官方域名之外 | 注入 `download.example.com` |
| 臂 C | 清单里出现注册表未登记的端 | 注入 `watchos` |
| 臂 D | 文件名与它自己声明的版本不同轮 | 把 `heyta-1.0.0-macos.dmg` 改成 `0.9.0` |
| `tests/downloads.spec.tsx` | 空清单/满清单/混合通道三种状态下页面的出口集合 | 逐条断言 + 每条负断言配正向对照 |
| `e2e/landing/download.spec.ts` | 真浏览器里那份 build 产物真的画对了 | 5 条，含 UA 上下文对照 |

臂 D **已经抓过一次真的**：合并式清单第一次落地时，去年那条
`heyta-0.0.0-dev-android.apk` 没有 `version` 字段，会被本轮批次号盖成 `1.0.0` ——
门禁当场报红，修法是"版本号只能从它自己的文件名取"（`upload-dist.sh` 的 `backfill`
与 `gen-downloads.mjs` 的规范化各一处，页面与门禁读同一份规范化结果）。

## 5. 边界（不许读成"已做完"）

- 本 ADR 只让**已经存在的产物**能诚实上线。今天页面上真有一个原生直链：macOS（Apple Silicon）。
  Android / Windows / Linux / iOS 四端仍然是"写明差在哪一步"的状态，各自的前提：
  发布签名（Android）、可安装形态与信任步骤（Windows）、`dpkg -i` 验装（Linux）、
  TestFlight 通道（iOS）。
- Intel Mac 没有构建 —— 这是**产物缺口**，不是文案缺口，所以 `caveat` 挂在 macOS 那一行上而不是删掉。
- 清单快照与桶的一致性**没有自动载体**：`pnpm check` 里只有离线结构门禁（臂 A–D），
  打网络的 `--check` 挂在 `pnpm verify:downloads-live`。理由与本仓库对"打生产地址的判据不进链"
  的既有纪律一致（`deployment.md` §3.7 第 4 条同族）。代价说清楚：**忘了在发布后跑一次刷新，
  页面会描述上一轮**，而这条只有臂 D 在版本号形状变化时会响。
- 落地页的入口仍由构建期 `VITE_APP_URL` 决定（`AGENTS.md` §2）；本 ADR 不改那一条。
