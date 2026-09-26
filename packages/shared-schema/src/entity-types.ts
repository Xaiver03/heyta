/**
 * heyta 实体类型清单。
 *
 * ⚠️ 本模块是**客户端与服务端共享的单一来源**。任何改动必须两端同时兼容。
 * 服务端会**拒绝未知实体类型**（见 `super-sync-server` 的 validation service）。
 *
 * 来源说明：本文件的**架构与注释风格**沿用自 Super Productivity 的
 * `packages/shared-schema/src/entity-types.ts`（MIT），但**实体清单是 heyta 自己设计的**，
 * 与上游的 21 项 SP 专属清单不同。见 `PROVENANCE.md`。
 */

/**
 * 有效的实体类型。未知类型会被服务端拒绝。
 *
 * 设计原则：
 * 1. **只列我们确定要长期持有的数据** —— 实体的增删都涉及两端协同，不是随手可改的。
 * 2. **视图不建实体** —— 四象限、今日视图、日历都由 TASK 的字段**派生**，
 *    不单独存实体（否则会出现"视图数据与任务数据不一致"这一类经典 bug）。
 * 3. **系统实体保留** —— GLOBAL_CONFIG / MIGRATION / RECOVERY / ALL 是同步协议的
 *    基础设施，不能删。
 */
export const ENTITY_TYPES = [
  // ── 任务核心 ──────────────────────────────────────────────
  'TASK',
  /** 清单（对应 TickTick 的"清单"，可嵌套文件夹） */
  'PROJECT',
  'TAG',
  'NOTE',
  /** 重复任务的 RRULE 配置（与 TASK 分开，便于独立同步与复用） */
  'TASK_REPEAT_CFG',
  'REMINDER',

  // ── 习惯打卡 ──────────────────────────────────────────────
  /**
   * 习惯定义（目标值 / 单位 / 频率 / 连续天数规则）。
   *
   * 注意：上游 Super Productivity **没有**这个实体 —— 它用 `SIMPLE_COUNTER`
   * （只有 type + countOnDay + streak 选项，**没有 goal/target/unit**）。
   * 滴答清单级别的习惯模块需要独立实体，因此这是 heyta 新增的设计。
   */
  'HABIT',
  /** 每日打卡记录（habitId + date + value + note） */
  'HABIT_LOG',

  // ── 专注 / 番茄钟 ─────────────────────────────────────────
  /** 单次专注会话（上游借用了通用的 METRIC，heyta 用专用实体） */
  'FOCUS_SESSION',

  // ── AI 反馈（heyta 新增）─────────────────────────────────
  /**
   * 用户对一次 AI 建议的处置（采用 / 修改后采用 / 拒绝）。
   *
   * 🔴 为什么必须是一个**实体**而不是本机设置：
   * 它是**用户行为**，是偏好推断（P6/P7）的唯一依据，必须跨设备同步。
   * 存本地的话，换台设备 AI 又要重新学一遍 —— 而"重新学"的那段时间里
   * 它的表现会和用户的预期不符。
   *
   * ⚠️ 这是**可加性**变更，不需要 bump `CURRENT_SCHEMA_VERSION`：
   * `applyOperation` 对未建模的 entityType 静默忽略，旧客户端只是看不到它
   * （见 ADR-0014 §3.2）。
   */
  'AI_FEEDBACK',
  /**
   * 用户对某条**推断偏好**的纠正（"这条不对，忘掉它"）。
   *
   * 🔴 为什么纠正必须是一个实体：
   * 偏好是**推断**出来的，而 op-log 里没有"用户认为这个推断是错的"这条事实 ——
   * 它**推不出来**，只能显式记录。不记的话，用户每次看到错的偏好都得再删一遍。
   *
   * ⚠️ 同样是**可加性**变更，不 bump `CURRENT_SCHEMA_VERSION`（ADR-0014 §3.2）。
   */
  'PREFERENCE_CORRECTION',

  // ── 系统（同步基础设施，不可删） ───────────────────────────
  'GLOBAL_CONFIG',
  'MIGRATION',
  'RECOVERY', // 灾难恢复导入
  'ALL', // 全量状态导入（同步、备份）
] as const;

/**
 * 实体类型 —— 标识操作作用于哪一类数据实体。
 * 从 ENTITY_TYPES 数组派生，保证单一来源。
 */
export type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * 运行时校验：给定字符串是否为合法实体类型。
 *
 * 服务端与客户端都应使用此函数做边界校验，而不是各自维护一份判断。
 */
export const isEntityType = (value: unknown): value is EntityType =>
  typeof value === 'string' && (ENTITY_TYPES as readonly string[]).includes(value);
