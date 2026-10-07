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
