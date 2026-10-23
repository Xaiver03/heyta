# ADR-0069：共享 op 的逐条签名用哪把钥、签哪些字节、谁能验，以及存量怎么处置

- **状态**：已接受
- **日期**：2026-10-23
- **相关**：[ADR-0067](0067-shared-list-write-routing-and-merge.md) 裁决四（本份补它没定的四格）、
  [ADR-0068](0068-share-member-identity-and-content-publication.md) §五（把 per-op 签名推给 M4 的那一句）、
  [ADR-0062](0062-shared-list-key-distribution.md) 决策 9（不设全局身份目录）、
  [ADR-0019](0019-upload-rejection-does-not-block-download.md)（永久拒绝的客户端处置）、
  [ADR-0016](0016-undecryptable-ops-do-not-block-sync.md)（解不开不阻断同步）

---

## 背景：0067 说"形状已一次定下"，但那句里空着四格

ADR-0067 裁决四的原话是「逐 op 签名要加 `signature` 字段（写侧签、服务端验、验失败按**永久拒绝**处置），
实现落在 M4 —— 目的就是不在几周后为签名再动一次线协议」。这句话把**动作**定下了，把**四件必须回答的事**留下了：

1. 服务端拿**哪把钥**验？—— 成员行里在册的那枚公钥是 **X25519 封装钥**，它在数学上就不能签 Ed25519 的签名。
2. 签名公钥**怎么在册**？—— 今天没有任何一条腿把它交给服务端。
3. 读者怎么知道**这条 op 是谁写的**？—— 共享日志的行里没有作者列，载荷又是密文。
4. **存量 op**（签名启用之前落库的那些）算通过还是算失败？

这四格任何一格留空，实现时都会随手选一个，而那是**线协议 + 表结构** —— 事后改就是破坏性变更。
所以本 ADR 一次答完。

---

## 事实基线（每条带现量命令，别按本节文字推断）

1. **签名原语在、零消费者**。`packages/sync-core/src/share-keys.ts` 里有
   `buildShareOpSignatureMessage` / `signShareOperation:543` / `verifyShareOperationSignature:552`，
   且带单测（`packages/sync-core/tests/share-keys.spec.ts:288-308`）。
   复量：`grep -rn "signShareOperation\|verifyShareOperationSignature" packages/*/src apps/*/src server/src`
   ⇒ 只命中定义处、`packages/sync-core/src/index.ts` 的导出，与 `packages/app-host/src/share-client.ts:32` 那句
   "接线时把签名放进 op 的 `signature` 字段即可" —— **没有一处真的调用**。
2. **在册的那枚成员公钥是 X25519**。`server/prisma/schema.prisma` 的 `ShareMember.identityPublicKey`
   注释原文：「成员在**接受邀请时**发布的 **X25519 封装公钥**（base64）」。
   消费侧同证：`sealListKeyForRecipient({ recipientX25519PublicKey: fromBase64(m.identityPublicKey) })`。
3. **线协议与表里都没有签名，也没有作者**。`ShareOpWire`（`packages/sync-client/src/share-api-client.ts:88-102`）
   与 `ShareOperation`（`server/prisma/schema.prisma:396-418`）两处的字段清单里既没有 `signature`，
   也没有 `authorUserId` —— 行里只有 `clientId`（设备内不透明 id），它**不能**当作者身份用。
4. **Ed25519 私钥设备侧早就有，只是没人拿**。`deriveShareIdentityKeyPair(seed)` 回
   `{ed25519PublicKey, ed25519SecretKey, x25519PublicKey, x25519SecretKey}`，种子以 wrap 形式存在
   `share-key-store.ts` 里；但 `readShareOwnIdentity`（`apps/web/src/features/share/share-key-store.ts:214-229`）
   的返回类型**只列了 X25519 两半** ⇒ 签名所需的私钥在链路上是"拿得到、没人拿"。
5. **既有签名域不含合并语义要读的那几枚字段**。消息体是七元组
   `['heyta:share-op-sig', SHARE_KEYS_FORMAT_VERSION, opId, clientId, shareId, keyEpoch, ciphertext]`。
   `opType / entityType / entityId / vectorClock` 都在**签名之外**，而它们正是服务端与读侧判并发、判冲突要用的字段。
6. **上传端点不挡未知字段**。`server/src/shares/share.routes.ts:148` 是
   `ops: z.array(z.object({}).passthrough())` ⇒ 加 `signature` 不会被 400 拒掉，
   ⚠️ 但也意味着"字段被静默丢掉"同样不会有任何报错 —— 服务端**必须显式**把它读出来并落列。

---

## 裁决

### 一、签名钥 = 已有的 Ed25519 身份子钥，不新造第三把钥、不做全局目录

- 每台设备在每一份 share 里已经有一份 HKDF 派生的身份种子，里面同时含 Ed25519 与 X25519 两对
  （`share-keys.ts` 文件头那句"Ed25519 管谁改的、X25519 管谁能解"就是为此准备的）。
- **排除项**：① 用 X25519 签（数学上不行，别写这种代码）；② 另立一把"签名钥"（多一份要备份、要撤销、要过世代的密钥，
  而它解决的只是同一件事）；③ 全局身份目录（ADR-0062 决策 9 明确不设，签名钥同样按 **share 作用域**发布）。
- 换钥世代语义：签名消息里含 `keyEpoch` ⇒ 一次 rekey 之后旧签名对新世代自然不成立，
  与 M3 那套"信封按世代对账"同一条轴，不需要为签名再加机制。

### 二、签名公钥的发布：随接受邀请一起交，老成员有补发通道

- 接受邀请那一腿（`acceptInvitation({ token, identityPublicKey })`）**新增一枚可选字段**
  `signingPublicKey`（Ed25519 公钥，base64）；服务端存进 `share_members.signing_public_key`（**nullable**）。
- 已经入群、当时没交过的成员：下次进成员面板时补发一次（幂等 PUT，与 `autoSeal` 那轮对账同处）。
  🔴 补发**只补公钥**，不动 listKey、不换世代、不产生 op。
- 服务端在**没有**上传者签名公钥时**不接受带签上传，也不接受无签上传**（见裁决四/六）：
  一个既不能签又不能验的作者不是"暂时没配好"，而是这条 op 无法归因 —— 宁可具名失败。

### 三、签名域现在就扩，扩到"合并语义要读的那几枚服务端可见字段"

把 `opType / entityType / entityId / vectorClock` 加进被签的消息体（其余七元组不动，编码仍是
`JSON.stringify([...])` 的固定顺序）。

- 理由（这条是本 ADR 里唯一"看起来可以以后再说"的那格）：不改的话，**服务端可以重写 `vectorClock`
  把两条并发伪装成有先后、或改 `entityId` 让冲突判定错位，而签名照样成立**。
  那"逐 op 签名"对外给的承诺就是假的 —— 而 ADR-0067 裁决三刚把"并发同字段必须可见"钉成产品承诺。
- 成本窗口：今天零消费者 ⇒ 改域**不破坏任何存量**（存量本来没有签名）。
  一旦 M4 落地、开始有带签的 op 进库，再改就是不可逆层事故。🔴 **这就是"现在做"的全部理由。**
- 🔴 **不把 `serverSeq` 放进签名域**：它是服务端分配的，客户端签的那一刻不可知。
  推论要写清楚：**顺序完整性与"少给/截断"仍然不解决** —— 服务端可以只下发前 N 条、可以重排行序，
  签名对此保持沉默。这与 ADR-0016/0019 那条既有边界（服务端看不到内容，但能少给）同源，
  本 ADR **不声称解决它**，只要求：客户端检测到 `serverSeq` 缺口时如实上报（具名诊断），不许静默当成"就这么多"。

### 四、服务端验签在上传边界，只验上传者自己那一枚，失败=永久拒绝

- **作者必须等于上传者**：一条 op 只能由上传者自己的在册签名钥签，**不许代签**
  （代签等于把"谁改的"重新交给服务端信任，而这条线整个设计的出发点就是不信任服务端）。
- 验失败/无签名/无在册公钥 ⇒ **具名错误码**，形状对齐既有词表：
  `SHARE_OP_UNSIGNED` / `SHARE_OP_SIGNATURE_INVALID` / `SHARE_OP_SIGNING_KEY_UNREGISTERED`。
- 客户端处置沿用 ADR-0019 的语义：**永久拒绝 ⇒ 把那条 op 移出待上传队列 + 如实上报 + 不阻断下载**。
  ⚠️ 个人那条腿的名单在 `packages/sync-client/src/client.ts:54`（`PERMANENT_REJECTION_CODES`），
  而**共享那条腿是另一条路径**（`ShareOpUploadResult.rejected`）—— 它今天有没有"移出队列"这套处置要现量，
  没有就一并补，别把个人路径的绿读成共享路径也有（#535 那一族的同一条错）。
- 服务端**不得**把验签失败降级成"记一笔然后收下"：那等于开了一个"伪造成员写入"的通道，只是多留了条日志。

### 五、读侧对偶：每条下载的 op 都验签，三类结局分开

- 读者拿成员表里的公钥验每一条：**通过 / 未签名 / 失败** 是三态，不许折叠成两态。
  🔴 **"未签名"不等于"已验证"** —— 它既不能在读侧被当成真，也不能在界面上被省略。
- 验签**失败** ⇒ 该条内容**不物化**（宁缺勿假），并给一条**具名、可见**的报警；
  其余 op 照常同步，不阻断（ADR-0016 的形状）。
- 报警落点复用现有那一族（"解不开/读不到"在界面上已有的具名失败位），**不新建第二套语义**。
- 这条是"签名真正值钱的那一半"：服务端看不到明文，所以它**唯一**能对内容做的破坏就是改密文与改元数据；
  写侧验签挡不住它改自己库里的行，**只有读侧验签能**。（写侧验签的意义是别把伪造件收进日志去污染别人的读侧。）

### 六、存量不追签，新写入一律带签；无签上传直接永久拒绝

- 本项目还在开发阶段、没有真实用户与存量数据（AGENTS §0）⇒ **不必**为兼容旧客户端留"允许无签"的窗口。
  留那个窗口等于留一条"永远可以不带签"的活路，而它以后要靠一次破坏性变更才能关掉。
- 历史/开发期已落库的无签 op：**不追签**。补签要拿成员私钥重放历史，签出来的"作者时点"是假的，
  且重放本身违反"被回放的 op 不得再触发副作用"（AGENTS §3.4）。读侧按"未签名"如实显示。
- 🔴 **翻案条件**：一旦出现真实存量数据需要转正，走 ADR-0068 §三 那一次显式的「发布快照」
  （由快照的作者重新签一批），**不是**给旧 op 补签。

### 七、零 `CURRENT_SCHEMA_VERSION` bump

- `signature` / `signingPublicKey` 是**线协议与传输层**的字段，不是实体载荷字段 ⇒
  不碰 `packages/shared-schema` 的实体清单、不 bump 版本（AGENTS §3.3）。
- 服务端两枚新列都是 **nullable**（`share_members.signing_public_key`、`share_operations.signature`），
  迁移走 `cd server && sh scripts/migrate-deploy.sh`，**永不修改已应用的迁移**。

---

## 明确不做（本 ADR 范围内）

- 不做**顺序完整性 / 防截断**（裁决三已说明为什么签名不解决它，以及它落在哪条既有边界上）。
- 不做**否认写入**（签名钥与身份种子同源派生 ⇒ 成员无法否认自己签过的 op；这是要的性质，不是缺陷，
  但本 ADR 不引入"故意可否认"的任何变体）。
- 不做个人 op-log 的逐条签名（个人那本 log 的作者就是账号本身，服务端就是它自己的存储，威胁模型不同）。
- 不做签名钥的**轮换**世代机（`keyEpoch` 已经覆盖"换 share 钥"那一族；签名钥自身的轮换等真有泄露事件再说）。
- 不做移动端接线（M6）。

---

## 后果

- 判据三层各要能红：① 纯函数层（封闭词表 + "改一个字节必被拒"，含新加进签名域的那几枚字段各自被改都要红）；
  ② 服务端层（上传边界三种具名失败各一条，且**永久拒绝**在客户端那一侧真的移出队列）；
  ③ 读侧/界面层（篡改盘上那一枚签名 ⇒ 另一台读到具名失败，而不是静默的错数据）。
- `BLOCKED.md` 与 `docs/plans/launch-blockers.md` 里"签名原语零消费者"那两处在册断言，M4 收口时要按现量改口。
- `scripts/check-reachability.mjs` 里那条"原语已有、缺的是接线"的注释同步改口（它点名的就是这三枚函数）。
- 线协议加字段 ⇒ 四端产物都要重装核对（AGENTS §6.1.1 的固定收尾）。

## 落地顺序

1. 裁决三（签名域扩字段）+ 裁决一（取钥）：纯函数层，先把"改一个字节必被拒"钉住。
2. 裁决二（公钥发布那条腿：接受邀请 + 补发 + 服务端列与迁移）。
3. 裁决四（服务端验签 + 具名码 + 客户端永久拒绝处置）。
4. 裁决五（读侧三态 + 不物化 + 具名报警）。
5. 裁决六（关掉无签通道：服务端拒无签上传 ⇒ 写侧必须真的会签，顺序上它必须在 3 之后、验收之前）。
