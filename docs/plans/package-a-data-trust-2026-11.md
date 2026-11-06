# A 包 · 数据可信（R1 + R2 + R7）实施计划

> 上游：[产品需求对齐清单](ticktick-parity-prd-2026-11.md) P0 R1 / P0 R2 / P1 R7。
> 本文件回答「**怎么做、按什么顺序、每条的判据怎么才会红**」。
> 决策的不可逆部分在 [ADR-0084](../adr/0084-local-library-ownership-and-signout-erasure.md)。

**状态**：进行中（2026-11-06 开工）
**交付三件**：① 本计划 + ADR ② 实现 + 门禁读数 ③ 用户可见变化的验收记录。

---

## 0. 一句话

三条需求共用同一个东西：**op-log 既要知道「这条数据是谁的」，也要能回答「我改过什么、能不能退回去」**。
R1 给库加归属，R2 给写路径加历史栈，R7 把「本地写的还没上去」这个事实翻译给人看。

---

## 1. 切片顺序（每片单独可验收）

| # | 切片 | 落点 | 为什么排这里 |
|---|---|---|---|
| S1 | **R2 历史栈**（引擎层，无 UI） | `packages/op-log` | 自包含、可单测；R1/R7 都要碰同一个引擎，先把它钉稳 |
| S2 | **R1 归属 + 登出销毁**（共享层） | `packages/app-host` + `packages/storage`（只加 META key） | 决策已由 ADR-0084 定；不依赖 UI |
| S3 | **R1 两个壳接线**（web / mobile） | `apps/web` / `apps/mobile` | 只有壳知道「登出按钮在哪」 |
| S4 | **R7 状态源**（引擎已够，补 `LAST_SYNCED_AT`） | `packages/app-host` + `packages/sync-client` 接线处 | 依赖 S2 的库句柄 |
| S5 | **R7 最小可见面**（web 设置 → 同步 + rail 徽标） | `apps/web` | 一条用户能读懂的句子，不做同步面板 |
| S6 | 门禁 + 故障注入读数 + 验收记录 | 全仓 | 交付物 ②③ |

**顺序理由**：S1 是纯函数层，先做能拿到「能红」的最短反馈回路；S2/S3 是 P0 的主体；
S4/S5 只读不写，最后做，返工最便宜。

---

## 2. R1 · 多账号本地库隔离

### 2.1 现状（证据，落到行）

| 事实 | 位置 |
|---|---|
| 三个壳的库名写死 | `apps/mobile/src/db/open-host.ts`（`DB_NAME = 'heyta.sqlite'`）、`apps/web/src/lib/oplog.ts:451`（`initOpLog(dbName = 'heyta')`）、`apps/desktop/src/host.ts`（`DESKTOP_DB_FILENAME`） |
| op-log 里**没有任何账号字段** | `packages/storage/src` 全库 `grep accountId` = 0；META 只有一个 `vaultKeyScopeV1` 是账号作用域 |
| Web 退出登录只清凭据 | `apps/web/src/features/settings/signOutStore.ts` → `clearCredentials()`（`features/sync/store.ts:751`），**不碰** IndexedDB / OPFS |
| 移动端退出登录只清凭据与钥匙 | `apps/mobile/src/screens/ProfileScreen.tsx` 的 `onClearCredentials`；`resetTaskHostCache()` 只被账号注销调用 |
| 已存在的正确销毁器 | `apps/web/src/lib/local-data-destruction.ts:258 eraseWebLocalData`；`packages/app-host/src/local-erasure.ts:83 eraseLocalData` |
| 已存在的**部分**隔离 | 仅限 central cookie 传输：`apps/web/src/features/auth/central-account-switch.ts`（`centralBindingConflict === 'mismatch'` 才可达） |

**结论**：销毁器是齐的，**接线只接了「注销账号」与「官方账号切换冲突」两条，没接普通退出登录**；
而且库本身不记归属，所以「这台机器上的库是谁的」在数据层无法回答。

### 2.2 决策（详见 ADR-0084）

**一库一账号**：库在第一次带 `accountId` 的认证会话出现时绑定归属；**退出登录 = 本机库销毁**
（销毁前必须能回答「有没有东西还没上去」）；**归属不符 = 拒绝，并给一条清除出口**。

不选「单库 + accountId 分区键」：它要求 op 与实体都带 accountId、每条读路径都过滤，
漏一处就是跨账号可见，而漏掉的那一处**不会报错**；也不选「每账号一个库文件」：
它把上一个账号的明文继续留在磁盘上，正是这条 P0 要断的那件事。

### 2.3 实现形状

1. `packages/storage/src/stores.ts` 加两个 META key（**不 bump `CURRENT_SCHEMA_VERSION`**）：
   `LOCAL_LIBRARY_OWNER`（JSON：`{accountId, serverOrigin, boundAt}`）。
2. `packages/app-host/src/library-owner.ts`（新）：
   - `readLibraryOwner(store)` / `claimLibraryOwner(store, owner)` → `'bound' | 'same' | 'mismatch'`；
   - `LocalLibraryOwnedByAnotherAccountError`（带当前 owner，供界面说人话）；
   - `purgeLocalLibrary()`：`hasLocalEraser()` 为假 ⇒ `{skipped:'no-eraser'}`（全新安装没有库）；为真 ⇒ 走 `eraseLocalData()` 并把逐类报告带回。
3. `AppHost`：
   - `sync()` 入口与 `dispatch` 入口都先 `assertLibraryOwner`（fail closed，错误类型可判别）；
   - 新增 `libraryOwner()` / `claimLibrary()` / `purgeLibrary()` / `localDataSummary()`。
4. Web：`apps/web/src/lib/oplog.ts` 暴露同一组函数；`clearCredentials()` 之后接
   `purgeLocalLibrary()`（由 `signOutStore` 编排，成功/失败都要说）；登录时
   （`applyAuthToken` / `applyCentralAuth`）**先 claim 再落凭据**，mismatch ⇒ 不落凭据 + 冲突面板。
5. 移动端：`onClearCredentials` 里 `await purgeLocalLibrary()`（在 `clearMobileVaultSession` 之前
   把 host 停掉），`resetTaskHostCache` 已由 `onLocalDataErased` 接好；登录 `saveAuthSession` 里先 claim。

### 2.4 判据（每条都写「怎么才会红」）

| # | 判据 | 怎么才会红 |
|---|---|---|
| R1-a | 账号 A 写 3 条任务 → 登出 → 库为空：`countAllOps() === 0` 且 `state.tasks` 里查不到 A 的任何 id | 把 `purgeLocalLibrary()` 的调用注掉 ⇒ 断言必须失败（**故障注入实测，读数记入 §5**） |
| R1-b | 登出后重新以 A 登录：数据由服务端回放恢复（本地为空库是**事实**，不是界面隐藏） | 若把「销毁」改成「只隐藏」，R1-a 的存储层断言必红 |
| R1-c | 归属不符时 `sync()` / `dispatch()` 抛 `LocalLibraryOwnedByAnotherAccountError`，且错误里带当前 owner | 把 `assertLibraryOwner` 注掉 ⇒ 单测必须失败 |
| R1-d | 登出前 `pendingUpload > 0` 时**不许静默销毁**：`planLibraryPurge()` 返回 `requiresConfirmation: true` + 条数 | 把 `pendingUpload` 判定改成常量 0 ⇒ 单测必须失败 |
| R1-e | `CURRENT_SCHEMA_VERSION` 不变（有断言） | 加字段时顺手 bump ⇒ 既有 schema 断言红 |

### 2.5 残余（写清，不藏）

- 「切回 A 数据完整回来」依赖服务端回放，本包**不新造同步服务端**：由既有
  `pnpm verify:p1`（零 mock、真服务端）覆盖；本包只新增「销毁前队列必须已清」的前置判据。
- 匿名（未登录）本地库**不销毁**：没有账号就没有「换账号」语义，它的数据属于这台设备。
- 归属不符时的「清除并切换」在 web 走 `eraseWebLocalData`（会连主题/语言一起清）——
  这是那个销毁器的既定语义（注销后不该留痕迹），不在本包改。

---

## 3. R2 · 撤销历史栈

### 3.1 现状

- 生产代码**没有历史栈**：`undoStack|redoStack` 全仓只命中测试；⌘Z 是空操作。
- 只有「5 秒回执」（`scripts/check-undo-receipt.mjs` 管的危险档），它撤销的是**刚发生的那一次**，
  不是历史。
- op-log 的 DELETE 是**字段级墓碑**（`deletedAt = op.timestamp`），恢复 = 一条 `UPD {deletedAt:null}`
  （`project-actions.ts:391`）。⇒ 反向 op 是**可表达的**，不需要物理删历史。

### 3.2 设计（`packages/op-log/src/history.ts` + 引擎内挂钩）

一次本地 `dispatch` = 一条 op（现有纪律）。历史栈记的是「**这条 op 的反向意图**」：

| 原 op | 反向 op | 前提（否则拒绝，不猜） |
|---|---|---|
| `CRT` | `DEL`（墓碑） | 实体存在且未删除 |
| `UPD` | `UPD`，载荷 = 该 op 写过的每个键的**旧值**（原来没有该字段 ⇒ `null` = 删字段） | 当前值与「我们写下去的值」逐个相等 |
| `DEL` | `UPD {deletedAt:null}` | 当前 `deletedAt === 原 op.timestamp` 且未 `purgedAt` |

- **不记录**：批量 op（task batch / priority batch / repeat completion）、全量快照（Repair）、
  多实体 op、未建模实体 —— 这些一律标 `undoable:false` 并带原因，**不假装能撤**。
- **撤销 = 新 op**：沿用 `dispatchLocked`，时钟照常前进；远端回放（`applyRemoteOps`）与崩溃恢复
  **不经过**这条路径 ⇒ 满足 `hard-constraints` §3.4「回放不产生副作用」。
- **撤销的撤销 = 重做**：undo 时把「反向意图的反向」压进 redo 栈。
- **冲突**：撤销前做上述前提检查；不满足 ⇒ 返回 `stale`，界面说「这条已被其它设备改过，没有撤销」。
- 历史栈**会话内**（内存）。重启后靠回收站（墓碑）兜底 —— 这是本轮的边界，写进残余。

### 3.3 判据

| # | 判据 | 怎么才会红 |
|---|---|---|
| R2-a | 建清单 + 2 条任务 → 删清单 → `undo()` ⇒ 清单与它的任务都回到 `listProjects()` / `listTasks()` | 把 `buildInverse()` 的 `DEL` 分支改成返回 `undefined`（即"不可撤销"）⇒ 单测必红（故障注入） |
| R2-b | `redo()` 之后清单再次不可见；`undoState()` 的 canUndo/canRedo 同步翻转 | 把 redo 栈的压入注掉 ⇒ 单测必红 |
| R2-c | 删除后由远端改了同一实体（`applyRemoteOps` 写 `deletedAt:null` 或改标题）⇒ `undo()` 返回 `stale`，**不**覆盖远端 | 把前提检查注掉 ⇒ 单测必红（会误覆盖） |
| R2-d | 批量/快照 op ⇒ `undoable:false`，`undo()` 跳过它去撤上一条 | 把 `undoable` 判定改成恒 true ⇒ 单测必红 |
| R2-e | 一次撤销只落**一条** op（`getLastLocalSeq()` 增量 = 1），且不产生远端回放副作用 | 撤销走 fan-out 时红 |

### 3.4 UI（最小）

web：`⌘Z` / `⇧⌘Z`（`Ctrl+Z` / `Ctrl+Shift+Z`）绑到 `host.undo()/redo()`，失败时用现有回执系统说一句
「这条已被其它设备改过，没有撤销」。移动端本轮只接共享 API，不铺手势（记残余）。

---

## 4. R7 · 同步状态可见（差异化）

### 4.1 现状（哪些已经有）

- `SyncStatus` 六态 + 冲突对话框（并排两边内容）**已存在**：`apps/web/src/features/sync/{SyncBar,ConflictDialog,SyncSettingsPanel}.tsx`。
- 「待上传 N 项」**移动端有**（`ProfileScreen` + `resolvePendingUploadPresentation`），**web 没有**：
  全仓 web 侧唯一读 `countPendingUpload()` 的是「注销账号」面板。
- `META_KEYS.LAST_SYNCED_AT` 是**死键**：声明了、从没写过。web/mobile 的「上次同步」只在内存。

⇒ R7 不是「从零做面板」，是**把已有事实接到可见面**：
① 待同步条数（本地算，不依赖网络）；② 上次成功同步时间（落 META）；③ 冲突「哪一条、谁赢」已有，
本包只加一句「本地优先」的口径；④ **不做**完整同步面板/历史图表。

### 4.2 设计

1. `sync-client` 成功结束（`synced`）时写 `LAST_SYNCED_AT`（唯一写点，经 store 的 `setMetaValue`）。
2. `AppHost.dataStatus()` 返回 `{pendingUpload, pendingApply, lastSyncedAt?, owner?}`（全部本地读、零网络）。
3. web `useSyncStore` 增加 `pendingUpload: number | undefined` 三态（`undefined` = 还没读到，
   与移动端同一套语义，复用 `resolvePendingUploadPresentation`）：
   - 同步结束、本地写入后刷新（挂 `onEngineChange`）；
   - rail 的 `SyncBar` 在 `pending > 0` 时显示「N 项待上传」；
   - 设置 → 同步 加一行「数据状态」：待上传 / 上次同步 / 本地优先一句。
4. 冲突那一条**不新增界面**：已有 `ConflictDialog` 能看两边内容；本包补「谁赢」的措辞仅在
   `SyncBar` 的 aria/状态句里（若已有则复用）。

### 4.3 判据

| # | 判据 | 怎么才会红 |
|---|---|---|
| R7-a | 断网（stub fetch 抛网络错）改 3 条 ⇒ `dataStatus().pendingUpload === 3`，界面那行文字含 `3` | 把 `countPendingUpload()` 换成常量 0 ⇒ 单测 + 组件测试必红 |
| R7-b | 联网同步成功 ⇒ 归零，且 `LAST_SYNCED_AT` 落库（重开库还在） | 不写 META ⇒ 「重开还在」断言红 |
| R7-c | 冲突时用户看得到**哪一条、谁赢**（复用现有 `ConflictDialog`，截图取证） | 把状态源断开（store 不订阅）⇒ rail 不显示待上传，组件测试红 |

---

## 5. 门禁与读数（收口时逐条填）

| 门禁 | 读什么 | 读数（2026-11-06 本机） |
|---|---|---|
| `pnpm --filter @heyta/op-log test` | 历史栈单测 | **156 passed**（14 文件；新增 `history.spec.ts` 9 条） |
| `pnpm --filter @heyta/app-host test` | 归属/销毁/状态源 | **2088 passed**（127 文件；新增 `library-owner.spec.ts` 10 条） |
| `pnpm --filter @heyta/web exec vitest run tests/account-security.spec.tsx` | 登出编排 | **42 passed** |
| `pnpm --filter @heyta/web exec vitest run tests/local-data-destruction.spec.ts tests/sync-settings-prefill.spec.tsx` | 销毁器清单 / 同步设置 | **25 passed**（18 + 7） |
| `pnpm --filter @heyta/{web,app-host,op-log,sync-client,storage} typecheck` | 类型 | **通过** |
| `pnpm --filter @heyta/mobile typecheck` | 类型 | **红：`src/lib/task-sort.ts:52` 缺 `manual` 档文案** —— 该文件本包未改，疑似并行会话改动 `TaskSortKey` 的中间态，**不是本包引入** |
| `check:undo-receipt` / `check:design-token-refs` | 门禁 | **✅**（141 个 token 引用全部可解析） |
| `check:layering` | 门禁 | **❌ 不是本包**：违规在 `apps/web/src/features/tasks/saved-filters.ts:35`，HEAD 上就有 |
| `e2e` · `shell-sync-rail.spec.ts` | 真浏览器 + 截图 | **5 passed**（新增 S5：数据状态三行） |

**故障注入记录**（2026-11-06 实测；逐条注掉 → 跑红 → 还原后复跑全绿）：

| 判据 | 注入 | 读数 |
|---|---|---|
| R2-a | `history.ts` 的 `DEL` 分支改成不可撤销 | `history.spec.ts` **4 failed**（`expected 5000 to be undefined`） |
| R2-c | `checkInverseStillValid` 直接 `return undefined` | **2 failed**（`applied` ≠ `stale`，会误覆盖远端） |
| R1-a | `purgeLocalLibrary` 假装成功不销毁 | `library-owner.spec.ts` **2 failed**（`expected true to be false`，db 文件还在） |
| R1-c | 去掉 `host.dispatch` 的 `requireLibraryOwner()` | **2 failed**（`expected undefined to be an instance of …`） |
| R7-a | 待上传那一段换成常量 | `sync-data-status.spec.tsx` **2 failed**（`'…都已经上传。'` 不含 `3`） |

完整记录与取证边界见 [A 包验收记录](package-a-acceptance-2026-11.md)。

## 6. 明确不做（本包边界）

- 不做「单库 + accountId 分区键」与「每账号一个库文件」（ADR-0084 §三 有对照）。
- 不做跨设备撤销的合并语义（撤销只在**本机会话**内；跨设备靠 LWW + 回收站）。
- 不做持久化撤销历史（重启即空）。
- 不做完整同步面板 / 同步历史图表 / 冲突「改判」的新入口（已有 `ConflictDialog` 的保留一版即改判）。
- 不给 `rejected`（服务端永久拒绝）加计数：本包只在残余里记一笔，等 R7 二期。
- 不动 `CURRENT_SCHEMA_VERSION`、不动线协议、不动已应用的迁移。
