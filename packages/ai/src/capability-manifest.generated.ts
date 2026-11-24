/**
 * heyta 的**产品级 AI 能力清单** —— **自动生成，请勿手改**。
 *
 * 唯一事实源：`packages/local-api/src/tools/<entity>.ts`（每个实体一个 pack：目录声明
 * + 参数 schema + 执行器）+ `packages/domain` 的 `MODELED_ENTITY_TYPES` + `packages/shared-schema`
 * 的 `ENTITY_TYPES`。改**上游**，不要改这里 —— 这里每改一个字节都是给模型的一句谎话。
 *
 * 重新生成：`node scripts/gen-ai-capability-manifest.mjs`
 * 校验漂移：`node scripts/gen-ai-capability-manifest.mjs --check`（门禁用，不一致 exit 1 并打印差异）
 *
 * 🔴 为什么禁止手写（ADR-0045 §2.6 纪律一）：助手侧不再逐工具授权之后，目录每加一个工具
 *    AI 就多一个能力；手工维护的清单在**当天**就开始说谎，而漂了的清单会让模型
 *    **自信地说不存在的不存在** —— 滴答助手那句"纪念日只能查看不能新建"就是这个形状
 *    （`docs/research/dida-ai-assistant-gap-analysis.md` §2.1）。
 *
 * 🔴 纪律二（拒绝话术）：这份清单同时表达三件事 —— 实体在产品里**存在**、
 *    AI **有没有**工具、有工具的话是**读还是写**。所以"我没有这个工具"和
 *    "产品做不到"在数据上就是两回事，模型不必也不该把它们混着说。
 *
 * ⚠️ 这是**发给模型的 prompt 数据**，不是用户界面文案：它不进 `packages/i18n` 词条表、
 *    不需要英文对照，也不归 `check:ui-language` 管（那个门禁扫的是 `apps/{web,landing,mobile}/src`）。
 *    界面上的句子仍然只能来自词条表。
 *
 * ⚠️ 刻意**不含**时间戳：有时间戳的生成物每次 `--check` 都会红，那条门禁就废了。
 * ⚠️ 刻意**不含**实体的中文显示名：仓库里没有「实体 → 界面词」的单一事实源，
 *    手抄一份就是被禁止的第二份。界面词与"路径 Y"由 W12（对话外壳）一并定。
 */

/** 同步协议认识的实体类型（生成的联合类型，成员随上游变）。 */
export type AiCapabilityEntityType =
  'TASK' | 'PROJECT' | 'TAG' | 'NOTE' |
    'HABIT' | 'HABIT_LOG' | 'FOCUS_SESSION' | 'AI_FEEDBACK' |
    'PREFERENCE_CORRECTION' | 'REMINDER' | 'EVENT' | 'CALENDAR_EVENT' |
    'ASSISTANT_TURN' | 'COMMENT' | 'ATTACHMENT' | 'TASK_REPEAT_CFG' |
    'GLOBAL_CONFIG' | 'MIGRATION' | 'RECOVERY' | 'ALL';

/** 真的被 `packages/op-log` 物化了领域模型的实体类型。 */
export type AiCapabilityModeledEntityType =
  'TASK' | 'PROJECT' | 'TAG' | 'NOTE' |
    'HABIT' | 'HABIT_LOG' | 'FOCUS_SESSION' | 'AI_FEEDBACK' |
    'PREFERENCE_CORRECTION' | 'REMINDER' | 'EVENT' | 'CALENDAR_EVENT' |
    'ASSISTANT_TURN' | 'COMMENT' | 'ATTACHMENT';

/** 工具的可写性 —— 判定读写只有这两个取值（`@heyta/local-api` 的 `ToolKind`）。 */
export type AiCapabilityToolKind = 'read' | 'write';

/** 某个实体上 AI 工具的形状。`none` 是"产品有它、我没有工具"，不是"没有这个东西"。 */
export type AiCapabilityCoverage = 'none' | 'read-only' | 'write-only' | 'read-write';

/** 一个工具参数。`*` 号在文本投影里表示必填。 */
export interface AiCapabilityToolArg {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
}

export interface AiCapabilityTool {
  readonly name: string;
  readonly kind: AiCapabilityToolKind;
  readonly entityType: AiCapabilityModeledEntityType;
  readonly description: string;
  /** `false` = 这个工具没在自己那个实体 pack 的 `schemas` 里登记 —— `args` 可能**不完整**。 */
  readonly schemaRecorded: boolean;
  readonly args: readonly AiCapabilityToolArg[];
}

export interface AiCapabilityEntity {
  readonly entityType: AiCapabilityModeledEntityType;
  readonly materialized: boolean;
  /** 是否算进"AI 覆盖面 = 界面功能面"的分母（ADR-0045 §2.7 的口径）。 */
  readonly countsTowardCoverage: boolean;
  readonly coverage: AiCapabilityCoverage;
  readonly readToolNames: readonly string[];
  readonly writeToolNames: readonly string[];
}

export interface AiCapabilityDenominatorExclusion {
  readonly entityType: AiCapabilityModeledEntityType;
  readonly reason: string;
}

export interface AiCapabilityManifest {
  /** **本产物的结构版本**，与 `CURRENT_SCHEMA_VERSION` 无关：它不落盘、不进线协议。 */
  readonly manifestVersion: number;
  readonly policy: { readonly refusalMustSeparate: string; readonly source: string };
  readonly coverage: { readonly covered: number; readonly denominator: number; readonly ratio: string };
  readonly userOperableEntityTypes: readonly AiCapabilityModeledEntityType[];
  readonly modelledEntityTypes: readonly AiCapabilityModeledEntityType[];
  readonly excludedFromDenominator: readonly AiCapabilityDenominatorExclusion[];
  readonly entityTypesWithoutTools: readonly AiCapabilityModeledEntityType[];
  readonly entities: readonly AiCapabilityEntity[];
  readonly tools: readonly AiCapabilityTool[];
  readonly protocolTypesWithoutModel: readonly string[];
  readonly systemEntityTypes: readonly string[];
  readonly nonEntityViews: readonly string[];
}

export const AI_CAPABILITY_MANIFEST =
{
  'manifestVersion': 1,
  'policy': {
    'refusalMustSeparate': '我没有这个工具（AI 侧缺工具） ｜ 产品做不到（实体或功能不存在）',
    'source': 'ADR-0045 §2.6 纪律二',
  },
  'coverage': {
    'covered': 11,
    'denominator': 12,
    'ratio': '11/12',
  },
  'userOperableEntityTypes': [
    'TASK',
    'PROJECT',
    'TAG',
    'NOTE',
    'HABIT',
    'HABIT_LOG',
    'FOCUS_SESSION',
    'REMINDER',
    'EVENT',
    'CALENDAR_EVENT',
    'COMMENT',
    'ATTACHMENT',
  ],
  'modelledEntityTypes': [
    'TASK',
    'PROJECT',
    'TAG',
    'NOTE',
    'HABIT',
    'HABIT_LOG',
    'FOCUS_SESSION',
    'AI_FEEDBACK',
    'PREFERENCE_CORRECTION',
    'REMINDER',
    'EVENT',
    'CALENDAR_EVENT',
    'ASSISTANT_TURN',
    'COMMENT',
    'ATTACHMENT',
  ],
  'excludedFromDenominator': [
    {
      'entityType': 'AI_FEEDBACK',
      'reason': 'AI 建议处置的落库载体（用户不直接创建它）',
    },
    {
      'entityType': 'PREFERENCE_CORRECTION',
      'reason': '偏好纠正的落库载体（用户不直接创建它）',
    },
    {
      'entityType': 'ASSISTANT_TURN',
      'reason': '助手对话的一行记录（ADR-0045 D-4 (ii)）：它是**对话本身**，不是用户可操作的业务实体，而且正文里含 provider 的回复 —— 给 AI 读写它的工具等于让模型改写自己的上下文',
    },
  ],
  'entityTypesWithoutTools': [
    'CALENDAR_EVENT',
  ],
  'entities': [
    {
      'entityType': 'TASK',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'read-write',
      'readToolNames': [
        'list_tasks',
        'get_task',
        'get_task_estimate_context',
      ],
      'writeToolNames': [
        'create_task',
        'update_task',
        'append_task_checklist',
        'complete_task',
        'set_task_priorities',
        'set_task_estimate',
        'trash_task',
        'restore_task',
        'abandon_task',
        'unabandon_task',
        'move_task',
        'uncomplete_task',
        'set_task_parent',
        'trash_tasks',
        'restore_tasks',
        'reorder_task',
        'create_subtask',
        'set_task_note',
        'set_task_repeat',
        'set_task_important',
        'set_task_pinned',
        'move_tasks',
        'skip_task_occurrence',
        'set_task_repeat_after_completion',
        'set_task_quadrant',
        'postpone_task_to_today',
        'set_task_checklist',
        'toggle_checklist_item',
        'set_task_assignee',
      ],
    },
    {
      'entityType': 'PROJECT',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'read-write',
      'readToolNames': [
        'list_projects',
      ],
      'writeToolNames': [
        'create_project',
        'rename_project',
        'archive_project',
        'delete_project',
        'move_project',
        'restore_project',
        'set_project_color',
        'set_project_icon',
        'set_project_view_mode',
        'set_project_kind',
        'set_project_show_in_smart_list',
      ],
    },
    {
      'entityType': 'TAG',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'read-write',
      'readToolNames': [
        'list_tags',
      ],
      'writeToolNames': [
        'create_tag',
        'set_task_tags',
        'rename_tag',
        'delete_tag',
      ],
    },
    {
      'entityType': 'NOTE',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'read-write',
      'readToolNames': [
        'list_notes',
        'get_note',
      ],
      'writeToolNames': [
        'create_note',
        'update_note',
        'delete_note',
        'restore_note',
        'move_note',
      ],
    },
    {
      'entityType': 'HABIT',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'read-write',
      'readToolNames': [
        'list_habits',
      ],
      'writeToolNames': [
        'create_habit',
        'rename_habit',
        'delete_habit',
        'restore_habit',
        'set_habit_color',
        'set_habit_icon',
        'set_habit_goal',
        'set_habit_frequency',
      ],
    },
    {
      'entityType': 'HABIT_LOG',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'read-write',
      'readToolNames': [
        'list_checkins',
      ],
      'writeToolNames': [
        'record_checkin',
        'undo_checkin',
        'record_habit_checkins',
      ],
    },
    {
      'entityType': 'FOCUS_SESSION',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'read-write',
      'readToolNames': [
        'list_focuses',
      ],
      'writeToolNames': [
        'log_focus',
      ],
    },
    {
      'entityType': 'AI_FEEDBACK',
      'materialized': true,
      'countsTowardCoverage': false,
      'coverage': 'none',
      'readToolNames': [] as const,
      'writeToolNames': [] as const,
    },
    {
      'entityType': 'PREFERENCE_CORRECTION',
      'materialized': true,
      'countsTowardCoverage': false,
      'coverage': 'none',
      'readToolNames': [] as const,
      'writeToolNames': [] as const,
    },
    {
      'entityType': 'REMINDER',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'read-write',
      'readToolNames': [
        'list_reminders',
      ],
      'writeToolNames': [
        'create_reminder',
        'update_reminder',
        'delete_reminder',
      ],
    },
    {
      'entityType': 'EVENT',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'read-write',
      'readToolNames': [
        'list_events',
        'get_event',
      ],
      'writeToolNames': [
        'create_event',
        'update_event',
        'delete_event',
        'restore_event',
        'archive_event',
      ],
    },
    {
      'entityType': 'CALENDAR_EVENT',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'none',
      'readToolNames': [] as const,
      'writeToolNames': [] as const,
    },
    {
      'entityType': 'ASSISTANT_TURN',
      'materialized': true,
      'countsTowardCoverage': false,
      'coverage': 'none',
      'readToolNames': [] as const,
      'writeToolNames': [] as const,
    },
    {
      'entityType': 'COMMENT',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'read-write',
      'readToolNames': [
        'list_task_comments',
      ],
      'writeToolNames': [
        'add_task_comment',
        'delete_task_comment',
      ],
    },
    {
      'entityType': 'ATTACHMENT',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'read-write',
      'readToolNames': [
        'list_attachments',
      ],
      'writeToolNames': [
        'rename_attachment',
        'remove_attachment',
      ],
    },
  ],
  'tools': [
    {
      'name': 'list_tasks',
      'kind': 'read',
      'entityType': 'TASK',
      'description': '列出任务。返回标题、截止日期、优先级、完成状态。可按清单、完成状态、截止日期筛；按日期查时范围最多 14 天。不返回备注正文 —— 备注要单独用 get_task 取。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'projectId',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'completed',
          'type': 'boolean',
          'required': false,
        },
        {
          'name': 'dueOn',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'dueFrom',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'dueTo',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'limit',
          'type': 'number',
          'required': false,
        },
      ],
    },
    {
      'name': 'get_task',
      'kind': 'read',
      'entityType': 'TASK',
      'description': '读取单个任务的完整内容（含备注正文）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'get_task_estimate_context',
      'kind': 'read',
      'entityType': 'TASK',
      'description': '读取一条任务的估时上下文：标题、可读时的备注、最近至多 20 条有效专注历史和已授权的估时偏好。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'list_projects',
      'kind': 'read',
      'entityType': 'PROJECT',
      'description': '列出清单/项目及其任务数量。',
      'schemaRecorded': true,
      'args': [] as const,
    },
    {
      'name': 'list_habits',
      'kind': 'read',
      'entityType': 'HABIT',
      'description': '列出习惯及其打卡目标（目标数值、单位、达成口径）。只列习惯的定义，不列每天的打卡记录。',
      'schemaRecorded': true,
      'args': [] as const,
    },
    {
      'name': 'list_tags',
      'kind': 'read',
      'entityType': 'TAG',
      'description': '列出所有标签（标识与名称）。给任务打标签之前先用它拿到标签标识。',
      'schemaRecorded': true,
      'args': [] as const,
    },
    {
      'name': 'list_notes',
      'kind': 'read',
      'entityType': 'NOTE',
      'description': '列出便签的目录信息（标识、归属清单、是否钉在今天、最后修改时间），顺序和界面上一样。不返回正文 —— 正文要用 get_note 逐条取。默认最多 50 条，筛完才截断。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'limit',
          'type': 'number',
          'required': false,
        },
      ],
    },
    {
      'name': 'get_note',
      'kind': 'read',
      'entityType': 'NOTE',
      'description': '读取一条便签，包含正文。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'noteId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'list_checkins',
      'kind': 'read',
      'entityType': 'HABIT_LOG',
      'description': '列出打卡记录（哪个习惯、哪一天、这一次的数值），按记录写进去的先后排。可以只看某一个习惯的。默认最多 50 条，筛完才截断。注意它列的是记录，不是习惯有哪些：习惯的定义用 list_habits。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'habitId',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'limit',
          'type': 'number',
          'required': false,
        },
      ],
    },
    {
      'name': 'list_focuses',
      'kind': 'read',
      'entityType': 'FOCUS_SESSION',
      'description': '列出专注记录（哪一类、计划多久、实际多久、有没有走完、从哪一刻开始），按记录写进去的先后排。默认最多 50 条。时间单位是毫秒，和记录里存的一样。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'limit',
          'type': 'number',
          'required': false,
        },
      ],
    },
    {
      'name': 'list_reminders',
      'kind': 'read',
      'entityType': 'REMINDER',
      'description': '列出提醒（哪条任务、哪一刻、现在走到哪一步：还没到 / 已顺延 / 该响了 / 已响过 / 已忽略），按提醒时刻从早到晚。可以只看某一条任务的。时刻是机器时间，界面上显示的是本地日期时间。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'list_events',
      'kind': 'read',
      'entityType': 'EVENT',
      'description': '列出倒数日与纪念日（未删除、未归档），按界面同一套顺序排：置顶在前、距下一次近的在前。每条给出锚点日期、类型档位、下一次发生日与相差天数。不返回备注正文 —— 备注要单独用 get_event 取。归档过的倒数日不在这里。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'limit',
          'type': 'number',
          'required': false,
        },
      ],
    },
    {
      'name': 'get_event',
      'kind': 'read',
      'entityType': 'EVENT',
      'description': '读取单个倒数日/纪念日的完整内容（含备注正文）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'eventId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'list_attachments',
      'kind': 'read',
      'entityType': 'ATTACHMENT',
      'description': '列出某条任务下的附件（文件名、类型、大小）。只返回元数据，不返回文件内容 —— 这条通道上没有取回字节的能力。软删除的附件不出现。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'list_task_comments',
      'kind': 'read',
      'entityType': 'COMMENT',
      'description': '列出一条任务下的评论线程（标识、所属任务、作者、正文、创建时间），按创建时间从早到晚。评论只存在于**共享清单**里 —— 个人清单、或本宿主没有共享会话时，会明确告诉你读不到，而不是给一个空列表。默认最多 50 条，筛完才截断。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'limit',
          'type': 'number',
          'required': false,
        },
      ],
    },
    {
      'name': 'create_task',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '新建一个任务。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'title',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'dueDate',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'priority',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'projectId',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'update_task',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '修改任务字段（标题、截止日期、优先级）。只能改显式给定的字段。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'fields',
          'type': 'object',
          'required': true,
        },
      ],
    },
    {
      'name': 'append_task_checklist',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '把一组未完成清单追加到任务备注末尾，保留已有备注。一次最多 20 条。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'items',
          'type': 'array',
          'required': true,
        },
      ],
    },
    {
      'name': 'complete_task',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '把任务标记为完成。单条给 taskId；要一次完成多条给 taskIds（一次最多 20 条，按去重后的条数算）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'taskIds',
          'type': 'array',
          'required': false,
        },
      ],
    },
    {
      'name': 'set_task_priorities',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '一次给多条任务设置优先级。每条都要给 taskId 与 priority（none / low / medium / high），最多 20 条。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'entries',
          'type': 'array',
          'required': true,
        },
      ],
    },
    {
      'name': 'set_task_estimate',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '设置任务的预计耗时（整数分钟，5–480；超出范围会夹到边界）。这项改动必须确认。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'minutes',
          'type': 'number',
          'required': true,
        },
      ],
    },
    {
      'name': 'trash_task',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '把任务移进回收站（软删除，之后可用 restore_task 恢复）。参数：taskId（要删除的任务 id）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'restore_task',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '把回收站里的任务恢复到原处。参数：taskId（要恢复的任务 id）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'abandon_task',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '放弃任务（第五状态 abandonedAt，可逆，之后可用 unabandon_task 取消放弃）。参数：taskId（要放弃的任务 id）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'unabandon_task',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '取消放弃（把 abandonedAt 清掉，任务回到进行中）。参数：taskId。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'move_task',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '把任务移到另一个清单。参数：taskId（要移动的任务 id）、projectId（目标清单 id；省略表示移出清单、不归属任何清单）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'projectId',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'uncomplete_task',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '把已完成的任务标记回未完成。参数：taskId（要改回未完成的任务 id）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'set_task_parent',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '把任务挂到另一个父任务下，建立层级。参数：taskId（要移动的任务 id）、parentId（新的父任务 id；省略表示提为顶级、不挂在任何任务下）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'parentId',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'trash_tasks',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '把多条任务一次性移进回收站（软删除，之后可用 restore_tasks 恢复）。参数：taskIds（要删除的任务 id 列表，至少一条）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskIds',
          'type': 'array',
          'required': true,
        },
      ],
    },
    {
      'name': 'restore_tasks',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '把回收站里的多条任务一次性恢复到原处。参数：taskIds（要恢复的任务 id 列表，至少一条）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskIds',
          'type': 'array',
          'required': true,
        },
      ],
    },
    {
      'name': 'reorder_task',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '调整任务在清单里的排序位置。参数：taskId（要排序的任务 id）、order（排序序号，有限数字）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'order',
          'type': 'number',
          'required': true,
        },
      ],
    },
    {
      'name': 'create_subtask',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '在某个父任务下新建子任务。参数：parentId（父任务 id）、title（子任务标题，不能是空白）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'parentId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'title',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'set_task_note',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '设置任务的备注。参数：taskId（任务 id）、note（备注正文；省略表示清除备注）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'note',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'set_task_repeat',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '设置任务的重复规则。参数：taskId（任务 id）、rule（重复规则字符串，原样交给动作层校验；省略表示清除重复）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'rule',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'set_task_important',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '把任务标记为重要或取消重要。参数：taskId（任务 id）、important（布尔值，true 标记重要、false 取消）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'important',
          'type': 'boolean',
          'required': true,
        },
      ],
    },
    {
      'name': 'set_task_pinned',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '把任务置顶或取消置顶。参数：taskId（任务 id）、pinned（布尔值，true 置顶、false 取消）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'pinned',
          'type': 'boolean',
          'required': true,
        },
      ],
    },
    {
      'name': 'move_tasks',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '把多条任务一次性移到另一个清单。参数：taskIds（要移动的任务 id 列表，至少一条）、projectId（目标清单 id；省略表示移出清单、不归属任何清单）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskIds',
          'type': 'array',
          'required': true,
        },
        {
          'name': 'projectId',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'skip_task_occurrence',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '跳过重复任务的「这一次」（把当前到期日推进到下一次）。只对有重复规则的任务有效。参数：taskId。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'set_task_repeat_after_completion',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '设置重复任务是「按截止日顺延」还是「按完成日顺延」。参数：taskId、on（true=完成后顺延，false=按截止日）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'on',
          'type': 'boolean',
          'required': true,
        },
      ],
    },
    {
      'name': 'set_task_quadrant',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '把任务一键放进四象限的某一格（1=重要且紧急 2=重要不紧急 3=紧急不重要 4=不重要不紧急）。内部翻译成对「重要」与「截止日」两个字段的写入（象限是派生视图，不是独立字段）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'quadrant',
          'type': 'number',
          'required': true,
        },
      ],
    },
    {
      'name': 'postpone_task_to_today',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '把一条任务「推迟到今天」：把已过去的截止日顺延到今天同一时刻。已完成、或已今天到期的任务不做改变。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'set_task_checklist',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '整组设置任务的结构化子项清单（checklist）。items 是 [{text, done?}]；覆盖式（不在列表里的旧子项会被删除）。空数组 = 清空。全勾时正常任务的父任务会自动完成。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'items',
          'type': 'array',
          'required': true,
        },
      ],
    },
    {
      'name': 'toggle_checklist_item',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '勾选 / 取消任务里某一条结构化子项（按文本匹配）。子项必须是结构化清单(先用 set_task_checklist 建立)；文本需唯一，重名会拒绝。全勾时正常任务的父任务会自动完成。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'itemText',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'done',
          'type': 'boolean',
          'required': true,
        },
      ],
    },
    {
      'name': 'set_task_assignee',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '设置或清除任务的指派人。参数：taskId（任务 id）、assigneeUserId（指派成员的 id；省略或空串表示清除指派）。仅在共享清单内有意义；个人任务缺席即未指派。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'assigneeUserId',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'create_project',
      'kind': 'write',
      'entityType': 'PROJECT',
      'description': '新建一个清单（项目）。可选放进某个已有清单的下层，最多一层。名称不能为空；放在哪个清单下面由宿主核对，认不出就整条拒绝而不是建到看不见的地方。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'name',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'parentId',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'rename_project',
      'kind': 'write',
      'entityType': 'PROJECT',
      'description': '给一个清单（项目）改名。名称不能为空，也不能只有空格。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'projectId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'name',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'archive_project',
      'kind': 'write',
      'entityType': 'PROJECT',
      'description': '归档一个清单（项目），或把已归档的清单恢复为未归档。省略 archived 就是归档；archived 为 false 即恢复。清单不存在会被拒绝。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'projectId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'archived',
          'type': 'boolean',
          'required': false,
        },
      ],
    },
    {
      'name': 'delete_project',
      'kind': 'write',
      'entityType': 'PROJECT',
      'description': '把一个清单（项目）删除到回收站。可撤销，不是彻底删除。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'projectId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'move_project',
      'kind': 'write',
      'entityType': 'PROJECT',
      'description': '把一个清单（项目）移动到另一个清单的下层，或移出下层成为顶层清单。省略 parentId 就是提为顶层。目标清单不存在、或移动会形成环/超过允许层数会被拒绝。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'projectId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'parentId',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'restore_project',
      'kind': 'write',
      'entityType': 'PROJECT',
      'description': '把一个在回收站里的清单（项目）恢复回来。清单不存在或不在回收站会被拒绝。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'projectId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'set_project_color',
      'kind': 'write',
      'entityType': 'PROJECT',
      'description': '给一个清单（项目）设置颜色槽位（1–8），或清除颜色。🔴 仅在用户明确要求某个颜色时调用；不要自行替用户决定清单该是什么颜色。省略 color = 清除颜色。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'projectId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'color',
          'type': 'number',
          'required': false,
        },
      ],
    },
    {
      'name': 'set_project_icon',
      'kind': 'write',
      'entityType': 'PROJECT',
      'description': '给一个清单（项目）指定图标（闭集里的 key，如 list / star / briefcase / home），或清除回到默认。🔴 仅在用户明确要求某个图标时调用；不要自行替用户选图标。省略 icon = 清除。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'projectId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'icon',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'set_project_view_mode',
      'kind': 'write',
      'entityType': 'PROJECT',
      'description': '设置一个清单（项目）的默认视图：list（列表）/ board（看板）/ calendar（日历）/ timeline（时间线）。仅改变展示排布，不改变任务本身。省略 viewMode = 清除回到 list。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'projectId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'viewMode',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'set_project_kind',
      'kind': 'write',
      'entityType': 'PROJECT',
      'description': '设置一个清单（项目）的类型：tasks（默认展示任务）/ notes（默认展示便签）。它只表达"打开这条清单先看到什么"，不限制内容、不合并便签实体。省略 kind = 清除回到 tasks。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'projectId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'kind',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'set_project_show_in_smart_list',
      'kind': 'write',
      'entityType': 'PROJECT',
      'description': '设置一个清单（项目）是否在智能清单 / 汇总里显示。缺省为 true（显示）；传 false 即隐藏。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'projectId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'showInSmartList',
          'type': 'boolean',
          'required': true,
        },
      ],
    },
    {
      'name': 'create_habit',
      'kind': 'write',
      'entityType': 'HABIT',
      'description': '新建一个习惯。可指定每天的目标数值、单位与达成口径（至少 / 至多 / 恰好）。不传目标就是"每天做过一次"。名称不能为空。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'name',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'target',
          'type': 'number',
          'required': false,
        },
        {
          'name': 'unit',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'goalType',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'rename_habit',
      'kind': 'write',
      'entityType': 'HABIT',
      'description': '给一个习惯改名。名称不能为空，也不能只有空格。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'habitId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'name',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'delete_habit',
      'kind': 'write',
      'entityType': 'HABIT',
      'description': '把一个习惯删除到回收站。可撤销，不是彻底删除；之后可用 restore_habit 恢复。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'habitId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'restore_habit',
      'kind': 'write',
      'entityType': 'HABIT',
      'description': '把回收站里的习惯恢复到原处。习惯不存在或不在回收站会被拒绝。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'habitId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'set_habit_color',
      'kind': 'write',
      'entityType': 'HABIT',
      'description': '给一个习惯设置颜色槽位（1–8），或清除颜色。🔴 仅在用户明确要求某个颜色时调用；不要自行替用户决定习惯该是什么颜色。省略 color = 清除颜色。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'habitId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'color',
          'type': 'number',
          'required': false,
        },
      ],
    },
    {
      'name': 'set_habit_icon',
      'kind': 'write',
      'entityType': 'HABIT',
      'description': '给一个习惯指定图标（闭集里的 key，如 drop / book / moon / sun），或清除回到默认图标。🔴 仅在用户明确要求某个图标时调用；不要自行替用户选图标。省略 icon = 清除。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'habitId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'icon',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'set_habit_goal',
      'kind': 'write',
      'entityType': 'HABIT',
      'description': '改一个习惯的目标：目标数值 target、单位 unit、达成口径 goalType（atLeast / atMost / exactly），三者都可单独改。至少给一个字段；unit 传空串表示清除单位。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'habitId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'target',
          'type': 'number',
          'required': false,
        },
        {
          'name': 'unit',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'goalType',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'set_habit_frequency',
      'kind': 'write',
      'entityType': 'HABIT',
      'description': '改一个习惯的重复频率。frequency 是结构对象：{type:"daily"} / {type:"weekly",daysOfWeek:[1-7]} / {type:"interval",everyNDays:N} / {type:"spaced",offsets:[...],anchor:"YYYY-MM-DD"}。省略 = 退回每天。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'habitId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'frequency',
          'type': 'object',
          'required': false,
        },
      ],
    },
    {
      'name': 'create_tag',
      'kind': 'write',
      'entityType': 'TAG',
      'description': '新建一个标签。名称不能为空，也不能只有空格。重名不会被拒绝（界面上也是如此）。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'name',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'set_task_tags',
      'kind': 'write',
      'entityType': 'TAG',
      'description': '把一条任务的标签**整组换成**给定的这一组，传空数组就是全部清掉。这不是追加：要多打一个标签，先把现有标签取回来，连同新的一起传。不认识或已经删掉的标签标识会被拒绝而不是忽略。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'tagIds',
          'type': 'array',
          'required': true,
        },
      ],
    },
    {
      'name': 'rename_tag',
      'kind': 'write',
      'entityType': 'TAG',
      'description': '给一个标签改名。名称不能为空，也不能只有空格。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'tagId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'name',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'delete_tag',
      'kind': 'write',
      'entityType': 'TAG',
      'description': '把一个标签删除到回收站。可撤销，不是彻底删除。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'tagId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'create_note',
      'kind': 'write',
      'entityType': 'NOTE',
      'description': '新建一张便签。正文不能为空（只有空格也算空）。可以指定放进哪个清单，不指定就是不归属任何清单；可以钉在今天。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'content',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'projectId',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'isPinnedToToday',
          'type': 'boolean',
          'required': false,
        },
      ],
    },
    {
      'name': 'update_note',
      'kind': 'write',
      'entityType': 'NOTE',
      'description': '改写一张已有便签的正文（整段替换，不是追加）。正文不能为空。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'noteId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'content',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'delete_note',
      'kind': 'write',
      'entityType': 'NOTE',
      'description': '把一张便签删除到回收站。可撤销，不是彻底删除。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'noteId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'restore_note',
      'kind': 'write',
      'entityType': 'NOTE',
      'description': '把回收站里的一张便签恢复回来。便签不在回收站会被拒绝。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'noteId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'move_note',
      'kind': 'write',
      'entityType': 'NOTE',
      'description': '把一张便签移到某个清单，或移出清单（省略 projectId 就是不归属任何清单）。清单不存在会被拒绝。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'noteId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'projectId',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'record_checkin',
      'kind': 'write',
      'entityType': 'HABIT_LOG',
      'description': '给一个习惯记一次打卡。不写日期就是今天；不写数值就是该习惯的目标数值（没目标就是 1，即"做过一次"）。同一天重复记不会多出第二条。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'habitId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'date',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'value',
          'type': 'number',
          'required': false,
        },
      ],
    },
    {
      'name': 'undo_checkin',
      'kind': 'write',
      'entityType': 'HABIT_LOG',
      'description': '撤销某个习惯某一天的打卡。不写日期就是今天。撤销是软删除、可逆；那天本来就没有打卡会被拒绝，不会凭空造出一条删除记录。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'habitId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'date',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'record_habit_checkins',
      'kind': 'write',
      'entityType': 'HABIT_LOG',
      'description': '给多个习惯一次性打卡。habitIds 是习惯 id 列表。不写日期就是今天；不写数值就用每个习惯各自的目标。任一习惯不存在则整批不打卡（先整批预检）。已打过的那天不会多出记录。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'habitIds',
          'type': 'array',
          'required': true,
        },
        {
          'name': 'date',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'value',
          'type': 'number',
          'required': false,
        },
      ],
    },
    {
      'name': 'log_focus',
      'kind': 'write',
      'entityType': 'FOCUS_SESSION',
      'description': '补记一段已经结束的专注：要写它是哪种（工作 / 短休息 / 长休息）、计划多少分钟、实际多少分钟。可以挂在一条任务上。开始或中止一个正在走的计时器不是这个工具能做的事。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'kind',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'plannedMinutes',
          'type': 'number',
          'required': true,
        },
        {
          'name': 'actualMinutes',
          'type': 'number',
          'required': false,
        },
        {
          'name': 'taskId',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'completed',
          'type': 'boolean',
          'required': false,
        },
      ],
    },
    {
      'name': 'create_reminder',
      'kind': 'write',
      'entityType': 'REMINDER',
      'description': '给一条任务加一条提醒。要么给绝对时刻（date + time，两者一起给），要么给"比截止时间早多少分钟"（minutesBeforeDue，此时任务必须有截止时间）。两种形态互斥。时刻不能在过去、也不能远于一年；一条任务超过界面上限会被拒绝而不是截着收下。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'date',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'time',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'minutesBeforeDue',
          'type': 'number',
          'required': false,
        },
      ],
    },
    {
      'name': 'update_reminder',
      'kind': 'write',
      'entityType': 'REMINDER',
      'description': '改一条已有提醒的触发时刻。给 date（YYYY-MM-DD）+ time（HH:MM，24小时制补零），与新建提醒同一口径（换算成毫秒由本机完成，不要自己算时间戳）；提醒不存在会被拒绝。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'reminderId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'date',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'time',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'delete_reminder',
      'kind': 'write',
      'entityType': 'REMINDER',
      'description': '把一条提醒删除到回收站。可撤销，不是彻底删除。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'reminderId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'create_event',
      'kind': 'write',
      'entityType': 'EVENT',
      'description': '新建一个倒数日/纪念日。日期是 `YYYY-MM-DD` 的**锚点日期**（倒数日没有“几点”）。可给类型档位（countdown / anniversary / birthday / festival 四档之一）、是否按农历每年重复、RRULE 重复规则、备注。写入只是提案：你在界面上确认之后才会真正保存。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'title',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'date',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'kind',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'isLunar',
          'type': 'boolean',
          'required': false,
        },
        {
          'name': 'recurrence',
          'type': 'string',
          'required': false,
        },
        {
          'name': 'notes',
          'type': 'string',
          'required': false,
        },
      ],
    },
    {
      'name': 'update_event',
      'kind': 'write',
      'entityType': 'EVENT',
      'description': '修改倒数日字段（标题、日期、类型档位、农历、重复规则、置顶、备注）。只能改显式给定的字段。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'eventId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'fields',
          'type': 'object',
          'required': true,
        },
      ],
    },
    {
      'name': 'delete_event',
      'kind': 'write',
      'entityType': 'EVENT',
      'description': '把一个倒数日/纪念日删除到回收站。可撤销，不是彻底删除。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'eventId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'restore_event',
      'kind': 'write',
      'entityType': 'EVENT',
      'description': '把回收站里的一个倒数日/纪念日恢复回来。它不在回收站会被拒绝。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'eventId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'archive_event',
      'kind': 'write',
      'entityType': 'EVENT',
      'description': '把一个倒数日/纪念日归档。归档后不再出现在列表里，可再取消归档。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'eventId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'rename_attachment',
      'kind': 'write',
      'entityType': 'ATTACHMENT',
      'description': '改一个附件的展示文件名（不重新上传、不改文件内容）。空文件名会被拒绝。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'attachmentId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'fileName',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'remove_attachment',
      'kind': 'write',
      'entityType': 'ATTACHMENT',
      'description': '把一个附件从任务上移除：软删除到回收站，并尽力释放服务端占用的字节。⚠️ 字节一旦释放就无法恢复，所以这一步实际不可逆——确认前请看清是哪一个附件。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'attachmentId',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'add_task_comment',
      'kind': 'write',
      'entityType': 'COMMENT',
      'description': '给一条**共享清单**里的任务加一条评论。评论只存在于共享清单：个人清单、或本宿主没有共享会话时，会被拒绝且不写任何东西。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'taskId',
          'type': 'string',
          'required': true,
        },
        {
          'name': 'body',
          'type': 'string',
          'required': true,
        },
      ],
    },
    {
      'name': 'delete_task_comment',
      'kind': 'write',
      'entityType': 'COMMENT',
      'description': '删除一条评论（软删除，可撤销）。评论只存在于共享清单；本宿主没有共享会话时会被拒绝。',
      'schemaRecorded': true,
      'args': [
        {
          'name': 'commentId',
          'type': 'string',
          'required': true,
        },
      ],
    },
  ],
  'protocolTypesWithoutModel': [
    'TASK_REPEAT_CFG',
  ],
  'systemEntityTypes': [
    'GLOBAL_CONFIG',
    'MIGRATION',
    'RECOVERY',
    'ALL',
  ],
  'nonEntityViews': [
    'QUADRANT',
    'TODAY',
    'CALENDAR',
    'SEARCH',
  ],
} as const satisfies AiCapabilityManifest;

/**
 * 给模型的那份文本投影 —— 与上面的结构化清单**同一次生成**产出，所以不可能对不上。
 * 接线它的位置是对话外壳（W12）拼 system prompt 的时候；它不是界面文案，不走 `t()`。
 */
export const AI_CAPABILITY_TEXT = [
  'heyta 能力清单（由工具目录与领域实体生成，不是手写的）',
  '覆盖口径：用户可操作的已物化实体 12 个，其中 11 个**读和写都有**工具（11/12）。',
  '',
  '🔴 拒绝时两件事必须分开说：我没有这个工具（AI 侧缺工具） ｜ 产品做不到（实体或功能不存在）。',
  '下面标了"没有工具"的实体，在产品里是**真实存在**的：可以说"我没有这个工具"，',
  '不可以说"产品不支持"。',
  '',
  '一、有 AI 工具的实体（11 个）',
  '- TASK —— 读和写都有（读 3 / 写 29）',
  '  · [读] list_tasks（projectId:string, completed:boolean, dueOn:string, dueFrom:string, dueTo:string, limit:number）',
  '  · [读] get_task（taskId*:string）',
  '  · [读] get_task_estimate_context（taskId*:string）',
  '  · [写] create_task（title*:string, dueDate:string, priority:string, projectId:string）',
  '  · [写] update_task（taskId*:string, fields*:object）',
  '  · [写] append_task_checklist（taskId*:string, items*:array）',
  '  · [写] complete_task（taskId:string, taskIds:array）',
  '  · [写] set_task_priorities（entries*:array）',
  '  · [写] set_task_estimate（taskId*:string, minutes*:number）',
  '  · [写] trash_task（taskId*:string）',
  '  · [写] restore_task（taskId*:string）',
  '  · [写] abandon_task（taskId*:string）',
  '  · [写] unabandon_task（taskId*:string）',
  '  · [写] move_task（taskId*:string, projectId:string）',
  '  · [写] uncomplete_task（taskId*:string）',
  '  · [写] set_task_parent（taskId*:string, parentId:string）',
  '  · [写] trash_tasks（taskIds*:array）',
  '  · [写] restore_tasks（taskIds*:array）',
  '  · [写] reorder_task（taskId*:string, order*:number）',
  '  · [写] create_subtask（parentId*:string, title*:string）',
  '  · [写] set_task_note（taskId*:string, note:string）',
  '  · [写] set_task_repeat（taskId*:string, rule:string）',
  '  · [写] set_task_important（taskId*:string, important*:boolean）',
  '  · [写] set_task_pinned（taskId*:string, pinned*:boolean）',
  '  · [写] move_tasks（taskIds*:array, projectId:string）',
  '  · [写] skip_task_occurrence（taskId*:string）',
  '  · [写] set_task_repeat_after_completion（taskId*:string, on*:boolean）',
  '  · [写] set_task_quadrant（taskId*:string, quadrant*:number）',
  '  · [写] postpone_task_to_today（taskId*:string）',
  '  · [写] set_task_checklist（taskId*:string, items*:array）',
  '  · [写] toggle_checklist_item（taskId*:string, itemText*:string, done*:boolean）',
  '  · [写] set_task_assignee（taskId*:string, assigneeUserId:string）',
  '- PROJECT —— 读和写都有（读 1 / 写 11）',
  '  · [读] list_projects（无参数）',
  '  · [写] create_project（name*:string, parentId:string）',
  '  · [写] rename_project（projectId*:string, name*:string）',
  '  · [写] archive_project（projectId*:string, archived:boolean）',
  '  · [写] delete_project（projectId*:string）',
  '  · [写] move_project（projectId*:string, parentId:string）',
  '  · [写] restore_project（projectId*:string）',
  '  · [写] set_project_color（projectId*:string, color:number）',
  '  · [写] set_project_icon（projectId*:string, icon:string）',
  '  · [写] set_project_view_mode（projectId*:string, viewMode:string）',
  '  · [写] set_project_kind（projectId*:string, kind:string）',
  '  · [写] set_project_show_in_smart_list（projectId*:string, showInSmartList*:boolean）',
  '- TAG —— 读和写都有（读 1 / 写 4）',
  '  · [读] list_tags（无参数）',
  '  · [写] create_tag（name*:string）',
  '  · [写] set_task_tags（taskId*:string, tagIds*:array）',
  '  · [写] rename_tag（tagId*:string, name*:string）',
  '  · [写] delete_tag（tagId*:string）',
  '- NOTE —— 读和写都有（读 2 / 写 5）',
  '  · [读] list_notes（limit:number）',
  '  · [读] get_note（noteId*:string）',
  '  · [写] create_note（content*:string, projectId:string, isPinnedToToday:boolean）',
  '  · [写] update_note（noteId*:string, content*:string）',
  '  · [写] delete_note（noteId*:string）',
  '  · [写] restore_note（noteId*:string）',
  '  · [写] move_note（noteId*:string, projectId:string）',
  '- HABIT —— 读和写都有（读 1 / 写 8）',
  '  · [读] list_habits（无参数）',
  '  · [写] create_habit（name*:string, target:number, unit:string, goalType:string）',
  '  · [写] rename_habit（habitId*:string, name*:string）',
  '  · [写] delete_habit（habitId*:string）',
  '  · [写] restore_habit（habitId*:string）',
  '  · [写] set_habit_color（habitId*:string, color:number）',
  '  · [写] set_habit_icon（habitId*:string, icon:string）',
  '  · [写] set_habit_goal（habitId*:string, target:number, unit:string, goalType:string）',
  '  · [写] set_habit_frequency（habitId*:string, frequency:object）',
  '- HABIT_LOG —— 读和写都有（读 1 / 写 3）',
  '  · [读] list_checkins（habitId:string, limit:number）',
  '  · [写] record_checkin（habitId*:string, date:string, value:number）',
  '  · [写] undo_checkin（habitId*:string, date:string）',
  '  · [写] record_habit_checkins（habitIds*:array, date:string, value:number）',
  '- FOCUS_SESSION —— 读和写都有（读 1 / 写 1）',
  '  · [读] list_focuses（limit:number）',
  '  · [写] log_focus（kind*:string, plannedMinutes*:number, actualMinutes:number, taskId:string, completed:boolean）',
  '- REMINDER —— 读和写都有（读 1 / 写 3）',
  '  · [读] list_reminders（taskId:string）',
  '  · [写] create_reminder（taskId*:string, date:string, time:string, minutesBeforeDue:number）',
  '  · [写] update_reminder（reminderId*:string, date*:string, time*:string）',
  '  · [写] delete_reminder（reminderId*:string）',
  '- EVENT —— 读和写都有（读 2 / 写 5）',
  '  · [读] list_events（limit:number）',
  '  · [读] get_event（eventId*:string）',
  '  · [写] create_event（title*:string, date*:string, kind:string, isLunar:boolean, recurrence:string, notes:string）',
  '  · [写] update_event（eventId*:string, fields*:object）',
  '  · [写] delete_event（eventId*:string）',
  '  · [写] restore_event（eventId*:string）',
  '  · [写] archive_event（eventId*:string）',
  '- COMMENT —— 读和写都有（读 1 / 写 2）',
  '  · [读] list_task_comments（taskId*:string, limit:number）',
  '  · [写] add_task_comment（taskId*:string, body*:string）',
  '  · [写] delete_task_comment（commentId*:string）',
  '- ATTACHMENT —— 读和写都有（读 1 / 写 2）',
  '  · [读] list_attachments（taskId*:string）',
  '  · [写] rename_attachment（attachmentId*:string, fileName*:string）',
  '  · [写] remove_attachment（attachmentId*:string）',
  '',
  '二、产品里有、但我没有任何工具的实体（1 个）—— 实体存在，只是我没配工具',
  '- CALENDAR_EVENT：产品支持它，但我没有任何工具 —— 别说产品做不到。',
  '',
  '三、不计入上面分母的已物化实体（设计如此，不是遗漏）',
  '- AI_FEEDBACK：AI 建议处置的落库载体（用户不直接创建它）',
  '- PREFERENCE_CORRECTION：偏好纠正的落库载体（用户不直接创建它）',
  '- ASSISTANT_TURN：助手对话的一行记录（ADR-0045 D-4 (ii)）：它是**对话本身**，不是用户可操作的业务实体，而且正文里含 provider 的回复 —— 给 AI 读写它的工具等于让模型改写自己的上下文',
  '',
  '四、同步协议认识、但没有领域模型的实体类型（算"动作"，不算"已物化实体"）',
  '- TASK_REPEAT_CFG：不要把它写成"有个实体没配工具"。',
  '',
  '五、视图不是实体（所以不在上面的清单里，但可以有工具）',
  '- QUADRANT / TODAY / CALENDAR / SEARCH 都是由已物化实体的字段派生的视图。',
  '- 同步基础设施实体（不属于产品功能）：GLOBAL_CONFIG / MIGRATION / RECOVERY / ALL。',
  '',
  '参数字段名带 `*` 的是必填。字段名照工具的 schema 原样搬，不要改写。',
].join('\n');
