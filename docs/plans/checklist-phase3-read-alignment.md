# 结构化子项 checklist —— Phase 3 读取回退对齐（状态）

> 2026-11-23。方案 A（`Task.checklist?` 结构化字段、零 bump、旧 note 回退）已合入主线。
> 本文记录"结构化 vs 旧 note-markdown"的读取对齐现状与可选后续。

## 已对齐（本轮）
- **展示层**：web `ChecklistEditor` / mobile `ChecklistSection` 一律走 `@heyta/domain#readChecklist`——
  结构化优先，缺结构化时回退解析 `note` 的 `- [ ]`（懒升级，不迁移）。
- **偏好推断 `inferGranularity`**：计数改 `t.checklist !== undefined ? t.checklist.length : countChecklistItems(t.note)`，
  结构化存在时按结构化项数（而非旧 note 文本）计。已加单测（结构化优先 / note 旧文本被覆盖）。

## 待办（可选、非阻断；改动既有结构需单独测试）
1. **导出 `ExportTaskRow`**：新增"子项"列（文本 + 勾选）。现导出不含 note/清单；加列会改 CSV/Markdown 快照，
   需同步测试，另起一小批。
2. **滴答导入 `ticktick-import`**：目前把 checklist 渲染成 note markdown（`checklistItems` 计数）。可直接产 `Task.checklist`
   结构化项（幂等），需改导入草稿形状 + 测试。
3. **AI `append_task_checklist`**：现写 note markdown。结构化任务上应以结构化追加，否则追加物在结构化视图里看不见。
   正确用法已是改用 `set_task_checklist`（整组覆盖）；若要保留 `append_task_checklist` 语义，需在宿主加"结构化任务走结构化追加"分支 + host 测试。

## 不做
- `timeline.ts#parseChecklistFromNote` 服务的是"时间线计划预览"这一独立概念（带 dependsOn），**不**是任务子项，保持现状。
