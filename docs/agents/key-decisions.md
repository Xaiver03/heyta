<!-- 由 heyta/AGENTS.md 按作用域拆分而来（2026-10-12）。内容零删除。
     本文件是「已定的关键决策」的完整规则（原文 §9 已定的关键决策）。返回入口：[`AGENTS.md`](../../AGENTS.md)。
     原始单体文件备份：`AGENTS.md.bak-full-2026-10-12`。 -->

### 2026-09-27：第一段用户旅程闭环（一批并行工单）

[`docs/plans/roadmap.md`](../../docs/plans/roadmap.md) §5.1 原先列的三条断点**全部关闭**，外加两条同批的：

1. **落地页 → 应用**：入口由构建期 `VITE_APP_URL` 决定（`apps/landing/src/lib/app-url.ts`）。
   未配置时**整条入口不渲染**；仓库默认构建就是未配置，那是**故意的**。
2. **Web 注册 / 登录入口**：协议语义收进 `packages/app-host/src/hosted-auth.ts`，
   面板开在**同步设置内部**（认证要用的服务端地址就是那里的地址，分开会出现"对着 A 登录、令牌存到 B"）。
   通行密钥的**浏览器端那一步**在 `apps/web/src/features/auth/passkey-browser.ts` ——
   `navigator.credentials` 的平台调用**按设计不在 app-host 里**（否则要引入 `@simplewebauthn`，
   过不了 §3.1–3.2 两道门）。注册与登录两条路都通了。
   验收是两层的：单测 45 条（转换层逐字段钉字节 + store 接线 + **失败不许被当成成功**），
   外加**真浏览器 + 虚拟认证器 13/13**。其中最有价值的两条：
   ① **反证**：把服务端下发的 JSON 原样丢给 `navigator.credentials.create()`，Chromium 会以
   `TypeError: Failed to read the 'publicKey' prope…` 拒掉 —— 证明"JSON ↔ ArrayBuffer"转换层不是多余的；
   ② 把产出的 `clientDataJSON` 解出来，`challenge` 必须**原样回显**（长度对但内容错也会被它抓住）。
   ✅ **找回通行密钥的入口已补**（2026-09-27）：面板上新增
   "丢失了通行密钥？发一封找回链接"（`store.ts` 的 `requestRecovery` → `POST /api/recover/passkey`）。
   🔴 **同时纠正一条这里记错的结论**：上面曾写"三个端点在 app-host 里有函数、没有入口"，
   读起来像整条流程都缺。**恢复本身早就有** —— 是服务端渲染的 `/recover-passkey` 页面 +
   `recover-passkey.js`（线上实测两者都 200）；那一步必须在真实浏览器里调
   `navigator.credentials.create()`，本来就不该在 SPA 里。**缺的只是"触发那封邮件"这一步。**
   教训：**只在 `apps/web` 里搜，就会把服务端渲染的流程误判成"没做"。**
   验收：9 条单测 + 变异验证（按钮 `onClick` 换空操作即转红）。
   🔴 **本条下面那句"仍然没有增删凭据"已经过期（2026-09-28 逐条核过）**：
   新增 / 列出 / 改名 / 删除**全都有** —— 端点在 `packages/app-host/src/hosted-auth.ts`
   （`listPasskeys` / `deletePasskey` / 改名走同一条纪律），UI 是设置页的
   `apps/web/src/features/settings/PasskeyPanel.tsx`（含两段式删除与"最后一条不许删"）。
   留一行原文是为了让人看清它错在哪：**"没有入口"这句话的保质期取决于别人什么时候补上它**，
   所以它旁边必须写核对的日期。判据见 [`docs/plans/roadmap.md`](../../docs/plans/roadmap.md) §5.1.1 那张表。
3. **导出**：`packages/app-host/src/export-dump.ts`。含**墓碑**与完整 op-log，
   另有可核对的 `counts`（丢掉墓碑的"备份"回放时已删数据会复活）。
   🔴 **范围已过期（2026-09-28 逐条核过）**：原文写"入口在 Web 设置页与 node-host CLI，
   **移动端没有**。**只能导出，不能导回。**"—— 两句都不对了。
   ~~现在的覆盖是：**导出**三端都有；**导入**只有 Web 与 CLI，**移动端没有导入入口**~~
   ⚠️ **这句在 2026-10-03（goal 批五）过期了**：现在的覆盖是**导出与导入三端都有** ——
   导入侧新增移动端「我的 → 导出数据」页里的「从备份还原」卡（选文件或粘贴两条路 →
   `parseExportDocument` 预检并展示 counts → 确认 → `restoreIntoEmptyTarget`），
   与 Web 同一条口径「只支持还原到空库」；设备级判据是 `scripts/verify-mobile-restore.sh`
   （真模拟器 + 真服务端 + 真浏览器导出，零 mock）。那条"导不回来"的诚实条款也随之改写：
   移动端现在能导回来，但**还原回来的数据只在这台设备上**（备份里的 op 带原设备的
   `clientId`，服务端逐条回 `INVALID_CLIENT_ID`，设计上就不上行）—— 界面文案说的是这个。
   覆盖率与判据表见 roadmap §5.1.1。
4. **回收站**：还原 = `UPD { deletedAt: null }`；彻底删除 = 打 `purgedAt` **标记**，
   **不清除 `deletedAt`**（清了会让离线对端把已删数据**复活**）。只有 TASK，不含 PROJECT / TAG。
5. **移动端成长体系**：共享取数在 `packages/app-host/src/motivation.ts`；
   移动端「我的 → 成长」是**第二层页面**，底部仍是 5 个标签。
   🔴 **"没在真机 / 模拟器上验过"已经过期（2026-09-28 逐条核过）**：
   已在 **iOS 模拟器上实跑并截图**（浅色 + 深色两版，深色是 `simctl ui appearance dark`
   真的切过），验收记录在 [`docs/plans/roadmap.md`](../../docs/plans/roadmap.md) §5.1.1 的断点 6。
   唯一**仍然**没验的是"超长习惯名的换行"—— 当时手机上没有习惯数据（移动端没有建习惯入口），
   只证到代码层。**仍然没上过真机**（需要签名）。

**应用本体的部署**（在此之前它**从来没有被部署过**）：
`https://heyta.finlaw.cloud/app/`。方式与两个必须记住的坑见
[`deployment.md §3.7`](../../docs/runbooks/deployment.md)。两个要点：

- 🔴 **`vite build --base=/app/` 不能省** —— 默认 `base` 的资源是根绝对路径，
  挂在 `/app/` 下会去请求落地页的路径、拿回 HTML 而不是样式表，现象是控制台报
  **样式表 MIME 是 `text/html`**。
- 🔴 **测试阶段唯一的域名是 `heyta.finlaw.cloud`**（2026-09-27 从
  `heyta-tmp.litopia.space` 完整迁来，见 deployment §3.7.1）：落地页（`/`）、
  应用（`/app/`）、同步 API（`/api/`）、三张凭据页都在它下面。
  旧域名只保留同步服务端（`/api/`、`/health`、Connect 页）与**入口的 301** ——
  API 端点刻意不做重定向，301 会把 POST 改写成 GET、无声打断正在同步的客户端。

**服务端镜像没有重建**：`server/` 里的品牌改动（SuperSync / Super Productivity → heyta）
**还没上生产**，线上实测仍有 3 次 "Super Productivity"。要走 `server/scripts/deploy.sh`。

### 已定的关键决策

- **ADR-0001 许可证 = MIT** ✅（[`文档`](../../docs/adr/0001-license-decision.md)）。与 vendored 的 MIT 底座天然兼容。
- **ADR-0002 迁移工具 = 继续用 Prisma** ✅（[`文档`](../../docs/adr/0002-migration-tooling.md)）。
- **ADR-0004 UI 栈 = React Native** ✅（[`文档`](../../docs/adr/0004-ui-stack.md)）。
  跨平台，且是"排除 WebView 套壳后仍覆盖 iOS + 鸿蒙、还在 JS 生态里"的唯一选项。
  🟢 **原生侧已实测编译出 HAP**（`pnpm verify:harmony-rnoh`，2026-09-27）：
  NDK 自带的 cmake + ninja 现编了 RNOH 的 C++（`BuildNativeWithNinja` 1 分 2 秒），
  产出 37 MB HAP，含 `librnoh_core.so` / `librnoh_app.so` / `libreactnative.so`（双 ABI）。
  "最可能出问题的地方"（原生侧要本地编译 `.so`）**通了**。
  🟡 **但仍未跑起来** —— 缺模拟器系统镜像 + 签名（产物是 unsigned，装不进设备），
  且 JS 侧 codegen/autolinking 本轮用**桩**顶替。ADR-0004 的结论**暂不需要重估**，
  但最后那一环（真跑起来）仍是它唯一的硬证据。见 §3.24。
- **ADR-0008 向量时钟上限 = 100** ✅（[`文档`](../../docs/adr/0008-vector-clock-limit.md)）。
  原值 20 会让设备写入被**永久拒绝**（服务端 head 与客户端各自裁剪、规则不同）。
  ⚠️ **这是把墙挪远、不是拆掉**：因果安全的压缩**未做**，
  存量受害账号能否自愈、warning 在 Hermes 上是否可见 —— 都**未实测**（ADR §5）。
- **ADR-0009 精确重复的 op = 幂等成功** ✅（[`文档`](../../docs/adr/0009-duplicate-op-idempotent-success.md)）。
  原先回 `DUPLICATE_OPERATION` 会让一台设备**永久同步不了**（硬拒绝 → 不落"已上传" → 重传整批 → 又硬拒绝）。
  现在回 `accepted: true` + **原 serverSeq**；**`INVALID_OP_ID` 那几条硬拒绝一条没放松**。
  这不是新发明：上游 snapshot 路径早就是这么做的（`sync.routes.snapshot-handler.ts:454-478`）。
- **ADR-0005 / 0006 AI 的数据路径与供给模式** ✅（[`0005`](../../docs/adr/0005-ai-data-path.md) / [`0006`](../../docs/adr/0006-supply-modes.md)）。
  AI 是**输入法**不是业务规则：只产出建议、**类型上产生不了 op**，写入必须过 `dispatch()` + 用户确认。
  🔴 **托管 AI 与 E2EE 在定义上不能共存** —— 可以提供，但必须是一个明确、可撤销、
  按功能开启的**例外**，**绝不得被描述成端到端加密**。
- **ADR-0010 AI 配置路由** ✅（[`文档`](../../docs/adr/0010-ai-config-routing.md)）。
  三道闸（总开关 / 允许远程 / 逐功能出境授权）；🔴 **回退不得跨越隐私边界** ——
  本机端点挂了**不许**悄悄发给云端，用 `fallback-needs-consent` 钉住，且**一次请求都不发**。
  能力**显式声明、不做推断**；URL 校验在保存与发送**两个点**执行。
- **ADR-0011 本机 API / MCP** ✅（[`文档`](../../docs/adr/0011-local-api-mcp.md)）。
  默认关（**每个工具单独默认关**）、只监听回环、显式 token、逐工具授权；
  🔴 **加密条目可列举、不可读**；写入只能经 `dispatch()` 形状的端口。
- **ADR-0013 云端 AI 与 MaaS** ✅（[`文档`](../../docs/adr/0013-cloud-ai-and-maas.md)）。
  **方向已定**（会提供统一云端 AI 并按此收费，后续 MaaS）。
  🔴 **2026-10-05 状态更正（[`ADR-0054`](../../docs/adr/0054-managed-ai-retention-and-selling-preconditions.md)）**：
  原来那句"`assertEnableable()` 继续抛 `retention-undecided` 挡住 `managed`"**已过期** ——
  保留策略定案、计量与托管代理路由落地、那条 reason 连成员一起删了；
  本 ADR **没有改**的那一条是"托管 AI 与端到端加密互斥，只能作为明确、可撤销、按功能开启的例外"。
  ⚠️ 顺序纪律仍然有效（原句"不许先把计费做了、保留策略以后再说"）：ADR-0054 走的是
  **先补计量、后解禁售**，不是绕过它。而这一档**今天在客户端仍打不开**（0054 §8）。
- **ADR-0014 记忆偏好层的两个闸门** ✅（[`文档`](../../docs/adr/0014-memory-switch-and-corrections.md)）。
  `memoryEnabled` **必填且默认关闭（fail-closed）**；推断结果**不持久化**
  （纯函数，每次从 op-log 重算），只有用户**纠正**进 op-log 跨设备同步；
  两个新实体是**纯可加性**的 —— **不需 bump `CURRENT_SCHEMA_VERSION`**。
- **ADR-0022 习惯韧性的「冻结余额」= 纯派生且不上界面** ✅（[`文档`](../../docs/adr/0022-resilience-state-stays-derived.md)）。
  它是**库存**不是事实（等于说"你还有 N 次可以不来的机会"）、用户对它**不可操作**、
  且是整套体系里**唯一的货币** —— 唯一一处会让 heyta 读起来像资源管理游戏的地方。
  关键推论：**界面上不出现的东西不需要稳定的持久化结构**，
  于是「派生还是加字段」这个二选一被**消解**（承接 ADR-0014 的"派生不持久化"）。
  🔴 配套纪律：**冻结参数只能放宽、不能收紧** —— 收紧会让重放把历史连续天数
  **变小**，违反"只增不减"；真要收紧走**代码常量切分点**，**仍然不加字段**。
- **ADR-0023 托管 AI 的「300 次/月」本轮不实现** ✅（[`文档`](../../docs/adr/0023-managed-ai-quota-not-implemented.md)）。
  它**不**改动 ADR-0020 / ADR-0021 的价格、额度或模型 —— 判定的是**落地顺序**：
  端点 / 计量 / `deepseek` 调用 / 收银台**一个都不存在**，而承诺已写进文案与法务（5 处）。
  🔴 硬约束：**计量存在之前 `hosted-ai-monthly` 不得被售卖**（违反了就是收钱不交付）。
  `pnpm check:ai-quota` 把**唯一数字源**（`docs/reference/pricing-and-entitlements.md` 的
  `ai-quota-ssot` 块）与那 5 处承诺、以及"状态声明 ↔ 实现"绑定起来。
  ⚠️ 这是**有终点的决定**，不是拖延：清空 ADR §5 的最小清单之日，就是它被取代之日。
- **AI 的完整架构**见 [`docs/reference/ai-architecture.md`](../../docs/reference/ai-architecture.md)
  （模块地图 / 封闭词表 / 全部具名常量 / 20 条不变量清单）。
  **AI 的入口文档是 [`docs/plans/ai-strategy.md`](../../docs/plans/ai-strategy.md)**，先读那份。

**当前没有阻塞性决策**，P2 可以持续推进；P0 / P1 已交付，AI 轨道的 AI-0 / AI-1 / AI-2 与
本地 API（MCP）也已落地（清单见 [`docs/plans/roadmap.md`](../../docs/plans/roadmap.md) §1.1）。

**唯一一条"已知会收钱不交付"的红线**在 ADR-0023：`hosted-ai-monthly`（¥12 档）
**计量存在之前不得被售卖**，收银台不许把它变成可支付的订单。
