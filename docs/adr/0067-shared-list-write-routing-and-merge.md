# ADR-0067：共享清单的写路径路由与多写者合并语义（一次承接 M2 与 M4 的线协议形状）

> 状态：**已接受（工程裁决 2026-10-22）**。本 ADR 不改 [ADR-0062](0062-shared-list-key-distribution.md) 的任何结论，只承接它「未落地」那一格里剩下的最后一件：
> **哪些 op 进 share log、多写者下怎么合并**。实施分期见文末「落地顺序」——M2 做路由与因果时钟，M4 做逐 op 签名，**线协议一次定**，不做两次变更。

## 背景：元数据面全在，内容面差的就是"路由"这一格

0062 把共享清单拆成元数据面（邀请 / 角色 / 转让 / 信封）与内容面（op 的搬运）。到本 ADR 立项时：

- 元数据面在 main 上，旅程绿（`pnpm verify:collab-journey`）；
- 内容面的**评论那一族**上下行都通到了宿主层（M1 下行 + 上行 dispatcher、M5 信号驱动、M3 移除即换钥）；
- 任务与清单的改动**照旧进个人 op-log** ⇒ 两个成员互相看不到对方改了什么。

所以这条线唯一还欠的功能面就是这一格。而它不是"多写一个 if"：它同时决定**多写者下的合并语义**，而合并语义住在不可逆层（`packages/op-log` 的 reducer 与 `packages/shared-schema` 的线协议）。

## 事实基线（每条都带现量命令，别按本节文字推断）

1. **服务端不拦，是客户端没往那走。** 可写白名单今天已经认识任务族：
   `grep -n SHARE_WRITABLE_ENTITY_TYPES server/src/shares/share.membership.ts` ⇒ `TASK / PROJECT / TAG / NOTE / COMMENT`；
   逐 op 判定在 `server/src/shares/share.routes.ts` 的 `decideShareOpWrite(role, op.entityType)`。
2. **写意图没有"目标日志"这个维度。** `packages/op-log/src/engine.ts` 的 `OpIntent` 只有
   `entityType / entityId / opType / payload / entityIds?` ⇒ 路由判据必须新立，不是在壳里加条件。
3. **share 侧的向量时钟是常量。** `grep -n 'vectorClock:' packages/app-host/src/share-client.ts` ⇒
   `vectorClock: { [options.clientId]: 1 }` —— 每次都是 1，不读也不写任何跨 op 的时钟状态。
   个人引擎那侧是真自增（`packages/op-log/src/engine.ts` 里写前算 `clock[clientId] + 1`、写后 `mergeVectorClocks`、远端到达时 `observeRemoteClock`）。
   ⇒ 任何两条 share op 的时钟都是 `{我:1}` vs `{我:1}`，`compareVectorClocks` 只能判 EQUAL / CONCURRENT，**因果边根本不存在**。
4. 🔴 **计划 §9.2 P-3 的前提被源码否证**（本 ADR 立项时现量，2026-10-22）：P-3 写的是
   「现状是个人清单那套 LWW：**整条记录**按 timestamp 比，赢者覆盖」。实际 reducer 早就是**字段级**版本化 ——
   `packages/op-log/src/state.ts:577-596` 对 payload 的**每个键**各调一次 `addFieldVersion`，
   `:242-253 selectVersion` 先剔掉被因果压着的候选、再按 `compareMeta`（`:228-240`：因果 → timestamp → clientId → opId）决胜。
   ⇒ 要做的**不是把合并改成字段级**（它已经是），而是**让 share 分区拿到真实的因果时钟**，否则字段级前沿永远只能靠 timestamp 平局猜。
   这一格改口同时写回 [计划 §9.2](../plans/collaboration-shared-lists.md)。
5. **share 域今天没有任何冲突概念。** `packages/app-host/src/share-op-log.ts` 的 `foldShareOps` 只按 op id 去重；
   `replayShareOps` 顺序喂 `applyOperation`，不产个人引擎那侧的 `overwritten[]`，也不接 `ConflictResolutionView`。
6. **`actionType` 是人读标签，不是语义键。** `packages/app-host/src/share-client.ts:82-93` 那张表只登记评论三档，
   未登记的 `opType` **抛错**；文件头自己记着"全仓没有集中登记表，它是每条动作自己起的名字"。
   个人侧则是模板 `${opType}_${entityType}`。⇒ 语义只能锚在 `(entityType, opType)` 上。

## 裁决

### 一、路由判据 = 「这条实体所属清单的 `shareId` 是否在册」，唯一判据

- **不按实体类型**（类型只决定服务端角色白名单，那是上传边界不是路由）、**不按成员角色**（角色拒绝发生在服务端，客户端不复制一份判据）。
- 判据函数**只许住在 `packages/app-host`**：把现在埋在 `packages/app-host/src/comment-actions.ts` 里那两跳解析
  （`taskId → project.projectId → project.shareId`）**同源化**成一枚按 `entityType` 泛化的导出函数，
  评论族与任务族共用同一份实现。宿主外壳（`apps/*`）不许出现任何"该进哪本 log"的判断（AGENTS §3.5）。
- 解析不出来（任务没有 `projectId`、清单没有 `shareId`）⇒ **走个人 log**，不猜、不报错。
  这是"未共享清单写进 share ⇒ 红"那一格的正面形状。
- `Project.shareId` 这个绑定本身**留在个人 log**（它写的是"这台设备的这条清单绑到哪条 share"，属成员自己的视图状态；
  写进 share log 会把绑定变成共享写，新成员加入时被迫回放别人的历史）。加入流程由 `JoinSharedListDialog` 自己建绑定。

### 一·补 裁决一覆盖不到的三类（2026-10-22 实施 M2-a 时按代码现量补，不改上面任何一条）

补这一节的原因是**代码事实**，不是设想。补一与补二各撞自一格（下面两条），
补三撞自同一天做 M2 任务族验收臂时的第三格（写在补二之后，判据本身不变）：

- `packages/domain/src/entities.ts` 的 `Tag` 只有 `name / color`，**没有清单归属**；
  而同一文件里 `Project.shareId` 的字段文档已经承诺「本清单内的任务/**标签**/便签/评论的 op 走 share op-log」。
  ⇒ 按裁决一那条"所属清单的 `shareId`"判据，TAG **解析不出来**，那句承诺落不了地。
- `packages/app-host/src/actions.ts` 有 `moveToProject` / `bulkMoveToProject`（写 `projectId`），
  而 `Task.tagIds` 是**整组覆盖的普通字段**（`setTags`）。
  ⇒ 一条共享任务的 `tagIds` 会带着 B 侧**解不出名字**的 id 过去；而"把任务移出共享清单"这个动作
  在 E2EE 追加日志上**收不回已经发给其他人的那份密文**。

**补一（标签）：「把这条标签发布进这份共享清单」是一条独立意图，独立一条 op。**

- 触发点：给共享清单里的任务写 `tagIds` 时，其中**尚未出现在这份 share 状态里**的 tagId 各补一条 TAG 发布 op（幂等：已在册就不发）。
- 为什么算两条 op 而不违反"一个意图 = 一个 op"：用户的意图是"给这条任务打这个标签"，
  而"这份共享清单里得先有这个名字"是**另一件事**——它改变的是别人的可读视图（标签名与颜色从此进入这份共享），
  不改变这条任务的任何字段。两本 log 各一条 op，不是同一本 log 上两条。
- 代价，写清楚不藏：**标签名会泄露给这份清单的所有成员**（包括这个标签在你个人清单里被用在别处的那些上下文）。
  这不是本 ADR 新引入的口径——`Project.shareId` 的字段文档与隐私政策 1.9 那条"共享关系可见"已经把它当既定承诺；
  本条只是把它变成可实现的行为。**翻案条件**：若产品认为标签词表属个人语汇、不该外泄，
  那就得给 `Tag` 加清单作用域（一次 schema 变更，另立 ADR），而不是让共享任务带着解不出名字的 `tagIds`。
- 反向**不撤销**：从任务上摘掉标签不把标签从这份共享里收回（追加模型，见补二的同一条理由）。

**补二（跨边界移动）：M2 里具名拒绝，不做"两本 log 各写一半历史"的搬运。**

- 拒绝范围：把任务/便签从共享清单移到个人清单、从个人清单移入共享清单、在两条共享清单之间移（`moveToProject` / `bulkMoveToProject` 的这三形）。
- 两条理由，缺一不可：
  ① **不可撤销性**：移出共享清单不能把已发给其他成员的密文收回来，界面上给出"移出了"的错觉是**对外谎报撤销能力**；
  ② **历史会裂成两半**：实体既有字段在个人 log、新字段在 share log（或反之），任何一侧单独回放都得到一条残缺实体，
     而"一个意图 = 一条 op"要求的是同一条日志里的一个事件。
- 落地形状：宿主侧给**具名错误**（不是静默忽略、不是悄悄只写一半），UI 在 M2 期间对共享清单里的任务不提供该动作。
  真正的"跨清单搬迁"要等它自己的裁决（涉及密钥世代与删除语义，与 M3/M4 同一族）。
- `setProjectShareId` 的**解绑**那一形归在同一条理由下：解绑只改这台设备的本地绑定（留在个人 log，见裁决一），
  它**不撤销**任何已经复制出去的清单内容——界面上不许出现"取消共享即收回内容"这类暗示。

**补三（新建那一形的归属从哪读）：实体还不在这台设备的状态里时，"所属清单"只能取这次写入自己声明的那个。**

- 撞出来的代码事实：`packages/app-host/src/share-routing.ts` 的两跳解析只认**已存在的实体**
  （`state.tasks[entityId].projectId`）。一条 `CRT` 的 `entityId` 此刻还不在状态里 ⇒
  解析成 `entity-not-found` ⇒ 按裁决一判成 `personal`。
  后果不是风格问题：**A 在共享清单里新建的任务永远不会出现在 B 那台设备上**——
  与 M2 之前那一格症状相同，只是藏在"新建"这一形里。同一格还把
  `crossesShareBoundary` 的"源"读成 `undefined`，与目的地的 shareId 不等 ⇒
  在共享清单里点「加一条任务」当场抛「暂不支持跨清单移动」。
- 落地形状：判据一个字不改（还是"所属清单的 `shareId` 是否在册"），只补"这条实体属于哪条清单"
  的第二种取值 —— TASK/NOTE 取 `payload.projectId`，COMMENT 取 `payload.taskId` 所属那条清单。
  回退**只在 `entity-not-found` 这一形**上发生；其余阻塞原因（有实体但没清单、清单没共享、
  类型本就不该进共享）原样返回，否则载荷里塞一个 `projectId` 就能绕过裁决一。
  补二那条"跨边界移动"只在**实体已存在**时才判：新建不是一次移动，没有"从哪儿搬走"的那一侧。
- 判据（能红）：`packages/app-host/tests/share-routing.spec.ts` 的「新建（CRT）那一形的归属解析」七枚 ——
  共享清单里新建 ⇒ 进 share 且个人侧零调用；个人清单/收集箱新建 ⇒ 进个人且不抛；
  通道没装上 ⇒ 具名拒绝；便签与评论同形；实体已存在时的移出**仍然**拒绝（防回归）。
  修好前实测 4 枚红（`4 failed | 29 passed`），修好后 `33 passed`。

### 二、多写者合并 = 复用同一份 reducer 与同一份 `compareMeta`，不新建第二套语义

- share 分区**不引入 CRDT、不引入第二套合并器**；远端 share op 与个人 op 走同一个 `applyOperation`。
- 要补的是 dispatcher 侧的**因果时钟**：每条 share 上本设备持有一个真实自增的时钟维，
  并把拉回来的远端 op 时钟**逐维合并**回本地那份（今天 `foldShareOps` 已经把时钟并进 `ShareLogState.clock`，
  缺的是让它回流到 dispatcher —— 这是本 ADR 里"因果边从哪来"的唯一答案）。
- 平局顺序沿用 `compareMeta`：因果压不住时才 timestamp，再 clientId，再 opId。**不引入服务端仲裁**（服务端仍只存不判）。
- 已知代价，写清楚不藏：跨设备**不保证读己所写**，靠 M5 那条 `new_share_ops` 信号驱动重拉收敛；
  设备时钟维在本地丢失（清数据）后重建，因果边会退化成一轮 timestamp 平局 —— 这是 op-log 模型既有边界，不是本 ADR 新引入的。

### 三、并发同字段必须**可见**，不许静默覆盖

- 共享后 `CONCURRENT` 是高频事件（两人各自勾完成、改标题），而现状是 share 侧连 `overwritten` 都不产 ⇒
  症状将是"我改的没了，而且没有任何提示"。**那比"看不到彼此改动"更糟**，所以这一格随 M2 一起做，不推给 M4。
- 形状：复用个人引擎那侧同一套判定（并发 + 内容真的变了才算），产出冲突项交给**现有**
  `packages/ui/src/sync/ConflictResolutionView.tsx` 与既有 choice 词表（`keep-local | keep-remote`），不新建冲突 UI、不新建词表。
- 判据要能红：构造两台设备对同一任务的不同字段各改一次 ⇒ 两边都保留（无冲突提示）；
  对**同一字段**各改一次 ⇒ 恰好一枚具名冲突、且不静默丢任一侧内容。

### 四、线协议一次定：`vectorClock` 不加字段，`signature` 加字段但分期实现

- `vectorClock` 已在线协议里 ⇒ 裁决二只是让它**被真用**，不加字段、不 bump schema。
- 逐 op 签名要加 `signature` 字段（写侧签、服务端验、验失败按**永久拒绝**处置，对齐 ADR-0019 那条读侧对偶）。
  本 ADR **一次定下它的形状与处置语义**，实现落在 M4 —— 目的就是不在几周后为签名再动一次线协议。
- 新字段一律可选 + 运行时默认值；**不 bump `CURRENT_SCHEMA_VERSION`**（AGENTS §3.3）。

### 五、旧世代密文不重加密（把 §9.9 挂起的"与 M2/M4 一起判"判掉）

- 换钥后**只对新内容用新世代**，库里旧密文保持原样。
- 理由：重加密等于改写历史 op 的密文，与"op-log 是唯一写入口 + 追加模型"冲突；代价只是
  **已移除成员在他被移除前拿到的那一代钥，仍能读到他离开之前的历史内容**（读不到新内容 —— 新内容用新世代封）。
- 翻案条件：出现"被移除成员仍持续读到新内容"的实测 ⇒ 那说明信封作废没做完（属 M3 缺陷），不是需要重加密。

### 六、语义键只认 `(entityType, opType)`；`actionType` 降级为展示字段

- 新增一族动作必须**显式传标签表**，未知 `opType` 继续抛错（这条已有牙，保留）。
- 任何逻辑不许解析 `actionType` 的字符串来决定行为。

## 明确不做（本 ADR 范围内）

- 不做逐 op 签名的**实现**（M4，语义已在本 ADR 定下）。
- 不做移动端接入（M6）。
- 不做服务端冲突判定 / 服务端时钟权威。
- 不把个人偏好类实体放进 share log（沿用 0062 与计划 §2.2 那条边界）。

## 后果

- **产品可见性的翻案条件被这条 ADR 触发**：计划 §9.2 P-1 写的是
  「M1+M2 落地且两台设备真浏览器互相看得到 ⇒ 撤掉隐藏，`check:share-entry-hidden` 同时改成钉'可达'」。
  所以 M2 收口时那枚门禁的**方向要翻**，不是把它删掉。
- 判据面新增三把尺：路由分流（两个红形）、因果时钟真自增（退化即红）、并发可见性（静默覆盖即红）。
  一次性变异臂按仓内惯例登记进 `research/tools/mutation-rigs/`。
- 文档面：计划 §9.1 那两行（内容上行 / 任务写路径）与 §9.2 P-3 的前提都要按本 ADR 的现量改口。

## 落地顺序

1. **M2**：裁决一（路由）+ 裁决二（因果时钟）+ 裁决三（并发可见）+ 裁决六（语义键）⇒ 交付"两台真浏览器里 B 看得见 A 改的任务"。
2. **M4**：裁决四的 `signature` 落地（写侧签、服务端验、永久拒绝）。
3. **M6**：移动端接线（不改本 ADR 任何语义）。
