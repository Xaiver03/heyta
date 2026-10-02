/**
 * AI 一句话捕获（功能 ⓿：capture）
 * ==================================
 *
 * 把用户敲进去的**一句自然语言**解析成任务字段的**候选**：
 * 标题 / 截止时间 / 优先级。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个文件是 `AiFeature` 里那个 `'capture'` 字面量的**第一个实现**。
 *
 * 在此之前，`'capture'` 只活在两处：`egress.ts` 的联合类型，和设置界面里
 * 那张"逐功能授权"的表。也就是说 —— **用户可以为一个不存在的功能授权**。
 * 那种状态下最危险的不是"功能没做"，而是**披露与实现之间没有任何东西连着**：
 * 授权记录指向一个没人读的功能名，谁都可以声称自己实现了它。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 与 `@heyta/domain` 的 `parseCapture` 是**两条路，不是一条**
 *
 * `packages/domain/src/capture.ts` 是一个**确定性规则解析器**：
 * 不调用模型、可测、离线可用。它是这条产品线的**主干**。
 *
 * 本文件是**模型路径**，只在用户明确点了"AI 捕获"、且配置了端点时才跑。
 * 两者**不互相调用、不互相兜底**：
 *   - 规则路径不会被模型污染（规则一旦修好就永远修好，模型会随版本漂移）；
 *   - 模型路径不会偷偷用规则结果冒充"AI 读懂了"。
 *
 * 界面上谁先谁后、要不要合并，是**调用方的交互决策**，不是本文件的。
 *
 * ## 🔴🔴 日期：可以交给模型**推算**，但绝不能当成事实
 *
 * 这条是本文件最需要写清楚的一段，因为 `@heyta/ai` 的文件头记着一次
 * **真实实测**：同一天、同一句「明天下午三点开周会」，规则内核算出
 * `2026-09-27`，而真实模型给出 `2026-05-08` —— **错了约 4 个半月**。
 * 结论写在那儿：**模型没有"今天"的概念，让它算"明天"等于让它猜。**
 *
 * 那为什么这里还要模型输出 `dueDate`？因为本功能的定位是"候选"，不是"写入"：
 *
 *   1. **我们把"今天"一起送出去**（字段名 `today`）。有了这个锚点，
 *      模型是在**推算**而不是在**回忆**。上面那次实测的失败前提正是
 *      "模型不知道今天" —— 本文件把那个前提消掉了。
 *   2. **解析器严格校验，拿不到就丢**（`normalizeDueDate`）。不存在的日期
 *      （2 月 30 日）、相对说法（"明天下午三点"）、非字符串，一律**丢弃**，
 *      **绝不编一个补上**。
 *   3. **它只是候选**。`requestCapture` 返回的是 `CaptureProposal` ——
 *      没有任何形状能变成 op（见 `packages/ai` 的 `AiSuggestion`），
 *      而界面必须让用户**看见并改**之后才走 `onApply`。
 *
 * ⚠️ 即便这样，**模型算出来的日期仍然可能是错的**（它只是有了锚点，不是有了保证）。
 * 所以"日期不准"这件事在本功能里**不是 bug，是被设计承认的已知风险** ——
 * 它由"候选 + 用户确认 + 可编辑"三道来吸收。谁要是把这里的日期直接写库，
 * 就是把一个已知会错的输入变成了用户的数据。
 *
 * ## 🔴 上限是安全措施，不是美观问题
 *
 * 捕获的产物（标题）会变成一条任务：**同步到每一台设备、进每一次冲突合并、
 * 进每一条 op**。所以长度必须封顶。输入与响应也各自封顶 ——
 * 那是防止一次调用把几兆字节塞进 prompt 或解析器。
 */

import {
  Priority,
  parseLocalDate,
  renderHintBlock,
  type PreferenceHint,
} from '@heyta/domain';
import {
  invokeRouted,
  type AiFeature,
  type AiRoutingConfig,
  type AiRoutingPolicy,
  type EgressConsent,
  type EgressDestination,
  type HealthMap,
  type RoutedDeps,
} from '@heyta/ai';
import type { AiFailureReason } from '@heyta/ai';
import {
  outputLanguageDirective,
  type AiOutputLocale,
} from './ai-output-language.js';
import { describeRoutedFailure } from './ai-failure-fallback.js';
import { calendarAnchor, calendarAnchorLine } from './calendar-anchor.js';

/**
 * 一句话输入的字符上限。超出**直接拒绝**（不是截断）。
 *
 * ⚠️ 为什么是拒绝而不是截断：截断后模型看到的是半句话，却会当成完整的一句来解析 ——
 * 用户拿到的是一个**看起来合理、其实少了一半**的结果。拒绝会明说"太长了"，
 * 用户知道该改什么。这也是"宁可判失败，也不要猜"的同一条纪律。
 */
export const MAX_CAPTURE_INPUT_LENGTH = 500;

/**
 * 标题上限。超出截断。
 *
 * 🔴 它是**安全措施**：标题会进 op、会同步到每台设备。
 * 一个 10 万字的标题不是"用户想要"，是一次故障。
 */
export const MAX_CAPTURE_TITLE_LENGTH = 200;

/**
 * 模型响应文本的解析上限。超出**判 unparseable**。
 *
 * ⚠️ 这是解析器的自保：响应是**外部输入**，端点是用户自己配的
 * （可能是个反向代理、也可能是恶意的）。不去解析一段几兆字节的文本，
 * 是为了让"端点返回垃圾"的代价保持为一个可预期的失败，而不是一次卡死。
 */
export const MAX_CAPTURE_RESPONSE_LENGTH = 4000;

export interface CaptureSource {
  /** 用户刚敲进去的那一句话。**这就是要出境的数据本身。** */
  text: string;
  /**
   * 🔴 **界面语言。必填，而且刻意不给默认值。**
   *
   * 提示词本身是中文（那是给模型的指令，不是界面文案），但**输出语言必须跟着界面走** ——
   * 否则英文界面用户点「确认」后，模型回的那条**中文标题会写进数据并同步**，
   * 泄漏的不是文案而是存量数据。理由全在 `ai-output-language.ts` 文件头。
   *
   * 为什么是必填：`locale?:` 加默认值的失效方向是「忘了传 → 悄悄按中文出」，
   * 那正是这条要修的 bug 本身。必填把它变成编译错误。
   */
  locale: AiOutputLocale;
  /**
   * 时间源（epoch ms）。默认 `Date.now`。
   *
   * 🔴 **必须可注入**，两条理由：
   *
   *   1. 本函数的输出依赖"今天是几号" —— 用真实时钟写测试会得到一个
   *      **过几天就变红**的测试（对照 AGENTS.md §7 #25）。
   *   2. 披露与请求**必须用同一个 `now`**。界面在"点按钮"那一刻冻结它，
   *      然后把同一个值传给披露与发送 —— 否则跨过午夜时，
   *      披露里的"今天"和真正发出去的不是同一天（见 `AiCapture.tsx`）。
   */
  now?: number;
}

/**
 * 构造调用。
 *
 * 🔴 `fields` 不是装饰：出境授权是按 `(功能, 目的地)` 绑定的，
 * 而**披露**（"将要送出这些字段"）读的就是它。少写一个字段名，
 * 用户就会在不知情的情况下多送一份数据出去。
 *
 * 所以这里的规则是：**`user` 里出现的每一个数据字段，`fields` 里必须有同名项**。
 * 有测试逐字段核对这件事。
 *
 * ⚠️ `today` 也算一个字段。它看起来"不是用户数据"，但它是**这台设备的本地日期** ——
 * 一条关于用户的信息，而且它确实随请求出境。把它藏起来（不写进 `fields`）
 * 就是"披露里没有、请求里有"，正是本仓库最不能接受的形状。
 */
export function buildCaptureInvocation(
  source: CaptureSource,
  /**
   * 记忆层推断出的偏好提示（见 `@heyta/domain` 的 `renderPreferenceHints`）。
   *
   * ⚠️ **可选参数，默认 `[]`，而且是刻意的** —— 判据是"默认值必须指向更保守的一侧"：
   * 忘了传 `hints` 的后果是**少发**偏好（fail closed），
   * 而不是多发数据。对照 `buildBreakdownInvocation` 的同一条说明。
   */
  hints: readonly PreferenceHint[] = [],
): {
  feature: AiFeature;
  system: string;
  user: string;
  fields: readonly string[];
} {
  const fields: string[] = ['today', 'text'];

  // 🔴 锚点由 `calendar-anchor.ts` **唯一**生产（原来这里自己算 day/weekday，
  //    是"每条链路各写一句"的第一份）。多出来的时区不是装饰：
  //    `dueDate` 要按本地时间写，没有偏移就没有"本地"。
  const anchor = calendarAnchorLine(calendarAnchor(source.now));

  // ⚠️ 输入截断只是**纵深防御**：正常路径上 `requestCapture` 会先拒绝超长输入。
  // 万一有人直接调本函数，也不能让一个几兆字节的字符串进 prompt。
  const raw = source.text.trim();
  const text =
    raw.length > MAX_CAPTURE_INPUT_LENGTH ? raw.slice(0, MAX_CAPTURE_INPUT_LENGTH) : raw;

  const lines = [anchor, `要捕获的一句话：${text}`];

  // 🔴 偏好看成**一个字段**（`preferences`），不是每项一个。
  // 理由：出境授权与披露是按字段名绑定的（见文件头），
  // 而用户要能看懂"这一项是什么"。把几条偏好拆成几个字段名只会让披露更难读。
  const hintBlock = renderHintBlock(hints);
  if (hintBlock !== '') {
    fields.push('preferences');
    lines.push(hintBlock);
  }

  return {
    feature: 'capture',
    system: [
      '你是一个任务捕获助手。把用户给出的一句话解析成任务字段。',
      '只输出一个 JSON 对象，不要输出任何解释、前言或代码围栏。',
      'JSON 的键只有这三个；用不到的键直接省略，不要用 null 占位：',
      '  "title"    —— 任务标题。去掉时间词与优先级词之后的简洁描述。必填。',
      '  "dueDate"  —— 截止时间。本地时间，格式 "YYYY-MM-DDTHH:mm:ss"；只有日期就给 "YYYY-MM-DD"。',
      '  "priority" —— 只能是 "high"、"medium" 或 "low"。',
      '',
      '关于 dueDate 的硬规则：',
      '- 只能依据上面给出的「今天是」来推算，不许凭印象写一个日期。',
      '- 算不出来、或者用户根本没提时间，就**省略 dueDate**。',
      '- 不确定时宁可省略 —— 一个错的日期比没有日期更糟。',
      '',
      outputLanguageDirective(source.locale),
    ].join('\n'),
    user: lines.join('\n'),
    fields,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 🔴 解析：不信任响应形状
// ─────────────────────────────────────────────────────────────────────────

/** 能被捕获的字段名。用于如实告诉用户"模型给了什么、我们丢掉了什么"。 */
export type CaptureField = 'title' | 'dueDate' | 'priority';

/** 解析成功的结果。**它还不是提议** —— 提议要等请求层贴上目的地。 */
export interface ParsedCaptureResult {
  title: string;
  /** 本地日期时间串（`YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm:ss`）。**未做时区转换。** */
  dueDate?: string;
  priority?: Priority;
  /**
   * 模型给了、但我们**没能用上**的字段。
   *
   * 🔴 存在的理由：静默丢字段是本仓库最忌讳的失败形状
   * （对照 AGENTS.md §7 #20：合法实体被静默丢弃）。用户有权知道
   * "它给了一个日期，但那个日期不成立，所以我留空了"。
   */
  dropped: readonly CaptureField[];
}

/**
 * 宽松但严格的本地日期时间。
 *
 * ⚠️ **不用 lookbehind / 命名组 / `\p{...}`** —— 本文件会跑在 Hermes 上
 * （RN 移动壳），那些正则能力的支持面落后且有版本差异（见 `domain/capture.ts`
 * 里 `isDigit` 的长注释，以及 AGENTS.md §7 #26）。
 */
const LOCAL_DATE_TIME = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/;

/**
 * 校验并规范化模型给的日期。
 *
 * 🔴 **拿不到就返回 `undefined`，绝不"补一个合理的"。**
 *
 * 具体拦掉四类：
 *   1. 非字符串（`123`、`{}`、数组）
 *   2. 相对说法（"明天下午三点"、"下周三"）—— 模型**不应该**这么填，
 *      但真填了也不能被当成日期
 *   3. 不存在的日期（`2026-02-30`）—— 靠 `parseLocalDate` 的回读校验拦，
 *      而不是靠 `new Date`（它会把 2 月 30 日静默进位成 3 月 2 日）
 *   4. 越界时间（25 点、61 分）
 */
function normalizeDueDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const m = LOCAL_DATE_TIME.exec(value.trim());
  if (m === null) return undefined;

  const year = m[1]!;
  const month = m[2]!;
  const day = m[3]!;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

  // 🔴 日期是否存在**只有一处判定**：`parseLocalDate`（它回读校验，越界会抛）。
  // 这里只负责把异常翻译成解析器该有的空结果。
  try {
    parseLocalDate(date);
  } catch {
    return undefined;
  }

  const hourRaw = m[4];
  if (hourRaw === undefined) return date;

  const hour = Number(hourRaw);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (hour > 23 || minute > 59 || second > 59) return undefined;

  const hh = hourRaw.padStart(2, '0');
  const mm = m[5]!.padStart(2, '0');
  const ss = String(second).padStart(2, '0');
  return `${date}T${hh}:${mm}:${ss}`;
}

/**
 * 模型给的优先级词 → `Priority`。
 *
 * ⚠️ **只认这四个确切取值**，不做同义词映射（"urgent" / "重要" 一律丢弃）。
 * 理由与"日期不猜"同源：猜错优先级会改变用户看到的排序，
 * 而"丢弃"是**可见的**（进 `dropped`），"猜"是不可见的。
 * 提示词里已经写明了允许的三个取值。
 */
const PRIORITY_WORDS: Readonly<Record<string, Priority>> = {
  high: Priority.High,
  medium: Priority.Medium,
  low: Priority.Low,
  none: Priority.None,
};

function parsePriorityWord(value: unknown): Priority | undefined {
  if (typeof value !== 'string') return undefined;
  return PRIORITY_WORDS[value.trim().toLowerCase()];
}

/** 只接受**普通对象**：数组与原始值（`[]` / `"hi"` / `3` / `null`）都不是。 */
function toPlainObject(parsed: unknown): Record<string, unknown> | undefined {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  // 复制成普通对象：既不依赖原型，也不对 `unknown` 做类型断言
  // （对照 AGENTS.md §7 #14：不要用类型断言去相信外部输入）。
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) record[key] = value;
  return record;
}

/**
 * 取**第一个配平的花括号对象**。
 *
 * ⚠️ 不能写成"第一个 `{` 到最后一个 `}`"：模型一次吐出两个对象时
 * （`{"title":"甲"}\n{"title":"乙"}`），那一段中间夹着 `}` 与 `{`，
 * `JSON.parse` 直接失败 —— 明明有可用的第一个对象，却被判成没读懂。
 * 实测发现的（见测试「多个 JSON 对象时取第一个」）。
 *
 * 手写扫描而不是正则：需要同时跟踪字符串与转义，正则做不干净，
 * 而且不能用 lookbehind（Hermes，见文件头）。
 */
function firstBalancedObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // 括号没配平（例如 `{"title":"x"`）→ 没读懂。
  return undefined;
}

/**
 * 从一段自由文本里挖出那个 JSON 对象。
 *
 * 模型常见的降级形态：包在 ``` 围栏里、带一句前言（"好的，结果如下："）、
 * 或者前后有解释。所以分两步：
 *
 *   ① 整段就是一个 JSON 值 → 直接收；
 *   ② 整段解析不了（有散文）→ 取**第一个配平的对象**。
 *
 * 🔴 关键细节：**①成功但结果不是对象时，直接失败，不走②**。
 * 否则 `[{"title":"x"}]`（模型返回数组 = 形状违规）会被②的括号回退
 * "救"成一个对象 —— 那就是在替模型猜它想说什么。实测抓到的。
 */
function extractJsonObject(text: string): Record<string, unknown> | undefined {
  // 去掉代码围栏本身（内容保留），与 `parseBreakdownItems` 同一手法。
  const unfenced = text.replace(/^\s*```[a-zA-Z]*\s*$/gm, '').trim();
  if (unfenced === '') return undefined;

  try {
    return toPlainObject(JSON.parse(unfenced));
  } catch {
    // 整段不是合法 JSON（多半带了前言）→ 走回退。
  }

  const candidate = firstBalancedObject(unfenced);
  if (candidate === undefined) return undefined;
  try {
    return toPlainObject(JSON.parse(candidate));
  } catch {
    return undefined;
  }
}

/**
 * 解析模型返回的文本。
 *
 * 🔴 **宁可判"没读懂"，也不要猜。** 返回 `undefined` 就是明确的失败语义，
 * 由 `requestCapture` 翻成 `unparseable` 给用户看。
 *
 * 逐层收窄的顺序：
 *   1. 响应太长 → 失败（解析器自保）
 *   2. 挖不出 JSON 对象 → 失败
 *   3. `title` 不是非空字符串 → **整条失败**（标题是这条任务的骨架，没有它就没有任务）
 *   4. `dueDate` / `priority` 各自独立校验，坏了就丢进 `dropped`，**不拖垮整条**
 *
 * ⚠️ 第 4 步的取舍是刻意的：模型把日期算错很常见，但那不该让"它读懂了标题"
 * 这件事一起作废。丢掉坏字段 + 如实标记，比整条判失败更有用，也更诚实。
 */
export function parseCaptureResult(text: string): ParsedCaptureResult | undefined {
  if (text.length > MAX_CAPTURE_RESPONSE_LENGTH) return undefined;

  const record = extractJsonObject(text);
  if (record === undefined) return undefined;

  const rawTitle = record['title'];
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (title === '') return undefined;
  const cappedTitle =
    title.length > MAX_CAPTURE_TITLE_LENGTH
      ? title.slice(0, MAX_CAPTURE_TITLE_LENGTH).trim()
      : title;

  const dropped: CaptureField[] = [];

  // `null` / `undefined` 视同"没给"（提示词要求省略，但模型常写 null ——
  // 把它当"没有"是宽容且正确的解读，不该记成"丢弃了一个字段"）。
  let dueDate: string | undefined;
  const rawDue = record['dueDate'];
  if (rawDue !== undefined && rawDue !== null) {
    dueDate = normalizeDueDate(rawDue);
    if (dueDate === undefined) dropped.push('dueDate');
  }

  let priority: Priority | undefined;
  const rawPriority = record['priority'];
  if (rawPriority !== undefined && rawPriority !== null) {
    priority = parsePriorityWord(rawPriority);
    if (priority === undefined) dropped.push('priority');
  }

  return {
    title: cappedTitle,
    ...(dueDate === undefined ? {} : { dueDate }),
    ...(priority === undefined ? {} : { priority }),
    dropped,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 请求
// ─────────────────────────────────────────────────────────────────────────

/**
 * 一份**候选**。声称是任务字段，但**没人确认过** ——
 * 命名刻意区分于 `Task`：它没有任何形状能变成 op。
 */
export interface CaptureProposal {
  title: string;
  /** 本地日期时间串（`YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm:ss`）。**由调用方决定怎么落库。** */
  dueDate?: string;
  priority?: Priority;
  /** 模型给了但没法用的字段（UI 要如实说）。 */
  dropped: readonly CaptureField[];
  /** 这份候选来自哪 —— UI 必须标出来（云端 vs 本机）。 */
  destination: EgressDestination;
}

export type CaptureFailureReason =
  /** 还没输入内容。 */
  | 'empty-text'
  /** 输入太长（见 `MAX_CAPTURE_INPUT_LENGTH`）。 */
  | 'text-too-long'
  /** 路由层没给出结果（未开启 / 没路由 / 未授权 / 网络失败……）。 */
  | 'ai-unavailable'
  /** 请求成功了，但返回的内容读不成任务字段。 */
  | 'unparseable';

export type CaptureOutcome =
  | {
      ok: true;
      proposal: CaptureProposal;
      /**
       * 🔴 **两个分支都在顶层带 `health`，且都不进 op-log。**
       *
       * 熔断状态是本机偏好：A 机器的端点连不上，不代表 B 机器的连不上。
       * 失败分支尤其需要它 —— 端点失败才会让熔断计数器 +1，
       * 而"最该记的那一次"正是失败的那一次。
       */
      health: HealthMap;
    }
  | {
      ok: false;
      reason: CaptureFailureReason;
      /** 路由层给的**原因码**。壳据此取词条 —— 见 §7.10 通道 #5。 */
      cause?: AiFailureReason;
      /**
       * 这次**实际打到的**端点 URL（来自 `AiFailure.endpointUrl`）。
       * `network` 那一档要按"端点是否回环 + 宿主 Origin 是否回环"分叉诊断，
       * 少了这个字段界面上就只剩"检查网络"那句没用的话。
       * 🔴 **原样透传，不在这里判断**（判断住在壳那一层，见 ADR-0045 §4）。
       */
      endpointUrl?: string;
      message: string;
      /** 没有任何端点被尝试过（比如输入为空）时是 `{}`。 */
      health: HealthMap;
    };

export interface RequestCaptureDeps {
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  policy?: AiRoutingPolicy;
  routed?: RoutedDeps;
  /**
   * 记忆层推断出的偏好提示（见 `@heyta/domain` 的 `renderPreferenceHints`）。
   *
   * ⚠️ 可选，**默认「没有记忆」** —— fail closed：忘了传的后果是少发偏好，
   * 不是多发数据。关闭记忆时调用方传空数组即可（`renderPreferenceHints`
   * 在开关关闭时本身就返回 `[]`，所以两条路径都不可能漏出去）。
   */
  preferences?: readonly PreferenceHint[];
}

/**
 * 🔴 走完整条路：出境闸门 → 路由 → 回退 → 解析。
 *
 * 失败一律返回**可展示的原因**，绝不抛错给 UI ——
 * "AI 灰着"是正常状态，不是异常。
 */
export async function requestCapture(
  source: CaptureSource,
  deps: RequestCaptureDeps,
): Promise<CaptureOutcome> {
  const text = source.text.trim();
  if (text === '') {
    // 还没走到路由，没有任何端点被尝试 —— 空 health。
    return { ok: false, reason: 'empty-text', message: '还没有输入内容。', health: {} };
  }
  if (text.length > MAX_CAPTURE_INPUT_LENGTH) {
    // 同样没走路由：这是本地就能判定的拒绝，不该消耗一次网络调用。
    return {
      ok: false,
      reason: 'text-too-long',
      message: `这句话太长了（${String(text.length)} 个字，上限 ${String(MAX_CAPTURE_INPUT_LENGTH)}）。一句话捕获只处理短句。`,
      health: {},
    };
  }

  const invocation = buildCaptureInvocation(source, deps.preferences ?? []);

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
    //
    // 路由层区分得很细：全部是远端但没允许远程 / 熔断中 / 地址被拒 /
    // 缺能力声明 / 端点不存在。把它们概括成一句"AI 不可用"，
    // 会把用户引去查一个**根本没问题**的地方。
    // 只有路由层没给句子时才退回粗粒度文案。
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

  const parsed = parseCaptureResult(result.suggestion.text);
  if (parsed === undefined) {
    return {
      ok: false,
      reason: 'unparseable',
      message: '模型返回的内容没法读成任务字段。可以再试一次，或者手动填。',
      // 请求本身成功了（所以 health 会有 lastSuccessAt），只是内容没法用。
      health: outcome.health,
    };
  }

  return {
    ok: true,
    proposal: {
      ...parsed,
      destination: result.suggestion.destination,
    },
    // 🔴 两个分支形状一致 —— 调用方不必先判别 `ok` 才能落盘熔断状态。
    health: outcome.health,
  };
}
