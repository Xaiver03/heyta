# 复用方案：拿什么、改什么、建什么

> 这是本阶段的核心决策文档。
> 所有数字来自本机实测（`research/upstream/` 下的真实代码）。
> 配套深度报告：`research/deep-dive-sync-core.md`、`research/deep-dive-supersync-server.md`、
> `research/deep-dive-schema-providers.md`、`research/deep-dive-cross-language-and-components.md`

---

## 0. 一句话结论

**Super Productivity 的同步系统不是一个整体，它是"一个可复用的小内核 + 一个不可复用的巨大外壳"。**

| 层 | 位置 | 规模 | 能否复用 |
|---|---|---|---|
| **通用内核** | `packages/sync-core` | **4,240 行** | ✅ **直接复用** |
| 数据契约 | `packages/shared-schema` | 952 行 | 🟡 改（实体清单是 SP 专属的） |
| 服务端 | `packages/super-sync-server` | 148 个 ts 文件 | ✅ 复用 + 改实体清单 |
| **编排外壳** | `src/app/op-log/` | **51,708 行** | ❌ **必须重写**（Angular/NgRx 深度耦合） |

**心智模型**：`sync-core` 给你**零件**（向量时钟、冲突判定、加密、端口契约）；
`src/app/op-log/` 是**用这些零件造出来的整机**，但那台整机是用 Angular 焊死的。

---

## 1. 精确的分层账本

### 1.1 ✅ 可直接复用（约 4,240 行 + 服务端）

**`packages/sync-core`** —— 实测证据：

| 指标 | 值 |
|---|---|
| 源码 | **4,240 行**，13 个源文件 + 8 个 encryption 文件 |
| 测试 | **271 个** |
| 运行时依赖 | **2 个**（`@noble/ciphers`、`hash-wasm`） |
| 框架耦合 | **零** —— README 明确 "no Angular/Electron/Capacitor dependencies" |
| 许可证 | MIT |

内容：op-log 类型模型、向量时钟、LWW 冲突解决、E2E 加密（Argon2id + AES-256-GCM）、
上传/下载规划、重放协调、远端应用、压缩、7 个宿主端口（Ports）。

**它明确是为"被别的宿主复用"而设计的**——源码注释原话：
> "The sync core keeps entity names opaque. **Host apps provide the actual entity registry**."
> "**Framework-agnostic**... Host applications that wire their own state framework (NgRx, Redux, etc.) extend `EntityConfig`..."

### 1.2 ❌ 必须重写（约 51,708 行）

**`src/app/op-log/`** —— 实测分布：

| 子目录 | 文件 | 行数 | 内容 |
|---|---|---|---|
| `sync/` | 42 | **19,089** | 同步编排。最大单文件 `conflict-resolution.service.ts` = **4,838 行** |
| `persistence/` | 25 | **9,728** | 操作日志存储。`operation-log-store.service.ts` = **3,212 行** |
| `validation/` | 15 | 5,215 | 校验、数据修复 |
| `apply/` | 10 | 2,462 | 操作应用、归档副作用 |
| `backup/` | 4 | 1,592 | 备份/恢复、旧格式迁移 |
| `capture/` | 4 | 1,511 | 捕获用户操作 → op |
| `core/` | 9 | 1,444 | action 类型枚举、实体注册表、常量 |
| 其余 | — | ~2,700 | encryption、model、util、clean-slate |
| **合计** | **166** | **51,708** | |

**耦合证据**：抽样 40 个文件，`@angular`/`@ngrx`/`@Injectable`/`inject()` 命中数：

```
29  operation-log-sync.service.ts
18  conflict-resolution.service.ts
14  server-migration.service.ts
11  superseded-operation-resolver.service.ts
10  ws-triggered-download.service.ts
```

这些是 Angular `@Injectable` 服务，**无法在非 Angular 环境使用**。
它们 **81 处 import 了 `@sp/sync-core`** —— 也就是说 **op-log 是 sync-core 的使用者，不是它的替代品**。

### 1.3 ⚠️ 一个重要的量级对比

```
sync-core（可复用）       4,240 行   ██
op-log/sync+persistence  28,817 行   ██████████████
op-log 全部              51,708 行   ██████████████████████████
```

**单文件 `conflict-resolution.service.ts`（4,838 行）比整个 `sync-core`（4,240 行）还大。**

含义：真正的工作量不在"合并算法"，而在**编排、持久化、恢复、校验、边界情况**。
引不引入 sync-core，这 5 万行的活儿你都躲不掉——**但 sync-core 让你少写其中最难写对的那 4 千行**。

---

## 2. 一块隐藏的宝藏：`op-log/persistence` 有存储适配器接缝

实测 `persistence/op-log-db-adapter.ts` 定义了一个**完整的数据库抽象接口**：

```ts
export interface OpLogDbAdapter {
  init(): Promise<void>;
  close(): void;
  add(store: string, value: unknown): Promise<number>;
  put(store: string, value: unknown, key?: DbKey): Promise<void>;
  delete(store: string, key: DbKey): Promise<void>;
  clear(store: string): Promise<void>;
  count(store: string, range?: DbKeyRange): Promise<number>;
  getKeyFromIndex(...): Promise<...>;
  countFromIndex(...): Promise<number>;
  // + 事务、游标迭代
}
```

已有两个实现：
- `indexed-db-op-log-adapter.ts`（464 行）—— 浏览器/WebView
- `sqlite-op-log-adapter.ts`（889 行）—— 原生

**这是我们重写持久化层时最值得抄的设计**：把存储抽象成接口，业务逻辑不关心底层是 IndexedDB、SQLite 还是别的。

⚠️ 注意：**接口可抄，实现不可直接搬**（`operation-log-store.service.ts` 是 Angular service）。但"存储适配器"这个模式 + 它的方法集设计，是现成的高质量蓝图。

---

## 3. 复用矩阵（终版）

| 资产 | 位置 | 决策 | 理由 |
|---|---|---|---|
| `sync-core` | `packages/` | ✅ **直接用** | MIT、零框架耦合、271 测试、为多宿主设计 |
| 加密线上格式 | `sync-core/encryption.ts` | ✅ **直接用** | 文档化公开契约，且**已有 Kotlin 移植 + CI 互操作验证** |
| 向量时钟算法 | `sync-core/vector-clock.ts` | ✅ **直接用** | 154 行，标准算法，客户端/服务端必须一致 |
| 冲突解决**算法** | `sync-core/conflict-resolution.ts` | ✅ 直接用 | LWW + 确定性破平 |
| 冲突解决**策略** | — | 🔧 **自研** | 归档/删除/完成谁赢，必须从滴答清单语义倒推，**不能照搬 SP** |
| 宿主端口定义 | `sync-core/ports.ts` | ✅ **直接用** | 7 个 Port，就是全部胶水层 |
| 实体注册表 | `shared-schema/entity-types.ts` | 🔧 **改写** | **硬编码 SP 的 21 种实体**，且服务端会拒绝未知类型 |
| 迁移系统 | `shared-schema/migrate.ts` | ✅ 参考/复用 | 303 行，schema 版本化 |
| HTTP 线协议 | `shared-schema/supersync-http-contract.ts` | ✅ **直接用/改** | 384 行 zod schema，含全部端点与错误码 |
| `super-sync-server` | `packages/` | ✅ **复用 + 改实体清单** | Fastify + Prisma + Postgres，生产验证过 |
| 存储适配器**模式** | `op-log/persistence/op-log-db-adapter.ts` | 📖 **抄设计** | 接口可抄，实现不可搬 |
| op-log 编排 | `src/app/op-log/` | ❌ **重写** | 51,708 行 Angular 服务 |
| op-log 校验/修复 | `op-log/validation/` | 📖 **参考** | 5,215 行，含数据修复真实案例 |
| CalDAV provider | `src/app/features/issue/providers/caldav/` | ❌ **不要碰** | ⚠️ 引入 AGPL（`@nextcloud/cdav-library`） |
| Debt: 习惯模块 | `src/app/features/simple-counter/` | ❌ **重写** | ⚠️ SP 的"习惯"只是计数器 + streak，无 target/unit/热力图 |

图例：✅ 直接复用 ｜ 🔧 改造后复用 ｜ 📖 参考设计 ｜ ❌ 重写

---

## 4. 三个必须自己决策的点

### 4.1 实体清单要重新设计

SP 的 `ENTITY_TYPES`（`shared-schema/entity-types.ts:15-37`）是**硬编码的 21 项**，且：
> "Operations with unknown entity types **will be rejected by the server**."

heyta 需要自己的清单。对照 SP：

| SP 有 | heyta 需要 |
|---|---|
| `TASK` `PROJECT` `TAG` `NOTE` | ✅ 直接对应 |
| `TASK_REPEAT_CFG` `REMINDER` | ✅ 对应（重复规则/提醒） |
| `BOARD` `SECTION` `PLANNER` | ⚠️ 对应四象限/看板/日历（需重新设计语义） |
| `SIMPLE_COUNTER` | ⚠️ **SP 的习惯。我们要 `HABIT` + `HABIT_LOG`，语义不同** |
| `METRIC` | ⚠️ SP 用它记专注会话（`METRIC_LOG_FOCUS_SESSION`）。我们要 `FOCUS_SESSION` |
| `WORK_CONTEXT` `TIME_TRACKING` `ISSUE_PROVIDER` `PLUGIN_*` `MENU_TREE` | ❌ 不需要 |

**这是"改造"而非"直接复用"的核心工作**：`shared-schema` 和 `super-sync-server` 都依赖这份清单，改一处要同步改两处。

### 4.2 冲突策略必须从滴答清单语义倒推

`sync-core` 的 `planLwwConflictResolutions` 把策略留给了宿主（`options.isArchiveAction`、delete-wins 开关、`toEntityKey`）。

我们需要自己回答：
- 清单被删除时，其中的任务怎么算？（滴答清单：连带删除）
- "完成任务" vs "修改任务" 并发时谁赢？
- "归档清单" vs "清单内新增任务" 并发时谁赢？
- 标签被删 vs 任务上还挂着该标签？

**SP 的 archive 语义和我们的不完全一致，照搬会埋雷。**

### 4.3 跨语言策略必须先定

见 `research/deep-dive-cross-language-and-components.md`。已知的关键事实：

- ✅ **加密层有跨语言先例**：上游用 Kotlin 重写了 Argon2id + AES-GCM（**633 行**），且有 `LiveJsEncryptRoundTripTest` + `tools/generate-android-crypto-fixtures.mjs`，**CI 每次用真实 TS 加密结果验证 Kotlin 解密**。
- ❌ **同步算法没有跨语言先例**：`grep vectorClock android/app/src/main/java/` → 零命中。Kotlin 侧只做"后台读提醒"，不实现向量时钟与冲突解决。
- ✅ iOS 侧完全没有原生实现（只有 7 个 Swift 插件文件），同步走 Capacitor WebView。

**推论**：如果 UI 用 Flutter/Dart，要么把 sync-core 移植到 Dart（算法小、测试可照搬），要么走"服务端权威 + 客户端薄缓存"。

---

## 5. 工作量估算（诚实版）

| 模块 | 来源 | 估算 |
|---|---|---|
| 同步内核 | `sync-core` 直接用 | **省掉 4,240 行的最难部分** |
| 线协议 | `supersync-http-contract` 改造 | 小 |
| 同步服务端 | `super-sync-server` 复用 + 改实体 | 小～中 |
| 实体清单 | 重新设计 | 中（牵一发动全身） |
| **op-log 编排层** | **必须重写** | **🔴 大 —— 这是项目的主要工作量** |
| 冲突策略 | 自研 | 中（需要产品决策） |
| UI | 自研或借 | 大 |
| 习惯模块 | 自研（SP 的不够用） | 中 |

**结论：复用能帮你省掉"最容易写错"的部分，但省不掉"工作量最大"的部分。**
真正的杠杆在于——`src/app/op-log/` 那 5 万行是**一份可读的参考答案**，
它记录了无数真实踩坑（崩溃恢复状态机、墓碑、向量时钟裁剪、并发边界）。
**移植它的语义而不是拷贝它的代码**，是这里最大的复利。

---

## 6. 未完成

- [ ] `super-sync-server` 端点清单、鉴权、DB schema、部署（子任务进行中）
- [ ] `shared-schema` 实体字段级细节 + 迁移策略（子任务进行中）
- [ ] 跨语言方案评级 + 外部组件许可证盘点（子任务进行中）
- [ ] `research/licenses.md` 依赖登记表

---

*所有数字均为 2026-09-25 本机实测。上游代码位置：`research/upstream/`（已 gitignore）。*
