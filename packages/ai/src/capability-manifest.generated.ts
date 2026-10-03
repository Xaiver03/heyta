/**
 * heyta 的**产品级 AI 能力清单** —— **自动生成，请勿手改**。
 *
 * 唯一事实源：`packages/local-api/src/tools.ts`（工具目录）+ `packages/local-api/src/mcp.ts`
 * （参数 schema）+ `packages/domain` 的 `MODELED_ENTITY_TYPES` + `packages/shared-schema`
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
  /** `false` = `mcp.ts` 的 `INPUT_SCHEMAS` 里没有这个工具 —— `args` 可能**不完整**。 */
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
    'covered': 3,
    'denominator': 9,
    'ratio': '3/9',
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
  'entityTypesWithoutTools': [
    'TAG',
    'NOTE',
    'HABIT',
    'HABIT_LOG',
    'FOCUS_SESSION',
    'REMINDER',
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
      'coverage': 'read-only',
      'readToolNames': [
        'list_projects',
      ],
      'writeToolNames': [] as const,
    },
    {
      'entityType': 'TAG',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'none',
      'readToolNames': [] as const,
      'writeToolNames': [] as const,
    },
    {
      'entityType': 'NOTE',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'none',
      'readToolNames': [] as const,
      'writeToolNames': [] as const,
    },
    {
      'entityType': 'HABIT',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'none',
      'readToolNames': [] as const,
      'writeToolNames': [] as const,
    },
    {
      'entityType': 'HABIT_LOG',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'none',
      'readToolNames': [] as const,
      'writeToolNames': [] as const,
    },
    {
      'entityType': 'FOCUS_SESSION',
      'materialized': true,
      'countsTowardCoverage': true,
      'coverage': 'none',
      'readToolNames': [] as const,
      'writeToolNames': [] as const,
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
      'coverage': 'none',
      'readToolNames': [] as const,
      'writeToolNames': [] as const,
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
      'name': 'create_task',
      'kind': 'write',
      'entityType': 'TASK',
      'description': '新建一个任务。必须走 heyta 的正常写入路径（op-log）。',
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
      'description': '把任务标记为完成。',
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
      'name': 'create_event',
      'kind': 'write',
      'entityType': 'EVENT',
      'description': '新建一个倒数日/纪念日。日期是 `YYYY-MM-DD` 的**锚点日期**（倒数日没有"几点"）。可给类型档位（countdown / anniversary / birthday / festival 四档之一）、是否按农历每年重复、RRULE 重复规则、备注。必须走 heyta 的正常写入路径（op-log）。',
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
  '覆盖口径：用户可操作的已物化实体 9 个，其中 3 个有 AI 工具（3/9）。',
  '',
  '🔴 拒绝时两件事必须分开说：我没有这个工具（AI 侧缺工具） ｜ 产品做不到（实体或功能不存在）。',
  '下面标了"没有工具"的实体，在产品里是**真实存在**的：可以说"我没有这个工具"，',
  '不可以说"产品不支持"。',
  '',
  '一、有 AI 工具的实体（3 个）',
  '- TASK —— 读和写都有（读 2 / 写 3）',
  '  · [读] list_tasks（projectId:string, completed:boolean, dueOn:string, dueFrom:string, dueTo:string, limit:number）',
  '  · [读] get_task（taskId*:string）',
  '  · [写] create_task（title*:string, dueDate:string, priority:string, projectId:string）',
  '  · [写] update_task（taskId*:string, fields*:object）',
  '  · [写] complete_task（taskId*:string）',
  '- PROJECT —— 只有读（读 1 / 写 0）',
  '  · [读] list_projects（无参数）',
  '- EVENT —— 读和写都有（读 2 / 写 2）',
  '  · [读] list_events（limit:number）',
  '  · [读] get_event（eventId*:string）',
  '  · [写] create_event（title*:string, date*:string, kind:string, isLunar:boolean, recurrence:string, notes:string）',
  '  · [写] update_event（eventId*:string, fields*:object）',
  '',
  '二、产品里有、但我没有任何工具的实体（6 个）—— 实体存在，只是我没配工具',
  '- TAG：产品支持它，但我没有任何工具 —— 别说产品做不到。',
  '- NOTE：产品支持它，但我没有任何工具 —— 别说产品做不到。',
  '- HABIT：产品支持它，但我没有任何工具 —— 别说产品做不到。',
  '- HABIT_LOG：产品支持它，但我没有任何工具 —— 别说产品做不到。',
  '- FOCUS_SESSION：产品支持它，但我没有任何工具 —— 别说产品做不到。',
  '- REMINDER：产品支持它，但我没有任何工具 —— 别说产品做不到。',
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
