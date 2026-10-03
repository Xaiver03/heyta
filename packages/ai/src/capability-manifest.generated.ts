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
    'PREFERENCE_CORRECTION' | 'REMINDER' | 'EVENT' | 'TASK_REPEAT_CFG' |
    'GLOBAL_CONFIG' | 'MIGRATION' | 'RECOVERY' | 'ALL';

/** 真的被 `packages/op-log` 物化了领域模型的实体类型。 */
export type AiCapabilityModeledEntityType =
  'TASK' | 'PROJECT' | 'TAG' | 'NOTE' |
    'HABIT' | 'HABIT_LOG' | 'FOCUS_SESSION' | 'AI_FEEDBACK' |
    'PREFERENCE_CORRECTION' | 'REMINDER' | 'EVENT';

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
    'covered': 9,
    'denominator': 9,
    'ratio': '9/9',
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
  ],
  'entityTypesWithoutTools': [] as const,
  'entities': [
    {
      'entityType': 'TASK',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'read-write',
      'readToolNames': [
        'list_tasks',
        'get_task',
      ],
      'writeToolNames': [
        'create_task',
        'update_task',
        'complete_task',
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
  '覆盖口径：用户可操作的已物化实体 9 个，其中 9 个**读和写都有**工具（9/9）。',
  '',
  '🔴 拒绝时两件事必须分开说：我没有这个工具（AI 侧缺工具） ｜ 产品做不到（实体或功能不存在）。',
  '下面标了"没有工具"的实体，在产品里是**真实存在**的：可以说"我没有这个工具"，',
  '不可以说"产品不支持"。',
  '',
  '一、有 AI 工具的实体（9 个）',
  '- TASK —— 读和写都有（读 2 / 写 3）',
  '  · [读] list_tasks（projectId:string, completed:boolean, dueOn:string, dueFrom:string, dueTo:string, limit:number）',
  '  · [读] get_task（taskId*:string）',
  '  · [写] create_task（title*:string, dueDate:string, priority:string, projectId:string）',
  '  · [写] update_task（taskId*:string, fields*:object）',
  '  · [写] complete_task（taskId:string, taskIds:array）',
  '- PROJECT —— 读和写都有（读 1 / 写 1）',
  '  · [读] list_projects（无参数）',
  '  · [写] create_project（name*:string, parentId:string）',
  '- TAG —— 读和写都有（读 1 / 写 2）',
  '  · [读] list_tags（无参数）',
  '  · [写] create_tag（name*:string）',
  '  · [写] set_task_tags（taskId*:string, tagIds*:array）',
  '- NOTE —— 读和写都有（读 2 / 写 2）',
  '  · [读] list_notes（limit:number）',
  '  · [读] get_note（noteId*:string）',
  '  · [写] create_note（content*:string, projectId:string, isPinnedToToday:boolean）',
  '  · [写] update_note（noteId*:string, content*:string）',
  '- HABIT —— 读和写都有（读 1 / 写 1）',
  '  · [读] list_habits（无参数）',
  '  · [写] create_habit（name*:string, target:number, unit:string, goalType:string）',
  '- HABIT_LOG —— 读和写都有（读 1 / 写 1）',
  '  · [读] list_checkins（habitId:string, limit:number）',
  '  · [写] record_checkin（habitId*:string, date:string, value:number）',
  '- FOCUS_SESSION —— 读和写都有（读 1 / 写 1）',
  '  · [读] list_focuses（limit:number）',
  '  · [写] log_focus（kind*:string, plannedMinutes*:number, actualMinutes:number, taskId:string, completed:boolean）',
  '- REMINDER —— 读和写都有（读 1 / 写 1）',
  '  · [读] list_reminders（taskId:string）',
  '  · [写] create_reminder（taskId*:string, date:string, time:string, minutesBeforeDue:number）',
  '- EVENT —— 读和写都有（读 2 / 写 2）',
  '  · [读] list_events（limit:number）',
  '  · [读] get_event（eventId*:string）',
  '  · [写] create_event（title*:string, date*:string, kind:string, isLunar:boolean, recurrence:string, notes:string）',
  '  · [写] update_event（eventId*:string, fields*:object）',
  '',
  '二、产品里有、但我没有任何工具的实体（0 个）—— 实体存在，只是我没配工具',
  '- （无）',
  '',
  '三、不计入上面分母的已物化实体（设计如此，不是遗漏）',
  '- AI_FEEDBACK：AI 建议处置的落库载体（用户不直接创建它）',
  '- PREFERENCE_CORRECTION：偏好纠正的落库载体（用户不直接创建它）',
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
