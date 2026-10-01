/**
 * AI 拆解任务（功能 ①）
 * ======================
 *
 * 把一句任务描述拆成一份可执行的子项清单。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个文件是 `@heyta/ai` 的**第一个真实消费者**。
 *
 * 在此之前 `invokeRouted()` 没有任何调用点 —— 路由、回退、出境闸门、
 * 熔断全都只有单测，没有一次"从功能出发真的走了一遍"。
 * 那种状态下最危险的失效是：**每层都对，接起来不对**。
 *
 * 🔴 它也把"AI 是输入法，不是业务逻辑"这句话落到了实处：
 * 模型回来的是**一段自由文本**（`AiSuggestion.text`），
 * 本文件负责把它变成一份清单 —— 而清单**最终仍然要用户点确认**
 * 才会被写进备注（`setNote`）。模型不能自己改数据。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 解析策略：宁可判"没读懂"，也不要猜
 *
 * 模型返回的是一坨自由文本。常见的降级形态：编号列表、短横线列表、
 * 带前言（"好的，以下是拆分："）、包在 ``` 代码围栏里、或者干脆是一段散文。
 *
 * 处理原则与"日期不猜"一致：
 * - 明确的列表行 → 收
 * - 一行都没有列表标记 → **只收看起来像条目的短行**，且**丢掉明显的客套前言**
 * - 什么都收不到 → 返回 `unparseable`，让 UI 说"没读懂"，**不硬凑**
 *
 * ## 🔴 上限是安全措施，不是美观问题
 *
 * 模型可能返回 200 条。列表进了备注就会同步到每一台设备、
 * 进每一次冲突合并、进每一条 op。所以数量和长度都必须封顶。
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
  outputLanguageDirective,
  type AiOutputLocale,
} from './ai-output-language.js';

/** 一次拆解最多收多少条。超出直接截断并**如实告诉用户**。 */
export const MAX_BREAKDOWN_ITEMS = 20;

/** 单条子项的最大长度。超出截断。 */
export const MAX_ITEM_LENGTH = 200;

export interface BreakdownSource {
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
 */
export function buildBreakdownInvocation(
  source: BreakdownSource,
  /**
   * 记忆层推断出的偏好提示（见 `@heyta/domain` 的 `renderPreferenceHints`）。
   *
   * ⚠️ **这里是可选参数，而且是刻意的** —— 本项目吃过"可选参数导致
   * fail open"的亏（`isReadable` 曾默认 `() => true`）。区别在于**默认值的方向**：
   * 忘了传 `hints` 的后果是**少发**偏好，属于 fail **closed**；
   * 而 `isReadable` 忘了传的后果是**多读**数据，属于 fail **open**。
   *
   * 判据：**可选参数的默认值必须指向更保守的一侧。**
   */
  hints: readonly PreferenceHint[] = [],
): {
  feature: AiFeature;
  system: string;
  user: string;
  fields: readonly string[];
} {
  const fields: string[] = ['title'];
  const lines = [`任务标题：${source.title}`];
  if (source.note !== undefined && source.note.trim() !== '') {
    fields.push('note');
    lines.push(`已有备注：\n${source.note}`);
  }

  // 🔴 偏好看成**一个字段**（`preferences`），不是每项一个。
  // 理由：出境授权与披露是按字段名绑定的（见文件头的说明），
  // 而用户要能看懂"这一项是什么"。五条拆成五个字段名只会让披露更难读。
  const hintBlock = renderHintBlock(hints);
  if (hintBlock !== '') {
    fields.push('preferences');
    lines.push(hintBlock);
  }

  return {
    feature: 'breakdown',
    system: [
      '你是一个任务拆解助手。把用户给出的任务拆成 3 到 8 个具体的、可执行的子项。',
      '如果给出了用户的历史习惯，请据此调整子项数量与措辞，但不要复述这些习惯。',
      '每个子项一行，用「- 」开头。',
      '不要输出任何解释、前言或结语，只输出这份清单。',
      '',
      outputLanguageDirective(source.locale),
    ].join('\n'),
    user: lines.join('\n'),
    fields,
  };
}

/**
 * 行首的列表标记。**不用 lookbehind**（Hermes 上高风险，见 AGENTS.md）。
 *
 * ⚠️ 分隔符后的空白**按分隔符区分**：
 * - `-` / `1.` / `1)` 后面**必须有**空白，否则 `1.2 版本发布` 会被误拆成 `2 版本发布`
 * - `1、` / `(1)` 后面**可以没有**空白（中文写法常这样：`2、乙`）
 *
 * 第一版对所有分隔符都要求空白，于是 `1、乙` 整行没被认出来 ——
 * 实测发现的（见 `parseBreakdownItems` 的变体测试）。
 */
const LIST_MARKER = /^\s*(?:[-*•·]\s+|\d+[.)]\s+|\d+、\s*|[(（]\d+[)）]\s*)/;

/** 明显的客套前言 —— 整行匹配时才丢。 */
const PREAMBLE = /^(?:好的|好|以下是|下面是|当然|没问题|明白|收到|我|这里|拆分结果|子项|清单)[^。！？\n]{0,20}[：:。！？]?$/;

/** 去掉行内 markdown 强调与行尾空白。 */
function cleanLine(line: string): string {
  return line
    .replace(/\*\*/g, '')
    .replace(/^[\s>*•·]+/, '')
    .replace(/[`~]/g, '')
    .replace(/\s+$/, '')
    .trim();
}

/**
 * 解析模型返回的文本。
 *
 * 返回的条目**已经过长度截断与数量封顶**。
 */
export function parseBreakdownItems(text: string): string[] {
  // 去掉代码围栏本身（内容保留）
  const unfenced = text.replace(/^\s*```[a-zA-Z]*\s*$/gm, '');

  const rawLines = unfenced.split('\n');
  const marked: string[] = [];
  const plain: string[] = [];

  for (const line of rawLines) {
    if (!LIST_MARKER.test(line)) {
      const cleaned = cleanLine(line);
      if (cleaned !== '') plain.push(cleaned);
      continue;
    }
    // 去掉标记后取内容
    const body = cleanLine(line.replace(LIST_MARKER, ''));
    if (body !== '') marked.push(body);
  }

  // 优先用列表行；一条都没有时才考虑散文（并且要过前言过滤）
  let items: string[];
  if (marked.length > 0) {
    items = marked;
  } else {
    if (plain.length === 0) return [];
    // 散文里如果只剩一行且很短，通常是"我做不了"之类的废话 —— 不收
    const kept = plain.filter((l) => !PREAMBLE.test(l));
    if (kept.length < 2) return [];
    items = kept;
  }

  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.length > MAX_ITEM_LENGTH ? item.slice(0, MAX_ITEM_LENGTH).trim() : item;
    if (trimmed === '') continue;
    // 去重（模型经常重复同一条）
    if (out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= MAX_BREAKDOWN_ITEMS) break;
  }
  return out;
}

/** 把条目渲染成 Markdown 清单（未勾选）。 */
export function renderChecklist(items: readonly string[]): string {
  return items.map((item) => `- [ ] ${item}`).join('\n');
}

/**
 * 把清单并入已有备注。
 *
 * 🔴 **绝不覆盖用户已经写下的内容。** 已有备注原样保留在清单**上方**，
 * 中间空一行。这条约束的理由很直接：备注是用户自己写的字，
 * 而 AI 生成的东西是附加物 —— 让附加物吃掉原文是数据损失。
 */
export function mergeChecklistIntoNote(existingNote: string | undefined, items: readonly string[]): string {
  const checklist = renderChecklist(items);
  const existing = existingNote?.trim() ?? '';
  if (existing === '') return checklist;
  return `${existing}\n\n${checklist}`;
}

/** 声称是子项清单，但没人确认过。**命名刻意区分于 `AiSuggestion`。** */
export interface BreakdownProposal {
  items: readonly string[];
  /** 这份提议来自哪 —— UI 必须标出来（云端 vs 本机）。 */
  destination: string;
  /** 是否被截断过（UI 要如实说）。 */
  truncated: boolean;
}

export type BreakdownFailureReason =
  | 'ai-unavailable'
  | 'unparseable'
  | 'empty-title';

export type BreakdownOutcome =
  | {
      ok: true;
      proposal: BreakdownProposal;
      /**
       * 🔴 **两个分支都在顶层带 `health`，且都不进 op-log。**
       *
       * 熔断状态是本机偏好：A 机器的端点连不上，不代表 B 机器的连不上。
       *
       * 早先它只在成功分支上、且藏在 `proposal` 里 —— 两个毛病：
       * 一是调用方要先判别 `ok` 才拿得到（于是"失败时最该记的那次"丢了），
       * 二是位置不对称，`outcome.health` 根本不是一个合法访问。
       *
       * 它说的是**这次路由尝试**，不是这份提议 —— 所以它在顶层。
       */
      health: HealthMap;
    }
  | {
      ok: false;
      reason: BreakdownFailureReason;
      /** 路由层给的**原因码**。壳据此取词条 —— 见 §7.10 通道 #5。 */
      cause?: AiFailureReason;
      message: string;
      /**
       * 🔴 **失败分支也要带 health。**
       *
       * 这正是最需要它的地方 —— 端点失败才会让熔断计数器 +1。
       * 早先的写法把它只放在成功分支上，于是"调用失败 → 状态没存 →
       * 重启后忘了 → 再撞一次"，最该记的那次反而丢了。
       *
       * 没有任何端点被尝试过（比如标题为空）时是 `{}`。
       */
      health: HealthMap;
    };

export interface RequestBreakdownDeps {
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  policy?: AiRoutingPolicy;
  routed?: RoutedDeps;
  /**
   * 记忆层推断出的偏好提示（见 `@heyta/domain` 的 `renderPreferenceHints`）。
   *
   * 🔴 **类型上没有 `undefined` 的歧义，也没有默认值** ——
   * 但它是可选的，因为"忘了传"的后果是**少发偏好**（fail closed），
   * 而不是多发数据。判据见 `buildBreakdownInvocation` 的说明。
   *
   * 关闭记忆时调用方传空数组即可（`renderPreferenceHints` 在开关关闭时
   * 本身就返回 `[]`，所以两条路径都不可能漏出去）。
   */
  preferences?: readonly PreferenceHint[];
}

/**
 * 🔴 走完整条路：出境闸门 → 路由 → 回退 → 解析。
 *
 * 失败一律返回**可展示的原因**，绝不抛错给 UI ——
 * "AI 灰着"是正常状态，不是异常（计划 §8 决策 2）。
 */
export async function requestBreakdown(
  source: BreakdownSource,
  deps: RequestBreakdownDeps,
): Promise<BreakdownOutcome> {
  if (source.title.trim() === '') {
    // 还没走到路由，没有任何端点被尝试 —— 空 health。
    return { ok: false, reason: 'empty-title', message: '任务没有标题，没什么可拆的。', health: {} };
  }

  const invocation = buildBreakdownInvocation(source, deps.preferences ?? []);

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
    // 路由层已经知道"为什么没有候选端点"，而且它区分得很细：
    // 全部是远端但没允许远程 / 熔断中 / 地址被拒 / **缺能力声明** / 端点不存在。
    //
    // 早先这里把它丢掉，换成一句粗粒度的
    // 「检查端点是否启用、地址是否合法」——
    // 而用户遇到的最常见原因其实是**忘了声明能力**。
    // 那句话会把人引去查两个**根本没问题**的地方。
    //
    // 只有路由层没给句子时才退回粗粒度文案。
    const specific = result.message.trim();
    return {
      ok: false,
      reason: 'ai-unavailable',
      cause: result.reason,
      message: specific === '' ? describeRoutedFailure(result.reason) : specific,
      // 🔴 失败也要落盘 —— 这通常正是熔断计数器刚 +1 的那一次。
      health: outcome.health,
    };
  }

  const items = parseBreakdownItems(result.suggestion.text);
  if (items.length === 0) {
    return {
      ok: false,
      reason: 'unparseable',
      message: '模型返回的内容里没有能识别的子项清单。可以再试一次，或者手动写。',
      // 请求本身成功了（所以 health 会有 lastSuccessAt），只是内容没法用。
      health: outcome.health,
    };
  }

  return {
    ok: true,
    proposal: {
      items,
      destination: result.suggestion.destination,
      truncated: items.length >= MAX_BREAKDOWN_ITEMS,
    },
    // 🔴 两个分支形状一致 —— 调用方不必先判别 `ok` 才能落盘熔断状态。
    health: outcome.health,
  };
}

/**
 * 把失败原因翻成用户看得懂的一句话。
 *
 * 🔴 **每一种原因都要有不同的话。** 如果全都说"AI 不可用"，
 * 用户就不知道该去开总开关、还是去加端点、还是去授权。
 */
/**
 * 🔴 **兜底文案，不是主文案。**
 *
 * 用户看到的那句话应当来自 `packages/ai` —— 那里才知道"为什么没有候选端点"，
 * 而且它区分得细（缺能力 / 熔断 / 地址被拒 / 全部远端 / 端点不存在）。
 *
 * 这个函数只处理 `AiFailure.message` **为空**的情况（正常路径不该走到）。
 *
 * ⚠️ **不要在这里重新概括已经由 `packages/ai` 说明的原因。**
 * 同一句用户可见的文案有两个来源，就一定会漂移 ——
 * 漂移的文案比没有文案更危险，因为它会把人引去查错的地方
 * （本轮修的就是这个：缺能力被说成"检查地址是否合法"）。
 *
 * 如果哪天 `packages/ai` 新增了失败原因，**先去那边加说明**，
 * 而不是在这里补一行 `case`。
 */
function describeRoutedFailure(reason: string): string {
  switch (reason) {
    case 'not-configured':
      return 'AI 还没打开。去「设置」里打开总开关，并添加一个端点。';
    case 'no-route':
      return '没有可用端点能处理这个功能。检查端点是否启用、地址是否合法。';
    case 'egress-not-authorized':
      return '这个功能还没有授权把数据发到所选端点。去「设置」里逐功能授权。';
    case 'fallback-needs-consent':
      return '首选端点失败了，而备用端点会把数据发到别处，所以没有自动切换。需要你重新授权。';
    case 'network':
      return '连不上端点。检查它是不是在运行。';
    case 'http-error':
      return '端点返回了错误。';
    case 'empty-response':
      return '端点返回了空内容。';
    default:
      return 'AI 暂时不可用。';
  }
}

/**
 * 手动清单骨架 —— 🔴 **这不是 AI 生成物，别把它当成 AI。**
 *
 * 当 AI 不可用时，与其什么都不给，不如给一个用户可以直接编辑的空骨架。
 * 它与 AI 路径**完全分离**：不构造调用、不读配置、不发请求。
 *
 * 之所以做成独立函数而不是 `requestBreakdown` 的降级分支，
 * 就是为了让"AI 真的跑了"和"我们给了一张空白表格"在类型上不可能混淆。
 */
export function manualChecklistSkeleton(title: string): string {
  const heading = title.trim() === '' ? '拆解' : title.trim();
  return `## ${heading}\n- [ ] \n- [ ] \n- [ ] `;
}
