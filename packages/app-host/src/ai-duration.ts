/**
 * AI 耗时估计（功能 ④）
 * ======================
 *
 * 给一条任务估一个「需要多少分钟」，**用户确认后**才写进数据。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个功能与拆解最大的不同：**它的答案是一个数，而不是一段文本。**
 *
 * 一个数意味着解析只有三种结局 —— 拿到、拿不到、拿到但离谱 —— 没有模糊地带。
 * 所以本文件的解析策略比 `ai-breakdown.ts` 更硬：
 *
 *   - 拿不到数 → `unparseable`，**绝不猜**（「约两小时」不是 120）
 *   - 拿到数 → 一律夹到 `[MIN_DURATION_MINUTES, MAX_DURATION_MINUTES]`，
 *     并**如实标记夹过**（`clamped`），让界面能说「模型给的数超范围，已夹到上限」
 *   - 负数 / NaN / Infinity → **拒绝**，不是夹住
 *
 * 「拒绝」与「夹住」的分界不是美观，而是**方向**：
 * 负数是模型搞错了语义（该说失败），超上限只是量级过大（该夹住并告知）。
 * 把 -30 夹成 5 会让用户拿到一个**看起来正常但完全错误**的估计 ——
 * 那比一句「没读懂」危险得多。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 历史耗时是出境面里唯一会**随使用时间无限增长**的一项
 *
 * `title` / `note` 有天然上界（用户自己写的），而 `history` 每完成一次专注
 * 就多一条。不封顶的话，一个用了两年的账号每次估时都会把上千条专注记录
 * 发出去 —— 出境面随时间单调增长，这在隐私上不可接受。
 *
 * 所以只取**最近 `MAX_HISTORY_ROWS` 条**（照 `packages/domain/src/ai-feedback.ts`
 * 里 `MAX_ROWS = 500` 的做法：数组约定为时间正序，截断保留**尾部**）。
 * 上限比 500 小得多，因为那 500 条只在本机参与统计、不出境，而这里每一条都会出境。
 *
 * ## 🔴 单位必须在提示词里显式写明，而且只收整数
 *
 * 模型对「分钟」没有默认共识：同一个提示词它可能回 `90`、`90 分钟`、
 * `1.5 小时`、`约两小时`。前三者里 `1.5 小时` 最危险 —— 它**有数字**，
 * 于是任何「提取第一个数字」的实现都会把它读成 1.5 分钟（一个看起来合理的错数）。
 *
 * 因此解析分两步（见 `parseDurationMinutes`）：先找**贴着分钟单位**的数字，
 * 找不到而文中又出现小时单位时**直接判失败**，绝不把小时的数当分钟用。
 */

import {
  renderHintBlock,
  type PreferenceHint,
} from '@heyta/domain';
import {
  invokeRouted,
  type AiFeature,
  type AiRoutingConfig,
  type AiRoutingPolicy,
  type EgressConsent,
  type HealthMap,
  type RoutedDeps,
} from '@heyta/ai';
import type { AiFailureReason } from '@heyta/ai';
import {
  CALENDAR_ANCHOR_RULES,
  calendarAnchor,
  calendarAnchorLine,
} from './calendar-anchor.js';
import {
  outputLanguageDirective,
  type AiOutputLocale,
} from './ai-output-language.js';
import { describeRoutedFailure } from './ai-failure-fallback.js';

/**
 * 一次估时的下限（分钟）。
 *
 * 比它短的事不值得进时间线，而且模型对「1 分钟」这种量级的估计毫无意义。
 * 低于下限的返回值会被**夹到**这里（夹住，不是拒绝）。
 */
export const MIN_DURATION_MINUTES = 5;

/**
 * 一次估时的上限（分钟）。
 *
 * 🔴 **这是安全措施，不是产品判断。** 模型完全可能返回 `1e9` 或
 * `999999999`（实测里 `1e9` 这种写法并不罕见）。不封顶的话，这个数会
 * 直接进时间线、进 op、同步到每一台设备。
 *
 * 取 8 小时的理由：它接近「一个人一天真正能投入的上限」，
 * 超过它的返回值说明模型在胡诌，或者这个任务本来就该拆开。
 */
export const MAX_DURATION_MINUTES = 8 * 60;

/**
 * 出境的历史耗时最多几条。
 *
 * 🔴 出境面的封顶（见文件头）。只取**最近**这些条 —— 偏好是「最近的我」，
 * 不是「历史上的我」，而且估时看的本来就是近期手感。
 */
export const MAX_HISTORY_ROWS = 20;

/** 一条历史专注记录（`FocusSession` 的结构化子集）。 */
export interface DurationHistoryRow {
  /** 当时估的时长（ms）。 */
  plannedMs: number;
  /** 实际花掉的时长（ms）。 */
  actualMs: number;
}

export interface DurationSource {
  title: string;
  /**
   * 🔴 **界面语言。必填、无默认值** —— `locale?:` 的失效方向是「忘了传 → 悄悄按中文
   * 输出」，而那正是这条要修的 bug（模型回的中文文字被用户确认**写进数据并同步**）。
   * 必填把它变成编译错误。为什么指令是中文而输出语言跟着界面走，
   * 见 `ai-output-language.ts` 文件头。
   */
  locale: AiOutputLocale;
  /** 已有备注。**会一起发出去** —— 所以必须出现在 `fields` 里被披露。 */
  note?: string;
  /**
   * 历史耗时。**时间正序**（旧 → 新），本模块只取尾部 `MAX_HISTORY_ROWS` 条。
   *
   * ⚠️ 它是可选的，但**只要传了且可用条数 > 0，就一定会出现在 `fields` 里**。
   * 「可选」指的是数据可能没有，不是「可以偷偷不发」。
   */
  history?: readonly DurationHistoryRow[];
  /**
   * 时间源（epoch ms）。默认 `Date.now`。
   *
   * 🔴 **必须可注入**，两条理由与 `CaptureSource.now` 逐字同源：
   *
   *   1. 输出依赖"今天是几号" —— 用真实时钟写测试会得到一个**过几天就变红**的用例。
   *   2. 披露与请求必须用同一个 `now`：壳一次构造好 `source`，同一个对象既进
   *      `buildDurationInvocation`（界面披露）也进 `requestDuration`（真正发送）。
   *
   * ⚠️ 注意本模块**其它**数据的时间性：历史记录刻意只送"估了多久 / 实际多久"
   * 两个时长，**不送时间戳**。`today` 送的是这台设备的日历日 —— 它是这条链路上
   * 唯一的时间信息，所以必须逐字段披露（见 `buildDurationInvocation`）。
   */
  now?: number;
}

/** 这条记录能不能参与估计：两端都必须是正的有限数（比值才成立）。 */
function isUsableHistoryRow(row: DurationHistoryRow): boolean {
  return (
    Number.isFinite(row.plannedMs) &&
    row.plannedMs > 0 &&
    Number.isFinite(row.actualMs) &&
    row.actualMs > 0
  );
}

/**
 * 真正会出境的历史条数。
 *
 * ⚠️ **先过滤再截断**（不是先截断再过滤）：否则尾部几条脏数据会把
 * 可用的额度占掉，用户明明有 20 条好记录却只发出去 17 条。
 * 代价是「最近 N 条」里的 N 是**最近 N 条可用记录** —— 这才是本意。
 */
export function countUsableDurationHistory(
  history: readonly DurationHistoryRow[] | undefined,
): number {
  if (history === undefined) return 0;
  let n = 0;
  for (const row of history) {
    if (isUsableHistoryRow(row)) n += 1;
  }
  return n;
}

/**
 * 取出**会出境**的那些历史记录：可用 + 只留最近 `MAX_HISTORY_ROWS` 条。
 *
 * 导出它是为了让界面能说清「基于你过去 N 次」，而 N 必须与**真正发出去的**
 * 条数一致 —— 界面自己数一遍就会漂移。
 */
export function selectDurationHistory(
  history: readonly DurationHistoryRow[] | undefined,
): DurationHistoryRow[] {
  if (history === undefined) return [];
  const usable: DurationHistoryRow[] = [];
  for (const row of history) {
    if (isUsableHistoryRow(row)) usable.push(row);
  }
  // 截断保留**尾部**（数组约定为时间正序），与 ai-feedback.ts 的 MAX_ROWS 同构。
  return usable.length > MAX_HISTORY_ROWS ? usable.slice(usable.length - MAX_HISTORY_ROWS) : usable;
}

/** ms → 分钟的展示值（保留一位小数，短专注不会被四舍五入成 0）。 */
function msToMinutes(ms: number): number {
  return Number((ms / 60_000).toFixed(1));
}

/**
 * 把历史渲染成**给模型看**的一段。
 *
 * 🔴 单位在**每一段**都写清楚。模型不会记住系统提示里的单位，
 * 而一行「计划 25，实际 45」在它眼里既可能是分钟也可能是小时。
 */
function renderHistoryBlock(rows: readonly DurationHistoryRow[], total: number): string {
  const lines = [
    `这个任务的历史专注记录（旧 → 新，共 ${String(total)} 条，这里只给最近 ${String(rows.length)} 条；单位一律是分钟）：`,
  ];
  for (const row of rows) {
    lines.push(
      `- 当时估 ${String(msToMinutes(row.plannedMs))} 分钟，实际花了 ${String(msToMinutes(row.actualMs))} 分钟`,
    );
  }
  lines.push('请参考这些记录校正你的估计，但不要照抄其中某一个数。');
  return lines.join('\n');
}

/**
 * 构造调用。
 *
 * 🔴 `fields` 不是装饰：出境授权是按 `(功能, 目的地)` 绑定的，
 * 而**披露**（"将要送出这些字段"）读的就是它。少写一个字段名，
 * 用户就会在不知情的情况下多送一份数据出去。
 *
 * 所以规则与 `ai-breakdown.ts` 一致：**`user` 里出现的每一个数据字段，
 * `fields` 里必须有同名项**。有测试逐字段核对这件事。
 *
 * ⚠️ `today` 也算一个字段（与 `ai-capture.ts` 同一条纪律）：它是这台设备的本地日期，
 * 一条关于用户的信息，而且确实随请求出境。藏起来就是"披露里没有、请求里有"。
 */
export function buildDurationInvocation(
  source: DurationSource,
  /**
   * 记忆层推断出的偏好提示（见 `@heyta/domain` 的 `renderPreferenceHints`）。
   *
   * ⚠️ **可选参数是刻意的，而且默认值指向更保守的一侧**：忘了传 `hints`
   * 的后果是**少发**偏好（fail closed），而不是多发数据。
   * 判据见 `buildBreakdownInvocation` 的说明。
   */
  hints: readonly PreferenceHint[] = [],
): {
  feature: AiFeature;
  system: string;
  user: string;
  fields: readonly string[];
} {
  const fields: string[] = ['today', 'title'];
  // 🔴 锚点由 `calendar-anchor.ts` **唯一**生产（与 capture / breakdown / prioritize 同一行）。
  //    `today` 是这台设备的本地日历日：一条关于用户的信息，且确实随请求出境 ⇒ 必须披露。
  //    对估时它不是装饰 —— 「每周的周报」这类标题的耗时取决于它落在本周的哪天，
  //    而模型**不许自己算日期**（实测错过四个半月，见 `calendar-anchor.ts` 文件头）。
  const lines = [calendarAnchorLine(calendarAnchor(source.now)), `任务标题：${source.title}`];

  if (source.note !== undefined && source.note.trim() !== '') {
    fields.push('note');
    lines.push(`已有备注：\n${source.note}`);
  }

  const total = countUsableDurationHistory(source.history);
  const rows = selectDurationHistory(source.history);
  if (rows.length > 0) {
    // 🔴 一个字段名 `history`，不是每行一个 —— 理由同偏好：
    // 披露是给用户读的，逐行拆开只会让它不可读。
    fields.push('history');
    lines.push(renderHistoryBlock(rows, total));
  }

  // 🔴 偏好看成**一个**字段（`preferences`），不是每项一个（同 ai-breakdown.ts）。
  const hintBlock = renderHintBlock(hints);
  if (hintBlock !== '') {
    fields.push('preferences');
    lines.push(hintBlock);
  }

  return {
    feature: 'duration-estimate',
    system: [
      '你是一个任务耗时估计助手。估计用户给出的任务需要多少分钟。',
      '只输出一个整数，单位是分钟。不要输出单位、不要输出解释、不要输出标点或任何其他文字。',
      `数值必须在 ${String(MIN_DURATION_MINUTES)} 到 ${String(MAX_DURATION_MINUTES)} 之间；如果你觉得更长，就报上限。`,
      '如果给出了这位用户的历史耗时，请据此校正你的估计，但不要照抄其中某一个数。',
      '',
      // 🔴 日期硬规则与锚点是**一对**（同 `ai-breakdown.ts` / `ai-prioritize.ts`）：
      // 只给"今天是"而不给规则，模型仍会凭训练语料里的"今天"去推相对日期。
      // 本功能的输出是一个整数分钟，规则约束的是它**读**标题里相对日期的方式。
      CALENDAR_ANCHOR_RULES,
      '',
      outputLanguageDirective(source.locale),
    ].join('\n'),
    user: lines.join('\n'),
    fields,
  };
}

// ─────────────────────────────────────────────────────────────
// 解析
// ─────────────────────────────────────────────────────────────

/**
 * 数字字面量。**带指数形式** —— 模型真的会回 `1e9`。
 *
 * ⚠️ 不用 lookbehind / named group / `\p{...}`（要在 Hermes 上跑，见 AGENTS.md）。
 * 允许前置 `-` 是为了**识别出负数并拒绝它**，而不是让正则直接跳过负号
 * （跳过的话 `-30` 会被读成 `30`，方向反了还看不出来）。
 */
const NUMBER_TOKEN = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;

/** 「这个数说的是小时」——出现它而**没有**分钟单位时，判失败。 */
const HOURS_UNIT = /(?:小时|小時|hour|hrs?\b)/i;

/**
 * 解析模型返回的文本，得到一个**未夹取**的整数分钟；拿不到就 `undefined`。
 *
 * 步骤（顺序是承重的）：
 *
 *   1. 先找**贴着分钟单位**的数字 —— 这是最可信的形态（`90 分钟`、`90min`）。
 *      ⚠️ 必须排在小时判断**前面**：`120 分钟（约两小时）` 里既有分钟又有小时，
 *      先判小时会把它误杀。
 *   2. 没有分钟单位、但文中出现小时单位 → **判失败**。
 *      这是防 `1.5 小时` 被读成 `1.5` 的唯一一道闸。
 *   3. 都没有 → 取第一个数字（模型听话时回的就是裸数字 `90`）。
 *
 * 之后：
 *   - 非有限数（`NaN` / `Infinity`）→ `undefined`
 *   - 负数 → `undefined`（**拒绝，不是夹住**，见文件头）
 *   - 小数 → 四舍五入成整数分钟（模型偶尔回 `90.5`）
 *   - `0` 保留为 `0`，由 `clampDurationMinutes` 夹到下限
 */
export function parseDurationMinutes(text: string): number | undefined {
  // 去掉代码围栏本身（内容保留），与 `parseBreakdownItems` 一致
  const cleaned = text.replace(/^\s*```[a-zA-Z]*\s*$/gm, '').trim();
  if (cleaned === '') return undefined;

  const withUnit = /(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(?:分钟|分鐘|min\b|mins\b|minute)/i.exec(
    cleaned,
  );
  let token: string | undefined;
  if (withUnit !== null && withUnit[1] !== undefined) {
    token = withUnit[1];
  } else if (HOURS_UNIT.test(cleaned)) {
    // 🔴 单位错了就**别猜**：「约两小时」既没有分钟单位、量级也对不上。
    // 注意这一支必须排在「取第一个数字」前面，否则 `1.5 小时` 会被读成 1.5 分钟。
    return undefined;
  } else {
    const bare = NUMBER_TOKEN.exec(cleaned);
    token = bare === null ? undefined : bare[0];
  }

  if (token === undefined) return undefined;

  const value = Number(token);
  if (!Number.isFinite(value)) return undefined;
  // 🔴 负数拒绝（不是夹住）。0 留给夹取处理 —— 它是「太短」，不是「方向错了」。
  if (value < 0) return undefined;

  return Math.round(value);
}

/** 把分钟数夹进 `[MIN, MAX]`。**这是唯一的夹取处。** */
export function clampDurationMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return MIN_DURATION_MINUTES;
  if (minutes < MIN_DURATION_MINUTES) return MIN_DURATION_MINUTES;
  if (minutes > MAX_DURATION_MINUTES) return MAX_DURATION_MINUTES;
  return minutes;
}

/**
 * 解析 + 夹取。**调用方通常只该用这个。**
 *
 * 返回值保证是 `[MIN, MAX]` 内的**整数**（`Number.isInteger` 为真）。
 */
export function parseDurationResult(text: string): number | undefined {
  const raw = parseDurationMinutes(text);
  if (raw === undefined) return undefined;
  return clampDurationMinutes(raw);
}

// ─────────────────────────────────────────────────────────────
// 请求
// ─────────────────────────────────────────────────────────────

/**
 * 「标题 → 工期」——**这是本模块对外交付的形状**。
 *
 * 🔴 确定性时间线视图是这条数据的第二个消费者：它**接收**一份
 * `DurationEstimate` 列表，然后自己决定怎么排。本模块**只负责估时**，
 * 不做排程 / 拓扑排序 / 甘特图 —— 所以这里刻意只有一个二元组，
 * 没有任何时间轴字段（开始时间、依赖、顺序）能让人误以为该在这里算。
 *
 * ⚠️ 时间线那边**不许** import 本文件之外的东西，本文件也**不 import**
 * 时间线的任何文件：单向、零耦合。谁需要多个任务的工期，就自己调
 * `requestDuration` 多次，把结果收成一个列表。
 */
export interface DurationEstimate {
  /** 任务标题 —— 时间线视图按它对齐。 */
  title: string;
  /** 工期（分钟，已夹到 `[MIN, MAX]` 的整数）。 */
  minutes: number;
}

/** 声称是一个耗时估计，但**没人确认过**。命名刻意区分于 `AiSuggestion`。 */
export interface DurationProposal extends DurationEstimate {
  /** 这份提议来自哪 —— UI 必须标出来（云端 vs 本机）。 */
  destination: string;
  /**
   * 模型给的数超出了范围，已被夹住。
   *
   * 🔴 **界面必须如实显示它。** 静默夹取等于替用户做了决定，
   * 而他看到的那个数并不是模型说的数。
   */
  clamped: boolean;
  /** 这次估计实际参考了几条历史（已封顶）。UI 用它说「基于你过去 N 次」。 */
  historyRows: number;
}

export type DurationFailureReason =
  | 'ai-unavailable'
  | 'unparseable'
  | 'empty-title';

export type DurationOutcome =
  | {
      ok: true;
      proposal: DurationProposal;
      /**
       * 🔴 **两个分支都在顶层带 `health`，且都不进 op-log。**
       *
       * 熔断状态是本机偏好：A 机器的端点连不上，不代表 B 机器的连不上。
       * 形状与 `BreakdownOutcome` 一致 —— 调用方不必先判别 `ok` 才能落盘。
       */
      health: HealthMap;
    }
  | {
      ok: false;
      reason: DurationFailureReason;
      /** 路由层给的**原因码**。壳据此取词条 —— 见 §7.10 通道 #5。 */
      cause?: AiFailureReason;
      /**
       * 这次**实际打到的**端点 URL（来自 `AiFailure.endpointUrl`）。
       * 壳靠它把 `network` 分成"真连不上"和"本机端点拒绝了你的来源"
       * （ADR-0045 §4）。**原样透传，不在这里判断。**
       */
      endpointUrl?: string;
      message: string;
      /**
       * 🔴 **失败分支也要带 health。** 这正是最需要它的地方 ——
       * 端点失败才会让熔断计数器 +1，不记的话重启后忘了、再撞一次。
       *
       * 没有任何端点被尝试过（比如标题为空）时是 `{}`。
       */
      health: HealthMap;
    };

export interface RequestDurationDeps {
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  policy?: AiRoutingPolicy;
  routed?: RoutedDeps;
  /**
   * 记忆层推断出的偏好提示（见 `@heyta/domain` 的 `renderPreferenceHints`）。
   *
   * 🔴 可选的，但「忘了传」的后果是**少发偏好**（fail closed），
   * 而不是多发数据 —— 判据见 `buildDurationInvocation`。
   */
  preferences?: readonly PreferenceHint[];
}

/**
 * 🔴 走完整条路：出境闸门 → 路由 → 回退 → 解析 → 夹取。
 *
 * 失败一律返回**可展示的原因**，绝不抛错给 UI ——
 * "AI 灰着"是正常状态，不是异常（与 `requestBreakdown` 同一条纪律）。
 */
export async function requestDuration(
  source: DurationSource,
  deps: RequestDurationDeps,
): Promise<DurationOutcome> {
  if (source.title.trim() === '') {
    // 还没走到路由，没有任何端点被尝试 —— 空 health。
    return { ok: false, reason: 'empty-title', message: '任务没有标题，估不出耗时。', health: {} };
  }

  const invocation = buildDurationInvocation(source, deps.preferences ?? []);

  const outcome = await invokeRouted(
    deps.routing,
    invocation,
    deps.consents,
    deps.policy,
    deps.routed ?? {},
  );

  const result = outcome.result;
  if (!result.ok) {
    // 🔴 **优先用 `packages/ai` 给出的具体原因，而不是在这里重新概括。**
    // 路由层区分得很细（缺能力 / 熔断 / 地址被拒 / 全部远端 / 端点不存在），
    // 只有它没给句子时才退回下面的粗粒度文案。
    const specific = result.message.trim();
    return {
      ok: false,
      reason: 'ai-unavailable',
      cause: result.reason,
      endpointUrl: result.endpointUrl,
      message: specific === '' ? describeRoutedFailure(result.reason) : specific,
      // 🔴 失败也要落盘 —— 这通常正是熔断计数器刚 +1 的那一次。
      health: outcome.health,
    };
  }

  const raw = parseDurationMinutes(result.suggestion.text);
  if (raw === undefined) {
    return {
      ok: false,
      reason: 'unparseable',
      message: '模型返回的内容里没有能识别的分钟数（比如「约两小时」这种写法）。可以再试一次，或者自己填一个。',
      // 请求本身成功了（所以 health 会有 lastSuccessAt），只是内容没法用。
      health: outcome.health,
    };
  }

  const minutes = clampDurationMinutes(raw);
  return {
    ok: true,
    proposal: {
      title: source.title,
      minutes,
      destination: result.suggestion.destination,
      // 🔴 夹过就说夹过 —— 静默夹取会让用户以为模型说的就是这个数。
      clamped: minutes !== raw,
      historyRows: selectDurationHistory(source.history).length,
    },
    // 🔴 两个分支形状一致 —— 调用方不必先判别 `ok` 才能落盘熔断状态。
    health: outcome.health,
  };
}
