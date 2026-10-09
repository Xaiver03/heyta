# 付费自动收集：外部数据转待办

> 状态：**实施中：第二轮复审完成，技术协议已形成，基础批语义切片进行中；公网功能未上线。**

本文件是自动收集的唯一实施计划；已合并同轮 `paid-automatic-capture.md` 的能力审计。对应产品总清单 UX-S9-75。2026-10-07 产品负责人提出；本页是能力审计与实现计划，公网回调尚未上线。

帮助中心入口：`/docs/automation/`（2026-10-07 已发布并核对线上正文；这是规划说明，不是回调功能上线）。此前草案沿用“自托管免费”和“所有 AI 写入都确认”的决定不符合最新用户指令，本版以“高级自动收集付费、规则授权后普通创建自动执行”为准。

## 当前能力边界

| 能力 | 现状 | 来源 |
|---|---|---|
| JSON 备份恢复 | 支持固定导出格式，要求空库；不是任意 JSON 导入 | `packages/app-host/src/export-dump.ts`、Web `ImportPanel.tsx` |
| 工具化创建任务 | 已有 create_task 等工具契约与宿主 submit 写入口 | `packages/local-api/src/tools/task.ts`、`server.ts` |
| 本机 HTTP / MCP | Node 宿主有监听/stdio 接线；浏览器开关本身不启动服务器 | `apps/node-host/src/local-api-server.ts`、`mcp-stdio-server.ts` |
| 对话 AI | 已有解析、授权与工具执行，不能当作无人值守的回调接收服务 | `packages/app-host/src/ai-assistant.ts` |
| 公网自动收集回调 | 已有签名接收、密文事件账本、认证 worker 领取/续租/结果发布最小路径；解析、计量、跨端执行与故障验收未闭合 | `server/src/automation/inbound.routes.ts`、`server/src/automation/events.ts` |
| 付费判断 | 有服务端权益和托管 AI 计量，需新增能力并复用既有判断 | `server/src/entitlement.ts`、`server/src/ai/metering.ts` |

现有入口复核：2026-10-07 运行 Node 宿主的 `local-api-server.spec.ts` 与 `mcp-stdio-e2e.spec.ts`，两文件共 40 项通过，包含真实 HTTP 和 MCP 传输。这个结果只证明现有入口，不证明尚未实现的公网 AI 回调。

## 用户流程与信息架构

默认登录和任务页面不增加入口负担。高级用户从“设置 → AI 与集成 → 自动收集”启用“自动收集”；该页面展示付费资格、规则和最近接收结果。每条规则有来源、目标清单、时区、允许的操作、解析预览和暂停开关。只有权益满足且用户启用后，才创建可撤销、可轮换的回调凭据。

官方托管用户直接创建规则；自托管用户先完成同步服务配置，再在自己的实例创建规则。两种部署共用功能语义和权益契约；不能只在前端隐藏按钮作为付费限制。当前 `createEntitlementGuard` 在自托管关闭权益闸门时直接放行，因此不能把现有守卫原样套上就声称两端均有收费限制；新能力要单独核验授权，并保留现有免费自托管同步。自托管中的正式付费功能以可验证授权为依据，不把修改过的开源部署宣称为无法绕过的 DRM。

## 输入与输出

首版只接收有大小限制的 `application/json` 和 UTF-8 `text/plain`。JSON 使用字段映射或文本字段解析；纯文本走结构化 AI 提取。CSV、iCalendar、邮件正文可由上游工作流先转成文本/JSON；直接附件、图片 OCR、PDF、任意 URL 抓取另列后续阶段，不能以“任何格式”宣传首版。

适用场景：邮件跟进、会议行动项、表单线索、工单分配、课程表、预约通知、阅读摘录和家庭日程。来源内容是数据，不拥有指挥助手执行其他工具的权限。

解析结果至少包含标题、可选备注、来源标识、可选截止日期、可选开始时间/时长和目标清单。无日期是正常的未排期任务，仍进入规则授权的目标清单；非法或有歧义的日期让整批进入待确认草稿。明确日期无时刻保留全天语义，缺失时区或“下周”语义冲突不擅自猜测。日期解释与跨端展示按协议逐视图验收。规则默认只创建新任务，禁止来源内容修改授权、清空清单或批量修改既有事项。

## 本地优先与隐私边界

服务端不能伪造客户端加密 op，也不能解密现有任务库。首版采用“接收队列 → 已授权客户端领取 → 解析和提交 op → 回执”的路径：本地 app-host 仍是唯一业务写入口，整批一次用户规则意图通过一个原子批操作提交，禁止多端重复领取造成重复任务。⚠️ 审计更正两点：审计基线的原子入口**不支持**“内容各异的一批新任务”——`entityIds` 批语义只施加同一 payload，批创建语义是**新增能力**（P1-2）；租约与幂等键**不能独自**防止跨设备重复创建，“本地已写、中心未知”的崩溃窗口需要专门协议（P1-1）。

普通 webhook 发送方的请求会在接收服务终止 TLS，服务端能看到本次外部载荷；必须向用户明确这一点，不能沿用“服务端看不到同步明文”的说法来宣传未加密的 webhook。接收后使用用户/设备公钥加密暂存，日志不写正文；现有 Vault 契约（`vaultKeyPackageSchema`）没有入站公钥字段，收件密钥的生成、同步、恢复与轮换是**新增设计**（P1-6），不是把现有包上传接口多传一个字段。若要求接收服务也无法看见内容，发送方必须先加密，作为高级协议另行支持。

设备离线时状态是“已接收，等待设备”，不是“任务已创建”。托管 AI 解析遵守现有出站授权、字段裁剪和提供商选择；不能借高级玩法绕过隐私开关。未来全天候运行器必须作为用户明确授权的独立设备，单独说明其持钥范围。

## 付费与可靠性

服务端在接收、解析和提交许可授予时核验有效权益。过期阻止新解析与新许可；已授予的许可允许原设备恢复同一意图，不能撤回本地已生效结果。已有任务仍可用。模型费用、调用额度和保留期在上线前明确，不任意虚构数值。用户自带模型也不能绕过自动收集功能权益。

回调凭据是**独立密钥承担身份、HMAC 签名承担完整性**的两层协议（不是二选一，线协议细则见 P1-5），校验时间窗、请求体上限、频率和来源规则；不复用账号密码或同步 token。按“账号 + 规则 + 来源事件 ID”持久去重；无来源 ID 时要求幂等键，重复请求返回原**事件的受理结果**——只含不透明事件 ID、状态、错误码与允许披露的计数，**不回传解析出的任务内容**（P1-6）。解析失败、提交失败分别记录，重试不能重复计量或产生重复 op——“不重复计量”需要事件级账本支撑，现有周期计数器与“发送前失败不退”的语义做不到（P1-4）。密钥轮换、规则暂停与删除按协议版本停止新的服务端访问与许可；自托管官方核验票据存在至多 30 秒的已签发窗口，必须披露。已经授予的提交许可不再转派。不能承诺抹除离线旧设备已取得的私钥或明文。

## 与现有订阅承诺的关系

2026-10-07 本次用户指令为新增高级自动收集指定付费资格，属于对旧有“自托管所有功能永久免费”描述的局部调整。现有本地任务、同步、本机工具和备份功能保持既有语义；不能追溯设限。正式实现前，AC-1 必须新增决策记录，明确取代 ADR-0017／ADR-0020 中哪些承诺，并同步订阅事实源、官网及条款；不得改写历史 ADR 或直接扩大现有套餐的售卖承诺。当前帮助中心只公布规划，不开启购买入口。

## 实施前置：协议契约（P1-1～P1-8）

> 来源：[独立审计](../research/inbound-automation-plan-audit.md) §3（逐项源码依据在那里，此处只留裁定与要求）。
> 第二轮复审后的技术裁定以[协议 v1](../reference/inbound-automation-protocol.md)与[ADR-0058](../adr/0058-inbound-automation-commit-and-task-batch.md)为准。**协议设计、反例验证和已定契约的基础切片可先进行；生产接线必须完成它依赖的 P1，全部门槛闭合前不开放接收与售卖。** 负责人已在本轮确认套餐与 7 天正文/草稿保留基线；下方〔裁决〕项按协议逐项落实，不以技术实现替代上线验收。

- **P1-1 事件状态机与提交唯一性**（AC-3 前置）。租约不能独自防止跨设备重复创建：A 落盘任务 T1 后断网未 ACK，租约过期 B 领取再生成 T2，两个 op 都会上传。必须定：`accountId + ruleId + eventId` 唯一约束、载荷摘要、冻结的规则版本/解析结果版本、执行设备认证身份、单调 lease generation 与 fencing（必须约束**业务提交**，不能只约束队列表），以及续租/结果发布/提交声明/ACK 的 CAS 条件；“本地已写、中心未知”要选一种完整协议（持久化提交身份与恢复证据后再授权唯一提交；无法证明原 worker 未落盘时进 `commit-uncertain` 并对账，不盲目转派新建）。现有 `executeAiToolProposal` 的宿主内 WeakMap 去重明确**不是**持久协议。
- **P1-2 批创建语义是新增能力，不是既有接线**（AC-5 前置）。审计基线的 `OpType.Batch` 对多个 `entityIds` 只施加**同一** payload；导入路径是循环 `dispatch`。必须新增“内容各异的一批新任务”的 intent/reducer/线形状：批大小、零/一/多项、每项稳定身份、共享来源 receipt、整批校验失败是否全拒；覆盖本地原子落盘、远端回放、重复与乱序、checkpoint 恢复、三套存储实现；不允许“先 create 后补备注/排期/来源”形成多个 op。新字段可选并有运行时默认。
- **P1-3 自托管可验证授权契约**〔裁决〕。新 capability 名、套餐包含关系、官方签发者/验证公钥及轮换、签名载荷版本、**官方购买主体与实例/本地账号的绑定**（不能只用 `userId=1` 这类实例内数字）、有效期/续费/吊销、可信时钟与回拨处理、离线核验与宽限策略（首版若只支持在线验证须明写，不暗示已有离线授权）。列出管理/签发/接收/领取/提交各自的校验点与错误码，定义“已接收后到期”“解析中到期”如何终止或等待。
  - 2026-10-09 判定侧定案（**覆盖**此前那版“订阅不满足时才接受短期绑定”的两来源并集写法）：权益来源由**显式部署模式**二选一 —— `official` 只看本机订阅的 `automation` grant；`selfhost-online` **不看本机订阅行**（在自己的库里给自己发货不算买到了），只看官方签发的票据；未配置即响的拒绝。票据按**封闭 action 词表 + 该动作自己的 rule/event 作用域**逐字匹配，在同一把账号锁内用数据库时钟判新鲜度、检查该实例的时钟高水位（回拨即停止授权）、在唯一约束下消费 nonce；只有 `session` 动作写绑定行，其余动作留下的是一次性消费证据。公网接收是唯一只能按 `session` 短期绑定判定的位置，也就是对外必须披露的那个 ≤30 秒窗口。~~仍缺：官方签发端与账号链接握手（`session` 的 `localAccountUuid` 目前仍由客户端声明，服务端只能要求后续票据与首次记录一致）、吊销版本在线刷新、各宿主每 30 秒续票据与 `waiting-entitlement` 展示~~ → **2026-10-09 现量更正**：签发端、`officialSubject ↔ installation ↔ 本地账号` 的链接握手（`session` 的三个字段现在取自服务端记录的绑定行，客户端自报的那一半已作废）、吊销版本在线刷新三件都已闭合，逐条判据与反向验证见本节末「2026-10-09 T1 签发端与账号绑定握手」；仍缺**各宿主每 30 秒续票据与 `waiting-entitlement` 展示**，故 **AC-1 继续不勾选**。
- **P1-4 事件级计量账本**〔裁决〕。现有 `consumeManagedAiRequest` 按 `(user_id, period)` 计数、无事件 ID、发送前失败已消耗且不退——事件重试会重复扣数。必须新增按事件/解析版本/尝试标识归属的持久结算或预留账本（reserve/consume/release/unknown 状态与周期跨越口径），原子绑定额度裁决与事件状态；冻结已取得的解析结果，提交失败不得重新解析计费；区分“用户不被重复扣功能额度”与“供应商物理调用绝不重复”，不承诺后者。
- **P1-5 请求与签名线协议**。独立凭据（身份）与 HMAC（完整性）是两层，不是等价选项。定：版本化签名串（method、规范化路径/规则标识、keyId、时间戳格式与允许偏差、来源事件 ID/幂等键、Content-Type、原始字节摘要）、固定算法/编码/常量时间比较、重复 header 与压缩请求策略；**同键异体必须冲突**，不能被旧成功掩盖；凭据权限分离（接收/用户管理/设备领取/结果查询），账号身份不得由正文自报；总字节、解压后大小（或拒绝压缩）、JSON 深度、字段长度、解析输出数、每账号/规则速率、队列条数/字节与并发预算的边界及拒绝码；ACK 只在队列持久化后返回成功；结果查询验证权限，不接受可猜事件 ID。
- **P1-6 收件密钥生命周期与回执披露**。现有 Vault 契约没有入站公钥字段，`vaultKeyPackageSchema` 是口令/恢复码包装的对称根密钥——不能当作现成能力。定：账号收件密钥或多接收设备 envelope 的生成端、算法及 AEAD 封装版本、keyId、以账号/规则/事件为 AAD 的绑定；私钥如何由 Vault 包装、跨设备同步、恢复与存储，公钥如何经认证发布及 CAS 换代；新增设备、最后一台设备丢失、Vault 锁定、改口令、root rotation、设备撤销时，已排队密文与在途 worker 的状态及重新封装责任（新事件用新 key epoch，旧队列迁移/等待/过期策略）。回执与状态查询**默认只含**不透明事件 ID、状态、错误码、允许披露的计数——**不得回传解析出的任务标题/备注给发送方**；任务 ID 是否向发送方暴露也须明示。
- **P1-7 字段映射与时区语义**（AC-4 前置）。`create_task` 契约只有 title/dueDate/priority/projectId，宿主日期换算用**执行设备本地时区**——上海规则的“明天九点”在纽约设备领取会写错绝对时刻。定：输入 → 中间解析结果 → 领域字段（含 note、startDate、durationMinutes、来源标记）的逐字段映射表（单项/数组、必填、长度、未知字段、批上限、合法清单）；规则时区优先于执行设备时区；date-only/全天/IANA zone/显式 offset/DST 重叠缺失/相对日期锚点（默认以服务器接收时刻冻结；只有规则显式授权且校验合法的来源时间可覆盖，重试不得按“今天”重新解释）；不确定状态判定表——无日期、格式无效、明确日期缺钟点、规则可补时区、时区冲突、过去日期各进哪个状态，“待确认”是排队草稿还是已建无日期任务，批里一项不确定是否整批等待。日历显示 = Task 的排期投影，不误用 EVENT 倒数日实体。
- **P1-8 规则授权与出境面**。复用 `isToolGranted` 的**判定语义**，不等于照搬用户对交互助手的全部权限。规则授权必须版本化并限定：目标清单、create-only、输入字段、输出数上限、解析方式、处理设备范围；领取/解析前/提交前重新核对有效版本（与 P1-1 的失效线性化点对齐）。为自动收集新增 `AiFeature` 出境类别与披露（或证明现有类别范围完全匹配并获得重新同意），复用 `authorizeEgress`/`invokeRouted`，不绕过账号联网同意、提供商选择和字段裁剪；来源正文不给工具选择循环、不给读任务、不给任意 URL/端点、不给修改授权——白名单与服务端校验是边界，prompt 指令只是辅助；仅本地模型不可用时进入暂停/待确认，不静默转远端。

## 上线前必须闭合（P2，可与实现并行、不得遗漏）

- **P2-1 “在线”≠“可执行”**。现有自动同步要求前台、Vault 会锁定——不能拿“设备在线”代替“当前能执行”。区分并保留原因码：接收 / 等待可执行设备 / 待解锁·授权·续费 / 处理中 / 待确认 / 提交结果待核实 / 本地已创建·同步未完成 / 完成 / 永久失败 / 过期取消（可合并展示，底层原因码不能丢）；试运行写明是否发模型请求/计费、是否保证零业务写入；跨设备确认与重试沿用同一事件身份；对已建任务的撤销是新用户意图，不是重新接收事件。
- **P2-2 保留期分对象**〔裁决〕。载荷密文、解析结果、最小幂等 tombstone、计量凭据、状态日志、备份**各自**定寿命与最大重放窗口——按载荷保留期一起删去重行，上游迟到重试会再建同一事件；删除规则不得顺带删光生成任务（覆盖用户后续编辑）；现有 `purgeExpiredAiUsageCounters` 只清 AI 计数器，不覆盖新队列。列出新表的账号归属、级联/清理任务、备份期限，中英隐私文档按 AGENTS §8.18 同步；价格/天数未拍板时保持占位并**阻止上线**，不用现有 AI 的保留数字填空。

## 实施清单（按审计 §5 升级为交接门槛）

每个 AC 分两层：**交接前**必须有的可审阅输入（即上方 P1 的协议产出），与**实现后**的最低验收证据。AC 仍是能力目录，但接口边界以 P1 契约为准——执行者在 AC 内不得自行发明授权、加密、计量或去重语义。

- [ ] **AC-1 权益与授权**。输入：P1-3 授权契约 + 新增 ADR（限定取代 ADR-0017/0020 的范围）+ 迁移清单 + P1-4 计量契约。证据：关闭旧权益 gate 仍挡住未授权自动收集、免费同步仍通过；免费/过期/错主体/错实例/坏签名/额度耗尽均拒绝且**不产生业务效果**；重试账目可对账。
- [ ] **AC-2 接收与队列**。输入：P1-5 线协议 + 签名测试向量 + P1-6 envelope。证据：真 HTTP 验证字节级签名、时间窗、大小、并发限额、跨账号隔离；同键同体重放返回同事件、**同键异体冲突**；持久化失败不返回 accepted；查询无任务明文。
- [ ] **AC-3 领取与提交**。输入：P1-1 事件状态机、lease generation/fencing、提交唯一身份、崩溃恢复图。证据：**两个独立真实宿主与独立数据库**跑通下方十个故障注入窗口，观察任务数、op 数、回执与计量——不只断言 HTTP 成功。
- [ ] **AC-4 解析**。输入：P1-7 字段映射与判定表 + P1-8 出境授权范围。证据：同一事件在不同时区、不同处理日得到相同归一化结果；DST/非法日期/长输入/多输出受限；正文中的注入指令与模型额外字段不能触发越权调用；实际出境请求符合披露。
- [ ] **AC-5 批创建与来源记录**。输入：P1-2 批创建 intent/reducer/线形状 + 来源 receipt。证据：多项不同字段只产生一枚逻辑 op；中断重启无半批；三套存储适配器与远端回放收敛；删除任务后重试不复活；旧数据无来源字段仍能 hydration。
- [ ] **AC-6 规则界面**。输入：规则版本契约、预览的计费/零写语义、状态原因码表、端能力表。证据：用户独立完成“启用 → 测试发送 → 等待 → 打开/解锁 → 自动处理 → 查看结果”；暂停/撤销/改规则与在途处理的竞态可解释；亮暗、窄屏、中英及各壳入口可用。
- [ ] **AC-7 文档**。输入：与真实部署契约一致的示例、错误/重试指引、隐私及价格说明更新清单。证据：官方与自托管样例分别可运行，端点与权限真实；未上线能力继续标“规划中”；旧承诺只按新增 ADR 限定范围修订。
- [ ] **AC-8 验收矩阵**。输入：平台 × 权益 × 设备状态 × 失败阶段的具体用例表与证据归属。证据：当前源码产物完成仓库要求的跨端安装/实机闭环；Linux 的当前交付定位在矩阵中说明，不被“跨端”两字隐去。

### AC-3 的十个故障注入窗口

每个窗口都在切断点注入中断，分别核对中心事件、两个本地库、同步日志与计量结果：

1. 队列已落盘、接收 HTTP 响应丢失；发送方以原键重试。
2. 已领取、解析前终止；租约到期后恢复/转派。
3. 模型已计量且可能完成、结果响应丢失；按规定的重试/unknown 策略处理。
4. 解析结果已冻结、提交前终止；接手方不得按新的“今天”或新模型重新解释。
5. 本地 op 已落盘、来源索引/回执未完成；同设备重启不再派发。
6. 本地 op 已落盘未上传、ACK 丢失，A 租约过期后 B 领取；最终不得两次创建，也不得偷偷降级成两个 op。
7. A 持过期 lease 恢复、B 已获得新 generation；A 的续租、提交与 ACK 都按明确边界处理。
8. 暂停/删除规则、撤销凭据/设备、权益到期、撤回模型同意、Vault 锁定，分别发生在解析中与提交前。
9. 任务被用户编辑/删除、队列正文过期后上游重试；既不覆盖编辑，也不重建已删任务。
10. 第一台设备永久丢失、新设备加入、根密钥轮换；每个保留事件要么可解密恢复，要么有确定终态与可见原因。

所有数值边界都测“恰好上限/上限加一”；每条防线至少有一个能使其失败的负向用例。密钥、正文、恢复码、账号凭据不得写入证据文件，用合成秘密与布尔对账证明未泄漏。

所有阶段完成前，不创建虚假的回调地址，不把文件导入包装成公网自动化，不将设计计划标记为已实现。

## 独立审计与交接状态

2026-10-07 已完成[独立计划审计](../research/inbound-automation-plan-audit.md)（逐项源码依据在其 §3，交接输入与验收证据表在其 §5）。**本计划已按审计更新**：P1-1～P1-8 的协议契约收进「实施前置」，P2 两项列为上线前门槛，实施清单升级为“交接前输入 + 实现后证据”两层，AC-3 的十个故障注入窗口照单收录，正文三处会被误读的表述（既有原子入口的能力边界、“独立密钥或 HMAC”、“重复请求返回原任务结果”）已按审计更正。交接时本计划与审计报告**一同**提供给执行者；所有裁决与进度仍回到本文件，不另建第二份计划。本轮只完成规划与审计，未实施公网回调功能；未上线能力在帮助中心继续标“规划中”。


## 第二轮复审与实施顺序（2026-10-07）

[严格复审](../research/inbound-automation-review.md)确认首轮核心依据可信，并补充了许可后撤销、认证设备补传、加密重复校验、date-only/日历视图差异、HMAC 密钥存储、Hermes 能力和 ADR-0054 计量承诺的缺口。输入计划及源码摘要已归档；既有测试 40 + 93 项和源码探针通过，**不是新功能验收**。

1. **W0 协议和裁决**：技术基线见[协议](../reference/inbound-automation-protocol.md)，商业限定见[ADR-0060](../adr/0060-automation-entitlement-and-retention.md)，负责人已确认：现有 AI 付费档含自动收集、自托管同档授权、不另收事件费、模型沿用原额度；正文与草稿 7 天、去重摘要至规则删除、规则 ID 永不复用。许可前可转派、许可后唯一 owner；不确定时对账不重建。
2. **W1 批语义与本地恢复（AC-5 / AC-3 基础）**：严格 batch payload、原子 reducer、共享创建动作、持久提交身份与三适配器/重启/乱序证据。该阶段无公网入口，不依赖售价。
3. **W2 密钥与时间语义（AC-2 / AC-4 基础）**：收件 envelope 与 Vault 生命周期、date-only 与 instant、全视图读取和实际宿主能力。
4. **W3 服务端（AC-1～3）**：先迁移与数据库原子边界，再签名/队列/租约/许可/查询/官方与自托管权益/事件账本；默认关闭，真 HTTP 与 PostgreSQL 故障注入。
5. **W4 解析与 worker（AC-3 / AC-4）**：共享授权、字段裁剪、模型结果冻结、联网/前台/Vault fence；两个独立 SQLite 宿主跑全部故障窗口。
6. **W5 UI 与文档（AC-6 / AC-7）**：规则、等待原因、预览计费、确认与取消；中英文案、既有隐私与价格事实源同步，商业变更另发限定取代旧承诺的 ADR。
7. **W6 全面验收（AC-8）**：固定源码基线，全仓门禁、四端重装及 Linux 交付取证；按设计/生产接线/恢复/平台/当前产物逐格收证。没有闭合时 Goal 不标完成。

新增故障窗口：11. 提交许可与暂停/撤销两种相反事务顺序；12. 换 keyId 后同事件重试与旧钥查询；13. date-only、start-only 在跨时区日/月/年/时间线的展示与编辑往返。原十个窗口全部保留。

### W1 当前证据与未完成边界

已实现严格的 `heytaTaskBatch: 1` payload、单 op 异构任务 reducer、可选来源 receipt、共享 app-host 创建动作；事件固定 op/task 身份和热区/归档索引查询支持重试取回原 op，内容不同/设备不同拒绝，不重建已删除任务。SQLite Worker bridge 同步新增查询。未知 marker 在本地、远端、导入落盘前拒绝。

阶段验证：shared-schema 新契约 14 项、op-log 新批/恢复 16 项、app-host 新动作 9 项通过；storage 全包 419 项、op-log 全包 133 项通过，五个改动包类型检查通过。上述测试是当前工作树的阶段证据，**不是最终隔离基线的全仓验收**。shared-schema 全包目前 160 通过/1 失败，失败是并行认证变更将 `AUTH_PASSWORD_PATHS` 从 6 项扩为 9 项而原测试仍断言 6（`auth-http-contract.spec.ts:83`）；本轮未改该生产文件或测试。文档死链仍有并行产品 UX 的 14 处，本任务新增文档链路无报错；ADR 编号检查通过。

尚未闭合：各宿主真实生命周期接入、账号/本地库实例绑定的最终验收、清单授权与中心许可的跨版本证据、跨设备十个故障窗口、真进程终止（当前是可控失败/真实文件重开）、根密钥轮换、密码学/时区/商业接线、UI、全仓及当前产物重装。AC-3/AC-5 仍保持未勾选，Goal 保持 active。

### 身份边界勘误与 W2 基础进度

深入 HTTP 调用链后发现现有 clientId 来自请求正文，不能当作认证设备。第二轮审计 R2 已追加显式勘误；[ADR-0059](../adr/0059-inbound-worker-authenticated-identity.md)规定新增独立 worker 凭据、不可自报的 owner/数据库 epoch，以及正常同步保存路径的 `inbound:` 前缀门禁。该项为 W3/W4 前置；同步身份门禁切片已实施，注册接线已在 2026-10-08 补齐，许可签发仍待接线，详见下节。

已新增 `@heyta/inbound-core` 共享密码学/请求原语，避免接收端和客户端各实现一份协议：X25519 + HKDF + 既有 AES-GCM、Vault root 包装、原始字节 HMAC、重复 header 拒绝、严格 UTF-8/重复 JSON key/复杂度界限。新增 @noble/curves 2.4.0 的维护性及 MIT LICENSE 已核验，实际依赖树许可证门禁通过，生成登记表已更新。两套 AES 后端及独立 Node 双向互通、签名与输入负向边界共 29 项测试通过；这是原语证据，**不代表真实 HTTP 接线、账号公钥注册、密钥迁移或 Hermes 真机已完成**。


### W3 身份门禁切片（2026-10-07，未完成整条自动收集）

新增 `automation_workers`（仅存 256 位随机凭据的 SHA-256、账号/设备/本地库绑定、撤销标记）与 `automation_commit_permits`（固定事件/op/owner、解析版本、摘要和条数）迁移。正常 `/sync/ops` 与 `/ops/causal` 在缓存前认证，实际 `processOperation` 在上传事务的账号锁内再次认证，含原 op 精确重复分支；无身份的内部调用也拒绝。现有 snapshot 的 UUID opId 契约已能拒绝该保留前缀，未增加第二份判断。设备撤销在同一账号锁下撤销对应 workers；JWT 认证版本传递到门禁并与数据库现值对账。

阶段证据：真 HTTP + 独立 PostgreSQL 14 临时实例的 10 项通过，含同账号 B 同时伪造两处 clientId、缺凭据/错账号/错 epoch/错批范围、A 重试单行、缓存旁路拒绝、预检后撤销并发、账号级联删除。补充的内部重复和 tokenVersion 两项已实测通过；中途内存闸门拒绝的运行不计入通过。相关单元/路由 40 项、认证/校验回归 97 项通过，服务端 TypeScript 通过。新增两表与当前并行注册挑战表均纳入隐私文本的中英类别和注销范围对账；补充修订历史后 66 项复跑通过，legal 类型检查、注销真实性/GDPR 门禁和服务端生成快照对账通过。

临时 PostgreSQL 用原迁移 SQL 构建空库；macOS 上项目部署脚本被 Linux 专属 `client_connection_check_interval` 拒绝，因此这不是部署脚本验收。生产环境未迁移。此前测试许可是显式数据库夹具，不宣称已完成跨端授权状态机；注册、领取/冻结/许可签发和共享 worker 正常路径已接线，但密钥生命周期、日期语义、UI 与各端交付仍未闭合。Goal 继续 active。


身份切片复跑入口：`python3 research/tools/verify-inbound-worker-identity.py`（需 PostgreSQL 工具，可用 `--pg-bin` 指定）；它只创建 loopback 临时测试库，结束停止并清理。删除窗口现以“删除事件/摘要/服务端 permit，客户端已保存的签名 owner receipt 支持迟到同步”为边界，但两个独立宿主的真实进程中断验收仍归 AC-3，尚未验收。

本切片的[真库输出](../research/evidence/inbound-automation-review/worker-identity-postgres.txt)与[源码摘要](../research/evidence/inbound-automation-review/worker-identity-manifest.json)另存，不覆盖复审前的基线摘要。

### W3 注册接线（2026-10-08，阶段完成，仍非完整自动收集）

新增 `POST /api/automation/worker/register` 与 `POST /api/automation/worker/revoke`：先验证 JWT，再验证独立 `automation` 权益；注册在账号行锁内撤销同一 client/epoch 的旧 worker、生成新的 256 位 token，仅保存 SHA-256，明文只在 201 响应返回一次。撤销同样在账号锁内执行，和上传路径共享撤销语义。`hosted-ai-monthly` 现在明确包含 `automation` 授权，数据库由新迁移扩展 grants CHECK；自托管默认关闭权益闸门，启用闸门时也走同一 capability。

阶段证据：服务端 TypeScript、价格一致性门禁、迁移形状门禁和 89 项价格/结算回归通过。`POST /api/automation/commit-permit` 也已接线：同一事件/内容重试复用原授权并重签不透明回执，异内容与错误 worker 拒绝；回执不含规则或任务正文。规则元数据与七天到期的密文事件账本表已建，规则删除保留 rule ID tombstone，清除事件/摘要/服务端 permit，迟到同步验证客户端已保存的签名回执，启用前要求独立 webhook key ring 中存在对应 key。账号收件 X25519 公钥注册/读取走版本 CAS，旧包不能覆盖新包。真 HTTP/PostgreSQL 证据为 15 项，归档于 [`worker-registration-postgres-20261008.txt`](../research/evidence/inbound-automation-review/worker-registration-postgres-20261008.txt)，清单与哈希见 [`worker-registration-manifest.json`](../research/evidence/inbound-automation-review/worker-registration-manifest.json)。客户端尚未接入真实注册调用和平台持久 worker secret / journal-before-dispatch，公网回调接收、加密队列实际写入、领取/解析、根密钥迁移、UI 和跨端安装仍未闭合。

### W3 公网接收切片（2026-10-08，已接线，仍非完整自动收集）

新增独立 Fastify 插件 `server/src/automation/inbound.routes.ts`，注册
`POST /api/automation/v1/hooks/:ruleId`。入口使用 `parseAs: 'buffer'` 保留原始字节，
复用 `@heyta/inbound-core` 的重复 header、Content-Type、时间窗、HMAC、UTF-8、JSON
重复键/深度/字段数校验；规则必须启用且 keyId 匹配，账号收件公钥存在后才用
X25519 envelope 加密原始输入，并将七天事件密文与最小元数据写入 `AutomationEvent`。
响应只返回不透明 `eventId/state`；同 eventId 同字节与类型幂等，异字节或异类型返回
`409 EVENT_CONTENT_CONFLICT`。补充迁移记录 canonical Content-Type，并移除错误的
`(userId,dedupeDigest)` 唯一约束：相同内容但不同来源 ID 是两个明确意图，不能被
内容摘要锁死。base64url 公钥在服务端边界规范化为 envelope 的 canonical base64。

阶段证据：`server/tests/inbound-automation.routes.spec.ts` 真 Fastify HTTP 4 项通过，
覆盖密文落库与解密、重复 JSON key、精确重试/异内容冲突、过期签名；服务端
TypeScript 与迁移形状检查通过。此切片**不等于**队列领取、租约 fencing、AI 解析/计量、
提交许可、Vault 私钥迁移、客户端注册、UI 或跨端验收；公网入口在这些依赖闭合前仍不对外开启。

真库补证：一次性 PostgreSQL 14.18 应用当前全部迁移后，注册/许可/规则/CAS 与公网 webhook 同一集成套件 **16/16** 通过；新增 webhook 断言实际密文落库后可由收件私钥回读、精确重试幂等、异内容冲突，认证 worker 领取/续租/generation fencing/结果发布幂等。输出归档于 [`webhook-postgres-20261008.txt`](../research/evidence/inbound-automation-review/webhook-postgres-20261008.txt)，不含合成秘密以外的凭据或正文；这仍不是 AC-2～AC-8 的完整验收。

客户端接缝补充：`packages/app-host/src/inbound-worker.ts` 现在提供 claim/lease-renew/result-publish 的共享 HTTP 传输，所有请求只从注入的 worker secret store 取凭据，结果与输入保持 opaque ciphertext；新增 7 项宿主测试通过。各 Web/mobile/desktop 实际 secret store、Vault 解密、AI 解析和 UI 尚未接入，不能把共享接缝当成跨端 worker 已完成。

### W3/W4 复审修复与解析基础（2026-10-08，阶段证据，仍不开放）

针对复审 F1–F5 已追加迁移 `20261018080000_harden_automation_identity_retention`：事件 ID 在账号内唯一；提交许可改为事件复合身份，并在同一事务核对已启用规则、`prepared` 状态、规则/解析版本、冻结摘要和条数；事件 ID 在公网接收、claim、续租、结果和 permit 全链路统一为 64 字符；七天 sweep 只清输入/结果密文并保留事件账本。生产 keyring 条目必须带 `userId`，验签按规则所属账号取钥匙；纯字符串旧形状仅在测试进程兼容。

新增 `automation_ai_attempts` 元数据账本及 `reserveAutomationAiAttempt`：预留、现有 AI 周期额度占用和事件级 `(event, parseVersion, attempt)` 记录在同一事务内；重复预留幂等，不写正文/模型输出。共享 worker 已接入 reserve 与 `sent/consumed/unknown` 状态，仍需各宿主真实调度、供应商失败/unknown/release 对账和两宿主故障注入。

新增 `@heyta/inbound-core` 受限字段投影与冻结解析器：规则白名单决定出境字段；模型结果严格映射到 `heytaTaskBatch: 1`，任务 ID/op ID 稳定，date-only 保留原日历日并生成规则时区兼容投影、instant 必须带显式 offset，拒绝执行设备本地时区推断。规则配置/授权版本已经进入服务端模型和配置 API；`app-host` 新增 claim → 解密 → `inbound-automation` 出境授权路由 → 冻结 → 收件公钥加密结果的共享 runner，以及 Vault root 包装的本地收件私钥存储。当前仍缺各宿主实际接入、UI、根轮换迁移和 AC-3/AC-8 验收；Goal 保持 active。

### 严格复审补充与本轮实现（2026-10-08）

本轮再次按“计划条款 → 运行时代码 → 持久化边界 → 负向测试”复审，确认两处真实缺口并已修复：

1. **规则授权契约已进入持久化模型**：`AutomationRule` 新增可选字段白名单、目标清单、规则时区、解析版本、授权版本和输出上限；创建与配置更新均校验字段闭集、IANA 时区和 1–50 条上限，配置更新会停用规则并递增版本，领取/许可仍以版本匹配为门槛。新增迁移 `20261018100000_add_automation_rule_contract`，未修改已应用迁移。
2. **规则删除与迟到同步分离**：删除事件、去重摘要、计量尝试记录及服务端提交许可，保留永久停用的 rule ID；本地写入前已 journal 的签名 owner receipt 支持迟到上传，仍要求有效账号与未撤销 worker。普通模型周期累计额度不会因删除规则而退还。
3. **共享 worker 已具备正常路径与准备结果恢复管道**：`processInboundAutomationEvent()` 现在负责 claim、租约续期、受限字段投影、AI 计量状态 `reserved → sent → consumed/unknown`、结果冻结、permit 请求、journal-before-dispatch 和单一异构 task-batch dispatch；新增认证的加密结果读取可恢复“结果已发布、permit 请求前进程终止”的窗口。permit 签发与结果发布仍是两个中心事务，真实进程中断矩阵仍需验收；它是宿主接线的共享管道，不等同于 Web/mobile/desktop 已启用。各宿主的 secure store、规则 UI、根密钥迁移和真进程中断仍未闭合。
4. **公网队列边界已在线性化点执行**：接收事务在账号行锁内按未终结事件数和密文总字节数检查 1,000 条 / 64 MiB 上限，超过时返回不含正文的明确拒绝码；Fastify 速率限制仍是外围防线，AC-2 仍需独立 PostgreSQL 并发与上限/上限+1 证据。

本轮证据：`@heyta/inbound-core` 32 项、`@heyta/app-host` 78 文件/1561 项、服务端构建和迁移形状检查通过。服务端全套仍有并行会话引入的既有测试红灯（账号 tokenVersion、压缩同步 mock、计量夹具），不把它们计入自动收集成功；Goal 继续 active，AC-1～AC-8 不勾选。

### Node 宿主真实接缝（2026-10-08，阶段证据，仍不开放）

`packages/app-host` 现提供宿主无关的 `registerInboundWorker`、收件私钥保存/读取和
`processInboundAutomation` 入口；worker token、提交回执日志和收件私钥均落在同一真实 SQLite
meta store，token/私钥只以 Vault root 包裹形态持久化。`apps/node-host` 只注入 Node SQLite
驱动并暴露同一入口，没有重写业务管道。Vault root 轮换会在新 root 安装后重包 worker token
与收件私钥；Vault 锁定时读取和处理明确 fail closed。

阶段证据：Node 宿主真实 SQLite 测试覆盖注册响应、收件私钥保存、关闭重开后恢复，以及重开后
从持久 worker 凭据进入 claim 空队列路径；`@heyta/app-host` typecheck/test 和
`@heyta/node-host` typecheck/test 通过（当前 app-host 81 文件/1565 项、Node 宿主 195 项）。这只证明一个真实宿主的
持久接缝和正常空队列路径，尚不证明 AI provider、结果/permit 中断矩阵、根轮换真迁移、其他
宿主、规则 UI 或 AC-1～AC-8；因此 AC-3/AC-4/AC-6/AC-8 仍不勾选。

解析器的 date-only 语义已收紧：规则时区（可选，缺省 UTC）用于生成兼容 epoch 投影，
`dueDateLocal/startDateLocal` 另存原始 `YYYY-MM-DD`，读取侧优先采用原日历日；带时间的值仍必须
显式携带 offset。领域筛选、日历、倒计时、象限、排序及 Web/mobile 编辑器已接入，上海、
纽约和 DST 的定向测试通过。时间线、提醒、真实跨端显示与编辑往返仍需验收，不能据此勾选 AC-4。

### 严格复审与收件密钥轮换补强（2026-10-08，阶段证据，仍不开放）

本轮按“服务端产生的 AAD → 宿主持有的账号绑定 → 本地密钥 epoch → 规则/事件版本”重新走了一遍真实调用链，发现原实现有一处会在真实轮换后丢失恢复能力的缺口：本地收件私钥记录只有一个 epoch。root rotation 虽然会重包该记录，但新收件 epoch 会覆盖旧记录；旧队列仍以旧 epoch 加密时，设备无法解密它们。该缺口已修复为可选的 v2 多 epoch meta 记录：旧 v1 记录可继续 hydration，写入时惰性升级；每个账号/服务端/epoch 独立保存，重包只处理当前账号与 origin，变更采用快照 CAS，失败不会写半份结果。Node/内存适配器测试覆盖 v1 升级、并发保存、账号隔离和轮换失败。

同时补上宿主无关的收件密钥注册客户端（认证 GET、首次 PUT、CAS 冲突）和规则 CRUD 客户端。首次确保密钥时先写 Vault 包装的本地私钥，再以 `expectedPackageVersion=null` 发布公钥；已有远端公钥但本机没有对应 epoch 私钥时明确进入“需要恢复”，不会自动生成新密钥覆盖在途队列。显式轮换递增 epoch/packageVersion，保留旧 epoch 私钥，CAS 冲突会清理新 epoch 的本地暂存。协议 AAD 的账号标识统一为 `user-<numeric user id>`；Vault 的账号 scope 仍使用认证层的数字字符串，两者不再混用。

本轮新增验证：`@heyta/inbound-core` 34 项、收件密钥/规则远端/密钥存储相关 `@heyta/app-host` 11 项均通过；app-host 生产构建与 node-host 独立 typecheck 通过。严格复审仍判定以下门槛未闭合：Web/mobile/macOS/Windows/Linux 尚未接入真实 worker，规则 UI 尚未完成，双真实宿主进程终止矩阵与四端清旧包/重装/产物对账尚未执行；因此 AC-1～AC-8 继续不勾选，公网接收仍不得开放。

本轮线协议复核又发现一个会令真实链路直接失效的形状问题：服务端认证中间件只接受 `Authorization: Bearer <JWT>`，而共享 inbound 客户端原先在 worker 注册、领取、结果/许可及规则/收件密钥请求中把原始 token 直接放进头部；测试 mock 没有模拟认证中间件。现已在宿主无关边界统一补上 Bearer 前缀，并加入请求头断言。该问题已闭合为代码缺陷，但 AC-2/AC-3 仍需真 HTTP、真数据库和故障注入证据，不因 mock 通过而勾选。

严格复审补充：无 JWT 的公网 webhook 也必须在账号锁内执行同一 `automation` grant 判定；现在自托管默认权益总闸关闭时，hosting/同步仍保持既有语义，但自动收集不会因此免费放行。首次收件公钥发布按“先保存本地候选私钥、再 CAS 发布、响应丢失后对账复用”处理，避免把服务端已接受而客户端未收到响应误判为失败并删掉唯一解密钥匙。

### 2026-10-08 严格复审后续：Web 宿主接缝（仍不开放）

本轮把 Web 设置与持久化边界接上，但没有把阶段证据误写成上线完成：

- 新增“设置 → AI 与集成 → 自动收集规则”界面，规则创建/读取/暂停/启用/删除均调用认证的 `Bearer` API；字段白名单、目标清单、IANA 时区、解析版本和 1–50 条上限由服务端再次校验。界面同时明确公网回调先在服务端接收，发送方只看到不透明事件状态。
- Web 新增独立 IndexedDB `heyta-inbound`，使用 Vault root 包装 worker token、收件私钥和提交回执；收件密钥首次注册与显式轮换沿用多 epoch/CAS 协议，旧 epoch 不会被覆盖。注销清单与真源对账已加入该库。
- Web 处理设备注册和 foreground worker 已接入共享 `processInboundAutomationEvent`：focus/20 秒周期仅在页面前台、Vault 解锁、worker 凭据、收件密钥和 AI 路由可用时尝试领取；出境同意、provider 选择、计量账本、结果密文、permit journal 和单一异构 batch op 仍由共享层负责。没有可执行条件时不静默切换到远端或明文。

阶段验证：`@heyta/web` 类型检查、`check:ui-language`、Web 全量测试（2091 项通过、13 项跳过）、`@heyta/app-host` 构建、`@heyta/node-host` 真实 SQLite 测试（197 项）通过。Web 运行时目前只覆盖浏览器宿主；移动端、macOS、Windows、Linux 的 worker 调度与密钥库仍未接入，双真实宿主进程终止矩阵、AC-3 十三个故障窗口、四端清旧包/重打/重装和全仓门禁仍未闭合。AC-1～AC-8 继续不勾选，公网接收不得开启。

### 2026-10-08 严格复审追加：轮换恢复与 Web 规则接缝

本轮把复审发现的三个可执行缺口纳入计划：

- 结果恢复按 envelope 自带的 key epoch 读取保留私钥；宿主必须提供 retained-key loader，旧队列在轮换后仍可恢复，临时私钥使用后清零。
- recipient-key PUT/GET 纳入 `automation` capability gate；同 epoch 只允许同公钥幂等重发，换公钥必须递增 epoch。该规则加入 AC-1/AC-3 的负向证据。
- Web 规则 UI 已补编辑/保存/取消、删除墓碑展示和可执行原因状态；自动领取只依赖服务端 claim 快照，不按列表第一条规则推断事件归属。

本轮新增阶段证据：app-host 旧 epoch 结果恢复测试 2/2；app-host/i18n 构建、Web 类型检查与界面文案门禁通过。该证据不勾选任何 AC。仍待：发送方签名试发向导、移动与 macOS/Windows/Linux worker 生命周期、两个独立真实宿主进程终止矩阵、跨端日期视图往返、四端当前产物重装和全仓门禁。公网接收与售卖继续关闭。

### 2026-10-08 新 Goal 复审：worker 身份与回执并发

严格复核发现两个本地持久化边界并已修复：

- worker 凭据读取现在同时绑定账号、`clientId` 和服务端 origin；仅知道账号和 origin 的另一设备不能恢复该 worker token。
- worker 凭据清除改为事务内按绑定条件删除，避免“先读后删”误删并发保存的新凭据；root rotation 对 worker wrapper 增加快照 CAS。
- commit journal 的读改写改为同一 meta-store 事务，并拒绝非字符串/数组形状，两个并发事件的 opaque receipt 不再互相覆盖。

阶段证据：app-host build；worker 身份、并发回执和旧 epoch 恢复定向测试 5/5。AC-3 仍需两个独立真实宿主、真实服务端进程终止和完整故障窗口矩阵。

### 2026-10-08 新 Goal 调度切片

新增宿主无关 `startInboundWorkerLoop`：每次唤醒重新检查可执行门槛，禁止并行 claim/process，停止后不再启动新尝试；Web 前台设置页和 Node 宿主均接入该原语。7 项调度/密钥/恢复测试与 Web、Node 类型检查通过。移动及 macOS/Windows/Linux 原生调度仍需接入各自前台与安全存储生命周期。

### 2026-10-08 续轮修正与下一实施顺序

调度重入、上传事务完成回写、规则删除摘要清除、旧输入 epoch 解密、模型发送前误计量、租约过期重复模型调用、目标清单冻结与服务器接收时间传递已修复。代码与验证边界详见[续轮复审](../research/inbound-automation-review.md)；[定向记录](../research/evidence/inbound-automation-review/continuation-20261008.txt)中真实 HTTP/PostgreSQL 为 20 项，均不是完整交付门槛。

Web 与共享宿主普通同步的 worker/receipt 接线已补齐，并验证真实 SQLite 重启后上传。prepared 自动发现与 `model-result-uncertain` 显式确认重试已实现；其他歧义草稿的编辑/确认仍未完成。下一步优先闭合 date-only/时区模型与 direct/managed 并发计量对账，再完成自托管签名授权、各端生命周期、双独立真实宿主故障矩阵与安装验收。不得根据本轮切片勾选任何 AC。

调度状态备注：本次工具读回旧 Goal 为 blocked，新建请求被“已有未完成目标”拒绝；这不表示产品完成或工作无法推进。继续保存既有完整目标和实施进展，不以虚假 complete 换取新 Goal。

2026-10-08 状态更新：用户已删除旧 Goal，本轮已成功创建覆盖严格复审至完整验收的新 Goal；上段仅保留为当时历史记录，不再代表当前工具状态。

### 2026-10-08 恢复、保留期限与会话复审

本次补上 prepared 自动发现、同 owner 恢复、模型结果不确定时的两阶段确认重试。Web 表单与事件行改为纵向结构，修复复用横向选项卡导致文字竖排和整块蓝底的问题，保留修复前后截图。共享恢复器重新计算任务内容摘要；续租/发布/首次 permit 不再等待定时清理才执行七天到期限制；模型 reserve/sent 核对规则/解析版本、attempt、generation、期限；结果发布强制 itemCount。首次 permit 在账号锁后共享锁定订阅行并复核权益，精确 owner 重试保持可达；真实锁等待/到期注入验证新许可拒绝。Web 与共享 host 在会话失效后阻止在途响应引发新的请求和本地 op。

阶段验证与尚存缺口见[本次复审](../research/inbound-automation-review.md#2026-10-08-恢复保留期限与会话复审)。真实 HTTP/PostgreSQL、共享内核、Node SQLite 和浏览器 UI 分别验证，UI 的 HTTP fixture 不冒充真实端到端。AC-1～AC-8 均维持未勾选，公网功能仍不开放。

### 2026-10-08 新 Goal 续轮：确认门禁与 date-only 日历投影

严格复审发现，服务端虽有 `needs-confirmation` 状态，模型结果冻结器原先却不接受该标志，共享 worker 因而无法把加密草稿停在许可前。本轮允许受限模型结果显式给出布尔 `needsConfirmation`，将它与密文结果一同发布；处理器在确认态不申请提交许可、不写 op，服务端同一冻结结果的幂等重发不允许把确认状态翻成 `prepared`。这只闭合**确认门禁**，并未完成草稿编辑/确认/取消；模型错误日期仍可能使冻结失败，不能把它误报为完整歧义草稿流程。

日历 `calendarTaskSpan` 的 date-only 开始 + 时长此前仍从规则时区兼容 epoch 计算跨度，在异区设备上会提前或延后一天；现在用原始本地日历日投影区间端点。上海与洛杉矶定向测试均通过。后续须把提醒触发、全视图和真跨端编辑往返纳入 AC-4；AC-1～AC-8 继续未勾选。

### 2026-10-08 完整范围 Goal 与草稿决策后端

Goal 服务当前仍残留旧目标的 `blocked` 状态，创建新 Goal 被后端拒绝；本计划继续保留完整范围，覆盖严格复审、方案/计划、全部生产链路、AC-1～AC-8、双真实宿主故障矩阵、额度对账、全仓门禁、四端当前源码重打重装及 Linux 交付验收。不得因 Goal 元数据残留而缩小范围，也不得伪造旧目标完成。既有商业裁决全部保留。

本轮新增共享严格草稿契约及认证读取/确认/取消 API：确认在账号锁内复核当前会话、锁定订阅权益、规则与解析版本、收件 epoch、条数和无许可；读取/取消不额外要求付费。决策最终写入使用状态/尝试/旧摘要/版本/期限 CAS，防止独立到期清理与决策竞争时复活密文。接口只接收封装后的结果，不接收明文；确认进入 prepared，仍由原恢复与单 op 提交路径执行。

阶段证据与执行边界见[草稿决策复审](../research/inbound-automation-review.md#2026-10-08-草稿决策后端与到期清理竞态)。客户端编辑/加密/会话 fence 和非法日期草稿仍待实现；最新追加的真库清理竞态测试尚受内存护栏拦截，不能当成已通过。继续沿本 Goal 推进，不勾选任何 AC。

### 2026-10-08 发送方凭据生命周期与 Web 管理接线（阶段证据，仍不开放）

本轮严格复审补齐了自托管发送方凭据的真实生命周期：新增 `AutomationSenderCredential` 与迁移，使用独立部署 KEK 包裹 HMAC secret；签发在账号锁内轮换同 keyId 的旧活动凭据，撤销记录保留，活动唯一性使用部分唯一索引。服务端公网接收/状态查询和规则启用均按“托管凭据优先、托管记录存在即禁止 legacy fallback”执行，避免撤销后旧环境密钥继续可用。新增认证 API 仅返回一次 secret，列表接口只返回元数据。

Web 设置页已接入生成/轮换、一次性展示与复制、活动凭据元数据和撤销。相关服务端 sender/inbound route 测试 11 项、app-host 规则远端测试 4 项、Web 自动收集生命周期定向测试 7 项、服务端与 Web/app-host 类型检查和迁移门禁通过。此证据不等于签名试发成功，也不覆盖自托管官方授权、真实 HTTP/PostgreSQL 最终源码重跑、managed/direct 并发计量、双真实宿主故障矩阵或原生端生命周期；AC-1～AC-8 继续不勾选，公网接收与售卖继续关闭。

下一切片为签名试发：新增最小测试 payload 的可审计发送入口，验证一次性凭据、同键异体冲突、状态查询只返回 opaque 状态，以及试发不绕过规则授权、计量和保留期。完成后再进入正式自托管签名授权和跨端 worker 验收。

凭据撤销的线性化点已与入队共用账号锁：验签只证明请求在某一时刻有效，最终写队列前必须重新确认托管 credential ID 仍为活动状态；撤销/轮换胜出则不产生事件。secret 在验签路径结束后清零。签名试发受理状态单独展示为 opaque 状态，不复用“任务已提交”文案；它可能进入真实队列并消耗既有自动收集模型额度，用户需按规则/权益/设备状态理解后续处理。

### 2026-10-08 移动端前台 worker 阶段接线

移动壳现在复用共享 worker loop：前台 focus 与 20 秒 tick 触发，后台停止新 claim；本地 SQLite `clientId` 派生 database epoch 并持久 worker 注册，收件 key/Vault/AI route/egress consent 缺一则等待，不自动创建密钥或绕过授权。Android/iOS 仍需当前产物上的真服务端验证、模型供给、故障注入与跨端往返，不能据此勾选 AC-3/AC-4/AC-8。

### 2026-10-08 计量来源冻结与数据库约束（阶段证据，仍不开放）

严格复审发现共享 worker 已能在实际路由解析后识别 `local/direct/managed`，但服务端 reserve handler 尚未接收并冻结该来源，且 state transition schema 错误地要求每次状态变更重复提交来源。现已修正为：reserve 才提交来源；state 只携带状态机字段；服务端把来源写入尝试账本并在重试时做不可变性校验。新增迁移放行 `local`，并保持 `local/direct` 的 `period_anchor IS NULL`、`managed` 必须有周期锚点的 CHECK。

阶段证据：服务端类型检查、计量/入站路由 12 项、app-host 定向 1705 项、迁移形状检查通过；一次性 PostgreSQL 14.18 真库应用全部迁移并运行 worker identity HTTP 集成 30 项通过。新增并发来源对账用例已接入，但完整跨进程故障注入、托管模型真实供给、自托管在线授权、各端当前产物验收仍未闭合，AC-1～AC-8 继续不勾选，公网接收与售卖继续关闭。

### 2026-10-09 自托管在线权益票据阶段接线

服务端新增 `AutomationEntitlementBinding` 与一次性 nonce 表及迁移。`entitlement-ticket.ts` 验证官方 Ed25519 票据的原始 claims，固定绑定官方主体、安装实例、本地账号 UUID、吊销版本与最多 30 秒有效期；在账号锁内消费 nonce，重复票据、过期、错主体/实例/账号和旧吊销版本均拒绝。`POST /api/automation/entitlement/verify` 只返回状态和过期时间，自动收集权益守卫在订阅不满足时接受有效短期绑定，普通自托管同步仍保持原语义。

定向票据测试 3/3，连同计量与公网接收测试 15/15；服务端 TypeScript、Prisma 生成与迁移形状检查通过。官方签发端/吊销在线刷新、真实 PostgreSQL nonce 并发、客户端续票据生命周期、时钟回拨 UI 尚未完成，AC-1～AC-8 继续不勾选，公网接收与售卖继续关闭。

宿主传输层同步增加 `verifyAutomationEntitlementTicket`，统一 Bearer 认证、票据与本地账号 UUID 的请求形状和过期响应校验；app-host 类型检查与 2 项负向/正向测试通过。它只完成客户端接缝，官方票据获取、定时续票据和 waiting-entitlement 展示仍未实现，AC 继续不勾选。

补充复审发现自托管绑定必须穿过无 JWT 的公网接收和账号锁内首次 permit，不能只挂在 API preHandler；现已抽出统一的 `evaluateAutomationEntitlementForUser` 并接入接收事务、草稿确认和 permit。仍需真实 PostgreSQL nonce/绑定并发与撤销版本复跑，AC-1 不勾选。

> 🔴 上面这段的判定形状已被同日晚些的「部署模式二选一」定案**取代**：`evaluateAutomationEntitlementForUser` 不再把订阅与短期绑定当同一判定的两个来源，而是先按 `AUTOMATION_ENTITLEMENT_MODE` 选来源。留原句是为了让后来者看清它错在哪一次：把“两处都能放行”当成“统一了判定”，实际是把自托管的权益来源交回给本机的订阅行。

### 2026-10-09 权益判定定案：部署模式二选一 + 按操作一次性票据（阶段证据，仍不开放）

上一轮留下的三处会在真实链路上出事的形状已改掉，并补了两处此前没有任何一层在守的边界：

1. **一台实例只有一个权益来源**。新增严格读取的 `AUTOMATION_ENTITLEMENT_MODE`（只接受 `official` / `selfhost-online`，写错**报错**，未配置则自动收集不可用 —— 响的拒绝，不静默落到任何一边，与本仓库 `ENTITLEMENT_GATE_ENABLED` 同一条纪律）。`selfhost-online` 下 `evaluateAutomationEntitlementForUser` **不再读 `subscriptions`**：本机订阅行放行自动收集等于“在自己的库里给自己发货”。
2. **一枚票据只放行它那一个动作**。`action` 改成封闭词表（`session`/`rule-enable`/`sender-credential-issue`/`worker-register`/`event-claim`/`ai-reserve`/`result-publish`/`commit-permit`/`draft-confirm`），每个动作按词表要求带**恰好**它自己的 rule/event 作用域，矛盾组合在签发侧就签不出来；消费记录新增 `action/rule_id/event_id/installation_id` 列（迁移 `20261018170000_harden_automation_entitlement_ticket_scope`，未改任何已应用文件）。只有 `session` 写绑定行 —— 原来那张“30 秒内可放行任意次操作”的通行证不存在了。声明了 `action` 的闸门在自己的事务里消费票据（回滚不烧 nonce）；草稿确认与首次提交许可仍在**各自写事务内**消费，且草稿那侧去掉了 HTTP 层的重复判定（同一次请求烧两张票据是错的）。⚠️ **2026-10-09 T2 更正这一格**：上面那句"闸门在自己的事务里消费"当天是真的，但它把"业务写失败"和"票据被烧"绑在了一起 —— 现在闸门只做**离线预检**（一个字节都不写库），五个逐次放行动作（`worker-register`/`rule-enable`/`sender-credential-issue`/`event-claim`/`result-publish`）的消费挪进各自业务写事务、写在第一笔业务写之前；`ai-reserve` 是留在闸门事务里的唯一例外（原因见文末 T2 那节的边界表）。
3. **可信时钟只有一个来源，且在锁后读**。票据的时间判定不再接受调用方传入的绝对时间：账号锁之后读 `clock_timestamp()`，过期即拒；新增按**安装实例**记录的高水位表，时钟回拨后本机所有账号都停止获得新授权。`session` 建立绑定时的 `localAccountUuid` 仍来自客户端声明 —— 这一格是真的未闭合，见文末。
4. **恢复被替换掉的订阅行锁**。抽象成通用 reader 时，锁内那次订阅读退化成普通 `SELECT`；账号行的 `FOR UPDATE` 挡不住 `billing/webhook.routes.ts` 与 `activity/invite.ts` 对订阅行的写入（这两处都不取账号锁），于是“读到的权益快照”可以在提交前被撤销。现在锁内那次读显式 `... FROM subscriptions ... FOR SHARE`。
5. **生产路径不再为测试桩降级**：默认绑定读取里那句“模型不存在就当没有绑定”的可选链已删；判定用的 reader 换成具名类型（`AutomationEntitlementSource` / `EntitlementDatabase` 取 Prisma 生成类型），不再出现 `any`。受影响的两份测试改为**声明自己建模哪一种部署**（`automation-drafts.spec.ts` 与公网接收套件 = `official`），而不是让生产代码去迁就最小 double。

现量读数（本机一次性 PostgreSQL 14.18 + 真 HTTP，零 mock）：

| 判据 | 读数 |
|---|---|
| `tests/automation-entitlement-ticket.spec.ts`（改写后） | **20/20** |
| `tests/automation-drafts.spec.ts` | **19/19**（上一轮交下来时是 **9 红**：`Cannot read properties of undefined (reading 'findMany')`） |
| `tests/inbound-automation.routes.spec.ts` | **8/8** |
| `tests/{automation-events,automation-rules,automation-sender-credentials,automation-ai-metering,inbound-worker-identity,automation-commit-proof,entitlement-across}` 定向 7 文件 | **38/38** |
| `research/tools/verify-inbound-worker-identity.py`（真库集成，含新增自托管段） | **38/38**，其中新增 8 条自托管在线判据 |
| `pnpm --dir server exec tsc --noEmit` / `node scripts/check-migrations.mjs` | 通过（70 个迁移文件） |

真库那 38 条的输出与清单已入库：[逐条通过名](../research/evidence/inbound-automation-review/entitlement-selfhost-20261009-postgres.txt)（写盘前做过 64-hex/长 token 脱敏扫描，命中 0）与[源码摘要](../research/evidence/inbound-automation-review/entitlement-selfhost-20261009-manifest.json)（含被验文件 sha256、命令、变异臂清单）。归档时**不含**完整 SQL 参数与时间戳噪声，因此它不是可复跑的装置，只是那一趟的读数。

真库里拿到手的三类硬证据：同 nonce 并发两路 `verify` ⇒ **恰好一路 200、一路 403**，PostgreSQL 日志自己打出 `duplicate key ... automation_entitlement_ticket_uses_pkey`；`selfhost-online` 下即便订阅行写着 `grants: ['automation']`，公网接收仍回 **402** 且零事件落库；把订阅行的撤销提交排在许可请求的订阅读之后 ⇒ 请求**确实卡在 `FROM subscriptions` 的锁等待上**，撤销胜出、许可不落。

变异验证（每臂只打红它那一条，全部从 `.mut-bak` 还原后复跑为绿）：锁后新鲜度判定、票据 action/作用域逐字匹配、只有 `session` 写绑定、未配置模式必须拒绝、自托管不看本机订阅、实例时钟回拨停止授权、nonce 一次性消费 ⇒ 各红 1 条；摘掉 `FOR SHARE` ⇒ 红真库那条锁串行判据。**一条臂的教训已入档**：第一版“锁后新鲜度”变异写成 `if (false && A || B || C)`，`||` 把 B/C 留在判定里，测试仍全绿 —— 臂是假的；存活读数必须先确认变异真的进了产物。

仍然没闭合的（不包装成完成；⚠️ 2026-10-09 当天后续：**前两格已闭合** —— 签发端与 `officialSubject ↔ installation ↔ 本地账号` 握手、吊销版本在线刷新，判据与反向验证见文末「2026-10-09 T1 签发端与账号绑定握手」一节；其余各格仍未闭合，逐格状态以那一节为准）：官方签发端与 `officialSubject ↔ installation ↔ 本地账号` 的链接握手（现在没有 issuer，自托管这一档在真机上**拿不到票据**，因此也只能在测试签发者下取证）；吊销版本在线刷新；各宿主每 30 秒续票据与 `waiting-entitlement` UI；`X-Heyta-Entitlement-Ticket` 在 app-host 客户端侧还没有供给方；~~其余动作（领取/预留/发布/注册/启用规则/签发凭据）的一次性票据目前在 HTTP 闸门自己的事务里消费，不在业务写事务里~~ → ⚠️ **2026-10-09 T2 现量更正：这一格已闭合**，五个动作（领取/发布/注册/启用规则/签发凭据）的消费挪进业务写事务，闸门只做离线预检；**`ai-reserve` 仍留在闸门事务里**（唯一例外，理由与取证见文末「2026-10-09 T2：票据消费挪进业务写事务」）；故障窗口 11 只做了前半（撤销先赢），后半“许可先落盘、撤销后到”仍按既有许可语义取证。AC-1～AC-8 继续不勾选，公网接收与售卖继续关闭。

两条这一改动带来的**代价**，不是 bug，但下一轮必须按它们设计：① 声明了 `action` 的闸门在官方模式下也开始在事务里以 `FOR SHARE` 读订阅行，于是领取这类高频调用会与计费写入排队（量级取决于计费写入频率）；② “每动作一枚一次性票据 + 首版只支持在线核验”意味着设备每 20 秒一轮的 worker 循环要额外产生票据往返 —— 签发端与续票据节奏要和票据一起定，不能事后靠放宽票据复用次数来补。

一处已知的运维卫生缺口：`sync/cleanup.ts` 扫过期 nonce 行，但**不扫** `automation_entitlement_clocks`（只含安装 ID 与一个时间戳，不含账号数据，因此不在注销范围对账里）。要清它得先有一条“实例退役”的判据，本轮没有拍。

### 2026-10-09 分笔落地：每笔带走哪一层，以及界面层为什么不在里面

分笔不写 SHA（写进正文就开始漂）。现量：`git log --oneline --grep='自动收集' -8`。

| 笔 | 带走什么 |
|---|---|
| 契约与入站解析核 | `packages/inbound-core/`（新包）、`shared-schema` 的收件封装与草稿契约、上传契约里 commit proof 那条判据、`pnpm-lock.yaml` |
| 服务端 | 权益判定与票据（`entitlement.ts`、`automation/entitlement-ticket.ts`）、收件/规则/事件/worker/发送方凭据/提交证明、12 枚自动收集迁移 |
| 服务端判据 | 7 份新 spec + 2 份改（含真库 38 条与新增的自托管段）、`research/tools/verify-inbound-worker-identity.py` |
| 客户端接线 | `app-host` 的 worker 循环、收件密钥封装、草稿复核、Vault 包装凭据存储与其 9 份测试；`domain` 的本地时区判据；`sync-client` 的上传授权判据 |
| 文档 | 本计划、协议、复审、`pricing-and-entitlements.md` 的 `grants` 词表 |
| 证据 | 真库读数与自证清单（顺带解掉 `check:docs` 那条“本机有但没跟踪”） |

🔴 **界面层刻意没跟着走** —— `apps/web` 的自动收集设置面、`apps/mobile/src/inbound/`、`e2e` 那两份。理由不是没做完：它的中文词条住在 `packages/i18n/src/locales/{zh-CN,en}.ts`，而分笔那一刻那两枚文件**已经被并行会话 staged**（现量：`git diff --cached -- packages/i18n/src/locales/zh-CN.ts | grep -cE '^\+.*(自动收集|automation)'` 有数，`git diff` 同一判据为 **0** ⇒ 词条全在索引里，不在工作树差量里）。把它们从别人的索引里拆出来等于替别人决定提交边界；先落 i18n 的那一笔会把这些词条一起带走，归属用 `git log -S` 追，不打算别人的提交。⇒ 这一界闭合的判据很具体：HEAD 上 `pnpm --filter @heyta/web typecheck` 通过，且 `check:ui-language` 不报缺词条。

✅ **2026-10-09 16:5x 现量更正：上面那格挡路条件已经解除，界面层本轮就补。** 那两枚词条文件随后被并行会话提交进 HEAD，两侧都齐了：`pnpm --filter @heyta/i18n test` **26/26**（它就是"中英必须同步"那条纪律的判卷人），而界面用到的 72 个键在 web 类型检查里命中 0 条错（现量：`NO_COLOR=1 pnpm --filter @heyta/web typecheck 2>&1 | grep -E 'error TS' | grep -ic inbound` = **0**）。⚠️ 同一枚 typecheck 现在整体**是红的**，16 条错全在 `apps/web/tests/{share-key-store,app-mount}.spec.ts` 两枚别线文件里 —— 归属、形状与"为什么不代改"记在 `BLOCKED.md` B103，它挡的是 T7（`pnpm check` 整链），不挡界面层本身。上一段保留是为了让后来者认出这个形状：**"词条在别人索引里"是一种瞬时状态，把它写成判据时必须同时写解除它的现量命令**。

一条别读成“干净检出就能构建”的实测后果：HEAD 上现在有 **6 枚跨线 dangling relative import**（现量：对 `git ls-tree -r --name-only HEAD` 里 `packages/{shared-schema,app-host}/src/*.ts(x)` 与 `server/src/*.ts` 逐个解 `from './…'`，目标不在 HEAD 树里即计入）。其中 **1 枚属于本线**：`inbound-draft-contract.ts → ./task-batch-contract`（草稿契约复用了批量编辑线尚未提交的那份常量表）；其余 5 枚是并行会话提交了 `shared-schema/src/index.ts` 与 `app-host/src/inbound-process.ts`、却没提交对应契约文件留下的。这批分笔**修掉了原先两枚本线自己的** dangling（`server/src/server.ts → ./automation/inbound.routes`、`index.ts → ./inbound-crypto-contract`）—— 前几轮“api 接线先留在工作树”造成的就是这一种形状：**抽取的收尾动作是把文件提交掉并让 HEAD 自洽，不是把更好的新版本留在工作树里**。

判据复跑边界：这批提交没有改动工作树任何一个字节（现量：`git diff --stat HEAD -- <这 86 枚路径>` 只剩 4 枚混合文件的差量，而那差量正是别人的 hunk），所以上一节那张读数表描述的还是同一批源码。把整套判据对着新 HEAD 重跑（`pnpm -r test`、完整 `pnpm check`、`pnpm reinstall:all` 四端重装）**仍然欠着** —— 起跑那一刻共享载体上有并行写入者且负载高，按 §8 第 9 条那格要在隔离副本上做，不能拿这趟的工作树读数冒充。

仍然没闭合的（不包装成完成；⚠️ 2026-10-09 当天后续：**前两格已闭合** —— 签发端与 `officialSubject ↔ installation ↔ 本地账号` 握手、吊销版本在线刷新，判据与反向验证见文末「2026-10-09 T1 签发端与账号绑定握手」一节；其余各格仍未闭合，逐格状态以那一节为准）：官方签发端与 `officialSubject ↔ installation ↔ 本地账号` 的链接握手（现在没有 issuer，自托管这一档在真机上**拿不到票据**，因此也只能在测试签发者下取证）；吊销版本在线刷新；各宿主每 30 秒续票据与 `waiting-entitlement` UI；`X-Heyta-Entitlement-Ticket` 在 app-host 客户端侧还没有供给方；~~其余动作（领取/预留/发布/注册/启用规则/签发凭据）的一次性票据目前在 HTTP 闸门自己的事务里消费，不在业务写事务里~~ → ⚠️ **2026-10-09 T2 现量更正：这一格已闭合**，五个动作（领取/发布/注册/启用规则/签发凭据）的消费挪进业务写事务，闸门只做离线预检；**`ai-reserve` 仍留在闸门事务里**（唯一例外，理由与取证见文末「2026-10-09 T2：票据消费挪进业务写事务」）；故障窗口 11 只做了前半（撤销先赢），后半“许可先落盘、撤销后到”仍按既有许可语义取证。AC-1～AC-8 继续不勾选，公网接收与售卖继续关闭。

两条这一改动带来的**代价**，不是 bug，但下一轮必须按它们设计：① 声明了 `action` 的闸门在官方模式下也开始在事务里以 `FOR SHARE` 读订阅行，于是领取这类高频调用会与计费写入排队（量级取决于计费写入频率）；② “每动作一枚一次性票据 + 首版只支持在线核验”意味着设备每 20 秒一轮的 worker 循环要额外产生票据往返 —— 签发端与续票据节奏要和票据一起定，不能事后靠放宽票据复用次数来补。

一处已知的运维卫生缺口：`sync/cleanup.ts` 扫过期 nonce 行，但**不扫** `automation_entitlement_clocks`（只含安装 ID 与一个时间戳，不含账号数据，因此不在注销范围对账里）。要清它得先有一条“实例退役”的判据，本轮没有拍。

### 2026-10-09 T1 签发端与账号绑定握手 + 吊销在线刷新（阶段证据，仍不开放）

三格缺口一起闭合：**签发端**（官方实例侧的 Ed25519 私钥只经 `AUTOMATION_OFFICIAL_PRIVATE_KEY` 注入，`server/src/automation/entitlement-issuer.ts`）、**绑定握手**、**吊销版本在线刷新**。判定内核（`entitlement-ticket.ts` 的验签 / 作用域 / nonce / 时钟）**一行没改** —— 这是任务书里那句「猜错代价：改签发端与一枚迁移，判定内核不动」兑现的地方。

裁决（自决，理由写在这里）：

- **活码与兑换都发生在官方实例**：协议 §4 那句「首次绑定需要官方账号登录授权和本地账号认证」里的「官方账号」只能是官方实例上的账号，所以 `POST …/activations` 与 `…/activations/redeem` 都要求官方实例的 JWT。兑换成功后写 `automation_entitlement_links` 并**删掉**那张活码行；自托管那一侧的绑定不变量仍是 `SUBJECT_CONFLICT`（一枚主体顶不掉别人在同一台实例上的绑定，换主体必须先撤销）。
- **`session` 票据的三个绑定字段一律取自 `links` 行**，请求体不参与任何一个 —— 这就是「现在 `localAccountUuid` 仍由客户端自报」那一格被消掉的方式：客户端仍然提交一个本地账号 UUID，但它只在**兑换活码**那一次进入服务端记录，之后每次签票由服务端读回。
- **活码存 SHA-256 且域分隔**（`heyta-automation-activation-v1.`），明文只出现在它那一次签发响应里（`Cache-Control: no-store`）；主键 `(userId, installationId)` ⇒ 一台实例最多一张活码，重发有节流与次数上限。
- **吊销下限 = max(环境变量手配的那一个, 库里在线刷新的那一个)**，合并单调只升。公开清单 `GET /automation/entitlement/revocations` 由官方实例签（域 `heyta-automation-revocation-v1.`，寿命 ≤24h），自托管实例经 `POST …/revocations/refresh` 转述，**验签只用本部署配置的公钥环** —— 换一把钥伪造的清单进不来。抬下限本身要管理员（`requireAdmin`），而 `refresh` 只要登录：恰恰在绑定被吊销或过期之后才需要它。

判据（6 条单元 + 5 条真库集成，都带反向验证）：

| 判据 | 载体 | 反向验证 |
|---|---|---|
| 主体稳定且只生成一次；活码明文只出一次、库里只有哈希（`JSON.stringify(row)` 不含码） | `server/tests/automation-entitlement-issuer.spec.ts` | 摘掉「码只存哈希」⇒ 该条红 |
| 错实例兑换被拒且**不消耗**码（给它的那台仍可兑换） | 同上 + 集成段 | 摘掉 `installationId` 校验 ⇒ 该条红 |
| 错主体 ⇒ `LINK_CONFLICT`；换主体必须先撤销 | 同上 + 集成段 | 摘掉主体比对 ⇒ 该条红 |
| `session` 票据三字段 == 库里绑定行；自报另一个本地账号 ⇒ `LOCAL_ACCOUNT_MISMATCH` | 集成段（真 PostgreSQL 14.18） | 把签票改成读请求体 ⇒ 该条红 |
| 清单验签只认本部署公钥环（换钥伪造 / 篡改 / 无 keyring 各一道）；`bump` 只升不降 | 单元段 | 摘掉 keyring 参数 ⇒ 该条红 |
| 吊销落后一条：下限从 4 抬到 9 之后，旧票据、已存在的短期绑定、以及**逐次放行的 action 闸门**三处同时转拒 | 集成段（`PUT /automation/recipient-key` 200→402；`POST /automation/events/claim` 的 `ticketCode` 从 `SUBJECT_CONFLICT` 变 `REVOCATION_STALE`） | 臂 5 摘掉闸门 action 分支的下限读 ⇒ 恰好 1 红；臂 6 摘掉无 action 分支的下限读 ⇒ 恰好 1 红 |

🔴 臂 5 抓出的是**真缺陷，不是测试写法**：把在线刷新写进库之后，HTTP 闸门自己那条判定链**从没读过它** —— `createEntitlementGuard` 组装的 `source` 只有 `readSubscriptions` + `readBinding`，所以「抬下限」当时只挡住了 `/verify` 那一处显式核验，`recipient-key` 与逐次票据照旧放行。这一格是靠「把判据写成三处、而不是只写一处」抓出来的。

现量读数（这台机器，一次性真实 PostgreSQL + 真 HTTP + 真 Ed25519，零 mock）：`python3 research/tools/verify-inbound-worker-identity.py` → **`Tests 43 passed (43)`**（本线原有 38 条 + 这一段 5 条），`npx tsc --noEmit -p tsconfig.json` 0 错，闸门三个消费方文件 40/40。⚠️ **边界**：还原两处变异之后又跑了一次装置，那趟被本机测试内存闸门拒了启动（`立即可用 185MB < 这一档要求的 384MB`，浏览器那趟 pid=90222 已跑 40 分钟）⇒ 43/43 对应的是 `cmp` 逐字相同的那一份源码，但**合并态的整仓重跑仍欠着**，记在 `BLOCKED.md`。

仍未闭合（不包装成完成）：宿主每 30 秒续票据 + `waiting-entitlement` 展示、`X-Heyta-Entitlement-Ticket` 在 app-host 侧的供给方、~~票据消费挪进业务写事务~~（✅ 2026-10-09 T2 已闭合，见下一节）、`automation_entitlement_clocks` 的退役清扫（上一条那句还成立）、事件级计量、界面层、对外说明。AC-1～AC-8 继续不勾选，公网接收与售卖继续关闭。

### 2026-10-09 T2：票据消费从闸门事务挪进业务写事务（阶段证据，仍不开放）

上一条那句「其余动作在 HTTP 闸门自己的事务里消费」已经作废。现在一次自托管操作走两步：

1. **闸门只做离线预检**（`precheckOnly: true`）：验签、验作用域、验吊销下限与过期 —— 纯密码学与算术，**不开事务、不写库**，所以预检本身失败或被中断都不会烧掉 nonce。
2. **业务写事务内消费**：`authorizeAutomationWrite` 在账号行 `FOR UPDATE` 之后、**第一笔不可逆业务写之前** redeem 票据并落 `automation_entitlement_ticket_uses`。业务失败 ⇒ 事务回滚 ⇒ 消费记录一起回滚 ⇒ **同一枚票据仍可再用**（它自己的 30 秒寿命就是重试窗口）。

逐格落点（哪些在写事务里烧、哪些仍由闸门烧）：

| 动作 | 现在消费在哪 | 挡住它的那笔不可逆写 |
|---|---|---|
| `worker-register` | 业务写事务 | `automationWorker.updateMany`（吊销同键旧 worker） |
| `sender-credential-issue` | 业务写事务 | `automationSenderCredential.updateMany`（吊销同 keyId 旧凭据） |
| `rule-enable` | 业务写事务 | `automationRule.update` |
| `event-claim` | 业务写事务 | `status: 'leased'` 那一笔（递增 generation = 发活） |
| `result-publish` | 业务写事务 | `automationEvent.update` |
| `draft-confirm` / `commit-permit` | 各自写事务（本轮之前就是） | —— |
| `ai-reserve` | ⚠️ **仍由闸门消费** | `ai-metering.ts` 走位置参数的 `SqlRunner` 端口，接不住 Prisma 形状的那次 redeem；这条边界已在 `server/src/api.ts` 的路由上注明 |
| `session` | 建立绑定那一步 | —— |

`event-claim` 这一路有个**故意不对称**，值得单独记：领取路径上 `expired` / `needs-confirmation` / `cancelled` 三笔终态写排在授权**之前**，不受权益支配。它们只减不增（抹掉到保留期的密文、把结果不明的转成待确认、把规则已停用的转成取消），不给这台 worker 任何新工作，多数还是保留义务的产物 —— 让权益决定「做不做合规动作」是错的；而空轮询一次都不该烧 nonce。这条理由在判据里是**反向钉住**的：把授权提到事务开头就会红。

顺手抓到并修掉的一格真缺陷（我自己 T1 留的）：自托管模式配了却**没配公钥环**时，原来的 `configuredAutomationKeyring()` 抛一个裸 `Error` 出 preHandler ⇒ HTTP **500**。客户端把 500 读成「服务端坏了，重试」，而正确语义是「这台实例没连上签发方，停止重试」⇒ 两处调用点（闸门与 `authorizeAutomationOperation`）都改成返回 `ISSUER_NOT_CONFIGURED` 判拒，走 `replyAutomationRejection` 出 **402**；那个会抛的辅助函数已删。

现量读数（本机真实 PostgreSQL + 真 HTTP，零 mock；还原变异之后复跑）：

| 判据 | 读数 |
|---|---|
| `tests/inbound-entitlement-write-tx.spec.ts`（新写，落点形状） | **10/10** |
| 同文连同 `automation-entitlement-ticket` / `-issuer` / `inbound-worker-identity` / `automation-sender-credentials` / `automation-rules` 六文件 | **Tests 51 passed (51)**，rc=0 |
| `tests/integration/inbound-worker-identity.integration.spec.ts`（真库，含本段两条） | **Tests 45 passed (45)**，`REAL_RC=0`（`--config vitest.integration.config.ts --maxWorkers=1`，一次性库 `heyta_inbound_wtx_20261009`） |
| `npx tsc --noEmit`（server） | rc=0 |

反向验证（两臂，各自只打红它那一条，都从 `.mut-bak` 用 `cp` + `cmp` 还原）：

- **臂 1**｜把 `sender-credentials` 那条路由的 `precheckOnly: true` 摘掉（= 消费退回闸门）⇒ 真库那条「写事务回滚不烧 nonce：同一枚票据在业务恢复后仍能用，且只用一次」转红，形状是 `expected 402 to be 409`——第一次请求就把 nonce 烧了，所以业务恢复后重放拿到的是「票据已用过」而不是「加密配置缺失」。**恰好 1 红 / 44 绿**。
- **臂 2**｜把 `issueSenderCredential` 里的授权移到 `automationSenderCredential.updateMany` **之后**（吊销已落，票据还没验）⇒ 形状那条 `expected 797 to be less than 619` 转红，**恰好 1 红 / 9 绿**。⚠️ 这一臂**真库那套打不红**：吊销与后续失败仍在同一事务里，回滚把两者一起抹掉，所以数据库层面看不出差别 —— 挡得住这个改法的只有落点判据。**这就是它必须存在的理由**，也是第一版把标记写成 `.create` 时臂 2 存活的原因（`.create` 在吊销之后，把授权塞进两者中间照样「在 `.create` 之前」）⇒ 标记换成第一笔**不可逆**写，判据才有牙。

第一条臂的教训同样入档：本段的臂 2 第一次是**假臂**（改动把授权塞回原位，跑不跑都绿），当时又被本机测试内存闸门（`立即可用 266MB < 这一档要求的 384MB`）挡住而没暴露 —— 存活读数之前必须先确认「变异真的进了产物」，做法是 `sed -n` 把改动后的那几行打出来看一眼。

T2 剩下未闭合的（不包装成完成）：宿主侧每 30 秒续票据与 `X-Heyta-Entitlement-Ticket` 的供给方（app-host 里还没有生产者）、`waiting-entitlement` 展示、`automation_entitlement_clocks` 的实例退役清扫（落点 `server/src/sync/cleanup.ts` **在本线白名单之外** ⇒ 只登记接线需求，不代改）。AC-1～AC-8 继续不勾选，公网接收与售卖继续关闭。

### 2026-10-10 T2 续：逐次动作的取票通道（服务端这一半闭合，客户端仍欠）

上一节末尾那句「app-host 里还没有生产者」当时是**整条链的实情**，也是一格真缺陷：闸门改成「这五个动作各要一枚自己的票据」之后，签发端只有 `session` 一条通道 —— 自托管实例取不到逐次票据，只能永久停在「等权益」。本节补的是**服务端那一半**。

新增两件事，都不改判定内核：

| 落点 | 内容 |
|---|---|
| `server/src/automation/entitlement-issuer.ts` | `signAutomationEntitlementActionTicket`：作用域取自判定核那份封闭词表 `AUTOMATION_ENTITLEMENT_SCOPES`，缺 id / 多 id / 串台三种写法各拒一次；`session` 明确**不走这条**（它是唯一能建/续绑定的动作，混用等于发一张 30 秒通用通行证）；三个绑定 claims 全部取自 `links` 行，请求体一个字不参与 |
| `server/src/api.ts` | `POST /automation/entitlement/ticket`：需登录、`Cache-Control: no-store`、限流 60/分；请求体形状**逐字抄判定核**（`ruleId` 是 UUID、`eventId` 那条 128 上限的正则、`strict`）—— 形状宽一分，请求就能过路由再在 `claimsSchema.parse` 里抛 `ZodError`，把 403 变成 500 |

🔴 **「这条票据归谁」判在哪一侧，是这一格里最容易写错的东西**：官方实例只回答「这个主体能不能在这个 `ruleId`/`eventId` 上做这一个动作」，**不校验该规则或事件是否真属于那个本地账号** —— 客户实例的库是端到端加密的，官方侧看不到也不该看。所以作用域归属由客户端在消费那一步判，本线在代码注释与协议文档里都写明了这条边界，避免后来者把它读成漏写。

限流那个数不是拍的：worker 默认 30 s 一跳（`inbound-worker-loop.ts` 的 `intervalMs ?? 30_000`）⇒ 稳态 ≤ 2 跳/分，一跳最多 5 枚（领取、预留、发布、提交许可、草稿确认）⇒ 合法上限 10 枚/分，60 是 6 倍余量，同时把「无限制索取 Ed25519 签名」这条路堵掉。

现量读数（还原两臂之后复跑，两条腿都是零 mock）：

| 判据 | 读数 |
|---|---|
| `tests/automation-entitlement-issuer.spec.ts`（含本节新增 5 条） | **Tests 17 passed (17)**，rc=0 |
| 本线八文件合跑（单元那一条腿） | **Test Files 8 passed (8) / Tests 83 passed (83)** |
| `tests/integration/inbound-worker-identity.integration.spec.ts`（真库 + 真 HTTP，含本节新增 1 条） | **Tests 46 passed (46)**，`PY_RC=0`（`python3 research/tools/verify-inbound-worker-identity.py`，一次性库 `heyta_inbound`） |
| `npx tsc --noEmit`（server） | rc=0 |

反向验证两臂（都先 `sed -n` 证明变异进了产物，再从 `/tmp/entitlement-issuer.ts.mut-bak` 用 `cp` + `cmp` 还原，还原后逐字一致）：

- **臂 1**｜摘掉 `input.action === 'session'` 那半个条件 ⇒ 「session 不许走取票通道」**恰好 1 红 / 16 绿**。
- **臂 2**｜把 event 那一半作用域判成永远通过 ⇒ 「作用域与动作不符一律不签」**恰好 1 红 / 16 绿**。

⚠️ **本节顺手暴露的一件仓库级事实（记进 `BLOCKED.md` **B107**，构建配置那一半不在本线修）**：`server/tsconfig.json` 第 12 行的 `include` 只有 `src/**/*` 与 `scripts/**/*`，**测试文件不参与任何类型检查** —— 本节的集成测试两次写出 `installationId` 简写引用（那个作用域里的常量叫 `installation`），`tsc` 全绿而只有真库腿报 `ReferenceError`。

把尺拓到临时配置上量过一次（`extends` 真 tsconfig、include 多加 `tests/**/*`）：全仓 **224 条**类型错，其中**本线那两枚文件占 4 条，已经修完**（一枚不存在的类型名从 `entitlement-issuer` 改成从 `entitlement-ticket` 导入、替身库的 `row` 加了显式标注、集成测试里那枚可空列 `payloadCiphertext` 在使用前钉成字符串）⇒ 同一把尺下本线 4→0、全仓 224→220，`tsc --noEmit` 仍 rc=0，两文件单测腿 `Tests 37 passed (37)`。剩下那 200 多条是别人那条线的，**把 `tests/**` 正式纳入类型检查会让 `pnpm check` 一次亮 220 片红**，那是全仓判卷口径，不代拍 —— 两条候选修法与本线建议都在 B107。

仍未闭合（不包装成完成）：~~每 30 秒续 `session`~~（✅ 2026-10-10 机制与判据已落，见文末「T2 那半格：`session` 心跳的消费者」；**宿主真的 start 它**那一格仍等 B109）、`waiting-entitlement` 展示、`automation_entitlement_clocks` 的退役清扫（见 B106）。~~app-host 侧的取票生产者与 `X-Heyta-Entitlement-Ticket` 逐次附着~~ —— 这半在 2026-10-10 分两段闭合：取票生产者与四个闸门动作的逐次附着已于 `a9ca6464` 落地，草稿确认那一枚票与安装身份的持久化于同日 `70f1dcd0` 落地（判据见下一节）。🔴 但**宿主真的开始取票**这一格被一道新量出的前置挡住：票只在 `official` 实例签得出，且签票要求这台安装已有绑定行，而客户端既没有签发方 URL 也没有绑定握手的调用方 —— 三条候选修法与各自代价登记在 **B109**，本线不代拍（它连着一次新的出境）。AC-1～AC-8 继续不勾选，公网接收与售卖继续关闭。

## 宿主侧这一段的两格读数（2026-10-10）

`70f1dcd0`（点名列回 `6 files changed, 188 insertions(+), 8 deletions(-)`）落了与部署模式无关的那两格，并且**故意没落**第三格：

1. **草稿确认自己那一枚票**。`createInboundDraftReviewer` 原先一张票都不取，而服务端 `decideAutomationDraft`
   把 `draft-confirm` 的授权放在账号锁之后、业务写事务之内（`server/src/automation/events.ts:124`）——
   宿主一接上取票链，这一路必然被拒。取消**不取票**：那条明确允许无订阅进行
   （同文 118-121 行的注释），给取消取票只是多一次注定被拒的签发往返。`decideDraft` 因此多一个
   可选的票据作用域参数，取票仍排在 `try` 之外（票据源的错不许被"任何异常都算传输失败"吞掉）。
2. **安装身份的落盘**（`packages/app-host/src/inbound-installation-store.ts`）。三条语义各自有一条判据：
   只写一次（换身份＝换一台设备，旧 worker 会被 `databaseEpoch` 一起作废）、坏值不覆盖
   （按空处理会把一次数据损坏读成"换了新设备"）、退出登录不清（它标识安装、不标识账号，也不是秘密）。
   它住在 app-host 而不是各壳：`apps/web` 与 `apps/node-host` 拿同一个 `DbAdapter` 端口就能共用，
   这是 AGENTS §3.5 那条"接线只有一份"的同一件事。
3. **没落的那格**＝web 的取票接线。现量理由与三条候选修法在 **B109**；接线代码本身与它的判据形状
   都已备好（照 `tests/inbound-entitlement-tickets.spec.ts` 那批扩），拍定后是一笔小改。

判据读数（都是当日现量，别抄数）：`ls tests/inbound-*.spec.ts | xargs npx --no-install vitest run --no-color`
⇒ `Test Files 12 passed (12) / Tests 91 passed (91)`；`npx --no-install tsc --noEmit -p tsconfig.spec.json` rc=0。
反向验证 4 臂各红一次后逐字还原（身份可被覆盖／坏值按空处理／确认不带票／取消也去取票），
臂的写法与还原判据逐字照 `PROGRESS.md` 当日那节，四臂的失败条数分别是 1/1/2/1。

## T4（P1-4）这一段：没发出去的那次要退额度，托管额度与自动收集要能逐事件对账（2026-10-10）

P1-4 要求的是"按事件/解析版本/尝试标识归属的持久账本 + 冻结已取得的解析结果 + 能逐事件对账"。
账本的**形状**早就立着了（迁移 `20261018090000_add_automation_ai_attempts` /
`20261018110000_separate_direct_automation_ai_attempts` / `20261018150000_allow_local_automation_ai_attempts`
+ 复合主键 `(userId, ruleId, eventId, parseVersion, attempt)`，`billing_source` 与 `period_anchor`
的空/非空由库的 CHECK 绑死）。本轮量出来的是两处**语义**缺口，不是缺表：

| 缺口 | 机制 | 改之前的后果 |
|---|---|---|
| 预留了但没发出去的那次 | `reserved → released` 不退 `ai_usage_counters` | 用户在一次根本没打到供应商的尝试上付费，重试还要再扣一次 |
| 没有对账读路径 | 计数器只有 `(user_id, period_anchor)`，不带事件维度 | "额度少了一次"这种账没人能判是不是自动收集造成的 |

**退款挂在哪儿**：`advanceAutomationAiAttempt` 的 CAS 命中那一侧（`server/src/automation/ai-metering.ts:135`
判 `refundable`、174 行减一），**不是**另加一枚"已退过"标志位 —— 状态转移那条 `UPDATE … WHERE state = $6`
本身只可能命中一次，退款与它同事务，后半段炸了就一起回滚（这条有专门的用例）。
`sent → released` 与任何 `→ unknown` **不退**：前者供应商侧真的产生了一次物理调用，后者不知道发生没发生，
两种选择都有一种是错的，而不退是"少给用户白送一次"的那一种。重试是新 `attempt`、重新预留、重新扣 ——
这是刻意的：一次物理调用一次额度，而账本里那两行分得开。

**对账的口径边界比函数本身重要**：`ai_usage_counters` 是**账号级**的，人工托管对话与自动收集共用同一行，
而人工侧刻意不留逐请求记录（ADR-0054 §2 那张表只有四列）。所以 `reconcileAutomationAiMetering`
（同文 226 行）只有一个方向能算缺陷：

| 读数 | 判定 |
|---|---|
| `counterRequests < chargedAttempts` | 计不回来 ⇒ `short`，缺陷 |
| `counterRequests > chargedAttempts` | 多出来的可能是人工用量，原样披露成 `unexplainedByAutomation`，**不判成缺陷** |

把后者也判成缺陷，等于宣称"这个账号除了自动收集不该用托管 AI"，那不是这段代码知道的事，更不是对外承诺过的话。

**判据读数**（当日现量）：`cd server && npx --no-install tsc --noEmit -p tsconfig.json` ⇒ rc=0；
`npx --no-install vitest run tests/automation-ai-metering.spec.ts tests/automation-ai-metering.pglite.spec.ts`
⇒ `Test Files 2 passed (2) / Tests 16 passed (16)`。新那 12 条跑在真 PGlite 上，DDL 从**发布中的迁移文件**
按后缀推导目录读（锚点缺失就抛，不静默建半张表）。四臂反向验证（逐臂还原后源码哈希 `432e423772f9a5a0`、复跑 12/12）：
拿掉退款 ⇒ 3 红；去掉 `requests > 0` 守卫 ⇒ 1 红；让 `sent → released` 也退 ⇒ 1 红；把人工用量当缺陷 ⇒ 2 红。

**「冻结已取得的解析结果」这一格本轮才逐条现量**（此前只写在计划里，没量过）：

- 宿主侧 `packages/app-host/src/inbound-process.ts:92` 先读冻结回执，读到才有 `recovered`；94 行那个三元
  让 claim 只在**没有**冻结结果时发生，于是 129 行不给 `transport`，157 行的 `if (transport)` 跳过整个解析与预留
  —— 恢复路径上一次模型调用都不发。这是"提交失败不得重新解析计费"的机制本体，不是一句注释。
- 恢复出的密文要逐字段对上服务端那张回执（同文 121-126：`eventId/ruleId/ruleVersion/parseVersion/digest/itemCount`
  外加对任务列表重算一次摘要），任一项不符抛 `Recovered automation result does not match its server receipt`。
- 服务端侧 `server/src/automation/events.ts:296-300`：同一事件重发结果只在
  `(parseVersion, digest, ciphertext, itemCount)` 全等时幂等成功，否则 `Automation result conflicts with frozen result`。
- 钉住它的是既有断言 `packages/app-host/tests/inbound-process.spec.ts:124` —— 断言的是**请求路径序列**逐字等于
  `[recover, commit-permit]`，序列里多一次 claim 就多一次解析与预留，当场红。
- 本轮补的反向验证：把 `inbound-process.ts:94` 的 `recovered === undefined` 改成恒真（= 恢复路径也去 claim、也重跑解析）
  ⇒ `Tests 5 failed | 9 passed (14)`；从 `.mut-bak` 还原后哈希 `ded53859a863242c` 与改前逐字相同，复跑 `Tests 14 passed (14)`。

**仍未闭合（不包装成完成）**：

1. `reconcileAutomationAiMetering` **没有消费者**：管理后台那条路（`server/src/admin/*`）不在本线白名单，
   所以这轮只落函数与它的真库判据，不落路由、不落界面。登记 **B113**。
2. `unknown` 到底退不退是**对外承诺**而不是代码判断。现在的"不退"是保守的一侧；要改成按供应商回执二次判定，
   得让托管代理那层留一条可核对的调用凭据 —— 与 ADR-0054 §2 那张四列表直接冲突，属于判据口径，不代拍。登记 **B114**。
3. 跨周期的口径只在**读侧与退款侧同一行**成立：退款 `WHERE user_id AND period_anchor` 取的是那枚尝试行
   自己记的锚，所以"上一期预留、这一期释放"退的是上一期那一行（真库腿 256 行那条用例钉的就是这个形状）。
   售卖文案里那句"每周期 300 次"要不要说明它，归 T6。
4. P1-4 那句"原子绑定额度裁决与事件状态"只覆盖 `managed`；`local`/`direct` 的尝试账本**不占**任何额度
   （库的 CHECK 逼着它们 `period_anchor IS NULL`），这是设计而不是缺口。

AC-1～AC-8 继续不勾选，公网接收与售卖继续关闭。

### 2026-10-10 02:4x · T2 那半格：`session` 心跳终于有了消费者

T2 那句话里"每 30 秒续票据"这一格，此前是**一整套零件都在、唯独没人接**的形状：
`verifyAutomationEntitlementTicket`（客户端消费那一跳）有实现、有 2 条既有测试，**一个消费者都没有**；
服务端 `/api/automation/entitlement/session`（签票那一跳）在 app-host 侧**连客户端函数都不存在**。
也就是说公网接收读的那张绑定行，除了测试里手工写进去，真实宿主一次都不会去续。

绑定行的寿命就是票据的寿命（`server/src/automation/events.ts` 消费 `session` 时把 `expiresAt` 原样记成 claims 的值），
而票据窗口 ≤30 秒 ⇒ 宿主不续期，一次收信之后最多 30 秒，公网接收就**静默**变成"这台实例没有权益"。
这一格补的就是那个消费者：`packages/app-host/src/inbound-session-keepalive.ts`。

三件值得写下来的判定，都不是"看起来对"：

1. **排期看服务端的答复，不看墙上时钟。** 下一次续期时刻 = `expiresAt - 剩余寿命/3`（夹到 ≥1 秒，
   防一个极小窗口把心跳变成热循环）。用 `1/3` 这个**比例**而不是某个"我以为够"的毫秒数，因为它直接说出含义：
   一个窗口里最多还容得下两次失败续期。取绑定自己的到期时刻而不是硬编码 30 秒，与计量那层"周期边界已在库里、
   不要在服务端猜"是同一条理由 —— 签发侧哪天调窗口，这里跟着它的答复走。退避档位同样从寿命推
   （`寿命 × 2^(连败-1)`，上限 `30 × 寿命`；上限存在的唯一理由是"签发器不可达时别变成热循环"，它不是任何对外承诺的数字）。
2. **三族失败各有归宿，而 `error` 那一族会停住。** `waiting-entitlement`（这台实例此刻没资格：没绑定/签发方没配/
   票不在这台实例上）与 `retrying`（上一跳没落地）都**继续退避重试** —— 订阅到账后用户不必重开应用；
   而签发侧说"这个请求本身不对"（作用域不符、绑定冲突、给的寿命越界）判成 `error` 并**不再排下一次**：
   把 bug 说成订阅问题是说谎，对着签发器猛敲是二次伤害。这条区分是这一格里最容易写反的东西。
3. **票据正文只在那一次往返里活着。** 状态对象 `AutomationSessionState` 里没有 `ticket`、也没有 `localAccountUuid`，
   只有稳定码 `code`；它会被宿主原样放进界面状态、有时也进日志。消费那一跳的 `AutomationEntitlementVerifyError`
   只带稳定码，**不回显响应里的自由文本 `error`** —— 服务端那句文案将来怎么改都不会把绑定细节带进宿主日志。

机制细节：单飞（并发 `refresh()` 共用同一次往返与同一个结果）、世代作废（`stop()` 只加世代号、不等在途，
晚回来的结果读到不同号就整块丢弃并 reject 稳定码 `STOPPED`，既不写状态也不返回"看起来成功"）、
身份不合法（`installationId` / `localAccountUuid` 不是 UUID v4）在工厂构造时**当场抛且零请求**、
回调里抛错不许把心跳变成未处理 rejection。

现量读数（当日，零 mock）：

| 判据 | 读数 |
|---|---|
| `packages/app-host` `npx --no-install tsc --noEmit -p tsconfig.spec.json` | **rc=0，0 条错** |
| `vitest run tests/inbound-session-keepalive.spec.ts tests/inbound-entitlement-remote.spec.ts` | `Test Files 2 passed (2)` / `Tests 14 passed (14)`，跳过 0 |
| 本线 inbound 全族 `ls tests/inbound-*.spec.ts \| xargs vitest run` | `Test Files 13 passed (13)` / `Tests 103 passed (103)`（上一轮同尺 12/91 ⇒ 净 +1 文件 / +12 条，**没有一条变少**） |
| `npx tsup`（app-host 产物） | rc=0 |
| 入库 | `de18b73002f72f34c99df94a3b5fec63058ae6fc`，`点名枚数=4 实际变动=4`，`4 files changed, 491 insertions(+), 4 deletions(-)` |

反向验证四臂（逐臂从 `.mut-bak` 用 `cp`+`cmp` 还原，还原后源码哈希 `7678c7cc5a028ab1` 与改前逐字相同，复跑 `Tests 12 passed (12)`）：

| 臂 | 改法 | 红形 |
|---|---|---|
| A | 排期改成固定 20 秒（= 回到"拍墙上时钟"） | **恰好 1 红**（那条用例断言的是 30s 与 12s 两个窗口各自推出 20_000 / 8_000） |
| B | 去掉单飞（每次 `refresh()` 都新开一次往返） | **恰好 1 红**（并发调用只许 2 次 fetch） |
| C | 把 `retrying` 那族判成 `error` | **恰好 1 红**（临时拒之后还要排下一次） |
| D | 把票据正文塞进状态对象 | **2 红**（哨兵值不许出现在任何序列化里，且只能出现在 verify 那一跳） |

🔴 四臂里 **A 最有价值**：它证明"排期由服务端答复推导"这句话不是注释而是判据 —— 把 `1/3` 换成常数会红，
而常数恰好等于 20 秒时才不红，所以用例**同时**给了两个不同寿命的窗口（30s 与 12s），一个写死的数字守不住这两条。

`index.ts` 那一枚 export 走的是**切片**（相对 HEAD 只有 1 处差异：替换第 902 行那枚 export，+7/−1），
因为工作树里另有 **13 处不属于本笔的未提交差异**（B112 那四处接缝被别人正在写），一行都没被带走。
⚠️ 这一格是**第二次**手工切片，配方还住在一次性脚本里 ⇒ 第三次出现就该收进 `research/tools/` 一枚通用切片器（登记 B117）。

仍未闭合（不包装成完成）：**宿主真的 start 它**这一格等 B109（签发方 URL 从哪来 + 绑定握手的调用方在哪，
三条候选修法与各自代价都在那条），本线不代拍 —— 它连着一次新的出境；`waiting-entitlement` 的界面文案等 B110（词条地界）；
`automation_entitlement_clocks` 的退役清扫等 B106（落点 `server/src/sync/cleanup.ts` 在白名单外）。
⇒ 现在的诚实读数就是：**机制与判据已在 HEAD，消费者零个**。AC-1～AC-8 继续不勾选，公网接收与售卖继续关闭。

## 2026-10-10 03:1x · T8 逐条复审第一版：每条 AC 有没有一把能复跑的尺

这一节只回答一个问题：**AC-1～AC-8 的每一句，今天拿哪条命令能复核？拿不出来就写"无尺"**，
不许用"某包全量测试通过"顶替某一句。下面每一行都是本轮亲手跑的，命令照抄即可复跑。
**AC 一条都不勾**（现量在最后一格）。

### 当日尺与读数（下表 12 条测试命令：41 个测试文件 / 418 条 / 跳过 0）

合计不是手加的，是把每份日志里 vitest 自己打的 `Test Files n passed (n)` 与 `Tests n passed (n)`
两行逐份相加得到的（复算装置：`python3` 剥 ANSI 后按这两枚正则取数并累加，本轮读数 `命令数=12 files=41 tests=418`）。

| 尺（命令） | 读数 | 它量的是 AC 的哪一句 |
|---|---|---|
| `cd server && npx --no-install vitest run --maxWorkers=1 tests/automation-entitlement-ticket.spec.ts tests/automation-drafts.spec.ts tests/inbound-automation.routes.spec.ts tests/inbound-entitlement-write-tx.spec.ts tests/inbound-worker-identity.spec.ts tests/automation-entitlement-issuer.spec.ts tests/automation-commit-proof.spec.ts tests/automation-events.spec.ts tests/automation-rules.spec.ts tests/automation-sender-credentials.spec.ts tests/automation-ai-metering.spec.ts` | `Test Files 11 passed (11)` / `Tests 99 passed (99)` | AC-1 拒绝词表、AC-2 线协议、AC-3 许可与提交身份、AC-4 判定表 |
| `cd server && npx --no-install vitest run --maxWorkers=1 tests/entitlement.spec.ts tests/entitlement-gate.routes.spec.ts tests/entitlement-across.spec.ts` | `Test Files 3 passed (3)` / `Tests 56 passed (56)` | AC-1「**免费同步仍通过**」与权益并集（旧 gate 关掉不等于旁路） |
| `cd server && npx --no-install vitest run --maxWorkers=1 tests/automation-ai-metering.pglite.spec.ts` | `Tests 12 passed (12)` | AC-1「重试账目可对账」+ AC-4：真库（pglite）里退款 CAS 只退一次、逐周期分行、`unexplainedByAutomation` 单向口径 |
| `python3 research/tools/verify-inbound-worker-identity.py --log <路径>` | `Test Files 1 passed (1)` / `Tests 46 passed (46)`（临时 initdb 起的**真 PostgreSQL**，全部迁移逐条 apply） | AC-2 真 HTTP 字节级签名、AC-3 许可/回执/回滚、AC-1 票据一次性与吊销 |
| `cd packages/inbound-core && npx --no-install vitest run --maxWorkers=1` | `Test Files 3 passed (3)` / `Tests 47 passed (47)`（envelope 11 / parser 18 / webhook 18） | AC-2 签名与大小/时间窗边界、AC-4 字段裁剪与 DST、AC-2/3 envelope AAD |
| `cd packages/shared-schema && npx --no-install vitest run --maxWorkers=1 tests/task-batch-contract.spec.ts` | `Tests 15 passed (15)` | AC-5 严格批 payload 契约（未知字段、长度、重复 ID） |
| `cd packages/op-log && npx --no-install vitest run --maxWorkers=1 tests/task-batch.spec.ts` | `Tests 16 passed (16)` = 5 组 × **三套适配器**（memory / IndexedDbAdapter / SqliteAdapter，另有第 143 行真文件库 `state.db`） | AC-5「多项不同字段只产生一枚逻辑 op」「三套存储适配器与远端回放收敛」「中断重启无半批」 |
| `cd packages/app-host && npx --no-install vitest run --maxWorkers=1 tests/task-batch-actions.spec.ts` | `Tests 9 passed (9)` | AC-5 共享创建动作（唯一入口） |
| `cd packages/app-host && npx --no-install vitest run --maxWorkers=1 tests/inbound-*.spec.ts` | `Test Files 13 passed (13)` / `Tests 103 passed (103)` | AC-2/3 客户端领取-发布-许可循环、AC-4 收件密钥与草稿审阅、T2 心跳。🔴 其中 AC-4「实际出境请求符合披露」那一句**在这 103 条里原先没有尺**（只有一枚按禁字串写的 `not.toContain`），本轮补成闭合键集并做了两臂 —— 见下面「复审把自己一条看着有牙的判据照出来了」那一节 |
| `cd packages/domain && npx --no-install vitest run --maxWorkers=1 tests/inbound-local-date.spec.ts` | `Tests 1 passed (1)` | AC-4 date-only 与 instant 的领域语义 |
| `cd packages/sync-client && npx --no-install vitest run --maxWorkers=1 tests/inbound-authorization.spec.ts` | `Tests 6 passed (6)` | AC-3 上传授权接缝（引擎边界） |
| `cd apps/web && npx --no-install vitest run --maxWorkers=1 tests/inbound-draft-review.spec.tsx tests/inbound-event-retry.spec.tsx tests/inbound-upload-authorization.spec.ts tests/inbound-worker-lifecycle.spec.tsx` | `Test Files 4 passed (4)` / `Tests 8 passed (8)` | AC-6 界面层（jsdom，非真浏览器） |
| `node scripts/check-migrations.mjs` | rc=0，72 个迁移文件、9 枚含 CONCURRENTLY | AC-2/3 的库层前置 |
| `node research/tools/license-inventory.mjs` | rc=0，白名单外已登记 **1**（`caniuse-lite` CC-BY-4.0，构建期数据包） | 「不新增依赖」 |
| `python3 research/tools/verify-inbound-api-slice.py --self-test` / `…-host-options-slice.py --self-test` | 各自 `臂数=3，全部成立=True`，**真 rc=0**（不经管道取） | 本线入库配据：切片切错会被抓住 |
| `grep -c '^- \[ \] \*\*AC-' docs/plans/inbound-automation.md` / `grep -c '^- \[x\] \*\*AC-' …` | **8 / 0** | 完成条件第 2 条 |

与任务书 0 那一格的差异只有一处，且方向是多的不是少的：`verify-inbound-worker-identity.py`
从写下的 38/38 变成 **46/46**（T1 的签发/绑定/吊销那几组用例进来了）。**测试数只许 ≥ 基线这一条成立。**

⚠️ 这一格记一条**取证过程**而不是结论：同一根尺本轮**第一跑是 rc=1**，红因是宿主侧并发档
（`内存闸门拒绝启动：轻量档已有 2 趟在跑（上限 2）`），占用者是**另一个仓库**的 vitest，
不是本仓的产品红；等它退出后第二跑才拿到 46/46。**把"第一跑红"写成产品失败会是假的**，
把"rc 取自管道尾巴"也同样是假的。

### 无尺的句子（这才是要负责人点头的东西 —— 它们不是"还没测"，是"现在没有任何命令能证明"）

| AC | 原句 | 现状 | 为什么做不了 |
|---|---|---|---|
| AC-3 | 「**两个独立真实宿主与独立数据库**跑通下方十个（现 13 个）故障注入窗口，观察任务数、op 数、回执与计量」 | **无尺**：`research/tools/` 里与本线有关的装置只有 `verify-inbound-worker-identity.py` 一枚，另两枚是入库切片器；跑 13 个窗口的双宿主装置**不存在** | 它跑在 app-host 的 `dist` 产物上，而 HEAD 仍被 B112 那四处白名单外接缝挡住（当日现量：`git show HEAD:` 查四枚成员命中 **0/0/0/0**，六枚文件仍 `M`）⇒ 现在写装置=在没有可编译的树上写 |
| AC-6 | 「用户**独立完成**"启用 → 测试发送 → 等待 → 打开/解锁 → 自动处理 → 查看结果"」 | **无尺**：真浏览器那份 `e2e/tests/inbound-automation.spec.ts` 只有 2 条，且**它走的是 route 桩**（文件头自述 "Real browser/UI with HTTP fixtures; database authorization is tested separately"），量的是界面形状，不是这条旅程 | 旅程需要公网接收 + 有权益的宿主在跑，两者都关着；本轮**没有**复跑那 2 条，因为它会改写 `apps/web/evidence/inbound-recovery/` 那 16 枚**已跟踪**PNG，而该目录不在本线白名单 |
| AC-7 | 「官方与自托管样例分别**可运行**，端点与权限真实」 | **无尺**（帮助中心/中英条款的落点也在白名单外，B118） | 半尺有：`docs/reference/` 那两份当日已按 HEAD 更正过措辞（协议 + 定价） |
| AC-8 | 「平台 × 权益 × 设备状态 × 失败阶段的具体用例表」 | ⚠️ **本行已被文末「2026-10-10 05:2x · AC-8 用例矩阵」一节取代**（当日现量：矩阵已落成 34 行、逐格带尺或带归属，`python3 research/tools/verify-inbound-ac8-matrix.py` rc=0）。原先写的"**无产物**：矩阵文件不存在"在 10-10 05:0x 之前是真的，留着是为了让人认出"表格类交付物最容易糊过去的是它自己" | 剩余的那半仍然过不去：`pnpm check` / `-r test` / `reinstall:all` 三条在隔离副本上仍红（同 B112），矩阵里 C30~C34 五格因此记无尺 |

⇒ **逐格结论**：AC-1 / AC-2 / AC-4 / AC-5 的句子基本有尺；AC-3 有服务端半尺、缺双宿主半尺；
AC-6/AC-7/AC-8 各缺的不是工时而是**判据的载体**。
🔴 03:3x 复审后对本行**自己那格的更正**：AC-4 的「实际出境请求符合披露」原先写成"依赖 `AiFeature='inbound-automation'`
那半，仍在 B112 的未提交里" —— 那句话说的是"**这把尺在干净 HEAD 上编不出来**"（编译层），
它当时**根本没有尺**这件事我没写出来：唯一的落点是一枚按禁字串写的 `not.toContain`，
而那句承诺是封闭集合。现在它有闭合键集的尺了，B112 仍只挡"能不能在 HEAD 上跑"。两种读法不要混。
🔴 03:5x 复审再照出 **AC-2 那格里没写出来的另一半**：上面"AC-1 / AC-2 / AC-4 / AC-5 基本有尺"这句里，
AC-2 的「并发限额」「持久化失败不返回 accepted」「重放不重复占额度」三句当时**同样没有尺**
（队列上限两段判定在测试侧命中 0），已当场补上并做了六臂反向验证 —— 读数与装置见文末
「AC-2 接着对尺」那一节。同一轮还量出对外协议文档那 7 项上限里**三条在代码里根本没有落点**、
一条拦的不是它声称的那个维度，那句已改成逐标状态的表（不是"补测试"能解决的，是**说明写在了实现前面**）。

### 一把尺的反向验证：对外承诺里「授予」那一列**根本不在任何尺的分母里**

这是本轮新做的两枚反向验证之一（另一枚在下面那把表格尺的三臂），因为它挡的正是"坏了没人会知道"那一类：
`docs/reference/pricing-and-entitlements.md` §1 表格里 ¥12 那行的**授予列**写着
`hosting` + `ai` + `automation`，而同节下面那条 bullet 把 `grants` 讲成另一套话（两处都不写行号 —— 行号会随别人提交漂）
—— 两处会不会自己漂开？

| 臂 | 改法 | 结果 | 判读 |
|---|---|---|---|
| 盲区臂 | 只删 ¥12 大陆那行授予列里的 `+ \`automation\`` | `check:pricing` **rc=0**、`check:ai-quota` **rc=0** | 两把尺都**看不见**这句承诺 ⇒ 对外"这一档包含自动收集"这句话没有任何一层在守 |
| 阳性对照 | 只把 `ai-quota-ssot` JSON 块里的 `"quota": 300` 改成 `299` | `check:ai-quota` **rc=1**，逐条点名 5 处消费者（zh/en 词条、AI 服务条款、定价文档…） | 同一把尺**能红** ⇒ 上一行那个 rc=0 是"盲区"，不是"尺坏了" |

两臂之间与之后各还原一次：改前后 sha256 前缀 `05303dfe5088f029` 逐字相同，`git status --porcelain` 对该文件为空。
⇒ 修法要改的是**判据口径**（把 `grants` 那一列并进 `pricing-ssot` 的 JSON 块，让 `check:pricing` 对账），
所以它记成 **B121** 待裁决，不在本线自己动。

### 顺手把那枚"表格形状"的尺从手工配方收成常驻装置（B117 / B119 指的那第三次）

本线文档不在 `scripts/check-md-table-rows.mjs` 的 `FILES` 登记表里，而 `scripts/` 不在白名单 ⇒
前两次都是**临时改清单**跑一遍。这一次把它落成 `research/tools/verify-inbound-doc-tables.py`（白名单内的路径）：
它不重写判据，只在运行时把本线四份**并进**登记表，再带着三臂自测。

| 命令 | 当日读数 |
|---|---|
| `python3 research/tools/verify-inbound-doc-tables.py` | `清单 = 登记表 12 份 + 本线追加 4 份 = 16 份` / `✔ …16 个文件，列数、断行、"是不是表"与格内反引号配对都一致（第四类基线 3 行，只许减）` ⇒ 本线四份（含本轮新写的三张表）**形状干净** |
| `python3 research/tools/verify-inbound-doc-tables.py --self-test` | `ARM-3 路径不存在：rc=1（响亮地失败 OK）` / `ARM-1 表格少一格：rc=1（红 OK）` / `ARM-2 还原同一份：rc=0` / `臂数=3，全部成立=True`（真 rc 不经管道取） |

🔴 造它时踩到的那一格值得单独留一句，因为它是一种通用错法：**第一版把 `FILES` 整个替换成本线四份**，
于是判据报 `calendar-year-time-and-mobile-profile.md 反引号基线登记 3，现量 0`，而真尺同日 rc=0。
红因不是别线坏了，是**我的变体**让第四类基线找不到自己登记的那枚文件 —— 基线是按路径登记的，跟清单是一对绑死的。
⇒ 凡是"把某枚登记表换掉再跑"的做法，落笔前先问一句：**这张表还有谁在引用它？**（这里答案就写在那枚源码的注释里：只许追加。）

### 完成条件第 2 条那把尺：把"越界=0"从手工读数固化成 `verify-inbound-commit-scope.py`（B102 的替代量法）

任务书原文是「`git status --porcelain` 里非白名单路径的条目数与开工快照相同」。这一条在共享检出上量的**不是本线的动作**
（并行会话每时每刻在改自己的文件，那个数一定漂），B102 已登记。能真正回答"我有没有越界"的是**逐笔**对账：
每一笔提交实际带过哪些路径 —— 工作树可以被别人写成任何样子，**已提交的笔改不了**。

| 命令 | 当日读数 |
|---|---|
| `python3 research/tools/verify-inbound-commit-scope.py` | `窗口起 2026-10-09 16:52　本线笔数=34　涉及路径=43　越界=0`，rc=**0** |
| `python3 research/tools/verify-inbound-commit-scope.py --self-test` | `ARM-1 阳性对照：窗口内越界 3 枚，已知三枚全部命中（OK）` / `ARM-2 空分母：report() rc=1 ⇒ 拒绝（OK）` / `ARM-3 归属反查：计入的笔中含独占路径 16 笔（分母非空，OK）；动了独占路径却没被计入 = 0 ⇒ 0（OK）` / `臂数=3，全部成立=True`（臂数由它自己打印，本文件不抄第二份） |

两格值得留下，因为它们都是"这枚尺本来会永远绿"的方向：

| # | 我第一版写错的 | 现量把它照出来的 |
|---|---|---|
| 1 | 第二臂写成"窗口 `1995-01-01` 之后应当为空 ⇒ 拒绝" | 那个窗口枚举到 **41** 笔 —— 那是**整条历史**而不是空分母，臂的方向和它想防的事正相反。改成**调用真入口** `report('2099-01-01 00:00')` 并要求 rc=1：判据要在真代码路径上，不在自己重写一遍的地方 |
| 2 | 归属靠提交信息里的 `自动收集` 取，而本机 git user 对**所有并行会话同值** ⇒ 我自己某一笔若没带这个词，`越界=0` 就是漏分母的**假绿** | 窗口内共 **186** 笔、按词命中 **34**。反查第一版用"动了 `server/tests/` 或 `server/src/api.ts`"当判据 ⇒ 报出 **7** 笔没被计入；逐笔读 subject 确认它们是账号标准套件那条线的（`test(账号标准套件…)`、`test(server 会话撤销)…`），那些路径同样在**它们的**白名单里，**不该**算我越界。⇒ 共用路径不能当反查判据；换成只属于本线的独占路径清单（`packages/inbound-core/`、`docs/plans/inbound-automation.md`、`research/tools/verify-inbound-`…）后漏网 **0** 笔 |

第 2 格固化成第三臂，并且它自带**分母自检**：被计入的那些笔里必须**真的有**独占路径（当日 16 笔）——
否则"漏网=0"是空集给的，不是过滤器给的。这一臂的方向是保守的：若别的会话将来动到本线独占路径，它会**假红**而不是假绿。

🔴 边界，别读多：这枚尺证的是"**已入库那 34 笔**带过的路径全在白名单内"，它**不**证工作树现在的未提交内容没越界
（那本来就不是它的分母，也不可能是 —— 别人正在写的文件不歸我管）；也不证 AC 里任何一句功能断言。

### 复审把自己一条"看着有牙"的判据照出来了：AC-4「实际出境请求符合披露」原先只钉了"某个字符串没出去"

复审 AC-4 时逐枚读它对应的断言，`packages/app-host/tests/inbound-runner.spec.ts:39` 是这句承诺唯一的落点：

```ts
expect(requestBody.messages.at(-1).content).not.toContain('must-not-leave');
```

它量的是"**这一枚禁字串**没出现在出境正文里"。而对外说明写的是"只把规则允许的那几个字段交给模型"——
那是个**封闭集合**的承诺。两者不等宽：多发一枚**不含那个字符串**的未披露字段（最典型就是 `projectId`，
它坐在 `INBOUND_AUTOMATION_FIELDS` 里，读起来像"合法字段"，但由模型自己填就是越权选目标清单），
上面那行一个字都不会红。**"坏了没人会知道"正是这个形状。**

补法只加不断（既有的两行原样留着，用例条数不变）：把出境正文解析回来，对**键集合**做逐字相等判断。

| 臂 | 改法 | 结果 | 判读 |
|---|---|---|---|
| 基线 | 不加变异 | `Test Files 1 passed (1)` / `Tests 9 passed (9)`，rc=**0**；`tsc --noEmit -p tsconfig.spec.json` rc=**0** | 新断言在**当前实现**上成立 ⇒ 投影确实只送 allowlist |
| 盲区臂 | `packages/app-host/src/inbound-runner.ts` 里把 `source: projected` 改成 `source: { ...projected, projectId: 'undisclosed' }` | rc=**1**，`AssertionError: expected [ 'title', 'projectId' ] to deeply equal [ 'title' ]`，且 **`Tests 1 failed \| 8 passed`** —— 旧的 `not.toContain` 那一行**没红** | 同一枚越界写法，旧判据静默、新判据点名 ⇒ 上一行的 rc=0 是**盲区**不是"尺坏了" |
| 还原 | 从 `.mut-bak` 搬回（不走 git） | 改前/改后 sha256 前缀 `ab81e26b2f1a559a` **逐字相同**，该文件 porcelain 为空；复跑 rc=0 | 共享树里没留变异 |

判据一共钉四枚：外层键集 `{source, context}`、`source` 的键集逐字等于 allowlist（当日 `['title']`）、
`source` 的值逐字等于投影结果、`context` 的键集只有 `{receivedAt, timezone}`。

🔴 这一类不是只查了这一处（否定结论要枚举分母）。本线测试里全部 **9** 枚 `not.toContain`
（`packages/{app-host,sync-client}/tests/inbound-*.spec.ts` 与 `packages/inbound-core/tests/`）逐枚读过，
它们声称的是"**这一个具体值**（票据正文 / 回执 / 恢复码片段）不出现在错误信息与请求体里"，
按值判absence 就是正确形状，且有两处自带配对（`inbound-entitlement-tickets.spec.ts:88` 另判 `secret.slice(0, 12)`，
`inbound-draft-review.spec.ts` 那枚把"明文不进请求"和"明文必须在密文里"**两头各钉一次**）；
唯一把**集合**承诺写成 absence 的就是上面这一处。服务端 `ai-metering.pglite.spec.ts` 的保留承诺早就是
**集合相等**（那里注释写明"写成包含的话，加一列 `last_prompt` 照样全绿"）；
`managed-proxy.routes.spec.ts:657` 的 `toContain('messages')` 是对 `stream` 这一枚键的宽严配对，不声称集合，
属托管 AI 那条线的**窄承诺**，形状正确，不是缺陷 —— 所以这里**不**登记 B 号，只把"查过它"这件事留下。

⚠️ 与 B112 的关系要说准：B112 那四枚未提交成员挡的是"**这把尺在只含 HEAD 的干净检出上编不出 app-host**"
（编译层），它不改变"这句话现在**有**尺了"。上面三条读数取自**工作树**，与这一节其余尺同源。

### AC-2 接着对尺，量出两类"文档/代码各说一半"：队列上限有实现没尺，对外那 7 项里有 3 项根本没落点

沿 AC-4 那把尺的手法回到 AC-2 逐句读，第一枪就打在自己线上：
`server/src/automation/inbound.routes.ts` 的队列裁决（`MAX_QUEUE_EVENTS = 1_000` /
`MAX_QUEUE_BYTES = 64 MiB`，429 `QUEUE_EVENTS_LIMIT` / 413 `QUEUE_BYTES_LIMIT`）**代码在、判据零条** ——
改前的现量（钉在 `331f563c` 那一份上复跑，不写"HEAD"——本笔之后 HEAD 就含着新用例了）：
`git show 331f563c:server/tests/inbound-automation.routes.spec.ts | grep -c 'InboundQueueLimitError\|QUEUE_EVENTS_LIMIT\|QUEUE_BYTES_LIMIT'` = **0**。
也就是谁把 1_000 改成 1_000_000、或把那两个 `throw` 整段删掉，全套测试一声不响。
补了四把尺（阈值**从被约束的常量 import**，不抄数字；`prisma.$transaction` 调用次数当"额度事务"的代理量）：

| 句子 | 用例 | 边界怎么摆的 |
|---|---|---|
| 队列 1,000 条 | `accepts up to the queue event cap and refuses one past it without writing` | `MAX_QUEUE_EVENTS-1` ⇒ 202；`MAX_QUEUE_EVENTS` ⇒ 429 且 `create` 一次没调 |
| 队列 64 MiB | `counts the sealed envelope against the byte cap and the boundary is exclusive, not inclusive` | 用第一枚真信封的**密文长度**凑边界：`MAX-len` ⇒ 仍 202（源码是 `>` 不是 `>=`）、`MAX-len+1` ⇒ 413；另钉 `envelopeBytes > 明文长度` ⇒ 这一档算的确实是**含加密膨胀的密文** |
| 写失败不报 accepted | `does not report accepted when the enqueue write itself fails` | `create` 抛非 P2002 ⇒ 500，且响应体里 `queued` 出现 0 次 |
| 插入竞态 | `re-reads the winner on an insert race: same bytes return it, different bytes conflict` | 前置查找返 `null`、`create` 抛 P2002，赢家那枚 `dedupeDigest` 由**生产代码自己落的那一行**提供（测试不复制摘要算法）：同字节 ⇒ 202 原样回赢家状态、`create` 只多那两次失败尝试；异字节 ⇒ 409 |
| 重放不占额度 | 既有的 `returns the existing opaque state…` 里**只加不断** | 重放那一次 `prisma.$transaction` 调用次数**不增加**（额度裁决整个住在事务里，短路挪到事务之后就必红） |

读数：`cd server && npx --no-install vitest run --maxWorkers=1 tests/inbound-automation.routes.spec.ts`
⇒ `Test Files 1 passed (1)` / `Tests 12 passed (12)`，rc=**0**（该文件原基线 8 条，只增不减）。
同 11 份文件那一整片：`Test Files 11 passed (11)` / `Tests 103 passed (103)`，rc=**0**（原 99 ⇒ +4）。
`npx --no-install tsc -p tsconfig.json --noEmit`（src）rc=**0**；那枚 spec 单文件 tsc rc=**0**。

反向验证收成常驻装置 `research/tools/verify-inbound-queue-teeth.py`（六臂，含静止对照；
`--self-test` 是一枚失配负面对照）：

```text
全部臂　目标=server/src/automation/inbound.routes.ts　开局 sha256=97ef6d29273348e4　备份=/private/tmp/…
  队列条数上限: 成立　rc=1 命中用例=True
  队列字节上限: 成立　rc=1 命中用例=True
  写失败仍报 accepted: 成立　rc=1 命中用例=True
  插入竞态不重读赢家（直接漏 500）: 成立　rc=1 命中用例=True
  插入竞态不比内容（赢家照单收下）: 成立　rc=1 命中用例=True
  静止对照：注释改动不许让任何用例变红: 成立　rc=0 红=0（静止臂要求 rc=0 且 0 红）
臂数=6　不成立=0　末次 sha256=97ef6d29273348e4（须等于开局那枚）
```

`--self-test` rc=**0**：给一枚源码里不存在的模式，装置报 `PATTERN_MISS(命中 0 处，要求恰好 1 处)`
并非零退出 —— 否则将来裁决换了形状，这台装置会在"一臂都没变异成功"的状态下报绿。

第二枪打在**对外说明**上。`docs/reference/inbound-automation-protocol.md` 那句"技术防滥用上限"
是个封闭清单（7 项），逐枚去代码里找裁决点，量出三条没有落点、一条拦错了东西：

| 文档那 7 项 | 代码现量 |
|---|---|
| 原始 body 64 KiB | ✅ `INBOUND_MAX_REQUEST_BYTES`（`webhook.ts` 两查 + 路由 `bodyLimit`） |
| 队列 1,000 条 / 64 MiB | ✅ 本轮起有尺（上面那两把） |
| 每事件 ≤ 50 输出 | ✅ 规则配置与解析结果两侧都判 |
| 每规则每分钟 30 次 | ❌ **无落点**：`grep -rnE 'ruleRate\|perRule\|RATE_PER_RULE\|30 *[,/].*(min\|分钟)' server/src/automation/` 命中 **0** |
| 账号同时解析 2 个事件 | ❌ **无落点**：领取是 `LIMIT 1 FOR UPDATE SKIP LOCKED`（`events.ts` 一枚），只保证一次领一枚，不判账号在途并发 |
| 结果明文 ≤ 512 KiB | ❌ **无落点**：`grep -rnE '512 \* 1024\|MAX_RESULT\|RESULT_MAX_BYTES\|RESULT_BYTES' server/src/automation packages/inbound-core/src packages/app-host/src/inbound-*.ts` 命中 **0**；`packages/inbound-core/src/` 导出的上限常量逐枚数过（`webhook.ts` 那 4 枚 + `parser.ts` 的字段表），**没有**结果字节上限；`INBOUND_JSON_MAX_KEYS = 512` 是**键数**，不是 KiB |
| 账号每分钟 120 次 | ⚠️ 拦的**不是账号**：两条路由的 `rateLimit { max: 120 / 1 min }`，@fastify/rate-limit 默认按 `req.ip`、存**进程内存** ⇒ 与同一段那句"不能用每进程计数器"自相矛盾 |

顺带量出代码里有、清单里没有的三条（签名时间窗 300 s、JSON 深度 ≤ 8、键数 ≤ 512）。
改法按 AC-7 自己定的规则"未上线能力继续标规划中"：那一句改成**逐标状态的表**，
三条标"规划中"、120/分那格写明"名义有、拦的不是账号"，并把"加密膨胀计入队列字节数"挪到裁决点那一格。
要做成真正的账号级/共享存储级限流需要新增依赖，**不属本轮授权**，登记为 B122。


## 2026-10-10 04:2x · AC-1 那句「额度耗尽拒绝且不产生业务效果」补尺

这一格是 03:1x 那张复审表的**第三批翻案**（前两批是 AC-4 的出境键集、AC-2 的并发限额，见上面
「逐格结论」下面那两条 🔴）。03:1x 那句"AC-1 / AC-2 / AC-4 / AC-5 的句子基本有尺"对 AC-1 也只说对了一半：
AC-1 的拒绝词表里**「额度耗尽」这一枚在自动收集预留那一路没有任何一层在守**。四条分母（全部
`git show HEAD:` / `git grep … HEAD` 当场数，别对着工作树数——工作树里已经有本轮补的尺了）：

| 查的东西 | 命令 | 当日读数 |
|---|---|---|
| 有谁会走到自动收集预留那一步 | `git grep -l reserveAutomationAiAttempt HEAD -- server/tests` | **只有两份**：`automation-ai-metering.spec.ts`、`automation-ai-metering.pglite.spec.ts` |
| 这两份里有没有超额码 | `for f in …; do git show "HEAD:$f" \| grep -c QUOTA_EXCEEDED; done` | **0 / 0** |
| 单元档传没传限额 | `git show HEAD:server/tests/automation-ai-metering.spec.ts \| grep -n "reserveAutomationAiAttempt(key, 100, 3"` | 传了 `limit = 3`，**但**假事务里 `ai_usage_counters` 的 INSERT 分支恒回 `[{requests: 1}]`（同文件 17 行）⇒ 永远判 allowed，`!quota.allowed` 那支从来没被走到 |
| 真库档传没传限额 | `git show HEAD:server/tests/automation-ai-metering.pglite.spec.ts \| grep -c "NOW, undefined, executor"` | **14**（= 该档全部调用）—— 连"有限额"这个前提都没构造过 |

🔴 **本节第一版把这张表写歪了两次，当场被自己的复跑否证，留形**：① 第一版说"单元档 mock 了
`consumeManagedAiRequest`" —— `git show HEAD:` 里那两份档**根本没有这个名字**（它是假 SQL 分支，不是 mock）；
② 第一版说"真 HTTP 集成档里出现的拒绝码一个 `QUOTA` 都没有" —— `git grep -c QUOTA_EXCEEDED HEAD -- server/tests`
实际命中 **6 份档**（含 `integration/ai-metering-race`、`managed-proxy.routes`）。真相是：
**`QUOTA_EXCEEDED` 这个词有主、也有尺，只不过尺全在通用托管计量/代理那一路**，自动收集预留那一路当时
既没有类型化的拒绝、也没有码。"没有任何一层在守"这句要限定到**哪一路**才成立 —— 写成"这个词没人测"
就成了一句更大的假话。同样的错话一度还写进了 pglite spec 的文件头，已按这四行一起改掉。

### 修的是什么（不是补测试，是三条真缺陷）

1. **拒绝没有类型**。`ai-metering.ts` 里额度被拒时抛的是裸 `new Error('Managed AI request quota exceeded')`，
   而路由那个 `catch` 是"任何异常都算 409"。于是**额度耗尽对外报的是 409（可重试）**——宿主读成"这次传输失败了"，
   会退避重试直到这个用不完的周期结束，而界面只会一直显示报错。
2. **`used` / `limit` 到不了客户端**。那两个数是设置页那句"本月 300 次用完了"唯一的来源（额度 SSOT 是
   `docs/reference/pricing-and-entitlements.md` 的 `MANAGED_AI_REQUESTS_PER_PERIOD`，代码里不许再写一遍 300）。
3. **拒绝与"不产生业务效果"没有对账**。`automation_ai_attempts` 那一行如果先落再判额度，被拒的尝试会**留在账本里**，
   下一趟重放就被"已有行短路"当成已经预留过而放行 —— 用户没发生的物理调用被记了账。

改后：`AutomationAiMeteringDeniedError`（带 `{reason, used, limit}`）由 `server/src/entitlement.ts` 里
新加的 `replyAutomationMeteringRejection` 收口成 **402**，body 与权益闸门那一路逐字同形、只多 `used`/`limit`；
`api.ts` 的 `catch` 只对**这一个类型**发 402，其余异常**仍然** 409（反向那一半同样有断言：`limit ≤ 0` 抛
`RangeError`，如果它也变成 402 就是把"部署配错了"说成"你额度用完了"）。审计事件同形，多带两个数。
`QUOTA_EXCEEDED` **没有**并进 `EntitlementDenialReason` 那个封闭词表 —— 它由计量层判、不由权益闸门判，
且那个词表被 `packages/domain/src/subscription.ts` 的漂移守卫钉着（白名单外），所以按"新增 reason 单列"处理，
口径边界写进协议文档 §4。

### 补的三层尺与读数

| 尺 | 命令 | 当日读数 |
|---|---|---|
| 真库层（PGlite，DDL 从迁移文件读，不手抄） | `cd server && npx --no-install vitest run --maxWorkers=1 tests/automation-ai-metering.pglite.spec.ts` | `Tests 17 passed (17)`（原 12 + 新 5：超额拒且**数得出行数没多**、计数器不抬过上限、满额度时同键重放仍拿回原预留、`local`/`direct` 不被托管额度挡、退款腾出额度后被拒那枚能重预留且对账 `short:false`、`limit=0` 抛 `RangeError` 且**不是**这一族） |
| HTTP 收口层（真 `apiRoutes` 挂在裸 Fastify 上，`inject` 走一次真路由） | `cd server && npx --no-install vitest run --maxWorkers=1 tests/inbound-ai-quota-route.spec.ts` | `Tests 3 passed (3)`：超额 → **402** + `errorCode=SUBSCRIPTION_REQUIRED` + `reason=QUOTA_EXCEEDED` + `used:1` + `limit:MANAGED_AI_REQUESTS_PER_PERIOD` + **事务执行器一次都没被调**（= 没有业务效果）；DB 故障 → **409 且 body 里没有 `reason`**（不许被一并变成"停止重试"）；额度够 → 200 且事务执行器被调（正向对照，挡"永远 402"那种假绿） |
| 合起来复跑（含 T2 那格写事务消费） | `cd server && npx --no-install vitest run --maxWorkers=1 tests/automation-ai-metering.pglite.spec.ts tests/inbound-ai-quota-route.spec.ts tests/automation-ai-metering.spec.ts tests/inbound-entitlement-write-tx.spec.ts` | `Test Files 4 passed (4)` / `Tests 34 passed (34)`，**`RC=0`**（不经管道取；第一次取成 1 是我的 `${PIPESTATUS[0] [0]}` 在 zsh 里 bad substitution —— §7 #184 那一族的第五种面目） |
| 类型 | `cd server && npx --no-install tsc -p tsconfig.json --noEmit` → `TSC_RC=0`；两份 spec 另按 B123 手喂：`npx --no-install tsc --noEmit --strict --target ES2022 --module esnext --moduleResolution bundler …` → `TSC_SPEC_RC=0` | 手喂那一跑**当场照出真缺陷**：`app.register(apiRoutes, { prefix: '/api' })` 少传 `ApiRoutesOptions` 的**必填**项 `requireTermsConsent`（`src/api.ts:609`）。分母现量（`cd server`）： `grep -rn "register(apiRoutes" tests/ \| grep -vc requireTermsConsent` = **15 处调用省略**，分布在 6 份文件 （`password-auth-routes` 9/10、`api.routes` 2/2、`legal-recheck.routes`、`account-locale`、`email-locale-wire`、`registration-api` 各 1）—— 因为它们从来不在任何类型门禁里（B123）。🔴 本节第一版在这里写的是"8 份 spec 这么写"，那枚读数是 `grep … \| head` **截断后**的条数被当成了全集（本仓反复点名的那一类）；已按逐文件计数改掉。 新那份按线上形状显式给值并在文件头写明为什么补，**没有**去改别人那 15 处（它们会在新门下一起红，属别线的红）。 |

### 反向验证：把这六句裁决逐句摘掉

装置：`python3 research/tools/verify-inbound-quota-teeth.py`（照 `verify-inbound-queue-teeth.py` 的形状，
但它要动**两枚**文件：`ai-metering.ts`（计量层）与 `api.ts`（收口层），所以开局哈希、`.mut-bak`、还原核对都按文件各存一份。
`entitlement.ts` **只读不改** —— 402 的收口由第五臂在调用点摘掉就够了，同一条承诺动两处会让"哪一处是承重的"读不出来）。

```
全部臂　目标=2 枚：server/src/api.ts、server/src/automation/ai-metering.ts
  server/src/api.ts　开局 sha256=4e15ad3302b864c1
  server/src/automation/ai-metering.ts　开局 sha256=44855caf55534f65
  额度裁决整句摘掉（超额照单收下）: 成立　rc=1 命中用例=True
  拒绝时把 used/limit 抹成 0（界面说不出用了多少）: 成立　rc=1 命中用例=True
  类型化拒绝退化成普通 Error（路由认不出 ⇒ 402 变 409）: 成立　rc=1 命中用例=True
  已有行短路失效（同一枚重放二次收费）: 成立　rc=1 命中用例=True
  路由的 402 收口摘掉（终态被说成可重试）: 成立　rc=1 命中用例=True
  额度判定挪到 managed 分支之前（本机/自带端点也被拦）: 成立　rc=1 命中用例=True
  静止对照：注释改动不许让任何用例变红: 成立　rc=0 红=0（静止臂要求 rc=0 且 0 红）
  末次 sha256 server/src/api.ts = 4e15ad3302b864c1（须等于开局那枚）
  末次 sha256 server/src/automation/ai-metering.ts = 44855caf55534f65（须等于开局那枚）
臂数=7　不成立=0
```

`python3 research/tools/verify-inbound-quota-teeth.py --self-test` → `臂数=1　不成立=1` +
`SELF_TEST=OK`（模式在源码里不存在时报 `PATTERN_MISS` 并非零退出，且不落笔）。

🔴 两枚目标的**开局快照取的是工作树字节、不是 `git show HEAD:`**，因为 `api.ts` 此刻带着并行那条线
（注册 OTP / locale）未提交的 hunk；还原只从 `.mut-bak`，且还原前先核"当前字节 == 本臂写入的那份变异字节"，
不一致就说明窗口里有别的写入者 —— 那时先把意外字节另存到仓库外、再落回开局那份、并以 exit 3 报出三枚哈希，
**绝不静默覆盖别人的未提交改动**。上面那两行"末次 = 开局"就是这条保险丝今日成立的证据。

### 仍然没闭合的（不包装成完成）

- **界面拿 `used`/`limit` 出文案**那一格仍等 T5 与 B110/B109 —— 今天这两个数只在 HTTP 响应里，没有消费者。
- `ai-reserve` 的票据**仍在闸门事务里消费**（协议 §4 那句 ⚠️ 原样成立，本层没动它）。
- AC-1 整体**继续不勾选**：这一格补的是"额度耗尽"那一枚拒绝，免费/过期/错主体/错实例/坏签名那五枚的尺在 03:1x 那张表里，
  而宿主每 30 秒续票据的消费者那一格仍被 B109 挡着。

## 2026-10-10 04:5x · AC-1 票据那一半：拒绝码到线协议那一段原先没有任何一层在守

04:2x 那节补的是**额度**那一枚拒绝。接着对尺把**票据**那一半量了一遍，结论是：
每一枚拒绝码在单测层都有人判，但"判定结果怎么变成宿主收到的那几个字节"这一层是空的。

### 分母（每条命令都可复跑，读数取于本笔入库前）

| 尺（命令） | 读数 | 它说明什么 |
|---|---|---|
| `git grep -l ENTITLEMENT_TICKET_REJECTED HEAD -- server/tests` | **0 个文件** | 这一句 reason 从来没被任何测试断过 |
| `git grep -l ticketCode HEAD -- server/tests` | **1 个文件** | 唯一那处是 `tests/integration/inbound-worker-identity.integration.spec.ts`，整份被 `DATABASE_URL` 门控 ⇒ 默认 `pnpm -r test` 里一跑都不跑 |
| 逐枚数 `for c in AUTOMATION_TICKET_INVALID …; do grep -rl "$c" server/tests \| wc -l; done` | 九枚里 **8 枚 ≥ 1**，只有"组装那一层"是 0 | 拒绝**码**有人判、拒绝**形状**没人判 —— 缺的不是判定而是线协议 |
| `git grep -n "ENTITLEMENT_TICKET_REJECTED" HEAD -- server/src` | `entitlement.ts:127/468/774` | 产出点是**两个不同分支**：468 在闸门自己的事务里消费、774 在 `precheckOnly` 的离线预检里 |

### 落的尺：`server/tests/inbound-ticket-rejection-route.spec.ts`（15 条，不需要 `DATABASE_URL`）

判的四件事，各自对应一种真实伤害：

1. **终态必须是 402**：409 在宿主里读作"这次传输失败了"，于是 worker 会对一枚永远不可能变合法的
   票据退避重试；`ai-reserve` 那一路此前和租约故障共用一个"任何异常都算 409"的 `catch`。
2. **必须带 `ticketCode`**：只有 `reason` 时界面分不清"票过期（再取一枚就好）"与
   "主体冲突（要先重新绑定）"—— 前者该自愈、后者必须找人。
3. **拒绝不许烧掉 nonce**：除重放那一枚，其余每一枚都必须在写消费记录**之前**判掉；
   拒了还落消费记录 = 把下一枚合法票据的配额提前花掉（AC-1"不产生业务效果"在票据侧的反向）。
4. **响应与审计都不回显**票据正文 / `officialSubject` / `localAccountUuid` / `nonce`。

闸门那**两条分支各自都测**（`precheckOnly` 档用 `worker/register` 与 `rules/:ruleId/enabled`，
消费档用 `events/:eventId/ai-attempt/reserve`）—— 它们是两个分支共用一个响应装配，
只测一条的话另一条漏掉 `ticketCode` 也不会有任何东西失败。
`when` 那一半（关闭规则不要求付费）也钉了一条：不带票关规则不许变 402。

读数：`cd server && npx --no-install vitest run --maxWorkers=1 tests/inbound-ticket-rejection-route.spec.ts`
→ `Test Files 1 passed (1)` / `Tests 15 passed (15)`，`RC=0`；跳过 0。
邻档同跑（票据单测 / 签发端 / 写事务 / 额度路由 共 5 份）→ `Tests 65 passed (65)`，`BASE_RC=0`。
`npx --no-install tsc --noEmit --strict --target ES2022 --module esnext --moduleResolution bundler --skipLibCheck --esModuleInterop --types node,vitest/globals tests/inbound-ticket-rejection-route.spec.ts` → `TSC_SPEC_RC=0`。

### 八臂反向验证：`python3 research/tools/verify-inbound-ticket-teeth.py`

`臂数=8　不成立=0`，两枚目标末次 sha256 等于开局（`api.ts 4e15ad3302b864c1`、
`entitlement.ts c2e345026a924651` —— 逐字读数见装置输出），静止臂 `rc=0 红=0`。
七臂各摘掉一句能红的话：402→409、响应丢 `ticketCode`、预检分支丢上游码、消费分支丢上游码、
审计丢码、把票据正文写进响应、`when` 失效（关闭规则也要票）。
`--self-test` 两臂：模式不存在必须报 `PATTERN_MISS` 并非零退出；**并行写入保险丝必须真的会触发**。

### 三条当场改掉自己的错（写下来是为了让后来者认出形状）

1. 🔴 **那根保险丝上一笔就写坏了，而且是"永远不报"那种坏**：`restore()` 里
   `expected = sha256(path)` 与 `current = sha256(path)` 取的是**同一个文件的同一个哈希**再自比 ⇒
   恒等、永不触发，"别人在我变异窗口里写过 api.ts"这件事今天不会有人喊。
   改成 `apply()` 记下本臂写入那份字节的哈希、`restore()` 与它比。
   光修不证不行，所以补了 `--self-test` 的第二臂：改完字节后手动往文件里追加一行外来内容，
   这一臂要求 `restore` **必须**报 `RESTORE_GUARD` —— 判据自己也得能红。
2. 🔴 修完第一版又造出一处**假警报**：收尾那一遍 `finally` 会对每个目标再 `restore` 一次，
   此时 `mutated` 里还是上一臂的哈希，于是每次运行末尾都刷两行 `RESTORE_GUARD`，
   而真相是"文件已经是开局那份"。改成 `pop`（预期只用一次）。
   第二跑读数里那两行没了 —— 这条改动的证据就是它自己。
3. 🔴 第一版 spec 从服务端 import `MAX_TICKET_SECONDS`，而**那枚导出坐在别人一条未提交的 hunk 里**
   （`server/src/automation/entitlement-ticket.ts`，mtime 03:59，`PROGRESS.md`/`BLOCKED.md`/本台账都没提它，
   HEAD 里那一行还是 `const MAX_TICKET_SECONDS = 30`）⇒ 本档在干净 HEAD 上编不出来，
   而那正是上一笔刚记过的"工作树绿 ≠ 提交绿"。改成从 `@heyta/inbound-core` 的
   `AUTOMATION_ENTITLEMENT_MAX_TICKET_LIFETIME_MS` 自推（HEAD 已有），既不进别人的 hunk，
   也和宿主判的那个值是同一枚常量。

### 提交态现量（不是工作树态）

- 三枚提交路径 `git show HEAD:<路径> | shasum -a 256` 与工作树逐字节相同 ⇒ 上面那串绿读数描述的就是提交内容。
- 本笔**只含测试与验证装置**：`server/src/entitlement.ts` 在工作树里无未提交改动（`git status --porcelain` 对它返回空），
  它依赖的三处闸门注册在 HEAD 与工作树里逐字相同（`api.ts` 只有行号偏移 853/855、949/951、1195/1197）。
- 隔离副本复跑（`git worktree add --detach <仓库外> HEAD` + 只把 `node_modules` 符号链接回主检出）：
  `Test Files 1 passed (1) / Tests 15 passed (15)`，`WT_RC=0`；跑完 `git worktree remove --force`，`git worktree list` 里已无该路径。

### 仍然没闭合的（不包装成完成）

- `ai-reserve` 的票据**仍在闸门自己的事务里消费**（协议 §4 那句 ⚠️ 原样成立）—— 这一档验的是形状，
  没有替那一步"挪进业务写事务"作证。
- 绑定行、nonce 唯一约束、时钟高水位这三件**要靠真库**，仍只在被 `DATABASE_URL` 门控的集成档与
  `verify-inbound-worker-identity.py` 里；本档的数据库是一台按 SQL 文本回行的假机器。
- `ENTITLEMENT_TICKET_REQUIRED` 与 `ISSUER_NOT_CONFIGURED` 两枚**没有** `ticketCode`（本来就没有码可给），
  界面文案只能按 `reason` 分派 —— 这一格归 T5。
- AC-1 整体**继续不勾选**：现在"额度耗尽"和"票据六枚拒绝"两枚各有尺，免费/过期那两句与
  宿主每 30 秒续票据的消费者那一格仍分别被 B109/B116 挡着。

## 2026-10-10 05:2x · AC-8 用例矩阵：把「平台 × 权益 × 设备状态 × 失败阶段」落成一张能对账的表

AC-8 那一格此前的现状是**无产物**（复审表里唯一一处连尺都没有的：不是"还没测"，是连一张表都不存在）。
这一节把它补成产物，并把"补"的标准定成一件具体的事：**这张表必须能被一台装置逐格对账**，
否则它只是一份读起来像有证据的清单 —— 而矩阵最擅长的恰恰是装得像有证据：
引用的用例改了名、引用的文件被删了、维度名写漂了、无尺那格没人认领，四种都会安静地烂掉，
而 markdown 表格自己永远不会失败。

对账装置：`research/tools/verify-inbound-ac8-matrix.py`（六条规矩 R1..R6 写在它的文件头）。
🔴 **三张维值词表与 W1..W13 的判卷口径住在那枚装置里，不住在这一节** —— 加一维必须同时改两处，
改动在同一笔提交里看得见；这一节只放图例，避免同一个口径有两个家。
矩阵住在本文件而不是新开一份"验收矩阵"文档（AGENTS §8：不另建第二份计划）。

### 图例：失败阶段（切断点）

「无注入」这一档给**不是崩溃注入**的行用（平台维度与当前产物），它们照样要占一行 ——
否则"跨端"两个字就把没有尺的那几端隐掉了，而 AC-8 原句专门点了这一件事。

| 阶段 | 切断点（逐字抄自上面「AC-3 的十个故障注入窗口」那一节 + 新增三枚） |
|---|---|
| W1 | 队列已落盘、接收 HTTP 响应丢失；发送方以原键重试 |
| W2 | 已领取、解析前终止；租约到期后恢复/转派 |
| W3 | 模型已计量且可能完成、结果响应丢失；按规定的重试/unknown 策略处理 |
| W4 | 解析结果已冻结、提交前终止；接手方不得按新的"今天"或新模型重新解释 |
| W5 | 本地 op 已落盘、来源索引/回执未完成；同设备重启不再派发 |
| W6 | 本地 op 已落盘未上传、ACK 丢失，A 租约过期后 B 领取；最终不得两次创建，也不得偷偷降级成两个 op |
| W7 | A 持过期 lease 恢复、B 已获得新 generation；A 的续租、提交与 ACK 都按明确边界处理 |
| W8 | 暂停/删除规则、撤销凭据/设备、权益到期、撤回模型同意、Vault 锁定，分别发生在解析中与提交前 |
| W9 | 任务被用户编辑/删除、队列正文过期后上游重试；既不覆盖编辑，也不重建已删任务 |
| W10 | 第一台设备永久丢失、新设备加入、根密钥轮换；每个保留事件要么可解密恢复，要么有确定终态与可见原因 |
| W11 | 提交许可与暂停/撤销两种相反事务顺序 |
| W12 | 换 keyId 后同事件重试与旧钥查询 |
| W13 | date-only、start-only 在跨时区日/月/年/时间线的展示与编辑往返 |
| 无注入 | 正常路径与"装出来的必须是当前源码产物"那一格（T7） |

### 图例：三张维值词表

| 维度 | 取值（封闭的；判卷口径在装置里，这里只是给人读的图例） |
|---|---|
| 平台 | `server`（服务端，无宿主）· `node-host`（非 UI 宿主，真 SQLite）· `shared`（平台无关的共享层）· `web` · `android` · `ios` · `harmony` · `macos` · `windows` · `linux` |
| 权益 | `未订阅` · `付费有效` · `付费过期` · `错主体` · `错实例` · `坏签名` · `额度耗尽` · `未配密钥环` · `自托管带票` |
| 设备状态 | `未绑定` · `已绑定` · `Vault 锁定` · `后台` · `离线` · `进程已终止` · `新设备` · `密钥已轮换` · `时钟回拨` |

「尺」列只有两种写法：`无尺`，或 `路径::「用例名片段」` 的列表（多枚用 `；` 分隔）。
写路径时装置核两件事：**该路径在 HEAD 里被跟踪**（工作树里有不算，理由见 BLOCKED.md B127），
以及**那句用例名在 `git show HEAD:<路径>` 的字节里逐字命中**（文件在 ≠ 那句用例还在）。

### 矩阵

| 号 | 失败阶段 | 平台 | 权益 | 设备状态 | 判据（这一格要读出什么） | 尺 | 证据归属 |
|---|---|---|---|---|---|---|---|
| C1 | W1 接收响应丢失后同键重试 | server | 自托管带票 | 已绑定 | 同键同体重放返回同一条受理结果、同键异体判冲突；落库写失败那一路不许报 accepted | `server/tests/inbound-automation.routes.spec.ts::「returns the existing opaque state for an exact retry and conflicts on new bytes」；server/tests/inbound-automation.routes.spec.ts::「does not report accepted when the enqueue write itself fails」` | 本线，已入库（无外部服务依赖） |
| C2 | W1 受理前的权益判定 | server | 未订阅 | 已绑定 | 未授权不收信；免费同步仍通过且零查库；本机的订阅行不给自托管开闸 | `server/tests/inbound-automation.routes.spec.ts::「requires paid automation even with the default self-hosted gate disabled」；server/tests/entitlement-gate.routes.spec.ts::「passes a subscription-less user through, and never queries the database」；server/tests/integration/inbound-worker-identity.integration.spec.ts::「a local subscription row does not open the public receiver on a self-hosted instance」` | 本线；第三枚要真 PostgreSQL，跑法见下面「怎么跑」 |
| C3 | W1 陈旧签名与时间窗外 | server | 坏签名 | 已绑定 | 拒，而且**不碰账本** | `server/tests/inbound-automation.routes.spec.ts::「rejects a stale signature without touching the ledger」` | 本线，已入库 |
| C4 | W1 错实例 | server | 错实例 | 已绑定 | 给 A 发的激活码不能在 B 上兑换；票据签给别的 installationId 判拒且 nonce 不烧 | `server/tests/automation-entitlement-issuer.spec.ts::「错实例：给 A 发的码不能在 B 上兑换」；server/tests/inbound-ticket-rejection-route.spec.ts::「错实例：票据签给别的 installationId ⇒ 402 + TICKET_INVALID」` | 本线 T1 |
| C5 | W1 错主体 | server | 错主体 | 已绑定 | 绑定行主体与票据不符 ⇒ 402 + SUBJECT_CONFLICT；一台新码顶不掉别人的绑定 | `server/tests/inbound-ticket-rejection-route.spec.ts::「错主体：绑定行记的主体与票据不符 ⇒ 402 且 ticketCode 是 SUBJECT_CONFLICT」；server/tests/automation-entitlement-issuer.spec.ts::「错主体：这台实例已绑给别人的账号，一枚新码顶不掉」` | 本线 T1 |
| C6 | W1 没配公钥环 | server | 未配密钥环 | 已绑定 | 拒绝而不是退化成免费，也不是会被宿主重试一整期的 500 | `server/tests/automation-entitlement-ticket.spec.ts::「without an official keyring it refuses instead of falling back to free」；server/tests/inbound-entitlement-write-tx.spec.ts::「🔴 配了自托管模式却没配公钥环：闸门回 402 并停止重试，不是 500」` | 本线 |
| C7 | W1 未绑定账号出示票据 | server | 自托管带票 | 未绑定 | 绑定字段只取绑定行；未绑定与已撤销都不签；别人的本地账号不能在这里建立绑定 | `server/tests/automation-entitlement-issuer.spec.ts::「绑定字段取自绑定行而不是请求：换账号顶不掉，未绑定与已撤销都不签」；server/tests/integration/inbound-worker-identity.integration.spec.ts::「a ticket for another local account cannot establish the binding here」` | 本线 T1 |
| C8 | W1 托管额度耗尽 | server | 额度耗尽 | 已绑定 | 拒绝且不落账行、计数器不抬过上限；终态不许被说成可重试 | `server/tests/automation-ai-metering.pglite.spec.ts::「额度用尽时预留被拒，且既不落账行也不把计数器抬过上限」；server/tests/inbound-ai-quota-route.spec.ts::「额度用尽回 402 + QUOTA_EXCEEDED，把 used/limit 给宿主，且不写账行」；server/tests/inbound-ai-quota-route.spec.ts::「反向：数据库故障仍然回 409，不许被一并变成"停止重试"」` | 本线；有牙的反向验证在 `research/tools/verify-inbound-quota-teeth.py` |
| C9 | W2 已领取、解析前终止 | server | 付费有效 | 已绑定 | 代次抬升、停用规则拒领；结果发布按 owner 与 generation fencing | `server/tests/automation-events.spec.ts::「increments generation and refuses a disabled rule」；server/tests/automation-events.spec.ts::「fences result publication to the lease owner and generation」` | 本线 |
| C10 | W2 双宿主接手（真终止后另一台恢复/转派） | node-host | 付费有效 | 进程已终止 | 两台独立 SQLite + 独立库：任务数不双、op 数不双、回执与计量逐事件对得上 | 无尺 | 本线 T3：跑 13 枚窗口的双宿主装置**不存在**；前置 = B112 那四处白名单外接缝（HEAD 编不出 app-host 产物）+ B126 两枚类型红 |
| C11 | W3 模型已计量、结果响应丢失 | server、node-host | 付费有效 | 已绑定 | sent 租约过期后要对账而不是再买一次；供应商歧义失败不许悄悄发第二个端点 | `server/tests/integration/inbound-worker-identity.integration.spec.ts::「requires reconciliation instead of buying another attempt after a sent lease expires」；packages/app-host/tests/inbound-runner.spec.ts::「does not silently send to a second endpoint after an ambiguous provider failure」` | 本线 T4 |
| C12 | W3 逐事件计量对账 | server | 额度耗尽 | 已绑定 | 账行按 (规则, 事件, 解析版本, 尝试) 归属；净额与计数器的差分成 short 与 unexplained；重放不二次收费 | `server/tests/automation-ai-metering.pglite.spec.ts::「逐事件明细按 (规则, 事件, 解析版本, 尝试) 归属，状态与来源逐行可见」；server/tests/automation-ai-metering.pglite.spec.ts::「同一枚尝试的重放不因额度耗尽被拒（断链重试不能二次收费）」；server/tests/automation-ai-metering.pglite.spec.ts::「计数器多出来的手工托管用量不算缺陷，只披露成 unexplainedByAutomation」` | 本线 T4 |
| C13 | W4 结果已冻结、提交前终止 | server、node-host | 付费有效 | 已绑定 | 接手方不许把冻结的确认草稿重新解释成 prepared；旧 input 用当前 epoch 封回 | `server/tests/automation-events.spec.ts::「does not reinterpret a frozen confirmation draft as prepared on an idempotent publish」；packages/app-host/tests/inbound-runner.spec.ts::「decrypts old input, uses the provider secret, and seals the result to the current epoch」` | 服务端半本线已入库；"提交前终止"那一半要两台真宿主 ⇒ 同 C10 前置 |
| C14 | W5 本地 op 已落盘、回执未完成 | node-host | 付费有效 | 进程已终止 | journal-before-dispatch；派发失败留回执；精确重试只一次，填充过的请求缓存不能替 B 授权 | `packages/app-host/tests/inbound-worker.spec.ts::「journals before dispatch and leaves the receipt on dispatch failure」；server/tests/integration/inbound-worker-identity.integration.spec.ts::「repairs completion on an exact persisted retry outside the HTTP cache」；server/tests/integration/inbound-worker-identity.integration.spec.ts::「accepts owner and exact retry once, but the populated request cache cannot authorize B」` | 共享层与服务端有尺；"同设备重启不再派发"要真 SQLite 落盘 ⇒ T3 |
| C15 | W6 A 租约过期后 B 领取 | server、node-host | 付费有效 | 已绑定 | 不得两次创建、不得偷偷降级成两个 op；B 两枚 clientId 都自称 A 也不行 | `server/tests/integration/inbound-worker-identity.integration.spec.ts::「rejects B even when BOTH clientId claims are A, on both upload paths」；server/tests/integration/inbound-worker-identity.integration.spec.ts::「internal upload callers cannot bypass identity checks for an exact persisted duplicate」` | 半尺：身份边界在服务端有；两台各自落库的对账归 T3 |
| C16 | W7 A 持过期 lease、B 新 generation | server | 付费有效 | 已绑定 | 续租、提交、ACK 三处都按代次与保留边界拒 | `server/tests/automation-events.spec.ts::「fences result publication to the lease owner and generation」；server/tests/integration/inbound-worker-identity.integration.spec.ts::「fences model reservations and sends by current rule, attempt and retention」` | 本线 |
| C17 | W8 权益到期发生在解析中与提交前 | server、node-host | 付费过期 | 已绑定 | 到期在账号锁内复判；取消不受权益挡；许可读取期间的等待不丢精确重试 | `server/tests/automation-drafts.spec.ts::「rejects entitlement expiry at the locked transaction boundary」；server/tests/integration/inbound-worker-identity.integration.spec.ts::「rechecks entitlement after waiting for the account lock while preserving exact owner retries」；server/tests/automation-drafts.spec.ts::「allows cancellation without querying subscription and clears both bodies」` | 本线 |
| C18 | W8 撤销凭据与设备 | server | 付费有效 | 已绑定 | 撤销提交排在许可读取期间要串行化；被撤的托管凭据不许回退旧密钥环；缓存不许替被撤的 owner 放行 | `server/tests/integration/inbound-worker-identity.integration.spec.ts::「serializes a revocation that commits during the permit read, through the subscription row lock」；server/tests/inbound-automation.routes.spec.ts::「does not fall back to the legacy keyring after a managed credential is revoked」；server/tests/integration/inbound-worker-identity.integration.spec.ts::「rejects revoked owner before cached response」；server/tests/automation-sender-credentials.spec.ts::「revokes by account and credential identity only」` | 本线 |
| C19 | W8 Vault 锁定 | node-host | 付费有效 | Vault 锁定 | 锁定后开放审阅失效且不再发任何网络请求；清扫抹掉的密文不能被"等待中"的确认复活 | `packages/app-host/tests/inbound-draft-review.spec.ts::「invalidates an open review without making a subsequent network request」；server/tests/integration/inbound-worker-identity.integration.spec.ts::「cannot resurrect ciphertext cleared by a sweep while draft confirmation waits on the event row」；server/tests/integration/inbound-worker-identity.integration.spec.ts::「rechecks draft confirmation entitlement after an observed account lock wait while keeping cancellation usable」` | 共享层与服务端本线已入库；界面那格见 C29/C31 |
| C20 | W8 暂停/删除规则与字段策略 | server | 付费有效 | 已绑定 | 管理与关闭规则不要求付费；规则删除留墓碑并抹掉摘要与密文；字段策略是封闭的 | `server/tests/inbound-ticket-rejection-route.spec.ts::「关闭规则不带票也不许被权益挡住（"管理/关闭规则不要求付费"这一句在线层有尺）」；server/tests/automation-rules.spec.ts::「erases rule digests and ciphertext while retaining the rule tombstone」；server/tests/automation-rules.spec.ts::「persists a closed field policy and bounded output configuration」` | 本线；「撤回模型同意」那一半落在 ADR-0010 的出境闸门，其档不在本线白名单 |
| C21 | W8 后台与定时器 | node-host | 付费有效 | 后台 | 手动与定时唤醒串行、stop 之后所有触发被 fence；续期排在服务端报的到期之前、比例 = 剩余寿命三分之一 | `packages/app-host/tests/inbound-worker-loop.spec.ts::「serializes manual and timer wake-ups and fences all triggers after stop」；packages/app-host/tests/inbound-session-keepalive.spec.ts::「定时器真到点会再走一跳，且 token 每次重读（换令牌之后不会拿旧的敲）」；packages/app-host/tests/inbound-session-keepalive.spec.ts::「下一次排在服务端报的到期时刻之前，比例是剩余寿命的三分之一」` | 本线 T2；真后台（移动壳）见 C31 |
| C22 | W8 离线 | node-host | 付费有效 | 离线 | 凭据只在入站上传那一趟带、无关回执被过滤；等待族报 waiting-entitlement 而不是错误 | `packages/sync-client/tests/inbound-authorization.spec.ts::「sends credentials only on its inbound upload and filters unrelated receipts」；packages/app-host/tests/inbound-session-keepalive.spec.ts::「等待族（没绑定 / 签发方没配 / 不在这台实例上）报 waiting-entitlement 并按退避继续」` | 半尺：断网注入的载体在 e2e 那两份里，**未入库** ⇒ C29 |
| C23 | W9 用户编辑/删除后上游重试 | server、node-host | 付费有效 | 已绑定 | 既不覆盖编辑也不重建已删；队列正文过期即终态；预留与来源不符就拒 | `server/tests/integration/inbound-worker-identity.integration.spec.ts::「erases expired ciphertext without losing completion, and expires unprocessed drafts」；packages/app-host/tests/inbound-worker.spec.ts::「freezes source only at reserve and rejects a mismatched reservation」` | 半尺："用户已编辑那一条"要两台真宿主对账 ⇒ T3 |
| C24 | W10 设备丢失、新设备加入、根密钥轮换 | node-host | 付费有效 | 密钥已轮换、新设备 | 旧队列事件的密钥不丢；跨轮换重包裹 worker 令牌与收件密钥；换钥后旧验证钥仍认既有凭据 | `packages/app-host/tests/inbound-key-store.spec.ts::「upgrades legacy records without losing queued-event keys」；packages/app-host/tests/inbound-secret-store.spec.ts::「re-wraps worker token and recipient key across a Vault root rotation」；server/tests/automation-commit-proof.spec.ts::「rotation keeps old verification keys; removing one invalidates only its proofs」` | 共享层本线已入库；"新设备真装出来并读到那条事件"需实机 ⇒ C30/C34 |
| C25 | W11 提交许可与撤销的两种相反顺序 | server | 自托管带票 | 已绑定 | 票据在账号锁之后、第一笔不可逆写之前消费；业务回滚不烧 nonce；闸门只预检不开事务；只减不增的终态写排在授权之前 | `server/tests/inbound-entitlement-write-tx.spec.ts::「领取那一路：只减不增的终态写故意排在授权之前（保留义务不看权益）」；server/tests/integration/inbound-worker-identity.integration.spec.ts::「写事务回滚不烧 nonce：同一枚票据在业务恢复后仍能用，且只用一次」；server/tests/inbound-entitlement-write-tx.spec.ts::「闸门那一步即使带着合法票据也不开事务」` | 本线 T2；后半（许可先落盘、撤销后到）仍按既有许可语义取证 |
| C26 | W12 换 keyId 后同事件重试与旧钥查询 | server | 自托管带票 | 已绑定 | 换钥后旧钥仍能验既有提交凭据；吊销清单合并只升不降；重放那一枚撞唯一约束判 USED | `server/tests/automation-commit-proof.spec.ts::「rotation keeps old verification keys; removing one invalidates only its proofs」；server/tests/automation-entitlement-issuer.spec.ts::「吊销清单：验签只认本部署配置的公钥，合并只升不降」；server/tests/inbound-ticket-rejection-route.spec.ts::「重放：nonce 已存在 ⇒ 402 + TICKET_USED（这一枚确实要撞唯一约束）」` | 本线；票据那一半有八臂反向验证 `research/tools/verify-inbound-ticket-teeth.py` |
| C27 | W12 实例时钟回拨 | server | 自托管带票 | 时钟回拨 | 高水位高于库时钟即停止授权；消费侧被判过期/已用时报 retrying 而不是永久停住 | `server/tests/automation-entitlement-ticket.spec.ts::「stops authorizing when the installation clock rolls backwards」；server/tests/inbound-ticket-rejection-route.spec.ts::「时钟回拨：实例高水位高于数据库时钟 ⇒ 402 + CLOCK_ROLLBACK」；packages/app-host/tests/inbound-session-keepalive.spec.ts::「票据被自己的实例判过期/已用时报 retrying 而不是永久停住」` | 本线 T2；**实例退役清扫仍无尺**：`server/src` 里对 `automationEntitlementClock` 只有读与 upsert，零删除（现量 `grep -rn "automationEntitlementClock" server/src`） |
| C28 | W13 date-only 与 start-only 的领域语义 | shared | 付费有效 | 已绑定 | 规则日历日不随处理日/时区漂；无效日期仍可编辑，修正后冻结为 date-only 并按当前钥封装 | `packages/domain/tests/inbound-local-date.spec.ts::「keeps the rule calendar day for today, grouping, urgency and display」；packages/app-host/tests/inbound-draft-review.spec.ts::「keeps invalid dates editable, then freezes corrected date-only values and seals to the current key」` | 本线（共享层）；界面展示与编辑往返那一半见 C29 |
| C29 | W13 跨时区展示与编辑往返 | web | 付费有效 | 已绑定 | 亮暗、窄屏、中英三档下同一日期在列表/详情/编辑三处逐字一致 | 无尺 | 本线 T5：六枚落点此刻全是 `??`（未跟踪），且 HEAD 的 `apps/` 里代码层零接线（现量：`git status --porcelain -- apps/web/tests/`，以及 `git grep -l inbound HEAD -- apps/` 与 `git grep -l EntitlementTicket HEAD -- apps/` 各自只命中别线那两枚取证 JSON）。🔴 但**不等 B112**：逐枚解析相对导入后唯一缺口是它们互相引用，本组闭合（B128）⇒ 入库这一格本线自己能做，排在矩阵之后紧接着做 |
| C30 | 无注入 当前产物 | web、android、ios、macos、windows、linux | 付费有效 | 已绑定、新设备 | 装出来的必须是当前源码产物：四端清旧包 → 重打 → 重装，每端一条判据 | 无尺 | 本线 T7：`pnpm check` / `-r test` / `reinstall:all` 在隔离副本过不去（B112 四处外接缝 + B126 两枚类型红），需负责人 A/B/C 拍板 |
| C31 | 无注入 移动壳生命周期 | android、ios | 付费有效 | 后台、Vault 锁定 | 真机后台/锁屏后凭据仍在、票据续得上、恢复后不重复派发 | 无尺 | 本线 T5 + 设备腿：`apps/mobile/src/inbound/lifecycle.ts` 未入库 |
| C32 | 无注入 鸿蒙端 | harmony | 付费有效 | 后台 | 这一端有没有壳能承载自动收集 | 无尺 | 现状：`apps/mobile` 下没有鸿蒙工程（AGENTS §1 那张地图），构建链已通但缺模拟器镜像与签名 ⇒ 不在本轮可闭合集 |
| C33 | 无注入 桌面壳内入口 | macos、windows | 付费有效 | 已绑定 | 壳里那份共享 UI 有没有自动收集入口 | 无尺 | 本线 T5/T7：入口随 web 产物一起进包，web 那格没入库就没有 |
| C34 | 无注入 Linux 交付定位 | linux | 付费有效 | 已绑定 | 装出来的 `.deb` 里那份共享 UI 有没有这个入口，以及 Linux 在矩阵里算不算交付端 | 无尺 | 本线 T5/T7 + Linux 交付取证；定位单列在下面「Linux 那一格」，不许被"跨端"隐去 |

### Linux 那一格（AC-8 原句要求它单列）

Linux 同时是**一等开发载体**与**第五个交付端**（这个定位 2026-10-06 由产品负责人指令改掉，
不是"顺手也算一端"）。矩阵里它占 C30 与 C34 两格，两格都是**无尺**，理由不同一层：
C30 卡在打不出装得出来的产物（B112 / B126），C34 卡在**入口本身还没入库**（T5）。
🔴 这两句都不许被"跨端闭环已完成"这类话替掉 —— 仓里已经有一次"四端重装判据全绿但装的是旧树"
的先例（AGENTS §7 第 82 条），而 Linux 是那一族里最容易被子弹过去的一档：
它的 `.deb` 已进包并免 root 取过证，但**装进系统**那一格没做、也没有 Linux 桌面用户的证据。

### 怎么跑（三档，各自的依赖不一样）

| 档 | 命令 | 需要外部服务吗 |
|---|---|---|
| 服务端离线档（真库形状由 PGlite 承担） | `cd server && npx --no-install vitest run --maxWorkers=1 tests/inbound-automation.routes.spec.ts tests/automation-events.spec.ts tests/automation-drafts.spec.ts tests/automation-rules.spec.ts tests/automation-sender-credentials.spec.ts tests/automation-commit-proof.spec.ts tests/automation-entitlement-ticket.spec.ts tests/automation-entitlement-issuer.spec.ts tests/entitlement-gate.routes.spec.ts tests/inbound-entitlement-write-tx.spec.ts tests/inbound-ai-quota-route.spec.ts tests/inbound-ticket-rejection-route.spec.ts` | 不需要 |
| 真库计量档 | `cd server && npx --no-install vitest run --maxWorkers=1 tests/automation-ai-metering.pglite.spec.ts` | 不需要（WASM 版 Postgres 在进程内） |
| 真 HTTP + 真 PostgreSQL 档 | `python3 research/tools/verify-inbound-worker-identity.py`（自己起 loopback 临时库并跑那枚 integration 文件；结束停机清理） | 装置自带 |
| 共享层档 | `cd packages/app-host && npx --no-install vitest run --maxWorkers=1 tests/inbound-*.spec.ts`；`cd packages/domain && npx --no-install vitest run --maxWorkers=1 tests/inbound-local-date.spec.ts`；`cd packages/sync-client && npx --no-install vitest run --maxWorkers=1 tests/inbound-authorization.spec.ts` | 不需要 |
| 矩阵对账 | `python3 research/tools/verify-inbound-ac8-matrix.py` | 不需要 |

### 这台装置自己能不能红：六臂反向验证

`python3 research/tools/verify-inbound-ac8-matrix.py --self-test`（臂数由装置自己打印，本文件不抄第二份）。
每一臂都绑定它**声称的那条规矩号**，不是"随便哪条红" —— 第一版只要求 rc=1，于是"删 W13"那条臂的
红其实来自 R2 死值（那一行恰好是 `shared` 唯一的持有者），它测的并不是它说自己测的那件事；
绑号之后才看得出这条臂原本在测别的。当日读数（`SELF_RC=0`）：

```
臂 1 把尺的路径换成不存在的文件 ⇒ 该红: 成立　rc=1（要求 1）　命中 R4 的红=R4 …`server/tests/__no_such__.spec.ts` 在 HEAD 里没有被跟踪
臂 2 把尺的用例名换成源码里没有的文字 ⇒ 该红: 成立　rc=1（要求 1）　命中 R4 的红=R4 …没有逐字命中那句用例 ——「这句用例名在源码里不存在」
臂 3 删掉 W13 那 2 行 ⇒ 该红: 成立　rc=1（要求 1）　命中 R3 的红=R3 缺窗：W13 没有用例行
臂 4 把那格的证据归属掏成占位 ⇒ 该红: 成立　rc=1（要求 1）　命中 R5 的红=R5 …无尺格的证据归属是占位 `—`
臂 5 把平台写成词表外的散文值 ⇒ 该红: 成立　rc=1（要求 1）　命中 R2 的红=R2 …平台 值 `桌面端` 在封闭词表外
臂 6 静止对照：只改引言散文 ⇒ 必须保持绿: 成立　rc=0（要求 0）　红行数=0
SELF_TEST=OK（六臂各自成立：R4 两半能红、R3/R5/R2 能红、静止臂没跟着红）
```

### 当日读数（矩阵对账 + 它引用的尺今天跑不跑得过）

| 尺 | 当日读数 | 这一格说明什么 |
|---|---|---|
| `python3 research/tools/verify-inbound-ac8-matrix.py` | `读数 行数=34　有尺行=27　无尺行=7　尺枚=67　窗=13/13　平台=10/10　权益=9/9　设备状态=9/9` + `结论：矩阵与 HEAD 逐格对账成立`，**rc=0**（不经管道取） | 矩阵那 67 枚引用逐枚在 **HEAD 的字节**里命中；三张词表没有死值；十三个窗口逐枚有用例行；无尺的七格逐格有归属。那串数是装置自报的，要现量请重跑，别把这一格当"现在的数" |
| 服务端离线档（上面「怎么跑」第 1 行，12 份文件） | `Test Files 12 passed (12)` / `Tests 124 passed (124)`，RC=0 | 矩阵里 `server` 那批尺今天**跑得绿**，不只是文件在 |
| 真库计量档（PGlite） | `Tests 17 passed (17)`，RC=0 | 额度耗尽与逐事件对账那两格（C8/C12）的尺有活体 |
| `python3 research/tools/verify-inbound-worker-identity.py` | 真 PostgreSQL 14.18 起在 `127.0.0.1` 临时端口 → `Tests 46 passed (46)`，装置 rc=**0**，结束 `server stopped` 并自清 | 矩阵里 15 枚 integration 引用（C7/C11/C13~C19/C23/C25）的那份文件今天有活体；**基线那句 38/38 已被本轮之前的 46/46 取代，测试数只增未减** |
| 共享层档（app-host 7 份 + domain + sync-client） | `Test Files 7 passed (7)` / `Tests 55 passed (55)`；`Tests 1 passed (1)`；`Tests 6 passed (6)`，三档各自 RC=0 | C14/C19~C24/C28 引用的共享层尺有活体 |

🔴 **两种读法不许混**：矩阵的 R4 核的是「这句用例在 **HEAD** 的字节里逐字可寻」，
上面那批 rc=0 核的是「这把尺在**当前工作树**里跑得绿」。**它们不是同一件事**，
差的那一层就是 B112：`packages/app-host`、`packages/domain`、`packages/sync-client` 这三档
在干净 HEAD 上编不出来（四处白名单外接缝），所以那 62 条今天只在共享工作树里绿。
写矩阵时故意选"字节命中"而不是"能跑"作判据 —— 前者今天就能机械核，后者要等 B112 拍板。

### 未闭合的那几格（不包装成完成）

- 七个**无尺**格（C10、C29、C30~C34）不是"还没测"，是两种不同的缺：C10/C29 缺**载体**
  （双宿主装置不存在 / 界面层文件根本没入库），C30~C34 缺**当前产物**（T7 那三条过不去）。
- C27 里那句「实例退役清扫仍无尺」本轮新量出来的：`server/src` 里对 `automationEntitlementClock`
  只有 `findUnique`（读）与 `upsert`（写）两处，**零删除** —— 高水位行会随实例数永久累积。
  这一格仍归 T2，本轮没有顺手做（它要先把"退役"定义拍下来：绑定撤销？实例从密钥环消失？两者给出的保留集不同）。
- AC-8 整体**继续不勾选**：这张矩阵把"要哪些格、每格凭什么"说清了，但它的第二条证据
  （当前源码产物完成跨端安装/实机闭环）仍卡在 B112 与 B126。
