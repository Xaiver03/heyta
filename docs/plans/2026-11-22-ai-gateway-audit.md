# AI 接入网关 + 管理后台 + Harness 报表工具 —— 第八轮审计

> 2026-11-22 · 只读审计（未改代码）· 对象：提交 `417b70dc`（网关服务端）、`62ceff66`（app-host 客户端）、`738444a6`（Web 后台 UI）、`518c655f`（报表工具+文档）、`66630261`（两端接线）。
> 标注约定：**事实**＝已读代码/命令可复现；**推断**＝由代码路径推出、未运行验证；**未核**＝时间盒内未取证。

## 结论摘要

- **P0：无。** 三条硬安全项经核均到位：apiKey 不在任何响应回显（GET/PUT 均 `redactUpstreams`，`ai-gateway.ts:138-142`、`ai-gateway.routes.ts:24-26,60`）；文件 `0600` + 临时文件原子 `rename`（`gateway-store.ts:67-71`）；`/api/admin` 网关路由**确实挂了** `requireAdmin`（插件级 `preHandler`，`ai-gateway.routes.ts:29`；`server.ts:671` 只传 `prefix`，未覆盖 `authenticate`）。
- **P1：4 项**（SSRF 试连、空 apiKey 绕过启动校验、selectUpstream 无健康/熔断、PUT 改 id 静默清空密钥）。
- **P2：8 项**（每请求同步读盘、周报 ISO 时区错位、标题出境无长度上限、UI 失败提示死分支、清空上游回退 env、weight 不生效、注释漂移、报表工具无授权）。

---

## P0

无。判定依据（均为事实）：密钥不回显、文件权限与原子写到位、admin 鉴权落实。SSRF 仅 admin 可达且 `/test` 只回 `status` 不回 body，故不列 P0（见 P1-1）。

---

## P1

### P1-1 `/test` 试连存在 SSRF 面：仅前缀校验 https、默认跟随重定向、无内网/私网阻断
- **事实**：`ai-gateway.routes.ts:80` 仅 `target.baseUrl.startsWith('https://')`；`ai-gateway.routes.ts:88-92` 用 `fetch` 且**未设 `redirect:'manual'`**（Node fetch 默认 `follow`），未解析 URL，未拦 `127.0.0.1 / 10.x / 169.254.169.254 / localhost`；路径由 `baseUrl` 派生（`${baseUrl}/models`）。
- **推断**：`https://169.254.169.254/...`、`https://127.0.0.1:PORT/...`、`https://<内网host>` 均通过前缀检查；重定向可把请求引到任意主机。回包仅 `{ok,status}`，属**状态码 oracle**，可探测内网存活/端口。
- **缓解**：仅 admin 可调用；代理主路径（`/api/ai/managed/chat`）另有 `domesticUpstreamVerdict` 白名单（`managed-completion.ts:300,362`），但 `/test` **不走**该白名单。
- **建议**：改为 `new URL()` 解析 + 解析后 IP 私网/回环/链路本地黑名单 + `redirect:'manual'`；或试连复用 `SERVER_MANAGED_MODEL_HOSTS` 白名单。

### P1-2 文件/env 网关绕过"半套配置"启动校验：apiKey 可空 → 空 Bearer 请求（费额度+明文出境）
- **事实**：`parseGatewayFromEnv` 的 apiKey 可选（`ai-gateway.ts:71,102`）；`selectUpstream` 只筛 `enabled/baseUrl/modelId`，**不检查 apiKey**（`ai-gateway.ts:122`）；`saveGatewayUpstreams` 只拒绝 `skipped`（缺 baseUrl/modelId），不校验 apiKey（`gateway-store.ts:60-66`）。旧代码在 `config.ts:904-918` 于启动期对 `MANAGED_AI_ENABLED=true` 缺 apiKey **直接抛错**，注释明说半套配置会"先扣一次额度、再把明文送到必然拒绝它的端点"。
- **事实**：`managed-proxy` 现改每请求 `storePrimaryConfig()`（`managed-proxy.routes.ts:213`，文件优先），且发送 `authorization: Bearer ${upstream.apiKey}`（`managed-completion.ts:377`）。
- **推断**：后台把某行填了 baseUrl+modelId 而漏填 apiKey（或 provider 本就不需 key），该行 `enabled` 且 baseUrl 命中白名单 → 请求照发、`Bearer `(空) → 401，且用户一次额度已扣、明文已出。这条正是被删注释要防的场景，如今只在 `MANAGED_AI_ENABLED=true` 的 legacy env 组合下保留，file/env 多上游路径缺失。
- **建议**：`parseGatewayFromEnv`/存储层把"enabled 但 apiKey 空"纳入 `skipped` 或保存期 400（可配 `allowEmptyKey` 例外）；保留启动期对生效网关做一次校验。

### P1-3 `selectUpstream` 无健康/熔断/故障转移，不满足 objective 的"健康"
- **事实**：`ai-gateway.ts:119-125` 仅在 `enabled && baseUrl && modelId` 中按 priority 升、weight 降取第一条；无健康状态、无失败计数、无熔断、无重试下一个上游。首选上游宕机时每请求都打到它并失败。
- **推断**：PP 网关/多上游的"高可用"目标未达成；weight 仅参与"取最大那一条"，从不做按权重分流（`ai-gateway.ts:25` 注释亦自承"取最大权重优先"），多上游实际退化为"优先级最高的那一条独占全部流量"。
- **建议**：加最小健康记录（最近 N 次失败打点、临时降权/跳过）+ 失败后尝试下一可用上游；或明确把"健康"降到 P2 并在文档写清本期只做静态选择。

### P1-4 PUT 改 `id` 会静默清空该行 apiKey
- **事实**：合并逻辑按 `id` 找旧行沿用密钥（`ai-gateway.routes.ts:52-56`）：`blank apiKey` 且 `id` 存在才沿用；UI 的 `id` 是**可编辑输入框**（`AiGatewaySection.tsx:114`），保存时 `id: r.id.trim()`（`:63`）。
- **推断**：管理员仅把某行 `id` 由 `pp` 改为 `pp2`（其余不动）→ 旧 id 找不到 → 该条以 apiKey=undefined 保存 → `parseGatewayFromEnv` 置 `''` → 密钥丢失、`hasApiKey:false`、托管 AI 变 401，且无任何提示。
- **建议**：以稳定内部键（如旧 id/行序/隐藏 uid）做合并基准；`id` 变更视为新行并要求显式填 key；保存后回显"哪些行改为无密钥"。补一条"改 id"用例（现测只测"改 label"）。

---

## P2

### P2-1 每请求同步读盘 + 全量 JSON 重解析，无缓存
- **事实**：`storePrimaryConfig` 每请求调 `loadGatewayUpstreams → readFileUpstreams`，执行 `existsSync + readFileSync + JSON.parse`，再塞回 `parseGatewayFromEnv` 二次 `JSON.parse`（`gateway-store.ts:26-37,76-82`；`managed-proxy.routes.ts:213`）。**推断**：高 QPS 下同步 IO 阻塞事件循环；建议按 mtime 做 ≤1s 内存缓存。

### P2-2 周报 `startISO/endISO` 用 `toISOString`（UTC）标注本地周边界，UTC+8 下起始日错一天
- **事实**：`ai-report-tools.ts:52-55` 用本地 `getDay()` 求本地周一凌晨；`:80-81` 却用 `new Date(...).toISOString().slice(0,10)`。
- **推断**：Asia/Shanghai（UTC+8）下本地周一 00:00 = 周日 16:00Z，`startISO` 输出**周日**（应周一）；`endISO` 输出周日（本周日正确）。计数范围本身用 epoch，绝对时间正确，**仅标签日期错**。建议改用本地 date 拼 `YYYY-MM-DD`。

### P2-3 `topCompletedTitles` 为用户文本出境，无长度上限
- **事实**：`ai-report-tools.ts:63,86` 收集标题取前 5，不截断长度；已列入 `egressFields`（`:131`），出境闸门仅保证"已声明才发"（`ai-routed-model.ts:135-148`），**不脱敏**。
- **评估**：为生成周报所必需，方向合理；但单条标题可能很长/含敏感内容。建议每条截断（如 80 字符）+ 总数/长度双上限，或提供"仅计数不传标题"开关。

### P2-4 UI 失败提示为死分支，靠全局横幅兜底
- **事实**：`AiGatewaySection.tsx:73` 失败设 `notice='failed'`，但渲染仅 `notice==='saved'`（`:147`），`failed` 从不显示；真正反馈来自 `AdminPanel.tsx:184` 的 `store.errorKey` 通用横幅（`applyFailure` 覆盖 forbidden/invalid 等，`store.ts:648-656`）。
- **评估**：403/非法输入仍可见（全局横幅），故非完全静默；但 section 自身文案缺失、试连失败只显示 ✗ 无原因（`:133`）。建议就地显示失败原因。

### P2-5 删除全部上游 → 文件写空数组 → 读取回退 env，"清空"不等于"关闭"
- **事实**：`saveGatewayUpstreams([])` 写 `[]`（合法）；`loadGatewayUpstreams` 仅当 `file.upstreams.length>0` 才 `source:'file'`（`gateway-store.ts:48-51`）。**推断**：后台清空后若 env 有 `MANAGED_AI_UPSTREAM*`，实际仍按 env 跑，管理员以为已关停。

### P2-6 `weight` 不参与分流
- 见 P1-3；单列：`ai-gateway.ts:123-124` 只取最大 weight 一条，从无加权轮询。多上游负载不均。

### P2-7 注释/文档漂移
- **事实**：`server.ts:653-655` 注释仍写"上游配置走环境（`MANAGED_AI_*`）"，与"文件优先+后台可改"不符；`admin-client.ts:1013` 注释"当前服务端整份替换"与"省略 apiKey 服务端合并"（`ai-gateway.routes.ts:47-58`）不一致。建议同步。

### P2-8 报表工具无授权概念（Harness 恒可用）
- **事实**：`createReportAwareTransport` 只要注入了 `getReportState` 即挂上 `weekly_report/year_end_summary`（`ai-cloud-assistant.ts:66-69`），不校验 plan/权益。数据为本机只读物化状态、只发计数+≤5 标题。
- **评估**：只读本地数据、无副作用，恒可用**基本合理**；但若后续把"报表"当付费档卖点，需要考虑权益分层。当前不构成风险。

---

## 关键项逐条核对（事实/推断/未核）

| 项 | 结论 | 证据 |
|---|---|---|
| GET 是否回显 apiKey | 否，`redactUpstreams` 去 key 只留 `hasApiKey` | `ai-gateway.routes.ts:24-26,37`；`ai-gateway.ts:138-142`；测试断言 `not.toContain('secret')` `ai-gateway.routes.spec.ts:46` |
| PUT 响应是否回显 apiKey | 否，返回 `view(saved.upstreams)` | `ai-gateway.routes.ts:60` |
| 错误信息是否含 apiKey | 否，保存错误只拼 `skipped.reason` | `gateway-store.ts:63` |
| 日志是否含 apiKey | 否，网关三文件无 `Logger/console` 调用（grep 无命中） | `grep Logger/console` 空 |
| 文件权限/原子写 | `0600` + `.tmp-<pid>` 写后 `rename` + `chmod` | `gateway-store.ts:67-71` |
| 临时文件残留同名且旧权限不同时 mode 不复置 | **推断**小风险 | `writeFileSync(..., {mode})` 仅在创建时生效，`gateway-store.ts:69` |
| `/api/admin/ai-gateway` 是否挂 requireAdmin（注册） | 是，独立插件 `preHandler`，encapsulated | `ai-gateway.routes.ts:29`；`server.ts:671` |
| 生产是否被测试注入覆盖 | 否，`server.ts` 只传 `prefix`，`options.authenticate` 为 undefined → 用 `requireAdmin` | `server.ts:671` |
| `/test` https 限制是否足够（防 SSRF） | 不足（前缀校验、跟随重定向、无内网阻断） | 见 P1-1 |
| 代理主路径是否受白名单保护 | 是，`domesticUpstreamVerdict` 预检+发送点各一次 | `managed-completion.ts:300,362` |
| selectUpstream 健康/熔断 | 无 | `ai-gateway.ts:119-125` |
| 每请求读文件并发/性能 | 同步读盘无缓存 | `gateway-store.ts:26-37,76-82` |
| 启动期校验差异 | legacy env 仍抛（`config.ts:904-918`）；file/env 网关不校验 apiKey | 见 P1-2 |
| 报表出境字段是否受控 | 是，`assertToolObservationsDisclosed` 拦未声明字段 | `ai-routed-model.ts:135-148` |
| 周报周一起算 | 是（本地 `getDay` 映射周一=0） | `ai-report-tools.ts:52-55` |
| 周报 ISO 标签时区 | 错位（UTC+ 起始日早一天） | 见 P2-2 |
| 两端 getState 是否为空致失真 | 否，Web 传 `MaterializedState`（含 tasks/projects/habitLogs/focusSessions、Task.completedAt/createdAt），移动传 `host.getState()` 同型 | `apps/web/.../cloud-harness.ts:76`；`apps/mobile/.../cloud-harness.ts:76`；`packages/op-log/src/state.ts:55-73`；`entities.ts:259,311` |

---

## vendored 改动评估（`managed-proxy.routes.ts`）

- **事实**：改动 6 行——`import` 换成 `storePrimaryConfig`、删除 `const upstream = options.upstream ?? loadConfigFromEnv().managedAi`（原 `:162`）、在请求体解析后新增 `const upstream = options.upstream ?? storePrimaryConfig()`（`:213`）。
- **是否破坏既有 30 条测试语义**：既有测试均注入 `options.upstream`（`managed-proxy.routes.spec.ts` 30 个 `it`），`options.upstream ?? ...` 短路使走注入分支，故不回归（事实）。
- **未覆盖的行为变化**（推断）：
  1) "启动期读一次" → "每请求读文件"，文件读取/解析路径在 proxy 测试中**从不触发**（全部注入 upstream），属未测新路径；
  2) file 路径无启动期校验（P1-2）；
  3) 每请求同步 IO（P2-1）。
- **建议**：新增一条不传 `options.upstream` 的集成用例——写临时 `AI_GATEWAY_FILE`，断言选中文件里的上游；并给 `storePrimaryConfig` 加 mtime 缓存。

---

## 测试价值

- **可转红**：`ai-gateway.spec.ts` 对脱敏有 `JSON.stringify(view).not.toContain('secret')`、对选择有明确 id 断言；`ai-gateway.routes.spec.ts` 对"改 label 保留密钥""非法项不落盘""http 拒绝"均为可失败断言（事实）。
- **关键缺口（事实）**：
  1) **admin 鉴权未测**——routes 测试用 `authenticate: async () => {}`（`ai-gateway.routes.spec.ts:26`）绕过 `requireAdmin`，即使移除鉴权测试仍绿；
  2) **SSRF 未测**——无重定向/私网/回环用例，无"空 apiKey 发空 Bearer"用例；
  3) **PUT 改 id 清空密钥未测**——只覆盖"改 label"；
  4) **清空上游回退 env 未测**；
  5) **按网关选上游的文件热读路径未测**（见上）。
- **建议补**：① 用真实 `requireAdmin` + 非管理员令牌断言 403；② `/test` 用例覆盖 `https://127.0.0.1`、重定向到 http、`redirect:'manual'` 生效；③ enabled 且 apiKey 空 → 保存 400 或选定跳过；④ 改 id → 明确提示/需重填 key；⑤ proxy 不注入 upstream + 临时文件集成。

---

## 管理后台 UI 汇总

- apiKey **明文仅短暂存于组件 state**（输入框 `type=password`，初值 `''`，从不回显、不进 store、不进 GET；保存成功后 `store.aiGateway` 更新触发 `useEffect` 重置清空）——`AiGatewaySection.tsx:41,120,32-48`。**评估：可接受**（表单必需，未渲染、未持久化）。
- 保存整份替换：`rows.map` 全量提交（`:62-71`）；未改行 apiKey 空→服务端按 id 合并保留（正常）；**改 id 则丢 key（P1-4）**；删除行即删上游；清空全部→回退 env（P2-5）。
- 无 admin 权限：`applyFailure` 置 `access:'denied'` + `errorKey`，`AdminPanel.tsx:184` 横幅展示（事实）；section 自身 `failed` 不渲染（P2-4）。

---

*未核项*：`storePrimaryConfig` 在真实高并发下的延迟未实测（仅代码推断）；移动端 `host.getState()` 运行时是否始终已物化到最新（仅类型一致推断）；`/test` 对云元数据端点的实际可达性未在真实网络验证。

---

## 处置（Lead 终审，2026-11-22）

| 审计项 | 处置 |
|---|---|
| **P1-1 /test SSRF** | ✅ 已修：新增 `isPrivateHost`（localhost/回环/私网/链路本地/IPv6 本地）拒绝；`redirect:'manual'` 不跟随跳转。测试：内网地址 → 400 且**未发起请求**。 |
| **P1-2 空 apiKey 出网（扣额度+明文）** | ✅ 已修：`selectUpstream` 要求 `apiKey !== ''`；无有效上游 → 代理 `not-configured`，不再发 `Bearer `。测试补。 |
| **P1-4 PUT 改 id 静默清空密钥** | ✅ 已修：UI 对**已存在行**的 id 输入禁用（不可改 id）；服务端仍按 id 合并密钥。 |
| P1-3 selectUpstream 无健康/熔断/故障转移、weight 不分流 | ⚠️ **记录为已知缺口**（未尽）：当前"选一条可用上游"，无失败转移。后续可加 per-upstream 健康（复用 `managed-proxy` 的 attempt 记录）与按 weight 分流。不假装已做。 |
| P2 每请求同步读盘无缓存 | ⚠️ 记录（文件小；后续加 mtime 缓存）。 |
| P2 周报 startISO 在 UTC+8 错一天 | ✅ 已修：改本地日期格式化（不再用 `toISOString().slice`）。 |
| P2 标题出境无长度上限 | ⚠️ 记录：已限"最多 5 条"，后续可加长度截断。 |
| P2 清空上游回退 env / weight 不生效 / UI 失败靠全局横幅 / 注释 | ⚠️ 记录（非阻断）。 |
| 测试缺口（鉴权绕过/SSRF/改id丢钥/文件热读） | 部分补：SSRF、空key、改id锁。鉴权仍靠 requireAdmin 挂载（已核 server.ts:671）；文件热读路径待补。 |

验证：server 44 测试、report 3 测试、web tsc 0 绿。
