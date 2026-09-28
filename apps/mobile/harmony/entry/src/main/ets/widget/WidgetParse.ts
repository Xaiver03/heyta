/**
 * 小组件快照的**纯解析层**（鸿蒙侧）。
 *
 * ## 🔴 为什么是 `.ts` 而不是 `.ets` —— 这是本文件最重要的一件事
 *
 * 鸿蒙的卡片必须是 `.ets`（ArkUI 的 `struct` / `@Entry` / `postCardAction`
 * 只有 ArkTS 编译器认识）。但**纯解析逻辑放进 `.ets` 就再也验证不了了**：
 *
 * - `es2abc` 的 `--extension` **只接受 `js/ts/as/abc`，不接受 `ets`**
 *   （这是 `design-system/heyta/check-arkts-compile.mjs` 里已经记下的事实）；
 * - 本机**没有 `ark_js_vm`**，所以即使编译成 `.abc` 也跑不起来
 *   （实测：`find` 遍 DevEco 全目录没有任何 ark runtime）。
 *
 * 于是"写 `.ets`"在**这台机器上**等于"写完就没人能验"。
 * 而拆开之后，同一份源文件能拿到**两重真验证**：
 *
 * | 验证 | 手段 | 证明了什么 |
 * |---|---|---|
 * | 语法 / 编译 | `es2abc --extension=ts` | 这份代码是**ArkTS 编译器接受的代码**（不是"我觉得像"） |
 * | 行为 | vitest + 黄金夹具 | 对同一份 `v1.golden.*` 的解析结果与其它三端**逐字段相同** |
 *
 * 🔴 **这不是"为了测试而改结构"**：ArkTS 里本来就必须这么做 ——
 * 卡片（ArkUI）与数据（契约）是两层，把它们混在一个 `.ets` 里，
 * "解析对不对"和"卡片画得对不对"就永远只能一起验、且都验不了。
 *
 * ⚠️ 公开签名用 `Object | null` 而**不是** `unknown`：ArkTS 严格模式禁止
 * `any` / `unknown`（`arkts-no-any-unknown`），而 `.ets` 调用方传给它的正是
 * `JSON.parse` 的产物。内部实现仍然按 `unknown` 处理（那是 `.ts`，不受此限）。
 *
 * 本文件**刻意零依赖**：不 import 任何东西（包括 `@heyta/widget-core`）。
 * 鸿蒙工程有自己的 `oh-package.json5`，跨仓库引用 workspace 包会把
 * 工具链绑死在 monorepo 的目录布局上。真正的锁是**黄金夹具**，不是共享代码 ——
 * 四端各自解析、各自对夹具断言，这才能发现"某一端理解错了"。
 */

// ─────────────────────────────────────────────────────────────
// 契约常量
//
// ⚠️ 这些**必须**与 `packages/widget-core/src/contract.ts` 逐字相同。
//    它们不是"抄一遍更方便"，而是四端各自的编译单元无法共享 TS 常量。
//    漂移的表现是"鸿蒙端把新契约当未知版本 → 永远显示占位态"，
//    所以**每一条都有一条测试拿夹具钉着**（见 `WidgetParse.spec.ts`）。
// ─────────────────────────────────────────────────────────────

/** 当前契约版本。未知值必须 fail closed。 */
export const WIDGET_CONTRACT_VERSION = 1;

/** 信封允许的算法标识。**故意不提供"无加密"这一档**。 */
export const WIDGET_ALG = 'AES-GCM-256';

/** 任务数上限（上游同值）。截断由应用侧做，这里只拒绝。 */
export const WIDGET_MAX_TASKS = 20;

/** `validUntil` 上界 = JS `Date` 能表示的最大时刻。跨端 AAD 一致性的护栏。 */
export const MAX_EPOCH_MS = 8640000000000000;

// ─────────────────────────────────────────────────────────────
// 类型（与契约同形）
// ─────────────────────────────────────────────────────────────

export interface WidgetEnvelope {
  v: number;
  dayStr: string;
  validUntil: number;
  alg: string;
  nonce: string;
  ciphertext: string;
}

export interface WidgetTask {
  id: string;
  title: string;
  isDone: boolean;
  /** 🔴 缺失时**省略键**，绝不写 `null`。 */
  projectId?: string;
  quadrant?: number;
}

export interface WidgetHabit {
  id: string;
  title: string;
  doneToday: boolean;
  streak: number;
}

export interface WidgetFocus {
  active: boolean;
  remainingSeconds?: number;
  targetSeconds?: number;
  sessionTitle?: string;
  /**
   * 🔴 **本轮专注的绝对结束时刻**（Unix 毫秒）。灵动岛 / Live Activity 的前提。
   *
   * 对应 TS 的 `WidgetFocus.endsAt`。可选 = 向前兼容。
   */
  endsAt?: number;
}

export interface WidgetProjectColor {
  light: string;
  dark: string;
}

export interface WidgetPayload {
  today: WidgetTask[];
  quadrant?: Record<string, WidgetTask[]>;
  habits?: WidgetHabit[];
  focus?: WidgetFocus;
  projectColors?: Record<string, WidgetProjectColor>;
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
// 基础判定
// ─────────────────────────────────────────────────────────────

/**
 * 这是个"普通对象"吗（不是 `null`、不是数组）？
 *
 * 🔴 `typeof [] === 'object'`，所以**必须**单独排除数组：
 * 一份 `today: []` 在 JSON 里是合法的空列表，但一个**信封本身**是数组时
 * 一定是坏的输入。不排掉的话 `Array.isArray(raw)` 会让 `raw.v` 悄悄是
 * `undefined` → 落到 `unknown-version` 而不是 `not-an-object`，
 * 于是日志里说"版本不认识"，而真实原因是输入根本不是信封。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 非空字符串。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 数量：有限、且是整数。**不接受 `true`/`''` 这类会被 `Number()` 悄悄收下的值。** */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

// ─────────────────────────────────────────────────────────────
// 信封
// ─────────────────────────────────────────────────────────────

/**
 * 校验明文信封。
 *
 * 🔴 **未知 `v` 必须 fail closed**，绝不猜测。旧组件读到新契约时唯一安全的
 * 行为是假装没有数据 —— 猜字段的后果是把错误的数据画在用户桌面上，
 * 而用户没有理由怀疑它。
 */
export function parseEnvelope(raw: Object | null): EnvelopeParseResult {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'not-an-object', detail: '信封不是对象' };
  }

  const v = raw['v'];
  if (!isCount(v)) {
    return { ok: false, reason: 'malformed-envelope', detail: 'v 不是整数' };
  }
  if (v !== WIDGET_CONTRACT_VERSION) {
    return {
      ok: false,
      reason: 'unknown-version',
      detail: `契约版本 ${v} 不认识（本端只认 ${WIDGET_CONTRACT_VERSION}）`,
    };
  }

  const alg = raw['alg'];
  if (alg !== WIDGET_ALG) {
    return { ok: false, reason: 'unsupported-alg', detail: `算法 ${String(alg)} 不支持` };
  }

  const dayStr = raw['dayStr'];
  if (!isNonEmptyString(dayStr)) {
    return { ok: false, reason: 'malformed-envelope', detail: 'dayStr 不是非空字符串' };
  }

  const validUntil = raw['validUntil'];
  // 🔴 上界检查不是类型洁癖：`DAY` 与 `validUntil` 一起进 AAD 字符串，
  //    而各端把 `validUntil` 转成字符串的方式不同（Int64 / Number / double）。
  //    超出 JS 能精确表示的范围时，四端算出的 AAD **会不一样**，
  //    症状是"某一端解密永远失败"，且看不出为什么。
  if (!isCount(validUntil) || validUntil < 0 || validUntil > MAX_EPOCH_MS) {
    return { ok: false, reason: 'malformed-envelope', detail: `validUntil ${String(validUntil)} 越界` };
  }

  const nonce = raw['nonce'];
  if (!isNonEmptyString(nonce)) {
    return { ok: false, reason: 'malformed-envelope', detail: 'nonce 不是非空字符串' };
  }

  const ciphertext = raw['ciphertext'];
  if (!isNonEmptyString(ciphertext)) {
    return { ok: false, reason: 'malformed-envelope', detail: 'ciphertext 不是非空字符串' };
  }

  return { ok: true, envelope: { v, dayStr, validUntil, alg, nonce, ciphertext } };
}

/**
 * 快照过期了吗？
 *
 * 🔴 **原生只判这一件事**，它**绝不自己推导"今天"**。时区、跨日切点、
 * 用户自定义的"今天从几点开始"都是产品规则；让四个平台各自实现一遍，
 * 必然出现"iOS 认为还是今天、Android 认为已经是明天"。
 */
export function isStale(envelope: WidgetEnvelope, now: number): boolean {
  return now >= envelope.validUntil;
}

/**
 * AES-GCM 的附加认证数据（AAD）。
 *
 * 🔴 **四端必须算出逐字节相同的字符串。** 这份字符串是 GCM 认证的一部分，
 * 任何一端写法不同（分隔符、`validUntil` 的转字符串方式）都会让**那一端**
 * 解密失败，而其它三端一切正常 —— 这是最难定位的一类缺陷。
 * 所以它只有一份定义，且被夹具钉着。
 */
export function envelopeAad(envelope: WidgetEnvelope): string {
  return `${envelope.v}|${envelope.dayStr}|${envelope.validUntil}`;
}

// ─────────────────────────────────────────────────────────────
// 载荷
// ─────────────────────────────────────────────────────────────

function parseTask(raw: unknown): WidgetTask | null {
  if (!isPlainObject(raw)) return null;
  const id = raw['id'];
  const title = raw['title'];
  const isDone = raw['isDone'];
  if (!isNonEmptyString(id)) return null;
  if (typeof title !== 'string') return null;
  if (!isBoolean(isDone)) return null;

  const task: WidgetTask = { id, title, isDone };

  // 🔴 `projectId` 缺失时**省略键**，绝不写 `null`。
  //    上游 Super Productivity 踩过这个：Android 的 `org.json` 里
  //    `optString("projectId")` 会把 JSON `null` 读成**字符串 `"null"`**，
  //    于是组件去找一个叫 "null" 的清单颜色，**静默取到错误颜色**。
  const projectId = raw['projectId'];
  if (isNonEmptyString(projectId)) task.projectId = projectId;

  const quadrant = raw['quadrant'];
  if (isCount(quadrant) && quadrant >= 1 && quadrant <= 4) task.quadrant = quadrant;

  return task;
}

function parseTasks(raw: unknown, cap: number): WidgetTask[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > cap) return null;
  const out: WidgetTask[] = [];
  for (const item of raw) {
    const task = parseTask(item);
    // 一条坏的任务 → 整份载荷不算数。**不做"跳过坏的、留下好的"** ——
    // 那会让组件显示一份**看起来正常但少了任务**的列表，
    // 而用户以为那就是全部。
    if (task === null) return null;
    out.push(task);
  }
  return out;
}

function parseHabit(raw: unknown): WidgetHabit | null {
  if (!isPlainObject(raw)) return null;
  const id = raw['id'];
  const title = raw['title'];
  const doneToday = raw['doneToday'];
  const streak = raw['streak'];
  if (!isNonEmptyString(id)) return null;
  if (typeof title !== 'string') return null;
  if (!isBoolean(doneToday)) return null;
  if (typeof streak !== 'number' || !Number.isFinite(streak)) return null;
  return { id, title, doneToday, streak };
}

function parseFocus(raw: unknown): WidgetFocus | null {
  if (!isPlainObject(raw)) return null;
  const active = raw['active'];
  if (!isBoolean(active)) return null;

  const focus: WidgetFocus = { active };

  const targetSeconds = raw['targetSeconds'];
  if (typeof targetSeconds === 'number' && Number.isFinite(targetSeconds)) {
    focus.targetSeconds = targetSeconds;
  }

  const sessionTitle = raw['sessionTitle'];
  if (typeof sessionTitle === 'string') focus.sessionTitle = sessionTitle;

  // 🔴 **绝对**结束时刻 —— 灵动岛 / Live Activity 的前提。
  //    ⚠️ 这里**收进来**（与另外三端一致），但鸿蒙卡片**暂时不画倒计时**：
  //    卡片是静态快照，没有 `Text(timerInterval:)` 那种系统驱动的走时。
  //    要画必须先有一条"按时间轴渲染"的原生通路 —— 记在 U8 的鸿蒙部分。
  const endsAt = raw['endsAt'];
  if (endsAt !== undefined) {
    // 🔴 这里必须 `return null` —— `parseFocus` 的契约是 **`WidgetFocus | null`**，
    //    不是 `{ ok, reason }`。我第一版就是在这里 return 了一个 `{ok:false}` 对象，
    //    而调用方判的是 `focus === null` —— 于是**一个坏掉的 `endsAt` 被当成
    //    focus 收下了**，`payload.focus` 变成 `{ok:false,...}`，谁都没发现。
    //    修复它的是夹具测试，不是代码复查：单测直接断言了 `r.ok === false`。
    if (typeof endsAt !== 'number' || !Number.isSafeInteger(endsAt) || endsAt < 0 || endsAt > MAX_EPOCH_MS) {
      return null;
    }
    focus.endsAt = endsAt;
  }

  // ⚠️ `remainingSeconds` **读进来但卡片不画**。
  //    它是**发布那一刻**的快照值、没有绝对时间锚点：
  //    09:00 发布"剩余 25:00"，09:10 看到的还是 25:00。
  //    「宁可少显示一个数字，也不显示一个错的数字。」
  //    要画必须先给契约加 `endsAt`（记在 U8）。
  const remainingSeconds = raw['remainingSeconds'];
  if (typeof remainingSeconds === 'number' && Number.isFinite(remainingSeconds)) {
    focus.remainingSeconds = remainingSeconds;
  }

  return focus;
}

function parseProjectColors(raw: unknown): Record<string, WidgetProjectColor> | undefined {
  if (!isPlainObject(raw)) return undefined;
  const out: Record<string, WidgetProjectColor> = {};
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (!isPlainObject(value)) continue;
    const light = value['light'];
    const dark = value['dark'];
    if (typeof light !== 'string' || typeof dark !== 'string') continue;
    out[key] = { light, dark };
  }
  return out;
}

export type PayloadParseResult =
  | { ok: true; payload: WidgetPayload }
  | { ok: false; reason: string };

/** 校验解密后的明文载荷。与 `parseEnvelope` 同一档纪律：只拒绝，不修补。 */
export function parsePayload(raw: Object | null): PayloadParseResult {
  if (!isPlainObject(raw)) return { ok: false, reason: 'not-an-object' };

  const rawToday = raw['today'];
  if (!Array.isArray(rawToday)) return { ok: false, reason: 'today-not-array' };
  const today = parseTasks(rawToday, WIDGET_MAX_TASKS);
  if (today === null) return { ok: false, reason: 'today-invalid-or-too-many' };

  const payload: WidgetPayload = { today };

  const rawQuadrant = raw['quadrant'];
  if (isPlainObject(rawQuadrant)) {
    const quadrant: Record<string, WidgetTask[]> = {};
    for (const key of Object.keys(rawQuadrant)) {
      const slot = parseTasks(rawQuadrant[key], WIDGET_MAX_TASKS);
      if (slot === null) return { ok: false, reason: `quadrant-${key}-invalid` };
      quadrant[key] = slot;
    }
    payload.quadrant = quadrant;
  }

  const rawHabits = raw['habits'];
  if (rawHabits !== undefined) {
    if (!Array.isArray(rawHabits)) return { ok: false, reason: 'habits-not-array' };
    const habits: WidgetHabit[] = [];
    for (const item of rawHabits) {
      const habit = parseHabit(item);
      if (habit === null) return { ok: false, reason: 'habit-invalid' };
      habits.push(habit);
    }
    payload.habits = habits;
  }

  const rawFocus = raw['focus'];
  if (rawFocus !== undefined) {
    const focus = parseFocus(rawFocus);
    if (focus === null) return { ok: false, reason: 'focus-invalid' };
    payload.focus = focus;
  }

  const colors = parseProjectColors(raw['projectColors']);
  if (colors !== undefined) payload.projectColors = colors;

  return { ok: true, payload };
}
