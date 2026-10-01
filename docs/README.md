# heyta 文档中心

本文件是 `docs/` 的**唯一权威入口**。新增文档前先读「文档规则」，否则大概率会放错层。

---

## 一、文档分层规则

按**文档的生命周期**分层，而不是按主题。判断标准只有一个：**这份文档会不会变？谁依赖它？**

| 目录 | 放什么 | 生命周期 | 能不能改 |
|---|---|---|---|
| [`adr/`](adr/) | **架构决策记录**：一次决策一份，写清背景/选项/结论/后果 | 永久 | 🔒 **不可改**（只能新增"取代"关系） |
| [`plans/`](plans/) | **阶段计划**：roadmap + 每个阶段的详细计划。🔴 **入口是 [`plans/README.md`](plans/README.md)** —— 该目录曾有 30 份 / 25,117 行，**同一个问题在不同文件里各有一个版本的答案**，所以现在有唯一索引，找"当前状态"先看它 | 随阶段推进 | ✅ 持续更新，做完的划掉 |
| [`reference/`](reference/) | **稳定工程参考**：架构、协议、数据模型、[环境陷阱全集](reference/environment-traps.md)（AGENTS §7 的正文） | 长期 | ✅ 随代码演进；陷阱**编号只增不改** |
| [`runbooks/`](runbooks/) | **操作手册**：怎么跑起来、怎么验证、出事怎么办 | 长期 | ✅ 随运维实践更新 |
| [`research/`](research/) | **调研记录**：一次调研的完整过程与证据 | 归档 | ⚠️ 原则上冻结；结论有变时**新增**勘误，不改原文 |

**放错层的典型症状**：

- 把"我们决定用 X 而不是 Y"写在 `research/` 里 → 应该进 `adr/`。调研负责**给证据**，ADR 负责**下结论**。
- 把"当前进度"写在 `adr/` 里 → ADR 是不可变的历史记录，进度属于 `plans/`。
- 把一次性排查过程写在 `reference/` 里 → 那是 `research/`。

### 与 `research/`（仓库根）的区别

两个 `research` 目录容易混，分工是明确的：

- **`docs/research/`** —— 调研**结论**，是给人读的成品。
- **`research/`**（仓库根）—— 调研**原料**：上游源码克隆、抓取的原始报告、一次性脚本（`tools/`）、许可证清单。**不属于产品文档**，也不参与死链检查之外的任何门禁。

---

## 二、命名规范

```
adr/NNNN-<kebab-case>.md          例：0001-license-decision.md
plans/<kebab-case>.md             例：phase-1-single-client-loop.md
reference/<kebab-case>.md         例：architecture.md
runbooks/<kebab-case>.md          例：local-server-verification.md
docs/research/<kebab-case>.md     例：reuse-plan.md
```

- 全小写，中划线分词，**不加日期前缀**（日期写在文档正文的元信息里，不写在文件名里）。
- ADR 编号**只增不改**，从 `0001` 连续递增。

> 历史遗留：`docs/` 原先是 `00-feature-matrix.md` … `09-local-server-verification.md` 的平铺编号。
> 已按上面的规则迁入分层目录，**原编号不再保留**。旧路径在 git 历史里仍可查到。

---

## 三、状态标记约定

每份 `plans/` 与 `adr/` 文档**开头必须有状态行**：

```markdown
> 状态：**待确认** | **已接受** | **已取代** | **已废弃**（ADR）
> 状态：**规划中** | **进行中** | **已完成**（计划）
```

`已取代` 必须写明被谁取代：`> 状态：**已取代** → [ADR-0002](0002-xxx.md)`。

---

## 四、写作规则

1. **链接用文件相对路径**，不要写仓库根相对路径。
   - ✅ `` [架构](reference/architecture.md) ``
   - ❌ `` [架构](docs/reference/architecture.md) ``（从 `docs/` 里这样写会解析到 `docs/docs/`）
   - 在**反引号 code span** 里提及路径时，用仓库根相对路径（不会被解析，只是给人看）。
2. **提交前跑死链检查**：
   ```bash
   node research/tools/docs-link-check.mjs
   ```
   它扫描全部 `.md`，解析每个相对链接，死链则**退出码 1**。跳过 `research/upstream/` 等第三方克隆。
3. **不确定的事标"未核实"**，不要写成结论。调研类文档尤其重要。
4. **数字要给证据**：引用代码行数、版本号、日期时，写明是怎么得到的。

---

## 五、索引

### ADR — 架构决策记录

| 编号 | 决策 | 状态 |
|---|---|---|
| [0001](adr/0001-license-decision.md) | heyta 自身的许可证选择 = **MIT** | ✅ **已接受** |
| [0002](adr/0002-migration-tooling.md) | 数据库迁移方案：继续用 Prisma，不引入 Flyway | ✅ **已接受** |
| [0003](adr/0003-multi-platform-strategy.md) | 多端策略：业务逻辑全在 `packages/`，`apps/*` 只做壳 | ✅ **已接受** |
| [0004](adr/0004-ui-stack.md) | UI 技术栈 = **React Native**（跨平台） | ✅ **已接受** |
| [0005](adr/0005-ai-data-path.md) | AI 能力的数据路径 = **客户端内 + 用户自有推理端点**为默认；🔴 云端 AI 是**显式例外**（由 ADR-0013 补充，不再是「不做」） | ✅ **已接受** |
| [0006](adr/0006-supply-modes.md) | 同步与 AI 的**供给模式**：自备与托管并存；🔴 托管 AI 与 E2EE 互斥，必须显式例外 | ✅ **已接受** |
| [0007](adr/0007-transport-security.md) | 传输安全：**允许明文 HTTP，但不静默**（E2EE 保护内容、不保护令牌）；🔴 iOS 的 ATS 覆盖范围未实测 | ✅ **已接受**（iOS 待实测） |
| [0008](adr/0008-vector-clock-limit.md) | 向量时钟上限 **20 → 100**：把墙挪远、**不假装拆掉**（真正的修法是因果安全压缩，未做） | ✅ **已接受** |
| [0009](adr/0009-duplicate-op-idempotent-success.md) | 精确重复的 op 回**幂等成功**（附原 serverSeq），不再回 `DUPLICATE_OPERATION`；id 冲突仍硬拒绝 | ✅ **已接受** |
| [0010](adr/0010-ai-config-routing.md) | AI **配置路由**：三道闸（总开关 / 允许远程 / 逐功能出境授权）；🔴 **回退不得跨越隐私边界**；能力显式声明不推断；URL 校验双点执行 | ✅ **已接受** |
| [0011](adr/0011-local-api-mcp.md) | 本机 API / MCP：默认关、只监听回环、显式 token、逐工具授权；🔴 **加密条目可列举不可读**；写入只能经 `dispatch()` 形状的端口 | ✅ **已接受** |
| [0013](adr/0013-cloud-ai-and-maas.md) | 🔴 云端 AI 与 MaaS：**方向已定**（会提供统一云端 AI 并按此收费，后续 MaaS），但**开放条件未满足**；托管模式**不是端到端加密**（承接 ADR-0006） | ✅ **已接受** |
| [0012](adr/0012-self-host-transport-policy.md) | 自托管传输策略：生产环境**只**拒绝**公网**明文 `PUBLIC_URL`（私网/回环放行）—— 与 iOS ATS 的"私网放行、公网明文拦截"对齐 | ✅ **已接受** |
| [0014](adr/0014-memory-switch-and-corrections.md) | 🔴 记忆偏好层的两个闸门：**主开关默认关闭且 fail-closed**（必填参数，不是可选）；用户**纠正进 op-log** 跨设备同步，且因 `applyOperation` 静默忽略未建模实体类型 —— **不需 bump schema** | ✅ **已接受** |
| [0015](adr/0015-four-quadrant-as-derived-view.md) | 四象限是**派生视图**，不是第四套存储｜`important` 与 `urgent` 从既有字段推导，不加持久化字段 | ✅ **已接受** |
| [0016](adr/0016-undecryptable-ops-do-not-block-sync.md) | 🔴 读侧解不开的 op **跳过 + 推进游标 + 结构化上报**（否则一条坏 op 让**别的**设备永久卡死）；但**整页都解不开时抛错且不推进游标**（口令打错≠历史混口令）。是 [ADR-0009](adr/0009-duplicate-op-idempotent-success.md) 的读侧对偶 | ✅ **已接受** |
| [0017](adr/0017-single-paid-tier-and-payment-channel.md) | 💰 **唯一付费档的价格与支付通道**：大陆 **¥99/年**、海外 **$49/年**、自建**永久免费**（承接 [subscription-boundary.md](plans/subscription-boundary.md) §0，并**关闭**它 §3 一直留着的「价格未定」）；改价必须三处同时改，由 `scripts/check-pricing-consistency.mjs` 拦 —— ⚠️ **价格与周期结论（¥99/年、$49/年、年付）已被 [ADR-0020](adr/0020-ai-subscription-two-tiers.md) 取代**；「自建永久免费」与「不自动续费」两条**保留** | ⚠️ **已取代**（仅价格与周期结论） |
| [0018](adr/0018-adjustable-pricing-and-coupons.md) | 💰 **价格可运行期调整 + 自建优惠券域模型**：代码基线 + 数据库版本（带生效区间，**有缝绝不回落**）；券一单一券、13 个拒绝原因、名额口径 `reserved/applied/reversed` 计数而 `expired` 不计数；顺带**修掉** ADR-0017 §4「回调只校验金额是价目表里的某一个」那个洞（改成跟订单冻结金额比）—— ⚠️ **它 §1.2 的「只有一个付费档 / 不做月付」与「¥99/年、$49/年」两个前提已被 [ADR-0020](adr/0020-ai-subscription-two-tiers.md) 取代**；价目表 / 券模型 / 基点 / 取整方向 / 券不跨币种这些**结论不受影响** | ⚠️ **已接受**（两个价格前提已被取代） |
| [0019](adr/0019-upload-rejection-does-not-block-download.md) | 🔴 **上传被拒不得阻断下载**：被服务端**永久拒绝**的 op **移出重传队列**并结构化上报（新 `UploadStatus` 取值 `rejected`、新上报原因 `upload-rejected`）—— 否则一条坏 op 让一台设备**永远失去下载能力**，队列也永不收敛；但**只对永久拒绝**这么做：可恢复失败（网络抖动 / 限流）照旧退避重传，否则会静默丢数据。被拒的 op **不删除**，仍留在 op-log 里 | ✅ **已接受** |
| [0020](adr/0020-ai-subscription-two-tiers.md) | 💰 **托管与 AI 都按月卖**：收费的是**我们替你运维服务器**与**我们的云端 AI**（不是功能、不是同步）；非 AI 能力永久免费；**两档 —— ¥5/$5（全部功能 + 官方托管同步）与 ¥12/$12（再加我们的云端 AI 300 次/月）**，两档功能完全相同，差的只是含不含我们的 AI；自带端点的 AI **永久免费且不计量**；计量只记**动作次数**（不记 token —— token 数暴露内容长度） | ✅ **已接受** |
| [0021](adr/0021-managed-ai-model-deepseek-flash.md) | 🤖 **托管 AI 用 DeepSeek V4.1 Flash**：关闭 [0020](adr/0020-ai-subscription-two-tiers.md) §5 第 1 条。选它的理由是**单位经济**而不是「它够用」—— 300 次/月 的 token 成本 ≈¥2.01（占 ¥7 增量 **29%**），换 pro 级 ≈¥7.71 **超过 ¥7 增量本身**；所以「换模型 = 换价」，两者不能分开定 | ✅ **已接受** |
| [0022](adr/0022-resilience-state-stays-derived.md) | 习惯韧性的**冻结余额保持纯派生且不上界面**（界面只显示"它替你保住了什么"）；🔴 **冻结参数只能放宽、不能收紧**，收紧必须走代码常量切分点 —— **仍然不加字段** | ✅ **已接受** |
| [0023](adr/0023-managed-ai-quota-not-implemented.md) | 🔴 **托管 AI 的「300 次/月」本轮不实现**：不改变 [0020](adr/0020-ai-subscription-two-tiers.md)/[0021](adr/0021-managed-ai-model-deepseek-flash.md) 的额度与模型，判定的是**落地顺序** —— 端点 / 计量 / `deepseek` 调用 / 收银台**一个都不存在**，而承诺已在文案与法务里，所以定成「**计量存在之前 `hosted-ai-monthly` 不得被售卖**」；`pnpm check:ai-quota` 把**唯一数字源**（参考文档 `ai-quota-ssot` 块）与五处承诺、以及状态↔实现绑定起来 | ✅ **已接受** |
| 🔴 [0024](adr/0024-desktop-shell-and-ui-convergence.md) | **UI 收敛方向 = React Native + react-native-web；桌面壳 = Electron**：UI 只写一份 RN 组件；桌面选 Electron 而非 Tauri，**因为 `SqliteDriver` 是同步接口而 Tauri 只有异步 IPC**，Electron 有同步 IPC（`sendSync`）且自带 Node 24（现成 `NodeSqliteDriver` 零改动）；否决 react-native-windows（**Linux 无官方目标** + macOS 落后 v0.81.9 vs RN 0.84.1）。🔴 含**显式例外**：系统小组件**不纳入** UI 收敛（是 3 份原生 UI + 1 个 JSON 模板，禁用 headless-JS 组件库） | ⚠️ **待确认**（等产品负责人拍板） |
| 🔐 [0025](adr/0025-widget-snapshot-confidentiality.md) | **小组件快照的机密性 = 设备密钥加密**：共享容器放密文快照，密钥由应用预派生好放进共享 Keychain/Keystore，**组件内只做一次 AES-GCM-256、永不跑 KDF**（四个做内容组件的 E2EE 实现无一在组件里跑 KDF）；锁屏取一组"不暴露"默认值 —— **首版不做锁屏组件** + Android `not_keyguard` + iOS 默认脱敏（🔴 **加密快照解决不了锁屏可见性，两者正交**）；🔴 **`NSFileProtectionComplete` 与 Continuity 互斥**，首版不设以保留后者，但**做锁屏组件时必须在两者间二选一**；清单颜色传已解析的 `{ light, dark }`，理由是"槽位→颜色只该解析一次"而**不是**"原生做不到"（⚠️ 那条原始证据因大小写敏感 grep 而错误，已在 ADR §2.4 与本仓库两处更正） | ✅ **已接受** |
| [0026](adr/0026-refund-side-entitlement-revocation-not-implemented.md) | 💰 **退款/拒付侧的权益回收本轮不做**：三个洞不是同一个洞 —— 退款通知被 adapter 有意 fail-closed 拒绝、`reverseOrderOnRefund` 零生产调用方、`onRevoke` 未注入；🔴 真阻塞是**权益模型里没有"哪一笔支付买了哪一段"**（`Subscription` 只有一行 + 单个 `currentPeriodEnd`，能力是**替换**而支付是**叠加**），所以"退第 2 笔、保留第 1 笔"**无法表达**，按笔回收的最小单位是整行 = **过度回收**；退款政策本身也未定（业主决定）。否决"只接订单侧"的半截路径，含**最小实现清单**（清空之日即本 ADR 被取代之日） | ✅ **已接受** |
| 🔑 [0029](adr/0029-refuse-to-delete-last-passkey.md) | 🔐 **账号上最后一条通行密钥不允许被自助删除**（409 `last_passkey_required`），判断写在 `deleteMany` 的**谓词里**而不是先查后删 —— 那是**唯一的 TOCTOU 防护**（两个标签页各删一条会让账号一条都不剩）；否决"允许删到零"与"允许但二次确认写清楚"，因为两者都把账号可进入性寄托在**用户读到一条文案**上，而这个操作恰恰发生在用户"整理旧设备"、最不细读文案的时刻。🔴 **依赖一条已认证的"添加凭据"通路** —— 邮箱注册路径对已验证账号是**静默空操作**（`verifyRegistration` 防枚举），照做的用户会以为加上了、删掉旧的、然后进不去。⚠️ 不做改名（`Passkey` 无 `name` 列，需迁移） | ✅ **已接受**（判据已被 [0041](adr/0041-last-passkey-guard-keys-on-any-usable-entry.md) 修订） |
| 🕵️ [0030](adr/0030-passkey-not-found-existence-oracle.md) | **未认证的通行密钥验证端点明确接受一个存在性预言机**：用两个 `code`（`passkey_not_found` / `passkey_verification_failed`）区分"服务端已不认得这条凭据"与"验签没过"，而 `message` 刻意保持同样笼统，判别**只靠 `code`** —— 因为这两种成因需要**完全相反**的动作（重新注册 vs 再试一次）。接受的代价是：调用方能以**已知 credential ID** 为键问出"它是否还注册着"。理由：该 id 本非秘密（每次登录明文出现在断言响应里）、32 字节随机不可枚举，且收益落在**已经进不来的用户**身上。🔴 **不外推**：不为"账号/邮箱是否存在"、"某个 id 属于谁"背书（删除路径上"不是你的"与"不存在"仍**逐字节同形**）；`SAFE_ERROR_MESSAGES` **未**放宽。⚠️ 隐含前提：一旦 credential ID 变成可枚举，本结论**立即失效** | ✅ **已接受** |
| 📱 [0031](adr/0031-native-apps-everywhere-not-pwa.md) | **每一端都交付原生应用，PWA 不是任何端的交付形态**。🔴 **Capacitor 被否决**：它**根本没有 Windows 平台**（官方平台导航只有 iOS / Android / Web(PWA)，`npx cap add` 无 `windows`），且它是"WebView + 插件"、**渲染不了系统小组件** —— 理由是**能力**，不是代码量（代码量口径已被 0032 作废）。**"代码只写一份"靠 `packages/ui` 共享实现，不靠换壳**。⚠️ **收窄** [ADR-0024](adr/0024-desktop-shell-and-ui-convergence.md) §2.5：那里说的"PWA 价值上升"指 **Windows 小组件注册所需的 package identity 这条技术路**，不是"Windows 可以交 PWA 了事"。⚠️ Windows 那一行先由 [0032](adr/0032-windows-native-via-rnw.md) 改为 RNW、**又由 [0034](adr/0034-windows-native-winui3-not-rnw.md) 改为 WinUI 3 原生**、**最终由 [0036](adr/0036-main-battlefield-and-rn-single-source-ui.md) 回到 RNW（0.84.0 与移动端逐字对齐）** | ✅ **已接受**（2026-09-29 确认，依据见其 §6） |
| ⚪ [0032](adr/0032-windows-native-via-rnw.md) | ~~Windows 桌面端迁到 react-native-windows 原生~~。**🔴 已被 [ADR-0034](adr/0034-windows-native-winui3-not-rnw.md) 全部取代**：本文 §3.1 的前置"先升 RN 再上 RNW"**自我否定** —— RNW 最新**稳定版就是 0.84.0**、**无 0.85+**，抬了 RN 就没有 RNW 可用。仍然有效的部分：Capacitor 没有 Windows 平台、"哪怕是代码量偏大"抽掉了 ADR-0024 §2.2 的论证前提、以及它记录的三笔成本清单（C1/C2/C3 —— 0034 §1.3/§1.4/§1.5 在三条上做了复核并改判） | ⚪ **已取代** |
| 🪟 [0034](adr/0034-windows-native-winui3-not-rnw.md) | **Windows 走 WinUI 3 / Windows App SDK 原生（C#），不走 RNW**。🔴 决定性事实：RNW npm `dist-tags` 的 `latest = 0.84.0`，**稳定版 0.85/0.86/0.87 全部不存在**，而 RN 上游已 **0.87.1** ⇒ 选 RNW = 把整个 monorepo（含旗舰 `apps/mobile`）**冻在一个已出上游支持窗口的 RN 上** —— 那是**产品**代价，而"哪怕是代码量偏大"只授权**代码量**。**同时改判三条**：C1 消失（`Microsoft.Data.Sqlite` 是 **ADO.NET**，API 全同步）、C3 消失（微软有**官方 C# widget provider 教程**，"无先例"只是选 RNW 造成的）、C2 真实规模是 **heyta 自己的 4 个原生库 / 3 个缺口**（不是生态的 2.8%）。⚠️ 唯一没解决的：**`packages/domain`（6603 行纯 TS）的单源问题**，由 spike 拍板（D1 C# 移植 + golden fixture ↔ D2 内嵌 JS 引擎） | ⚪ **已被取代**（2026-09-29 由 [0036](adr/0036-main-battlefield-and-rn-single-source-ui.md) 取代；见其 §7 勘误。⚠️ §1.3/§1.4/§1.5/§6 的**跨语言通道结论继续有效**） |
| 🌐 [0033](adr/0033-multi-page-site-and-bidirectional-reachability.md) | **站点多页架构 = 单一页面注册表驱动的静态入口，且站点与应用互为可达**。产品要求「完整的产品及路由实现，**禁止孤立路由、禁止产品孤岛**，完美融入现有界面」。选**多 HTML 入口**（内容站、SEO 最好、**不推翻**"不引入路由库"），但入口/导航/页脚/sitemap/门禁**全部由一份 `site/pages.ts` 注册表生成** ⇒ **没有一条路径能新增页面而不出现在导航里**（N2 从主张变成结构）。🔴 另一半是**实测为零**的反向链路：`apps/web/src` 里 `href=` **0 处**、`mobile` 里 `Linking.openURL` **0 处** ⇒ 应用对外**一个链接都没有** —— 这正是"产品孤岛"。新增构建期 `VITE_SITE_URL`（与 `VITE_APP_URL` 完全对称，未配置时**不渲染**），应用里三个落点：设置页「帮助与关于」→ `/help`、`/changelog`；订阅/到期提示 → `/pricing`；同步出错提示 → `/help`。配套 **A8 `check:site-reachability`** 门禁 | ✅ **已接受** |
| 💾 [0027](adr/0027-unified-client-storage-sqlite-everywhere.md) | **客户端存储统一 = SQLite everywhere**：三端共用同一套 SQLite 存储契约；web 从 IndexedDB 迁到 `@sqlite.org/sqlite-wasm`（Apache-2.0）+ OPFS 的 **SyncAccessHandle Pool VFS**，**`SqliteDriver` 的同步接口一行不改**（依据是 SAH Pool 产出的 DB 对象方法本身同步，§3.2 一手核实）。🔴 **在鸿蒙上实测之前，不得把 FTS5 / sqlite-vec 当作鸿蒙端已具备的能力** —— 检索能力必须是**运行时能力协商** | ✅ **已接受** |
| 🧵 [0028](adr/0028-web-sqlite-must-run-in-worker.md) | **web 的 SQLite 必须跑在 DedicatedWorker 里**：`FileSystemSyncAccessHandle` 的暴露范围是 `[Exposed=DedicatedWorker]`，**页面主线程上 `createSyncAccessHandle` 根本不存在** ⇒ 主线程调 `installOpfsSAHPoolVfs()` 必然失败。跨到主线程那一层**必然异步**（postMessage 的性质）。⚠️ 它**收窄**了 [0027](adr/0027-unified-client-storage-sqlite-everywhere.md) 的一处判断 | ✅ **已接受** |
| 🔧 [0035](adr/0035-ai-tool-calling-reuses-local-api.md) | **AI 工具调用复用本地 API 的同一套契约**：`packages/local-api` 的工具目录 / 授权判定 / 执行器与内置 AI **共用**（`isToolGranted` / `runReadTool` / `toWriteIntent`），**不另建一份** —— 否则"内置 AI 能用、MCP 不能用"这类漂移只会靠运气被发现 | ✅ **已接受** |
| 🔴 🧭 [0036](adr/0036-main-battlefield-and-rn-single-source-ui.md) | **当前的多端路线权威**：**主战场 = 移动端 + macOS + Windows**（Web 降为次要、不再是功能首发地；Linux 同架构但不做专项功能）；**UI 单源 = 用 React Native 作唯一 UI 实现，各端 RN 平台实现渲成该平台的原生控件**（Windows → `react-native-windows`、macOS → `react-native-macos`、Web → `react-native-web`、系统小组件沿用 [0024](adr/0024-desktop-shell-and-ui-convergence.md) 的例外）；**采用方式 = content islands**（微软 Office 的公开做法，40+ 体验嵌进既有原生应用，不做大爆炸重写）。🔴 它**取代了 [0034](adr/0034-windows-native-winui3-not-rnw.md)**：0034 否决 RNW 的唯一决定性理由（"会把移动端冻在支持窗口外"）**前提被证伪** —— `react-native-windows@0.84.0` 的 peer 就是 `react-native 0.84.1`（与 heyta 逐字相同），且 RN 官方矩阵里 **0.84 本来就是 Unsupported**（heyta 已在窗口外，不是 RNW 推进去的）。依据 [最佳实践调研](research/multi-platform-best-practice.md) | ✅ **已接受** |
| 🖥️ [0037](adr/0037-desktop-ui-falls-back-to-webview.md) | **桌面 UI 退回 M2：原生壳 + 内嵌共享 Web UI**。🔴 **实测把 RNW 路线否掉了**：`packages/ui` **能**零改动进 RNW 的 Metro bundle（1,895,932 B，`task-item-` 只出现 1 次），但 RNW 0.84 要求 **MSVC v145（VS 2026）**；本机只有 v143 ⇒ 能编能链、**启动即崩**（`0xC0000409` FAST_FAIL_GS_COOKIE_INIT）。**我把 VS 2026 装上补齐 v145 做了对照**（`MSBUILD_EXIT=0`、exe 3,483,136 B）—— **崩法逐字相同** ⇒ **工具集不是变量**。按方案预写的判据退 M2，并**接受残差**：桌面端 UI 不是原生控件，换取「UI 组件真的只有一份」。M2 三样前提**今天全部已就位**（能出窗口的原生壳 / WebView2 已在许可证清单 / `packages/ui` 已被 web 消费）。**复活条件写死**：RNW 出现能在本机开出窗口的版本 + `react-native-svg` 的 Windows 工程在 New Arch 下能产出 `OutputPath` | ✅ **已接受** |
| ✉️ [0039](adr/0039-email-first-auth-and-desktop-reverse-authorization.md) | **鉴权走邮箱链接全链路**（一条链接走完注册+登录）· 桌面壳走**系统浏览器反向授权** · 手机号通道**预留**。🔴 主线修复：`/verify-email` 原来**GET 就消费令牌**（邮件客户端的链接预取会替用户把它烧掉），现与 `/magic-login` 对齐成确认页；三类令牌（登录 / 邮箱注册 / 通行密钥注册）由 `verifyEmailLink` **一份实现**分流。🔴 第二个主线修复：确认页与**分属两个 agent cluster**（服务端 helmet 的 COOP/OAC vs 静态产物没有）⇒ `sessionStorage` 跨不过那一跳，会话改走 **URL fragment**。绿/红一对（含 3 份注入与 2×2）见 `apps/web/evidence/email-chain/` | ✅ **已接受** |
| 🔑 [0040](adr/0040-email-password-auth-decoupled-from-e2ee.md) | **登录口令只用于认证，与 E2EE 口令解耦**；Argon2id（OWASP 最低参数 `m=19456,t=2,p=1`）+ pepper 作**原生 `secret` 参数**，存 **PHC 自描述串进已有的可空列** ⇒ 🔴 **不加列、不 bump `CURRENT_SCHEMA_VERSION`**；口令进**系统钥匙串**（Web 例外，仍只在内存）。取代 [0039](adr/0039-email-first-auth-and-desktop-reverse-authorization.md) §1.4「密码这条路**不存在**」里那句"若将来要加是新决定"。🔴 **对 NIST SP 800-63B Rev 4「单因子 SHALL ≥15 字符」是有意的偏离**（下限 **8 个码点**，唯一真源在 `shared-schema/auth-http-contract.ts`），而偏离成立的前提是**三道补偿控制同时存在**（本地常见口令表**精确匹配**、不引入 core 的分数门槛 / HIBP **只在设口令那一刻查、登录路径一律不查**、fail-open **必须留一条 warn** / 账号级失败锁定 5 次 15 分钟）—— 缺一即打回 ⇒ **产品文案不许称"符合 NIST 800-63B"**。同一刀把四类令牌改成 **SHA-256 hex 存、按哈希查**（原缺陷：明文入库，一次数据库读 = 全站账号接管）。爆破锁的是**口令认证器不是账号**（防 Denial-of-Account：喷别人邮箱就能把真主人关在门外）；反枚举的三条同码同文案靠**对 dummy PHC 串真跑一次校验**对齐耗时。界面**一份**共享组件（`packages/ui/src/auth/AuthForm.tsx`，🔴 **不许写四份表单**）+ **两个秘密两条词条**（「登录密码」可邮件重置 / 「加密口令」不可恢复）。 | ✅ **已接受**（触发 [0041](adr/0041-last-passkey-guard-keys-on-any-usable-entry.md) 修订 [0029](adr/0029-refuse-to-delete-last-passkey.md) 的判据） |
| 🗑️ [0041](adr/0041-last-passkey-guard-keys-on-any-usable-entry.md) | **最后一条通行密钥的守卫改判有没有别的能用的入口**，不再判是不是最后一条（修订 [0029](adr/0029-refuse-to-delete-last-passkey.md) 的判据、保留其取舍）。可用口令 = `passwordHash IS NOT NULL AND is_verified = 1`：🔴 `is_verified` 是承重的（`loginWithEmailPassword` 在校验通过后还会因未验证抛 `email_not_verified`，只看 hash 会放出一个谁也进不去的账号）。🟡 口令被限流**算**能用 —— 判据要建立在稳定事实上，不是瞬时状态。两条判据仍必须在**同一条 deleteMany 谓词**里求值（那是唯一的 TOCTOU 防护），且服务端与界面那句提示同时改。 | ✅ **已接受** |

### 计划

| 文档 | 内容 |
|---|---|
| [roadmap.md](plans/roadmap.md) | ⭐ **总路线图**：阶段划分、P0 完成情况、组件决策、风险 |
| 🔴 ⭐ **[multi-end-unified-strategy.md](plans/multi-end-unified-strategy.md)** | **当前唯一的权威主计划**（2026-09-28）：主战场重定义（**移动端 + macOS + Windows**，Web 降为次要）· **UI 单源**（RN 全端 + 内容岛）· 滴答清单对标 · 旧资产清理清单 · 落地判据与门禁。**找"当前状态"先看它**；计划层的完整索引见 [plans/README.md](plans/README.md) |
| [multi-platform-adaptation.md](plans/multi-platform-adaptation.md) | 🔴 **M0 共享层补完 → M1 垂直切片验证（成败点）→ M3 逐特性迁移 UI** 的判据与门禁 G1–G5 仍有效（净行数必须持续为负）；**M2 的桌面路线已由主计划 §3.3 修订**。依据 [融合调研](research/multi-platform-ui-fusion.md) |
| 🔴 [desktop-native-migration.md](plans/desktop-native-migration.md) | **多端原生构建计划**：W0/W1 的**实测结论仍有效**（跨语言通道、Jint/JSC 陷阱、编组开销、错误过边界两种形态）。⚠️ **"RNW 出局"已被推翻** —— [最佳实践调研](research/multi-platform-best-practice.md) §3 用 npm registry 直查证明 `react-native-windows@0.84.0` 的 peer 就是 `react-native 0.84.1`（与 heyta 逐字相同），且 heyta 的移动端**本来就在** RN 不受支持区。**UI 形态以主计划 §4.3 为准** |
| [phase-1-single-client-loop.md](plans/phase-1-single-client-loop.md) | ⭐ **P1 详细计划**：单端（Web）闭环 |
| [phase-2-multi-platform.md](plans/phase-2-multi-platform.md) | **P2 详细计划**：多端补齐（存储契约 / SQLite / RN / 鸿蒙） |
| [ai-memory-necessity.md](research/ai-memory-necessity.md) | ⭐ **要不要向量数据库**：用重复检测做可证伪实验得出的结论（难档召回 0%） |
| 🔴 [ai-memory-system.md](plans/ai-memory-system.md) | **AI 记忆系统实施计划**：该记住什么偏好、怎么验证、分几阶段做 |
| [ai-strategy.md](plans/ai-strategy.md) | ⭐⭐ **AI 入口文档**：读这一份就够（定位 / 三档结构 / 护城河 / 现状 / 下一步） |
| 🔴 [subscription-boundary.md](plans/subscription-boundary.md) | **会员订阅的免费/付费边界**：收费的是「服务器」不是「功能」；为什么按设备数卡而不按存储量；「到期不许变成数据 hostage」这条硬约束 |
| 🔴 [subscription-integration.md](plans/subscription-integration.md) | **会员订阅的服务端接入点**：Fastify/JWT/配额守卫/迁移纪律的落点，以及 🔴「代码里没有官方实例标志，付费闸门必须默认关」 |
| [subscription-provider-selection.md](plans/subscription-provider-selection.md) | **支付商选型**：阶段一 = **只做国内市场**（跨境方案 Paddle / Stripe / Paddle 等一律不适用） |
| [subscription-handoff.md](plans/subscription-handoff.md) | **会员订阅交接**：只记「当前停在哪」，不重复决策 |
| [subscription-wechat-handoff.md](plans/subscription-wechat-handoff.md) | **交接：微信支付 adapter + 真实支付 E2E 门禁**（给全新会话的完整任务书） |
| [pricing-coupons-handoff.md](plans/pricing-coupons-handoff.md) | **交接：可调价 + 优惠券** —— 从「领域层已落地」到「收银台真的能用」 |
| [ai-tier-pricing-rollout.md](plans/ai-tier-pricing-rollout.md) | **推进计划：把定价故事换成「自建永久免费 + 月付 ¥5 / ¥12」** —— 执行清单，决策看 ADR-0020 |
| [ai-capability-branches.md](plans/ai-capability-branches.md) | **AI 能力分支与开发分支策略**（含对 5 条功能设想的逐条裁决）—— 大而全，深挖用 |
| [ai-open-decisions.md](plans/ai-open-decisions.md) | **AI 功能需要拍板的决策清单**（不是需求表单，是「代码解决不了的事」） |
| 🔴 [ai-gap-audit-and-remediation.md](plans/ai-gap-audit-and-remediation.md) | **AI 功能实现度审计与整改方案**：审计基线 `c667fb4`，**只读**审计，把缺口拆成三个互不重叠的模块交给三个 AI 执行 |
| [ai-remediation-parallel-runbook.md](plans/ai-remediation-parallel-runbook.md) | **三个 AI 模块并行开工的 runbook**：分叉点 tag、可执行的租约门禁（`scripts/check-module-boundaries.mjs`）、合并程序 —— ✅ 已执行完毕，留作可复现记录 |
| [ai-remediation-module-1-engine.md](plans/ai-remediation-module-1-engine.md) | 模块 1 任务书：**AI 引擎层正确性与孤立分支治理** —— ✅ 交付物是**对抗性验证**（零源码改动：修复早于分叉点就已落地） |
| [ai-remediation-module-2-journey.md](plans/ai-remediation-module-2-journey.md) | 模块 2 任务书：**AI 用户旅程闭环与「界面说真话」**（失败态英文界面契约 + 熔断冷却后的「重试」）—— ✅ 已并入 `main` |
| [ai-remediation-module-3-memory-moat.md](plans/ai-remediation-module-3-memory-moat.md) | 模块 3 任务书：**把「记忆护城河」接到用户眼前**（用真 IndexedDB 钉死 `readRecentOps` 的窗口方向）—— ✅ 已并入 `main` |
| [ai-handoff.md](plans/ai-handoff.md) | **AI 方向交接**：什么已经做完（别重做）、哪些「未做」其实已经过期（别照旧清单干）、现在真正该做的第一件事 |
| [desktop-packaging-handoff.md](plans/desktop-packaging-handoff.md) | **交接：桌面三端安装包** —— macOS（Developer ID 签名 + 公证 + 装订）与 Linux（.deb）已完整交付并实测装完能起来；Windows MSIX 打包+签名成功但 `Add-AppxPackage` 被拒，卡在安装，下一步与已排除的猜测都写在里面 |
| [desktop-storage-host-handoff.md](plans/desktop-storage-host-handoff.md) | **交接：桌面端「真应用的存储 → 壳的 SQLite」** —— A（macOS 定案 = **M2** + 可判定的重开条件）已完成；**B 的 Windows 端已验到绿**（页侧 `STORAGE=shell` + 从壳外扫到载荷与 `ops` 表 + **重启之后还在**）。含四件事的顺序、已排除的死路、OPFS→壳导入的判据链与注入验证。**两个桌面端都已验通并翻成默认**；⚠️ **四件事 A/B/C/D 全部交付**（各自有能因注入转红的判据）。唯一待定的是**产品选择**（壳里主鉴权机制）。另记录了顺带修掉的两起产物/门禁缺陷。**接手先读 §6** |
| [i18n-multilingual.md](plans/i18n-multilingual.md) | 🌐 **中英双语实施计划**：为什么自研零依赖词条表、落地页用 URL 而应用用偏好、`check:ui-language` 契约的**变更与两处按 key 的例外**、分阶段迁移进度、以及**还没解决的域层文案** |
| [landing-motion-audit/](plans/landing-motion-audit/) | 🎬 **落地页动效审计与整改**（`improve-animations` skill 产出，基线 `18b34ce`）：5 条发现全部 DONE，判据与取值都注明来源，含真实 Chrome 行为断言。原先游离在仓库根 `plans/`，已移入此处 |
| 🔴 [multi-platform-widgets.md](plans/multi-platform-widgets.md) | **多端小组件改造计划**：小组件是**多端适配的输出形态**，不是额外项目。含**必须现在做对的 5 件事**（App Group 定名 / 预留容器 / 不把 SQLite 搬进共享容器）、`packages/widget-core` + golden fixture + 门禁扩展、**Windows 走 PWA provider、macOS 走 Continuity —— 这两端反而不需要壳**、W0–W5 排序与"什么能自动验/什么不能"。支撑 [roadmap](plans/roadmap.md) P3 |
| ⭐ [multi-platform-widgets-progress.md](plans/multi-platform-widgets-progress.md) | 🔴 **小组件实施进度账本（唯一真源）**：W0–W5 逐任务记录**已完成 / 未完成 / 阻塞**并附可验证证据。含 D1–D6 六个已拍板决策（**D1 = 设备密钥加密快照**）、阻塞登记（鸿蒙镜像/签名、Windows 真机、iOS 账号）、7 条未核实项、以及「下一步」唯一入口。状态只有四种，**不允许"基本完成"** |
| [motivation-and-progression.md](plans/motivation-and-progression.md) | ⭐ **激励与成长体系设计**：三层架构（即时反馈/连续性/叙事）× 四个循环，含「不改 schema」的落地映射、反需求 2.0、E2EE 下的指标方案 |
| [activity-categories-and-colors.md](plans/activity-categories-and-colors.md) | **活动分类与分类着色**（✅ 已实现并并入 `main`）：颜色由**用户自赋义**、App 不判健康度；真正的工程量在时间归因（零新增字段跑通了第一版）；分类泳道图 + 周堆叠条。落地状态与实测数字见其 §8 |
| 🔴 [site-and-parity-alignment.md](plans/site-and-parity-alignment.md) | ⭐ **站点补齐与能力对标：任务计划**（2026-09-28 立项）：**A 轨站点**（A0 多页架构 → `/features` `/platforms` `/pricing` `/help` `/signin` `/changelog` `/integrations`）、**B 轨能力**（B0 六个低成本高杠杆 → B1 提醒/Web 日历/子任务/搜索 → B2 二十条 P1）、**C 轨文档与门禁**（含 🔴 **新增 `check:reachability`**：查"实体已建模但零 action / 零调用点"）。含 6 条先决决策（D1 多页架构**需要新 ADR**）、6 个波次、7 条风险与不可逆点、11 条明确不做 |

### 工程参考

| 文档 | 内容 |
|---|---|
| [architecture.md](reference/architecture.md) | 技术选型与架构（⚠️ 顶部有推翻声明，同步引擎部分仍有效） |
| [build-matrix.md](reference/build-matrix.md) | ⭐ **多端构建矩阵**：各平台构建环境 / 工具链版本 / 产物路径 / 状态，含 **Windows 打包机身份固化** |
| ⭐ [pricing-and-entitlements.md](reference/pricing-and-entitlements.md) | 💰 **价格与权益的工程参考**（不是营销文案）：一张表说清唯一付费档、权益对照、到期行为、价格的**三个事实源**在哪、以及**现在还买不到**的诚实状态。含被 `scripts/check-pricing-consistency.mjs` 读取的机器可读价格块 |
| ⭐ [pricing-and-coupons.md](reference/pricing-and-coupons.md) | 💰 **价格可调与优惠券的工程参考**：价格的事实源住哪（代码基线 ↔ 数据库版本 ↔ 覆盖的裁决规则）、模块地图、**全部具名常量与数值**、13 个拒绝原因与其顺序为什么是规格、五张表与 CHECK、订单状态机、名额口径表、并发核销的锁形状、🔴 **sweep 必须真的在跑**、以及 §7 的未验证项清单 |
| [ai-architecture.md](reference/ai-architecture.md) | ⭐ **AI 架构参考**：出站（`packages/ai` 四层收窄）/ 入站（`packages/local-api`）的模块地图、封闭词表、全部具名常量与数值、**20 条不变量清单**、数据流。⚠️ 它描述"代码现在长什么样"，与 ADR 冲突时以 ADR 为准 |

### 操作手册

| 文档 | 内容 |
|---|---|
| [local-server-verification.md](runbooks/local-server-verification.md) | ⭐ 不依赖 Docker 跑通服务端 + Docker 部署 + 实测发现 |
| [deployment.md](runbooks/deployment.md) | ⭐ **运维与部署现状**：哪台服务器跑什么、heyta 公网部署拓扑、反向代理与证书、代理链路、DNS、本机开发环境、🔴 待清理风险（含"实测 / 引用 / 未核实"标记） |
| [multi-platform-build.md](runbooks/multi-platform-build.md) | ⭐ **多端构建操作手册**：Android / iOS / Windows / 鸿蒙怎么打包、怎么验产物、高频坑；**§6 是桌面原生壳安装包**（macOS `.dmg` / Linux `.deb` / Windows MSIX） |
| [desktop.md](runbooks/desktop.md) | ⭐ **桌面端（Electron）操作手册**：骨架由什么组成、Spike S1 结论（主进程持库）、库文件在哪、**Electron 二进制为何没被下载**（要跑 GUI 需放行 `allowBuilds`）、**不装 Electron 也能验证的 11 个用例**、以及"复用而非复制"的机器判据 |
| [ci-and-runner.md](runbooks/ci-and-runner.md) | ⭐ **CI 与自托管 runner 操作手册**：push 之后发生什么、runner 为什么在 finlaw、日常操作命令、7 条已踩过的坑、安全边界、🔴 **转公开必须改回托管 runner**的硬约束 |
| [finlaw-cleanup-candidates.md](runbooks/finlaw-cleanup-candidates.md) | **ubuntu-jcli（finlaw）回收候选清单**：只读盘点「该回收什么」——🟢 可安全回收 / 🟡 需确认 / 🔴 绝不能动，每档带判据与总可回收量估算 |
| [ai-acceptance.md](runbooks/ai-acceptance.md) | ⭐ **AI 验收门禁**：什么叫「AI 功能做完了」——静态可达性门禁查什么（含"引用了 ≠ 用户能用"那条）、真实浏览器 E2E 为什么不接真模型、红了怎么归因、加新功能要补哪几步、以及这道门禁**没覆盖**什么 |
| [app-distribution.md](runbooks/app-distribution.md) | ⭐ **分发操作手册**：安装包怎么发出去 —— COS 专用桶（公开读/生命周期）、`scripts/upload-dist.sh` 每轮发布动作、渠道定位（GitHub 镜像 / 飞书只做内测）、成本与省流量、防盗链何时再加 |

### 调研

| 文档 | 内容 |
|---|---|
| [feature-matrix.md](research/feature-matrix.md) | 滴答清单功能对照矩阵 —— 需求基准线（P0/P1/P2 分级） |
| 🔴 [dida365-feature-benchmark.md](research/dida365-feature-benchmark.md) | ⭐ **滴答清单功能对标：heyta 的真实缺口**（2026-09-28 代码级审计）：逐类给 `文件:行号` 证据 + 缺口分级（P0/P1/P2）。含 **13 项「看起来有、其实没有」**（提醒 / 通知 / 子任务 / Web 日历 / 已完成入口 / 手动排序 / 番茄自定义 / 习惯计数型 / 实时同步 / 桌面端 / 笔记 / 鸿蒙 / 全量导出）、**13 处文档与代码的矛盾**、以及**我们独有的 9 条能力**。🔴 核心判据：**"做完了" = 有 action + 有调用点 + 有从用户动作出发的验收** |
| [dida365-help-center-ia.md](research/dida365-help-center-ia.md) | ⭐ **滴答清单帮助中心与官网 IA 实测**（2026-09-28）：解析 Next.js `__NEXT_DATA__` 得到 **97 篇**完整目录（任务 21 / 日历 9 / 四象限 3 / 番茄 6 / 习惯 4 / 倒数日 4 / 导入与关联 15 / AI 7 / 账号与安全 6…）、**FAQ 67 问分 8 组**、**定价逐项对比表**（￥139/年 · ￥16/月 · 连续包月 ￥13.9；国际版 $49.99/年）、下载页 7 平台分发方式、登录 6 种方式、更新动态 5 条 + 3 个年度归档。含 6 条未核实项 |
| [site-ia-and-landing-audit.md](research/site-ia-and-landing-audit.md) | ⭐ **heyta 落地页审计与双向对齐**（2026-09-28）：现状清单（10 段区块 / 导航 / 页脚 / i18n / SEO / 主题 / 应用入口 / 构建部署 / 测试门禁）+ **22 行对齐矩阵**（A 对标补齐 / B 能力回填 / C 明确不对齐）+ **不能照抄的 8 件事**。滴答侧数据不在此重复，见上一条 |
| [oss-landscape.md](research/oss-landscape.md) | 开源项目盘点（16 个项目的许可证、成熟度、可复用性） |
| [licensing-and-compliance.md](research/licensing-and-compliance.md) | 许可证与合规边界（AGPL §13、商标、上架成本、定价数据） |
| [codebase-assessment.md](research/codebase-assessment.md) | 上游代码体检：依赖许可证扫描 + 代码量实测 |
| [reuse-plan.md](research/reuse-plan.md) | ⭐ **复用方案核心**：精确分层账本 + 复用矩阵 + 待决策点 |
| [ssos-ai-routing-design-analysis.md](research/ssos-ai-routing-design-analysis.md) | SSOS「AI 配置路由」源码分析：可移植的语义与**不可移植的**设计 |
| [reusable-components.md](research/reusable-components.md) | 外部组件决策表：每个模块"用现成的还是自研" |
| [migration-tooling.md](research/migration-tooling.md) | 迁移工具调研：Flyway vs Prisma 的官方证据与未核实清单（支撑 [ADR-0002](adr/0002-migration-tooling.md)） |
| [ai-competitive-and-architecture.md](research/ai-competitive-and-architecture.md) | ⭐ **AI 调研结论层**：滴答清单的 AI 做法 + AI 排程成败账 + E2EE 下可用的推理架构（支撑 [ADR-0005](adr/0005-ai-data-path.md)） |
| [ai-feature-landscape.md](research/ai-feature-landscape.md) | ⭐ **AI 格局层**：13 个竞品逐产品详述 + 374 条内联来源 + 25 处「未找到公开信息」。⚠️ 与上一条的分工见下方注 |
| [e2ee-apps-ai.md](research/e2ee-apps-ai.md) | ⭐ **E2EE 产品怎么做 AI**（192 处 ✅ 官方全文）：Bear / Joplin / Anytype / Standard Notes / Obsidian / Proton Lumo。🔴 核心结论：**"厂商托管 AI + 维持 E2EE" 在所有样本中一个都不存在**。支撑 [ADR-0006](adr/0006-supply-modes.md) |
| [ai-competitive-teardown.html](research/ai-competitive-teardown.html) | 上两条的**可视化渲染**（战情室风格功能矩阵，单文件、离线可看）。⚠️ **`.md` 是唯一事实源**，本文件只是呈现 |
| [motivation-psychology.md](research/motivation-psychology.md) | ⭐ **习惯养成与激励的心理学证据**：B=MAP / Hook / 实施意图 / 损失厌恶 / 断签放弃效应 / 目标梯度 / 禀赋进度 / 新鲜开始 / SDT / 过度理由效应 / 小胜原则 / 排行榜证据。每条带来源与证据强度标记 |
| [competitor-incentive-teardown.md](research/competitor-incentive-teardown.md) | ⭐ **竞品激励机制拆解**：Forest / Duolingo / Habitica / Streaks / 番茄Todo / 滴答清单 / 小日常 / Apple 健身记录，逐机制规则与数值 + 心理原理 + 对 heyta 的可迁移性 |
| [native-widgets.md](research/native-widgets.md) | ⭐ **原生小组件可行性**：滴答清单各端组件清单（厂商自述）+ 平台事实与前置条件 + 上游已跑通的（单向快照 + 点击队列）契约 + 🔴 E2EE 明文快照与门禁盲区。**顶部有勘误**：macOS / Windows 的"做不了"已被推翻。支撑 [roadmap](plans/roadmap.md) P3 |
| 🔴 ⭐ **[multi-platform-best-practice.md](research/multi-platform-best-practice.md)** | **补上仓库此前系统性缺失的联网检索**（原调研自述 `web_search` 全程 HTTP 432、无社区一手证据）。**业界最佳实践 = 用 React Native 作唯一 UI 实现，各端 RN 平台实现渲成原生控件**；一手证据：微软 Office **40+ 体验用 RN 内容岛嵌进原生应用**、RNW **底层就是 WinUI**、Teams 2.0 换 WebView2、CMP/Tauri 为何不适配本仓。含**对本仓三条既有结论的推翻**与 8 条未核实项。**它直接改了主计划 §3.2/§3.3/§4.3** |
| ⭐ [multi-platform-ui-fusion.md](research/multi-platform-ui-fusion.md) | 🔴 **多端「一套代码」融合调研**：外部最佳实践 × 本仓库实测。**UI 是唯一重复**（12,277 vs 3,661 行）、移动端缺 67% 特性（8,227 行）、Tauri 无同步 IPC / Electron 有、`node:sqlite` 已是 RC、RN 无 Linux 目标。含**方法偏差声明**（本次 `web_search` 全程 HTTP 432，故候选清单不完整）与 10 条未核实项。⚠️ **该偏差已由上面那份调研补齐；其"桌面也上 RN 不可行"的结论已被推翻** |
| [multi-platform-selection-evidence.md](research/multi-platform-selection-evidence.md) | ⭐ **多端选型的组件视角证据**：组件 UI **不可移植**（本仓库上游一手工程记录 + 根因：组件进程跑不了共享运行时）、**真正要写的是 3 份 + 1 个模板不是 5 份**、每平台一次性成本 vs 变体边际成本、拒绝 headless-JS 组件库、**Windows PWA / macOS Continuity 两条路都不免费**、✅ **Developer ID + 公证能带 WidgetKit 扩展（已解决）**、🔴 **Electron 两端都是组件最差项**、鸿蒙卡片**官方封死跨平台**（为卡片建壳收益为 0）。**含 §10 与 [ADR-0024](adr/0024-desktop-shell-and-ui-convergence.md) 的对账**。**这是多端选型计划的输入** |
| [desktop-shell-selection.md](research/desktop-shell-selection.md) | ⭐ **桌面壳（RN 系 / Tauri / PWA）× 系统组件**：`react-native-macos` **0.81.9 vs RN 0.84.1 硬冲突**（出局）、`react-native-windows` 0.84.0 精确对齐但 New Arch 无 C#、**UI 复用度硬数字**（RN Directory 2716 库中 Win 73 / macOS 54 / 两者仅 28）、macOS 组件**能用**（3 个真实 Developer ID 应用）、Windows 组件**必须 packaged + 独立 COM server** + `sparse package` 新线索。⚠️ **必读 §8「2026-09-28 复核」**：RNW **无 ≥0.85 稳定版**（"精确对齐"是负债）、C# widget provider **有官方教程**（"无先例"只是选 RNW 造成的）、heyta 真实缺口是 **4 个原生库 / 3 个缺口**（不是生态的 2.8%）—— 这三条改掉了 §1 结论 2 与 §7.2 的推荐。含 12 条未核实项 |
| [e2ee-widget-key-handling.md](research/e2ee-widget-key-handling.md) | ⭐ **E2EE 产品的组件密钥处理**（源码级判定，不采信搜索）：四模式分类（入口型 / 明文快照 / 组件内解密 / 无组件）+ 逐产品表。🔴 **Bitwarden 根本没有内容组件**（推翻前提）、**只有 Notesnook 走明文**、Proton iOS + Tuta 走**组件内 AES**、**Argon2id 从未进过组件**。🔴 **加密快照 ≠ 锁屏保护（两者正交）**，且 iOS `NSFileProtectionComplete` 与 **macOS Continuity 互斥**。含 CVE-2026-44965（组件配置 Activity 自动登录）

> ⚠️ **两份 AI 调研文档的分工（不要当成重复，也不要让它们漂移）**：
> - `ai-competitive-and-architecture.md` = **结论层**。只放**影响 ADR-0005 / AI 计划决策**的结论，
>   每条都指向决策。**改决策时改这一份。**
> - `ai-feature-landscape.md` = **格局层**。逐产品事实与来源，**事实的原始出处以它为准**。
> - 🔴 **唯一事实源规则**：**同一事实只在一处定义**。格局层给事实，结论层给判断与指向；
>   若两处冲突，**先核对格局层的来源，再修结论层** —— 已发生过一次（§5.2 的 Time Left 更正）。

### 仓库根的其他文档

| 文档 | 内容 |
|---|---|
| [`../README.md`](../README.md) | 项目门面：heyta 是什么、现状、怎么开始 |
| [`../AGENTS.md`](../AGENTS.md) | 🤖 **AI/agent 协作规则**（硬性约束、禁令、工作流） |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | 贡献流程：分支、提交、测试、评审门禁 |
| [`../THIRD_PARTY_LICENSES.md`](../THIRD_PARTY_LICENSES.md) | 第三方代码归属声明与许可证政策 |
