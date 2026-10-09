# 自动收集计划第二轮严格复审

> 日期：2026-10-07。结论：**产品方向成立，第一轮审计的核心代码依据可信；107 行更新版仍不是可直接实施的协议。** 本轮已获得继续设计、实现与跨端验收的授权。本文是证据归档，进度只记在[唯一计划](../plans/inbound-automation.md)。

## 1. 证据边界

HEAD 为 `b081811c691a17ff57ed0379a005d1a175fe393d`，共享工作树有大量未提交改动。已保存[输入计划快照](evidence/inbound-automation-review/plan-before.txt)与[逐文件 SHA-256](evidence/inbound-automation-review/source-manifest.json)，不以 HEAD 代替工作树基线。不修改第一轮审计的历史结论。

重新核对了第一轮 P1/P2 的承重路径：engine 的新 op 身份与落盘顺序、reducer 的共享 payload、创建动作的新实体 ID、WeakMap 生命周期、权益守卫关闭后直接返回、托管 AI 周期计数器、发送前扣数、Vault 严格包形状、宿主本地日期换算、AI feature 词表和前台同步门槛。均与第一轮主要结论一致。

但“引用正确”**不能独立证明作者身份、审计过程的独立性或作者确实逐行阅读过**；一个快照摘要也不能单独证明其历史时间。可以确认的是可复核的技术内容可信，不能把这些证据升级为对报告来源的认证。未重新核验帮助中心线上发布状态。

实际复跑：Node 宿主 `local-api-server.spec.ts`、`mcp-stdio-e2e.spec.ts` 共 **40/40**；服务端 `validation.service.spec.ts`、`conflict.spec.ts` 共 **93/93**。前者包含真实 HTTP/MCP，后者是现有纯验证/冲突测试，均不是自动收集功能验收。调用包内现有 Vitest，没有启动数据库或部署。

新增[只读源码探针](../../research/tools/verify-inbound-plan-audit.ts)，经工作区 esbuild 从源码打包，分别在 `TZ=Asia/Shanghai` 与 `TZ=America/New_York` 运行，断言全部通过。探针实测：不同设备的两枚创建 op 得到两条任务；既有 batch 对各实体使用同一 payload；仅有开始时间的任务月视图投影为 1、日/年投影为 0；上海零点日期在纽约显示前一天中午。**这是现有原语反例，不是十个崩溃窗口的实测。**

复现：

```sh
mkdir -p tmp/inbound-audit
pnpm --filter @heyta/op-log exec esbuild ../../research/tools/verify-inbound-plan-audit.ts --bundle --platform=node --format=cjs --outfile=../../tmp/inbound-audit/probe.cjs
TZ=Asia/Shanghai node tmp/inbound-audit/probe.cjs
TZ=America/New_York node tmp/inbound-audit/probe.cjs
pnpm --filter @heyta/node-host exec vitest run tests/local-api-server.spec.ts tests/mcp-stdio-e2e.spec.ts
pnpm --filter @heyta/sync-server exec vitest run tests/validation.service.spec.ts tests/conflict.spec.ts
```

## 2. 仍须裁定的缺口

### R1 · P1：撤销边界与提交许可之后的可恢复性尚未选定

计划同时要求提交 fencing、过期不新建、暂停立即失效和断网恢复。`OpLogEngine.dispatchLocked` 是本地事务，无法与中心撤销事务原子提交。只在派发前查询一次租约，会留下“检查通过→暂停/过期→本地写入”的窗口。稳定实体 ID 也不能防止生成第二枚 op 或覆盖后续编辑。

**裁定方向：** 将中心一次性提交许可的原子授予作为自动化意图的不可撤销边界；许可前可转派与撤销，许可后永久绑定认证设备和提交身份，不因租约到期转派。暂停/撤销只能阻止新的许可，已授权结果明确显示在途。失去提交设备且尚未同步时为 `commit-uncertain`，允许对账，禁止假装安全重建。原任务和手工离线写入不受此在线协议影响。若产品要求许可后仍立即取消，必须换协议，不能仅加一次布尔检查。

### R2 · P1：换设备补传原 op 与现有认证冲突

> **本段对“认证设备”的原判断过强，已由 §4 的完整调用链更正；实施时采用 §4 与 ADR-0059。**

`server/src/sync/services/validation.service.ts` 的 `validateOp` 首先拒绝 `op.clientId !== requestClientId`；`packages/storage/src/op-log-store.ts` 的 `appendImported` 文档明确导入外设备 op 不进上传队列。B 不能冒充 A 补传，重新盖上 B 的 clientId 又不再是同一操作。上一份审计没有点明这条接入约束。

**裁定方向：** 首版不新增代签/代理上传权。许可前 B 可接手，许可后 B 只能下载已同步的原 op 并核实；无法观察到结果不等于原设备没有落盘。若未来要求丢失设备后的自动接管，须新增经独立审查的加密提交恢复协议。

### R3 · P1：既有同步“重复成功”不是冻结结果的内容证明

`server/src/sync/conflict.ts` 的 `isSameDuplicateOperation` 在两边均为加密 payload 时**跳过密文字节比较**（代码解释为随机 IV 重试），其余身份字段仍比较。因此不能用一次同步重复成功证明新的正文、解析结果或 commit 内容一致；更不能为了共用 opId 而每次重造时钟/时间戳。

**裁定方向：** 自动收集单独绑定事件摘要、规则版本、解析版本与一次提交身份；冻结解析密文和已构造的原 op，禁止以相同 ID 换内容。接收去重与提交去重是两层，不能互相替代。新增协议不放宽既有同步鉴权，也不凭空宣称同步服务可以验证明文相等。

### R4 · P1：时区不仅影响解析，还影响持久化与展示

`packages/domain/src/date.ts` 将 epoch 本地零点当“仅日期”，不能保存跨设备稳定的日历日语义。`calendarTaskSpan` 支持开始时间；`calendarDayBuckets` 和 `groupTasksByDueDate` 只读截止时间，分别被日、年视图调用。把日期正确转为 epoch 后，任务仍可能跨天或从部分视图消失。两时区源码探针已实测这一差异。

**裁定方向：** 中间契约保留 date-only 与 instant 两种显式类型；新增可选日期语义字段并给既有数据默认行为；完整检查月/周/日/年/时间线/提醒的消费者。开始和截止继续独立，不靠偷偷补截止来让日历出现。相对日期默认锚定服务器接收时刻；来源发生时间只有规则显式授权、格式与范围合法时才使用，不能信任正文自报时间。DST 重叠/缺口整批待确认，执行设备时区不参与解释。

### R5 · P1：HMAC 密钥的存储和轮换不是普通 token 哈希

HMAC 校验需要可用的签名密钥，不能把普通 bearer 的单向 token 哈希存储模式直接搬过来。反过来把密钥放数据库明文，会新增数据库泄漏后的伪造能力。仅在正文上签名，也不能绑定规则、幂等身份和类型。

**裁定方向：** 明确 keyId 是公开标识而非秘密；随机签名密钥只展示一次，服务端以独立部署 KEK 包装，数据库不存明文，不以数据库内另一个字段充当 KEK。轮换保留事件的规则级去重身份；不能把 keyId 纳入去重主键导致换钥重放。旧钥撤销后拒绝其新接收与查询，已受理事件沿用明确定义的取消/许可边界。没有 KEK 时功能不可启用。

### R6 · P1：密码学与时区能力缺口必须落实到真实宿主

`packages/sync-core/src/encryption/web-crypto.ts` 和 `packages/app-host/src/calendar-anchor.ts` 已记录 Hermes 不保证 `crypto.subtle` / `Intl`。新公钥 envelope 若只在 Node WebCrypto、IANA 解析若只在桌面 Intl 通过，都不能证明移动端可执行。

**裁定方向：** 账号收件密钥、Vault 包装、根轮换与旧队列必须设计在一起；密码学依赖先验证维护性/许可证，业务层复用既有 AES 原语。设备注册报告实际能力，缺算法/时区能力时只能显示管理与等待，不能静默按宿主本地时区处理或直接宣称全端 worker 可用。恢复/轮换/撤销均需真跨端证据。

### R7 · P1：账本与持久解析结果涉及另一份历史承诺

[ADR-0054](../adr/0054-managed-ai-retention-and-selling-preconditions.md) 不仅定义额度，还承诺托管 AI “服务端只保留计数”、正文只驻留单次调用内存。自动收集新增事件账本和冻结解析结果，不能仅在新 ADR 里限定取代 0017/0020 就结束。尤其不能为了重试把模型明文响应缓存到服务器。

**裁定方向：** 事件账本只留元数据；客户端用收件公钥封装冻结结果，代理不持久缓存模型明文。模型响应丢失记录 `unknown`，默认不自动再调用；明确重试的预算归属与用户确认，不把“功能不额外计费”偷换成“供应商只调用一次”。新 ADR 限定新增事件元数据/密文队列的例外，保留代理正文不持久化承诺；更新既有中英法务与注销链路。

### R8 · P2：全体 P1 阻塞全部 AC 的任务依赖不合理

107 行版规定八项未定前“任何 AC 不得开工”，会连可独立验证的协议模型、批语义设计和反例探针也一并堵住。与此同时，没有产品数值又不可直接宣布整项开发完成。

**裁定方向：** 分清协议/探针工作、生产接线和对外发布三种门槛。可先实施已定契约的基础切片；不可据此开放功能。每个切片按设计、接线、恢复、平台、当前产物分别取证。商业价格与保留数值未获裁定时保留待决，只阻止依赖这些数值的接线与售卖，不伪造产品批准。

## 3. 复审结论

原审计不是一份可直接执行的设计，它可靠地指出了缺口；更新版计划仍主要是“需要定义什么”。本轮增加了可执行反例，识别了认证设备补传、日期展示和历史计量承诺这三类第一轮未展开的接入约束。下一步按唯一计划定稿协议，再顺序实现和验收。**40 + 93 项既有测试及本轮探针不构成新功能完成证据。**

## 4. 同轮深入追踪勘误：现有 clientId 不是认证设备身份

R2 引用的 `validateOp(op, requestClientId)` 只做内部一致性检查。继续向上追到 `server/src/sync/sync.routes.ops-handler.ts`，其中 clientId 来自 `parseResult.data`（请求正文）；`server/src/middleware.ts` 的 AuthUser 与赋值仅有 userId/email。`server/src/sync/services/operation-upload.service.ts` 将正文 clientId 原样传给验证器。

因此，R2 所谓“B 不能冒充 A”**不能作为安全结论**。普通 B 宿主沿用自己的 clientId 会被拒，但同账号调用者修改两处 clientId 后，不会被这一检查识别。上一轮验证函数的 93 项通过，也不证明存在设备认证。新增[调用链文件摘要](evidence/inbound-automation-review/identity-callpath.json)保留本次读数。

修正方案见 [ADR-0059](../adr/0059-inbound-worker-authenticated-identity.md)：独立 worker 随机凭据、服务端分配且不可自报的 owner、本地库 epoch，以及普通同步入口对 `inbound:` 保留前缀的额外保存前门禁。唯一许可的产品取舍不变，但它依赖**新身份协议**，不能再说直接复用现有设备认证即可。此项尚未实现，必须作为 W3/W4 前置。

## 5. 第三轮严格复审：公网接收切片（2026-10-08）

本轮逐文件复核新接线 `server/src/automation/inbound.routes.ts`、两枚新增迁移、
`server/src/automation/rules.ts` 的 keyring 读取和 `server/src/server.ts` 的插件注册，
并运行真 Fastify HTTP 测试。结论是：**公网接收的最小安全边界已实现，但自动收集仍不能宣称完成或上线。**

已确认的承重行为：

- 路由作用域内把 JSON/text body 保留为 Buffer；验签串使用真实方法、路径、keyId、事件 ID、
  canonical Content-Type 和原始字节摘要。重复 header、压缩、坏 UTF-8、JSON 重复键/复杂度和
  时间窗由共享原语拒绝；响应不回传正文。
- 规则启用、keyId 匹配和账号收件公钥检查在密文写入前完成；`sealInbound` 的 AAD 绑定
  server origin、账号作用域、规则、事件、用途和 key epoch。数据库只写 envelope JSON 和最小
  去重元数据，七天过期时间由接收时钟冻结。
- 同 eventId 同原始字节与类型返回原状态；同 eventId 异字节或异类型返回 409。复核时发现
  原迁移的 `(userId,dedupeDigest)` 唯一约束会错误阻止“相同内容、不同来源 ID”的新意图，
  已以新迁移删除该约束并保留查询索引；没有修改已应用迁移。
- 收件公钥 API 使用 base64url，而 envelope 契约使用 canonical base64；接收边界已显式
  规范化，避免首个真实公钥注册后必然 500。这是本轮复审发现并修正的接线缺陷。

真 HTTP 阶段证据：`server/tests/inbound-automation.routes.spec.ts` 4/4；另有服务端
TypeScript、`check-migrations` 和 Prisma schema 生成通过。该证据不覆盖队列领取/租约、事件级
AI 计量、模型结果冻结、唯一提交许可、客户端 Vault/worker、UI 或十一个故障注入窗口；AC-1～AC-8
仍未闭合，Goal 继续 active。

真 PostgreSQL 复跑：一次性 loopback PostgreSQL 14.18 应用当前全部迁移后，
`server/tests/integration/inbound-worker-identity.integration.spec.ts` **16/16** 通过，
其中新增 webhook 用例验证规则/收件公钥、原始签名、X25519 密文落库、精确重试、异内容 409、
数据库解密回读，以及认证 worker 的领取、续租、generation fencing 和结果发布幂等。逐字输出归档于
[`webhook-postgres-20261008.txt`](evidence/inbound-automation-review/webhook-postgres-20261008.txt)，
清单与 SHA-256 见同名 manifest。该一次性库已停止并销毁，未连接生产数据库。

客户端传输接缝复核：`app-host` 的 claim/续租/result 三个函数只把 worker token 放在认证头，
请求体只含 clientId、租约代数和 opaque envelope；7 项共享宿主测试通过。平台安全存储、
收件私钥解锁、真实 worker 循环、AI 出境授权和跨端 UI 仍未接通，因此这只是接线输入，不是
移动/桌面自动执行证据。

## 6. 同轮代码审查追踪：提交许可与事件身份缺口（2026-10-08）

本节记录对工作树中自动收集服务端切片的可复现审查结果。当前发布范围只有客户端与 Web，
服务端保持 `3880bdd` 基线；以下问题是交给后续服务端执行者的审计输入，不是本轮发布批准，
本轮没有修改实现、迁移或部署。

### F1 · 高：提交许可没有绑定已准备事件

`POST /api/automation/commit-permit` 只验证 worker、事件 ID、规则 ID、解析版本、摘要和条数。
`issueAutomationCommitPermit` 没有查询 `(userId, ruleId, eventId)` 的事件，也没有要求事件处于
`prepared`、规则版本/解析版本/结果摘要与冻结结果一致。因此，持有有效 worker 的调用者可以为
不存在的事件和任意摘要签发许可，随后通过普通同步入口提交一个伪造的 `inbound:` batch。

复核位置：`server/src/api.ts:601-625`、`server/src/automation/worker-identity.ts:107-151`。
现有集成测试也能看出这个边界：`server/tests/integration/inbound-worker-identity.integration.spec.ts`
的 permit 用例直接注册 worker 后调用 permit 接口，没有先创建对应 `AutomationEvent`。
修复时应把事件存在性、所属规则、`prepared` 状态、版本和摘要匹配放进与 permit 写入相同的事务。

### F2 · 高：Webhook keyring 是部署全局的，不是账号/规则作用域

规则只保存 `keyId`；`loadAutomationWebhookSecret` 从全局 `AUTOMATION_WEBHOOK_KEYS` 读取同一把密钥，
公网接收器只比较 `rule.keyId === headers.keyId`。同一个 keyId 被多个账号使用时，知道该 key 的发送方
即可为任一已知规则 UUID 生成有效签名，密钥轮换也会同时影响所有使用该 keyId 的租户。

复核位置：`server/src/automation/rules.ts:6-37,46-49`、
`server/src/automation/inbound.routes.ts:86-97`。修复时应将密钥材料或密钥引用绑定到账号/规则，
并在启用与验签时同时校验该作用域；不能让用户输入一个部署全局的公开 keyId 就完成绑定。

### F3 · 中：七天清理删除了事件账本，而不仅是密文

`expiresAt` 在接收时设置为七天后，`purgeExpiredAutomationEvents` 对到期行执行整行 `deleteMany`。
这会同时删除事件身份、去重摘要、状态和审计元数据；与协议中“输入/结果密文保留七天、事件账本
至少保留计费周期加争议缓冲”的边界不符，也会使七天后同一来源事件失去长期去重身份。

复核位置：`server/src/automation/inbound.routes.ts:128`、`server/src/automation/rules.ts:84-87`、
`server/src/sync/cleanup.ts:174-178`。修复时应把密文过期和账本过期拆成两个字段/表，过期时清空
输入与结果密文并保留最小事件元数据，规则删除才按既定删除边界清理整行。

### F4 · 中：接收端接受 128 字符事件 ID，但提交链只支持 64

共享 webhook 原语和接收路由允许事件 ID 最长 128 字符；提交 permit、`inbound:` 线协议和 worker
校验却只允许事件部分最多 64 字符。于是长度 65–128 的请求可以验签并入队，但之后无法签发 permit
或构造可上传的 op，事件会永久卡在队列。

复核位置：`packages/inbound-core/src/webhook.ts:30-37`、`server/src/api.ts:89-104`、
`server/src/automation/worker-identity.ts:13,108-113`、
`packages/shared-schema/src/supersync-http-contract.ts:188-190`。可复现检查：

```sh
rg -n "{0,127}|{0,63}|inbound:" packages/inbound-core/src/webhook.ts \
  server/src/api.ts server/src/automation/worker-identity.ts \
  packages/shared-schema/src/supersync-http-contract.ts
```

修复时应在接收入口统一拒绝超过下游上限的 ID，或一次性扩展 webhook、permit、op、数据库约束及
客户端传输 schema，不能保留“接收成功但永远不能处理”的形状。

### F5 · 中：事件身份作用域与 claim/permit 主键不一致

`AutomationEvent` 使用 `(userId, ruleId, eventId)` 复合主键，允许同一账号不同规则复用来源事件 ID；
`AutomationCommitPermit.eventId` 却是全局主键，claim 请求也只带 `eventId`，查询只按账号和事件 ID
取第一行。相同来源 ID 跨规则时，permit 会发生不必要的全局冲突，定向 claim 还可能拿到错误规则的事件。

复核位置：`server/prisma/schema.prisma:1395-1459`、`server/src/automation/events.ts:44-67`、
`server/src/api.ts:705-718`。修复时应让 claim/permit 始终携带 `ruleId`，并让 permit 唯一性与事件
复合身份一致；若 `opId` 仍只含事件 ID，也必须在协议层明确其全局唯一约束，不能同时宣称事件按规则作用域。

### 验证记录

本轮只做了只读审查与已有测试验证：服务端自动收集相关单元测试 **16/16**（`automation-events`、
`inbound-worker-identity`、公网接收路由、commit proof）通过；服务端 TypeScript 检查通过；
`node scripts/check-migrations.mjs` 通过。复现命令：

```sh
pnpm --dir server exec vitest run tests/automation-events.spec.ts \
  tests/inbound-worker-identity.spec.ts tests/inbound-automation.routes.spec.ts \
  tests/automation-commit-proof.spec.ts
pnpm --dir server exec tsc --noEmit
node scripts/check-migrations.mjs
```

这些结果只证明现有测试与静态约束通过，不能消除 F1–F5，也不改变本轮“服务端维持
`3880bdd`、不进入发布”的边界。

## 7. F1–F5 修复复审（2026-10-08）

后续实现已收紧上述五项边界：

- **F1**：`issueAutomationCommitPermit` 在写许可的同一事务内锁定并核对
  `(userId, ruleId, eventId)` 事件，要求规则仍启用、版本一致、事件状态为
  `prepared`、解析版本/摘要/条数与冻结结果完全一致，且存在结果密文；不存在冻结事件时不能自造许可。
- **F2**：Webhook keyring 的生产形状改为 `{ userId, secret }` 的账号作用域条目；
  规则启用和接收/状态验签均按规则所属账号取钥匙。旧的纯字符串条目只在测试进程兼容，
  生产进程会拒绝，避免跨租户复用部署全局密钥。
- **F3（本轮复审更正）**：七天清理置空输入/结果密文，仅将未完成事件标记 `expired`，保留完成状态。规则删除时清除事件/摘要/计量尝试和服务端 permit，保留永久停用的 rule ID。已提交本地的任务以预先 journal 的签名 owner receipt 补传；不以无限保留服务端摘要换取补传能力。
- **F4**：公网验签、claim、续租、结果发布与提交 permit 统一使用 64 字符事件 ID 上限，
  不再出现“已接收但永远无法提交”的长度区间。
- **F5**：事件 ID 明确为账号级全局身份，新增 `(userId,eventId)` 唯一约束；提交许可改为
  `(userId,ruleId,eventId)` 主键并在账号内约束 `opId` 唯一，claim/permit 不会跨规则取错事件。

对应迁移为 `20261018080000_harden_automation_identity_retention`，未修改已应用迁移；
`node scripts/check-migrations.mjs` 与服务端 TypeScript 已通过。此节只证明缺口修复已落到
代码和 schema，尚不等于客户端 worker、批任务提交、计量和跨端验收完成。

## 8. 严格复审（2026-10-08，Goal 继续 active）

本轮复审重新检查了新增代码的持久化、状态机和错误路径，而不是只复读上一轮报告：

- **规则契约**：新增迁移 `20261018100000_add_automation_rule_contract` 后，创建/更新入口会校验
  白名单字段、IANA 时区、解析版本和 1–50 输出上限；更新先停用并递增规则/授权版本，旧租约和旧
  结果不会套用新配置。
- **删除窗口**：原实现会 `deleteMany` 事件与 permit，导致“本地 op 已落盘、响应丢失、规则随后删除”
  无法补传。现改为保留账本和已有 permit，只把未完成状态标为 `cancelled/rule-deleted`；permit
  重试先查已有授权，再要求规则仍启用，避免已授权意图被删除竞态抹掉。
- **worker 真实链路**：`processInboundAutomationEvent` 将 claim、续租、计量 `reserved/sent/consumed/unknown`、
  结果冻结、permit、proof journal 和单一 batch dispatch 串为正常路径；`sent/consumed/unknown` 重试会进入
  reconciliation，而不是再次调用模型。新增认证的加密结果读取可恢复“结果已发布、permit 请求前进程终止”
  的窗口，但 permit 与结果仍是两个中心事务，必须由 AC-3 真进程矩阵证明。当前仍没有把该管道接入各宿主的
  真实生命周期和 secure store，因此不能把共享函数称为跨端上线。
- **协议文字一致性**：发现协议文档仍写 `inbound-capture` 和“删除即清许可”，已改为代码真实的
  `inbound-automation` 与 owner receipt 语义。

本轮静态/阶段证据：`pnpm --filter @heyta/inbound-core build`、`pnpm --filter @heyta/app-host typecheck`、
`pnpm --filter @heyta/app-host test`（78/1561）、`pnpm --filter @heyta/sync-server build`、
`node scripts/check-migrations.mjs` 均通过；服务端全套仍存在并行会话的既有失败，详见唯一计划，不能
被包装成自动收集功能已通过。AC-1～AC-8 继续保持未勾选。

## 9. Node 宿主接缝复审（2026-10-08）

本轮将共享 worker 管道接入第一个真实宿主并重新审计边界：`AppHost` 只负责协议、Vault 包裹
存储和 op-log 批提交；`apps/node-host` 只注入真实 SQLite 驱动。真实 SQLite 测试证明了
worker 注册响应写入、收件私钥包裹写入、关闭重开后的私钥恢复，以及重开后用持久 worker 凭据
进入 claim 空队列路径。Vault 锁定时无法读取凭据或私钥，符合 fail-closed 要求。

共享 process 也有一条正向闭环测试：合成加密事件经过 claim、AI provider（使用宿主注入的
fetch）、结果加密发布、opaque permit journal，最后只落一条异构 task-batch op；字段投影
断言确认未授权字段没有进入 provider 请求。

日期复审发现此前 parser 默认把 date-only 固定为 UTC，和任务领域的本地零点契约不一致；现已
让规则时区进入冻结解析，date-only 以 IANA 时区本地零点换算，instant 仍要求显式 offset，并
加入跨时区与非法时区测试。日历、时间线和编辑往返尚未在真实宿主矩阵中验收，AC-4 仍不能勾选。

同时检查了 root rotation：新 root 安装后会重包 worker token 与收件私钥，旧 wrapper 不被继续
接受。该路径已有类型与回归覆盖，但尚未有两个独立进程在真实服务端上完成轮换中断矩阵，因此
只能记为阶段接缝证据，不能提升 AC-3/AC-4/AC-8。

剩余高风险仍是：AI provider 的真实授权/unknown 对账、结果发布与 permit 之间的进程终止、
跨设备 key epoch 恢复、date-only 全视图语义、Web/mobile/原生宿主生命周期、规则 UI 与四端
当前产物重装。当前 Goal 继续 active，不能宣称上线。

## 10. 2026-10-08 严格复审补充

本轮复审没有把“共享 worker 已通过单元测试”升级成跨端完成。沿服务端公网接收 → 收件 envelope AAD → host Vault scope → 本地私钥 epoch → 结果恢复链逐段复核，发现并修复一项真实生命周期缺口：原本地收件私钥只有单一 epoch，轮换后会覆盖旧队列仍需的私钥。现在 meta 记录 v2 按账号、服务端 origin、key epoch 保存多枚 root-wrapped 私钥；旧 v1 形状可读，重包按当前账号/origin 做快照 CAS。

复核还发现必须固定一个以前未写清的绑定规则：服务端 envelope AAD 使用 `user-<numeric user id>`，Vault 包装 scope 继续使用认证返回的数字账号字符串。host 入口现在按这个规则归一化，避免真实 HTTP 收到的密文在 Node 或 Web 恢复时因 AAD 不同而无法打开。新增远端客户端只做认证的 recipient-key GET/PUT/CAS 及规则 CRUD；已有远端公钥而本机没有同 epoch 私钥时会 fail closed，绝不自动覆盖在途队列。

负向检查：旧 epoch 缺失、并发保存、CAS 冲突、错误公钥、未认证请求和 malformed rule response 均有测试；DST 的 America/New_York date-only 两个边界也有测试。未完成项仍是各宿主真实 worker/UI、双真实 SQLite 进程终止矩阵和四端当前产物重装对账，AC-1～AC-8 仍未闭合。

### 10.1 线协议复核追加：认证头形状

复查服务端 `authenticate` 后发现它只接受 `Authorization: Bearer <JWT>`；共享 inbound worker、recipient-key 及规则客户端此前有调用点直接放原始 token，单元 mock 未暴露该问题，真实 HTTP 会在注册/领取前返回 401。现已统一在所有宿主无关客户端边界补上 `Bearer ` 前缀，并添加请求头负向/正向断言。该修复属于 AC-2/AC-3 的真实可达性前置，不改变 worker token 或 HMAC 的独立凭据边界。

### 10.2 权益与首次密钥发布复核

再审公网接收线时发现两个竞态/边界问题：

- 受保护 API 经过权益守卫，但无 JWT 的公网 webhook 原先没有在接收事务内核验 `automation` grant；自托管默认关闭权益总闸时也会误放行。现在自动收集能力无论部署方式都要求 `evaluateCapabilityAcross` 的有效 `automation` grant；接收事务在账号行锁内再次核验，过期或无权益返回 402 且不建事件。
- 首次公钥发布若“服务端已提交、PUT 响应丢失”，客户端若删除本地私钥会让已排队密文永久不可解。现在 ensure 流程在 Vault 中先保存候选私钥，PUT 失败只对 CAS 冲突做 GET 对账；若远端公钥相同则视为发布成功并复用候选，其他不确定状态保留候选并报错，禁止自动覆盖或删除。

这两点都已写入共享 host 代码/测试边界；真实 PostgreSQL 与进程终止证据仍是 AC-1/AC-2/AC-3 的必要条件。

## 11. Web 宿主接缝复审（2026-10-08）

本轮对新增 Web 代码做了“存储真源 → Vault root → 认证头 → worker 身份 → op-log 写入口”的逐段复核：自动收集的凭据和回执不进入 `heyta` 业务 op-log，而是落在独立 `heyta-inbound` IndexedDB；本地销毁器已把该库加入清单，测试用真 IndexedDB 逐库清除并对账。收件私钥按 `user-<numeric id>` AAD 绑定、按 epoch 保存，worker token 仍只以 root-wrapped 形式落盘；所有规则/收件/worker 请求使用 `Authorization: Bearer`。

Web 前台 worker 调用的是共享 `processInboundAutomationEvent`，因此 claim、lease、字段投影、AI 计量状态、结果加密、permit journal 和单一 batch dispatch 没有在 Web 壳复制。focus/30 秒调度以页面可见性、Vault 解锁、worker 凭据、收件 epoch 与 AI 路由为门槛；失败只显示结构化状态并保留服务器事件，不回传正文。

复审仍发现并记录边界：当前 Web 规则界面没有接入真实发送方/公网签名试发向导，移动与三个原生壳尚未接入同一 worker 生命周期；浏览器前台定时器不是全天候运行器，后台/关闭页面时必须显示等待可执行设备。未执行双真实 SQLite 进程终止矩阵、跨端时区/日历往返和四端当前产物验收，因此 AC-6/AC-8 与 Goal 均未完成。

### 12. 2026-10-08 严格复审追加：轮换恢复、权益门禁与规则 UI

本轮沿“准备结果 → 收件密钥 epoch → 本地恢复 → 单 op 提交”重跑负向审计，发现并修复三处真实缺口：

1. **轮换后的旧结果恢复**：结果密文自身携带 key epoch，但恢复路径原先总用当前 epoch 解密；轮换后旧队列会永久失败。共享 `processInboundAutomationEvent` 现在先解析结果 envelope，按其 epoch 调用宿主提供的 retained-key loader，并在使用后清零临时私钥。新增旧 epoch 恢复测试覆盖“结果已发布、轮换、permit 前进程终止”。
2. **首次密钥 API 权益边界**：recipient-key PUT/GET 原先只有 JWT，没有 `automation` capability gate；现在与 worker/claim/permit 同样要求有效自动收集权益。同步保留自托管普通同步的既有免费语义。公钥 CAS 还拒绝“同 epoch 换公钥”，同 epoch 仅允许同公钥重发，换钥必须递增 epoch，避免排队密文失去解密钥匙。
3. **规则 UI 状态**：Web 设置页现在有编辑/保存/取消流程；已删除规则显示为规则编号永久停用且不再提供启停/删除按钮；前台 worker 会显示登录、收件密钥、处理设备、AI 路由/出境同意和可执行就绪原因。自动领取使用服务端 claim 的规则快照，不把页面上第一条规则误当成事件归属。

验证：`@heyta/app-host` 定向恢复测试 2/2 通过；app-host 与 i18n 构建、Web 类型检查和 `check:ui-language` 通过。一次带全包脚本仍暴露并行会话已有的 `local-api-host.spec.ts` 失败（完成态批处理期望与当前工作树不一致），未把它归因于本轮自动收集变更。移动与三种原生壳生命周期、真实双宿主故障矩阵、发送方试发向导、跨时区往返、四端重装及 AC-1～AC-8 仍未闭合，公网功能继续不得开放。

### 2026-10-08 新 Goal 复审记录

本轮新增的严格边界检查已落地：worker secret 的读取、清除和 root rotation 都按账号 + client + origin 绑定；回执 journal 在单一 meta 事务内合并更新，避免并发事件的提交证明丢失。旧 epoch 结果恢复和客户端绑定负向测试已通过。该切片仍不勾选 AC-1～AC-8，公网接收和售卖继续关闭。

### 2026-10-08 调度复审

Web 原先把 30 秒定时器、focus 监听和不可重入判断写在设置组件内，后续宿主若各自复制会产生漂移。现抽为 `packages/app-host/src/inbound-worker-loop.ts`：每个 tick 重新检查 `isRunnable`，同一时间只允许一个处理调用，停止函数会清理 timer；Web 与 Node 使用同一实现。定向测试覆盖后台门槛、并行阻止和停止后的唤醒，不能据此宣称移动或原生壳已完成。

### 2026-10-08 续轮复审：调度、完成回执、发送边界

本轮继续发现并修复实际缺口，不能将前述静态引用核验等同于方案已经可交付：

- **调度重入**：Web effect 依赖处理状态会反复重建立即执行的 loop；focus/手动按钮也绕过 fence。现采用稳定生命周期和 live refs，所有唤醒共用 fence；Node close 清理后续定时器。stop 不撤销已发出的模型请求，宿主在途会话 fencing 仍需验收。
- **服务器从未完成事件**：上传事务的首次落库与精确重复成功分支现都按持久 permit 更新 `completed`。真实 PostgreSQL trigger 注入更新失败时，op 一起回滚；七天清理不再把 completed 变成 expired。
- **保留承诺不一致**：规则删除实际清除事件/摘要/关联尝试/服务端 permit，以签名 owner receipt 保留本地已提交意图的迟到同步资格；规则 ID 永久墓碑。中英文删除文案同步更正。
- **旧输入密钥**：输入 envelope 按其 epoch 加载旧私钥，临时私钥清零；结果仍封给当前 epoch。Web/共享 host 的模型 SecretStore 已接入。
- **发送前误扣额度与重跑**：reserve/sent 移到路由、出境同意及取密钥后的 fetch 边界；CAS 失败拒绝发送；单次模型尝试禁止自动端点回退。租约到期且存在 reserved/sent/consumed/unknown 账目时转为待核实，不自动购买第二次调用。配置/出境闸拒绝不 reserve；平台网络同意仍须专项核验；direct/local 与 managed 计量来源已拆开，仍需并发对账证据。
- **普通同步漏接许可**：Web 和共享宿主的默认同步现读取与处理器同一份 Vault 包裹 worker 凭据及 journal。Web IndexedDB 验证锁定/错账号/错 client 拒绝；Node 真实 SQLite 重启后普通同步携带 token/receipt 并清空待上传队列。
- **冻结字段/时间**：模型额外字段（含 projectId）拒绝；规则目标在计算摘要前注入，恢复沿用密文内目标，不采当前界面值。claim/renew 带原 createdAt 作为 receivedAt，模型上下文与冻结调用沿用该值，不再用执行设备的当前时间。

本轮证据见 [验证记录](evidence/inbound-automation-review/continuation-20261008.txt) 与 [源码摘要](evidence/inbound-automation-review/continuation-20261008-sha256.json)。仍未完成：自动发现 prepared/journal 恢复、needs-confirmation 交互、date-only 跨端语义、自托管官方签名授权、全端生命周期、真实双 SQLite 进程终止矩阵、全仓门禁与当前产物重装。Goal 与 AC-1～AC-8 保持未完成。

额外门禁：分层检查当前报移动端 `chat-controller.ts` 三处助手档位字面量违规（215/228/309 行，本轮未改动），不能宣称全仓绿色。


### 2026-10-08 恢复、保留期限与会话复审

结论仍为**不可上线**。原审计的源码引用可信，不等于当前实现已满足其验收条件。本次沿真实调用链继续修复以下问题：

- **冻结结果无人发现**：worker 每轮先查询 recovery，再领取新事件；许可前同账号可接手，许可后只给原 owner；自动恢复排除确认草稿、到期结果和无许可的停用规则。解密后重新计算 tasks 摘要，不能只比较两个同值 digest 字段。
- **模型结果不确定没有可用动作**：最近事件仅返回元数据；明确说明可能再次计费后，用户确认才以 attempt/ruleVersion CAS 重新排队。取消不发请求、重复确认拒绝、旧尝试保留。它没有实现日期歧义草稿编辑/确认。
- **许可权益过早判定**：首次 permit 改在账号锁后读取并共享锁定订阅行，再使用既有权益判定；原 owner 的精确重试不经新授权守卫。真实 PostgreSQL 检测请求已等待账号锁后再让订阅到期，证明新许可 403/零写入、原许可精确重试 201、改内容重试 403。
- **保留期限只靠清理任务**：续租、首次/幂等结果发布、首次提交许可分别拒绝已到期事件；时钟在账号锁后读取。已有精确许可和已落盘 op 的同步资格保留。
- **尝试编号未绑定领取快照**：reserve 与 sent 在账号锁内认证 worker，并核对当前规则、解析版本、attempt、generation 和期限；已发送调用的账目允许迟到结算，但不授权第二次发送。结果发布必须有条数且解析版本匹配规则。
- **在途会话未隔离**：共享流程在网络前后和 engine 串行写入校验内检查宿主会话。Web 检查账号/token/origin、页面/配置与 Vault；共享 host 检查当前配置、Vault 对象和 epoch，close 锁定。测试在 recovery 响应、permit 响应、dispatch 排队后分别失效，均无新 op；已保存回执保留供恢复。无法取消已经到达外部供应商的调用。
- **浏览器测试绿但视觉失真**：`ht-settings__card` 横向 flex 加 `:has(input:checked)` 被用于完整表单，导致文字压成竖排和整块蓝底。现在采用独立纵向布局与可换行字段组，并补字段宽度/标签高度断言；实际查看 390/1280、亮暗截图。截图记录不等于原生壳验收。

验证清单与源文件哈希见[阶段记录](evidence/inbound-automation-review/recovery-retention-20261008.txt)、[源码快照](evidence/inbound-automation-review/recovery-retention-20261008-sha256.json)。真实 HTTP/PostgreSQL 原始输出另存[数据库记录](evidence/inbound-automation-review/recovery-retention-20261008-postgres.txt)。界面证据：[窄屏暗色修复前](../../apps/web/evidence/inbound-recovery/before-retry-390-dark.png)、[修复后](../../apps/web/evidence/inbound-recovery/retry-390-dark.png)、[桌面亮色表单](../../apps/web/evidence/inbound-recovery/form-1280-light.png)。浏览器接口使用明确标注的 fixture；数据库验证使用临时真实 PostgreSQL，二者不混称端到端。

**尚未闭合的承重缺口：**

1. `parser.ts` 已在 epoch 兼容投影外新增 `dueDateLocal/startDateLocal` 原日历日，领域筛选、日历、倒计时、象限、排序、时间线及 Web/mobile 编辑器已优先读取；提醒与真实跨端安装产物往返仍未验收，AC-4 尚不能勾选。
2. 计量现按 `billingSource` 区分 direct 与 managed：direct/local 只保留事件账本，managed 才消费托管周期额度；仍需补 managed 与 direct 的并发额度对账证据。
3. 其他确认草稿、正式自托管签名授权、发送方凭据发放与试发、各端真实 worker 生命周期仍未完成。
4. 共享处理器已采用 20 秒续租心跳与 45 秒 provider 超时；双独立 SQLite 进程终止矩阵、跨区全视图与四端当前源码安装及 Linux 验收仍未执行。

不据本轮阶段测试勾选任何 AC，不宣称全仓通过或完整功能交付。

### 2026-10-08 续轮补充：确认状态未穿透模型与 date-only 时长投影

沿模型结果 → 冻结器 → 密文发布 → 许可 → op 逐段复核，发现原冻结器只允许顶层 `tasks`，因此服务端 `needs-confirmation` 没有正常路径可达。现允许布尔确认标志并在客户端许可前截断；服务端要求幂等发布的确认状态也一致。parser、app-host、server 定向测试证明标志可达、零 permit/零 batch op，以及不能通过精确重试翻转状态。仍缺对非法/歧义日期生成可编辑加密草稿的独立数据契约与用户确认/取消 CAS；当前修复不能宣称草稿流程完成。

另发现 `calendarTaskSpan` 对 date-only 开始 + 时长仍用规则时区的 epoch 算范围。已改用持久原日历日的当前设备投影；上海与洛杉矶各 31 项日历定向测试通过。提醒与真实多端往返仍未验收，AC-4 保持未完成。最后新增的 local API 跨区断言已随 57 项定向测试通过；相关包类型检查通过。

全仓 `pnpm check` 本轮两次进入门禁链，均未跑到末尾：先被未接入链的重复 Android widget 色彩脚本与移动助手档位字面量拦下，已分别消除重复定义、改用共享常量并单独验证门禁；后续复跑曾进入主题门禁，两个并行测试引用第二份主题建表/原始表，已改用共享 `resolveHeytaUiTheme` 并单独通过。最新一轮全仓构建、各包类型检查与前段门禁通过后，在 op-log 变异基线被内存护栏拒绝启动（读数 365 MB，小于 384 MB），属于**未执行**而非通过；没有调低护栏伪造全绿。当前机器同时有 Android 模拟器等并行进程，未擅自终止。Web 自动收集相关 72 项、移动日期 22 项、server 事件 8 项及跨区日历定向均通过；全仓与跨端安装仍未闭合。

### 2026-10-08 草稿决策后端与到期清理竞态

结论仍为**不可上线**。新 Goal 已成功创建并为 active，覆盖原计划全部实现与验收；本切片不结束 Goal。

严格复核半成品草稿代码后补齐四道边界：共享严格契约拒绝未知 decision、明文和取消时附加结果字段；读/决策在账号锁内重新校验 JWT tokenVersion；确认在账号锁后共享锁定订阅并按当前时刻复核权益，取消不受订阅到期阻挡；最终状态/尝试/版本/旧摘要/期限 CAS 防止独立 sweep 清理后的草稿被重写为 prepared。确认同时核对规则启用/解析版本、条数上限、当前收件 key epoch 与无提交许可。读取返回密文快照且禁止缓存，确认仅进入 prepared，不另造 permit 或任务写入口。

已归档的[定向测试与类型检查](evidence/inbound-automation-review/draft-decisions-20261008-tests.txt)证明 server 27 项、共享传输 3 项及两包类型检查通过；[真 HTTP/PostgreSQL 首轮](evidence/inbound-automation-review/draft-decisions-20261008-postgres-before-final-cas.txt)为 26 项，覆盖确认/取消真实并发仅一个成功、跨账号/过期读取拒绝、密文回读、观察到账号锁等待后订阅到期拒绝、到期账号仍可取消。首轮发生在最终 CAS 和读取后期限复核修正之前，**不能替代最终源码的真库复跑**。

最终源码真库复跑两次被内存护栏拒绝启动，读数分别 347 MB、208 MB，门槛 384 MB：[第一次记录](evidence/inbound-automation-review/draft-decisions-20261008-postgres-memory-guard.txt)、[新增清理竞态用例后的记录](evidence/inbound-automation-review/draft-decisions-20261008-postgres-cas-memory-guard.txt)。临时数据库正常关闭/清除，没有降低护栏或终止并行进程。新增真实事件行锁屏障用例验证“读到草稿后，独立清理先提交，再返回确认 CAS”尚未执行；mock CAS 拒绝的两例不能冒充该真库证据。[当前源码哈希](evidence/inbound-automation-review/draft-decisions-20261008-sha256.json)明确区分首轮证据与当前源码。

仍待：客户端解密后的来源/完整摘要校验、规则时区编辑与稳定 ID、重封装和会话/Vault fencing；非法或歧义日期的独立草稿契约及 UI；其余全部 AC 与跨端产物验收。公网自动收集继续不开放。

### 2026-10-08 客户端加密草稿审核接缝

本轮将确认草稿从“只返回 needs-confirmation 状态”推进到宿主无关审核器与 Web 设置 UI：

- `inboundDraftPayload` 是独立的加密审核文档，保留非法/歧义日期原值，不进入 `heytaTaskBatch`，因此不会创建无日期或错误日期的占位任务。
- `createInboundDraftReviewer` 在客户端解密后重算完整任务摘要，重新查规则版本/目标清单，拒绝篡改事件 ID、任务 ID、目标清单或服务器摘要；修正后的内容用当前收件 epoch 公钥重封装，再调用严格 confirm/cancel CAS。临时私钥和明文缓冲区均清零，网络响应前后检查会话 fence。
- Web UI 提供查看、编辑、确认创建、取消事件和关闭草稿；账号切换、token 变化、Vault 锁定会清除已渲染草稿。草稿确认不绕过既有 permit/journal/单 batch op 路径。

阶段证据：[客户端定向测试](evidence/inbound-automation-review/draft-review-client-20261008-tests.txt)显示 app-host 43 项、inbound-core 29 项、Web 7 项通过；shared-schema、app-host 与 Web 类型检查通过。证据验证了 mock/共享接缝和浏览器组件，但不替代最终真 HTTP/PostgreSQL CAS 复跑，也不覆盖移动/原生壳。`@heyta/ui` 的并行会话导出缺口仍使独立 Web 全量 typecheck 在另一轮中失败，未归因于本切片。

当前仍未闭合：最终源码的真库清理竞态复跑（最近受内存护栏拒绝）、发送方签名试发与自托管授权、移动/原生 worker 生命周期、managed/direct 并发计量、双宿主故障矩阵、提醒跨时区往返、全仓门禁和四端安装验收。

## 2026-10-08 发送方凭据严格复审

本轮复审从签发、持久化、轮换、撤销到公网验签逐条走读并补跑定向测试。结论：**凭据生命周期阶段已形成可接线协议，但不能据此宣称自动收集上线。**

- secret 由服务端随机生成且仅响应一次；数据库只保存独立部署 KEK 包裹密文，AES-GCM AAD 绑定账号/规则/keyId；篡改、错误作用域或缺 KEK 会失败。
- 迁移允许同 keyId 的历史撤销行并仅限制活动行唯一，修复了“先撤销再插入仍撞全局唯一键”的轮换缺陷。规则删除仍由既有删除边界清理关联凭据，rule UUID 永久停用。
- 入站路由和状态查询使用托管凭据优先策略。托管记录存在但被撤销或无法解密时不会回退环境 keyring；无托管记录的旧规则才可使用账号作用域 legacy 条目。规则启用也要求两者之一。
- Web 管理仅显示元数据和一次性 secret，关闭后清除本地显示；没有把密钥写入规则或同步数据。

验证：服务端 sender/inbound route 11 项、app-host remote 4 项、Web worker 生命周期定向 7 项通过；服务端/Web/app-host 类型检查、Prisma generate 和 `check-migrations` 通过。尚未完成签名试发、真实最终源码 PostgreSQL 复跑、正式自托管签名授权、managed/direct 并发计量、双独立真实宿主故障矩阵、原生端生命周期、全仓门禁和四端当前产物安装验收。AC-1～AC-8 保持未勾选，Goal 继续 active。

### 2026-10-08 发送方签名试发接线（阶段证据）

Web 规则界面现在可在一次性 secret 仍位于内存时发送最小测试 payload。客户端复用同一 `@heyta/inbound-core` 签名串（方法、路径、keyId、时间戳、eventId、Content-Type、原始字节摘要），直接调用公网 webhook；响应严格限制为不透明 `eventId/state`，不会把测试任务内容回传到发送方界面。secret 关闭或会话刷新后不再可试发。

app-host 传输测试覆盖签名头、事件 ID 回显和非 202/恶意响应拒绝；Web 类型检查与 worker 生命周期测试通过。该切片仍未提供正式自托管签名授权或真实 HTTP/PostgreSQL 最终源码证据，也未证明测试事件已被处理设备解析/提交；因此只能作为 AC-6 的阶段接缝，AC-1～AC-8 继续不勾选。

### 2026-10-08 凭据撤销竞态复审

对“验签通过后撤销”窗口重新走读后补上两道边界：撤销按账号行锁更新；入队事务在相同账号锁内重新读取最新托管凭据身份，若密钥已撤销、已轮换或托管记录在初次解析后出现，则拒绝写入密文队列。验签后使用的托管 secret 在请求路径结束时清零。规则删除同步清理凭据密文，保留永久停用的规则墓碑。

服务端 sender、规则和公网接收定向测试 13 项及类型检查通过；这仍不是并发 PostgreSQL 故障注入证据，AC-2/AC-3 需在最终真库矩阵中验证。

### 2026-10-08 移动端前台 worker 接缝

`apps/mobile` 已接入共享 `startInboundWorkerLoop`。应用回到前台或每 20 秒只在前台尝试一次；首次使用不会自动创建收件密钥、不会静默打开 AI 或出境同意。worker 注册使用本地 SQLite 的稳定 `clientId` 派生 database epoch，Vault/收件密钥/规则/AI 路由/出境同意任一不可用时保持队列等待；宿主重新读取 worker secret 和旧 epoch 私钥，提交仍走共享 permit/journal/单批 op 路径。

移动端 72 个测试文件/901 项与类型检查通过。本接缝只证明代码路径接入和前台门槛，尚未在 Android/iOS 当前安装产物上跑真实服务端队列、模型、进程终止或跨端结果；AC-3/AC-4/AC-8 仍未闭合。

### 2026-10-08 严格复审：计量来源接线与门禁现量

本轮按协议 §4 从调用点、HTTP schema、数据库 CHECK 和真库行为逐项复核，发现并修复一处会造成真实计量错账的接线缺口：共享 runner 已根据首个实际候选端点识别 `local/direct/managed`，但服务端 reserve handler 未把 `billingSource` 传入；同时 state transition schema 继承了 reserve 字段，导致客户端状态推进契约错误。修复后 reserve 才冻结来源，state 只接受状态机字段；同一尝试重试来源改变会拒绝，`managed` 才写周期锚点并消费托管额度，`local/direct` 强制 `periodAnchor = null`。

新增迁移没有修改已应用文件，而是先在一条锁定事务中替换旧 CHECK，允许 `local` 并保留三种来源与周期锚点的互斥关系。证据：服务端 TypeScript、计量/入站定向 12 项、app-host 定向 1705 项、迁移形状检查通过；临时 PostgreSQL 14.18 应用当前全部迁移并运行 worker identity 真 HTTP 集成 30 项通过（原始输出保存在 `/private/tmp/heyta-inbound-worker-identity-20261008.log`，仅作本机复核，不作为仓库证据）。

复审仍判定不可上线：自托管在线官方授权尚未接线，managed 真实供给与并发额度矩阵尚未完成，双独立 SQLite 宿主的进程终止/ACK 丢失/租约 fencing 故障窗口、提醒跨时区往返、移动/原生当前安装产物、全仓 `pnpm check` 均未闭合。`pnpm check:docs` 当前还报告一处并行会话的错误章节号和 69 处未跟踪取证链接；本任务新增文档链路未产生死链。AC-1～AC-8 继续保持未勾选，不能把阶段测试写成最终交付。

## 2026-10-09 自托管在线权益票据阶段复审

针对 P1-3 的剩余缺口新增了服务端阶段接线：`entitlement-ticket.ts` 使用 Ed25519 公钥环验证官方原始 claims，强制 `automation` capability、`installationId`、`officialSubject`、`localAccountUuid`、可信时间和不超过 30 秒的有效期；账号锁内以唯一 nonce 表消费票据，再保存最小绑定与到期时间。自动收集权益守卫先复用现有托管订阅判定，订阅不满足时才接受该短期绑定，因此普通自托管同步仍不受影响。新增 API 只返回不透明状态与过期时间，不回传票据正文。

定向证据：`server/tests/automation-entitlement-ticket.spec.ts` 3/3，连同计量与公网接收定向测试共 15/15；`pnpm --dir server exec tsc --noEmit`、`node scripts/check-migrations.mjs` 通过。该阶段**不等于**官方 issuer 已部署：官方签发/吊销版本在线同步、真实 PostgreSQL 同 nonce 并发、客户端轮询续票据及离线/时钟回拨 UI 仍未完成；AC-1、AC-3、AC-6 和 AC-8 继续保持未勾选。

> ⚠️ 上面“先复用现有托管订阅判定，订阅不满足时才接受该短期绑定”与这组“3/3 / 15/15”读数都已被同日更晚的定案取代（模式二选一、按操作一次性票据，判据重写）。**这批定向复跑当时漏了 `automation-drafts.spec.ts`** —— 而它恰好是被那次 reader 抽象打断的那一份（9 红，症状是 `Cannot read properties of undefined (reading 'findMany')`）。教训：**"这一族我跑了几个文件"不等于"这一族跑全了"**，收尾要按“有该 script 的文件数 == 打了汇总行的文件数”对一次数。

## 2026-10-09 客户端在线权益传输接缝

宿主无关层新增 `verifyAutomationEntitlementTicket`，统一使用 `Authorization: Bearer`，只发送官方不透明票据和本地账号 UUID，严格校验 `active` 状态与可解析过期时间；没有把票据放入业务 op-log、worker secret 或日志。`@heyta/app-host` 类型检查通过，新增传输测试 2/2 通过。客户端尚未取得官方 issuer 票据、未实现每 30 秒续票据和失联 `waiting-entitlement` UI，因此该接缝不提升任何 AC。

## 2026-10-09 权益来源统一复审

继续沿“官方订阅 / 自托管在线绑定 → 公网接收 → worker → permit”追踪后发现，若只改 authenticated preHandler，公网 webhook 和事务内 permit 仍会只查 `subscriptions`，自托管票据会在入口与提交之间被拒绝。现抽出统一的判定入口，公网接收事务、草稿确认和首次 commit permit 均复用它，普通 hosting gate 未改变。服务端类型检查通过；由于本机并行进程占用内存，新增真库 nonce 并发复跑尚未执行，不能把这次接线升级为 AC-1 证据。

> 🔴 本段的**判定形状已被同日更晚的一轮推翻**（两处）：① “订阅不满足时才接受短期绑定”这种两来源并集，等于让自托管实例上的本机订阅行放行自动收集 —— 权益来源必须由 `AUTOMATION_ENTITLEMENT_MODE` 显式二选一；② 抽象成通用 reader 时，锁内那次订阅读丢了 `FOR SHARE`，而账号行锁挡不住计费/邀请对订阅行的写入。裁决与读数见下一段与本计划 §「2026-10-09 权益判定定案」。留本段是为了让后来者认出这个形状：**把两处都能放行当成统一判定**，与**把判定路径抽成通用接口**，都可能在抽取时把防线一起抽走。

## 2026-10-09 权益判定定案（本轮严格复审）

按“计划条款 → 运行时代码 → 持久化边界 → 负向测试”重走自动收集的授权链，本轮发现的问题与处置：

| # | 发现（不是印象，是调用链上的形状） | 处置与判据 |
|---|---|---|
| R1 | 上一轮交下来时 `tests/automation-drafts.spec.ts` **9 条是红的**，症状 `Cannot read properties of undefined (reading 'findMany')` —— 服务层把事务客户端当通用 reader 传，测试 double 没有 `subscription` 模型。红的不是断言，是**生产签名** | 判定改走具名来源（`AutomationEntitlementSource` / 锁内 `lockedAutomationEntitlementSource`），19/19 复绿 |
| R2 | 自托管在线模式下**本机订阅行仍放行自动收集**（订阅优先、绑定兜底的并集） | 部署模式二选一（`AUTOMATION_ENTITLEMENT_MODE`，严格解析、未配置即拒）；`selfhost-online` 完全不读 `subscriptions`。负向判据：真库里给一条 `grants:['automation']` 的活跃订阅，公网接收仍 402 且零事件落库 |
| R3 | 一枚票据换成 30 秒通用通行证：`action` 是常量，绑定行被任何后续操作复用 | 封闭 action 词表 + 每动作自己的 rule/event 作用域，逐字比对才消费；只有 `session` 写绑定。变异：去掉 action/作用域比对 ⇒ 那条判据红 |
| R4 | 过期在**拿账号锁之前**判，持过期票据可以排队等锁后落库；且判定接受调用方传入的绝对 `now` | 锁后读 `clock_timestamp()` 再判一次；生产入口不再收绝对时间，测试只能注入一个取时间的函数。变异：把锁后那次判定短路 ⇒ 该条红 |
| R5 | 绑定判定只看 `expiresAt`：换实例、换 keyring、调高吊销下限对已存在的绑定**完全无效** | `isAutomationEntitlementBindingUsable` 同时校验 issuer/instanceId 与 `minRevocationVersion`；三条独立判据各红一次 |
| R6 | 时钟回拨没有任何状态可依 | 新增按安装实例的高水位表 + 迁移；回拨即拒绝并留下稳定码。真库判据一条 |
| R7 | 抽象成通用 reader 时，锁内那次订阅读丢了 `FOR SHARE`；账号行的 `FOR UPDATE` 挡不住 `billing/webhook.routes.ts` 与 `activity/invite.ts` 对订阅行的写入（两处都不取账号锁） | 恢复 `... FROM subscriptions ... FOR SHARE`；新增故障窗口 11 前半的真库判据：把撤销提交排在请求的订阅读之后 ⇒ 请求确实卡在 `FROM subscriptions` 的锁等待上、许可不落。变异：摘掉 `FOR SHARE` ⇒ 该条红 |
| R8 | 生产默认绑定读取里写着“模型不存在就当没有绑定”（为最小测试 double 加的可选链），加上判定接口的 `args?: any` | 两处都删；来源类型取 Prisma 生成类型。受影响的测试改为**声明自己建模哪一种部署**，而不是让生产迁就 double |
| R9 | 草稿确认路径同一次请求判定两次（一次 preHandler、一次锁内），一次性票据会被烧掉两张 | HTTP 层那次去掉，只保留写事务内那一次 |
| R10 | 文档口径比证据强（“已接入短期绑定”读起来像 P1-3 闭合） | 协议 §4 与计划 P1-3 逐段改到证据支持的范围，并单列**未闭合**清单 |

证据（全部为本机一次性 PostgreSQL 14.18 + 真 HTTP + 零 mock，读数见计划同日期那节）：自托管在线段在真库上多 8 条判据（含同 nonce 并发两路 ⇒ 恰好一路 200 一路 403，DB 日志自己打出 `automation_entitlement_ticket_uses_pkey` 唯一冲突）；真库套件 **38/38**；改写后的票据套件 20/20；公网接收 8/8；定向 7 文件 38/38；服务端 TypeScript 与迁移形状检查通过。变异共 8 臂，各红自己那一条，全部从 `.mut-bak` 还原后复跑为绿。

一处方法论上的自纠：第一版“锁后新鲜度”变异写成 `if (false && A || B || C)`，运算符优先级把 B/C 留在判定里，套件仍全绿 —— **臂是假的**。存活读数在归因成“判据没牙”之前，必须先证明变异真的进了产物。

仍未闭合（不包装）：官方签发端与 `officialSubject ↔ installation ↔ 本地账号` 的链接握手（`session` 的 `localAccountUuid` 现由客户端声明，服务端只能要求后续票据与首次记录一致 —— 首次绑定那一步仍可由持票人 + 任意有效 JWT 组合定绑给谁）；吊销版本在线刷新；各宿主续票据与 `waiting-entitlement` 展示；app-host 侧 `X-Heyta-Entitlement-Ticket` 还没有供给方；除草稿确认与首次许可外，其余动作的一次性票据在 HTTP 闸门自己的事务里消费，不在业务写事务里；故障窗口 11 的后半（许可先落盘、撤销后到）没有新增判据。因此 **AC-1 继续不勾选**，公网接收与售卖继续关闭。
