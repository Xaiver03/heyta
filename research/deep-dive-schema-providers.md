# 深度拆解：`shared-schema` + `sync-providers`

> 对象：`research/upstream/super-productivity/packages/shared-schema/` 与 `packages/sync-providers/`
> License：均 **MIT**
> 拆解方式：直接读源码。所有结论附文件路径与行号。
> 拆解时间：2026-09-25

---

## 0. 结论摘要

| 组件 | 规模 | 能否独立复用 | 关键结论 |
|---|---|---|---|
| `shared-schema` | 952 行 | 🟡 **部分** | **实体清单是 SP 专属硬编码**，必须改；但迁移系统与 HTTP 契约值得复用 |
| `sync-providers` | 834 行 | ✅ 可以（peer 依赖 sync-core） | Provider 抽象清晰，支持"服务端推送"与"文件同步"两种模式 |

---

## 1. `shared-schema`

### 1.1 实体清单 —— ⚠️ 这里就是"SP 专属"的根源

`src/entity-types.ts:15-37`，**21 项硬编码**：

```ts
export const ENTITY_TYPES = [
  'TASK', 'PROJECT', 'TAG', 'NOTE', 'GLOBAL_CONFIG', 'SIMPLE_COUNTER',
  'WORK_CONTEXT', 'TIME_TRACKING', 'TASK_REPEAT_CFG', 'ISSUE_PROVIDER',
  'PLANNER', 'MENU_TREE', 'METRIC', 'BOARD', 'SECTION', 'REMINDER',
  'PLUGIN_USER_DATA', 'PLUGIN_METADATA', 'MIGRATION', 'RECOVERY',
  'ALL',   // For full state imports (sync, backup)
] as const;
```

注释原文（`:11-14`）：
> "Valid entity types for operations. **Operations with unknown entity types will be rejected by the server.**"
> "IMPORTANT: This module is shared between client and server. **Any changes must be compatible with both environments.**"

**这是 heyta 必须改造的第一个点。** 对照映射：

| SP 实体 | heyta 对应 | 处理 |
|---|---|---|
| `TASK` `PROJECT` `TAG` `NOTE` | 任务 / 清单 / 标签 / 笔记 | ✅ 直接对应 |
| `TASK_REPEAT_CFG` `REMINDER` | 重复规则 / 提醒 | ✅ 对应 |
| `BOARD` `SECTION` `PLANNER` | 四象限 / 看板 / 日历 | ⚠️ 语义需重新设计 |
| `SIMPLE_COUNTER` | **SP 的"习惯"** | ⚠️ **换成 `HABIT` + `HABIT_LOG`**（语义不同，见 `docs/01-oss-landscape.md` 更正） |
| `METRIC` | SP 用它记专注会话（`METRIC_LOG_FOCUS_SESSION`） | ⚠️ 换成 `FOCUS_SESSION` |
| `GLOBAL_CONFIG` `MIGRATION` `RECOVERY` `ALL` | 系统实体 | ✅ 保留 |
| `WORK_CONTEXT` `TIME_TRACKING` `ISSUE_PROVIDER` `PLUGIN_*` `MENU_TREE` | — | ❌ 不需要 |

> ⚠️ **改动是"连带"的**：`shared-schema` 和 `super-sync-server` 都依赖这份清单，
> 服务端的 `validation.service.ts` 会拒绝未知实体。**改一处要同步改两处。**

### 1.2 Schema 版本策略 —— 一份极有价值的"不要乱 bump"政策

`src/schema-version.ts:1-47` 是一篇完整的**版本管理血泪史**，核心结论：

```ts
export const PROJECT_DELETE_WINS_SCHEMA_VERSION = 4;
export const CURRENT_SCHEMA_VERSION = PROJECT_DELETE_WINS_SCHEMA_VERSION;
export const MIN_SUPPORTED_SCHEMA_VERSION = 1;
// NOTE: there is deliberately NO forward-compat band
```

**政策原文要点**：
- **"DO NOT BUMP THIS LIGHTLY — default is to NOT bump."**
- bump 是**近乎单向的栅栏**：一旦任何 op 带上了新版本号就**无法回退**
- **bump 并不能保护已发布的客户端**：v17.0.0–v18.14.0 的客户端容忍到 schema 5，**且会"未迁移地直接应用"**，只弹一次警告
- 若旧客户端能未迁移应用，**应该用 payload 标记（envelope 模式）而不是 bump**
- **反例记录**：v4（#9009 project delete-wins）**为一个纯标记变更做了 bump，根本不需要**，结果把所有滞后的客户端硬栅栏住了

配套的 `migrations/index.ts:10-22` 甚至把这个政策写进了"如何新增迁移"的第 0 步：
> "**0. STOP — do you actually need a version bump?** ... If old clients can apply the op unmigrated, gate the new semantics on a payload marker and DON'T bump."

**对我们的价值**：这套"**优先用向前兼容的 envelope，而不是版本栅栏**"的哲学，
是任何做多端同步的产品都要付学费才学到的。**我们应当直接继承这个政策**。

### 1.3 迁移系统

`src/migrate.ts`（303 行）导出：

| 函数 | 行 | 作用 |
|---|---|---|
| `stateNeedsMigration` | `:15` | 判断状态是否需要迁移 |
| `operationNeedsMigration` | `:26` | 判断操作是否需要迁移 |
| `migrateState` | `:43` | 迁移状态 |
| `migrateOperation` | `:108` | 迁移单个操作 |
| `migrateOperations` | `:214` | 批量迁移 |
| `validateMigrationRegistry` | `:253` | 校验迁移注册表 |
| `getCurrentSchemaVersion` | `:301` | |

`migration.types.ts` 的 `SchemaMigration` 接口（`:32`）支持双向：`migrateState` + `migrateOperation`
（`migrateOperation` 返回 `null` 表示丢弃该 op）。

**已注册的 3 个迁移**（`migrations/index.ts:43-47`）：
1. `MiscToTasksSettingsMigration_v1v2`
2. `LwwReplacementBarrierMigration_v2v3`
3. `ProjectDeleteWinsBarrierMigration_v3v4`

测试覆盖：`tests/migrate.spec.ts` + 每个迁移一个 spec + **`released-client-compatibility-policy.spec.ts`**（把"已发布客户端兼容性政策"做成了可执行测试）。

### 1.4 HTTP 线协议 —— `supersync-http-contract.ts`（384 行 zod）

**这是我们写客户端时最该直接照搬的文件。**

#### 硬性限制（`SUPER_SYNC_*` 常量）

| 常量 | 值 | 行 |
|---|---|---|
| `SUPER_SYNC_MAX_CLIENT_ID_LENGTH` | 255 | `:4` |
| **`SUPER_SYNC_MAX_OPS_PER_UPLOAD`** | **100** | `:5` |
| `SUPER_SYNC_MAX_ENTITY_IDS_PER_OP` | 1000 | `:6` |
| `SUPER_SYNC_CLIENT_ID_REGEX` | `/^[a-zA-Z0-9_-]+$/` | `:3` |
| 下载 `limit` | 1–1000 | `:166` |
| `schemaVersion` | 整数 1–100 | `:128` |

#### 枚举

- `SUPER_SYNC_OP_TYPES`（`:14`）
- `SUPER_SYNC_IMPORT_REASONS`（`:25`）
- `SUPER_SYNC_SNAPSHOT_REASONS` = `['initial', 'recovery', 'migration']`（`:34`）
- `SUPER_SYNC_ERROR_CODES`（`:51-87`）—— 完整错误码，分组清晰：

| 分组 | 错误码 |
|---|---|
| 校验 | `VALIDATION_FAILED` `INVALID_OP_ID` `INVALID_OP_TYPE` `INVALID_ENTITY_TYPE` `INVALID_ENTITY_ID` `INVALID_PAYLOAD` `PAYLOAD_TOO_LARGE` `INVALID_VECTOR_CLOCK` `INVALID_TIMESTAMP` `MISSING_ENTITY_ID` `INVALID_SCHEMA_VERSION` `INVALID_CLIENT_ID` |
| 冲突/重复 | `CONFLICT_CONCURRENT` `CONFLICT_SUPERSEDED` `REPAIR_STALE` `DUPLICATE_OPERATION` `SYNC_IMPORT_EXISTS` |
| 配额 | `RATE_LIMITED` `STORAGE_QUOTA_EXCEEDED` |
| 加密 | `ENCRYPTED_OPS_NOT_SUPPORTED` |
| 其他 | `INTERNAL_ERROR` |

#### 关键 Schema

- `SuperSyncOperationSchema`（`:114-134`）：与 `sync-core` 的 `Operation` 一一对应，
  多出 `isPayloadEncrypted?`、`syncImportReason?`、`repairBaseServerSeq?`
- `SuperSyncUploadOpsRequestSchema`（`:157-162`）：`{ ops[1..100], clientId, lastKnownServerSeq?, requestId? }`
- `SuperSyncDownloadOpsQuerySchema`（`:164-167`）：`{ sinceSeq, limit?, excludeClient? }`
- 响应：`SuperSyncUploadOpsResponseSchema`、`SuperSyncDownloadOpsResponseSchema`、
  `SuperSyncSnapshotResponseSchema`、`SuperSyncStatusResponseSchema`、
  `SuperSyncDevicesResponseSchema`、`SuperSyncRestorePointsResponseSchema`、
  `SuperSyncDeleteAllDataResponseSchema`

> 💡 有一整套 `*_TRANSPORT_LENGTH` 常量（如 `SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH`），
> 说明**错误回显也做了长度限制**——防止恶意超长字段在错误响应里被放大。这是安全细节。

---

## 2. `sync-providers`（834 行）

### 2.1 Provider 抽象（`src/provider-types.ts`，280 行）

**基础接口** `SyncProviderBase`（`:17-45`）：
```ts
id, isUploadForcePossible?, maxConcurrentRequests,
privateCfg: SyncCredentialStorePort<...>,
isReady(), getAuthHelper?(), setPrivateCfg(), clearAuthCredentials?(), invalidateCredentialCache?()
```

**文件型接口** `FileSyncProvider`（`:56-79`）：
```ts
getFileRev(targetPath, localRev)   // 取远端版本号
downloadFile(targetPath)
uploadFile(...)                     // 带 rev 条件写，防冲突
removeFile(targetPath)
listFiles?(targetPath)
```

**操作型接口** `OperationSyncCapable`（`:180-238`）—— 核心接缝：
```ts
supportsOperationSync, providerMode,
uploadOps(ops, clientId, lastKnownServerSeq?, localStateSnapshot?)
downloadOps(sinceSeq, excludeClient?, limit?)
getLastServerSeq() / setLastServerSeq(seq)
supportsCausalRepairSnapshots?()
uploadSnapshot(...11 个参数...)
deleteAllData()
getEncryptKey?() / isEncryptionEnabled?()
```

### 2.2 两种同步模式（关键设计）

```ts
export type OperationSyncProviderMode = 'superSyncOps' | 'fileSnapshotOps';
```

| 模式 | 代表 | 分页 | 行为 |
|---|---|---|---|
| **`superSyncOps`** | SuperSync 服务端 | ✅ 游标分页 | 增量拉取，尊重 `limit` |
| **`fileSnapshotOps`** | WebDAV / Dropbox / OneDrive | ❌ 无法分页 | **每次重下整个文件**，`hasMore` 恒为 false |

注释（`:197-202`）明确说明了这个差异：
> "cursor-based providers (SuperSync) honor it and paginate; **cursorless file-based providers cannot paginate** (they re-download the whole file each call)"

**对 heyta 的含义**：如果只做 SuperSync 服务端模式，**`sync-providers` 整个包可以不引入**。
引入它的唯一理由是支持"用户自带 WebDAV/Dropbox 同步"。

### 2.3 已有实现

| Provider | 文件 | 说明 |
|---|---|---|
| WebDAV / Nextcloud | `file-based/webdav/*`（含 `discover-nextcloud-user-id`、XML parser、HTTP adapter） | 最完整 |
| Dropbox | `file-based/dropbox/*` | OAuth + PKCE |
| OneDrive | `file-based/onedrive/*` | |
| local-file | `file-based/local-file/*`，含 `local-file-sync-android`（SAF）与 `local-file-sync-electron` | 平台分支 |
| super-sync | `super-sync/*` | 服务端模式 |

配套：`credential-store.ts` + `credential-store-port.ts`（凭据存储抽象）、
`platform/`（Web/Electron/Android 的 fetch 与文件系统差异）、`pkce.ts`（116 行）。

### 2.4 安全提示

`provider-types.ts:234-238` 引用了安全公告 **GHSA-9544-hjjr-fg8h**（"dropped-credential signature"）：
区分"全新客户端（从未配置加密）"与"加密已配置但密钥丢失"——后者是危险信号。

> 又一个证据：这套代码经过**对抗性安全审查**，不是随手写的。

---

## 3. ✅ 独立构建验证（本机实测，通过）

为确认 `sync-core` 真的能被"拿出来用"，我做了完整实测：

```
1. 从 monorepo 中拷出 packages/sync-core 到独立目录
2. npm install（脱离工作区）
3. npm run build
4. npx vitest run
```

**结果**：

| 步骤 | 结果 |
|---|---|
| 独立安装 | ✅ 成功，74 个包 |
| 构建（tsup） | ✅ 成功，**18ms** |
| 产物 | `index.mjs` 61KB / `index.js` 65KB / `index.d.mts` + `index.d.ts` 各 58KB（含 sourcemap） |
| **测试** | ✅ **13 个测试文件、271 个测试全部通过（451ms）** |

测试明细：
```
✓ tests/vector-clock.spec.ts (43)      ✓ tests/conflict-resolution.spec.ts (60)
✓ tests/encryption.spec.ts (48)        ✓ tests/remote-apply.spec.ts (23)
✓ tests/sync-file-prefix.spec.ts (19)  ✓ tests/sync-import-filter.spec.ts (16)
✓ tests/download-planning.spec.ts (14) ✓ tests/replay-coordinator.spec.ts (12)
✓ tests/compression.spec.ts (11)       ✓ tests/transport-shape.spec.ts (9)
✓ tests/error.util.spec.ts (7)         ✓ tests/upload-planning.spec.ts (6)
✓ tests/full-state-op-types.spec.ts (3)
Test Files  13 passed (13)     Tests  271 passed (271)
```

**结论：`@sp/sync-core` 确认可以脱离 Super Productivity 独立使用。**
它有自己的 `package.json`（无工作区内部依赖）、自己的 `tsup.config.ts` / `tsconfig.json`，
产出标准的 ESM + CJS + 类型声明，可直接作为 npm 依赖引入。

> 环境备注：本机 npm 10.9.8 在默认缓存下会报 `Cannot read properties of null (reading 'edgesOut')`，
> 需加 `--no-package-lock --legacy-peer-deps` 并用全新缓存目录。**这是本机环境问题，不是代码问题。**

---

## 4. 复用结论

| 资产 | 决策 | 说明 |
|---|---|---|
| `entity-types.ts` | 🔧 **改写** | 换成 heyta 实体清单，**同步改服务端校验** |
| `schema-version.ts` 的**政策** | ✅ **继承** | "默认不 bump，优先 envelope 向前兼容" |
| `migrate.ts` + `migration.types.ts` | ✅ **复用** | 双向迁移框架，设计干净 |
| `migrations/` 具体迁移 | ❌ 丢弃 | SP 专属 |
| `supersync-http-contract.ts` | ✅ **直接复用/微调** | 384 行 zod，端点、错误码、限制齐全 |
| `sync-providers` 整体 | ⚠️ **按需** | 只走服务端模式则不需要；要 WebDAV 支持再引入 |
| `provider-types.ts` 的抽象 | ✅ **参考** | 两种模式（游标/文件）的区分很实用 |
| `credential-store` 抽象 | ✅ 参考 | 凭据存储与平台解耦 |

---

## 5. 未确认项

- 未跑 `shared-schema` / `sync-providers` 的独立构建与测试（`sync-core` 已实测通过）
- 未读 `file-based/webdav/*` 的完整实现细节
- 未确认 `shared-schema` 与 `super-sync-server` 之间的版本绑定方式
- `released-client-compatibility-policy.spec.ts` 的具体断言未逐条阅读

---

*相关：`research/deep-dive-sync-core.md`、`research/deep-dive-supersync-server.md`、`docs/06-reuse-plan.md`*
