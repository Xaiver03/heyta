# 服务端 `/api/agent/tools` 数据层审计（第四轮）

> 审计对象：提交 `d469b1f3`、`8c32d82f`
> 范围：`server/src/ai/agent-tools.{execute,service,routes}.ts` + `server/src/server.ts` 注册点 + `server/tests/agent-tools.*.spec.ts`
> 只读代码，未改一行。标注约定：**事实**＝已在源码/命令中核对；**推断**＝由代码推出但未运行验证；**未核**＝未取到证据。
> 本地实测：`cd server && ./node_modules/.bin/vitest run tests/agent-tools.{execute,service,routes}.spec.ts` → **14 passed**（execute 4 / service 4 / routes 6）。

---

## 0. 摘要

- **P0 一处且致命**：路由用真实 `authenticate` 时，`userIdOf` 读的是 `request.user.id`，而 `authenticate` 只写入 `request.user.userId`。生产环境 GET/POST **恒返回 401**，整个功能上线即失效；而三条测试全部用假对象 `{ id: 42 }` 注入，把这条不一致完全遮住。**14 个测试全绿 ≠ 生产可用**。
- **P1 六处**：`list_tasks` 的 `completed` 恒为 `false`（Task 没有 `completed` 字段，用 `completedAt`）；`list_notes` 投影了不存在的 `title`（Note 只有 `content`）；catalog 手抄一份、与 `@heyta/local-api` 唯一事实源已漂移且违反契约明文；`DEL` 服务端物理删除 vs 客户端墓碑，`DEL→UPD{deletedAt:null}`（还原）会产出空壳幽灵任务；`executeAgentToolForUser` 的 `catch` 把一切异常都报成「端到端加密账号」；`findMany` 无 `take`/seq 上界、每次调用全量重读+全量重放、无快照复用。
- **P2**：`userId` 未校验的 `Number()` 转换；`replayOpsToState` 迁移失败 `continue` 静默丢 op；`materializeUserState` 不做快照路径的连续性校验；幂等缓存仅进程内、只缓存成功；共享清单（`ShareOperation` 独立 op-log）完全不可见；注册无前缀但路径写死 `/api/...`（无冲突但风格不一致）。

---

## 1. 安全 / 越权

### P0-1｜`userIdOf` 读 `user.id`，而鉴权只写 `user.userId` → 生产恒 401【事实】

- `server/src/middleware.ts:70`：
  ```ts
  req.user = { userId: result.userId, email: result.email, tokenVersion: result.tokenVersion, sessionId: result.sessionId };
  ```
  `AuthUser` 上的字段是 **`userId`**（`middleware.ts:7-19`），**没有 `id`**。
- `server/src/ai/agent-tools.routes.ts:38-42`：
  ```ts
  function userIdOf(request: unknown): string | undefined {
    const user = (request as { user?: { id?: number | string } }).user;
    if (user === undefined || user.id === undefined) return undefined; // ← 永远命中
    return String(user.id);
  }
  ```
  `request.user.id` 恒为 `undefined` ⇒ `userIdOf` 恒返回 `undefined` ⇒ `GET`（`:53-57`）与 `POST`（`:66-70`）**一律回 401 unauthorized**。
- 生产接线 `service.ts:75` 确实传了真实 `authenticate`：
  ```ts
  authenticate: (request, reply) => authenticate(request as FastifyRequest, reply as FastifyReply),
  ```
  所以生产上不是"authorize 缺失"，而是"鉴权成功但取值键写错"，**fail-closed 到 401**。
- **为什么测试没抓到**：`agent-tools.routes.spec.ts:23-27`（及 `:84-86`）自己 `request.user = { id: 42 }`，与真实中间件的 `{ userId }` 形状相反。`agent-tools.service.spec.ts:49` 直接调 `opts.execute(..., { userId: '42' })`，不经过 `userIdOf`。**没有任何一条测试把「真实 authenticate 的输出」喂给「真实 agentToolsRoutes」**，因此这条缺陷不会被现有测试转红。
- 影响面：`/api/agent/tools` 的 list 与 invoke 全不可用。属"功能级 P0"，非数据泄露（401 是安全方向）。
- 修复方向（不在本次范围）：`userIdOf` 改读 `user.userId`；并补一条用**真实** `authenticate` 形状（`{ userId }`）的集成测试——这正是能转红的判据。

### P1-2｜`resolveGrants` = "登录用户可用全部只读工具" —— 不是跨用户越权，但绕过了逐工具同意【事实+推断】

- `service.ts:77-78`：`resolveGrants: () => Object.fromEntries(catalog.map((t) => [t.name, true]))`，忽略 `userId` 实参。
- **租户隔离本身没问题（事实）**：`executeAgentToolForUser` 用 `findMany({ where: { userId: Number(userId) } })`（`service.ts:56-60`），`userId` 只来自 token，body/args 里没有任何 userId；GET/POST 都只读"自己"的 op。**不存在跨用户读取**。
- **但它是产品/授权缺口（推断）**：`@heyta/local-api` 的设计基线是"11 个工具默认全关、逐个开"（`packages/local-api/src/tools.ts` 文件头，ADR-0011）；服务端却对任何登录用户放开全部只读工具，无逐工具存储、无用户显式开启。代码注释也自认"逐账号工具授权存储尚未建表"。这是**同意模型的倒退**，不是越权。分级 P1（产品策略）而非 P0（安全）。

### P2-3｜`Number(userId)` 无校验【事实+推断】

- `service.ts:57` `where: { userId: Number(userId) }`。P0 修复后 `userId` 是 `String(number)`，正常安全；但若上游传入非数字（未来改造、或复用此函数），`Number()` 得 `NaN`/`Infinity`，Prisma 会抛错或返回空——**未加 `Number.isInteger` 守卫**。属健壮性 P2。

### 幂等键租户隔离【事实，结论良好】

- `routes.ts:92-93`：`idemKey = ${userId}:${name}:${header}`——**含 userId**，不同用户同 key 不会串。仅缓存 `result.ok`（`:103`），失败不缓存。隔离正确。

### GET/POST 是否可能跨用户读【事实，结论：否】

- 两端 userId 均来自 `userIdOf(request)`（token），数据查询均 `where userId`；不信任客户端传的 userId。**当前无跨用户读取路径**（前提是 P0 修好后键取对）。

---

## 2. 正确性

### P1-4｜`list_tasks` 的 `completed` 恒为 `false`【事实】

- `execute.ts:84`：`.map((t) => ({ id: t['id'], title: t['title'], completed: t['completed'] === true }))`。
- 但 `Task` **没有 `completed` 布尔**：`packages/domain/src/entities.ts:310`「完成时间。存在即表示已完成（**不另设 completed 布尔**）」；域内唯一判断是 `completedAt !== undefined`。规范实现 `packages/app-host/src/local-api-host.ts:317`：`completed: task.completedAt !== undefined`。
- 因此服务端 `list_tasks` 对**所有任务**都回 `completed:false`，模型据此判断"没有一条完成"，属投影错误。P1。

### P1-5｜`list_notes` 投影不存在的 `title`；Note 无 title 字段【事实】

- `execute.ts:96-98`：`Object.values(state['NOTE'] ?? {}).filter(isAlive).map((n) => ({ id: n['id'], title: n['title'] }))`。
- `Note` 接口（`entities.ts:539-548`）字段是 `projectId / isPinnedToToday / content / imgUrl / isLock`，**没有 `title`**。故 `title` 恒 `undefined`；同时把规范目录承诺的 `projectId/isPinnedToToday/updatedAt`（`note.ts:27` 的 `ROW_FIELDS`）全丢了。P1（投影错误；好在没泄露 `content`）。

### P1-6｜`DEL` 服务端物理删除 vs 客户端墓碑 → 还原后出现空壳幽灵任务【事实，后果为推断】

- 客户端语义（事实）：`packages/app-host/src/actions.ts:204`「软删除（发 `DEL` op，由 reducer 转成墓碑 `deletedAt`）」；`packages/op-log/src/state.ts:638`「DELETE is a field-level tombstone… **never removes content**」。
- 服务端语义（事实）：`server/src/sync/op-replay.ts:295-313` 对 `DEL` 直接 `delete state[entityType][delId]`——**物理删除，不留字段**。`op-replay.spec.ts:53`「deletes entities for DEL operations」证实这是快照路径的既定行为。
- 推论（推断）：客户端「还原」发的是 `UPD { deletedAt: null }`（`actions.ts:765,786`、`:220-222`）。服务端回放先物理删了实体，随后这条 `UPD` 走到 `op-replay.ts:286-293` 的 `CRT/UPD` 分支，`state[TASK][id] = { ...undefined, deletedAt: null }` ⇒ 只得到一个 `{ deletedAt: null }` 的空壳。`isAlive` 判 `deletedAt !== null` 为假 ⇒ **判为"活着"**，于是 `list_tasks` 输出 `{ id, title: undefined, completed: false }` 的幽灵条目。
- **对 `isAlive` 过滤的影响是实打实的**：物理删除让"墓碑保留内容"的语义丢失，`isAlive` 只能在"没被物理删过"的实体上正确工作。P1。是否在真实账号中已发生取决于是否存在同账号 `DEL→UPD{deletedAt:null}` 序列（还原即产生），**未取线上样本，标未核**。

### P1-7｜`executeAgentToolForUser` 把任何异常都报成"端到端加密账号"【事实】

- `service.ts:62-67`：
  ```ts
  try { state = materializeUserState(rows); }
  catch { return { ok:false, reason:'encrypted-account', message:'该账号启用了端到端加密…' }; }
  ```
- 裸 `catch` 吞掉**所有**异常：`EncryptedOpsNotSupportedError`（真 E2EE，`op-replay.ts:160-162`）、`MAX_REPLAY_STATE_SIZE_BYTES` 超 100MB（`op-replay.ts:59-68,366-368`）、`LegacyRepairReplayUnsupportedError`（`:163-165`）、`SYNC_IMPORT` 非对象载荷（`:248-252`）、以及任何 replay 内抛错。全部被谎报为"你开了端到端加密"。运维/用户看到的是错误归因。应 `instanceof EncryptedOpsNotSupportedError` 精确分支。P1（可观测性/误导）。

### P1-8｜`findMany` 无分页、无 seq 上界、每次全量重读+全量重放、无快照复用【事实】

- `service.ts:56-60`：`findMany({ where:{userId}, orderBy:{serverSeq:'asc'}, select })`——**没有 `take`**，把该用户**全部** op 一次性读进内存；随即 `materializeUserState` 从 seq 0 全量重放（`execute.ts:53-55`）。
- 大账号：读放大 + 内存峰值 + 每次工具调用重复一次；虽有 100MB 状态上限（`op-replay.ts:13`），但**行数组本身在重放前就已物化**，上限拦不住"先把全部 payload 读进内存"。并发调用叠加即成放大/DoS 面（全局 500/15min 限流可缓解，但不够）。P1（性能/资源）。注：仓库已有 restore-point/snapshot 机制（`op-replay.ts:376-381` 注释提及），本路径**未复用**，可从最近快照+尾部回放显著降本——属优化方向。

### P2-9｜`schemaVersion` 迁移失败 `continue` 静默丢 op【事实，继承自 op-replay】

- `op-replay.ts:196-199`：`if (!migrationResult.success) continue;`——迁移失败的旧 op 被**静默跳过**，无日志、无抛错，状态因此可能"少了一条创建/更新"。这是 op-replay 既有行为（快照同样受影响），非本轮新增，但新的对外读路径把它变成用户可感知的状态错误。P2（继承风险）。

### P2-10｜`materializeUserState` 不做快照路径的连续性/前导缺口校验【事实+推断】

- 快照路径用 `_resolveExpectedFirstSeq`（`op-replay.ts:383-406`）+ `assertContiguousReplayBatch`（`:121-141`）保证"从正确基线开始、中间不缺号"。
- `materializeUserState`（`execute.ts:53-55`）只 `replayOpsToState([...rows])`，**不做这两项校验**。若历史因保留期裁剪导致首条不是 full-state op（`op-replay.ts:376-381` 声称正常情况下末条必为 full-state，但只是"保证"、快照路径会核，这里不核），则**静默产出错误状态**而非报错。P2（防御性）。

### P2-11｜共享清单完全不可见【事实】

- `Operation` 仅个人 op-log，模型 `userId Int`（`server/prisma/schema.prisma:242-244`）；共享清单走**独立** `ShareOperation`（`schema.prisma:410+`），且其 `payload` 为清单密钥加密（注释："服务端永远读不开内容"）。本工具只读 `prisma.operation`，故**共享清单里的任务/便签一律不出现在 `list_*`**。这与分享端 E2EE 一致（读不开），但属产品能力边界，未见任何文档/响应标注。P2（能力边界，应披露）。

---

## 3. 一致性

### P1-12｜catalog 手抄一份，与 `@heyta/local-api` 唯一事实源已漂移，且违反契约明文【事实】

- 契约明文（`docs/reference/agent-tools-api.md:53`、`:96`）：
  - 「工具目录的**唯一事实源**仍是 `packages/local-api/src/tools/*`（服务端**不另写一份**；从同一份生成/校验）」；
  - 「服务端从 `packages/local-api` 的工具目录生成 `GET /api/agent/tools`（复用 `listAuthorizedTools`…**不复制目录**）」。
- 实际实现（事实）：`execute.ts:29-48` 手写 `SERVER_AGENT_TOOLS`；`service.ts:73` 直接 `catalog = [...SERVER_AGENT_TOOLS]`——**没有**从 `packages/local-api` 生成，也没有 `listAuthorizedTools`（该函数确实存在：`packages/local-api/src/mcp.ts:142`）。
- 已发生的漂移（逐项核对）：

  | 工具 | 服务端（`SERVER_AGENT_TOOLS`） | 规范目录（`packages/local-api/src/tools/*`） |
  |---|---|---|
  | `list_tasks` 参数 | 仅 `limit`（`execute.ts:34`） | `projectId/completed/dueOn/dueFrom/dueTo/limit`（`task.ts:36-45,282+`） |
  | `list_tasks` 投影 | `{id,title,completed}`，`completed` 恒 false | `id,title,dueDate,priority,completed,readable`；`completed=completedAt!==undefined` |
  | `list_projects` 投影 | `{id,name}`（`execute.ts:92`） | `id,name,taskCount`（`project.ts:27`，描述"及任务数量"） |
  | `list_notes` 参数 | 无（忽略 limit） | `limit`（`note.ts:33,73-84`） |
  | `list_notes` 投影 | `{id,title}`（title 不存在） | `id,projectId,isPinnedToToday,updatedAt`（`note.ts:27`） |

- 另有语义漂移：服务端 `list_tasks` 只 `isAlive && !isArchived`，**未排除"已放弃"（abandonedAt 第五态）**；规范动作层过滤是 `isLive && !isAbandoned`（`packages/domain/src/task-filter.ts:113`，`entities.ts:125`）。故**已放弃任务会漏进 `list_tasks`**。而 `isArchived`（`execute.ts:63-68`）在 Task 上恒假（Task 无 `archived` 字段），等于空转。P1（违反契约不变量 #1"沿用动作层单一过滤、不另写第二份"）。

### `list_tasks` 是否泄漏正文【事实，结论：列表未泄正文】

- `execute.ts:84` 只取 `id/title/completed`，**不含 `note` 正文**——与 Bear 范式（列表不出口正文）一致，方向对。问题在字段语义（P1-4），不在泄露。

### 归档/删除不进出口【部分】

- 删除：`isAlive` 过滤 `deletedAt/purgedAt`（`execute.ts:57-62`），可达；但受 P1-6 的物理删除语义影响。
- 归档：`list_projects` 过滤 `archived` 生效（`execute.ts:91`）；`list_tasks` 的归档过滤空转（见上）。
- 放弃（第五态）：**未过滤**（见 P1-12）。

---

## 4. 注册面

### 无前缀注册与既有 `/api/*` 冲突【事实，结论：不冲突，但风格不一致】

- `server.ts:670`：`await fastifyServer.register(agentToolsRoutes, buildAgentToolsOptions(prisma as unknown as OpsReader));`——**不传 `prefix`**，路由内部写死绝对路径 `/api/agent/tools`、`/api/agent/tools/:name`（`routes.ts:52,65`）。
- 冲突排查（事实）：`server/src/api.ts` 中**无** `/agent` 或通配/参数兜底路由（grep 无命中）；其余插件均带 `prefix`（`/api`、`/api/sync`…）。静态路由 `/api/agent/tools` 与任何既有路由不重叠，Fastify 不会因重复注册报错（服务能起即证，且 14 测试中 routes 单测独立起 Fastify 也通过）。
- 风格问题（事实，P2 级）：全仓其余路由一律"插件带前缀 + 路由内写相对路径"，此插件反其道而行（无前缀 + 写死绝对路径）。今天不冲突，但一旦有人给 `agentToolsRoutes` 补 `prefix`，会变成 `/prefix/api/agent/tools` 双前缀——易踩。建议改成 `register(agentToolsRoutes, { prefix:'/api/agent', ...opts })` + 路由内 `/tools`。P2。

### `authenticate` 作为 plugin 级 preHandler 是否影响其它路由【事实，结论：不影响】

- `routes.ts:44-47`：在插件内部 `app.addHook('preHandler', options.authenticate)`。`agentToolsRoutes` 是**直接导出的 `FastifyPluginAsync`，未经 `fastify-plugin`/`fp()` 包裹**（`routes.ts:44`，全文件无 `fastify-plugin` import/wrap；`server.ts` 亦无 fp）。
- 因此 Fastify 默认**封装作用域**成立：该 `preHandler` 只作用于本插件内注册的两条路由，**不会泄漏到父级或其它插件**。结论正确（P2 无需记，仅在此确认）。

### 其它注册面观察

- 该插件无条件注册（`server.ts:670`），不受 `testMode`/计费闸门影响；受全局 rateLimit（`server.ts:421`，非 test 模式）覆盖。符合"只读工具"定位。

---

## 5. 测试价值

结论：**现有 3 个 spec（14 test）能覆盖"路由形状/授权/风险/幂等/注入 execute"和"op 归约执行器"的单元行为，但不能因上述任何 P0/P1 缺陷转红**——因为它们恰好绕开了真实链路。

逐条评估：

1. **是否用了真实 replay（而非假 state）？—— 部分用真实（事实）**
   - `agent-tools.execute.spec.ts` 用**真实** `materializeUserState`→`replayOpsToState`（`execute.spec.ts:27,37,48`），非假 state。这点值得肯定：它能覆盖 `CRT/UPD/DEL/加密抛错` 的真实归约。
   - 但用例构造的都是"正常形状"（`completed` 用 `t['completed']` 不会被测出，因为测试的 payload 里也没 `completed`，且断言只比 `title`）。所以 P1-4（completed 恒 false）测不到。

2. **注入缺陷能否转红？—— 多数不能（事实）**
   - P0-1（id vs userId）：测试自定义 `{ id: 42 }`（`routes.spec.ts:25,85`），**与真实中间件相反**，永远绿。
   - P1-4 / P1-5：断言只比 `title`/`name`（`execute.spec.ts:31-32,44`、`service.spec.ts:26`），不比 `completed`/笔记字段，测不到错误投影。
   - P1-6（DEL 物理删除）：`execute.spec.ts:19-33` 只测"删除后不出现"，没有"删除→还原（UPD{deletedAt:null}）→应复原内容"的用例，测不到空壳幽灵。
   - P1-7（catch 全吞）：`service.spec.ts:29-34` 只测"加密→encrypted-account"，没有"超 100MB / 损坏序列→不应报 encrypted-account"的用例。
   - P1-12（catalog 漂移）：无任何测试断言 `SERVER_AGENT_TOOLS` 与 `LOCAL_API_TOOLS` 子集一致；`service.spec.ts:44` 只断言"全 read"。漂移不会被发现。
   - P1-8（全量 findMany）：`fakeDb` 不记录 `take`/`where` 之外的调用参数（`service.spec.ts:6-15`），无法断言分页/上界。
   - `service.spec.ts:47-48` 断言 `resolveGrants` 全 true——**正是把"全部放行"这一策略固化为绿**，将来若收紧授权反而这条会红（测试在保护一个 P1 策略）。

3. **缺失的关键测试（建议补，能转红）**：
   - 用**真实** `authenticate` 产生的 `{ userId }` 形状跑 `agentToolsRoutes`，断言 200 而非 401（钉 P0-1）。
   - `list_tasks` 断言 `completed === (completedAt!==undefined)`（钉 P1-4）。
   - `list_notes` 断言含 `projectId/isPinnedToToday/updatedAt`、且不含 `content`/不返回 undefined title（钉 P1-5）。
   - `DEL → UPD{deletedAt:null}` 序列后 `list_tasks` 应恢复原 title（钉 P1-6）。
   - 超 100MB 或非对象 SYNC_IMPORT → `reason !== 'encrypted-account'`（钉 P1-7）。
   - 一条"catalog 与 `@heyta/local-api` 只读子集逐字段相等"的契约测试（钉 P1-12）。
   - `findMany` 被调用时带 `take`（钉 P1-8）。

---

## 6. P0 / P1 / P2 清单

**P0**
- P0-1 生产恒 401：`middleware.ts:70` 写 `userId`，`routes.ts:39` 读 `id`；测试用 `{id}` 假对象掩盖（事实）。

**P1**
- P1-2 `resolveGrants` 全放行只读工具：非跨用户越权，但绕过逐工具同意（事实+推断）。
- P1-4 `list_tasks.completed` 恒 false（Task 用 `completedAt`）（事实）。
- P1-5 `list_notes` 投影不存在的 `title`、丢 `projectId/isPinnedToToday/updatedAt`（事实）。
- P1-6 `DEL` 物理删除 vs 客户端墓碑；`DEL→UPD{deletedAt:null}` 还原产出空壳幽灵任务（事实+推断）。
- P1-7 `catch` 全吞，任何异常都报「端到端加密账号」（事实）。
- P1-8 `findMany` 无分页/无 seq 上界，每次全量重读+全量重放，无快照复用（事实）。
- P1-12 catalog 手抄 vs `@heyta/local-api` 唯一事实源漂移，违反契约明文；`list_tasks` 未排除 abandoned 任务（事实）。

**P2**
- P2-3 `Number(userId)` 无整数校验（事实+推断）。
- P2-9 迁移失败 `continue` 静默丢 op（继承自 op-replay）（事实）。
- P2-10 `materializeUserState` 缺连续性/前导缺口校验（事实+推断）。
- P2-11 共享清单（`ShareOperation`）完全不可见，未披露（事实）。
- 幂等缓存仅进程内、只缓存 ok、多副本失效（`routes.ts:48-50,103-109`）（事实）。
- 注册无前缀但写死绝对路径，风格与全仓不一致，补 prefix 会双前缀（`server.ts:670` / `routes.ts:52,65`）（事实）。
- `isArchived` 的 `archivedAt` 分支对 Task/Project 是死代码（`execute.ts:63-68`）（事实）。

---

## 7. 核验方式（可复现）

- 读码：`server/src/ai/agent-tools.{execute,service,routes}.ts`、`server/src/middleware.ts:7-19,70`、`server/src/server.ts:52-53,670`、`server/src/sync/op-replay.ts:121-370`。
- 交叉证据：`packages/domain/src/entities.ts:109,125,157,259-320,539-548`；`packages/app-host/src/local-api-host.ts:313-317,474-500`；`packages/app-host/src/actions.ts:204-250,765,786`；`packages/op-log/src/state.ts:638`；`packages/domain/src/task-filter.ts:113`；`packages/local-api/src/tools/{task,project,note}.ts`；`server/prisma/schema.prisma:242-283,410+`；`docs/reference/agent-tools-api.md:53,71,96`。
- 测试实测：`cd server && ./node_modules/.bin/vitest run tests/agent-tools.execute.spec.ts tests/agent-tools.service.spec.ts tests/agent-tools.routes.spec.ts` → 14 passed（全绿，且**不覆盖** P0/P1 判据）。
- 未核项：线上是否存在 `DEL→UPD{deletedAt:null}` 的真实序列（影响 P1-6 的实际发生率）；`ShareOperation` 未被读取是否为产品有意（P2-11）。

---

## 处置（Lead 终审，2026-11-22）

| 审计项 | 处置 |
|---|---|
| **P0 生产恒 401（读 `user.id`，真实是 `user.userId`）** | ✅ **已修**：`userIdOf` 改读 `userId ?? id`。**测试改用真实 `{userId:42}`**（`routes.spec.ts`）——这条现在能转红。 |
| P1 `list_tasks.completed` 恒 false（Task 无 `completed`） | ✅ 改读 `completedAt != null`。 |
| P1 `list_notes` 伪造 `title`（Note 只有 content） | ✅ 去掉 title，只返回 `id`+`pinnedToToday`，**不投影正文**。 |
| P1 `DEL` 物理删除→还原出空壳幽灵 | ✅ 加 `hasIdentity` 过滤（无 title/name/content 的空壳不算活）。 |
| P1 裸 catch 一律谎报 encrypted-account | ✅ 仅 `EncryptedOpsNotSupportedError` → encrypted-account；其它 → `failed` + 原信息。 |
| P1 catalog 与 `@heyta/local-api` 漂移 | ⚠️ 记录：服务端目录是**有意的极小子集**（无依赖方向），不复制全部；已在契约 §0.1 说明。 |
| P1 `findMany` 无分页/无上界 | ⚠️ 记录（未核：大账号内存）。待加 seq 上界/分页。 |
| P2 `Number()` 无校验、迁移失败 continue、无连续性校验、共享清单不可见 | ⚠️ 记录，未改（latent）。 |
| 注册无前缀 / preHandler 作用域 | ✅ 复核：无冲突、作用域限本插件（审计确认）。 |

测试：server agent-tools 三 spec **18 passed**；server `tsc` 0 错；`check:ai-tools`/`check:layering` 绿。
