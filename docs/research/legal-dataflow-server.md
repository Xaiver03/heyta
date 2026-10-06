# 服务端数据流考古（隐私政策事实源）

> **元信息**
> - 日期：2026-10-01
> - 性质：**纯只读**代码考古。未修改任何产品代码。
> - 范围：仅 `server/`（Prisma schema、auth/password/passkey、api 账号路由、admin、sync 存储列、logger、邮件、billing、config）。
>   客户端与 AI 侧由其他 agent 负责，**不在本文**。
> - 用途：隐私政策「我们处理哪些个人信息」一节的**唯一事实来源**。
>   每条结论后面给 `文件:行号`。**没有证据的写「未发现」，不推断。**

---

## A1 全部 model 与字段

事实源：`server/prisma/schema.prisma`（795 行，**17 个 model**，逐 model 逐列清点如下）。
分类图例：**身份** = 身份标识 · **凭据** = 认证凭证 · **密文** = 同步密文/用户数据 · **计费** · **运营** · **遥测** = 设备/使用元数据 · **时间**。

### `User` → 表 `users`（schema.prisma:13-70）

| 列 | 类型 | 分类 | 说明 |
|---|---|---|---|
| `id` | Int @id 自增 | 身份 | 内部主键（:14） |
| `email` | String @unique | **身份（PII）** | 唯一的直接标识符（:15） |
| `passwordHash` | String? | 凭据 | passkey-only 账号为 NULL（:16） |
| `isVerified` | Int 0/1 | 运营 | 邮箱验证状态（:17） |
| `verificationToken` + `…ExpiresAt` | String? / BigInt? | 凭据 | **存令牌本身的 SHA-256 hex，非原文**（:24-25，注释 :18-23） |
| `verificationResendCount` | Int | 运营 | 重发计数（:26） |
| `resetPasswordToken` + `…ExpiresAt` | String? / BigInt? | 凭据 | ⚠️ 🔴 schema 注释 :27 那句「目前没有任何代码读写它」**已过期** —— 口令找回在本次审计进行中落地，`server/src/password/recovery.ts:126, 138, 172` 正在读写这组列（见 A3 / A5）（:27-30） |
| `passkeyRecoveryToken` + `…ExpiresAt` | String? / BigInt? | 凭据 | 找回邮件的一次性令牌（哈希）（:31-32） |
| `loginToken` + `…ExpiresAt` | String? / BigInt? | 凭据 | 魔法登录的一次性令牌（哈希）（:33-34） |
| `failedLoginAttempts` / `lockedUntil` | Int / BigInt? | 运营 | 暴破锁定（:35-36） |
| `tokenVersion` | Int | 凭据 | 强制登出 / 令牌代际（:37） |
| `isAdmin` | Boolean 默认 false | 运营 | 后台准入，无角色表（:40） |
| `termsAcceptedAt` | BigInt? | 时间 | 条款接受时刻（:41） |
| `createdAt` | DateTime | 时间 | （:42） |
| `storageQuotaBytes` / `storageUsedBytes` | BigInt | 运营 | 配额，默认 100 MB（:43-44） |
| `locale` | String? | 运营 | 账号语言，null = 从未改过（:49） |

> 🔴 该表**没有**姓名、电话、地址、生日、头像、任何 profile 字段。列全 = 上表。

### `Passkey` → `passkeys`（:72-87）

`id` cuid 主键（身份）· `credentialId` **Bytes @unique**（凭据）· `publicKey` Bytes（凭据）· `counter` BigInt（凭据，签名计数器）· `transports` String?（JSON 数组，凭据元数据）· `name` String?（**用户自己起的名字**，运营，:78）· `createdAt` / `lastUsedAt`（时间）。

### `PendingPasskeyRegistration` → `pending_passkey_registrations`（:89-107）

`verificationToken` String **@unique**（凭据，SHA-256 hex，注释 :91-93）· `verificationTokenExpiresAt` · `credentialId` Bytes · `publicKey` Bytes · `counter` · `transports` · `createdAt` · `userId`。= 邮箱验证通过前的凭据暂存区。

### `Operation` → `operations`（:109-159）— 同步内核

| 列 | 分类 | 明/密 |
|---|---|---|
| `id` String @id | 密文（op 指纹） | 明文 |
| `userId` Int | 身份 | 明文 |
| `clientId` String | 遥测（设备 id，LWW 决胜依据） | 明文 |
| `serverSeq` Int | 密文顺序号 | 明文 |
| `actionType` / `opType` / `entityType` | **元数据** | 🔴 明文 |
| `entityId` String? / `entityIds` String[] | **元数据** | 🔴 明文（数组，:125） |
| `payload` Json | **用户数据** | 密文（客户端加密，见 A2） |
| `payloadBytes` BigInt | 元数据（大小） | 明文 |
| `vectorClock` Json | 元数据（并发向量，含 clientId 键） | 明文 |
| `schemaVersion` Int | 元数据 | 明文 |
| `clientTimestamp` BigInt | 时间（**客户端声称的**） | 明文 |
| `receivedAt` BigInt | 时间（服务端接收） | 明文 |
| `isPayloadEncrypted` Boolean | 元数据 | 明文 |
| `syncImportReason` String? / `repairBaseServerSeq` Int? | 运营 | 明文 |

### `UserSyncState` → `user_sync_state`（:161-175）

`userId` @id · `lastSeq` · `lastSnapshotSeq` · `snapshotData` **Bytes?**（密文快照）· `snapshotAt` · `snapshotSchemaVersion` · `latestFullStateSeq` · `latestFullStateVectorClock` Json · `latestStateReplacementSeq`。

### `SyncDevice` → `sync_devices`（:304-321）

`clientId` + `userId` 复合主键 · `deviceName` String?（**用户起的设备名**）· 🔴 `userAgent` String?（:308，**唯一落库的 UA**）· `appVersion` String?（客户端上报的 semver）· `lastSeenAt` BigInt · `lastAckedSeq`（写了不读）· `createdAt`。分类：全为**遥测**。

### `WidgetPushSubscription` → `widget_push_subscriptions`（:639-667）

`userId` · 🔴 `endpoint` String @unique（**本身即凭据** —— 拿到就能给该设备发任意载荷，注释 :629-632 明令不得记日志/回显）· `p256dh` · `auth`（两个用户代理密钥）· `failureCount` · `createdAt` / `lastUsedAt`。分类：凭据 + 遥测。

### `Subscription` → `subscriptions`（:187-250）

`provider` String?（支付商名）· `externalSubscriptionId` String? @unique · `priceId` String?（SKU）· `grants` String[]（能力投影）· `status` String? · `currentPeriodEnd` · `lastEventAt` · `createdAt` / `updatedAt` · `userId`。分类：计费。**无卡号/无支付账号列。**

### `PaymentEvent` → `payment_events`（:262-302）

`provider` · `providerEventId`（复合唯一 :298）· `eventType` · 🔴 `payloadDigest` String?（**SHA-256 hex，不是原文** —— model 注释 :259-261 明确「绝不存原始 webhook payload，里面可能含买家邮箱/姓名/地址等 PII」）· `occurredAt` / `receivedAt` / `processedAt` · `subscriptionId`（SetNull）。分类：计费 + 运营审计。

### `CheckoutOrder` → `checkout_orders`（:502-558）

`outTradeNo` String @unique（商户订单号）· `userId` · `provider` · `priceId` · `currency` · `region` · 报价三元组 `originalAmountMinor` / `discountMinor` / `finalAmountMinor`（不可变）· `couponId` · `status` · `quotedAt` / `expiresAt` / `paidAt` / `settledAt` · `providerEventId` · `rejectedCouponsJson`（被拒券快照）。分类：计费。

### `Coupon`（:423-489）/ `CouponRedemption`（:583-621）/ `PriceVersion`（:345-380）/ `PricingAuditLog`（:389-411）

`Coupon`：纯运营配置（码、折扣形状、适用范围、限额、生效窗、开关），**不含用户标识**。
`CouponRedemption`：`couponId` + `userId` + `orderId` @unique + `state` + 金额快照 + 四个时间戳 —— 分类计费，**它把「谁用了哪张券」记进了库**。
`PriceVersion` / `PricingAuditLog`：价格区间与改价审计，`createdBy` / `actor` 是**字符串操作者名**（可能是运维人员账号名，:375 / :403）。

### `InviteCode`（:685-704）/ `Referral`（:727-755）/ `AccountNotification`（:771-795）

见 A6。

### `users` 之外还存 PII 的地方（政策必须列全）

| 位置 | 内容 | 证据 |
|---|---|---|
| `users.email` | 唯一的直接标识符 | schema.prisma:15 |
| `account_notifications.payload` (Json) | **被邀请人的显示名** + 奖励天数（:781 注释「账号级事实，不含用户内容」）—— ⚠️ 显示名是客户端给的，服务端只是照存，需 A6 核实实际写入值 | schema.prisma:782 |
| `sync_devices.userAgent` / `deviceName` | UA 字符串、用户自定义设备名 | schema.prisma:307-308 |
| `operations.entityType` / `entityId` / `entityIds` | 明文结构元数据 | schema.prisma:116-125 |
| `pending_passkey_registrations` / `passkeys.name` | passkey 元数据 + 用户命名 | schema.prisma:78, 96-97 |

**A1 结论**：17 张表里**只有 1 个直接标识符（email）**。无姓名/电话/地址/生日/IP 列。

---

## A2 同步数据在服务端是密文还是明文

### 加密在客户端哪个函数发生

| 环节 | 位置 |
|---|---|
| 上传前逐条加密 | `packages/sync-client/src/client.ts:796` —— `const cipher = await encrypt(JSON.stringify(op.payload ?? {}), password)`，紧接着 `:816` 写 `isPayloadEncrypted: true` |
| 加密原语 | `packages/sync-core/src/encryption.ts:134` `encrypt()` → `:101` `encryptWithDerivedKey()` |
| 算法 | **Argon2id KDF + AES-GCM**，WebCrypto 优先、@noble 兜底（`packages/sync-core/src/encryption.ts:2-9`） |
| 信封格式 | `[SALT 16B][IV 12B][AES-GCM 密文 + auth tag]` → 标准 base64（常量 `web-crypto.ts:5-6`） |
| 下载解密 | `packages/sync-client/src/client.ts:562` `await decrypt(op.payload, password)` |

### 服务端存的是哪一列

- `operations.payload Json`（schema.prisma:126）—— 装的就是上面那串 base64 密文。
- `user_sync_state.snapshotData Bytes`（schema.prisma:165）—— 快照，同样密文。
- 大小记账另存 `operations.payloadBytes`（:127）。

### 🔴 服务端有「只收密文」的入站闸门（不是口头承诺）

`server/src/sync/sync.routes.payload.ts:47-48`：

```ts
export const violatesE2eeGate = (item: E2eeGateItem): boolean =>
  item.isPayloadEncrypted !== true || !isEncryptedPayloadTransportShape(item.payload);
```

- 缺标志 = 违规（注释 :41-45：「missing is a violation, not "false-ish OK"」）。
- 快照面同一闸门：`server/src/sync/sync.routes.snapshot-handler.ts:124`。
- 拒绝发生在 fingerprinting / 去重 / 配额 / 落库**之前**，被拒的上传不留服务端痕迹（`sync.routes.payload.ts:52-58`）。
- 给客户端的错误文案**不含被拒 payload 内容**（`sync.routes.payload.ts:28-34`）；日志只记条数（`:54`）。

### 哪些元数据是明文（政策必须逐条列）

| 明文字段 | 泄露的是什么 | 证据 |
|---|---|---|
| `operations.entityType` | **用户有哪些种类的数据**（TASK / PROJECT / TAG / HABIT / GLOBAL_CONFIG …） | schema.prisma:116 |
| `operations.entityId` / `entityIds[]` | **实体 id 集合与跨 op 关联**（哪些任务属于哪个项目、批量 op 覆盖面）；服务端冲突检测按它查（`server/src/sync/conflict.ts:333`） | schema.prisma:117-125 |
| `operations.opType` / `actionType` | **动作类型**（ADD / UPD / DEL / REPAIR），等于暴露「删了」「改状态了」这类行为 | schema.prisma:114-115 |
| `operations.vectorClock` Json | **该账号用过几个 clientId** 及各自的逻辑计数（编辑活跃度画像） | schema.prisma:128 |
| `operations.clientTimestamp` | 客户端声称的操作时刻（**行为时间线**） | schema.prisma:130 |
| `operations.receivedAt` | 服务端接收时刻 | schema.prisma:131 |
| `operations.serverSeq` + `(userId, entityType, entityId, serverSeq)` 索引 | op 全序与按实体检索能力 | schema.prisma:113, 139 |
| `operations.payloadBytes` | **每条数据的大小**（长度侧信道） | schema.prisma:127 |
| `operations.clientId` | 设备标识（LWW 决胜依据） | schema.prisma:112 |
| `operations.schemaVersion` | 客户端数据模型版本 | schema.prisma:129 |
| `sync_devices.*` | 设备名、**userAgent**、app 版本、lastSeen | schema.prisma:305-315 |

> 另有两处**服务端会显式承认自己读不到内容**：
> `ENCRYPTED_OPS_CLIENT_MESSAGE`（`sync.routes.payload.ts:22-24`）—— 服务端快照因 E2EE 不可用；
> `superproductivity` 的 `isEncryptedPayloadTransportShape` 注释（`packages/sync-core/src/encryption/transport-shape.ts:4-17`）
> 自陈：**「The SuperSync server holds no E2EE key, so it cannot prove a payload is ciphertext」**。

### A2 结论（这句话能说到什么程度）

1. ✅ 可声明：**用户数据内容（op payload / 快照）在客户端加密，服务端不持有解密所需的密钥**；
   服务端有入站闸门拒绝未加密上传（代码级证据在上）。
2. 🔴 **不能声明成「服务端什么都看不到」**：上表 11 项元数据是明文，其中
   `entityType` + `entityIds` + `opType` + `clientTimestamp` + `payloadBytes` 组合起来
   足以刻画「谁、什么时候、对哪一类对象的哪一个、做了什么、多大」。
   准确表述：**端到端加密覆盖内容，不覆盖元数据（结构、顺序、时间、大小、设备）。**
3. ⚠️ 诚实条款：闸门是**形状检查**而非密文证明 —— 「足够长的 base64 明文能通过」
   （`transport-shape.ts:13-16` 原话）。政策里不要写成「服务端可验证数据确为密文」。
4. ⚠️ 遗留面：`isPayloadEncrypted` 默认值是 `false`（schema.prisma:132），
   历史行可能未加密；闸门只约束**入站**，不追溯清洗存量（计划文档 `docs/e2ee-legacy-data-eradication-plan.md` 被引用但本次未读，**未穷尽**）。

---

## A3 口令

### 算法与参数（`server/src/password/hash.ts:28-35`）

| 项 | 值 | 证据 |
|---|---|---|
| 算法 | **Argon2id**（`argon2.Algorithm.Argon2id`，`@node-rs/argon2`） | hash.ts:25, 29 |
| memoryCost | **19 456 KiB（19 MiB）** | hash.ts:30 |
| timeCost | **2** | hash.ts:31 |
| parallelism | **1** | hash.ts:32 |
| outputLen | 32 字节 | hash.ts:33 |
| salt | 16 字节随机（`randomBytes`） | hash.ts:34, 98 |
| 存储形状 | **PHC 自描述串**整条进 `users.password_hash` 列：`$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` | hash.ts:19, 82-88；schema.prisma:16 |

理由与取舍写在文件头（hash.ts:4-22）：OWASP Password Storage Cheat Sheet 首选；排除 bcrypt 是因为 72 字节静默截断。
参数变更走 `needsRehash` 在**登录成功时**就地重算（hash.ts:20-22；`password/service.ts:161` 有对应日志）。

### pepper

| 项 | 结论 | 证据 |
|---|---|---|
| 环境变量名 | **`PASSWORD_PEPPER`** | hash.ts:47 |
| 最短长度 | 32 字符，不足或**缺失即抛**（fail-closed，不是降级） | hash.ts:37, 48-58 |
| 用法 | Argon2 **原生 `secret` 参数**，不做 HMAC 预哈希 | hash.ts:10-12 |
| 首次使用即启动自检 | `assertPasswordBackend()` + 已知答案测试（KAT）钉死逐字节输出；自检失败**拒绝启动** | hash.ts:122-162；`server/src/index.ts:66` |
| 🔴 政策相关后果 | pepper 是**参与哈希的秘密**：换掉/丢掉 ⇒ 存量哈希全部验不过 ⇒ 它是部署必须备份项 | hash.ts:14-16 |

### 有没有明文 / 可逆落库

**没有。** `users` 只有 `passwordHash String?`（schema.prisma:16），无 `password` 明文列、无加密可逆列。
`resetPasswordToken` 那组列存的是**令牌哈希**（见下），不是口令。

### 有没有把口令或哈希写进日志

逐条核过 `server/src/` 全部含 password/token 的 `Logger.*` 调用点：

| 日志 | 含口令/哈希？ | 证据 |
|---|---|---|
| `Password rehashed to current policy (ID: …)` | ❌ 只有 userId | password/service.ts:161 |
| `User logged in with password (ID: …)` | ❌ 只有 userId | password/service.ts:279 |
| `Password login failed (${pwErr.code})` | ❌ 只有错误码 | api.ts:1417 |
| `Email+password registration rejected (${code}): ${errMsg}` | ⚠️ `errMsg = err.message` **原样入日志** | api.ts:1364-1365 |
| `Password breach check … prefix=${prefix}` | ⚠️ **SHA-1 前 5 个 hex**（k-匿名前缀，见下） | policy.ts:131, 141, 148 |

- ✅ **未发现**任何一处打印明文口令或完整 `passwordHash`。
- ⚠️ **残留风险（要如实登记）**：`api.ts:1364` 与 `:1368`、`1421` 把 `err.message` 原样写入日志。
  当前上游是 zod 与自定义 `PasswordAuthError`，其消息不回显提交的口令值，
  但**这一行本身没有防护** —— 若将来某层校验把输入值放进 message，它会直接进日志。

### 🔴 口令找回 / 改密流程（本次审计进行中落地，`server/src/password/recovery.ts`）

| 事实 | 值 | 证据 |
|---|---|---|
| 重置令牌 | 存 `hashToken(resetToken)`（**SHA-256 hex**），一次性：消费后立即置 `null` | recovery.ts:126, :138-139, :183-184 |
| TTL | **15 分钟**（`PASSWORD_RESET_TTL_MS`），与魔法链接一致；注释给出理由 | recovery.ts:59-65 |
| 防「链接在邮件里被别人看到」的宽限期设计 | 已有有效期内的链接时**不重发**，只记一条日志 | recovery.ts:131 |
| 🔴 重置成功 ⇒ **全设备登出** | `tokenVersion: { increment: 1 }`，旧 JWT 当场对不上；注释：「这是『全设备登出』唯一的落地方式」 | recovery.ts:35, :210-211, :313-319 |
| 改密成功也 bump | 同上，日志 `Password changed (ID: …); all other sessions revoked` | recovery.ts:329 |
| `/forgot` 响应**中性** | 账号不存在 / 没设口令 / 已有有效链接 **三种情况共用同一句话**，注释：「少一种，这句话就退化成预言机」 | recovery.ts:69-73 |
| 失败**不发信** | 第 5 封「口令已改」只在成功后发；否则它同时是骚扰接口与账号存在性预言机 | email.ts:218-222 |
| 日志洁净度 | recovery.ts 全部 5 处 `Logger.*` **只记 userId 或纯事件名**，无邮箱、无令牌、无口令 | recovery.ts:107, 131, 141, 223, 329 |
| 哈希并发闸门 | `withHashSlot()`（Argon2 一次 ~19 MiB / ~35 ms，见 concurrency.ts:6） | recovery.ts:290 |

### 策略层（会送到第三方！政策必须披露）

| 项 | 值 | 证据 |
|---|---|---|
| 最小长度 | **8 码点**（🔴 有意偏离 NIST 单因子 ≥15，补偿控制是下面两道） | policy.ts:20 |
| 最大长度 | **256 码点**（按码点算，不静默截断） | policy.ts:26 |
| 归一化 | `NFC` 后 `NFKC` | policy.ts:37 |
| 组成规则 | **无**（NIST 禁止） | policy.ts:9 |
| 本地常见口令表 | 有，`passwords-common` 字典 → `Set` | policy.ts:66-80 |
| 🔴 **泄露口令检查（外部）** | 调 **HIBP**：`https://api.pwnedpasswords.com/range/<SHA-1 前 5 位>`，超时 2 s | policy.ts:90, 96, 126 |
| 送出去的是什么 | **口令的 SHA-1 前 5 个十六进制字符**（k-匿名，收端无法反推口令，也无法知道是哪个用户） | policy.ts:106, 121-124 |
| 调用时机 | 仅**设口令**那一刻（注册/改密/重置完成）；🔴 **登录路径一律不跑** | policy.ts:1-4, 111 |
| 失败处置 | fail-open（查不成算通过），但**必须留一条 warn** | policy.ts:112-115 |
| 账号枚举防护 | 账号不存在也跑一次同参数 Argon2（`DUMMY_PHC`），消除计时差 | hash.ts:70-88 |
| 失败锁定 | `failedLoginAttempts` / `lockedUntil` 落库 | schema.prisma:35-36 |

> ⚠️ 另一处第三方出境（已存在但**不属于服务端口令流程**）：policy.ts:31-36 自陈
> **E2EE 口令那条路（`packages/sync-core` 派生）没有做任何 normalize** ——
> 这是客户端侧的独立缺陷，本 agent 不展开，但政策若声明「口令归一化一致」会不准确。

---

## A4 passkey / WebAuthn

库：**`@simplewebauthn`（server 端）**，实现集中在 `server/src/passkey.ts`（1139 行）。

### 存了哪些凭据字段（schema.prisma:72-107）

| 字段 | `Passkey` | `PendingPasskeyRegistration` | 说明 |
|---|---|---|---|
| `credentialId` | ✅ **Bytes @unique**（:74） | ✅ Bytes（:96） | 公钥凭据句柄，不是私钥 |
| `publicKey` | ✅ Bytes（:75） | ✅ Bytes（:97） | ** Authenticator 公钥 **；私钥从不离开设备 |
| `counter` | ✅ BigInt（:76） | ✅（:98） | 签名计数器（克隆检测），passkey.ts:330 `BigInt(credentialInfo.counter)` |
| `transports` | ✅ String?（:77） | ✅（:99） | JSON 数组，passkey.ts:331-334 |
| `name` | ✅ String?（:78） | — | **用户自己起的名字**，NULL = 未命名 |
| `createdAt` / `lastUsedAt` | ✅（:79-80） | `createdAt`（:100） | `lastUsedAt` 是使用时间戳 |
| `userId` | ✅（:82） | ✅（:102） | 外键级联删除 |
| `verificationToken` + `…ExpiresAt` | — | ✅ **SHA-256 hex**（:91-95） | 邮箱验证前凭据的暂存令牌；注释明示这一列 NOT NULL |
| `attestation` | 🔴 **不存** | 不存 | 注册选项写死 `attestationType: 'none'`，注释「We don't need attestation」（passkey.ts:197, 446, 798） |

`pending_passkey_registrations` 的作用：新账号在**邮箱验证通过之前**，凭据先落这张表；
`verifyEmail` 后才转成正式 `Passkey`（passkey.ts:320-335 建 pending，:362 验证路径）。

### challenge 存哪、活多久

| 项 | 结论 | 证据 |
|---|---|---|
| 存储介质 | **进程内 `Map`**，`new Map<string, { challenge, expiresAt }>()` | passkey.ts:124 |
| 是否落库 | ❌ **不落库**（schema 里没有 challenge 列） | schema.prisma 全文 |
| TTL | **5 分钟**：`CHALLENGE_EXPIRY_MS = 5 * 60 * 1000` | passkey.ts:32 |
| 命名空间 | `${ceremony}:${subject.toLowerCase()}`，四种 ceremony 隔离：`registration` / `user-registration` / `authentication` / `recovery` | passkey.ts:44-48, 144-146 |
| 消费即删 | `getAndClearChallenge()` 先 `challenges.delete(key)` 再判过期（一次性） | passkey.ts:157-173 |
| 定期清理 | `setInterval` 每 60 s 扫一遍过期项 | passkey.ts:135-142 |
| 🔴 多实例风险 | 生产环境启动即打 warn：内存 Map 在多实例部署下不工作，建议 Redis | passkey.ts:127-132 |
| ⚠️ Map 的 key 含 **email**（小写） | `registration` / `authentication` 两个 ceremony 用 email 当 subject —— **邮箱出现在进程内存的键里**（不落盘、不入日志，但重启即失） | passkey.ts:200, 557, 573 |
| recovery 刻意不用 email 当 key | `storeChallenge('recovery', token, …)`，注释：**"since we don't want to leak email"** | passkey.ts:801-802 |

### `WEBAUTHN_RP_ID` 的作用

passkey.ts:110：`const rpID = process.env.WEBAUTHN_RP_ID || 'localhost'`。

- 它是 **relying party ID**：WebAuthn 规范里凭据**绑定在这个值上**，
  认证时 `expected rpID` 必须一致 —— 所以**换域名 ⇒ 旧域名上注册的 passkey 全部失效**
  （AGENTS.md §9 记的实测代价：`heyta.finlaw.cloud` → `heyta.waytofuture.cn` 迁移时逐字相同、不可两边兼容）。
- 它同时是**用户 OS 里 passkey 提示所显示的实体**：`rpName` 默认回落到 `rpID`
  而不是品牌名，注释解释得很直接 —— 默认成产品名会把「我们」记成别人自建实例的 relying party（passkey.ts:111-116）。
- `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGIN` 各可覆盖（:116, :118），默认 `http://localhost:1900`。
- 配置值会**打进日志**：`Logger.info('WebAuthn config: rpID=${rpID}, origin=${origin}')`（:120）——
  是域名不是 PII，但政策里「日志含部署配置」这句要覆盖它。

### 其他与隐私相关的行为

- 找回密码：`passkeyRecoveryToken` 存 **SHA-256 hex**（passkey.ts:734, 763, 776），TTL **1 小时**（`RECOVERY_TOKEN_EXPIRY_MS`，:33）。
- 有口令可登的账号**跳过** passkey 找回邮件：`Logger.debug('Passkey recovery skipped: account can sign in with a password (ID: …)')`（:698）。
- 登录成功会推进 `counter`，因此服务端**记录每次使用**（`lastUsedAt`，schema.prisma:80）。

---

## A5 邮件

### 三类邮件（发件函数在 `server/src/email.ts`，模板是生成的中文文案）

🔴 **实际是 5 封，不是 3 封。** `grep "export const send" server/src/email.ts` 列出五个发送函数
（:119, :142, :165, :195, :226）。下面表格前两行是本次任务点名要查的三类中的两类，
第 4/5 封（口令找回、口令已改通知）是**本次审计进行中由另一条工作流落地的**
（`server/src/password/recovery.ts` 当时还是未跟踪新文件），故一并如实登记。

| # | 邮件 | 发送函数 | 链接形状 | 令牌列（存哈希） | TTL |
|---|---|---|---|---|---|
| 1 | 邮箱验证 | `sendVerificationEmail` email.ts:119-140 | `${publicUrl}/verify-email?token=<明文令牌>` | `users.verificationToken` | **24 h**（auth.ts:22） |
| 2 | 魔法登录 | `sendLoginMagicLinkEmail` email.ts:165-186 | `${publicUrl}/magic-login?token=…` | `users.loginToken` | **15 min**（auth.ts:26；文案同值 copy.generated.ts:77） |
| 3 | passkey 找回 | `sendPasskeyRecoveryEmail` email.ts:142-163 | `${publicUrl}/recover-passkey?token=…` | `users.passkeyRecoveryToken` | **1 h**（passkey.ts:33；文案 copy.generated.ts:83） |
| 4 | 🔴 **口令找回**（新增） | `sendPasswordResetEmail` email.ts:195-216 | `${publicUrl}/reset-password?token=…`（:201） | `users.resetPasswordToken`（**SHA-256 hex**，recovery.ts:126, 138, 172） | **15 min**（`PASSWORD_RESET_TTL_MS`，recovery.ts:65；注释说明刻意与魔法链接一致、比验证邮件短，理由：「改口令的破坏半径比验证邮箱大，而链接躺在邮件里」:59-63） |
| 5 | 🔴 **口令已被更改的安全通知**（新增） | `sendPasswordChangedEmail` email.ts:226+ | 按钮只回应用登录，🔴 **不带令牌**（:219 注释「与前四封唯一的不同是没有令牌」） | 无 | — |

### 正文含什么（`server/src/copy.generated.ts:72-88`，来自 `packages/i18n`）

共用件：标题、正文、按钮标签、失效说明、「请勿直接回复」`autoNote`（:72）、
「按钮点不动请复制链接」`fallbackIntro`（:73）、tagline（:74）。
🔴 **正文里没有用户名、没有任务内容、没有任何用户数据** —— 文案是封闭词表（`ServerCopyKey` 联合类型 :17-36）。
唯一携带的用户相关信息是：**收件人地址（`to`，email.ts:91）与链接里的令牌，以及 `?lang=` 语言参数**（`withLocale`，email.ts:68-71）。

- 验证邮件正文：「请点击下面的按钮验证你的邮箱，完成账号注册。」（copy.generated.ts:87）
- 魔法登录：「点击下面的按钮完成登录。」+「如果这不是你本人发起的，忽略这封邮件即可。」（:75, :78）
- passkey 找回：「你申请了恢复通行密钥……它会替换掉原来那一个。」（:81）
- 🔴 口令找回 / 口令已改通知：文案键 `server.email.reset.*` 与 `server.email.passwordChanged.*`。
  词条**已在 i18n 源里**（`packages/i18n/src/locales/zh-CN.ts:3277-3281`，正文含
  「设置成功后，其他设备上的登录都会失效」⇒ 重置会推进 `tokenVersion` 强制登出其它会话），
  但**生成物 `server/src/copy.generated.ts` 里这两个前缀各 0 次命中** ⇒ 生成尚未重跑，
  `check:server-copy` 门禁此刻应为红（AGENTS.md：改词条必须重跑生成）。政策文案不受影响，
  但这条要转给该工作流的所有者。
  发送走同一个 `deliver()`，封闭词表 + 链接 ⇒「正文不含用户内容」对这两封同样成立（email.ts:203-208, 236-243）。

### 令牌存哪

**SHA-256 hex，不存发进邮件的那句原文**：统一走 `hashToken()`（`server/src/auth-tokens.ts:38`），
调用点如 `passkey.ts:325, 734, 763, 776`。schema.prisma:18-23 的注释是这条立场的事实源，
并明确 **⚠️ 只对 CSPRNG 高熵一次性凭证成立**，低熵恢复码必须限次 + 短 TTL。
存量明文已被迁移 `20261005000000_invalidate_stored_auth_tokens` 一并作废（schema.prisma:21）。

### 🔴 SMTP：自建还是第三方？收件人邮箱会不会经过第三方？

| 项 | 结论 | 证据 |
|---|---|---|
| 库 | **`nodemailer`** | email.ts:1 |
| 配置项 | `SMTP_HOST` / `SMTP_PORT`（默认 **587**）/ `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | config.ts:427-439 |
| 默认值 | `host` **无默认**（没配就没有 smtp 块）；port 587；from 兜底 `"heyta" <noreply@example.com>`（占位符，注释明令真部署必须设） | config.ts:429, 18-23 |
| 是哪家服务商 | 🔴 **代码里没有写死任何服务商** —— 完全由部署者的 `SMTP_HOST` 决定。结论：**取决于自建实例配了什么**，政策不能写具体名字 | 同上 |
| 生产无配置 | **直接抛**：`'SMTP configuration is required in production environments'` | email.ts:34-36 |
| 🟡 开发兜底 | 无配置且非生产 ⇒ **Ethereal**：`host: 'smtp.ethereal.email', port: 587, secure: false`，并打日志 | email.ts:38-45 |
| 🔴 **收件人邮箱会不会经过第三方** | **一定会**：只要 `SMTP_HOST` 指向外部服务商（如腾讯企业邮 / SES / Postmark），收件地址就交付给该服务商。这是「邮件投递」的固有性质，政策必须披露，并说明服务商由**每个自建实例的部署者**决定 | email.ts:21-31 |
| 凭据形式 | `auth: { user, pass }`（SMTP 登录密码走环境变量） | email.ts:25-30 |
| 日志 | `SMTP configured: <host>:<port>`；每封 `… sent [locale]: <messageId>`；**不打印收件人邮箱** | email.ts:32, 100 |

### 注册限制（邮箱白名单）

`ALLOWED_EMAILS`（逗号分隔，支持整址与 `*@domain`），未设 = **开放注册**（`server/src/email-allowlist.ts:1-17`）。
匹配时把提交邮箱**小写归一**后比对（:20-29）。日志只记规则条数，不记邮箱（:18）。

### A5 结论（政策可直接用的话）

- 服务端**只为五个账号自助流程发信**：验证邮箱、魔法登录、找回通行密钥、重置口令、口令已改通知。
  🔴 **没有营销邮件、没有订阅列表、没有任何群发** —— 第 5 封「口令已改」是**安全通知**，
  且刻意**只在成功后发**（失败不发信，否则它就成了骚扰接口 + 账号存在性预言机，email.ts:218-222）。
  后台的范围外也明确排除「自由文本群发通知」（见 A8）。
- 五封里有 **4 封携带一次性令牌链接**（第 5 封不带令牌）⇒ 令牌在邮件通道里是明文，这是 E2EE 覆盖不到的地方。
- 邮件内容**不含用户内容**，只含一次性链接与封闭词表文案。
- 邮件投递**经由部署者配置的 SMTP 服务商**，该服务商能看到「收件地址 + 邮件正文（含令牌链接）」。
  🔴 政策里「端到端加密」**不能**延伸到电子邮件这一通道。

---

## A6 邀请与推荐

实现：`server/src/activity/invite.ts`（440 行）+ `notifications.ts` + `activity.routes.ts`。
表定义见 schema.prisma:685-795。

### `invite_codes`（schema.prisma:685-704）

| 列 | 内容 |
|---|---|
| `code` String @unique | 可分享的码，`normalizeInviteCode()` 归一化后的大写形式；长度受 `INVITE_CODE_LENGTH`，**排除易混字符 0/O/1/I/L**（要能手抄口述）（:688-691） |
| `disabled` Boolean | 停用开关。注释：🔴 停用是运营动作，**删除不是** —— 删了历史邀请查不到出处（:693-694） |
| `userId` Int @unique | **一个账号一张码**，同时是并发闸门（撞 P2002 重读）（:698-700） |
| `createdAt` | 时间 |

**惰性生成**：第一次打开「活动」页才建（`ensureInviteCode`，activity 读路径调用 invite.ts:378）。
注释明确：**这不是安全边界** —— 码本就是公开可分享的，拿到码不等于任何权限（schema.prisma:683-684）。

### `referrals`（schema.prisma:727-755）—— 🔴 这张表是**跨账号可反查的关系图**

| 列 | 内容 |
|---|---|
| `inviteeUserId` Int **@unique** | 🔴 承重的防重复发奖约束（一个被邀请人只算一次），:731 + 注释 :721-726 |
| `inviterUserId` Int | 邀请人 |
| `code` String | **注册那一刻用的码（快照）**，不 join 回 `invite_codes` 反查，因为码可停用而历史不能改写（:734-736） |
| `createdAt` / `activatedAt` / `rewardedAt` | 三个时间点；`activatedAt = null` 表示注册了但邮箱未验证（:740-741） |
| `rewardDays` Int? | **实际发出的奖励天数**，与 `activatedAt` 同进同退（:743-747） |

生命周期（schema.prisma:709-715）：`?invite=CODE` 注册 → 建一行（未兑现）→ 被邀请人**完成邮箱验证** → 结算写 `activatedAt / rewardDays / rewardedAt`。
「先登记、后兑现」是刻意的，因为注册那一刻还不知道邮箱是不是真的（:717-719）。
调用点：`settleReferralActivation` 必须在 `verifyEmail` 的验证事务里，幂等靠 CAS（invite.ts:286-312）。

### `account_notifications`（schema.prisma:771-795）

`userId` · `kind` String（封闭词表，客户端据此选图标与措辞；未知 kind 必须优雅跳过 :777-778）·
`payload` Json（措辞参数，不是成品文案 —— 理由是文案唯一事实源在 `packages/i18n`，改措辞不该写数据迁移，:766-770）·
`createdAt` · `readAt`（时间戳而非布尔，:786-788）。

### 🔴 payload 里实际存了什么（这是本节最需要披露的一条）

目前唯一的 kind 是 `referral-activated`，写入点在 `server/src/activity/invite.ts:317-325`：

```ts
const invitee = await db.user.findUnique({ where: { id: inviteeUserId }, select: { email: true } });
await createNotification(db, {
  userId: referral.inviterUserId,
  kind: 'referral-activated',
  payload: { displayName: displayNameFromEmail(invitee?.email ?? ''), days },
});
```

而 `displayNameFromEmail` = **邮箱 `@` 之前的 local part**（`packages/domain/src/activity.ts:273-277`）。

⇒ 结论：结算时服务端**主动读取被邀请人的邮箱**，取其用户名部分，
作为「展示名」**快照写进邀请人的通知**（invite.ts:313 注释：「之后对方改邮箱不会改写这条历史」）。
**这不是「不含用户内容」那么轻** —— 它是另一个人的邮箱派生值，且永久留存。

### 邀请关系能否反查

| 方向 | 能查到什么 | 证据 |
|---|---|---|
| 邀请人 → 被邀请人 | 🔴 **能**。`GET /api/activity`（需登录，rate limit 60/15 min）返回 `referrals[]`，每条含 `displayName`（= 被邀请人邮箱 local part）、`code`、`createdAt`、`activatedAt`、`rewardDays`，最多 20 条（上限 100） | activity.routes.ts:129-159；invite.ts:34-39, 334-346, 390-419 |
| 被邀请人 → 邀请人 | `referrals.inviterUserId` 在库里，但**未发现**任何读路径把它返回给被邀请人 | invite.ts 全量 `findMany` 均按 `inviterUserId` 过滤 |
| 运营 / 管理员 | 见 A8：后台 referrals 面 | admin.routes.ts |

### 奖励写进哪张表

**`subscriptions`**，`provider = 'invite'`（`INVITE_SUBSCRIPTION_PROVIDER`，invite.ts:67-74）。
注释是政策级的：**该字符串同时是权益行的身份**，权益判定按 `(userId, provider)` 区分来源，
所以不能复用 `'manual'` 之类，否则两条权益互相覆盖到期日（:68-73）。

🔴 这条正是 AGENTS.md「通知中心」一节记录的 P0 根因：奖励行写进 `subscriptions` 后，
「最新一行说了算」的 `findFirst(orderBy id desc)` 会挑中后建的奖励行、
**把用户已付的时长整个盖掉**。现在判定改成 `evaluateCapabilityAcross`（多来源取并集）+ `findMany`
（回归钉在 `server/tests/entitlement-across.spec.ts`）。政策里「权益」一句要按并集口径写。

奖励天数常量 `INVITE_REWARD_DAYS`（5 天 `hosting`）与窗口上限 `INVITE_CAP_PER_WINDOW` /
`INVITE_CAP_WINDOW_DAYS` 都在 `packages/domain`（invite.ts:361-363 注释「上限是产品决定，只该有一个定义」）。

### A6 结论（政策口径）

1. 服务端**保存邀请关系**（谁邀请了谁、用了哪张码、什么时候激活、发了几天）—— 这是**两个账号之间的可链接数据**。
2. 邀请人**能在自己的界面里看到被邀请人邮箱的用户名部分**（不是全址）。政策必须披露这条**用户之间的数据可见性**。
3. 邀请码不是凭证、不给权限（schema.prisma:683-684）。
4. 没有邮件形式的邀请（不发邀请信、不导入通讯录）。

---

## A7 计费与订单

### 表清单与字段（详见 A1 对应小节）

| 表 | 关键列 | 是否含支付账号信息 |
|---|---|---|
| `subscriptions` | `provider` / `externalSubscriptionId` / `priceId` / `grants[]` / `status` / `currentPeriodEnd` / `lastEventAt` / 两个时间戳 / `userId` | ❌ **无** |
| `payment_events` | `provider` + `providerEventId` @unique / `eventType` / 🔴 `payloadDigest`（**SHA-256 hex**）/ `occurredAt` / `receivedAt` / `processedAt` / `subscriptionId` | ❌ **无** |
| `checkout_orders` | `outTradeNo` @unique / `userId` / `provider` / `priceId` / `currency` / `region` / 报价三元组 / `couponId` / `status` / 四个时间戳 / `providerEventId` / `rejectedCouponsJson` | ❌ **无** |
| `coupons` + `coupon_redemptions` | 券定义（码、折扣、限额、生效窗）+ 核销行（`couponId`/`userId`/`orderId` @unique/`state`/金额快照） | ❌ **无** |
| `price_versions` + `pricing_audit_log` | 价格区间 + 改价审计（`beforeJson`/`afterJson`/`actor`/`createdBy`） | ❌ 无支付信息；`actor` 是**运维者标识字符串** |

🔴 **全库没有卡号、没有 CVV、没有 IBAN、没有钱包账号、没有账单地址、没有买家姓名列。**
唯一带「人」的计费字段是 `users.email` 与 `checkout_orders.user_id` 的关联本身。

### 为什么不存原始 webhook 正文（这是设计，不是遗漏）

`schema.prisma:259-261`（model 注释）：

> 🔴 **绝不存原始 webhook payload。** 里面可能含买家的邮箱 / 姓名 / 地址等 PII，
> 而我们对它的全部需求只是"审计 + 去重" —— 存 `payloadDigest`（SHA-256 十六进制）就够了。
> **这条是有意的，不要为了"方便排查"把原文加回来。**

落地点：`server/src/billing/webhook.routes.ts:371` `const digest = digestPayload(rawBody)`。
另外**验签失败绝不落 `PaymentEvent`**（:358-366），只留一条审计（含 `ip: req.ip`）。

### 支付通道：走 Apple/Google 收据校验还是微信支付？

**微信支付（Native 扫码），且只有它。**

| 判定 | 证据 |
|---|---|
| 已注册的 adapter 只有 **`noop` + `wechat`** | `server/src/billing/registry.ts:12-14, 55-69` |
| 🔴 微信**仅当 `WECHAT_PAY_ENABLED` 配齐才注册**；默认自托管**只有 noop**，`POST /api/billing/webhooks/wechat` 回 **404** | registry.ts:5-6, 56-59 |
| **未发现**任何 Apple / App Store receipt 校验、**未发现** Google Play Billing、未发现 Stripe/Paddle 实现 | 全 `server/src/` 关键词 `storekit` / `receipt` / `play billing` / `inapp` **零命中**；`stripe` / `paddle` 只出现在 schema 注释里作为**将来**的 provider 名示例（schema.prisma:191, 256, 511） |
| 幂等策略 | 七家支付商四种机制互不相同、Paddle 官方不支持客户端幂等键 ⇒ 闸门建在自己的库 `(provider, providerEventId)` 上（schema.prisma:253-257） |
| 对账 | 有独立 sweep/reconcile 作业：`billing/reconcile.ts` / `reconcile-job.ts` / `pricing-store.ts` 的预留过期 |

### 🔴 adapter 会把什么发给微信支付

`server/src/billing/wechat.adapter.ts:643-654`，下单请求体**逐字段**（这是「向第三方提供数据」清单里唯一真实的一条支付出境）：

```
appid, mchid, description（商品名）, out_trade_no, notify_url,
attach: String(input.userId),
amount: { total: amountMinor, currency }
```

发送点：`fetch(${WECHAT_API_BASE_URL}/v3/pay/transactions/native)`，
`User-Agent: heyta-sync-server/wechat-native`（:669-681）。

| 出境内容 | 是不是 PII |
|---|---|
| 🔴 `attach = userId`（**内部自增用户 id 的十进制串**） | 伪标识符 —— 微信侧能看到「一个数字 id」 |
| 🔴 `out_trade_no` = `hy<userId 的 base36>x<时间戳 base36>x<随机 hex>`（:326-334） | **同一 id 被编进订单号第二次**；注释说明这是 `attach` 在回调里可能丢失时的**兜底归属来源**（:321-325, 361-364） |
| `description`（价目表商品名）、金额、币种、通知地址 | 非 PII |
| ❌ **不发邮箱** / 不发姓名 / 不发手机号 / 不发明文口令或令牌 | — |

⇒ 政策口径：**「我们向支付服务商提供的用户标识是一个内部数字 id，不含邮箱或任何用户内容」**，
但不要写成「不向支付商提供任何标识」—— 那是假的（`attach` 就在里面）。

回调方向：微信回传的 `resource` 是 AES-GCM 密文，用 `apiV3Key` 解（:28 注释），
解出来的金额**只与 `checkout_orders.final_amount_minor` 比对**（schema.prisma:495-501）。

### 优惠券相关（政策一般不需要披露，但登记边界）

`coupon_redemptions` 把「**谁**用了**哪张**券、在**哪一单**」永久记录，
且 `CheckoutOrder.rejectedCouponsJson` 存了**报价时被拒的候选券快照**
（schema.prisma:543-546，理由：券定义以后会变，而「当时为什么被拒」必须按当时的定义回答）。
`region` 列（`CN`/`INTL`）意味着**订单带法域归属**（schema.prisma:516-518）。

---

## A8 运营后台可见字段

实现：`server/src/admin/`（`admin.routes.ts` / `admin.middleware.ts` / `admins.ts`）。决策见 ADR-0038。
路由清单（文件头表格 `admin.routes.ts:10-20`）共 **10 条**。

### 🔴 鉴权是插件级的，不是逐条记得的

`admin.middleware.ts` 的 `requireAdmin` 以 `addHook('preHandler', …)` 挂在 `/api/admin/*` 子树
⇒ **新增路由忘了鉴权在结构上不可能**；认证与判权在同一个 hook 里，顺序不可能排错。
准入只有 `users.is_admin`（Boolean，默认 **false**）单级，**没有角色表、没有权限码**（schema.prisma:38-40）。
授权只能由 CLI 做：`node dist/scripts/admin.js grant <email>`（容器内）。

### 白名单投影的设计立场（`admin.routes.ts:25-30`，文件头原文）

> `passwordHash`、`verificationToken` / `resetPasswordToken` / `passkeyRecoveryToken` /
> `loginToken`、`Passkey.credentialId` 与公钥 —— **一个都不出现在响应里**。
> 不靠"记得别 select"，而是每个投影函数显式列出要哪些字段。

同样的白名单在 `admins.ts:22` 再声明一次：「🔴 **白名单** —— 不含 `passwordHash`、任何 token、`isAdmin` 以外的账号内部字段」。

### `passwordHash` 被显式排除的证据（行号）

| 证据 | 行号 |
|---|---|
| `USER_LIST_SELECT` **逐字段列出**，其中**没有** `passwordHash` / 任何 token 列 | `server/src/admin/admin.routes.ts:103-112` |
| 文件头声明「一个都不出现在响应里」并点名 `passwordHash` | `admin.routes.ts:27-28` |
| `admins.ts` 三处投影同样只有 `id/email/isVerified/createdAt(/isAdmin)` | `admins.ts:74, 96, 118` |
| 用户详情复用 `USER_LIST_SELECT` 再加三个非敏感列 | `admin.routes.ts:301-306` + `352-358` |

### 逐条路由的响应字段（白名单，实际 select）

| # | 路由 | 响应里出现的**与用户相关的字段** | 行号 |
|---|---|---|---|
| 1 | `GET /overview` | 纯聚合计数（不含任何单条用户数据） | :152 |
| 2 | `GET /users` | `id` `email` `isVerified` `isAdmin` `lockedUntil` `createdAt` `storageUsedBytes` `storageQuotaBytes` | :251, :272 + `USER_LIST_SELECT` :103-112 |
| 3 | `GET /users/:id` | 上一行全部 **+** `failedLoginAttempts` `termsAcceptedAt` `tokenVersion`；订阅（`provider/priceId/status/grants/currentPeriodEnd/createdAt/updatedAt`）；订单（`outTradeNo/provider/priceId/currency/finalAmountMinor/discountMinor/status/createdAt/paidAt`）；设备（`clientId/deviceName/appVersion/lastSeenAt`，取最近 50）；🔴 passkey / 操作 / 通知 **只给条数 `_count`** | :293-360（`_count` 在 :347，注释 :345-346 原文：**「只数个数，不取 `credentialId` / 公钥 —— 那是指纹类标识，后台不需要它，"顺手带上"只会扩大泄漏面」**） |
| 4 | `POST /users/:id/unlock` | 回显 `id` + `email` | :409-420（select :417） |
| 5 | `POST /users/:id/quota` | 回显 `id` `email` `storageQuotaBytes` `storageUsedBytes` | :433-448（select :448） |
| 6 | `POST /users/:id/logout` | 回显 `id` `email` `tokenVersion` | :479-487（select :487） |
| 7 | `GET /subscriptions` | `id` `userId` **`email`** `provider` `priceId` `status` `grants` `currentPeriodEnd` `createdAt` | :502-545（`user: { select: { email } }` :520） |
| 8 | `GET /orders` | `id` `outTradeNo` `userId` **`email`** `provider` `priceId` `currency` `region` `originalAmountMinor` `discountMinor` `finalAmountMinor` `status` `createdAt` `paidAt` | :551-600（select :560-574） |
| 9 | `GET /coupons` | 券自身配置 + `_count.redemptions`（🔴 **不拉核销行**，注释 :631「那是另一张会长的表」） | :610-645 |
| 10 | `GET /invites` | 码表：`code` `disabled` `createdAt` `userId` **`email`**；推荐：`code` `createdAt` `activatedAt` `rewardDays` `rewardedAt` + 🔴 **`inviter.email` 与 `invitee.email` 双端全址** | :666-720（:696-697） |

分页：`limit` 上限 **200**，默认 50（:64-70）。

### A8 结论：「我们的员工能看到什么」

**能看到**：邮箱全址、账号状态（验证/锁定/管理员/`tokenVersion`/失败次数/条款时间）、
存储用量、订阅与订单（含金额、法域 `region`、商户订单号）、设备清单（clientId + 用户起的设备名 + app 版本 + 最后使用时间）、
🔴 **邀请关系的两端邮箱**。

**看不到**（设计上不存在于响应中）：
口令哈希、任何一次性令牌、passkey 的 `credentialId` 与公钥、
`operations.payload`（**同步密文内容**，后台只有条数）、`user_sync_state.snapshotData`、
推送订阅的 `endpoint`/`p256dh`/`auth`、webhook 原始正文（库里本就只存摘要）。

**范围外（明确不做，ADR-0038 §2 三 / §3.4，`admin.routes.ts:21-24`）**：
改订阅、退款、发券、**群发自由文本通知**。
⇒ 政策可写：**后台不能向用户发送任意通知，也不能改动金额**。

⚠️ **一条必须如实登记的边界**：`GET /invites` 返回推荐关系的**双端邮箱全址**，
而 A6 里给普通用户的那条列表只给 local part —— 两者可见性不同层，政策要分开写。

⚠️ 另一条：`Logger.info` 在两处管理动作里**把邮箱明文写进日志**（`admin.routes.ts:419` 解锁、`:489` 强制登出）。
见 A9。

---

## A9 日志

### 日志实现（`server/src/logger.ts`，84 行，零第三方依赖）

| 项 | 结论 | 行号 |
|---|---|---|
| 输出去向 | `console.log/warn/error`；**仅当 `LOG_TO_FILE === 'true'`** 才另写一份 JSON Lines 到 `<cwd>/logs/app.log`（append） | :8-27 |
| 级别 | `debug` 受 `LOG_LEVEL === 'debug'` 控制，其余三档无条件输出 | :41-58 |
| 结构化审计 | `Logger.audit(entry)` 打 `level: 'AUDIT'` 的 JSON | :60-83 |
| 🔴 **Fastify 自带访问日志是关的** | `logger: false, // We use our own logger` | `server/src/server.ts:380` |

### 实际打了哪些字段（逐类）

**普通日志（`Logger.info/warn/error/debug`）**：`userId`（数字）、错误码（`pwErr.code`）、
`messageId`（邮件）、`rpId` / `origin`（WebAuthn 配置，passkey.ts:120）、
SMTP `host:port`（email.ts:32）、计数（如 `Verification resend cap reached (ID: …)`）、
`err.message` 原文（十余处 `errMsg` 模式）。
尺寸类日志**只记字节数与上限**，不记内容（`sync.routes.payload.ts:230-244`）。

**审计日志 `AuditLogEntry` 的字段（logger.ts:28-39）**：
`event` `userId` `clientId?` `opId?` `entityType?` `entityId?` `errorCode?` `reason?` **`ip?`** + 自由扩展。

全部 audit 调用点与事件名：

| 事件 | 携带字段 | 行号 |
|---|---|---|
| `USER_ACCOUNT_DELETED` | `userId` | api.ts:583 |
| `USER_DATA_DELETED` | `userId` | sync/sync.routes.ts:328 |
| `PASSKEY_ADDED` / `PASSKEY_DELETED` / `PASSKEY_RENAMED` | `userId` + `entityId`（**服务端行 id**） | passkey.ts:533 / :1055-1060 / :1133-1137 |
| `RATE_LIMITED` | `userId` `clientId` `errorCode` `opsCount` | sync/sync.routes.ops-handler.ts:113-118 |
| `E2EE_REQUIRED` | `userId` `clientId` `surface`(`ops`/`snapshot`) `opsCount` | sync/sync.routes.payload.ts:61-66 |
| `OP_REJECTED` / `TIMESTAMP_CLAMPED` | `userId` `clientId` `opId` `entityType` `entityId` `errorCode` | operation-upload.service.ts:117, :138 |
| `VERIFICATION_FAILED`（计费 webhook 验签失败） | `userId: 0` `provider` `reason` 🔴 **`ip: req.ip`** | billing/webhook.routes.ts:360-366（同类 :444, :460, :485） |
| `ENTITLEMENT_DENIED` | `userId` `errorCode` `reason` `capability` 🔴 **`ip: req.ip`** | entitlement.ts:365-373 |

### IP

| 问题 | 结论 | 证据 |
|---|---|---|
| 有 IP 吗 | **有，两处审计事件写 `ip: req.ip`**（验签失败、权益拒绝） | 上表 |
| IP 还用在别处吗 | 🔴 **作为限流键**：`@fastify/rate-limit` 默认按 `req.ip`；WS 连接键 `${req.ip}:${clientId}`（**内存计数，非日志**） | sync/websocket.routes.ts:25, :36 |
| IP 怎么解析的 | `trustProxy = ['loopback', 'uniquelocal']`：只有这两个地址段的 `X-Forwarded-*` 才被采信，别的对端来的头**忽略** ⇒ 直连源站无法伪造 IP | server.ts:49-66 |
| IP 落库吗 | ❌ **schema 里没有 IP 列**（A1 全量点过 17 张表） | schema.prisma |

### user-agent

| 位置 | 结论 | 证据 |
|---|---|---|
| 日志 | 🔴 **未发现**任何一处把 `user-agent` 写进日志（全仓 `Logger.*` 无 UA 插值） | logger.ts + 全部调用点 |
| 落库 | ✅ **有一列**：`sync_devices.userAgent String?` | schema.prisma:308 |
| 谁写的 | 由同步/设备注册路径写入（**本 agent 未穷尽追到具体赋值行**；已确认的是后台 `GET /users/:id` 的设备投影**不取 `userAgent`**，只取 `clientId/deviceName/appVersion/lastSeenAt`，admin.routes.ts:336-343） | — |

### 邮箱

- 🔴 **两处把邮箱明文写进日志**：`Admin unlocked user #<id> (<email>)`（admin.routes.ts:419）、
  `Admin forced logout of user #<id> (<email>)`（:489）。
- ✅ **刻意不写的地方**（可作正面证据）：`Passkey recovery requested for non-existent email`（passkey.ts:687）、
  `Magic link requested for non-existent email`（auth.ts:347）—— 反枚举，只说「有这么回事」不给地址；
  白名单只记规则条数（email-allowlist.ts:18）；邮件发送记 `messageId` 不记收件人（email.ts:100）。

### 请求体 / 令牌片段

| 项 | 结论 | 证据 |
|---|---|---|
| 请求体整体 | ❌ **未发现**任何一处打印 `req.body` 或请求体 | 全仓 grep `req.body` + `Logger.` 零命中 |
| op `payload`（密文） | ❌ **不记**。E2EE 闸门与体积日志明确「Logs counts only, never payload content」 | sync.routes.payload.ts:54, 230-244 |
| 一次性令牌值 | ❌ **未发现**打印 `verificationToken` / `loginToken` / `recoveryToken` 的明文值 | grep `${token}` 等零命中 |
| 口令值 | ❌ 未发现（见 A3 表） | — |
| ⚠️ **凭据标识（debug 档）** | `Registration credentialId base64url: ${credentialIdBase64url}` —— **passkey 凭据 id 进 debug 日志** | passkey.ts:259 |
| ⚠️ **HIBP 前缀** | `prefix=${prefix}` = 口令 SHA-1 前 5 hex | password/policy.ts:131, 141, 148 |
| ⚠️ **`err.message` 原文入日志** | 十余处 `errMsg` 模式（如 api.ts:1364-1368, :1421）。当前上游错误类型不回显提交的口令/令牌，**但这一行没有防护** | api.ts 多处 |
| `clientId` | ✅ 审计与日志会记（设备标识，非用户身份） | sync.routes.ops-handler.ts:116 |

### 有没有访问日志落库

**没有。** schema.prisma 17 张表里**没有任何访问日志 / 请求日志 / 事件流水表**
（`payment_events` 是支付事件、`pricing_audit_log` 是改价审计，都不是 HTTP 访问日志）。
`Logger.audit` 的输出是 **stdout（与可选的 `logs/app.log` 文件）**，不进数据库（logger.ts:60-83）。

### A9 结论

服务端**不记录 HTTP 访问日志**（Fastify logger 关闭）；IP 只出现在两个安全审计事件与限流键里，
且**不落库**；UA 不落日志但**落 `sync_devices` 一列**；
邮箱在**两处管理员动作**里进日志；`logs/app.log` 是**可选开启**的（`LOG_TO_FILE`），
开启即明文写磁盘 —— 政策的「日志保留期」一节要按部署实际取值写，不能一概而论。

---

## A10 埋点 / 分析 / 崩溃上报

### 🔴 结论：**未发现任何埋点、分析、崩溃上报。**

这是本报告里唯一一条**否定结论本身就是政策要用的**事实，所以把搜索过程完整记录如下（可复跑）。

### 搜过的词与命令

```bash
cd server && for p in 'track\(' 'logEvent' 'captureException' 'analytics' 'sentry' 'posthog' \
  'mixpanel' 'amplitude' 'telemetry' 'bugsnag' 'firebase' 'gtag' 'ga(' 'crash'; do
  grep -rn "$p" server/src server/prisma server/package.json server/Dockerfile | wc -l
done
grep -rnwiE "sentry|analytics|posthog|mixpanel|amplitude|telemetry|bugsnag|firebase|matomo|plausible|crashlytics|openreplay|hotjar|clarity|logEvent" server/src/   # 词边界 + 大小写不敏感
grep -rn "track(\|identify(\|pageview\|capture(" server/src/
grep -icE "sentry|posthog|mixpanel|amplitude|firebase|bugsnag" pnpm-lock.yaml        # 锁文件层面也没有
```

**逐词命中数（全部为 0）**：
`track(` 0 · `logEvent` 0 · `captureException` 0 · `analytics` 0 · `sentry` 0 · `posthog` 0 ·
`mixpanel` 0 · `amplitude` 0 · `telemetry` 0 · `bugsnag` 0 · `firebase` 0 · `gtag` 0 · `ga(` 0 · `crash` 0。
补充词：`matomo` / `plausible` / `crashlytics` / `openreplay` / `hotjar` / `clarity` / `segment.io` **均 0**。

⚠️ **唯一一次「命中」是假阳性，值得记下来**：大小写不敏感搜 `sentry` 会撞上
`server/src/billing/price-book.ts:66` 与 `:147` 的函数名 `isEn**tryEffectiveAt**`
（子串 `sEntry`）。**不是 Sentry。** 政策撰写时不要因为它改口。

### 依赖层面的旁证（`server/package.json` 运行时依赖全量）

`@fastify/{cors,helmet,rate-limit,static,websocket}` · `@heyta/{domain,shared-schema,sync-core}` ·
`@node-rs/argon2` · `@prisma/client` · `@simplewebauthn/{server,types}` · `@zxcvbn-ts/language-common` ·
`bcryptjs` · `dotenv` · `fastify` · `jsonwebtoken` · `nodemailer` · `uuidv7` · `ws` · `zod`

⇒ **没有任何观测类 SDK、没有 APM、没有错误聚合服务。**
🟡 顺带发现：`bcryptjs` 在产品代码里**零使用点**（`server/src/` 仅两处注释提到它，
`password/hash.ts:6` 说明「bcrypt 被排除」、`test-routes.ts:55` 说「这里曾经用 bcrypt」）——
它是个**残留依赖**，不影响隐私结论，但会出现在许可证清单里，建议各所有者清理。

### 出网站点穷举（这才是「向第三方提供」的真实清单）

`grep -rn "fetch(" server/src/` + 注入式 `fetchImpl` 逐条核过，服务端**只有 4 类出网**：

| # | 目的地 | 送出去什么 | 证据 |
|---|---|---|---|
| 1 | `https://api.pwnedpasswords.com/range/<5 hex>` | 口令 **SHA-1 前 5 个十六进制字符**（k-匿名），UA `heyta-auth`；仅设口令时调、fail-open、超时 2 s | password/policy.ts:90, 122-128 |
| 2 | 部署者配置的 **SMTP 服务商**（`SMTP_HOST`，代码里不写死；非生产兜底 `smtp.ethereal.email`） | 收件人邮箱 + 邮件正文（含一次性令牌链接） | email.ts:21-31, 38-45；config.ts:427-439 |
| 3 | `https://api.mch.weixin.qq.com`（微信支付 Native） | `appid` `mchid` `description` `out_trade_no` `notify_url` 🔴 `attach = 内部 userId` `amount`；UA `heyta-sync-server/wechat-native` | billing/wechat.adapter.ts:94, 643-681 |
| 4 | **浏览器推送服务**（每个订阅自带的 `endpoint` URL，即 FCM / WNS / Mozilla 等） | POST 密文载荷，载荷明文恒为固定串 `{"type":"heyta:widget-refresh"}`；VAPID JWT 的 `sub` 是**运营者联系方式**（`mailto:`/`https:`） | push/sender.ts:120-150；push/notify.ts:43；push/vapid.ts:112-113, 140-141 |

其余一切（同步 op、口令哈希、令牌、passkey、订单、邀请）**不离开我们的库**。

⚠️ **注意第 4 条的载荷性质**：`endpoint` 本身是能力 URL（schema.prisma:629-632 已标注「不要记进日志」），
推送服务能看到「某个 endpoint 被反复投递」，但读不到内容（aes128gcm，`push-crypto.ts`），
且当前唯一的推送语义是「让小组件去刷新」—— **不含任何用户内容**。

### 政策写法

✅ 可以写：
- 「我们不使用任何第三方分析、埋点、广告 SDK 或崩溃上报服务；服务端代码中不存在这类依赖（含逐项搜索记录）。」
- 「我们不记录 HTTP 访问日志。」（A9：`logger: false`，server.ts:380）

🔴 **不能写**：
- 「我们不与第三方共享任何数据」—— 上面 4 条出网站点就是反例，尤其 HIBP 与微信支付。
- 「我们不会向第三方传输任何与口令相关的信息」—— HIBP 传的是口令摘要前缀，
  必须写成「仅传输口令 SHA-1 的前 5 个字符，无法反推口令，且发送时不携带身份标识」。

---

## 政策撰写提示（服务端）

### 附：保留期与删除（A1–A10 之外，但政策必须有这两节才能落地）

| 事实 | 值 / 机制 | 证据 |
|---|---|---|
| 同步 op 与设备的**统一保留期** | **45 天**（`retentionMs`，注释「Unified retention period for stored ops and devices」） | `server/src/sync/sync.types.ts:547-552`（`retentionMs: RETENTION_MS`，:519） |
| 清理任务 | **每日一次**（启动后 10 s 首跑 + `setInterval` 每日） | `server/src/sync/cleanup.ts:16, 151-168` |
| 清理对象 | ① 已被快照覆盖的旧 op（`deleteOldSyncedOpsForAllUsers`）② 超过保留期未见过的设备行 ③ 过期限流计数 ④ 过期请求去重条目 | cleanup.ts:27-77, :87 |
| 🔴 「删了 N 条」**无条件打日志，包括 0** | 理由是 2026-08 那次全站保留期停摆只能被诊断为「缺失」 | cleanup.ts:33-40 |
| **从未验证邮箱的僵尸账号** | 同一保留期当宽限期自动删除（刻意不加第二个旋钮） | cleanup.ts:17-19 |
| 用户**自助注销** | `DELETE /api/account`，需鉴权，限流 3 次/15 min；`prisma.user.delete` + schema 级联（operations / syncState / devices / passkeys / subscriptions / orders / referrals / notifications 全部 `onDelete: Cascade`）；同时作废鉴权缓存并踢掉活动 WS 连接 | `server/src/api.ts:713-757`（cascade 注释 :733；审计 :746）｜🔴 2026-10-03 更正：上一版写的 `:553-593` 已漂 160 行。级联口径也更正过：**引用 `users` 且 `ON DELETE CASCADE` 的外键 16 条 / 15 张表**（`referrals` 占两条）—— ⚠️ **2026-10-05 现量 20 条 / 19 张表**（在 10-04 那次的 19/18 之上加了 ADR-0054 §2 的 `ai_usage_counters`，它带 `user_id → users` 的 `ON DELETE CASCADE`）。本节里每一个这样的数都只是一次现场读数，它们各自漂过：真值唯一出处是 `packages/legal/tests/structure.spec.ts` 从 `server/prisma/migrations` 现量，政策文案与 ADR 都不许从这里抄。至于更早抄过的「18」与「19」那两个数 —— 那两个数数的是全部迁移里 `ON DELETE CASCADE` 的出现次数，含与账号无关的级联并重复计入历史重建。另：`payment_events` 没有 `userId`，注销后行仍在（订阅指针 `SetNull`）；而**服务端删完 ≠ 用户数据消失**，各端本地明文库今天没有任何清除路径（批次 E，E2/E3） |
| 「清除我的数据」另一条路 | `USER_DATA_DELETED`：只删同步数据、保留账号 | `server/src/sync/sync.routes.ts:327-330` |
| 单条数据删除的语义 | op-log 里是**墓碑**（软删 + `purgedAt` 标记），彻底删除不清 `deletedAt` | AGENTS.md §9（回收站条目）；**具体列语义属客户端考古范围** |

### ✅ 能声明（每条都有上面的行号做证据）

1. **收集范围极小**：账号只需要**一个邮箱**。没有姓名、电话、地址、生日、头像、地理位置、通讯录
   （A1：`users` 列全量清点，schema.prisma:13-70）。
2. **同步内容端到端加密，服务端不持有密钥**；服务端有代码级入站闸门拒绝未加密上传（A2：`sync.routes.payload.ts:47-48`）。
3. **口令不可逆**：Argon2id（19 MiB / t=2 / p=1）+ pepper，PHC 串存库，无明文无可逆（A3）。
4. **passkey 私钥从不离开用户设备**，服务端只有公钥、`credentialId`、计数器；**不采集 attestation**（A4：`passkey.ts:197, 446, 798`）。
5. **不使用任何分析 / 埋点 / 广告 / 崩溃上报服务**，含 14 个关键词的逐项零命中搜索与锁文件旁证（A10）。
6. **不记录 HTTP 访问日志**（Fastify `logger: false`），IP **不落库**（全库无 IP 列），UA 不落日志（A9）。
7. **不发营销邮件**；只发 **5 封纯功能性邮件**（验证邮箱 / 魔法登录 / 找回通行密钥 / 重置口令 / 口令已改安全通知），
   正文是封闭词表、不含用户内容；第 5 封只在成功后发（A5）。
   另可声明：**重置或修改口令会使所有其他设备的登录立即失效**（A3 附表，recovery.ts:210-211）。
8. **员工可见范围有硬白名单**：口令哈希、任何令牌、passkey 公钥与 `credentialId`、
   同步内容（只有条数）、推送 `endpoint` 都不在后台响应中（A8）。
9. **不存支付账号信息**；webhook 原文刻意不存、只存 SHA-256 摘要（A7：schema.prisma:259-261）。
10. ~~**保留期与删除是代码保证的**：45 天统一保留 + 每日清理 + 自助注销级联删（上面附表）。~~
    🔴 **2026-10-03 更正，原句留在这里是为了看清它错在哪一层**：那句里的「每日清理」对**同步事件**不成立。
    `deleteOldSyncedOpsForAllUsers()` 的候选集是
    `CAUSAL_FULL_STATE_OPERATION_WHERE`（`server/src/sync/sync.types.ts:35-40`：
    `SYNC_IMPORT` / `BACKUP_IMPORT`，或带 `repairBaseServerSeq` 的 `REPAIR`），
    而 heyta 的客户端只产 `CRT`/`UPD`/`DEL` —— 全仓（`packages/` + `apps/`，不含
    `research/standalone/` 那份上游抄件）对这三个词**零命中**，所以每日任务的删除条数恒为 0。
    **仍然成立的两半**：设备行的清扫只看 `lastSeenAt`（`device.service.ts` 的
    `deleteStaleDevices`，不挂任何边界），注销的级联硬删也真的在跑。
    取证与影响面见 [trash-and-archive-best-practice.md](trash-and-archive-best-practice.md) §5.3 / 缺陷 D8。

### 🔴 绝对不能声明（说了就是与代码不符）

| 禁止的表述 | 为什么假 | 证据 |
|---|---|---|
| 「服务端完全看不到用户的任何数据」 | 明文元数据 11 项：`entityType` / `entityId(s)` / `opType` / `actionType` / `vectorClock` / `clientTimestamp` / `receivedAt` / `serverSeq` / `payloadBytes` / `schemaVersion` / `clientId` | A2 表（schema.prisma:109-159） |
| 「不向任何第三方传输数据」 | 有 **4 类出网**：HIBP（口令 SHA-1 前缀）、SMTP 服务商（收件址 + 含令牌的正文）、微信支付（内部 userId 进 `attach` 与订单号）、浏览器推送服务（endpoint + VAPID `sub`） | A10 出网表 |
| 「邮件也是端到端加密的」 | 收件人邮箱与一次性链接明文经 SMTP 通道投递 | A5（email.ts:21-31） |
| 「可验证上传的数据确为密文」 | 闸门是**形状检查**，不是密文证明；足够长的 base64 明文能过 | `transport-shape.ts:13-16` 原话 |
| 「不记录时间戳 / 不记录设备信息」 | `operations.receivedAt`、`sync_devices.{userAgent,deviceName,appVersion,lastSeenAt}`、`passkeys.lastUsedAt`、`widget_push_subscriptions.lastUsedAt` 都在存 | schema.prisma:304-321, 80, 658 |
| 「用户数据只有用户自己能访问」 | 🔴 邀请人能在「活动」页看到**被邀请人邮箱的 `@` 前部分**，且该值被**永久快照**进通知；后台还能看到推荐关系**两端邮箱全址** | A6（invite.ts:317-325, 390-419）、A8（admin.routes.ts:696-697） |
| 「管理员看不到任何敏感字段」 | 白名单确实挡住了凭据，但 `email` 全址 + 订单金额 + 设备清单 + **两处把邮箱明文写进日志**是可见/可查的 | A8、A9（admin.routes.ts:419, :489） |
| 「口令会做泄露检查所以很安全」 | HIBP 是 **fail-open**（查不成算通过），确定性那道是本地常见口令表；且下限 8 位是**有意偏离 NIST 15 位**的产品决定 | A3（policy.ts:8-14, 112-115） |
| 「日志不保留」 | 日志走 stdout；`LOG_TO_FILE=true` 时**明文写磁盘** `logs/app.log`，**代码里没有任何日志轮转或过期删除机制** | A9（logger.ts:8-27） |
| 「一次性令牌存哈希所以拿不到」—— 泛化到所有码 | 该立场**只对 CSPRNG 高熵一次性凭证成立**；schema 注释自己划了这条界（低熵恢复码必须限次 + 短 TTL） | schema.prisma:22-23 |

### 撰写时的三条纪律

1. **元数据要与内容分开写**。「端到端加密」这句必须紧跟一句
   「但不覆盖您数据的结构、类型、操作顺序、时间、大小与设备信息」。
2. **第三方清单按目的地写**，不按「服务商名单」写 —— SMTP 与推送服务**取决于每个自建实例的部署者配了什么**，
   代码里没有写死（A5/A10）。官方托管实例要单独披露它配的这两家。
3. **保留期写 45 天 + 每日清理，但补一句**：用户**主动注销**才是即时删除；
   仅停止使用的账号，其 op 要等被快照覆盖且过保留期才由清理任务回收（附表 cleanup.ts:27）。

### 本报告未覆盖（政策需要但要去别的文档）

- **客户端**处理了什么（本地库、通知、键盘/输入法、离线数据）—— 另有 agent。
- **AI 轨道**的数据出境（三道闸、`assertEnableable()`、hosted AI 与 E2EE 不共存）—— 另有 agent；
  法务口径已在 ADR-0005 / 0006 / 0010 / 0013，其中「托管 AI 绝不得被描述为端到端加密」是硬约束。
- **未穷尽的小项**（诚实标注）：① `sync_devices.userAgent` 的具体赋值行没追到；
  ② `docs/e2ee-legacy-data-eradication-plan.md` 未读，故**存量未加密 op 的处置**只写到「闸门不追溯」；
  ③ 落地页/前端是否有任何脚本（那是 `apps/landing`，不在本次范围）；
  ④ 迁移 `20261005000000_invalidate_stored_auth_tokens` 的 SQL 内容未逐行读，只引了 schema 注释；
  ⑤ 🔴 **`server/src/password/recovery.ts` 在本次审计进行中才落地且仍是未跟踪文件** ——
  A3 / A5 关于口令找回的结论以「当前磁盘状态」为准，它若继续变动需重核；
  同时 `server/src/copy.generated.ts` 缺 `server.email.reset.*` / `passwordChanged.*` 两批键，
  **`check:server-copy` 门禁此刻应为红**（要转给该工作流的所有者，不是本报告要修的东西）。
