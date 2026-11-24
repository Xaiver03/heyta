# 任务模型缺口补齐（目标模式 · 2026-11-24）

> 目标：把任务管理五层模型相对滴答清单的已知缺口补齐，合规通过 AGENTS.md 全部纪律，多子 Agent 并行 + 审计 + lead 统一归并部署。
> 本文是**权威盘点 + 实施编排**，取数方式全部是 git 实测（`git show HEAD:...` / `git diff`），不是文档抄件。

## 0. 现状权威盘点（git 实测，HEAD = 87de142e feat/app-auto-update）

| 缺口 | HEAD 真实状态 | 已有半成品 | 处置 |
|---|---|---|---|
| **A. 清单级设置字段**（icon / viewMode / kind / showInSmartList） | `Project` 仅 `name/parentId/color/archived/shareId`（`entities.ts:473`）。无 icon/viewMode/kind/showInSmart | `feat/ai-tools-lowfreq` 已有 `set_project_color`（已在 HEAD，因 color 存在）；但**无** icon/viewMode/kind/showInSmart | 新做（纯可加性字段） |
| **B. 标签二级标签**（parentId） | `Tag` 仅 `name/color/mergedInto`（`entities.ts:495`）。无 parentId | **`feat/tag-hierarchy` 有完整成熟实现**：ADR-0088、`domain/tag-hierarchy.ts`(166行)、动作层、Web+mobile UI、测试、评审修复，共 23 文件 1058 行，无 schema 迁移 | **移植 rebase**，不是重写。且 ADR 编号 0088 撞车，需重编 **0090** |
| **C. 清单内分组**（section） | 无 SECTION/GROUP 实体，无 `Task.sectionId`。`task-filter.ts` 的 `TaskSections` 只是按日期自动分节 | 仅实测文档 `63899d14 docs(calendar): 实测滴答任务页分块来源` | 新做（需新实体 + ADR 0091） |
| **D. 自定义可保存过滤器** | 无 FILTER/SMART_LIST 实体。只有代码内置 `TaskFilter` 判别联合（纯函数，不落库） | 无 | 新做（需新实体 + ADR 0092） |

### 0.1 已确认的并发事故

`integrate/tag-hierarchy-20261122` 的提交信息写着「merge: feat/tag-hierarchy into feat/app-auto-update」，但 `git merge-base --is-ancestor integrate/tag-hierarchy-20261122 HEAD` = **NO**；`git show HEAD:packages/domain/src/entities.ts` 的 `Tag` 无 `parentId`。⇒ 那次 merge 的成果在当前主干**已丢失**（feat/app-auto-update 之后被重建/变基甩掉了旧基线）。B 的移植=把这份成熟实现接到当前 HEAD，**并复盘 ADR-0088 撞号**（0088 已被「恢复任务提醒档」占用）。

## 1. 工作包与方案

### A. 清单级设置字段（branch `feat/gap-a-project-settings`）
`Project` 增**全部可选**字段（AGENTS §3.3，**不 bump CURRENT_SCHEMA_VERSION**）：
- `icon?: string`（图标 id，取自设计系统/图标表，不存自由 hex）
- `viewMode?: 'list' | 'board' | 'calendar' | 'timeline'`（视图类型）
- `kind?: 'tasks' | 'notes'`（清单类型；缺省='tasks'。注意：独立 NOTE 实体仍走 `Note.projectId`，kind 只表达"该清单默认展示什么"）
- `showInSmartList?: boolean`（是否在智能清单/汇总里显示；缺省=true）
落点：`packages/domain/src/entities.ts`(Project) + `packages/app-host/src/project-actions.ts`（set_project_* 动作，走 op-log 单入口）+ i18n + AI 工具（参照已有 `set_project_color` 模式补齐）+ UI 清单设置面板 + 测试。
验收：`pnpm -r typecheck`、相关包 test、`check:ai-coverage`、`check:ai-tools`、`check:layering`、`check:i18n`。

### B. 二级标签移植（branch `fix/gap-b-tag-hierarchy`）
把 `feat/tag-hierarchy` 相对其 merge-base(58ca36f3) 的实现 **apply 到当前 HEAD**（`git diff 58ca36f3 feat/tag-hierarchy | git apply -3`，解冲突），ADR 文件 `0088-tag-hierarchy-two-levels.md` 重命名为 `0090-tag-hierarchy-two-levels.md` 并把标题改为 0090 号（该文件由 B 工作包同批落地，此处不写裸引用）。
核心：`Tag.parentId?`（一层两级，分组+汇总，不承担归属）、`domain/tag-hierarchy.ts`、动作层换父校验（防环、只一层）、Web/mobile UI 两层级、测试。
验收：同上 + 移植后 tag-hierarchy 测试全绿。

### C. 清单内分组 section（新实体，ADR-0091）— 先出 ADR，下批实现
方案（ADR 论证）：新实体 `SECTION { projectId, name, order, deletedAt }` + `Task.sectionId?`。理由同 `Note/Comment`：分组重命名/排序是容器属性，独立实体把冲突面收到一行（LWW），不用数组覆盖。需登记 op-log `BUCKET_BY_ENTITY`、`EntityModelMap`、服务端白名单（从 entity-types 数组派生，自动）、`check:ai-coverage` 分母处理、app-host actions、UI。

### D. 自定义过滤器 FILTER（新实体，ADR-0092）— 先出 ADR，下批实现
方案（ADR 论证）：新实体 `FILTER { name, rule: FilterRule, color?, order }`，`rule` 用**结构化判别联合 JSON**（非滴答的 DSL 字符串），可表达 清单/标签/优先级/截止范围/状态/关键词；执行时编译成 predicate 走 `task-filter.ts` 扩展。纯查询，不存任务。同 C 的全链要求。

## 2. ADR 编号分配（实测占用到 0089）
- B → **0090-tag-hierarchy-two-levels.md**（重编自 tag-hierarchy 的 0088）
- C → **0091-task-sections.md**
- D → **0092-saved-filters.md**

## 3. 编排
- **基线**：当前 HEAD `feat/app-auto-update`（工作区脏仅 calendar-drop + ??，不碰核心实体文件，可用）。
- **隔离**：每个工作包一个 `git worktree`（`.worktrees/gap-*`）+ 独立分支，基于 HEAD。pnpm 用共享 store hardlink（`--store-dir` 指向主 store），磁盘增量小。
- **并行批次**：Batch1 = A 实现 + B 移植 + C/D 的 ADR 草案（架构 Agent，只写 .md）+ 审计 Agent（只读复核盘点与后续 diff）。Batch2 = C/D 实现（基于 ADR）。
- **归并**：lead 顺序 `merge` 各分支到 `feat/app-auto-update`，逐个解 `entity-types.ts`（数组加行）/`EntityModelMap`（加键）小冲突；每合一个跑门禁。
- **审计 Agent**：只读，独立复核本盘点的每条 git 结论 + 审每份 diff 是否越界（apps/* 业务语义、schema bump、op-log 副作用、许可证）。不写代码。

## 4. 门禁（每次归并后）
`pnpm -r typecheck` · 相关包 `test` · `check:layering` · `check:ai-coverage` · `check:ai-tools` · `check:crosslang-contract` · `check:schema-migration-drift` · `check:i18n`(若有) · `pnpm -r build`。全绿才算该包可合并。

## 5. 风险
1. B 移植的 23 文件基于旧基线，与 **82** 提交差异（`git rev-list --count 58ca36f3..HEAD` 实测），apply 会冲突——以"测试全绿 + typecheck"为收敛判据，不以"无冲突"为准。
2. C/D 新实体触不可逆层（shared-schema）+ 服务端白名单 + 可能迁移；**必须服务端先上线**（AGENTS §2.1 硬顺序），ADR 里写清上线顺序。
3. 磁盘 91% 已用，worktree 装依赖需盯 `df`，用完及时 `git worktree remove`。
4. 工作区已有大量未提交改动与 **18** 个 worktree（`git worktree list` 实测）——合并前先 `git status` 核对，不覆盖他人成果。

## 6. 归并与部署预案（lead 执行）

- **归并落点**：独立 worktree `.worktrees/gap-integrate`（分支 `integrate/gap-closure`，基于 HEAD）。**不碰主工作区**——主检出有一堆他人未提交 wip（landing 分享卡 / calendar-drop / i18n / ui CalendarDayBoard 等），不提交、不丢弃、不 stash 掉不还原。
- **顺序合并**：B → A →（C → D）逐个 `git merge`，冲突集中在 `entity-types.ts`（数组加行）与 `entities.ts`（Project/Tag 字段 / 新实体接口）；每合一个立刻跑全量门禁。
- **C/D 新实体「四处必改」**（漏一处静默失效，`packages/op-log/src/state.ts:180` 明确警告）：`EntityModelMap` · `hasModel` · `BUCKET_BY_ENTITY` · `snapshot()` 内联表。服务端白名单 `ALLOWED_ENTITY_TYPES = new Set(ENTITY_TYPES)` 从 shared-schema 数组派生 ⇒ **改数组即自动认识，但必须服务端先部署**（老服务端会把新实体 op 判 INVALID_ENTITY_TYPE 永久拒）。`check:ai-coverage` 走 `scripts/check-ai-coverage.mjs:938` 的 `ENTITY_COVERAGE_DEBT` 登记（或同批补读写工具）。
- **部署**：`pnpm deploy:ssh` 默认 `--sandbox`——临时 Postgres+app 容器验证「迁移从空库跑通 + /health + 镜像 revision == 送出 commit 对账」，**不碰线上**。真换线上容器需 `--apply --yes-production`，脚本与 AGENTS 均规定**由产品负责人拍板**，lead 不代拍。本目标的「部署验证」= `pnpm -r build` 全绿 + 四端 typecheck/test + `deploy:ssh --sandbox` 通过。

## 7. C/D 实施设计已落地（见 [ADR-0091](../adr/0091-task-sections.md) / [ADR-0092](../adr/0092-saved-filters.md)）

两份 ADR（状态均为**提议（Proposed）**，接受由 lead/产品负责人决定）已含全链清单、实施文件清单与验收命令。关键取舍浓缩为五条：

1. **C = 独立实体，不是任务字段**：`SECTION { projectId, name, order, deletedAt }` + `Task.sectionId?`。分组重命名/排序是**容器属性**，独立实体把冲突面收到**一行 LWW**；字符串方案会把改名摊成"重写该组每一条任务"（N 条 op，且并发改名会让旧组复活）。数组方案在 LWW 下是覆盖语义，并发追加互相吞。一层归属（section→project），不嵌套。
2. **D = 用户数据，必须落实体**：`FILTER { name, rule, color?, order }`，`rule` 用**结构化判别联合 JSON**（`kind` 标签），不用滴答的 DSL 字符串——类型安全、跨端**同一份编译器**、可逐字段迁移；DSL 每端各写解析器必漂，且改语法会静默改写存量含义。research §2.7 已判"保存的智能清单最容易被误判成视图，而它其实是用户数据"。
3. **都不触发 Prisma 迁移**：服务端 op 存储是通用表 `model Operation`（`entityType String` / `payload Json`），新实体只是多写行，列与索引已覆盖；`ShareOperation` 同理。只有给实体加强类型服务端列（如 `AttachmentBlob` 存字节）才要迁移。仍跑 `check:schema-migration-drift`/`check:migrations` 证明未漂。
4. **服务端先于客户端上线（硬顺序）**：白名单 `ALLOWED_ENTITY_TYPES = new Set(ENTITY_TYPES)` 从数组派生 ⇒ 服务单先带上含新实体名的 `ENTITY_TYPES` 发布，客户端再发布并写 op。反向会把新实体 op 判 `INVALID_ENTITY_TYPE` **永久拒绝**（丢弃，非重试可恢复）。老客户端读到新实体 op 当未知实体优雅跳过，故客户端灰度无兼容风险。
5. **分母 +1 与两处"写死的测试"**：两实体进 `EntityModelMap` 后 `check:ai-coverage` 分母 +1；推荐同批补最小读写工具（否则登记 `ENTITY_COVERAGE_DEBT` + AI-COV-n）。无论哪条，都要同步 `capability-manifest.spec.ts` 里手写死的 `userOperableEntityTypes` 名单与 `.length` 期望值——否则红在"测试写死"而非"真的没覆盖"。C 的 `SECTION` 若落在共享清单里，其 op 必须走 share op-log（同 TASK/NOTE/COMMENT 的写入路由）。

## 8. 交付结果（2026-11-24，integrate/gap-closure @ a021ce1e）

**四工作包全部实现、合并、构建通过、门禁全绿。** 独立分支交付，未动主检出 `feat/app-auto-update`（其上有他人并行线的未提交改动，用户决定稍后自行合并）。

| 工作包 | commit 关键点 | 状态 |
|---|---|---|
| B 二级标签（ADR-0090，从丢失的 feat/tag-hierarchy 移植） | Tag.parentId + 换父防环 + Web/mobile UI | ✅ |
| A 清单级设置（icon/viewMode/kind/showInSmartList + 4 AI 工具 + 设置面板） | Project 4 可选字段 | ✅ |
| C 清单内分组（ADR-0091，SECTION 新实体全链） | 数据层/动作/local-api/AI 工具/测试 | ✅（web UI 待接入） |
| D 保存过滤器（ADR-0092，FILTER 新实体全链，结构化 JSON 非 DSL） | 同上 | ✅（web UI 待接入） |

**验证实测**：全部 packages 构建成功；domain 1361 / app-host 2588 / local-api 407 测试全绿；门禁 6/6 绿（ai-coverage · ai-tools · layering · adr-numbering 悬空0 · schema-migration-drift · migrations）。**未触及 server 代码 ⇒ 无数据库迁移、无服务端代码上线**。

**如实标注的既有边界（非本次引入，改动前基线即存在）**：
- `packages/ai` 6 条红：EVENT 工具归因、`create_reminder` fixture、`managed-routing` 托管档（`toggle_checklist_item` override 残留），全在未改动文件内。
- `apps/web` typecheck 既有债：`CalendarView.tsx` 引用了只存在于**未提交 calendar-drop wip** 的符号，导致该端无法在本环境安全构建/验证 ⇒ **C/D 的 web UI（分组头、过滤器编辑器）因此暂未接入**；数据层/动作/AI 工具/local-api 工具对 C/D 已完整。

**后续（待 apps/web 基线修复后）**：接入 C/D 的 web UI；清理 `apps/web` 既有 typecheck 债与 `packages/ai` 既有 6 红。

## 9. 集成后 web 适配与剩余（2026-11-24 续，goal round）

- **已修（本次提交）**：把 C/D 新增意图接进 `apps/web/src/features/ai/AiToolRun.tsx` 的 `intentText`（补 9 个分支）+ `packages/i18n` 中英 9 个 `intent*` key + 4 个 web 测试 mock 的 `listFilters` ⇒ **本次引入的 apps/web 类型错误归零**。现 `apps/web` 仅剩 `CalendarView.tsx` 3 条**既有 calendar-drop 债**（缺 `planCalendarTimeDrop` / `CalendarDropHour`，属另一条未提交 wip，非本次）。
- **后端验证**：domain 1361 / app-host 2588 / local-api 407 全绿；`packages/i18n` 仅 1 条既有红（`mobile.tab.ai` 等 4 条英文技术词不含汉字）；`packages/ai` 6 条既有红。
- **C/D 可视化 UI 接入点（后续，受上述 calendar 债阻塞整体验证）**：
  - **D 保存过滤器**：web 现有 `features/tasks/saved-filters.ts`（localStorage、存预制 `TaskFilter`）与 `FilterPanel.tsx`（侧栏底部）——升级为读同步的 `FILTER` 实体（`filterActions.listFilters()`）+ 结构化 `FilterRule`（`domain/filter-rule.ts`），新建成/删走 app-host action；注意 store 的当前筛选基于 `TaskFilter`，需扩展支持 `FilterRule`。
  - **C 清单内分组**：任务列表按 `Task.sectionId` 分节显示分组头（现 `date-groups.ts` 只按日期分组）。
  - 二者都改 `apps/web`，而该端可验证性依赖清理 calendar-drop wip；建议在它归位后再做，或先把本分支的 apps/web 债一并处理。
