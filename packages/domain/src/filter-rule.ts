/**
 * 保存的筛选（`FILTER`）的**规则编译器** —— 规则 → predicate 的唯一实现
 * ==================================================================
 *
 * 这份文件的形状由 [ADR-0092](../../../docs/adr/0092-saved-filters.md) §3.5/§3.6 定：
 *
 * 1. **规则是结构化判别联合 JSON，不是 DSL 字符串**（ADR §2.2）。
 *    每条 `FilterRuleCondition` 都带一个 `kind` 标签，加一个分支 ⇒ 这里的所有 `switch`
 *    在编译期被检查；而字符串 DSL 要每端各写一份解析器，漂了就是"同一条筛选两端
 *    筛出不同任务且都不报错"（ADR-0048 §1 点名的失效形状）。
 *
 * 2. **语义复用 `task-filter.ts`，不另写第二份"今天/逾期/标签"定义**（ADR §3.5）。
 *    这里只 `import` 那些既有件：`dueLocalDate` / `isCompleted` / `visibleTasks` /
 *    `NEXT_SEVEN_DAYS`，以及 `tags.ts` 的 `resolveTagIds`。本文件**不重算**任何
 *    日期边界或标签别名 —— 那些定义只有一处。
 *
 * 3. 🔴 **未知 `kind` 必须显式降级**（ADR §3.6）。老客户端读到一条含它不认识的
 *    `kind` 的 `FILTER` 时，`compileFilterRule()` 返回 `ok: false`，**绝不**静默丢掉
 *    未知条件继续按剩余条件筛。静默丢条件会让"同一筛选在新旧两端筛出不同任务且都
 *    不报错" —— 那正是 ADR-0048 §1 那类缺陷。界面据此标"此版本的 App 打不开这个筛选"。
 *
 * ## 基础集合：`visibleTasks`
 *
 * 读路径是 `visibleTasks(tasks)` → predicate（ADR §3.5）。所以**已删除**与**已放弃**的
 * 任务永远不进结果 —— 这与每一条内置视图的纪律一致（ADR-0048 的 I5：隐藏由层负责，
 * 不由调用点负责）。
 *
 * ⚠️ **由此 `status` 条件只有 `open` / `completed` 两档**：基础集合已经把"已放弃"
 * 滤掉了，再给一个 `abandoned` 分支只会是一条永远为假的死条件（它需要基础集合包含
 * 放弃态才可能命中），而那正是"两个分支看起来都在、其中一个从不生效"的形状。
 * 要读放弃态请走别的出口（回收站 / 已放弃视图），不要假装一条保存筛选能筛到它。
 *
 * ## 不排序
 *
 * 本文件**不排序**：顺序是跨端一致的规范顺序，由 `packages/app-host` 定
 * （与 `filterTasks` 同一条纪律，见 `task-filter.ts` 文件头第 2 条）。
 */

import { addDays, toLocalDate, type LocalDate } from './date.js';
import { Priority, type Task } from './entities.js';
import {
  NEXT_SEVEN_DAYS,
  dueLocalDate,
  isCompleted,
  visibleTasks,
  type FilterContext,
} from './task-filter.js';
import { resolveTagIds } from './tags.js';

/**
 * 一条筛选条件。**判别联合，不是 `{ field, op, value }` 那种宽形状。**
 *
 * 🔴 宽形状会让"忘了处理新 kind"表现为**运行时静默返回空列表** —— 这条理由与
 * `task-filter.ts` 的 `TaskFilter` 注释逐字一致，也是本文件 `compileFilterRule`
 * 里 `default` 分支必须显式报错的原因。
 */
export type FilterRuleCondition =
  /** 恒真。UI 新建一条筛选时的初始空条件（"不额外限制"）。 */
  | { readonly kind: 'all' }
  /** 截止日 = 今天（本地日历日，与内置「今天」同一个判据）。 */
  | { readonly kind: 'today' }
  /** 截止日 = 明天。 */
  | { readonly kind: 'tomorrow' }
  /** 截止日落在 [今天, 今天 + (NEXT_SEVEN_DAYS - 1)]（含两端，与内置「最近 7 天」同窗口）。 */
  | { readonly kind: 'next7Days' }
  /** 属于这些清单之一（等值判据，与 `filterTasks({kind:'project'})` 同一条）。 */
  | { readonly kind: 'project'; readonly projectIds: readonly string[] }
  /** 含这些标签之一（走 `resolveTagIds` 解合并别名，与内置 `tag` 分支同一条）。 */
  | { readonly kind: 'tag'; readonly tagIds: readonly string[] }
  /** 优先级属于给定集合之一。 */
  | { readonly kind: 'priority'; readonly values: readonly Priority[] }
  /**
   * 截止日范围。各字段都可选，**同时给出的字段取交集**；`hasNone: true` 表示
   * "没有截止时间"。语义按 `LocalDate` 日历日（**不是**毫秒滑窗，ADR §7.2）。
   */
  | {
      readonly kind: 'due';
      /** 从今天起含今天在内的窗口天数（>= 1）。 */
      readonly withinDays?: number;
      /** 下界（含）：`due >= after`。 */
      readonly after?: LocalDate;
      /** 上界（含）：`due <= before`。 */
      readonly before?: LocalDate;
      /** 只要没有截止时间的任务。 */
      readonly hasNone?: boolean;
    }
  /**
   * 完成状态。`open` = 未完成，`completed` = 已完成。
   * （`abandoned` 刻意不在这一档 —— 见文件头"基础集合"那段。）
   */
  | { readonly kind: 'status'; readonly value: 'open' | 'completed' }
  /** 标题或备注含关键词（大小写不敏感）。 */
  | { readonly kind: 'keyword'; readonly contains: string };

/** 组合方式：`all` = 全部条件都满足，`any` = 任一条件满足。 */
export type FilterMatch = 'all' | 'any';

/** 一条保存筛选的规则。 */
export interface FilterRule {
  readonly match: FilterMatch;
  readonly conditions: readonly FilterRuleCondition[];
}

/**
 * 一条条件在**这个构建版本**里认不认识。
 *
 * 单独导出的理由：读侧要在**不编译**的情况下回答"这条筛选能不能打开"
 * （界面上的"此版本的 App 打不开这个筛选"），而编译一个 predicate 只为拿
 * `ok: false` 是浪费。两处共用同一份判定 —— 不要各自写一个 `kind` 白名单。
 */
export const KNOWN_FILTER_CONDITION_KINDS = [
  'all',
  'today',
  'tomorrow',
  'next7Days',
  'project',
  'tag',
  'priority',
  'due',
  'status',
  'keyword',
] as const;

export type KnownFilterConditionKind = (typeof KNOWN_FILTER_CONDITION_KINDS)[number];

function isKnownKind(kind: string): kind is KnownFilterConditionKind {
  return (KNOWN_FILTER_CONDITION_KINDS as readonly string[]).includes(kind);
}

/** 这条规则里**这个版本不认识**的 `kind`（去重、保序）。空数组 = 全认识。 */
export function filterRuleUnknownKinds(rule: FilterRule): string[] {
  const unknown: string[] = [];
  for (const condition of rule.conditions) {
    const kind = (condition as { kind?: unknown }).kind;
    if (typeof kind !== 'string' || !isKnownKind(kind)) {
      const label = typeof kind === 'string' ? kind : '<无 kind>';
      if (!unknown.includes(label)) unknown.push(label);
    }
  }
  return unknown;
}

/** 读侧判据：这条规则能否被当前版本完整执行。 */
export type FilterRuleSupport =
  | { readonly supported: true }
  | { readonly supported: false; readonly unknownKinds: readonly string[] };

export function filterRuleSupport(rule: FilterRule): FilterRuleSupport {
  const unknown = filterRuleUnknownKinds(rule);
  return unknown.length === 0 ? { supported: true } : { supported: false, unknownKinds: unknown };
}

/** 编译器产出的 predicate。`ctx` 每次求值时显式传入（内含 `now` / 标签登记表）。 */
export type FilterPredicate = (task: Task, ctx: FilterContext) => boolean;

/** 编译结果。`ok: false` 是**跨版本降级信号**，不是"筛出空列表"。 */
export type CompiledFilterRule =
  | { readonly ok: true; readonly predicate: FilterPredicate }
  | {
      readonly ok: false;
      readonly reason: 'unsupported-kind';
      readonly unknownKinds: readonly string[];
    };

/** 一条条件的 predicate。`switch` 没有 `default` 兜底 —— 未知分支由调用方统一处理。 */
function compileCondition(condition: FilterRuleCondition): FilterPredicate {
  switch (condition.kind) {
    case 'all':
      return () => true;
    case 'today':
      return (task, ctx) => dueLocalDate(task) === toLocalDate(ctx.now);
    case 'tomorrow':
      return (task, ctx) => dueLocalDate(task) === addDays(toLocalDate(ctx.now), 1);
    case 'next7Days':
      return (task, ctx) => {
        const first = toLocalDate(ctx.now);
        const last = addDays(first, NEXT_SEVEN_DAYS - 1);
        const due = dueLocalDate(task);
        return due !== undefined && due >= first && due <= last;
      };
    case 'project': {
      const wanted = new Set(condition.projectIds);
      return (task) => task.projectId !== undefined && wanted.has(task.projectId);
    }
    case 'tag': {
      const wanted = new Set(condition.tagIds);
      return (task, ctx) => {
        // 🔴 走 `resolveTagIds` 而不是 `task.tagIds.includes`：合并只写一行
        // `Tag.mergedInto`，不重写任务的 tagIds —— 直接 includes 会漏掉别名
        // （与 `task-filter.ts` 的 `case 'tag'` 同一条理由）。
        // `ctx.tags` 缺席时退化成按 id 精确匹配（那是老调用方今天的行为）。
        const effective =
          ctx.tags === undefined ? (task.tagIds ?? []) : resolveTagIds(task.tagIds, ctx.tags);
        return effective.some((id) => wanted.has(id));
      };
    }
    case 'priority': {
      const wanted = new Set<number>(condition.values);
      return (task) => wanted.has(task.priority ?? Priority.None);
    }
    case 'due':
      return (task, ctx) => {
        const due = dueLocalDate(task);
        if (condition.hasNone === true) return due === undefined;
        if (due === undefined) return false;
        if (condition.after !== undefined && due < condition.after) return false;
        if (condition.before !== undefined && due > condition.before) return false;
        if (condition.withinDays !== undefined) {
          const first = toLocalDate(ctx.now);
          const last = addDays(first, condition.withinDays - 1);
          return due >= first && due <= last;
        }
        return true;
      };
    case 'status': {
      const value = condition.value;
      return (task) => (value === 'completed' ? isCompleted(task) : !isCompleted(task));
    }
    case 'keyword': {
      const needle = condition.contains.trim().toLowerCase();
      if (needle === '') return () => true;
      return (task) => {
        const title = task.title.toLowerCase();
        const note = (task.note ?? '').toLowerCase();
        return title.includes(needle) || note.includes(needle);
      };
    }
  }
}

/**
 * 把规则编译成 predicate。**未知 `kind` ⇒ `ok: false`**（ADR §3.6）。
 *
 * 调用方拿到 `ok: false` 时必须把该筛选标成"此版本打不开"，而不是拿一个空 predicate
 * 继续筛 —— 那会把"我不认识这条规则"伪装成"这条规则筛不出东西"。
 */
export function compileFilterRule(rule: FilterRule): CompiledFilterRule {
  const unknownKinds = filterRuleUnknownKinds(rule);
  if (unknownKinds.length > 0) {
    return { ok: false, reason: 'unsupported-kind', unknownKinds };
  }

  // 判据已保证每条都是已知 kind ⇒ 这里的强转不会掩盖未知分支（未知在上面就返回了）。
  const predicates = rule.conditions.map((condition) => compileCondition(condition));
  const match = rule.match;

  const predicate: FilterPredicate = (task, ctx) => {
    if (predicates.length === 0) {
      // 空条件集：`all` 恒真（"不额外限制"），`any` 恒假（"没有任何一条能命中"）。
      return match === 'all';
    }
    return match === 'all'
      ? predicates.every((p) => p(task, ctx))
      : predicates.some((p) => p(task, ctx));
  };

  return { ok: true, predicate };
}

/**
 * 读路径的**唯一入口**：`visibleTasks(tasks)` 之后套 predicate。
 *
 * 返回 `undefined` = 这条规则当前版本打不开（未知 kind），**不是"筛出 0 条"**。
 * 界面据此把该筛选画成"打不开"，而不是画成一个空列表。
 */
export function applyFilterRule(
  tasks: readonly Task[],
  rule: FilterRule,
  ctx: FilterContext,
): Task[] | undefined {
  const compiled = compileFilterRule(rule);
  if (!compiled.ok) return undefined;
  return visibleTasks(tasks).filter((task) => compiled.predicate(task, ctx));
}

// ─────────────────────────────────────────────────────────────────────────
// 写侧校验：把"存得进去"与"读得出来"钉在一起
// ─────────────────────────────────────────────────────────────────────────

/** 筛选名长度上限。名字是用户起的，与清单名同档，不设成"任意长"。 */
export const FILTER_NAME_MAX_LENGTH = 80;

/** 一条规则最多几条条件 —— 与"一次确认的认知负荷"同一条纪律，不设成无限。 */
export const FILTER_MAX_CONDITIONS = 20;

/** 关键词条件的最长匹配串。 */
export const FILTER_KEYWORD_MAX_LENGTH = 100;

/** 写侧拒绝码（闭合词表；界面 / 工具层自己翻译成句子）。 */
export type FilterRuleRejection =
  | 'not-an-object'
  | 'bad-match'
  | 'conditions-not-array'
  | 'too-many-conditions'
  | 'unknown-kind'
  | 'malformed-condition'
  | 'keyword-too-long';

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim() !== '')
  );
}

function isPriorityValue(value: unknown): value is Priority {
  return (
    typeof value === 'number' &&
    (Object.values(Priority) as unknown[]).includes(value)
  );
}

function isLocalDateLike(value: unknown): value is LocalDate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** 单条条件的结构校验。`undefined` = 合法。 */
function conditionRejection(value: unknown): FilterRuleRejection | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'malformed-condition';
  }
  const record = value as Record<string, unknown>;
  const kind = record['kind'];
  if (typeof kind !== 'string' || !isKnownKind(kind)) return 'unknown-kind';

  switch (kind) {
    case 'all':
    case 'today':
    case 'tomorrow':
    case 'next7Days':
      return undefined;
    case 'project':
      return isNonEmptyStringArray(record['projectIds']) ? undefined : 'malformed-condition';
    case 'tag':
      return isNonEmptyStringArray(record['tagIds']) ? undefined : 'malformed-condition';
    case 'priority': {
      const values = record['values'];
      return Array.isArray(values) && values.length > 0 && values.every(isPriorityValue)
        ? undefined
        : 'malformed-condition';
    }
    case 'due': {
      const withinDays = record['withinDays'];
      const after = record['after'];
      const before = record['before'];
      const hasNone = record['hasNone'];
      if (withinDays !== undefined && (!Number.isInteger(withinDays) || (withinDays as number) < 1)) {
        return 'malformed-condition';
      }
      if (after !== undefined && !isLocalDateLike(after)) return 'malformed-condition';
      if (before !== undefined && !isLocalDateLike(before)) return 'malformed-condition';
      if (hasNone !== undefined && typeof hasNone !== 'boolean') return 'malformed-condition';
      if (
        withinDays === undefined &&
        after === undefined &&
        before === undefined &&
        hasNone !== true
      ) {
        // 一条什么都不限制的 due 条件是"看起来在筛、其实没筛"——拒绝比静默放行安全。
        return 'malformed-condition';
      }
      return undefined;
    }
    case 'status': {
      const value = record['value'];
      return value === 'open' || value === 'completed' ? undefined : 'malformed-condition';
    }
    case 'keyword': {
      const contains = record['contains'];
      if (typeof contains !== 'string' || contains.trim() === '') return 'malformed-condition';
      return contains.length > FILTER_KEYWORD_MAX_LENGTH ? 'keyword-too-long' : undefined;
    }
  }
}

/**
 * 校验一条规则的**落库形状**。`undefined` = 合法。
 *
 * 🔴 写侧必须拒绝本版本不认识的 `kind`：本版本的界面/工具造不出来，能到这里的
 * 未知 kind 只可能是"另一个更新的版本写的" —— 让它落库等于本机永远打不开它。
 * 跨版本**读**的降级是 `compileFilterRule` 的职责，不是这里的。
 */
export function filterRuleRejection(value: unknown): FilterRuleRejection | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'not-an-object';
  const record = value as Record<string, unknown>;
  const match = record['match'];
  if (match !== 'all' && match !== 'any') return 'bad-match';
  const conditions = record['conditions'];
  if (!Array.isArray(conditions)) return 'conditions-not-array';
  if (conditions.length > FILTER_MAX_CONDITIONS) return 'too-many-conditions';
  for (const condition of conditions) {
    const rejection = conditionRejection(condition);
    if (rejection !== undefined) return rejection;
  }
  return undefined;
}

/** 校验通过后把规则**窄化**成领域类型；不通过返回 `undefined`。 */
export function parseFilterRule(value: unknown): FilterRule | undefined {
  return filterRuleRejection(value) === undefined ? (value as FilterRule) : undefined;
}

/** 筛选名的写侧拒绝码。 */
export type FilterNameRejection = 'empty' | 'too-long';

export function filterNameRejection(name: string): FilterNameRejection | undefined {
  const trimmed = name.trim();
  if (trimmed === '') return 'empty';
  if (trimmed.length > FILTER_NAME_MAX_LENGTH) return 'too-long';
  return undefined;
}

/**
 * 活着的筛选（未软删、未彻底删除），**规范顺序**：`order` 升序，缺 `order` 的排在
 * 有 `order` 的后面，同 `order` 按名字、再按 id（确定性打破平局）。
 *
 * 与 `sortNotesForDisplay` 同一条纪律：顺序只在领域层算一次，动作层与界面都调它。
 */
export function aliveFilters<T extends { deletedAt?: number; purgedAt?: number; order?: number; name: string; id: string }>(
  filters: readonly T[],
): T[] {
  return filters
    .filter((filter) => filter.deletedAt === undefined && filter.purgedAt === undefined)
    .sort(compareFiltersForDisplay);
}

export function compareFiltersForDisplay(
  a: { order?: number; name: string; id: string },
  b: { order?: number; name: string; id: string },
): number {
  const aOrder = a.order ?? Number.MAX_SAFE_INTEGER;
  const bOrder = b.order ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder < bOrder ? -1 : 1;
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
