/**
 * 清单设置：图标的闭集词表 + 视图类型 / 清单类型的枚举与缺省
 * ==========================================================
 *
 * `Project` 的四个「清单级设置」里，`color`（分类色槽位）早就在
 * `activity-categories.ts`。剩下四个字段是**纯可加性**的（AGENTS.md §3.3：
 * 全部可选、不 bump `CURRENT_SCHEMA_VERSION`、无 DB 迁移）：
 *
 *   · `icon`            图标 id（**闭集 key**，见下）
 *   · `viewMode`        该清单默认用哪种视图（`list` / `board` / `calendar` / `timeline`）
 *   · `kind`            该清单默认展示什么（`tasks` / `notes`）
 *   · `showInSmartList` 是否在智能清单 / 汇总里出现
 *
 * ## 🔴 为什么 icon 是**闭集 key**，不存字形、不存自由 hex
 *
 * 与 `habit-icons.ts` 同一条纪律：磁盘上存的是**这个词**（`'briefcase'`），
 * 不是字形（Lucide 的 `Briefcase`），也不是颜色。理由：
 *
 *   · 存字形名 ⇒ 换图标库等于改用户数据；
 *   · 存自由 hex ⇒ 换主题/调色板时历史数据写死的是旧配色，在新主题下可能看不清，
 *     那是一次没法收场的迁移（分类色槽位就是这个结论的先例）。
 *
 * 闭集还有一层作用：它让「图标」这个字段**能被校验**。自由文本的话，每个壳
 * 都会遇到"这个字符串该画成什么"，而答案只能是"画不出来"。
 *
 * ## 为什么清单不直接复用 `HABIT_ICONS`
 *
 * 习惯图标是**活动主题**（水滴 / 书本 / 月亮），清单是**容器主题**（文件夹 /
 * 清单 / 公文包 / 目标）。硬塞会让"给清单挑图标"只能从一堆活动图案里选，
 * 而两边各自涨价（加一个习惯图标就凭空多一个清单图标）。两份闭集各自可校验、
 * 各自演进，代价只是两张小表 —— 这比"一张语义错位的表"便宜。
 *
 * 字形由各端自己的表映射（web 在 `apps/web/src/features/projects/project-glyphs.ts`），
 * 与 `HABIT_ICONS` 同一条分工：**共享层只说 key，画什么归各端**。
 */

/** 清单图标 key（闭集）。刻意都是**容器 / 组织**主题，不带褒贬。 */
export const PROJECT_ICONS = [
  'list',
  'check',
  'star',
  'flag',
  'book',
  'briefcase',
  'home',
  'heart',
  'folder',
  'lightbulb',
  'target',
  'calendar',
  'music',
  'gift',
  'coffee',
  'plane',
  'code',
  'pencil',
  'leaf',
  'sun',
  'moon',
  'cart',
  'camera',
  'users',
  'zap',
] as const;

export type ProjectIcon = (typeof PROJECT_ICONS)[number];

/**
 * 把持久化字段里的值读成图标 key。
 *
 * 🔴 不认识的值一律当作"没设过"（返回 `undefined`），不回退到第一项、也不抛错 ——
 * 与 `parseCategorySlot` / `parseHabitIcon` 同一条理由：磁盘上会有别的写入方
 * （更老的版本、别的壳、手改的数据），悄悄画成第一个图标会让一堆不相干的清单
 * 看起来是一类。
 */
export function parseProjectIcon(raw: unknown): ProjectIcon | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return PROJECT_ICONS.find((icon) => icon === trimmed);
}

/**
 * 清单的视图类型。
 *
 * 这四个是**展示方式**，不改变底层数据 —— 同一批任务在 list / board / calendar /
 * timeline 下是同一批任务，只是排布不同（与"视图不建实体"同一条原则）。
 */
export const PROJECT_VIEW_MODES = ['list', 'board', 'calendar', 'timeline'] as const;

export type ProjectViewMode = (typeof PROJECT_VIEW_MODES)[number];

/** 缺省视图 = `list`。读的时候用它，不要各端自己写 `?? 'list'`（那是第二份定义）。 */
export const DEFAULT_PROJECT_VIEW_MODE: ProjectViewMode = 'list';

/** 把持久化值读成视图类型；不认识 → `undefined`（调用方用缺省）。 */
export function parseProjectViewMode(raw: unknown): ProjectViewMode | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return PROJECT_VIEW_MODES.find((mode) => mode === trimmed);
}

/**
 * 清单类型：这条清单**默认展示什么**。
 *
 * 🔴 它**不是**"这条清单只能装什么"。独立便签仍然是 `NOTE` 实体、靠 `Note.projectId`
 * 归属（ADR 里 NOTE 是独立实体）。`kind` 只表达"打开这条清单时先看到任务还是便签"，
 * 不合并 NOTE、也不限制任务能不能放进来。缺省 `tasks`。
 */
export const PROJECT_KINDS = ['tasks', 'notes'] as const;

export type ProjectKind = (typeof PROJECT_KINDS)[number];

/** 缺省类型 = `tasks`。 */
export const DEFAULT_PROJECT_KIND: ProjectKind = 'tasks';

/** 把持久化值读成清单类型；不认识 → `undefined`（调用方用缺省）。 */
export function parseProjectKind(raw: unknown): ProjectKind | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return PROJECT_KINDS.find((kind) => kind === trimmed);
}

/**
 * 「是否在智能清单 / 汇总里出现」的缺省值。
 *
 * 缺省 `true`：一条新清单默认就该进汇总，用户要它别出现才显式关掉。
 */
export const DEFAULT_PROJECT_SHOW_IN_SMART_LIST = true;

/* ─────────────────────────────────────────────────────────────
 * 运行时缺省的**唯一出口**
 *
 * 🔴 读的时候不许各端自己写 `project.viewMode ?? 'list'` —— 那样"缺省是什么"
 *    会有第二份定义，改一次就要追所有调用点，而漏掉的那一处不报错、只是行为不同。
 * ───────────────────────────────────────────────────────────── */

/** 这条清单**实际**用哪种视图：设过就用，没设过用缺省。 */
export function projectViewModeOf(project: { viewMode?: string }): ProjectViewMode {
  return parseProjectViewMode(project.viewMode) ?? DEFAULT_PROJECT_VIEW_MODE;
}

/** 这条清单**实际**展示什么：设过就用，没设过用缺省。 */
export function projectKindOf(project: { kind?: string }): ProjectKind {
  return parseProjectKind(project.kind) ?? DEFAULT_PROJECT_KIND;
}

/** 这条清单**实际**是否进智能清单：设过就用，没设过用缺省 `true`。 */
export function projectShowInSmartListOf(project: { showInSmartList?: boolean }): boolean {
  return project.showInSmartList ?? DEFAULT_PROJECT_SHOW_IN_SMART_LIST;
}
