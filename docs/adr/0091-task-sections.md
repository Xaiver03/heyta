# ADR-0091：清单内分组是独立实体 `SECTION`，不是任务上的字符串字段

> 状态：**提议（Proposed）**（接受与否由 lead / 产品负责人决定；本文件只给方案与实施设计）
> 日期：2026-11-24
> 相关：[ADR-0048](0048-deletion-four-states-and-the-no-physical-erase-boundary.md)（删除四态、不做物理擦除）、
> [ADR-0083](0083-task-abandonment-fifth-state-and-share-boundary.md)（加态/加字段必须先回答"隐藏由谁负责"）、
> [ADR-0062](0062-shared-list-key-distribution.md)（共享清单的写入路由）、
> [ADR-0089](0089-calendar-events-are-a-mirror-entity.md)（新实体落地全链清单的同形范本）。
> 证据：实测来源 `docs/research/ticktick-calendar/README.md`「任务页的分块从哪来」（`git show 63899d14`）；
> 任务模型对账 `docs/research/ticktick-data-model-parity.md` §2.1/§2.2。
> 本文所有 `file:line` 是 **2026-11-24、HEAD 87de142e** 的读数。

## 1. 背景与约束

实测（`docs/research/ticktick-calendar/README.md`）：滴答 Android 任务页的"分块卡片"是**两层用户自建结构**：

- **清单 List（一级）**——左侧抽屉里那串（今天/收集箱等智能清单 + 用户自建清单）。heyta 已用 `Task.projectId` + `Project` 表达。
- **分组 Section（清单内二级分块）**——"欢迎"清单页把 12 条任务分成"新手入门(3) / 功能模块(6) / 探索更多(3)"三张**有标题、有计数、可折叠的卡片**。

heyta 今天**没有**这一层：`packages/domain/src/task-filter.ts` 的 `TaskSections` 只是**按日期自动分节**（overdue / dueToday / inbox / completed），不是用户自建的、可命名的容器；`Task` 与 `Project` 上都无任何承载用户分组的字段。本 ADR 回答 `SECTION` **是什么形状**。

硬约束（逐条能指到文件）：

- **schema 默认不 bump**；给持久化模型加必填字段会在 hydration 时炸，而 TS 与构建都绿（`docs/agents/hard-constraints.md` §3.3）。
- **一个用户意图 = 一个 op**；多实体变更必须落在同一次操作里，不许 fan-out（同上 §3.4）。
- **`apps/*` 不许有任何一行决定"业务上该怎么做"**；"删分组时其下任务去哪"是产品语义，必须在 `packages/app-host`（同上 §3.5）。
- **实体清单是客户端与服务端共享的单一来源**，服务端白名单 `ALLOWED_ENTITY_TYPES = new Set(ENTITY_TYPES)`（`server/src/sync/services/validation.service.ts:25`）**从数组派生**。⇒ 老服务端认不得新实体会判 `INVALID_ENTITY_TYPE` **永久拒绝**：这是**上线顺序**问题，不是 schema 版本问题。
- **视图不建实体**（`packages/shared-schema/src/entity-types.ts` 文件头原则 2）。但本节要论证的恰恰是"用户自建的分组**不是视图**"——它是**用户数据**。
- **一层归属 Discipline**：项目文件夹已定"只允许一层"（`packages/domain/src/entities.ts` 的 `Project.parentId` 注释）；标签层级也只一层。分组不引入第二套父子深度。
- **删除是四态、不做物理擦除**（ADR-0048）：分组删除走 `deletedAt` 软删，任务数据一条不丢。

## 2. 选项

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| **A. 独立实体 `SECTION { projectId, name, order, deletedAt }` + `Task.sectionId?`** | 重命名/排序是**容器属性**，冲突面收到**一行**（LWW）；空分组可存在；跨设备一致、可导出、可还原 | 多一条长期维护的实体（白名单/导出/还原/AI 覆盖各多一格）；任务移组要写 `sectionId` | 本 ADR |
| B. `Task.section?: string`（任务上的自由字符串） | 零新实体、零服务端改动 | **重命名 = 重写该组所有任务**（N 条 op 或一次 bulk 覆盖）；**分组顺序无处安放**（字符串无 order）；**空分组表达不出来**（没有任务就没有这个字符串）；**拼写漂移**（"新手入门"/"新手 入门"静默裂成两组，且无单一事实源可改）；**颜色/折叠**同样无家 | `Reminder` 相对 `dueDate` 的注释（`entities.ts`「为什么必须是独立实体」第 3/4 条） |
| C. `Project.sections: Section[]`（数组字段） | 不加实体、不动白名单 | 数组在 LWW 下是**覆盖语义**：两台设备各加一个分组，胜出的把对端整个数组**吞掉**且不报错；改名一个分组要重写整数组 | `ASSISTANT_TURN` / `COMMENT` / `Reminder` 的同一条推理（`entity-types.ts` / `entities.ts`） |
| D. 用 `Project.parentId` 复用成"分组" | 零新代码 | 语义打架：`parentId` 是**清单套清单**（文件夹），分组是**清单内的任务分块**。硬塞会让同一字段同时表达"清单的父"与"任务的容器"，且任务仍无处落 `sectionId` | `Project.parentId` 注释；research §2.1 第 5 行 |
| E. 从 `Task.order` / 日期派生，不落实体 | 不加实体 | "用户把 12 条分成三组并各起标题"是**用户数据**，推不出来；派生层无法承载名字、颜色、折叠、空组 | 同 `COMMENT`（评论内容是用户写的，不是派生的） |

## 3. 结论

**新增独立实体 `SECTION`，一层归属到 `Project`；`Task` 增加可选 `sectionId`。不 bump `CURRENT_SCHEMA_VERSION`。**

```
Project 1 ──── * SECTION { projectId, name, order, deletedAt }
                       ▲
                       │ Task.sectionId?（可选；缺席 = 未分组）
                    Task *
```

1. **实体形状**（进 `EntityModelMap`）：
   ```ts
   interface Section extends EntityBase {
     projectId: string;   // 归属清单，实体身份的一部分（同 Reminder.taskId），必填
     name: string;        // 分组标题，必填（没有标题就不是一个分组）
     order?: number;      // 分组在清单内的排序键；可选 + 运行时默认（按 createdAt 兜底）
     // deletedAt / purgedAt 由 EntityBase 提供（ADR-0048 四态），不新增删除机制
   }
   ```
   `Task` 追加 `sectionId?: string`（**可选 + 运行时默认 = 未分组**，§3.3）。
   `projectId` / `name` 必填的理由：它们**就是实体身份**（没有 `projectId` 不知属于哪个清单，没有 `name` 卡片没有标题），与 `Reminder.taskId` / `Comment.body` / `Attachment.fileName` 同一条先例；**其余状态字段一律可选**。

2. **为什么不是 `Task.section?: string`（选项 B 的逐条否决）**——
   - **重命名可同步性**：改名若落在任务字符串上，就是"重写该组每一条任务"。两台设备一端改名、一端往该组加一条任务 ⇒ 加进来的那条还带着旧名，旧分组**复活**，且没有任何一层报错。独立实体把改名收成**一行 op 的 LWW**——冲突面从 N 条缩到 1 条，这与 `Tag.mergedInto` 把"合并"收成一行是同一手法。
   - **排序可同步性**：分组顺序是**容器属性**，字符串上没有地方存它。要排序就得给每条任务存"组序"，那是把容器属性摊回每一行，再次把冲突面放大成 N。
   - **空分组**：滴答的分组头带计数（含 0）。字符串方案里"组内 0 条任务"意味着**这个分组根本不存在**——用户建完组、还没拖任务进去，组就消失了。
   - **LWW 冲突面**：容器属性（name/order）与任务属性（title/section）应分居两个实体；放一起会让"改组名"和"改任务标题"在同一行上按字段 LWW 互斥，而它们本不相干。

3. **为什么不是数组（选项 C）**：本引擎 LWW 在**数组上是覆盖语义**（`packages/op-log/src/state.ts` 的物化按实体行合并）。`Project.sections: Section[]` 会让并发追加互相吞掉；独立实体让"新增分组"只追加一个新 id、"只增不减"是**结构给的**，不靠约定守。这段推理与 `ASSISTANT_TURN`「一条消息 = 一个实体」、`COMMENT`「一条评论 = 一个实体」逐字同源。

4. **一层归属（section → project），不设 `parentId`**：分组属于**恰好一个**清单（`projectId` 必填、是身份一部分），**分组不能再套分组**。这与 `Project` 文件夹"只一层"、`Tag` 层级"只一层"是同一条产品纪律（research §2.2/§2.7 对"每视图 7 张表""两套层级各自维护父子"的两次否决）。要更深就变成两套父子结构，维护与查询都会翻倍。

5. **任务移动语义**：把一条任务移到某分组 = **一条 Update op**，载荷只有 `{ sectionId }`（同时在需要时带 `order` 定组内位置）。移到"未分组" = `{ sectionId: null }`（清字段写 `null`，见 `project-actions.ts` 文件头"`null` 才能穿过 JSON 表达清除"）。**绝不** fan-out 成"把该任务从旧组逐条重写"——旧组没有任何按任务的登记需要回写。

6. **删除/归档语义（ADR-0048 四态，不物理删）**：删分组 = `SECTION` 软删（`deletedAt`），**不级联删任务**（与 `removeProject` "不级联删其下任务"同一条）。其下任务保留原 `sectionId`；读侧把**悬空或已删除的 `sectionId` 一律归入"未分组"**——这正是 `comment-actions.ts` 对"悬空 `projectId` 或已软删归为同一档"的既有形状。理由：若改成"删组时把组内任务的 `sectionId` 逐条清空"，那是 N 条 op 的 fan-out（违反 §3.4）；而物理删任务则是 ADR-0048 明令禁止的破坏性动作。还原 = 清 `deletedAt`，任务自动回到原组（`sectionId` 一直没动过）。

7. **共享清单**：若 `SECTION.projectId` 指向的清单 `shareId` 在册，则 `SECTION` 的 op **走 share op-log**（与 TASK / NOTE / COMMENT 同一条写入路由，路由裁决在 `packages/app-host`，见 `comment-actions.ts` 文件头"写入路由住在这一层"）；`apps/*` 不判断。个人清单走个人 op-log。

## 4. 全链清单（加一个新实体的固定动作，缺一格都会静默坏）

| # | 落点 | 要改什么 | 漏了会怎样 |
|---|---|---|---|
| 1 | `packages/shared-schema/src/entity-types.ts` 的 `ENTITY_TYPES` 数组 | 加 `'SECTION'`（**可加性**，不 bump schema；老客户端当未知实体优雅跳过） | 见 #5 上线顺序 |
| 2 | `packages/domain/src/entities.ts` 的 `EntityModelMap` | 加 `SECTION: Section` 键 + 定义 `Section` 接口 + `Task.sectionId?` | typecheck 的编译期断言会红（`AllModeledAreListed`） |
| 3 | 同文件 `MODELED_ENTITY_TYPES` 数组 | 加 `'SECTION'` | 编译期兜底断言 `allModeledAreListed` 会红（这一处就是为防"加了键忘了加清单"） |
| 4 | `packages/op-log/src/state.ts` 的 `BUCKET_BY_ENTITY` | 加 `SECTION: 'sections'` | 该实体 `overwritten` 判定恒 false ⇒ 冲突覆盖**静默不生效**（该文件头第 178-182 行记录的正是这个坑） |
| 5 | 服务端白名单 | **无需手改**：`validation.service.ts:25` 的 `ALLOWED_ENTITY_TYPES = new Set(ENTITY_TYPES)` 从数组派生 | 若手写第二份就会漂；本仓已改派生 |
| 6 | Prisma 迁移 | **不需要**（见下） | — |
| 7 | `scripts/check-ai-coverage.mjs` 的 `ENTITY_COVERAGE_DEBT` | 见 §4.1 | 门禁红（新实体进了分母却没有读写工具、又没登记） |
| 8 | `packages/app-host` 动作层 | 新 `section-actions.ts`：`createSection / renameSection / reorderSections / setTaskSection / removeSection`（+ share 路由分支） | 没有写入口，UI 只能绕开 op-log（违反 §3.4） |
| 9 | UI | 清单内分组头（标题+计数+折叠）+ 拖拽归组 / 跨组拖拽 | 功能不可见 |
| 10 | `packages/app-host/tests/entity-type-parity.spec.ts` | 若给 SECTION 配了写工具，需把其所写实体加进 `LocalApiWrittenEntityType` 联合与 `WRITABLE` 映射 | 手抄对账红 |

### 4.1 是否触发 Prisma 迁移：**不触发**（判断依据）

服务端 op 存储是**通用表**，不是每个实体一张表：

- `server/prisma/schema.prisma` 的 `model Operation`：`entityType String`、`payload Json`、`payloadBytes BigInt`、`vectorClock Json`……**新实体只是往这张表多写 `entityType = 'SECTION'` 的行**，列与索引（`@@index([userId, entityType, entityId, serverSeq])`）已覆盖。
- 共享清单同理：`model ShareOperation` 也是 `entityType String` + `payload Json`。
- 需要迁移的只有**给某个实体加"服务端要自己按列读写"的强类型存储**：例如 `model AttachmentBlob`（存字节）、`model UserAvatar`（存 data）。`SECTION` 没有、也不该有服务端强类型列——它是客户端从 op-log 物化的。

⇒ **结论：`SECTION` 不触发 Prisma 迁移**。仍要跑 `pnpm check:schema-migration-drift` 与 `pnpm check:migrations` 证明"没漂、没漏"，但预期无新增 migration 文件。

### 4.2 `check:ai-coverage` 分母 +1 的处理

`SECTION` 进 `EntityModelMap` 后，`gen-ai-capability-manifest.mjs` 把它算进 `modelledEntityTypes` → `userOperableEntityTypes`（未被 `DENOMINATOR_EXCLUSIONS` 剔除）→ **分母 +1**，且若它没有读写工具，会落进 `entityTypesWithoutTools` ⇒ `pnpm check:ai-coverage` 红。两条处置，二选一：

- **（推荐）同批补最小读写工具**：`list_sections`（读）+ `create_section` / `rename_section` / `set_task_section`（写）——分组是用户可操作实体，装工具不是额外负担，且避免欠账。需同时更新 `capability-manifest.generated.ts`（重新生成）与 `capability-manifest.spec.ts` 里**手写死的期望值**（该 spec 现有 `expect(manifest.userOperableEntityTypes.length).toBe(11)` 与一份 `toEqual(expected)` 全名单，分母一变两处都要同步改，否则红在"测试写死"而不是"真的没覆盖"）。
- **（退路）登记 `ENTITY_COVERAGE_DEBT`**：写 `AI-COV-n` + 一句**可验证的为什么**（不是"还没做"）。但这会立刻让"实体存在、AI 无工具"成为账面上的欠账，下一轮必须还。

### 4.3 服务端先上线顺序（§2.1 硬顺序，必须写进发布单）

**服务端先于客户端发布。** 白名单从 `ENTITY_TYPES` 派生，所以服务单只要**先带上含 `'SECTION'` 的 `ENTITY_TYPES` 上线**即可；随后客户端发布并开始写 `SECTION` op。反向（客户端先上）会把 `SECTION` op 判成 `INVALID_ENTITY_TYPE` **永久拒绝**——不是重试能恢复，是这条 op 被服务端丢弃。老客户端（不含 `SECTION` 的域模型）读到 `SECTION` 的 op 会当未知实体优雅跳过，不影响同步，故**客户端灰度无兼容风险，只有"服务端先行"这一条硬约束**。

## 5. 落地实施文件清单与验收命令

**领域层**：`packages/domain/src/entities.ts`（`Section` + `Task.sectionId?` + `EntityModelMap`/`MODELED_ENTITY_TYPES`）、新 `packages/domain/src/sections.ts`（纯函数：`sectionsOfProject` 排序、`groupTasksBySection` 悬空归"未分组"、`validateSectionName`）。
**协议层**：`packages/shared-schema/src/entity-types.ts`（数组加 `'SECTION'`）。
**物化层**：`packages/op-log/src/state.ts`（`BUCKET_BY_ENTITY` 加 `sections`）。
**动作层**：新 `packages/app-host/src/section-actions.ts`；`packages/app-host/src/index.ts` 导出；共享路由分支参照 `comment-actions.ts`。
**AI/工具**：`packages/local-api/src/tools/section.ts`（若走 §4.2 推荐路线）+ 重新生成 `packages/ai/src/capability-manifest.generated.ts`。
**UI**：`packages/ui` 清单视图分组头组件；`apps/web`/`apps/mobile` 接拖拽（只做平台差异，语义在 `app-host`/`domain`）。
**测试**：`packages/domain/tests/sections.spec.ts`、`packages/app-host/tests/section-actions.spec.ts`、`packages/op-log/tests/entity-coverage.spec.ts`（已存在的对账会因新实体自动参与）、`packages/ai/tests/capability-manifest.spec.ts`（分母期望值）。

**验收命令**（全绿才算可合）：
```bash
pnpm -r typecheck
pnpm --filter @heyta/domain test && pnpm --filter @heyta/app-host test && pnpm --filter @heyta/op-log test && pnpm --filter @heyta/ai test
pnpm check:layering          # apps/* 不含业务判断
pnpm check:ai-coverage       # 分母 +1 已按 §4.2 处置
pnpm check:ai-tools          # 工具预算随分母增长，不超
pnpm check:schema-migration-drift
pnpm check:migrations        # 预期无新增 migration
pnpm check:crosslang-contract
pnpm check:md-tables         # 本文件表格
```

## 6. 后果

**接受的代价**：

- **多一条长期维护的实体**：进 `ENTITY_TYPES` 意味服务端白名单、导出、还原、AI 覆盖统计各多一格。这是所有新实体的固定税，本仓已反复付过（`EVENT` / `CALENDAR_EVENT` / `COMMENT` / `ATTACHMENT`）。
- **任务移动要写 `sectionId`**：一次拖拽 = 一条 Update op。相对"字符串"方案，这是把 N 条重写降成 1 条的**收益**，不是成本。
- **悬空 `sectionId` 的读侧降级**是必须实现的：任何读分组的地方都要把"指向已删除/不存在 section 的任务"归入"未分组"，否则会渲染出看不见的孤儿组。判据：删一个分组后，其下任务仍出现在"未分组"里且不丢。

**换来的东西**：

- 分组重命名/排序是**一行 LWW**，冲突面从 N 缩到 1；两台设备并发不复活旧组、不吞对方新组。
- 空分组可存在（标题+计数 0），与滴答一致。
- 删除可恢复（`deletedAt` 四态），任务零丢失，无物理擦除（守 ADR-0048 §3）。
- 一层归属与既有"文件夹一层""标签一层"一致，不引入第二套父子。

**本轮边界（明确不做）**：不写 `.ts` 产品代码（本 ADR 只给设计）；不做分组嵌套；不做"分组级默认视图/排序策略"（那是容器属性对的另一个决定，需另议）；不迁移任何已丢弃的历史分支（`feat/tag-hierarchy` 与本工作包无关）。

## 7. 未核实项

1. **分组的折叠状态**是否要跨设备同步：滴答的 `ZCOLLAPSED` 是跨端会保留的。本 ADR 的 `Section` 未含折叠字段——若确认要同步，加 `collapsed?: boolean`（可选，§3.3），但它是**视图态**，更可能该进 ADR-0085「外观是设备本地、不进 op-log」那一档，需产品裁决。
2. **分组颜色**是否要：本 ADR 未加 `color`；若加，应存**色槽**（同 `Project.color`）而非裸 hex。待产品确认是否要。
3. **拖拽归组与 `Task.order` 的交互**在两端（Web HTML5 DnD / 移动端手势）的真实手感未验，属 UI 那一步的验收。
4. 共享清单里 `SECTION` 与 `TASK` 的跨组拖拽，在 share op-log 下的向量时钟并发表现，未在真机实测。
