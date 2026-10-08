# 自动收集 v1 协议

> 状态：**技术基线；2026-10-08 已接线并测试公网接收切片，但完整生产接线与运行验收未完成。** 实施顺序、未完成项与证据由[唯一计划](../plans/inbound-automation.md)维护。复审依据见[第二轮审计](../research/inbound-automation-review.md)。本文规定完整契约；已接线切片不代表整体接口可对外使用。

## 1. 不变量与发布门槛

1. 一个受理事件最多获得一个提交身份，非空任务批只有一枚 op；空解析结果为 `no-items`，零 op。
2. 账号、设备来自认证上下文，规则由服务端创建；正文不可指定账号、操作工具、设备或改变清单授权。
3. 本地 app-host 构造业务 op；服务器只存加密队列与有限元数据，不生成任务内容或业务 op。
4. 普通 webhook 的 TLS 接收方能看到当次输入。输入和客户端冻结结果以 envelope 持久化；回执没有任务标题、备注、任务 ID 或明文错误详情。
5. 接收成功只在数据库事务完成后返回；本地已创建与已同步是不同事实。结果未知不当作未执行。
6. 未完成授权、密钥、运行时能力和隐私披露前，部署默认关闭；所有宿主可以继续使用原有本地功能和自托管同步。

## 2. 事件状态与提交身份（P1-1）

**身份前置：** 现有同步 clientId 来自请求正文，不能充当认证设备。按 [ADR-0059](../adr/0059-inbound-worker-authenticated-identity.md)新增账号 JWT + 独立随机 worker 凭据，owner 从服务端凭据映射取得，并绑定不可修改的 syncClientId/本地库 epoch。所有 `inbound:` op（包括普通 `/sync/ops` 的缓存/重复路径）都验证该凭据与许可。旧设备仅凭账号 JWT 或自报 clientId 不能取得提交权。同步保存/缓存前身份门禁、worker 注册/撤销、规则配置、回调接收、领取调度和提交许可签发的共享路径已落代码；各宿主生命周期接入与跨端故障验收仍待完成。

中心事件身份为账号级 `(account, sourceEventId)`，规则 ID 是其绑定作用域；来源 ID 必须是 1–64 字节 ASCII 字母/数字/冒号/下划线/连字符，以字母或数字起头，不接受缺失身份。请求签名 keyId 不参与去重。同键同原始 body 摘要和 Content-Type 返回原事件；不同内容返回 409 `EVENT_CONTENT_CONFLICT`。相同内容但不同来源 ID 是新意图，不作模糊内容去重。所有 ID 都有长度与字符边界，不将原始来源 ID 写运维日志。

| 状态 | 可执行动作 | 约束 |
|---|---|---|
| `queued` / `waiting-*` | 有权限设备领取 | 冻结规则版本、接收时刻、时区与输入摘要 |
| `leased` | 续租、解析、发布冻结结果、放弃 | 认证设备 + generation + 未到期 + 规则版本 CAS |
| `needs-confirmation` | 账号用户确认/取消 | 保存加密草稿；确认版本 CAS，不创建无日期任务占位 |
| `prepared` | 请求唯一提交许可 | 冻结结果已持久化；所有授权和本地清单校验通过 |
| `commit-authorized` | **原设备**派发或恢复同一身份 | 不再受租约转派；许可永久绑定 owner、event、解析版本、opId |
| `local-created` | 原设备同步、核实回执 | ACK 仅表示原设备报告本地写入；服务器不借 ACK 证明同步 |
| `commit-uncertain` | 原设备恢复 / 查同步证据 | 不授予第二个 owner，不重新解析或重新创建 |
| `completed` / `no-items` | 查询 | 完成需能核实原 op 的同步接收；空结果不消费业务 op |
| `failed` / `expired` / `cancelled` | 查询与说明 | 终态保留去重身份，不能通过重试恢复为 queued |

领取租约为 60 秒，心跳每 20 秒，解析超时 45 秒；generation 每次重新领取严格递增。领取、续租、结果发布和许可申请均在同一数据库事务中检查账号/规则/设备/权益与当前版本。过期的解析请求可记录模型账目，但其返回不得替换新 generation 的结果。

**线性化点是提交许可的原子落盘。** 许可前暂停、删除、撤销、过期胜出则拒绝授予；许可先落盘则这一意图已授权，后到的暂停不撤销它。UI 必须说明尚有已授权事件在途，不能承诺暂停后绝不会再出现结果。这不等于撤销后继续授予访问权：旧凭据/设备不能领取或访问新内容。

许可绑定的 `opId = inbound:<opaqueEventId>`，任务 ID 由该事件身份与冻结结果中的序号生成；不得因重试、换密钥或重启换 ID。本地 engine 的专用持久幂等入口负责串行判断与派发，已存在 op 时返回已执行；来源摘要不匹配拒绝。原 op 一旦落盘，其 clientId、向量时钟、时间戳和 payload 都不能再生成。服务端只在同一事务内看到 `prepared` 事件且规则/解析版本、结果摘要和条数全部一致时签发 permit。来源 receipt 在同一枚批 op 中，派生索引不参与真值判定；checkpoint、归档和远端完整状态保留恢复所需来源证据。

结果已发布但 worker 在 permit 请求前终止时，原认证 worker（或许可前允许接手的同账号认证设备）可读取仍处于 `prepared/needs-confirmation` 的结果 envelope；读取只返回密文和摘要/条数，不返回正文。解密后必须再次校验 source、digest 和条数，再走同一 permit/journal/dispatch 路径；权益过期不阻挡这项已冻结结果恢复，但不会因此放行新的解析或许可。

**许可后不自动转派。** A 本地已写而未上传，B 无法证明 A 没写，也不能以 B 的认证补传 A 的 op。A 永久丢失时保持 `commit-uncertain`；用户可取消后续等待记录，但这不证明原任务不存在，也不自动发起新建。需要补录时是明确的新用户意图，提示可能已有离线结果。这里选择最多一次执行，牺牲无条件接管的可用性，不承诺“精确一次必达”。

认证设备请求另带 `X-Heyta-Worker-Token`（32 随机字节的小写 hex）和 `X-Heyta-Database-Epoch`（1–128 ASCII 字母数字/下划线/连字符，字母数字起头）；保护头重复即拒绝。HTTP 入口只把凭据摘要和 JWT 已认证版本传入写事务。客户端不得把这些头随业务数据同步给其它设备；同步读侧不需要它们。tokenVersion 从已验证 JWT 取得，并在写事务持有账号锁时与数据库再次核对，不能使用请求正文里的版本。暂停或权益到期不撤销已经发出的提交意图，但设备/账号认证撤销仍会拒绝其上传。

**规则删除与迟到同步：** 按 [ADR-0061](../adr/0061-owner-held-inbound-commit-receipt.md)，许可返回时附服务端签名提交回执；原设备必须先在本地持久保存，再派发 op。回执只含实例/账号/worker/数据库 epoch/事件/条数，不含正文或摘要。删除规则会保留事件身份和已签发许可；即使后续清理许可，原设备也可通过上传信封的 `inboundCommitProofs` 继续证明同一提交身份；仍须有效 JWT 和未撤销 worker。回执不随 op 同步给别人。缺回执或授权被拒保持待上传，不使用会永久丢弃待上传资格的校验错误码。独立部署签名密钥的轮换必须保留旧验证键。

## 3. 批创建（P1-2，首个可独立实施切片）

新增 `BATCH / TASK` 的 payload marker `heytaTaskBatch: 1`，不 bump schema。形状为 `{ heytaTaskBatch: 1, source, tasks }`，严格拒绝未知字段。

- `source`：`{ version: 1, eventId, ruleId, ruleVersion, parseVersion, digest }`。digest 为冻结规范任务列表的 SHA-256（包含清单、字段与顺序），不代替入口原始字节摘要。账号/服务地址不以明文塞进业务来源字段；其隔离由 host scope 和中心记录保证。
- `tasks`：1–50 项，字段为 `id/title/priority` 和可选 `note/projectId/dueDate/startDate/durationMinutes`。标题非空且最多 500 字符，备注最多 10,000 字符；ID 最多 128 ASCII 字符且批内不重复。priority 为 0–3。时间必须为合法整数 epoch；时长沿用领域层 5–480 分钟范围，不静默夹取。
- 一次批创建只有一个目标清单（无 projectId 表示收集箱）；授权不允许输入或模型决定另一个清单。清单不存在、删除或失去授权时整批等待修正规则，不能静默改投收集箱。
- 任务 ID 固定为 `inbound:<eventId>:<itemIndex>`（eventId 最多 64 字节），op ID 固定为 `inbound:<eventId>`。op 的 `entityId` 为首项 ID，`entityIds` 是剩余项，范围与任务 ID 列表完全一致。每项独立 payload，共享 op 元数据；`createdAt` 从该 op 的时间戳导出。零项在 worker 结束，不能构造空 batch。
- 整批先校验后纯 reducer 物化，任何一项无效均不落盘、不改变内存。reducer 不检查当时的清单可见性以免乱序丢事件，授权/存在性由创建入口验证；远端回放不会再调用动作或产生副作用。
- Task 新增可选 `automationSource`（source + itemIndex）。旧数据默认无来源。来源本身不是全局分布式锁；删除任务不能清中心去重身份。重复/乱序/先删后到/后续编辑/REPAIR/checkpoint 都须收敛。
- 识别到未知 marker 版本必须响亮拒绝，不能按普通任务 payload 写入。暂不支持的设备不得注册为 worker；对新 payload 的读侧支持必须先随所有端发布，再开放回调。

日期语义扩展是后续切片，未完成前批入口只接收已明确的 instant，不将 date-only 伪装成午夜 epoch。

## 4. 权益与计量（P1-3 / P1-4）

新 capability 为 `automation`，与旧 `hosting/ai` gate 分开；关闭旧 gate 不旁路自动收集。自托管仍可免费同步。管理读取/关闭规则/查看已有状态/删除数据不要求付费；新规则启用、凭据签发、接收、领取、解析开始及提交许可要求有效自动收集权益。续费不修改冻结解析内容。

[ADR-0060](../adr/0060-automation-entitlement-and-retention.md)记录 2026-10-07 负责人确认的商业基线：现有 AI 付费档包含 automation，不新增 SKU；自托管绑定官方付费主体；不另收事件费；托管模型沿用既有额度，BYO 成本由用户端点承担。**实现与验收未闭合前不开放自动收集购买承诺。**

自托管首版采用在线核验，不承诺离线宽限。绑定 `(officialSubject, installationId, localAccountUuid)`，不使用本地数字 userId 跨实例认同一主体。首次绑定需要官方账号登录授权和本地账号认证，签发凭据不能借给客户端 worker。官方 issuer、Ed25519 keyId/公钥、实例私钥及吊销版本分别管理；部署者不能从客户端参数替换验证公钥。

在线核验票据绑定 action、实例、账号、rule/event、nonce、版本和 expiry，最多 30 秒且一次使用。只有服务端可信时间判断；发现时钟回拨则停止新授权。官方不可达显示 `waiting-entitlement`，不静默免费。撤销对未签发票据即时生效，对已签发票据最多有 30 秒传播窗口，必须披露；不能宣称跨数据库瞬时撤销。最终本地提交仍以第 2 节许可为边界。

事件模型账本唯一键 `(eventId, parseVersion, attempt)`，状态 `reserved/sent/consumed/released/unknown`；周期归属在 reserve 时冻结。额度判定与 reserve 在同一个数据库事务中，旧的周期计数器不能被另一路无条件加一。明确未发送的失败才 release；已发出后丢失响应记 unknown，默认不自动重新调用。取得结果后只保存客户端加密结果；重试提交不再调用模型。

无功能事件费不等于模型免费；人为再次解析属于明确的新模型尝试且必须重新确认其额度消耗。代理不持久缓存模型正文。新增 ADR 须同时限定 ADR-0054 的事件元数据例外，保留其“代理正文不持久化”边界。

## 5. 接收与签名（P1-5）

路径为 `POST /api/automation/v1/hooks/<ruleId>`，禁止 query、路径别名和 content-encoding。Content-Type 仅 `application/json` 或 `text/plain`，可带明确的 `charset=utf-8`；签名使用收到的白名单规范类型（不含 charset）。UTF-8 采用 fatal decode 加字节往返验证，拒绝 BOM，JSON 拒绝重复键、非对象顶层、深度超过 8 或总对象字段超过 512 的输入；字段映射只读取规则声明字段，不递归执行正文内容。

请求头：`X-Heyta-Key-Id`、`X-Heyta-Timestamp`（整数秒十进制）、`X-Heyta-Event-Id`、`X-Heyta-Signature`（64 位小写 hex）。这些头重复出现即拒绝，必须检查 raw headers，不能接受框架合并后的值。允许时间偏差 ±300 秒；每次重试可重新签当前时间，但沿用同一事件 ID 和原始 body。

签名串是 UTF-8 的以下各行（最后**无**换行）：

```text
heyta-inbound-v1
POST
/api/automation/v1/hooks/<ruleId>
<keyId>
<timestamp>
<sourceEventId>
<canonicalContentType>
<lowercaseHexSha256OfRawBody>
```

HMAC-SHA256，32 随机字节密钥；先检查编码长度，再常量时间比较。keyId 是公开 ID，随机密钥只展示一次；部署 keyring 的每个条目必须同时绑定账号 (`userId`) 与 secret，规则启用和每次验签都按规则所属账号取钥匙。服务器用独立部署 KEK 以 AES-GCM 包装（AAD 绑定账号、规则、keyId）。没有账号作用域/KEK 就拒绝启用，禁止数据库内明文或仅做不可恢复哈希后假称可以验签。

技术防滥用上限：原始 body 64 KiB、每规则每分钟 30 次、账号每分钟 120 次、账号未终结队列 1,000 条/64 MiB、账号同时解析 2 个事件、每个事件最多 50 个输出，冻结结果明文总量最多 512 KiB。边界在数据库事务/共享限流存储裁决，不能用每进程计数器；重放查询不重复占队列/业务额度，但仍受请求速率限制。数值是首版资源边界，不是付费套餐承诺。加密膨胀计入持久队列字节数。

接收凭据只能接收和查询本规则不透明状态；用户 JWT 才能管理；认证设备才可领取。查询也必须签名，签名串的 method/path 与空 body 摘要随实际请求变化；响应仅 `{eventId,state,reasonCode,itemCount?}`。400/401/403/409/413 是永久错误；429/503 带 Retry-After 可按原键重试。权限校验优先于返回旧事件，防止撤销凭据仍可查询。

## 6. 收件密钥（P1-6）

采用账号级 X25519 收件密钥，每个 epoch 一对；客户端随机生成，私钥用 Vault root AES-GCM 包装并持久化账号级加密包，跨设备认证下载并由 Vault 解锁。不得把私钥放服务端明文、规则配置或日志。公钥注册与包版本 CAS 绑定；服务器不能只换公钥而沿用旧包版本。当前服务端已提供认证后的 `PUT/GET /api/automation/recipient-key`，以账号行锁和 `expectedPackageVersion` 做发布闸门；这只落公钥/epoch/版本，不代表私钥或收件包迁移已完成。密码学实现先完成维护性/许可证登记，不能假设 Hermes 有 WebCrypto。

envelope v1：临时 X25519 公钥、HKDF-SHA256（独立 domain）、96 位随机 nonce、AES-256-GCM 密文与 tag；AAD 包含 envelope 版本、服务端 canonical origin、账号 UUID、规则、事件、用途（input/result）、key epoch，AAD 数组固定为 `["heyta-inbound-v1", serverOrigin, accountId, ruleId, eventId, purpose, keyEpoch]`；UTF-8 编码。HKDF salt 为 AAD 的 SHA-256，info 为 UTF-8 `heyta-inbound-x25519-aes256gcm-v1` 后连接临时公钥、收件公钥（各 32 原始字节），输出 32 字节。输入与结果用途不可互换。测试必须覆盖低阶公钥拒绝、AAD 篡改、坏 tag、错误 epoch 与跨账号交换。

改口令只重新包装 root，不换收件 epoch。新增设备恢复同一收件包；最后设备丢失但持有恢复码仍可恢复。Vault 锁定使在途解密/解析结果失效，不安装晚返回的密钥。设备撤销阻止新访问，同时提示根轮换；不能宣称擦除旧设备已取得的密钥。

root rotation 必须将收件包与队列旧 epoch 一起纳入既有加密迁移的 stage/CAS/publish 协议：暂停新接收/许可，授权客户端重封装保留队列，验证完整清单与字节预算，然后原子发布新 epoch 和包。响应丢失重用原密文 journal；不得重新随机加密后当同一迁移重试。未迁移完不可删除旧包或报告轮换完成。无法解密时确定失败/过期并可见，不能清空队列假装成功。

## 7. 字段、时间、授权（P1-7 / P1-8）

| 提取字段 | 领域字段 | 规则 |
|---|---|---|
| title | title | 必填、trim 后非空；长度超限整批拒绝 |
| note | note | 可选；不识别为指令，不自动抓 URL |
| priority | priority | 只接受 0–3，默认 0 |
| due | dueDate / 新可选 date-only 语义字段 | 截止独立；date-only 保留原日历日 |
| start | startDate / 对应日期语义 | 开始独立，不能由截止擅自补算 |
| durationMinutes | durationMinutes | 5–480 整数，只有明确时间才作为时长排期 |
| 来源 | automationSource | 系统注入，模型不得输出或覆盖 |
| 目标清单 | projectId | 规则注入，模型/正文不得输出或覆盖 |

中间时间值为 `date-only(YYYY-MM-DD)` 或 `instant(localDateTime, IANA zone, explicit offset?)`。无日期是合法未排期任务；非法日期、缺必需时区、冲突时区、DST 两义/不存在时刻进入整批 `needs-confirmation`；明确日期无时刻保持全天；过去日期保留并提示，不自动推至未来。默认采用冻结的服务器接收时刻解释相对日期；只有规则显式启用可信来源时间时，才采用经过格式与范围校验的来源时间。重试不得换锚点、模型版本或规则。

新 `AiFeature = inbound-automation`，披露只包含规则白名单中的来源字段与冻结时间上下文；不附加用户任务库、工具目录、凭据、完整规则或自定义 URL。经 `authorizeEgress/invokeRouted`；每设备联网同意与该 feature/destination 同意都必须有效。模型只返回受限结构，额外字段拒绝，绝不开工具循环。目标、授权、provider 改动提升规则版本，旧事件待确认，禁止静默应用新规则。仅本地模型不可用就等待，不转远端。

## 8. 设备、生命周期与保留（P2）

Web、macOS/Windows/Linux 共享 Web UI、Android/iOS 均需管理入口；worker 能力按实际 crypto/timezone/Vault/unlocked/foreground/network/同意/认证逐项注册。移动首版只承诺前台执行；桌面关闭应用与浏览器关闭页面都不保证处理。不得仅用最近在线时间判可执行。Node 是授权的独立宿主，不作为用户不知道的默认后台服务。

试运行默认零业务写入；若需要模型调用，先披露真实模型额度消耗。暂停、重试、取消、确认、删除规则分别显示它们影响的是接收、解析还是已授权提交。已创建任务的撤销通过正常用户动作产生新 op，不因删除规则自动删除任务。

2026-10-07 负责人确认的保留基线：输入/冻结结果密文 7 天；最小去重摘要和事件状态账本保留至规则删除（至少覆盖冻结计量周期及争议缓冲）；清理任务只置空密文，不删除事件身份。删除规则后的 UUID 永不复用，新建规则由服务器产生新 UUID，旧凭据失效。日志/备份按部署实际策略披露。账号注销包含所有新表、KEK 包装密钥、收件包、队列和账本，不能只删主记录。重放记录清理不得重启业务效果；未确认数值前禁止发布。

## 9. 实施验证

按唯一计划 AC-3 的十个故障窗口逐项记录中心、两本地库、同步日志和账本；新增第 11 项为许可授予与撤销的双向顺序，第 12 项为旧 keyId 重放/新 keyId 同事件重放，第 13 项为日期在不同端/视图的显示与编辑往返。所有边界测上限/上限加一；安全防线要有拒绝样例。纯函数测试不替代真 HTTP、真数据库、进程终止和当前安装产物。
