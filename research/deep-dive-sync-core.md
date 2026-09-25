# 深度拆解：`@sp/sync-core`

> 对象：`research/upstream/super-productivity/packages/sync-core/`
> License：MIT（随 Super Productivity 主仓 LICENSE）
> 拆解方式：直接读源码。所有结论附文件路径与行号。
> 拆解时间：2026-09-25

---

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| 规模多大？ | **src 仅 4,240 行**，13 个源文件 + 8 个 encryption 子文件 |
| 测试覆盖？ | **271 个测试**（13 个 spec 文件），conflict-resolution 单文件 60 个、encryption 48 个、vector-clock 43 个 |
| 依赖？ | 运行时仅 **2 个**：`@noble/ciphers`、`hash-wasm` |
| 是否绑定 Angular/NgRx？ | ❌ **完全不绑定**。README 明确 "no Angular/Electron/Capacitor dependencies" |
| 是否为"多宿主复用"设计？ | ✅ **是，而且注释里明确这么写** |
| 同步模型？ | **op-log（操作日志）+ 向量时钟 + LWW**，不是 CRDT |
| 端到端加密？ | ✅ 有，Argon2id + AES-256-GCM，线上格式是**文档化的公开契约** |
| 能否直接拿来用？ | ✅ **可以。这是本项目最高价值的可复用资产。** |

---

## 1. 这个库是"为被复用而写"的——证据在源码注释里

这不是我的推断，是上游自己写的设计意图：

> `entity-registry.types.ts:4-5`
> "The sync core keeps entity names opaque. **Host apps provide the actual entity registry** and may narrow registry keys with their own domain union."

> `entity-registry.types.ts:7-11`
> "**Framework-agnostic**: this module describes only what the sync engine needs to classify/route operations... **Host applications that wire their own state framework (NgRx, Redux, etc.)** extend `EntityConfig` via the `THostExtensions` generic and own the selector/adapter shape themselves."

> `operation.types.ts:47-51`
> "The action type string this operation replays (e.g., '[Task] Update'). **Carried as an opaque string here; the host app's action-type enum is the source of truth** for valid values."

> `lww-update-action-types.ts:4`
> "**The lib doesn't know which entity types exist in the host app**, so the helpers are constructed via a factory that takes the host's entity-type list."

> `operation.types.ts:13-17`（对 `OpType.SyncImport` 的 deprecation 注释）
> "@deprecated Super Productivity host-specific full-state op string baked into sync-core for backward compatibility. **New host integrations should declare their full-state op strings as plain string literals** and register them via `createFullStateOpTypeHelpers`. This member will be removed from `OpType` once the SP migration completes."

**含义**：上游正在**主动把自己的领域概念从 sync-core 里剥离出去**，目的是让它成为通用的宿主无关库。
我们现在打算复用它，正好踩在他们设计意图上。

---

## 2. 核心数据模型

### 2.1 `Operation`（`operation.types.ts:37-111`）

| 字段 | 类型 | 作用 |
|---|---|---|
| `id` | string | **UUID v7（时间有序）**，便于粗略排序和索引 |
| `actionType` | string | **不透明字符串**，宿主自己定义（如 `'[Task] Update'`） |
| `opType` | `OpType` | 高层类别：`CRT` / `UPD` / `DEL` / `MOV` / `BATCH` |
| `entityType` | string | **不透明字符串**，宿主提供有效集合 |
| `entityId` | string? | 实体 ID；单例实体用 `'*'` |
| `entityIds` | string[]? | 批量操作 |
| `payload` | unknown | CRT=全量对象；UPD=部分字段；DEL=墓碑 |
| `clientId` | string | 产生该操作的设备 ID |
| `vectorClock` | VectorClock | **该操作应用后的因果状态**，用于检测并发 |
| `timestamp` | number | **源设备的墙钟时间**，并发时的 LWW 决胜依据 |
| `schemaVersion` | number | 数据 schema 版本，用于迁移 |

`OpType` 枚举（`:5-35`）：`Create='CRT'`、`Update='UPD'`、`Delete='DEL'`、`Move='MOV'`（列表重排）、`Batch='BATCH'`（批量/导入）。

### 2.2 `OperationLogEntry`（`:113-171`）—— 本地日志条目

关键设计：**同步数据与本地簿记分离**。

- `seq`：本地单调自增整数（IndexedDB 主键），严格排序**本设备**的到达顺序
- `op`：真正参与同步的部分
- `appliedAt`：本地写入时间，**仅用于本地 GC/压缩**
- `source`：`'local' | 'remote'`
- `syncedAt` / `rejectedAt` / `reducerRejectedAt`：生命周期标记
- `applicationStatus`：`'pending' | 'archive_pending' | 'applied' | 'failed'` —— **崩溃安全**
  - 注释（`:158-165`）说明：`archive_pending` 表示 reducer 和时钟已提交但归档副作用未完成；启动恢复时会**无视状态重放 reducer** 并重试未完成的归档工作

**这是生产级的崩溃恢复设计**，不是玩具。

### 2.3 多实体载荷（`:194-263`）

- `EntityChange`：单实体变更（`entityType` / `entityId` / `opType` / `changes`）
- `MultiEntityPayload`：`{ actionPayload, entityChanges[] }` —— **一次用户意图 = 一个 op**
- `LwwUpdatePayload extends MultiEntityPayload`：加了 `lwwUpdateMode: 'replace' | 'patch'`

三个向后兼容字段值得注意（都是"不 bump schema 版本就能演进协议"的手法）：
- `recreatesEntityAfterDelete?`：允许 LWW 更新复活被同批 DELETE 删除的实体
- `projectMoveFootprint?`：携带"移动的根实体 + 子任务 ID"，且**放在加密载荷内部**，因为明文 `op.entityIds` 可能被恶意服务端篡改（引用安全公告 **GHSA-8pxh-mgc7-gp3g**）
- `clearedFields?`：JSON 会丢弃 `undefined` 值的键，所以"清空某字段"必须用带外列表记录

> ⚠️ **注意**：`projectMoveFootprint` 引用了真实安全公告，说明这套代码**经历过对抗性安全审查**，服务端被假定为不可信。

---

## 3. 向量时钟（`vector-clock.ts`，154 行）

标准向量时钟，四态比较：`EQUAL` / `LESS_THAN` / `GREATER_THAN` / **`CONCURRENT`（真冲突）**。

| 函数 | 行 | 说明 |
|---|---|---|
| `compareVectorClocks(a,b)` | `:68-87` | 缺失键按 0 处理；一旦双向都有更大值立即返回 CONCURRENT |
| `mergeVectorClocks(a,b)` | `:97-105` | 逐 key 取 max |
| `limitVectorClockSize(clock, preserve)` | `:115-153` | 裁剪到 `MAX_VECTOR_CLOCK_SIZE = 20` |
| `MAX_VECTOR_CLOCK_SIZE` | `:48` | **20** |

**契约性要求**（注释 `:14-17`，`:52-53`）：
> "This module is the single source of truth for generic **client and server** vector-clock algorithms. **Any changes must be compatible with both environments.**"
> "CRITICAL: This algorithm must produce identical results on client and server."

裁剪规则（`:108-153`）：按值降序保留最活跃的 client；值相同时**按 clientId 字典序确定性破平**；`preserveClientIds`（本机 ID + 活跃全量状态作者）优先保留。

> 这段"客户端与服务端必须逐位一致"的约束，对我们**极其重要**：如果我们要换语言实现，必须移植这个精确算法，且要有跨语言一致性测试。

---

## 4. 冲突解决：LWW，但策略可被宿主覆盖

`conflict-resolution.ts`（574 行，60 个测试）导出的关键函数：

| 函数 | 行 | 作用 |
|---|---|---|
| `suggestConflictResolution(local, remote)` | `:340-368` | 返回 `'local' \| 'remote' \| 'manual'` |
| `planLwwConflictResolutions(conflicts, opts)` | `:395+` | **核心**：产出 LWW 解决计划，不查宿主状态、不创建 op |
| `partitionLwwResolutions` | `:513` | 划分解决结果 |
| `convertLocalDeleteRemoteUpdatesToLww` | `:121` | 把"本地删除 vs 远端更新"转成 LWW |
| `deepEqual` / `isIdenticalConflict` | `:278`, `:296` | 判定是否无实质冲突 |

**决策优先级**（`suggestConflictResolution`，`:340-368`）：
1. 一方为空 → 直接取另一方
2. 两边时间差 **> 1 小时** → 取较新的一方
3. **双删 → 本地胜**；**本地删 + 远端改 → 远端胜**；**远端删 + 本地改 → 本地胜**（即删除优先，但"改"胜过"删"）
4. 一方是 Create 另一方不是 → Create 胜
5. 其余 → `'manual'`（交给用户）

**决胜破平**（`:381-384`）：两边最大 `timestamp` 相同时，比较**胜出方的 `clientId`**。
注释解释了为什么必须这样（`:370-379`）：只比 timestamp 会让两台设备各自保留对方的值，**永久分歧**；而比较同一对无序的 clientId 能让两边收敛。

**宿主可配置的策略点**（`:395-401` 的 options）：
- `isArchiveAction` —— 什么是"归档"由宿主定义
- 是否让特定 op 享有 delete-wins 优先
- `toEntityKey` —— 实体键编码可自定义

> **对 heyta 的含义**：我们需要自己定义策略——滴答清单语义里"归档清单"、"删除清单连带任务"、"完成 vs 修改"分别该谁赢。这些**必须从产品语义倒推**，不能照搬 SP 的 archive 语义。

---

## 5. 宿主接入面：端口（Ports）

`ports.ts`（106 行）定义了宿主必须实现的接口——**这是我们把 sync-core 接进自己应用时要写的全部胶水代码**：

| Port | 行 | 宿主需要做什么 |
|---|---|---|
| `OperationApplyPort` | `:24-35` | `applyOperations(ops, options)` → 把操作批次应用到宿主状态 |
| `ReducerCommitAwareOperationApplyPort` | `:44-56` | 同上，但**必须**提供 `onReducersCommitted` 回调（崩溃安全：先持久化 reducer 提交簿记，再做归档副作用） |
| `ActionDispatchPort` | `:63-65` | `dispatch(action)` → 必须**原样保留** action 对象，尤其是 `meta` |
| `RemoteApplyWindowPort` | `:70-75` | 标记"正在应用远端操作"窗口，抑制本地副作用 |
| `DeferredLocalActionsPort` | `:80-82` | 重放期间被延迟的本地用户操作，事后冲正 |
| `ArchiveSideEffectPort` | `:87-89` | 远端动作重放后的宿主副作用 |
| `ConflictUiPort` | `:104-106` | 冲突对话框；返回字符串，**用户可选项（USE_LOCAL / USE_REMOTE / CANCEL）由宿主定义** |

`SyncActionLike`（`:16-19`）刻意做成最小形状：`{ type: string; meta?: unknown }`——宿主保留自己的 action 类型。

> **这是一个教科书式的六边形架构（ports & adapters）**。sync-core 不含任何 UI/状态框架概念，
> 我们实现这 7 个端口就能把它接进 Flutter / Redux / 任何状态模型。

---

## 6. 端到端加密（`encryption.ts` 425 行 + `encryption/` 8 个文件）

**线上格式是文档化的公开契约**（`encryption.ts:14-21`）：

```
Argon2id 密文 : [SALT (16)][IV (12)][AES-GCM ciphertext + auth tag]
Legacy PBKDF2 : [IV (12)][AES-GCM ciphertext + auth tag]
```

- base64 编码传输；`detectFormat()` **按长度判别**：`< 28B` 非法、`< 44B` 一定是 legacy、`>= 44B` 按 Argon2id 处理并在认证失败时回退 legacy
- **IV**：每次调用从 CSPRNG 新取 12 字节（保证 GCM 密钥下 IV 唯一）
- **Salt**：每个 (进程会话, 密码) 派生一次后复用，靠 session cache 摊销 **500ms–2s 的 Argon2id 派生开销**（`:37-45`）
- WebCrypto 优先，`@noble/ciphers` 作为回退（`crypto.subtle` 不可用时，**典型场景是 Android Capacitor 的 `http://localhost`**）
- 导出 `setLegacyKdfWarningHandler` 让宿主在 legacy 解密路径弹弃用提示

---

## 7. 🎯 跨语言可移植性：上游已经给出先例

**这是本次拆解最有价值的发现。**

上游在 Android 侧用 Kotlin **独立重新实现了加解密**，并且 **CI 每次跑都用 TS 版实时生成的密文去验证一致性**：

> `encryption.ts:24-26`
> "The Android background sync reads the Argon2id format independently (**android `crypto/OpPayloadDecryptor.kt`**) — changes here must be mirrored there and its fixtures regenerated."
> "CI verifies the round-trip live: `tools/generate-android-crypto-fixtures.mjs` feeds fresh `encrypt()` output to the Kotlin tests on every Android CI run."

实测 Kotlin 侧规模：

| 文件 | 行数 |
|---|---|
| `crypto/Argon2.kt` | 371 |
| `crypto/Blake2b.kt` | 124 |
| `crypto/OpPayloadDecryptor.kt` | 138 |
| **加解密小计** | **633** |

配套测试：`Argon2Test.kt`、`OpPayloadDecryptorTest.kt`、**`LiveJsEncryptRoundTripTest.kt`**、`EncryptedOpFixtures.kt`（冻结向量 + 实时向量双保险）。
生成器 `tools/generate-android-crypto-fixtures.mjs` 用真实 `sync-core` 的 `encrypt()` 产出 TSV（含非 ASCII 密码 `live-fixture-pässword-🔑`、Unicode 载荷、大载荷三种用例）。

### ⚠️ 但必须精确区分：Kotlin 只移植了"读"，没移植"同步引擎"

实测 `SuperSyncBackgroundProvider.kt`（438 行）的职责是：
- 轮询 SuperSync 服务端的 op 增量
- 解密 payload
- **提取提醒相关变更（`remindAt` / `deadlineRemindAt`）**
- 排程本地通知

它**不实现向量时钟，也不做冲突解决**：
```
grep -rn "vectorClock|VectorClock|conflict" android/app/src/main/java/
→ 零命中
```

同时 **iOS 完全没有原生实现**：`ios/` 只有 7 个 Swift 文件，全是插件（ShareInbox、WebDavHttp、StoreReview），同步依赖 Capacitor WebView。

### 结论：跨语言成本可以精确估算了

| 层 | 规模 | 已有人移植过吗 | 移植风险 |
|---|---|---|---|
| 加解密（Argon2id + AES-GCM） | ~630 行 | ✅ **Kotlin 已做，CI 验证互通** | 🟢 低——有参考实现 + 互操作测试模式可照搬 |
| 向量时钟 + 冲突解决 | sync-core 4,240 行中的核心 | ❌ 无人移植 | 🟡 中——算法小但**必须逐位一致**，需跨语言一致性测试 |
| op-log 持久化 / 重放 / 崩溃恢复 | 部分在 sync-core，部分在 Angular app 的 `src/app/op-log/` | ❌ | 🟠 中高——与宿主存储层强耦合，这部分**大概率要自己实现** |

---

## 8. 复用结论

### ✅ 强烈建议复用

`sync-core` 可以直接作为 heyta 的同步底座：

1. **许可证无风险**：MIT，运行时依赖仅 `@noble/ciphers` + `hash-wasm`（均宽松）
2. **体积小**：4,240 行，一天可通读
3. **测试扎实**：271 个测试，冲突解决和加密覆盖充分
4. **架构干净**：六边形架构，7 个端口就是全部胶水层
5. **为复用而设计**：源码注释明确表示要保持宿主无关
6. **生产验证**：已在真实用户设备上跑，且经过安全公告级别的对抗审查
7. **协议固化**：加密线上格式和向量时钟算法都是文档化契约，长期稳定

### ⚠️ 需要我们自己决策/实现的部分

| 项 | 说明 |
|---|---|
| **实体注册表** | 定义 heyta 的实体类型（Task / List / Tag / Habit / HabitLog / FocusSession...）和 `storagePattern` |
| **actionType 命名空间** | 设计自己的 action 类型体系（如 `[Task] Update`） |
| **冲突策略** | 归档/删除/完成的优先级语义必须从滴答清单的产品语义倒推，**不能照搬 SP** |
| **端口实现** | 7 个 Port 的宿主侧实现（状态容器、UI 冲突对话框等） |
| **op-log 持久化** | sync-core 不管存储；`src/app/op-log/` 里的持久化层是 Angular 相关的，**需要重写** |
| **跨语言策略** | 见上文第 7 节。若 UI 不用 JS 栈，需要决策：移植 or sidecar or 服务端权威 |

### ❌ 不要依赖的部分

- `OpType.SyncImport` / `BackupImport` / `Repair` 三个成员是 **SP 宿主专属的遗留**，上游自己标注了 deprecated，新宿主应改用 `createFullStateOpTypeHelpers` 自己注册
- `sync-file-prefix` 是文件型同步（WebDAV/Dropbox）的辅助，走 SuperSync 服务端时不需要

---

## 9. 未确认项

- 未逐行读 `remote-apply.ts`(373)、`replay-coordinator.ts`(270)、`compression.ts`(322)、`upload-planning.ts`、`download-planning.ts` 的完整逻辑
- 未验证 `sync-core` 单独构建（`tsup.config.ts`）后能否脱离 monorepo 独立发布
- 未确认 `@noble/ciphers` + `hash-wasm` 在 Dart/Flutter 环境下的等价替代
- 未实测 4,240 行移植到 Dart 的实际工作量

---

*本报告基于源码实测。相关文档见 `research/upstream/super-productivity/docs/sync-and-op-log/`（含 `operation-log-architecture.md`、`vector-clocks.md`、`supersync-encryption-architecture.md`）。*
