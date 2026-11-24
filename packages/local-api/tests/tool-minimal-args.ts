/**
 * 目录里每个工具的**最小合法参数**（两份判据共用的一份）
 * ========================================================
 *
 * 以前这张表住在 `tool-pack-coverage.spec.ts` 里，另一处想用就只能自己再抄一份 ——
 * 而"抄一份"正是这张表最坏的失败方式：新工具进了目录，一处补了参数样本、
 * 另一处没补，那个工具就在**其中一条判据里静默缺席**（看起来两条都绿）。
 *
 * 🔴 谁要用它，谁就得同时用"每个工具都有样本"那条断言（两份判据里都有）：
 * 加了工具没加参数 ⇒ 红，不是漏覆盖。
 *
 * ⚠️ "最小"的含义是**不多不少**：参数齐全到能走完 pack 的分支，
 * 但多一个键就是在测别的用例了。
 */

export const TOOL_MINIMAL_ARGS: Readonly<Record<string, Record<string, unknown>>> = {
  list_tasks: {},
  get_task: { taskId: 't1' },
  get_task_estimate_context: { taskId: 't1' },
  list_projects: {},
  list_habits: {},
  list_tags: {},
  list_notes: {},
  get_note: { noteId: 'n1' },
  list_checkins: {},
  list_focuses: {},
  list_reminders: {},
  create_task: { title: '买咖啡豆' },
  create_project: { name: '读书' },
  create_habit: { name: '喝水' },
  create_tag: { name: '家里' },
  set_task_tags: { taskId: 't1', tagIds: ['g1'] },
  create_note: { content: '买咖啡豆' },
  update_note: { noteId: 'n1', content: '买两盒' },
  record_checkin: { habitId: 'h1' },
  log_focus: { kind: 'work', plannedMinutes: 25 },
  create_reminder: { taskId: 't1', date: '2026-10-04', time: '09:00' },
  update_task: { taskId: 't1', fields: { title: '新标题' } },
  append_task_checklist: { taskId: 't1', items: ['准备说明'] },
  complete_task: { taskId: 't1' },
  set_task_priorities: { entries: [{ taskId: 't1', priority: 'high' }] },
  set_task_estimate: { taskId: 't1', minutes: 45 },
  // W10（2026-10-03 合流移植）：倒数日四条。锚点日期必须是真实存在的一天。
  list_events: {},
  get_event: { eventId: 'e1' },
  create_event: { title: '妈妈生日', date: '2027-04-12' },
  update_event: { eventId: 'e1', fields: { pinned: true } },
  // 2026-11-22 工具层补全（P0 任务生命周期 / P1 清单·标签·笔记·提醒·事件）
  trash_task: { taskId: 't1' },
  restore_task: { taskId: 't1' },
  abandon_task: { taskId: 't1' },
  unabandon_task: { taskId: 't1' },
  move_task: { taskId: 't1' },
  uncomplete_task: { taskId: 't1' },
  rename_project: { projectId: 'p1', name: '新清单名' },
  archive_project: { projectId: 'p1' },
  delete_project: { projectId: 'p1' },
  rename_tag: { tagId: 'g1', name: '新标签名' },
  delete_tag: { tagId: 'g1' },
  delete_note: { noteId: 'n1' },
  restore_note: { noteId: 'n1' },
  move_note: { noteId: 'n1' },
  update_reminder: { reminderId: 'r1', date: '2026-10-04', time: '09:00' },
  delete_reminder: { reminderId: 'r1' },
  delete_event: { eventId: 'e1' },
  restore_event: { eventId: 'e1' },
  archive_event: { eventId: 'e1' },

  // 批次2：层级移动 / 批量 / 排序
  set_task_parent: { taskId: 't1' },
  trash_tasks: { taskIds: ['t1'] },
  restore_tasks: { taskIds: ['t1'] },
  reorder_task: { taskId: 't1', order: 1 },
  move_project: { projectId: 'p1' },
  restore_project: { projectId: 'p1' },

  // 批次3：子任务 / 备注 / 重复 / 习惯
  create_subtask: { parentId: 't1', title: '子任务' },
  set_task_note: { taskId: 't1', note: '备注' },
  set_task_repeat: { taskId: 't1', rule: 'FREQ=WEEKLY' },
  rename_habit: { habitId: 'h1', name: '新习惯名' },
  delete_habit: { habitId: 'h1' },
  restore_habit: { habitId: 'h1' },

  // 批次4：任务标记 / 批量移动 / 打卡撤销
  set_task_important: { taskId: 't1', important: true },
  set_task_pinned: { taskId: 't1', pinned: true },
  move_tasks: { taskIds: ['t1'] },
  undo_checkin: { habitId: 'h1' },

  skip_task_occurrence: { taskId: 't1' },
  set_task_repeat_after_completion: { taskId: 't1', on: true },

  // 批6：清单 / 习惯属性
  set_project_color: { projectId: 'p1', color: 3 },
  set_habit_color: { habitId: 'h1', color: 2 },
  set_habit_icon: { habitId: 'h1', icon: 'book' },
  set_habit_goal: { habitId: 'h1', target: 3 },
  set_habit_frequency: { habitId: 'h1', frequency: { type: 'daily' } },

  // 批6-2：四象限 / 推迟今天
  set_task_quadrant: { taskId: 't1', quadrant: 1 },
  postpone_task_to_today: { taskId: 't1' },

  // 批6-3：批量打卡
  record_habit_checkins: { habitIds: ['h1'] },

  // 批7：任务结构化子项
  set_task_checklist: { taskId: 't1', items: [{ text: 'x' }] },
  toggle_checklist_item: { taskId: 't1', itemText: 'x', done: true },

  // 批8：任务指派（ADR-0062 决策 7 / ADR-0088）
  set_task_assignee: { taskId: 't1' },

  // 批8：附件（ATTACHMENT）
  list_attachments: { taskId: 't1' },
  rename_attachment: { attachmentId: 'att-1', fileName: 'a.txt' },
  remove_attachment: { attachmentId: 'att-1' },

  // 批8：评论（COMMENT，share 感知通道）
  list_task_comments: { taskId: 't1' },
  add_task_comment: { taskId: 't1', body: '好的' },
  delete_task_comment: { commentId: 'c1' },

  // ADR-0091：清单内分组（SECTION）
  list_sections: { projectId: 'p1' },
  create_section: { projectId: 'p1', name: '新手入门' },
  rename_section: { sectionId: 'sec-1', name: '功能模块' },
  reorder_section: { sectionId: 'sec-1', order: 1 },
  set_task_section: { taskId: 't1', sectionId: 'sec-1' },
  delete_section: { sectionId: 'sec-1' },
};
