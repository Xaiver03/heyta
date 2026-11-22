# AI 能力 ≈ 产品能力：任务与全操作的梳理

> 2026-11-22。目标：用户能点的，AI 基本都能做（通过助手一句话），但不是无差别放开——按风险分层。

## 1. 三条原则
1. **能力对齐**：产品的每个用户操作，都应有一个对应的 Harness 工具（AI 由助手按需调用，**不新增 C 端入口**）。
2. **按风险分层放行**：
   - 只读 → 自动；
   - 可逆写（建/改/完成/移动/归档/移到回收站） → 自动 + **可撤销**（D1 `undo`）；
   - 不可逆/高危（彻底删除 purge、清空回收站、账号/密钥/同步设置） → **不给 AI** 或**必须用户明确确认**。
3. **一次意图 = 一个 op**；跨设备与手动操作同链、同等延迟；AI 写与手动写不可区分。

## 2. 现状盘点（AI 工具目录 vs 产品操作）
现有工具 29 个（`packages/local-api/src/tools`）。✅=已有工具，⛔=缺，🔒=应禁止/需确认。

| 领域 | 用户操作 | AI 现状 | 缺口/风险 |
|---|---|---|---|
| 任务 | 新建 | ✅ `create_task` | |
| 任务 | 改标题/截止/优先级 | ✅ `update_task`（仅这些字段） | ⛔ 改描述/备注正文、移动清单、改提醒 |
| 任务 | 完成 | ✅ `complete_task` | ⛔ 取消完成（反向） |
| 任务 | 追加子项/清单 | ✅ `append_task_checklist` | ⛔ 勾选子项、删子项 |
| 任务 | 批量优先级 | ✅ `set_task_priorities` | |
| 任务 | 估时 | ✅ `set_task_estimate`（需确认） | |
| 任务 | **删除/归档/恢复/移动清单** | ⛔ 无 | 可逆写，最高频缺口 |
| 任务 | 指派（若多人） | ⛔ 无 | **待确认**：heyta 是否有多人协作/指派模型 |
| 任务 | 排序/拖拽顺序、批量完成/删除 | ⛔ 无 | |
| 清单/项目 | 新建、列出 | ✅ `create_project`/`list_projects` | ⛔ 改名/删除/归档/颜色/排序/共享 |
| 标签 | 新建、列出、给任务打标签 | ✅ `create_tag`/`list_tags`/`set_task_tags` | ⛔ 改名/删除/合并 |
| 笔记 | 新建/改/读/列 | ✅ `create_note`/`update_note`/`get_note`/`list_notes` | ⛔ 删除/归档/移入清单 |
| 提醒 | 新建、列出 | ✅ `create_reminder`/`list_reminders` | ⛔ 改/删/关闭 |
| 日历事件 | 新建/改/读/列 | ✅ `create_event`/`update_event`/`get_event`/`list_events` | ⛔ 删除/批量改期 |
| 习惯 | 新建、列出、打卡/列举 | ✅ `create_habit`/`list_habits`/`record_checkin`/`log_focus` | ⛔ 改/删/停用 |
| 专注 | 记录、列出 | ✅ `log_focus`/`list_focuses` | ⛔ 开始/停止计时器（实时） |
| 检索/视图 | 按清单/完成/截止筛任务 | ✅ `list_tasks`（有限筛选） | ⛔ 全局搜索、保存筛选/排序偏好、批量视图操作 |
| 设置/账号 | 各类设置 | ⛔ 无（**保持无**） | 🔒 不给 AI |
| 回收站 | 清空/彻底删除 | ⛔ 无 | 🔒 **不给 AI**（purge） |

## 3. 优先级（按"覆盖点击量 × 可逆性"）
- **P0（任务全生命周期，覆盖绝大多数点击）**：删除→回收站、归档、恢复、**移动到清单**、改描述/备注、改提醒、取消完成。
- **P1（外扩到其余对象）**：清单改名/删除/归档；标签改名/删除/合并；笔记删除/归档；提醒改/删；事件删除/改期。
- **P2（效率/高级）**：子项勾选/删除、批量完成/删除、排序、全局搜索、习惯与专注的改删、专注计时开始/停止。
- **永不**：purge/清空回收站、账号与密钥、同步/托管等设置开关。

## 4. 与安全/裁决的关系
- 破坏性可做到"可逆"：删除 = 移到回收站（tombstone），**可撤销**；`purge` 不可逆 → 排除。
- 所有写走 op-log 单入口，AI 写与手动写同形状（带 clientId/vectorClock，跨设备同链）。
- 删除/归档/移动**不做"行动确认弹窗"**（D1 裁决：靠版本回溯），只有不可逆动作才需明确确认。

## 5. 判断
"产品能力=AI 能力"是方向，但按风险分层实现，不是一次性全放开。先补**任务全生命周期**（P0），再外扩；"指派"需先确认产品是否有多人协作模型（当前未见）。

## 6. 待确认
- "分配任务" = 归入清单/安排日期（单机）还是指派给成员（协作）？前者本就在 P0；后者取决于产品是否有协作模型。

---

## 实施进度（2026-11-22 批次 1-4 已完成，工具 30→65）

工具目录现 **65 个（读 13 / 写 52）**。本轮新增 35 个写工具，覆盖"创建/分配/改/删/恢复/移动/层级/批量/排序"：

- **任务全生命周期**：`trash_task`/`restore_task`/`abandon_task`/`unabandon_task`(放弃=第五状态)/`move_task`/`uncomplete_task`/`set_task_parent`(层级)/`create_subtask`(子任务)/`set_task_note`/`set_task_repeat`/`reorder_task`/`trash_tasks`(批量删)/`restore_tasks`(批量恢复)
- **清单**：`rename_project`/`archive_project`/`delete_project`/`move_project`(层级)/`restore_project`
- **标签**：`rename_tag`/`delete_tag`
- **笔记**：`delete_note`/`restore_note`/`move_note`
- **提醒**：`update_reminder`(date+time,与新建同口径)/`delete_reminder`
- **事件**：`delete_event`/`restore_event`/`archive_event`
- **习惯**：`rename_habit`/`delete_habit`/`restore_habit`/`undo_checkin`(撤销打卡)
- **任务标记/批量**：`set_task_important`/`set_task_pinned`/`move_tasks`(批量移动清单)

安全：删除全走软删除（可逆、可撤销，D1）；**无任何 purge 工具**；写全走 op-log 单入口；`apps/*` 只放平台差异（intentText 人话）。能力清单（`capability-manifest.generated.ts`）已同步 65 工具。

### 仍不做（需产品定义 / 明确排除）
- **多人指派（assigneeUserId）**：全仓无协作模型——"分配"= 归清单 + 排期 + 层级（已覆盖）；真正的指派属新协作能力。
- **子项逐条勾选**：清单项在 Markdown 备注里，没有独立 op；要做需新的结构化子项模型。
- **专注计时开始/停止**：实时计时器，交互性动作，`log_focus`（记一段）已覆盖事后记录。
- **purge / 清空回收站 / 账号密钥/同步设置**：安全红线，永不给 AI。
- 清单颜色/图标、任务四象限/重要/置顶、习惯打卡撤销：可后续小批次再补（低优先，或由 `update_task` 字段扩展）。
