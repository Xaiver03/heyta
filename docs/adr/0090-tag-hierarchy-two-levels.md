# ADR-0090：标签做**两级层级**，只承担分组与汇总筛选，不承担归属

- **状态**：已接受（2026-11-22，产品负责人授权「目标模式全部做掉」）
- **日期**：2026-11-22
- **相关**：[ADR-0014](0014-memory-switch-and-corrections.md)（可加性可选字段不 bump schema）、
  [`project-hierarchy.ts`](../../packages/domain/src/project-hierarchy.ts)（清单一层文件夹，本 ADR 与其同形）、
  [`ticktick-data-model-parity.md`](../research/ticktick-data-model-parity.md) §1 第 6 行（滴答 `ZTTTAG` 是**树状**，heyta 原为平铺）
- **取代**：无（新增能力）

---

## 一、决策

**给 `Tag` 增加一层父子关系，只做两层：父标签 / 子标签。层级的产品语义是「分组 + 汇总筛选（roll-up）」，不是「归属」。**

1. **`Tag.parentId?: string`**（可选，可加性变更，**不 bump `CURRENT_SCHEMA_VERSION`**，AGENTS.md §3.3）。
2. **深度锁 2 级**：父必须是顶层标签，父不能有父；父标签也不能再被挂进别的父（`validateTagParentChange` 六种拒绝）。
3. **汇总筛选是树唯一的价值**：按父标签筛选时，其所有子标签下的任务**一并带出**（`expandTagIdsWithDescendants`）；按子标签筛选只带自己。不做 roll-up 的树等于只是视觉分组，不如不做。
4. **归属永远归清单/文件夹，标签永远横向属性**：一个任务仍可挂多个标签；标签不回答"这条归谁、放哪个筐"。清单 = 单一归属（在哪），标签 = 多对多属性（是什么状态）。
5. **用关系字段，不把路径写进名字**：不用 `#父/子` 这类字符串路径（那是把命名当结构，会撞名）；父子靠 `parentId`。
6. **同层名字唯一**（兄弟间不重名），不同父下可同名子标签。
7. **与合并别名统一入口**：`Tag.mergedInto`（合并别名）与 `parentId`（父子）两套重定向的解析都收进 [`tags.ts`](../../packages/domain/src/tags.ts) 的 `resolveTagIds` 唯一入口；结构守卫在 [`tag-hierarchy.ts`](../../packages/domain/src/tag-hierarchy.ts)。

## 二、为什么做（对齐滴答时唯一值得学的那一项）

数据模型三方对照（[P3](../research/ticktick-data-model-parity.md)）里，滴答比我们多的 15 行实体中，多数是它"服务端下发 + 本地快照"架构的产物、**不该抄**。标签有层级是**唯一在产品语义上确实多给了一个维度**、值得学的一项：用户在任务管理器里需要"把同类标签收成一组，并一眼看到这一组下的全部任务"。

**但只学语义、不照抄形状**：滴答的标签是树状（`ZPARENT`/`ZCOLLAPSED`），且实为**两级**（`#一级/二级`，超两级不处理）；它还有"标签名全局唯一导致 `#a/b` 与 `#b` 互吞"的债务。本 ADR 只取"两级 + 汇总"，形状用 op-log（可选 `parentId` + 读侧解析），不照抄它 18 列的 `ZTTAG`。

## 三、被否决的方案

| 方案 | 为什么否 |
|---|---|
| **任意深度树** | 深度 > 2 会增加记忆负担、跨项目复用变差、检索变慢（多条实践一致结论）；且会与"清单只有一层文件夹"的心智不一致 —— 用户面对两棵深浅不同的树更难判断"东西该放哪"。 |
| **把标签也做成文件夹/归属** | 那会制造**第二棵"该放哪"的树**：任务已经有一个家（清单），再来一个归属维度，用户不知道该进哪棵树。这正是滴答 UI 里"各种分类混在一栏"让人困惑的根源。 |
| **路径写进标签名（`a/b`）** | 命名当结构：改名等于改结构、跨父重名互吞、搜索按前缀失效。用关系字段没有这些债。 |
| **保存的智能清单 / 筛选器做成实体** | 那是另一件事（保存的查询是用户数据、不是视图），本 ADR 不处理；见 P3 §2.7。 |

## 四、后果与边界

- **写入路径**：`app-host` 的 `createTag(name, parentId?)` 与 `setTagParent(entityId, parentId?)`；一个用户意图一条 op；提为顶层写 `parentId: null`（能穿 JSON 表达"清除"）。
- **读侧**：`resolveTagIds` 先跟合并别名、再判可见性；筛选（`filterTasks` 的 `tag` 分支、`scopeTasks`）在解析后再按 `expandTagIdsWithDescendants` 展开。
- **界面**：Web 侧栏与「标签管理页」、移动端「我的」页都按两层渲染（子标签缩进），并提供换父；任务详情/行尾的标签选择按父子排序、子标签加层级前缀。
- **孤儿**：父被删的子标签在渲树上按顶层列出（否则任务上那个勾选就没法取消），不静默隐藏。
- **不做的**：不做 >2 级；不做每视图标签排序；不改 `Project` 的一层文件夹规则。

## 五、落地范围（本轮实现）

- 领域层 `tag-hierarchy.ts`（守卫 + 展开 + `tagTargetsFor`）、`entities.ts` 的 `Tag.parentId?`、`task-filter.ts` 的 roll-up。
- 动作层 `createTag` / `setTagParent` + 同层唯一守卫。
- UI：Web 侧栏 / 标签管理页 / 任务详情，移动端 我的页 / 任务详情；i18n（zh/en）。
- 测试：domain `tag-hierarchy.spec`、app-host `tag-hierarchy-actions.spec`；现有 tags / merge / project-actions / 移动端 organizer-rename 不回归。
