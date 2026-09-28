/**
 * 小组件快照契约。
 *
 * ## 为什么这个文件是整个小组件工作的中心
 *
 * 小组件的 UI **不可移植** —— iOS 是 SwiftUI/WidgetKit、Android 是 Glance/RemoteViews、
 * 鸿蒙是 ArkTS 卡片、Windows 是 Adaptive Card JSON。四端要各写一遍 UI，
 * 所以**唯一能防止它们漂移的就是这份契约**：四端解析**同一个** golden fixture，
 * 任何一端理解错了都会在它自己的测试里红。
 *
 * ## 两层结构（这是本契约最重要的设计）
 *
 * ```
 * ┌─ 明文信封（cleartext envelope）───────────────────────┐
 * │ v / dayStr / validUntil / alg / nonce / ciphertext   │  ← 原生**不解密**就能读
 * └──────────────────────────────────────────────────────┘
 *                          │ 用设备密钥解密（各端一次 AES-GCM）
 *                          ▼
 * ┌─ 明文载荷（payload）──────────────────────────────────┐
 * │ today / quadrant / habits / focus / projectColors    │  ← 只有这里含用户内容
 * └──────────────────────────────────────────────────────┘
 * ```
 *
 * **为什么信封是明文的**：原生要在**拿不到密钥**的情况下也能判断"这份快照过期了"，
 * 例如设备刚重启、或用户还没解锁。`dayStr` 与 `validUntil` 不含任何用户内容 ——
 * 它们只暴露"应用在某天算过一次今天"，这一点泄露可以接受；
 * 而任务标题不是。
 *
 * ## 🔴 三条不可违反的规则
 *
 * 1. **未知 `v` 必须 fail closed 到空列表**，**绝不猜测**。
 *    旧组件读到新契约时唯一安全的行为是假装没有数据 —— 猜字段的后果是
 *    把错误的数据画在用户桌面上，而用户没有理由怀疑它。
 * 2. **`projectId` 缺失时必须"省略键"，绝不能写 `null`。**
 *    上游 Super Productivity 踩过这个：Android 的 `org.json` 里
 *    `optString("projectId")` 会把 JSON `null` 读成**字符串 `"null"`**，
 *    于是组件去找一个叫 "null" 的清单颜色，静默取到错误颜色。
 *    本文件把这个坑变成**校验失败**，而不是让它悄悄过去。
 * 3. **任务数上限 20。** 与上游一致；截断由**应用侧**做（写入快照时），
 *    不在这里做 —— 校验器只负责拒绝，不负责修补。
 *
 * ## 本包为什么零运行时依赖
 *
 * 与 `@heyta/ai` / `@heyta/local-api` 同一档纪律。理由不是洁癖：
 * 这份契约的类型要能被**最小化程度最高**的消费方使用 —— 将来若真把
 * 快照逻辑塞进一个受限运行时的组件包里，多一个依赖就是多一个放不进去的东西。
 * 而且**原生四端本来就用不了 TS 的校验器**，它们真正的锁是 golden fixture，
 * 不是 zod。所以手写校验器在这里是更好的取舍。
 */

/** 当前契约版本。**改这个值必须同时更新四端的解析器与 golden fixture。** */
export const WIDGET_CONTRACT_VERSION = 1;

/**
 * 信封允许的算法标识。
 *
 * 🔴 **只列 AES-GCM-256**，且**故意不提供"无加密"这一档**。
 * 如果将来有人想加明文模式，他会不得不来这里加一个 `'none'` ——
 * 那时这个决定会被看见，而不是被悄悄实现（见 D1 决策与待写的 ADR）。
 */
export const WIDGET_ALG = 'AES-GCM-256';

/** 任务数上限（上游同值）。截断**由应用侧**做，这里只拒绝超限。 */
export const WIDGET_MAX_TASKS = 20;

/**
 * `validUntil` 的上界 = JS `Date` 能表示的最大时刻（`8.64e15` ms）。
 *
 * 存在的理由见 `parseEnvelope` 里的范围检查：它是**跨端 AAD 字符串一致性**的护栏，
 * 不是数据类型洁癖。
 */
export const MAX_EPOCH_MS = 8_640_000_000_000_000;

// ─────────────────────────────────────────────────────────────
// 明文信封
// ─────────────────────────────────────────────────────────────

export interface WidgetEnvelope {
  /** 契约版本。未知值 → fail closed。 */
  v: number;
  /**
   * 应用算出的"今天"（`YYYY-MM-DD`）。
   *
   * 🔴 **原生绝不自己推导今天** —— 它只判 `now >= validUntil`。
   * 为什么：时区、跨日切点、用户的"今天从几点开始"都是**产品规则**，
   * 让四个平台各自实现一遍，必然出现"iOS 认为还是今天、Android 认为已经是明天"。
   */
  dayStr: string;
  /** 快照失效时刻（epoch ms）。原生只比较 `now >= validUntil`。 */
  validUntil: number;
  /** 算法标识，见 `WIDGET_ALG`。 */
  alg: string;
  /** AES-GCM 的 12 字节 nonce，**标准 base64**。 */
  nonce: string;
  /** 加密后的 `WidgetPayload` JSON（UTF-8），**标准 base64**。 */
  ciphertext: string;
}

export type EnvelopeRejection =
  | 'not-an-object'
  | 'unknown-version'
  | 'unsupported-alg'
  | 'malformed-envelope';

export type EnvelopeParseResult =
  | { ok: true; envelope: WidgetEnvelope }
  | { ok: false; reason: EnvelopeRejection; detail: string };

// ─────────────────────────────────────────────────────────────
// 明文载荷
// ─────────────────────────────────────────────────────────────

export interface WidgetTask {
  id: string;
  title: string;
  isDone: boolean;
  /** 🔴 缺失时**省略键**，绝不写 `null`（见文件头规则 2）。 */
  projectId?: string;
  /** 四象限槽位（派生视图，ADR-0015）。`1..4`；缺省表示未分类。 */
  quadrant?: number;
}

export interface WidgetHabit {
  id: string;
  title: string;
  /** 今天是否已打卡。 */
  doneToday: boolean;
  /** 当前连续天数。 */
  streak: number;
}

export interface WidgetFocus {
  /** 是否正在专注中。 */
  active: boolean;
  /** 剩余秒数。`active` 为 false 时不应存在。 */
  remainingSeconds?: number;
  /** 本轮目标秒数。 */
  targetSeconds?: number;
  /** 本轮标题（可为空 —— 用户常常不填）。 */
  sessionTitle?: string;
  /**
   * 🔴 **本轮专注的绝对结束时刻**（Unix 毫秒）。**这是灵动岛 / Live Activity 的前提条件。**
   *
   * ## 为什么必须有它，而 `remainingSeconds` 不够
   *
   * `remainingSeconds` 是**发布那一刻**算出来的**相对**值 —— 它没有锚点。
   * 用它画倒计时，卡片在 09:00 显示"剩余 25:00"，09:10 还是"剩余 25:00"，
   * 而且**错得没有症状**：它看起来是对的。这是本仓库一贯那条
   * 「宁可少显示一个数字，也不显示一个错的数字」的来源，
   * 也是四端"专注卡片不画倒计时"的唯一理由。
   *
   * **Live Activity 是唯一一个例外**，因为它是**系统按时间轴驱动**的
   * （`Text(timerInterval:)` / `ProgressView(timerInterval:)`），
   * 不是静态快照 —— 它每秒自己算，所以它需要一个**绝对**时刻。
   *
   * ## 为什么是可选的
   *
   * 可选 = **向后兼容**。旧版本的发布方不写这个字段，
   * 四端解析器都接受（`endsAt` 缺省时 `active` 仍然为真，
   * 只是灵动岛**不启动**），所以这是**加字段**而不是**改契约版本**。
   * 把 `WIDGET_CONTRACT_VERSION` 从 1 抬到 2 会让**已发布的旧组件**
   * 整片变成占位态（`unknown-version` 是 fail closed）——
   * 为一个可选字段付这个代价是不划算的。
   *
   * ⚠️ 与 `projectId` 同一条纪律：**缺省是可以的，`null` 必须拒绝**。
   */
  endsAt?: number;
}

/**
 * 一个清单的**已解析**颜色。
 *
 * ## 🔴 为什么是"已解析的两个十六进制"，而不是 token 名或槽位号
 *
 * | 事实 | 证据 |
 * |---|---|
 * | 类别色的**真源**在 `tokens.json`（`color.category-1..8`，191 项之列） | 实测 `tokensForTheme('light')['color.category-1'] === '#991b1b'` |
 * | 生成的原生 token 文件**确实带了**这 8 个色，明暗各一套 | `grep -ci category HeytaTokens.swift` = **16**（`Light.colorCategory1..8` + `Dark.colorCategory1..8`） |
 * | 浅色与深色是**明显不同的两套值** | `#991b1b`（浅） vs `#f87171`（深） |
 * | `Project.color` 存的是**槽位号字符串**（`"3"`），不是色值 | `app-host/src/project-actions.ts` 的 `setProjectColor` |
 *
 * ⚠️ **本表在 2026-09-27 更正过一次。** 原文写着"生成的原生 token 文件里一个类别色都没有，
 * `grep -c category HeytaTokens.swift` = 0，所以原生无法解析" —— **那是错的**。
 * `grep -c` 是**大小写敏感**的，而标识符是 `colorCategory1`（**大写 C**），
 * 所以那条命令确实返回 0，但它证明的只是"我用错了大小写"，
 * **不是**"原生没有这些色"。原生一直都有，而且明暗两套都有。
 *
 * 于是真正的理由不是"原生做不到"，而是**"让四端各做一遍不合理"**：
 *
 * 1. **槽位→颜色的映射只能有一份。** `Project.color` 存的是 `"3"` 这样的槽位号
 *    （这是 ADR-0010 §3.10.1 / activity-categories 的既定决定：颜色会随主题调整，
 *    而用户的**语义**不该跟着变）。要把 `"3"` 变成颜色，必须有人做映射。
 *    放进快照 → 应用做**一次**；传槽位号 → **四个平台各做一遍**（各写一份
 *    `switch(slot)` + 各认一次明暗），而这类复制**不会报错**，
 *    症状是"某端颜色不对"且只有那端不对。
 * 2. **快照因此自描述。** 原生拿到 `{ light, dark }` 就能画，
 *    不需要依赖设计系统、不需要知道 heyta 的槽位概念。
 * 3. **`{ light, dark }` 的形状不是新概念** —— 它就是
 *    `generated/HeytaTokens.swift` 自己的形状（`enum Light` / `enum Dark`）。
 *
 * ## ⚠️ 这个选择的代价（如实记）
 *
 * 换调色板后，**已生成的快照仍带旧色**，直到应用再跑一次刷新快照。
 * 传槽位号的话组件会立刻显示新色。取舍是可接受的：快照本来就有 `validUntil`、
 * 且每次应用启动都会重算，所以陈旧时间是**有界**的（最长一个刷新周期）。
 *
 * ## 为什么必须带两份
 *
 * 组件知道自己的明暗环境（iOS 的 `colorScheme`、Android 的 `uiMode`），
 * 但**不应该知道** heyta 的调色板。给两份、让原生挑 —— 这是"颜色由应用决定、
 * 明暗由系统决定"的分工。
 */
export interface WidgetProjectColor {
  /** 浅色主题下的最终颜色（`#rrggbb`）。 */
  light: string;
  /** 深色主题下的最终颜色（`#rrggbb`）。 */
  dark: string;
}

export interface WidgetPayload {
  /** 今日任务。上限 `WIDGET_MAX_TASKS`。 */
  today: WidgetTask[];
  /** 四象限：键为槽位号字符串（`"1".."4"`）。 */
  quadrant?: Record<string, WidgetTask[]>;
  /** 今日习惯。 */
  habits?: WidgetHabit[];
  /** 专注状态。 */
  focus?: WidgetFocus;
  /**
   * `projectId` → **已解析**的颜色（见 `WidgetProjectColor`）。
   *
   * ⚠️ 只包含**被 `today` / `quadrant` 实际引用到的**清单 ——
   * 快照是要塞进共享容器的，没必要把用户全部清单的颜色都带上。
   */
  projectColors?: Record<string, WidgetProjectColor>;
}

export type PayloadRejection =
  | 'not-an-object'
  | 'missing-today'
  | 'today-not-array'
  | 'too-many-tasks'
  | 'malformed-task'
  | 'malformed-section'
  | 'null-project-id';

export type PayloadParseResult =
  | { ok: true; payload: WidgetPayload }
  | { ok: false; reason: PayloadRejection; detail: string };

// ─────────────────────────────────────────────────────────────
// AAD：把明文信封绑进密文
// ─────────────────────────────────────────────────────────────

/**
 * 计算 AES-GCM 的附加认证数据（AAD）。
 *
 * 🔴 **为什么需要它**：不绑定的话，能写共享容器的人可以把 `validUntil` 改成很远的未来
 * （让过期快照看起来是新鲜的），或改 `dayStr` —— 密文仍然能解开，因为帧头没被认证。
 * 组件是**唯一写入方**不成立的时候就靠这个兜底。
 *
 * **四端必须逐字节复现这个字符串**，所以分隔符与字段顺序在这里冻结：
 *
 * ```
 * `${v}|${dayStr}|${validUntil}`
 * ```
 *
 * `validUntil` 用**十进制整数字符串**，不要科学计数法、不要补零。
 */
export function envelopeAad(framing: Pick<WidgetEnvelope, 'v' | 'dayStr' | 'validUntil'>): string {
  return `${framing.v}|${framing.dayStr}|${framing.validUntil}`;
}

// ─────────────────────────────────────────────────────────────
// 校验
// ─────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * 校验明文信封。
 *
 * 注意**顺序**：先判 `v`，再判其余。这样"未来版本"会得到 `unknown-version`
 * 而不是含混的 `malformed-envelope` —— 前者是**预期内的正常情况**（旧组件遇到新契约），
 * 后者是**真的坏了**，两者在日志和降级行为上必须能区分。
 */
export function parseEnvelope(raw: unknown): EnvelopeParseResult {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'not-an-object', detail: `期望对象，实际 ${typeof raw}` };
  }

  const v = raw.v;
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    return { ok: false, reason: 'unknown-version', detail: `v 不是整数：${String(v)}` };
  }
  if (v !== WIDGET_CONTRACT_VERSION) {
    return {
      ok: false,
      reason: 'unknown-version',
      detail: `契约版本 ${v} 不是本端认识的 ${WIDGET_CONTRACT_VERSION} —— fail closed 到空列表`,
    };
  }

  if (raw.alg !== WIDGET_ALG) {
    return { ok: false, reason: 'unsupported-alg', detail: `alg=${String(raw.alg)}` };
  }

  const { dayStr, validUntil, nonce, ciphertext } = raw;
  if (!isNonEmptyString(dayStr) || !isNonEmptyString(nonce) || !isNonEmptyString(ciphertext)) {
    return { ok: false, reason: 'malformed-envelope', detail: 'dayStr / nonce / ciphertext 必须是非空字符串' };
  }
  if (typeof validUntil !== 'number' || !Number.isSafeInteger(validUntil)) {
    return { ok: false, reason: 'malformed-envelope', detail: `validUntil 不是安全整数：${String(validUntil)}` };
  }
  if (validUntil < 0 || validUntil > MAX_EPOCH_MS) {
    // 🔴 范围检查不是洁癖，它挡掉一整类**跨端静默不一致**：
    // JS 对 >= 1e21 的数字用科学计数法（`String(1e21) === '1e+21'`），
    // 而 Swift / Kotlin / ArkTS 的格式化规则各不相同 —— 于是 AAD 字符串对不上，
    // 四端全都"解密失败"，而症状只是组件没有数据。
    // 把 validUntil 限制在 JS Date 能表示的范围内，这个分歧就不可能发生。
    return {
      ok: false,
      reason: 'malformed-envelope',
      detail: `validUntil 超出可表示范围 [0, ${MAX_EPOCH_MS}]：${String(validUntil)}`,
    };
  }

  return { ok: true, envelope: { v, dayStr, validUntil, alg: WIDGET_ALG, nonce, ciphertext } };
}

function parseTask(raw: unknown): { ok: true; task: WidgetTask } | { ok: false; reason: PayloadRejection; detail: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'malformed-task', detail: '任务不是对象' };
  }
  if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.title)) {
    return { ok: false, reason: 'malformed-task', detail: 'id / title 必须是非空字符串' };
  }
  if (typeof raw.isDone !== 'boolean') {
    return { ok: false, reason: 'malformed-task', detail: `isDone 不是布尔：${String(raw.isDone)}` };
  }

  const task: WidgetTask = { id: raw.id, title: raw.title, isDone: raw.isDone };

  if ('projectId' in raw) {
    // 🔴 就是这里：JSON null 必须**报错**，而不是原样传下去变成字符串 "null"。
    if (raw.projectId === null) {
      return {
        ok: false,
        reason: 'null-project-id',
        detail: 'projectId 是 null —— 必须省略该键。Android 的 org.json optString 会把它读成字符串 "null"',
      };
    }
    if (!isNonEmptyString(raw.projectId)) {
      return { ok: false, reason: 'malformed-task', detail: 'projectId 存在时必须是非空字符串' };
    }
    task.projectId = raw.projectId;
  }

  if ('quadrant' in raw && raw.quadrant !== undefined) {
    if (typeof raw.quadrant !== 'number' || !Number.isInteger(raw.quadrant)) {
      return { ok: false, reason: 'malformed-task', detail: `quadrant 不是整数：${String(raw.quadrant)}` };
    }
    task.quadrant = raw.quadrant;
  }

  return { ok: true, task };
}

/** 校验明文载荷。同样**只拒绝、不修补** —— 不替调用方猜它想要什么。 */
export function parsePayload(raw: unknown): PayloadParseResult {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'not-an-object', detail: `期望对象，实际 ${typeof raw}` };
  }
  if (!('today' in raw)) {
    return { ok: false, reason: 'missing-today', detail: 'today 是必需字段' };
  }
  if (!Array.isArray(raw.today)) {
    return { ok: false, reason: 'today-not-array', detail: `today 不是数组：${typeof raw.today}` };
  }
  if (raw.today.length > WIDGET_MAX_TASKS) {
    return {
      ok: false,
      reason: 'too-many-tasks',
      detail: `today 有 ${raw.today.length} 条，上限 ${WIDGET_MAX_TASKS} —— 截断应在应用侧完成`,
    };
  }

  const today: WidgetTask[] = [];
  for (const entry of raw.today) {
    const parsed = parseTask(entry);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, detail: parsed.detail };
    today.push(parsed.task);
  }

  const payload: WidgetPayload = { today };

  if ('projectColors' in raw && raw.projectColors !== undefined) {
    if (!isPlainObject(raw.projectColors)) {
      return { ok: false, reason: 'malformed-section', detail: 'projectColors 不是对象' };
    }
    const colors: Record<string, WidgetProjectColor> = {};
    for (const [key, value] of Object.entries(raw.projectColors)) {
      if (!isPlainObject(value)) {
        return {
          ok: false,
          reason: 'malformed-section',
          detail: `projectColors["${key}"] 必须是 { light, dark } 对象（不是字符串 token —— 槽位→颜色只该由应用解析一次）`,
        };
      }
      if (!isNonEmptyString(value.light) || !isNonEmptyString(value.dark)) {
        return {
          ok: false,
          reason: 'malformed-section',
          detail: `projectColors["${key}"] 的 light / dark 必须都是非空字符串`,
        };
      }
      colors[key] = { light: value.light, dark: value.dark };
    }
    payload.projectColors = colors;
  }

  if ('quadrant' in raw && raw.quadrant !== undefined) {
    if (!isPlainObject(raw.quadrant)) {
      return { ok: false, reason: 'malformed-section', detail: 'quadrant 不是对象' };
    }
    const quadrant: Record<string, WidgetTask[]> = {};
    for (const [slot, list] of Object.entries(raw.quadrant)) {
      if (!Array.isArray(list)) {
        return { ok: false, reason: 'malformed-section', detail: `quadrant["${slot}"] 不是数组` };
      }
      if (list.length > WIDGET_MAX_TASKS) {
        return {
          ok: false,
          reason: 'too-many-tasks',
          detail: `quadrant["${slot}"] 有 ${list.length} 条，上限 ${WIDGET_MAX_TASKS}`,
        };
      }
      const tasks: WidgetTask[] = [];
      for (const entry of list) {
        const parsed = parseTask(entry);
        if (!parsed.ok) return { ok: false, reason: parsed.reason, detail: parsed.detail };
        tasks.push(parsed.task);
      }
      quadrant[slot] = tasks;
    }
    payload.quadrant = quadrant;
  }

  if ('habits' in raw && raw.habits !== undefined) {
    if (!Array.isArray(raw.habits)) {
      return { ok: false, reason: 'malformed-section', detail: 'habits 不是数组' };
    }
    const habits: WidgetHabit[] = [];
    for (const entry of raw.habits) {
      if (!isPlainObject(entry) || !isNonEmptyString(entry.id) || !isNonEmptyString(entry.title)) {
        return { ok: false, reason: 'malformed-section', detail: '习惯的 id / title 必须是非空字符串' };
      }
      if (typeof entry.doneToday !== 'boolean' || typeof entry.streak !== 'number') {
        return { ok: false, reason: 'malformed-section', detail: '习惯的 doneToday / streak 类型不对' };
      }
      habits.push({ id: entry.id, title: entry.title, doneToday: entry.doneToday, streak: entry.streak });
    }
    payload.habits = habits;
  }

  if ('focus' in raw && raw.focus !== undefined) {
    const focus = raw.focus;
    if (!isPlainObject(focus) || typeof focus.active !== 'boolean') {
      return { ok: false, reason: 'malformed-section', detail: 'focus.active 必须是布尔' };
    }
    const parsedFocus: WidgetFocus = { active: focus.active };
    if ('remainingSeconds' in focus && focus.remainingSeconds !== undefined) {
      if (typeof focus.remainingSeconds !== 'number') {
        return { ok: false, reason: 'malformed-section', detail: 'focus.remainingSeconds 必须是数字' };
      }
      parsedFocus.remainingSeconds = focus.remainingSeconds;
    }
    if ('targetSeconds' in focus && focus.targetSeconds !== undefined) {
      if (typeof focus.targetSeconds !== 'number') {
        return { ok: false, reason: 'malformed-section', detail: 'focus.targetSeconds 必须是数字' };
      }
      parsedFocus.targetSeconds = focus.targetSeconds;
    }
    if ('sessionTitle' in focus && focus.sessionTitle !== undefined) {
      if (typeof focus.sessionTitle !== 'string') {
        return { ok: false, reason: 'malformed-section', detail: 'focus.sessionTitle 必须是字符串' };
      }
      parsedFocus.sessionTitle = focus.sessionTitle;
    }
    if ('endsAt' in focus && focus.endsAt !== undefined) {
      // 与 `validUntil` 同一套校验：必须是**安全的非负整数**，且落在
      // 可表示的时间范围内。用 `Number.isSafeInteger` 而不是 `isFinite`：
      // `1e300` 是"有限"的，但它转成日期就是 `Invalid Date`、
      // 转成 `Date` 会在原生侧溢出 —— 而这里正是要挡住那种值的地方。
      // ⚠️ `typeof` 那一段**不能省**，尽管 `Number.isSafeInteger` 对非数字
      //    本来就返回 `false`（运行时行为一样）。省掉的后果是 **tsc 不肯收窄**
      //    `unknown`：`focus.endsAt` 会一直是 `{}`，于是 `parsedFocus.endsAt = focus.endsAt`
      //    报 `Type '{} | null' is not assignable to type 'number | undefined'`。
      //
      //    🔴 而**只有 `tsup` 的 DTS 构建会报它** —— `vitest` 走 esbuild 转译，
      //    完全不做类型检查，所以 171 条测试全绿也发现不了。这条错误是在
      //    `pnpm check`（= `pnpm build && …`）里才第一次出现的。
      const endsAt = focus.endsAt;
      if (typeof endsAt !== 'number' || !Number.isSafeInteger(endsAt) || endsAt < 0 || endsAt > MAX_EPOCH_MS) {
        return {
          ok: false,
          reason: 'malformed-section',
          detail: 'focus.endsAt 必须是 [0, MAX_EPOCH_MS] 内的安全整数',
        };
      }
      parsedFocus.endsAt = endsAt;
    }
    payload.focus = parsedFocus;
  }

  return { ok: true, payload };
}

/** 空载荷 —— **fail closed 的唯一产物**。 */
export function emptyPayload(): WidgetPayload {
  return { today: [] };
}

/**
 * 把信封解密成载荷 JSON 的**平台方实现**。
 *
 * 为什么做成注入的而不是本包自己实现：**密钥的获取方式每个平台都不一样** ——
 * iOS 走共享 Keychain、Android 走 Keystore、桌面走 OS keychain、
 * 而四端的 AES 实现也各不相同。本包是**纯 TS、零依赖**的，它不该知道这些。
 *
 * 约定：**失败就抛异常**（不要返回 undefined）。
 *
 * ## 🔴 为什么允许返回 Promise（这一条踩过）
 *
 * 四端的 AES 里，**JS 侧必然是异步的**：`crypto.subtle` 只有 Promise API，
 * 而 RN 上没有 `crypto.subtle`、走 `@noble/ciphers` 的那条路也只是"同步的 API"，
 * 不是"同步的实现"（它照样可能被包成 async）。所以解密器的天然形状是 `Promise`。
 *
 * 若这里只允许同步返回值，而消费方传了个 `async` 解密器，那么
 * [readSnapshotOrNull] 会拿到一个 **Promise 对象**交给 `parsePayload` ——
 * 它不是对象也不是字符串，于是被判为格式错误、**静默降级到"没有数据"**。
 * 症状是"组件永远空着"，而日志里什么都没有。`await` 一个同步返回值是安全的，
 * 所以这里声明成 `unknown | Promise<unknown>` 不牺牲任何东西。
 */
export type SnapshotDecryptor = (envelope: WidgetEnvelope) => unknown | Promise<unknown>;

/**
 * 从任意原始值读出载荷，**失败返回 `null`**。
 *
 * 🔴 **渲染组件时必须用这个，不要用 [readSnapshotSafely]。**
 *
 * 两者只差一件事，而那一件事会直接骗到用户：
 *   - `readSnapshotOrNull` → `null`，调用方显示**占位符**（"打开应用以显示今天的任务"）
 *   - `readSnapshotSafely` → `emptyPayload()`（`today = []`），调用方显示**"今天没有任务"**
 *
 * 而"解不开密"最常见的场景恰恰是**设备刚重启、密钥还没派生好**（ADR-0025 §2.3
 * 把这个代价写成了验收预期）。那时组件如果显示"今天没有任务"，
 * 用户会**据此以为今天真的没事** —— 这不是"降级得不够好看"，这是**在骗用户**。
 *
 * ⚠️ 本文件里 `readSnapshotSafely` 原来带的注释写着"宁可显示'今天没有任务'，
 * 也不要让组件崩"。那句话是**错的**，而且这个错误在 Kotlin 侧先被踩到过一次
 *（`WidgetSnapshotCipher.readSafely`）。两处都已按同一形状修正：
 * 失败与"成功但为空"必须是两种可区分的状态。
 */
export async function readSnapshotOrNull(
  raw: unknown,
  decrypt: SnapshotDecryptor,
): Promise<WidgetPayload | null> {
  const envelope = parseEnvelope(raw);
  if (!envelope.ok) return null;

  let decrypted: unknown;
  try {
    // ⚠️ `await` 是**必须的**，见 `SnapshotDecryptor` 的注释：
    // 少了它，一个 async 解密器会把 Promise 对象交给 `parsePayload`，
    // 结果是被判为格式错误 → 静默降级成"没有数据"。
    decrypted = await decrypt(envelope.envelope);
  } catch {
    // 密钥还没派生好（设备刚重启）、AAD 不匹配（信封被改过）、密文损坏 ——
    // 这三种都不是"组件坏了"，但也都**不是"今天没有任务"**。
    return null;
  }

  const payload = parsePayload(decrypted);
  return payload.ok ? payload.payload : null;
}

/**
 * 与 TS 侧的历史入口名对应：任何拒绝或异常都降级成 `emptyPayload()`。
 *
 * ⚠️ **不要用它渲染组件**（会把"读不到"显示成"今天没有任务"）—— 用 [readSnapshotOrNull]。
 * 保留它是为了让"只要一份能安全解引用的载荷"的调用方不必自己写 `?? emptyPayload()`。
 */
export async function readSnapshotSafely(
  raw: unknown,
  decrypt: SnapshotDecryptor,
): Promise<WidgetPayload> {
  return (await readSnapshotOrNull(raw, decrypt)) ?? emptyPayload();
}

/**
 * 把载荷封成信封的**平台方实现** —— 与 [SnapshotDecryptor] 对称。
 *
 * 它拿走两样东西（AAD 与明文 JSON 文本），交出两样（`nonce` 与 `ciphertext` 的
 * **标准 base64**）。**nonce 的生成与 base64 编码都归平台**，理由是：
 *   - 本包是**纯 TS、零依赖**的：拿不到 `crypto.getRandomValues`，
 *     也不该假设 `btoa` / `TextEncoder` 存在（RN 上这两个的历史就不一致）；
 *   - nonce 必须**每次封包重新取**（GCM 重用 nonce 是灾难性的），
 *     只有真正持有 RNG 的那一层才能保证这件事。
 *
 * 约定：**失败就抛异常**。
 */
export type SnapshotSealer = (input: {
  /** AAD 原文，来自 [envelopeAad]。必须原样作为 AEAD 的 associated data。 */
  aad: string;
  /** 载荷的 JSON 文本（由 [sealSnapshot] 用 `JSON.stringify` 产出）。 */
  plaintext: string;
}) => { nonce: string; ciphertext: string } | Promise<{ nonce: string; ciphertext: string }>;

/** [sealSnapshot] 的入参。 */
export interface SealOptions {
  /**
   * 应用算出的"今天"（`YYYY-MM-DD`）。
   *
   * 🔴 由**应用**给，绝不由原生推导 —— 时区、跨日切点、"今天从几点开始"都是产品规则，
   * 让四个平台各实现一遍，必然出现"iOS 认为还是今天、Android 认为已经是明天"。
   */
  dayStr: string;
  /** 快照失效时刻（epoch ms）。范围必须与 [parseEnvelope] 的判据一致。 */
  validUntil: number;
}

/**
 * 造出一个合法的 `v:1` 信封。
 *
 * ## 为什么这一步要放在本包，而不是各端各写一遍
 *
 * 信封形状**就是契约本身**：字段名、`alg` 取值、AAD 的拼法、base64 的编码方式。
 * 四端各自"照着文档拼一个 JSON"的结果，就是四份会漂移的实现 ——
 * 而漂移的症状是**解密失败**，且四端会**同时**失败，只在组件上表现为"没有数据"。
 *
 * 所以：**形状在这，密码学在外**。
 *
 * ⚠️ `validUntil` 在这里就校验（不是等 `parseEnvelope` 才发现）：写下一份
 * 契约解不开的信封，等于把一个必然失败的产物存进共享容器，
 * 而那时离出错点已经很远了。**在有日志的这一侧拒绝它。**
 */
export async function sealSnapshot(
  payload: WidgetPayload,
  options: SealOptions,
  seal: SnapshotSealer,
): Promise<WidgetEnvelope> {
  const { dayStr, validUntil } = options;

  // 与 `parseEnvelope` 同一套判据（含 `MAX_EPOCH_MS` 的上界 —— 那个上界的理由
  // 见文件头的注释：JS 对 >= 1e21 用科学计数法，而三端的数字格式化规则不同，
  // 于是 AAD 字符串对不上、四端**全都**解不开）。
  if (typeof dayStr !== 'string' || dayStr.length === 0) {
    throw new Error(`sealSnapshot: dayStr 必须是非空字符串，收到 ${JSON.stringify(dayStr)}`);
  }
  if (
    !Number.isSafeInteger(validUntil) ||
    validUntil < 0 ||
    validUntil > MAX_EPOCH_MS
  ) {
    throw new Error(
      `sealSnapshot: validUntil 必须是 [0, ${MAX_EPOCH_MS}] 内的安全整数，收到 ${String(validUntil)}`,
    );
  }

  const aad = envelopeAad({
    v: WIDGET_CONTRACT_VERSION,
    dayStr,
    validUntil,
  });
  const plaintext = JSON.stringify(payload);
  const sealed = await seal({ aad, plaintext });

  return {
    v: WIDGET_CONTRACT_VERSION,
    dayStr,
    validUntil,
    alg: WIDGET_ALG,
    nonce: sealed.nonce,
    ciphertext: sealed.ciphertext,
  };
}
