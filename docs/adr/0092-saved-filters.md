# ADR-0092：自定义过滤器（智能清单）是用户数据实体 `FILTER`，rule 用结构化 JSON 而非 DSL 字符串

> 状态：**提议（Proposed）**（接受与否由 lead / 产品负责人决定；本文件只给方案与实施设计）
> 日期：2026-11-24
> 相关：[ADR-0089](0089-calendar-events-are-a-mirror-entity.md)（新实体落地全链清单的同形范本）、
> [ADR-0048](0048-deletion-four-states-and-the-no-physical-erase-boundary.md)（"两端不同答案且都不报错"这条失效形状）、
> [ADR-0081](0081-encryption-is-opt-in-not-default.md)（默认 `readable`；模板里不要写"服务端看不到明文"）。
> 证据：`docs/research/ticktick-data-model-parity.md` §2.7「筛选器」一行；`packages/domain/src/task-filter.ts` 文件头。
> 本文所有 `file:line` 是 **2026-11-24、HEAD 87de142e** 的读数。

## 1. 背景与约束

滴答清单有**保存的筛选器 / 智能清单**（macOS `ZTTFILTER`、Windows `FilterModel`），其规则以**查询 DSL 字符串**（`ZRULE`）存储。heyta 今天的"筛选"是**纯函数**：`packages/domain/src/task-filter.ts` 的 `TaskFilter` 是一个**内置判别联合**（`all` / `today` / `tomorrow` / `next7Days` / `completed` / `quadrant` / `project` / `tag`），**不落库、不可由用户新增**。用户无法保存"我的：高优先级 + 有标签「工作」+ 本周到期"这样一个自定义视图。

本 ADR 回答两件事：**保存的筛选是不是用户数据（要不要落实体）**，以及**规则用什么形状存（结构化 JSON 还是 DSL 字符串）**。

硬约束：

- schema 默认不 bump；新字段可选 + 运行时默认（`docs/agents/hard-constraints.md` §3.3）。
- 一个用户意图 = 一个 op；op-log 是唯一写入口（同上 §3.4）。
- `apps/*` 无业务判断；"哪些任务算命中这条规则"是产品语义，必须在 `packages/domain`（同上 §3.5）。
- **视图不建实体**（`entity-types.ts` 文件头原则 2）——本 ADR 要论证的正是：**保存的筛选是用户数据、不是视图**，所以它该建实体。

## 2. 选项

### 2.1 保存的筛选：落不落实体

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| **A. 独立实体 `FILTER { name, rule, color?, order }`** | 用户自建的"智能清单"是**用户数据**：能跨设备、可导出、可还原、可重命名/排序 | 多一条长期维护的实体（白名单/导出/还原/AI 覆盖各多一格） | 本 ADR |
| B. 不落实体，只做内置 `TaskFilter` 分支 | 零改动 | 内置分支是**产品预置**，用户**不能保存自己的**；每加一种组合就要发版 | `task-filter.ts` 现有判别联合 |
| C. 存进 `GLOBAL_CONFIG` 的一个数组 | 不加实体 | 数组在 LWW 下是**覆盖语义**，两台设备各存一个筛选会互相吞；且每次改一个筛选要重写整数组 | `ASSISTANT_TURN` / `COMMENT` 同一条推理 |
| D. 当成"视图"派生、不持久化 | 不动实体 | 🔴 这正是 research 点名的**误判**：保存的筛选是**用户数据、不是视图**——视图（今天/四象限）由字段派生，而"用户起的名字 + 用户填的规则"推不出来 | research §2.7：**「保存的智能清单」是最容易被误判成"视图"的一条……保存的筛选是用户数据、不是视图。真做时它该是一个实体，不是派生** |

### 2.2 rule 的形状：结构化 JSON vs DSL 字符串

| 选项 | 优点 | 缺点 |
|---|---|---|
| **A. 结构化判别联合 JSON**（`kind` 标签 + 字段） | 类型安全（加一个分支 → 所有 `switch` 编译期被检查）；跨端**同一份**编译器；可逐字段演进/迁移；JSON 天然穿过 `payload Json` 与表单绑定 | 规则表达能力受联合类型约束（要加能力就加分支） |
| B. DSL 字符串（仿滴答 `ZRULE`） | 表达自由、单字段 | 🔴 每端都要**各写一份解析器**，解析器一漂 ⇒ "同一条筛选两端筛出不同任务且都不报错"（正是 ADR-0048 §1 的失效形状）；无类型检查，拼错是**静默变义**；字符串是不透明 blob，改语法会**静默改变存量筛选的含义**，无法逐字段迁移 |

## 3. 结论

**新增独立实体 `FILTER`，`rule` 用结构化判别联合 JSON（`kind` 标签），执行时编译成 predicate 走 `task-filter.ts` 的既有语义。不 bump `CURRENT_SCHEMA_VERSION`。**

```ts
interface Filter extends EntityBase {
  name: string;          // 用户起的名字（"我的工作"），必填
  rule: FilterRule;      // 结构化规则，必填（没有规则就不是筛选）
  color?: string;        // 可选：色槽（同 Project.color，存槽位不存 hex）
  order?: number;        // 可选：侧栏排序键
  // deletedAt / purgedAt 由 EntityBase 提供（ADR-0048 四态）
}
```

1. **为什么保存的筛选必须是用户数据、必须落实体**：它由**用户命名 + 用户填写的规则**组成，二者都**推不出来**——与 `PREFERENCE_CORRECTION`（"用户认为某条推断是错的"这条事实推不出来，只能显式记）、`Comment`（评论正文是用户写的）同一条推理。research §2.7 已把这件事判死：保存的智能清单**最容易被误判成"视图"**，而"视图不建实体"那条原则针对的是**由字段派生的**今天/四象限，不是"用户保存的查询"。⇒ 落实体，不派生。

2. **为什么 rule 用结构化 JSON 而非 DSL 字符串**（选项 B 的逐条否决）：
   - **类型安全**：判别联合让"新加一种条件却漏了某个 `switch`"在**编译期**红；字符串 DSL 要自带解析器 + 运行时校验，拼错只会**静默变义**（例如 `priority:3` 写成 `priority:33`）。
   - **跨端一致**：`task-filter.ts` 文件头已记过教训——"哪些任务算今天/逾期"多写一份就必然漂。DSL 字符串会让每个壳各写一份解析器，漂移的代价是"两端答案不同且都不报错"。结构化 JSON 让**规则编译器只有一份**（在 `packages/domain`）。
   - **可迁移**：JSON 能逐字段升级（重命名一个枚举值 = 一次显式迁移）；DSL 字符串是不透明 blob，改语法就**静默改写存量数据的含义**。规矩是 §3.3「磁盘上已写的数据长期存在」。

3. **`FILTER` 不承担归属、不存任务**：`FILTER` 没有 `projectId`——它是**账户级**的保存查询（滴答的智能清单跨清单聚合）。它**只存规则**，命中的任务在**读时**由编译器算出来，**不物化、不复制**任务。这与"视图不建实体"其实一致：`FILTER` 存的不是任务集合，而是**用户写的查询**；结果永远是活查询。这也意味着 `FILTER` **永不进 share op-log**（个人数据，无 `shareId`）。

4. **规则形状（建议的判别联合，落地时可细化）**：
   ```ts
   type FilterCondition =
     | { kind: 'project';  projectIds: string[] }            // 属于这些清单
     | { kind: 'tag';      tagIds: string[] }                 // 含任一标签（走 resolveTagIds 解别名）
     | { kind: 'priority'; values: Priority[] }
     | { kind: 'due';      withinDays?: number; before?: LocalDate; after?: LocalDate; hasNone?: boolean }
     | { kind: 'status';   value: 'open' | 'completed' | 'abandoned' }
     | { kind: 'keyword';  contains: string };                // 标题/正文关键词

   type FilterRule =
     | { match: 'all' | 'any'; conditions: FilterCondition[] };
   ```
   🔴 **判别联合、不是 `{ field, op, value }` 宽形状**：宽形状会让"忘了处理新 kind"表现为**运行时静默返回空列表**（这条理由与 `TaskFilter` 现有注释逐字一致）。

5. **执行编译成 predicate，走 `task-filter.ts` 扩展**：新纯函数模块 `packages/domain/src/saved-filter.ts` 导出 `compileFilterRule(rule): (task: Task, ctx: FilterContext) => boolean`，**复用** `task-filter.ts` 的 `dueLocalDate` / `isCompleted` / `visibleTasks` 与 `tags.ts` 的 `resolveTagIds`/`taskHasTag`——**不重算"什么算今天/逾期"**（那是第二份判据）。读路径：`visibleTasks(tasks)` → 用编译出的 predicate 过滤。**不排序**（顺序由 `app-host` 的规范顺序定，与 `filterTasks` 同一条纪律）。

6. **未知 `kind` 的失败语义（跨版本关键）**：老客户端读到一条含它不认识的 `kind` 的 `FILTER` 时，必须**显式降级**（界面上标"此版本的 App 打不开这个筛选"），**不许静默丢掉未知条件继续按剩余条件筛**——静默丢条件会让"同一筛选在新旧两端筛出不同任务且都不报错"，这正是 ADR-0048 §1 点名的那类缺陷。

7. **删除**：`FILTER` 软删（`deletedAt`，ADR-0048 四态），不物理删。还原 = 清 `deletedAt`。

## 4. 全链清单（加一个实体的固定动作）

| # | 落点 | 要改什么 | 漏了会怎样 |
|---|---|---|---|
| 1 | `packages/shared-schema/src/entity-types.ts` 的 `ENTITY_TYPES` | 加 `'FILTER'`（可加性，不 bump schema） | 见 §4.3 上线顺序 |
| 2 | `packages/domain/src/entities.ts` 的 `EntityModelMap` | 加 `FILTER: Filter` + 定义 `Filter` 与 `FilterRule` 类型 | 编译期断言 `AllModeledAreListed` 红 |
| 3 | 同文件 `MODELED_ENTITY_TYPES` | 加 `'FILTER'` | `allModeledAreListed` 红 |
| 4 | `packages/op-log/src/state.ts` 的 `BUCKET_BY_ENTITY` | 加 `FILTER: 'filters'` | `overwritten` 恒 false ⇒ 冲突覆盖静默不生效 |
| 5 | 服务端白名单 | **无需手改**（`validation.service.ts:25` 从 `ENTITY_TYPES` 派生） | — |
| 6 | Prisma 迁移 | **不需要**（见 §4.2） | — |
| 7 | `scripts/check-ai-coverage.mjs` 的 `ENTITY_COVERAGE_DEBT` | 见 §4.1 | 门禁红 |
| 8 | `packages/app-host` 动作层 | 新 `filter-actions.ts`：`createFilter / renameFilter / updateFilterRule / reorderFilters / removeFilter` | 无写入口 ⇒ UI 绕开 op-log（违反 §3.4） |
| 9 | `packages/domain/src/saved-filter.ts` | predicate 编译器（复用 task-filter 语义） | 「两端各筛各的」 |
| 10 | UI | 侧栏"智能清单"分区：新建/命名/排序/删除 + 规则编辑表单 | 功能不可见 |
| 11 | `packages/app-host/tests/entity-type-parity.spec.ts` | 若配写工具，需把 FILTER 加进 `LocalApiWrittenEntityType` 联合与 `WRITABLE` | 手抄对账红 |

### 4.1 `check:ai-coverage` 分母 +1 的处理

与 ADR-0091 §4.2 完全同形：`FILTER` 进 `EntityModelMap` → 分母 +1 → 无读写工具会落进 `entityTypesWithoutTools` ⇒ `check:ai-coverage` 红。两条处置：

- **（推荐）同批补最小读写工具**：`list_filters`（读）+ `create_filter` / `update_filter_rule`（写）。需重新生成 `capability-manifest.generated.ts`，并同步 `capability-manifest.spec.ts` 里**手写死的期望值**（现有 `expect(...length).toBe(11)` 与 `toEqual(expected)` 全名单；分母变两处都要改）。
- **（退路）登记 `ENTITY_COVERAGE_DEBT`**：写 `AI-COV-n` + 可验证的理由。会留欠账，下一轮必须还。

### 4.2 是否触发 Prisma 迁移：**不触发**（判断依据）

同 ADR-0091 §4.1：服务端 op 存储是通用表 `model Operation`（`entityType String` / `payload Json`），`FILTER` 只是多写 `entityType='FILTER'` 的行，列与索引已覆盖；`FilterRule` 作为 `payload` 的 JSON 子结构落库，**不需要**强类型列。只有给某实体加"服务端按列读写"的强类型存储（如 `AttachmentBlob` / `UserAvatar`）才需要迁移。⇒ **不触发迁移**；仍跑 `check:schema-migration-drift` 与 `check:migrations` 证明未漂。

### 4.3 服务端先上线顺序（§2.1 硬顺序）

**服务端先于客户端发布**：服务单先带上含 `'FILTER'` 的 `ENTITY_TYPES` 上线（白名单自动派生），客户端随后发布并写 `FILTER` op。反向会把 `FILTER` op 判成 `INVALID_ENTITY_TYPE` **永久拒绝**（丢弃，不重试可恢复）。老客户端读到 `FILTER` op 当未知实体优雅跳过，故客户端灰度无兼容风险，只有"服务端先行"一条硬约束。

## 5. 落地实施文件清单与验收命令

**领域层**：`packages/domain/src/entities.ts`（`Filter` + `FilterRule` + `EntityModelMap`/`MODELED_ENTITY_TYPES`）、新 `packages/domain/src/saved-filter.ts`（`compileFilterRule` + `validateFilterRule`）。
**协议层**：`packages/shared-schema/src/entity-types.ts`（加 `'FILTER'`）。
**物化层**：`packages/op-log/src/state.ts`（`BUCKET_BY_ENTITY` 加 `filters`）。
**动作层**：新 `packages/app-host/src/filter-actions.ts`；`packages/app-host/src/index.ts` 导出。
**AI/工具**：`packages/local-api/src/tools/filter.ts`（若走 §4.1 推荐路线）+ 重新生成 `packages/ai/src/capability-manifest.generated.ts`。
**UI**：侧栏智能清单分区 + 规则编辑表单（`packages/ui` + 两端只接平台差异）。
**测试**：`packages/domain/tests/saved-filter.spec.ts`（覆盖每种 `kind` + 未知 `kind` 降级 + 标签别名解析）、`packages/app-host/tests/filter-actions.spec.ts`、`packages/op-log/tests/entity-coverage.spec.ts`（自动参与）、`packages/ai/tests/capability-manifest.spec.ts`（分母期望值）。

**验收命令**：
```bash
pnpm -r typecheck
pnpm --filter @heyta/domain test && pnpm --filter @heyta/app-host test && pnpm --filter @heyta/op-log test && pnpm --filter @heyta/ai test
pnpm check:layering
pnpm check:ai-coverage
pnpm check:ai-tools
pnpm check:schema-migration-drift
pnpm check:migrations
pnpm check:crosslang-contract
pnpm check:md-tables
```

## 6. 后果

**接受的代价**：

- **多一条长期维护的实体**（服务端白名单/导出/还原/AI 覆盖各多一格）。
- **规则表达能力受联合类型约束**：要新能力就加一个 `kind` 分支并发版；这是为"类型安全 + 跨端一致"付的价，换来的是不会静默变义。
- **未知 `kind` 必须显式降级**：读侧要真的实现"标不支持"，否则跨版本会静默筛错。

**换来的东西**：

- 保存的筛选是**用户数据**：跨设备、可导出、可还原、可命名排序，且**结果永远是活查询**（不复制任务、不物化、不会与任务数据不一致）。
- **规则编译器只有一份**（`packages/domain`），复现"两端答案一致"。
- 规则可逐字段迁移，不因改语法静默改写存量数据。
- **永不进 share op-log**：个人智能清单不参与共享密钥分发，写入路径比 `SECTION` 简单。

**本轮边界（明确不做）**：不写 `.ts` 产品代码；不做看板列（research §2.7 判"暂不要"）；不做每视图独立排序（research §2.2 已判"形状该是一个独立实体"而非 7 张表，属另一决定）；不迁移任何旧筛选（存量无 `FILTER` 数据）。

## 7. 未核实项

1. **规则组合是否要 `not` / 嵌套**：本 ADR 只给 `match: all|any` 的一层组合。是否需要 `not` 或嵌套 `all/any`，需产品确认——不必一步到位，加分支是加性的。
2. **`due` 范围的语义边界**（"本周到期"用本地日历日还是毫秒窗口）：**必须**按 `task-filter.ts` 的既有纪律用 `LocalDate` 日历日算，不得毫秒滑窗；具体字段名与闭开区间在实现时与 `task-filter.ts` 对齐，避免"同一句话两处定义"。
3. **色槽的取值范围**：`color` 建议复用 `Project.color` 的 `CategorySlot`（1–8 槽位），但筛选器是否该有独立色板未确认，待产品。
4. **keyword 是否搜正文/备注**：`Task.content`（Markdown 备注）是否纳入关键词范围未定；纳入会与移动端搜索的既有口径交叉，需对齐 `search.ts`。
