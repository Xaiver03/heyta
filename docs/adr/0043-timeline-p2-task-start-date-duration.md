# 0043 · 时间线 P2：给 `Task` 增加可选 `startDate` 与 `durationMinutes`

> 状态：**已接受**（2026-10-02）
> 授权依据：产品负责人 2026-10-01 批准时间线三阶段方案（goal
> [`plans/goal-timeline-rework.md`](../plans/goal-timeline-rework.md) 立项），本 ADR 的
> 字段形状与 [`../research/timeline-view-deep-dive.md`](../research/timeline-view-deep-dive.md)
> §4 P2 所述一致、未被否决。
> ⚠️ **它是 [`plans/ai-capability-branches.md`](../plans/ai-capability-branches.md) §5.1
> 那条预警（"duration / startDate 属于不可逆层，必须先确认产品要做时间线再动模型"）
> 所等待的那个确认的落点**：调研已做（deep-dive）、UI 已重画（goal P1）、产品已批准。

---

## 1. 背景

P1 重画后的时间线板（`TimelineBoard`）是一根共轴 + 三态降级
（`range` / `point` / `unscheduled`，`packages/domain/src/timeline-position.ts`）。
P1 的**生产者边界**：只有 `dueDate` 可用 ⇒ 只产出 `point` / `unscheduled`；
`range` 类型完备但**没有生产者** —— 板上画不出"条"，也就没有滴答清单那种
"拖条排期"的排期面。

滴答把 Task Duration 与 Timeline View 放在 Premium 卖（deep-dive §2.1/§2.3）；
heyta 的对标承诺里它们是同一条能力。要画出真的"条"，任务必须有**起点**与**时长**。

## 2. 决策

给 `Task` 增加**两个可选字段**（`packages/domain/src/entities.ts`）：

| 字段 | 类型 | 语义 |
|---|---|---|
| `startDate?: number` | epoch ms | 排期起点。可与"某天"粒度（本地 0 点）或时刻 |
| `durationMinutes?: number` | 正整数 | 排期时长（分钟）。与 AI 估时同单位 |

**合规形状（AGENTS §3.3）**：可选（`?`）+ 运行时默认（`undefined` = 未排期起点 /
时长未知）—— 已落盘的数据没有这两个字段，hydration 不炸；**不 bump
`CURRENT_SCHEMA_VERSION`**。写入侧：`undefined` 写成 `null`（与 `setNote` 等既有
动作同一条约定）。

## 3. 三态推导（P2 起的生产者规则）

`deriveTaskTimePosition`（`packages/app-host/src/timeline-plan.ts`）从两态扩到三态：

| 数据 | 位置 | 板上 |
|---|---|---|
| `startDate` +（`durationMinutes` **或** `dueDate`） | `range` | **条** |
| 仅 `dueDate` | `point` | 菱形（现状不变） |
| 都没有 | `unscheduled` | 泳道（现状不变） |

🔴 `durationMinutes` 单独存在**不产生任何几何**（没有起点就没有位置）。

## 4. note 回退：AI 估时行降为读时回退源

`readDurationFromNote`（备注里「预计耗时：N 分钟」那行）**保留**，角色变化：

- `durationMinutes` 字段存在 ⇒ 它是唯一事实源，note 行忽略；
- 字段缺失 ⇒ 读 note 行兜底 —— **旧数据不搬家、不迁移、不失效**（AGENTS §3.3 的
  理由：磁盘上已写进去的数据会长期存在）；
- AI 估时（`AiDuration`）的写入目标从 note 行切换到字段（一个 op），note 行只读不写
  （历史行由回退逻辑消化）。

## 5. 交互（排期面）

| 手势 | 语义 | op |
|---|---|---|
| 从「未排期」泳道拖到轴上 | 排期 | `setSchedule({ startDate, durationMinutes? })`；初始长度取估时 badge |
| 横向拖整条 | 移动 | `setSchedule({ startDate })` 平移 |
| 拖条两端 | 改时长 | `setSchedule({ durationMinutes })` |
| 点击轴上空白 | 建任务带日期 | 既有建任务 op + 日期字段，**一个 op 不 fan-out** |
| 点条/点/行头 | 开任务详情 | 读路径，无 op |

**纪律**（全部承自 AGENTS，不是新规则）：每个手势 = 一个用户意图 = 一个 op，走
`dispatch()` → op-log → 自动同步；新 action 落 `packages/app-host` 的
`createTaskActions` 一侧（§3.5：apps/ 不许出现一行排期语义）；两台设备拖同一条 =
既有 LWW + `clientId` + 冲突对话框，**不新增机制**；被回放的 op 不得再次触发副作用
（排期 op 只带字段载荷，天然满足）。

## 6. 后果

- **正**：板上第一次画得出真的"条"；滴答式拖拽排期成立；AI 估时从"藏在 note 文本里"
  升级为一等字段（同步、统计、导出都看得见）。
- **负**：`Task` 的线协议负载多两个可选键（旧客户端读不到 ⇒ 忽略，无破坏）；
  导出/导入的 payload 形状随实体走（无额外工作）。
- **不做**（沿 deep-dive §4 反需求）：自动排期 AI（条落点永远是用户的手）；
  团队甘特（依赖连线/资源/关键路径）；把日历并进时间线。

## 7. 剩余实现清单（P2 代码，未开工）

1. `Task` 两字段 + `TaskActions.setSchedule`（app-host）+ store 外观；
2. `deriveTaskTimePosition` 三态扩规则（§3）+ note 回退（§4）；
3. 板上 `range` 条渲染的接线（渲染路径 P1 已就位）+ 拖拽手势（web Pointer 优先，
   移动端手势在 goal §4 的 P3 列表）；
4. 判据：goal §3.3 三条骨架（op 形状 / 离线刷新 / 绕过 dispatch 的变异）+ 每手势一条；
5. i18n（排期相关文案）中英同步。
