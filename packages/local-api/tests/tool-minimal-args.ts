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
  complete_task: { taskId: 't1' },
  // W10（2026-10-03 合流移植）：倒数日四条。锚点日期必须是真实存在的一天。
  list_events: {},
  get_event: { eventId: 'e1' },
  create_event: { title: '妈妈生日', date: '2027-04-12' },
  update_event: { eventId: 'e1', fields: { pinned: true } },
};
