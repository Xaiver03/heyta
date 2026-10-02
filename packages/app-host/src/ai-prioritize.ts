/**
 * AI 优先级排序（功能 ②）
 * ==========================
 *
 * 给一批任务，让模型**逐条**给出优先级建议，并附一两句理由。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 出境面：只发「排优先级真正需要」的字段
 *
 * 任务实体上有 `note`（用户自己写的 Markdown）、`tagIds`、`projectId`、
 * `repeatRule` …… 排序**一个都不需要**。所以 `PrioritizeSource` 的类型里
 * 根本不存在这些字段 —— 这不是"记得别发"，是**结构上发不出去**。
 *
 * `AiFeature` 的注释写着 prioritize「要标题 + 截止时间 + 优先级」，
 * 本文件就是那句话的实现。出境面越小，披露越短，用户越容易读懂自己在同意什么。
 *
 * ## 🔴 `fields` 是出境披露的依据
 *
 * 与 `ai-breakdown.ts` 同一条纪律：`user` 里出现的每一个数据字段，
 * `fields` 里必须有同名项。任务数组是**一个**字段名 `tasks`（不是每任务一个），
 * 偏好提示是**一个**字段名 `preferences`。有测试逐字段核对。
 *
 * ## 🔴 id 原样回传 + 白名单核对
 *
 * 模型返回的 `id` 是**它复述的字符串**，不是它生成的。但复述会错：
 * 少一个字符、把 `t1` 写成 `T1`、或者干脆编一个不存在的 id。
 * 而写库是**按 id 定位任务**的 —— 一个编造的 id 轻则丢弃，
 * 重则改到另一条任务上（如果恰好撞上真实 id）。
 *
 * 所以解析后**逐条核对 id 来自输入集合**，不认识的直接丢弃。
 * 同时 id **不做任何规范化**（不 trim 成别的、不改大小写）——
 * 一旦"帮忙修正"，"来自输入"这件事就不再可验证。
 *
 * ## 🔴 优先级必须收敛到封闭集合
 *
 * 模型的自由文本里会冒出 `urgent` / `P1` / `非常重要` 之类。它们
 * **一个都不收** —— 收下就得替用户决定"urgent 等于几"，而那正是
 * `packages/domain` 里 `Priority` 已经定死的东西（`None=0 … High=3`）。
 * 宁可丢掉一条，也不猜。
 *
 * ## 🔴 上限是安全措施，不是美观问题
 *
 * 一次最多带 `MAX_PRIORITIZE_TASKS` 条。这批任务的内容会进 HTTP 请求体、
 * 会离开设备；理由文本还会进界面。不封顶的话，一次"全选 3000 条"
 * 就是一次 3000 条任务明文的批量出境。理由长度同理封顶。
 */

import {
  Priority,
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
  outputLanguageDirective,
  type AiOutputLocale,
} from './ai-output-language.js';
import { describeRoutedFailure } from './ai-failure-fallback.js';

/**
 * 一次排序最多带多少条任务。
 *
 * 🔴 这是**出境面**的上限，不只是性能：每条任务的标题都会离开设备。
 * 超出部分**静默不参与**，并在结果里如实标记 `truncated`。
 */
export const MAX_PRIORITIZE_TASKS = 50;

/** 单条理由的最大长度。模型经常写一大段，界面放不下，也没有必要。 */
export const MAX_REASON_LENGTH = 200;

/**
 * 建议里允许出现的优先级取值 —— **封闭集合**。
 *
 * 直接复用 `packages/domain` 的 `Priority`（数值越大越优先），
 * 不另造一套字符串枚举：那会立刻产生"两套优先级、需要一张映射表"的问题，
 * 而映射表一定会漂移。
 */
export const PRIORITIZE_PRIORITY_VALUES: readonly Priority[] = [
  Priority.High,
  Priority.Medium,
  Priority.Low,
  Priority.None,
];

/** 一条输入任务。**刻意没有 `note` / `tagIds` / `projectId`。** */
export interface PrioritizeTaskInput {
  id: string;
  title: string;
  /** 截止时间（epoch ms）。 */
  dueDate?: number;
  /** 当前优先级。给模型一个"现状"参照。 */
  priority?: Priority;
}

/** 一次排序的输入。 */
export interface PrioritizeSource {
  tasks: readonly PrioritizeTaskInput[];
  /**
   * 🔴 **界面语言。必填、无默认值** —— `locale?:` 的失效方向是「忘了传 → 悄悄按中文
   * 输出」，而那正是这条要修的 bug（模型回的中文文字被用户确认**写进数据并同步**）。
   * 必填把它变成编译错误。为什么指令是中文而输出语言跟着界面走，
   * 见 `ai-output-language.ts` 文件头。
   */
  locale: AiOutputLocale;
}

/** 一条建议。`id` 必须来自输入集合（由 `parsePrioritizeResult` 核对）。 */
export interface PrioritizeSuggestion {
  id: string;
  priority: Priority;
  reason: string;
}

/** 用户确认后要写回的一项。**只有 id 与新优先级** —— 不含理由（理由不是数据）。 */
export interface PrioritizeDecision {
  id: string;
  priority: Priority;
}

/**
 * 把优先级原文收敛到封闭集合。
 *
 * 收三种写法，其余一律 `undefined`（= 丢弃）：
 *   - 数值：只认 `Priority` 的枚举值 `0..3`
 *   - 英文词：`high` / `medium` / `low` / `none`
 *   - 中文词：`高` / `中` / `低` / `无`（含「高优先级」这类完整词）
 *
 * ⚠️ 大小写与首尾空白**在比较前**归一（那是排版差异，不是语义差异）；
 * 但**不认** `urgent` / `P1` / `非常重要` 这类词 —— 见文件头。
 */
function normalizePriority(raw: unknown): Priority | undefined {
  if (typeof raw === 'number') {
    // 只认枚举值本身。`1` 在 Todoist 里是"最高"，在这里是 Low ——
    // 两套编号不能混，所以不做任何跨体系映射。
    return PRIORITIZE_PRIORITY_VALUES.find((p) => p === raw);
  }
  if (typeof raw !== 'string') return undefined;

  const key = raw.trim().toLowerCase();
  switch (key) {
    case 'high':
    case '高':
    case '高优先级':
      return Priority.High;
    case 'medium':
    case '中':
    case '中优先级':
      return Priority.Medium;
    case 'low':
    case '低':
    case '低优先级':
      return Priority.Low;
    case 'none':
    case '无':
    case '无优先级':
      return Priority.None;
    default:
      return undefined;
  }
}

/**
 * 构造调用。
 *
 * 🔴 `fields` 不是装饰：出境授权是按 `(功能, 目的地)` 绑定的，
 * 而**披露**（"将要送出这些字段"）读的就是它。少写一个字段名，
 * 用户就会在不知情的情况下多送一份数据出去。
 */
export function buildPrioritizeInvocation(
  source: PrioritizeSource,
  /**
   * 记忆层推断出的偏好提示（见 `@heyta/domain` 的 `renderPreferenceHints`）。
   *
   * ⚠️ 可选且默认 `[]`，方向是 fail **closed**：忘了传的后果是**少发**偏好，
   * 而不是多发数据。判据同 `buildBreakdownInvocation`。
   */
  hints: readonly PreferenceHint[] = [],
): {
  feature: AiFeature;
  system: string;
  user: string;
  fields: readonly string[];
} {
  // 🔴 在构造调用这一层就截断，而不是在解析层 —— 出境面必须在
  // **数据被写进 `user` 之前**就收窄。放到后面截断，那批数据已经出过境了。
  const tasks = source.tasks.slice(0, MAX_PRIORITIZE_TASKS).map((task) => ({
    id: task.id,
    title: task.title,
    // 缺省字段**不出现**，而不是写成 null：JSON 里的 `null` 也是一个字段，
    // 而"这条任务没有截止时间"用"键不存在"表达更省出境面。
    ...(task.dueDate === undefined ? {} : { dueDate: task.dueDate }),
    ...(task.priority === undefined ? {} : { priority: task.priority }),
  }));

  // 🔴 任务数组整体算**一个**字段（`tasks`），不是每任务一个字段名。
  // 理由同偏好：出境授权与披露按字段名绑定，而用户要能读懂"这一项是什么"。
  const fields: string[] = ['tasks'];
  const lines = [`待排序任务（JSON）：\n${JSON.stringify(tasks)}`];

  // 🔴 偏好看成**一个**字段（`preferences`），不是每项一个。
  const hintBlock = renderHintBlock(hints);
  if (hintBlock !== '') {
    fields.push('preferences');
    lines.push(hintBlock);
  }

  return {
    feature: 'prioritize',
    system: [
      '你是一个任务优先级排序助手。用户会给你一批任务（JSON 数组，每项含 id、标题，可能含截止时间 dueDate 与当前优先级 priority）。',
      '请为**每一条**任务给出优先级建议，并用界面语言写一两句理由（见末尾「输出语言」）。',
      '优先级只能取这四个值之一："high"、"medium"、"low"、"none"。',
      'id 必须**原样照抄**输入里的值：不许改写、不许补全、不许编造。',
      '如果给出了用户的历史习惯，请据此调整判断，但不要复述这些习惯。',
      '只输出一个 JSON 数组，格式为 [{"id":"...","priority":"high","reason":"..."}]。',
      '不要输出任何解释、前言、结语或代码围栏。',
      '',
      outputLanguageDirective(source.locale),
    ].join('\n'),
    user: lines.join('\n'),
    fields,
  };
}

/** 从模型输出里抠出 JSON。抠不到就返回 `undefined`（不抛错）。 */
function extractJson(text: string): unknown {
  // 去掉代码围栏本身（内容保留）—— 与 `ai-breakdown.ts` 同一写法。
  const unfenced = text.replace(/^\s*```[a-zA-Z]*\s*$/gm, '');

  // 优先取第一个 `[` 到最后一个 `]` 之间的内容：模型常在 JSON 前后
  // 加一句"以下是建议："，而那句话不是数据。
  const start = unfenced.indexOf('[');
  const end = unfenced.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
    } catch {
      // 落到下面的整段解析
    }
  }

  try {
    return JSON.parse(unfenced.trim()) as unknown;
  } catch {
    return undefined;
  }
}

/** 把解析出来的东西尽量当成数组：直接是数组，或是包着数组的对象。 */
function coerceToArray(parsed: unknown): readonly unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null && typeof parsed === 'object') {
    // 常见包装键。取**第一个**是数组的值，不合并多个 ——
    // 合并会把两份互相矛盾的列表缝在一起，而那是模型出错时才有的形状。
    for (const key of ['tasks', 'results', 'items', 'suggestions', 'priorities']) {
      const value = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

/**
 * 解析模型返回的文本。
 *
 * 返回的条目**已经过**：优先级收敛、理由截断、数量封顶、按 id 去重。
 *
 * ⚠️ `knownIds` 传了就**逐条核对** id 是否来自输入集合，不认识的一律丢弃
 * （防模型幻觉）。`requestPrioritize` **总是**传它；单测可以直接调本函数
 * 只验解析规则。
 *
 * 🔴 id **原样保留**，不做 trim 之外的任何加工 —— 连 trim 都不做，
 * 因为"来自输入集合"必须能用 `includes()` 严格验证。
 */
export function parsePrioritizeResult(
  text: string,
  knownIds?: readonly string[],
): PrioritizeSuggestion[] {
  const parsed = extractJson(text);
  if (parsed === undefined) return [];
  const rows = coerceToArray(parsed);

  const allowed = knownIds === undefined ? undefined : new Set(knownIds);
  const out: PrioritizeSuggestion[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;

    const id = typeof record['id'] === 'string' ? record['id'] : '';
    if (id === '') continue;
    // 🔴 白名单核对：模型编的 id 在这里被挡下。
    if (allowed !== undefined && !allowed.has(id)) continue;
    // 去重（模型经常把同一条任务列两遍）。
    if (seen.has(id)) continue;

    // 🔴 非法优先级**丢弃整条**，不退回默认值。
    // 退回默认值会让"模型没读懂"伪装成"模型建议无优先级"，用户看不出来。
    const priority = normalizePriority(record['priority']);
    if (priority === undefined) continue;

    const rawReason = typeof record['reason'] === 'string' ? record['reason'].trim() : '';
    const reason = rawReason.length > MAX_REASON_LENGTH ? rawReason.slice(0, MAX_REASON_LENGTH) : rawReason;

    seen.add(id);
    out.push({ id, priority, reason });
    if (out.length >= MAX_PRIORITIZE_TASKS) break;
  }

  return out;
}

/** 声称是优先级建议，但没人确认过。**命名刻意区分于 `AiSuggestion`。** */
export interface PrioritizeProposal {
  suggestions: readonly PrioritizeSuggestion[];
  /** 这份提议来自哪 —— UI 必须标出来（云端 vs 本机）。 */
  destination: string;
  /** 输入任务是否因为超过上限而被截断过（UI 要如实说）。 */
  truncated: boolean;
}

export type PrioritizeFailureReason =
  | 'ai-unavailable'
  | 'unparseable'
  | 'empty-tasks';

export type PrioritizeOutcome =
  | {
      ok: true;
      proposal: PrioritizeProposal;
      /**
       * 🔴 **两个分支都在顶层带 `health`，且都不进 op-log。**
       *
       * 熔断状态是本机偏好：A 机器的端点连不上，不代表 B 机器的连不上。
       * 位置在顶层（不是藏在 proposal 里），调用方不必先判别 `ok` 才拿得到。
       */
      health: HealthMap;
    }
  | {
      ok: false;
      reason: PrioritizeFailureReason;
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
       * 🔴 **失败分支也要带 health** —— 端点失败才会让熔断计数器 +1，
       * 那正是最该落盘的一次。
       *
       * 没有任何端点被尝试过（比如一条任务都没有）时是 `{}`。
       */
      health: HealthMap;
    };

export interface RequestPrioritizeDeps {
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  policy?: AiRoutingPolicy;
  routed?: RoutedDeps;
  /**
   * 记忆层推断出的偏好提示（见 `@heyta/domain` 的 `renderPreferenceHints`）。
   *
   * 🔴 可选，方向 fail closed：忘了传只会**少发**偏好。
   * 主开关关闭时 `renderPreferenceHints` 本身就返回 `[]`。
   */
  preferences?: readonly PreferenceHint[];
}

/**
 * 🔴 走完整条路：出境闸门 → 路由 → 回退 → 解析 → 白名单核对。
 *
 * 失败一律返回**可展示的原因**，绝不抛错给 UI ——
 * "AI 灰着"是正常状态，不是异常。
 */
export async function requestPrioritize(
  source: PrioritizeSource,
  deps: RequestPrioritizeDeps,
): Promise<PrioritizeOutcome> {
  // 🔴 与 `buildPrioritizeInvocation` 用**同一个**截断规则。
  // 两处各写一份 `slice` 是漂移的种子；这里直接复用被送出去的那一批，
  // 让"核对 id"的集合与"实际发送"的集合在定义上一致。
  const tasks = source.tasks.slice(0, MAX_PRIORITIZE_TASKS);

  if (tasks.length === 0) {
    // 还没走到路由，没有任何端点被尝试 —— 空 health。
    return { ok: false, reason: 'empty-tasks', message: '没有可排序的任务。', health: {} };
  }

  const invocation = buildPrioritizeInvocation(
    { tasks, locale: source.locale },
    deps.preferences ?? [],
  );

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
    // 概括成一句会让用户去查错的地方。只有它没给句子时才退回兜底文案。
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

  const suggestions = parsePrioritizeResult(
    result.suggestion.text,
    // 🔴 白名单 = **实际发出去的那一批**的 id。
    tasks.map((t) => t.id),
  );
  if (suggestions.length === 0) {
    return {
      ok: false,
      reason: 'unparseable',
      message: '模型返回的内容里没有能识别的优先级建议。可以再试一次，或者手动调整。',
      // 请求本身成功了（所以 health 会有 lastSuccessAt），只是内容没法用。
      health: outcome.health,
    };
  }

  return {
    ok: true,
    proposal: {
      suggestions,
      destination: result.suggestion.destination,
      // 如实标记：截断的是**输入**（超过上限的任务根本没发出去）。
      truncated: source.tasks.length > MAX_PRIORITIZE_TASKS,
    },
    health: outcome.health,
  };
}
