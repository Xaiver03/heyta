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

> ⚠️ 这一节是**立这份 ADR 那一刻**（2026-10-23 上午）的基线，写它是为了钉住"为什么必须现在定"。
> 第 1 条那句"零消费者**今天**成立"随 M4 落地已翻 —— 改口与复量命令在文末**实施记录**，别照本节施工。
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

### 三、签名域现在就扩，扩到"全部服务端可见元数据"（同日修订，修订理由在格内）

**本裁决写下去之后现量到一件改变范围的事**：`opRecordAad`（`packages/sync-client/src/share-payload-cipher.ts:73-82`
→ `encryptShareRecord`）已经把 `clientId / actionType / opType / entityType / entityId / entityIds / timestamp / schemaVersion`
**全部绑进 AEAD 的 AAD**。所以"改这些字段"今天就会解不开 —— 我第一版把 `opType/entityType/entityId` 说成
"没被保护"是**说重了**。真正一格没被保护的只有 `vectorClock`（它既不在 AAD 里，也不在签名域里）。

那签名还要不要签这些字段？**要**，但理由换一条更硬的：

- 服务端**没有清单钥**，所以它永远做不了 AAD 一致性检查。让它能在上传边界就拒掉伪造件，
  签名必须覆盖这些字段 —— 否则"服务端验签"验的只是密文，改一行元数据它照样收。
- 读侧要能区分**两种不同的失败**："签名无效"（有人在动我的数据）与"解不开"（世代/钥的问题，ADR-0016 那一族）。
  域里少一枚字段，这两类就会互相顶包。

⇒ 定下来的规则（比逐枚点名更不容易漏）：**签名域 = 线协议里除 `serverSeq` 与 `receivedAt` 之外的全部字段**。
`serverSeq` / `receivedAt` 由服务端分配，客户端签的那一刻不可知，签不进去。

两条实现纪律（都是这格改动的直接推论，缺一条就会造出**假失败**）：

1. 🔴 **对象键必须规范化排序**。`vector_clock` 在服务端是 **jsonb** —— 它不保留键的插入顺序。
   签名方与验签方各自 `JSON.stringify` 一份逻辑上相同的时钟若拿到不同字节，
   每一台**非签名者**的设备都会把这枚合法签名读成失败。⇒ 编码走递归排序键名的规范化，数组顺序保留。
2. **`entityIds` 按集合签**（排序后签）：它的语义是集合（`db-op-log-store.ts:314` 用 `includes` 判），
   顺序不许成为完整性判据；**成员变**才算篡改。
3. 规范化遇到 `bigint` / 非有限数**响亮抛错**，不许让 `JSON.stringify` 把它们悄悄变成别的值 ——
   那等于两个人签了两个不同的域而没人报错。

🔴 **不把 `serverSeq` 放进签名域**的推论要写清楚：**顺序完整性与"少给/截断"仍然不解决** ——
服务端可以只下发前 N 条、可以重排行序，签名对此保持沉默。这与 ADR-0016/0019 那条既有边界
（服务端看不到内容，但能少给）同源，本 ADR **不声称解决它**，只要求：客户端检测到 `serverSeq` 缺口时
如实上报（具名诊断），不许静默当成"就这么多"。


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
- 🔴 **修订（2026-10-23，M4-5 落地时撞到的那一格）：验签名单必须包含已被移除的成员。**
  上面那句"拿成员表里的公钥验每一条"默认了"成员表 = 写过这条 log 的人"，而两件事并不相等：
  面板问的是"**现在**谁在这份清单里"（`removedAt: null`），读侧问的是"这本 log 里那些署名的 op **可能**是谁写的"。
  拿前者答后者 ⇒ 症状是**从"把某人移出清单"那一刻起，他写过的每一条连同其后所有人的改动一起读不出来**
  （游标停在第一条 `signer-unregistered` 之前，界面上报一句"查不到作者登记的签名"——
  而那句话会把人往"有人在改我的数据"上引）。这一形不是设想：建第 13 步验收时实测撞到，
  变异臂 `roster-active-only`（`research/tools/mutation-rigs/mutate-collab-upload-gate.mjs`）就是它的常驻反证。
  ⇒ 新增一枚**只回公钥**的端点 `GET /shares/:id/signing-keys`（现役 + 已移除，成员可见），读侧名单改取它；
  `GET /members` 继续只答"现在谁在"。**为什么不给 `/members` 加一个 `includeRemoved` 开关**：那是一条端点答两个问题，
  面板迟早会把退出的人画成现役成员（那是另一格错误），而这两份答案以后会各自漂移。
  泄露面为零：公钥本来就是公开的（`/members` 早就把 `identityPublicKey` 发给成员了），
  而这本 log 的存在与条数本来就可被成员看见。

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

---

## 实施记录（2026-10-23，M4 五批全部落地）

**上面那五步都做到了，顺序也照走了。** 每层判据现在住在哪里（要复核就打这一列，别信本节的转述）：

| 层 | 落点 | 常驻判据 | 能不能红，谁验过 |
|---|---|---|---|
| ① 纯函数（封闭词表 + 改一字节必被拒 + 域内每格各自被改都要红） | `packages/sync-core/src/share-keys.ts`（`buildShareOpSignatureMessage` / `signShareOpWire` / `classifyShareOpSignature`） | `cd packages/sync-core && pnpm test` | 变异臂见 `research/tools/mutation-rigs/README.md` 里 M4 那几行 |
| ② 服务端上传边界（三种具名结局 + 永久拒绝=不落库） | `server/src/shares/share.routes.ts`（`SHARE_OP_SIGNATURE_CODES` + 逐 op 闸门） | `pnpm verify:collab-sync` 第 13 步（13.1–13.4） | `mutate-collab-upload-gate.mjs` 四臂 `ARMS=pass (4/4)` |
| ③ 读侧 / 界面（三态、不物化、具名报警、游标不越过被拒那条） | `packages/app-host/src/share-verify.ts` + `apps/web/src/features/share/ShareSignatureNotice.tsx` | `cd packages/app-host && pnpm test`、`cd apps/web && pnpm test`、`pnpm verify:collab-sync` 第 13.5/13.6 步 | `mutate-collab-read-verify.mjs` 七臂 `ARMS=pass (7/7)` |
| 裁决二那条"补发"腿（owner 那一行） | `PUT /shares/:id/members/:memberId/signing-key` | 第 13 步在建共享后第一件事就是打它 | 不在册 ⇒ 第 5 步立刻红（首跑实测就是这个形状） |

**实施期间改口/新增的三格**（都是裁决文本没覆盖、被验收逼出来的，按"新写不改结论"的规矩登记在这里）：

1. **验签名单必须含已移除成员** —— 见裁决五那条 🔴 修订。新增 `GET /shares/:id/signing-keys`，
   web 的 `verifiersFor` 改取它；`verify-collab-sync.mjs` 的两处宿主同形。
2. **签名域不含 `keyEpoch`**（裁决三实施时确认）：它在密文信封头 9 字节里自描述，而信封整体就是域里那枚
   `ciphertext` ⇒ 改世代必然改被签的字节。签名件因此不需要认识信封格式，替身加密器也签得出来。
3. **`signature` 必须从**原始请求体**读**：`SuperSyncOperationSchema` 是 strip 的 `z.object`，
   从校验后的对象读会永远读到 `undefined`，症状是"每一枚合法上传都被判成没签，而服务端一句错都不报"。

**仍未做到的两格（如实，不当已完成）**：

- 服务端可以**同时**抹掉 `signature` 与 `signer_member_id` 再下发 —— 那一行会被读侧读成"存量/未签名"而放过。
  这一格不是 M4 的范围（它要的是"服务端不能改自己的库"，那落在 TLS/审计/可复现构建那一侧），
  登记在这里是为了别让第 13 步的绿被读成"服务端作恶也被挡住了"。
- 读侧拿不到名单时整轮拉取失败（具名抛错），评论区那一层今天把它渲染成"不画"：
  ⇒ 本轮**只有"验不过"这一档在界面上有一句具名报警**，"取不到名单"那一档只有宿主层的名字，没有文案。
  补它要连 i18n 两条 key 与那枚通知位一起判，不在 M4 的读数里。

**验收读数**（现量，别抄本节数字）：
`node scripts/verify-collab-sync.mjs` ⇒ 末行 `RESULT=OK steps=13`；
`node scripts/verify-collab-revoke.mjs` / `-conflict.mjs` ⇒ `steps=8` / `steps=6`；
`node research/tools/mutation-rigs/mutate-collab-upload-gate.mjs` ⇒ `ARMS=pass (4/4)`。

---

## 补记（2026-10-24，M6 移动端接入之后）

上面那份实施记录写的时候，计划 §9.12 末尾还挂着一句「**移动端零接入** —— 它今天**写不出**带签名的 op」。
那条腿现在接上了，形状是：

- **签名件没有被复制第二份**。移动端用的还是 `packages/app-host/src/share-client.ts` 的 `signShareOpWire`
  与同一套四态词表（裁决一/三对"签哪些字节"的定义只有一处），壳只注入两个端口：
  私钥从**原生安全存储**取（`apps/mobile/src/share/share-session.ts`），名册走
  `GET /shares/:shareId/signing-keys`（裁决五那条 🔴 修订要求含已移除成员，移动端同样吃这条）。
- **判"手机写出的每一条到底可不可验"的那把尺不在单测里**，在界面腿上：
  `scripts/verify-mobile-collab-ios.sh` 第 8 步 —— owner 侧下载手机写的那条 op，
  用**名册里的公钥**重验，词表里必须是 `verified`。
  🔴 刻意**不是**"服务端返回 200"：裁决四说的那件事只有拿钥重验才量得到，
  而服务端收下 ≠ 另一台成员验得过。复量：`pnpm verify:mobile-collab:ios`。
- ⚠️ **Android 那一侧没有设备读数**（出包与设备腿按负责人的长期令一律走 `ssh windows-pc`，本批没开那条窗口）。
  ⚠️ 这句原先写的是"今天没有"，2026-10-27 按 #600 改口：**它判的是"截至本 ADR 补记时没有"，不是"现在也没有"** ——
  本补记写下那一刻的载体形状是**半装**（`adb` 与一枚 AVD 在、**缺两枚**：`Sdk\emulator` 主程序与 `system-images` 整目录、无真机接入）。
  ⚠️ "现在缺不缺"这句不许从本 ADR 读 —— **判它要重跑计划 §9.29 那三条取法**。同日 19:0x 把加速那一档也量了：
  三枚虚拟化可选组件全未启用、VT-x 被 VBS／内核隔离占住 ⇒ x86_64 镜像只剩 WHPX 一条加速路，而启用它要管理员 + 重启这台共享装机；
  其余前置（Java／网络／磁盘／内存）都不拦。所以"Android 设备腿没读数"的**理由是装机 + 一次重启，不是排期**，
  逐格读数与那条"未判定"实验的断言在 §9.29（格位在计划 §9.14 与 §9.28 ③）。
  iOS 与 Android 共用同一份 `@heyta/app-host` 装配，但**"共用源码"不等于"两端都验过"** ——
  这条纪律本线踩过（注销销毁那一格就是因为有两份 `removeDatabase` 实现，必须各量一发）。
  登记在册，别把上面那条绿读成"移动端全绿"。

### 追记（2026-10-26，M6 设备腿读数到手）

上面那条「判手机写出的每一条到底可不可验」的尺，**第一次有了真机读数**：
`pnpm verify:mobile-collab:ios` 第 31 跑（2026-10-25）第 8 步 ⇒ 手机写出的那条 op 在 owner 侧
拿名册里的公钥重验 = `verified`，整趟 `39 通过 / 0 失败`。裁决四/五在移动端这一侧不再是"只有单测的形状"。

同一趟还顺手把裁决二那句"新写入一律带签"往**可读回**那一格推了一步：设备腿 L2 抓到
"加入之前就在清单里的东西"没有任何一条携带路径（两壳同形，与本 ADR 无关但影响它那句承诺能不能被用户看见）——
修法与判据记在 ADR-0062 实施记录第 5 条、计划 §9.14 第 4 条。

### 追记（2026-10-27，第 52 跑：三族的上行在设备上各自验签过，而本 ADR 只承诺带戳的那份读数）

上面那句"复量：`pnpm verify:mobile-collab:ios`"到第十三批又跑了一趟（第 52 跑，起建 `0cdaf8fdf`），
这一趟比 10-26 那次多出来的是**上行那一族各自的名字**：`COMMENT seq2 / TASK seq7 / NOTE seq8`
三枚都从 owner 侧拿名册公钥重验回 `verified`（逐格读数与逐张看过的截图在计划 **§9.24**，
证据目录 `apps/mobile/evidence/collab-ios-10271632/` 整份入库）。裁决二/四在移动端至此**三族都有可读回的签名证据**。

🔴 **给读这份 ADR 的人一条口径**（成因与教训见环境陷阱 **#600**）：本 ADR 里的设备读数**一律是带戳的**——
它代表"对 `0cdaf8fdf` 那一棵树"成立，不代表你此刻的 `main`。要把某一格用到此刻的树上，
唯一的动作是再跑一趟（`pnpm verify:mobile-collab:ios`），而它同样会在几分钟内退化成又一份带戳的读数；
判断"这串数还代不代表你所在的树"请跑计划 §9.24 末尾那把**两端都钉成具体提交**的差集命令，
**不要**把这里任何一句读成"设备腿当前是绿的"。
