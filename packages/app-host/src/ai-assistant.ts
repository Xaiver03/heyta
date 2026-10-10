/**
 * 对话式 AI 助手（多轮 · 多步 · **以一次写意图收尾**）
 * ===================================================
 *
 * ADR-0045 §2.1 的落地。这是 heyta 第一个**能在一次用户轮次里连续走几步**的 AI 入口，
 * 所以它也是全案风险最高的一块 —— 下面每一条约束都写清了"违反会得到什么"，
 * 因为这一层出错的症状是**用户数据已经在机器外了**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴🔴 三条不许动摇的形状
 *
 * 1. **循环放开的是读，写仍然一次一个。**
 *    本文件里出现 `proposal` 的那一刻就停止模型循环；执行档会对低风险意图自动
 *    提交，高风险意图仍返回确认提案。
 *    理由（ADR-0045 §2.1）：一次对话里连续落 5 个 op，等于让模型替用户做了
 *    5 次"要不要改"的判断；而"AI 改错了"这种失败模式**只在写入上不可逆**。
 *    ⚠️ 这不等于"不能建多条任务" —— 那是**一个**提案内含多条（§2.5），
 *    仍然是一次确认、一次 `submit`。
 *
 * 2. **出境披露在循环之前一次算完，且判据吃的是目录声明。**
 *    每一步的工具观察结果**会回送给模型**，而那些观察结果是用户数据。
 *    所以 `fields` 必须**先**包含它们，靠运行时补披露就是"先发出去再解释"。
 *    并集从 `LOCAL_API_TOOLS[].egressFields` 取 —— 声明住在**目录**里而不是这里，
 *    因为目录才是"这个工具会读到什么"的唯一事实源。
 *    🔴 运行时还有一道复查：真的把观察结果送出去之前，把它的**实际字段名**
 *    与已披露集合逐项比对，出现集合外的字段 ⇒ **停**（原因码
 *    `egress-outside-disclosed-set`），而不是"已经发了再说"。
 *    这一道拦的是"投影层将来给结果加了一个字段而目录没更新"——
 *    那是唯一一种**声明不足**的事故形状。
 *
 * 3. **三个硬上界触顶时明确报"我停在这里"**，不静默截断（§2.3）。
 *    没有上界的多步循环，出境量由**模型**决定；ADR-0010 的立场是它由
 *    **用户批准的集合**决定。常量住在 `packages/ai`（出境层），本文件只消费。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 为什么 feature 仍是 `'tool-calling'`，而不是新造第六个
 *
 * 会话形态是 `tool-calling` 的**多步版本**，不是一个新的 AI 功能：出境的数据面
 * （用户那句话 + 工具名）相同、需要的端点能力（`tool_calling`）相同、
 * 授权粒度（`(feature, destination)`）也相同。
 * 新造一个 `assistant` 会立刻要求同步：`AiFeature` 词表、`check:ai-coverage`、
 * 逐功能授权界面、中英词条 —— 而那批成本换来的只有"名字更贴切"。
 * ⚠️ 代价要说清：**用户对 `tool-calling` 的出境授权，同时也授权了助手的多步出境**。
 * 这是可接受的，因为助手的出境集合是它的**超集**，而超集由 §2 那条并集披露
 * 在每次会话开始时单独展示一次（壳负责渲染 `planAssistantEgress()` 的结果）。
 *
 * ## 授权前端有两个，判断只有一个
 *
 * `assistantGrants()` 是本包的**第二个授权前端**（ADR-0045 §2.2）：
 * 内置助手不该沿用入站 MCP 那套"逐工具默认关、用户先跳设置页开六个开关"。
 * 但 `isToolGranted()` 只有 `@heyta/local-api` 那一份实现 ——
 * 本文件**不写**任何"有没有授权"的判断，只**构造** grants 对象交给它。
 * ⚠️ 副作用（ADR-0045 §2.2 明写）：目录里每加一个工具，助手**自动**多一个能力。
 * 这正是能力清单必须**生成**的原因，也是为什么写工具要靠档位而不是靠"逐个开"。
 */

import {
  MAX_ASSISTANT_EGRESS_BYTES,
  MAX_ASSISTANT_MESSAGES,
  MAX_ASSISTANT_TOOL_STEPS,
  egressBytesFor,
  invokeRouted,
  type AiFailureReason,
  type AiRoutingConfig,
  type AiRoutingPolicy,
  type AssistantLimit,
  type ChatMessage,
  type EgressConsent,
  type EgressDestination,
  type HealthMap,
  type RoutedDeps,
} from '@heyta/ai';
import {
  LOCAL_API_TOOLS,
  TOOL_ENVELOPE_EGRESS_FIELDS,
  findTool,
  type LocalApiConfig,
  type LocalApiHost,
  type LocalApiWriteResult,
} from '@heyta/local-api';

import { MAX_TOOL_CALL_TEXT_LENGTH, parseToolArguments, toToolDescriptors } from './ai-tool-call.js';
import { resolveToolSelection, type ToolSelection, type ToolSelectionRule } from './ai-tool-selection.js';
import {
  aiToolProposalRequiresConfirmation,
  executeAiToolProposal,
  runSelectedTool,
  type AiToolAuthorization,
  type AiToolProposal,
} from './ai-tool-run.js';
import {
  CALENDAR_ANCHOR_RULES,
  calendarAnchor,
  calendarAnchorLine,
} from './calendar-anchor.js';

/**
 * 助手用的出境字段基础项。
 *
 * 🔴 `tool.error` 这一项**不是设计时想到的**，是被 §2 那道运行时复查抓出来的：
 * `get_task` 找不到任务时回的是 `{ error: … }` 这种**观察结果**，而它不住在任何
 * 实体的 `egressFields` 里。它是**每个工具都可能带**的信封字段，
 * 所以声明一次在 `@heyta/local-api`，而不是抄进六个工具。
 *
 * 🔴 `today` 是**日历锚点**（`calendar-anchor.ts` 注入到系统提示里的那一行）。
 * 它必须出现在这里，理由与 `tool.error` 同一条：**披露的依据是 `fields`，
 * 而真正出去的东西在提示词里** —— 注入锚点却不声明，等于出境了一项没说过的事。
 * 而锚点又**不能不注入**：没有它，模型面对"今天有什么任务"只能自己编一个日期，
 * 那是给用户看错一天的清单（实测前科见 `calendar-anchor.ts` 文件头）。
 */
export const ASSISTANT_BASE_EGRESS_FIELDS = ['text', 'today', 'tools', ...TOOL_ENVELOPE_EGRESS_FIELDS];

/**
 * 助手的能力档位（第二个授权前端的唯一旋钮）。
 *
 * 🔴 当前产品默认是**执行**：低风险写意图自动提交，高风险写意图产出待确认提案。
 * `AssistantTier` 的默认值由 `assistant-tier-settings.ts` 统一提供；本文件只消费
 * 调用方传入的档位，确保只读仍然完全没有写工具授权。
 * ⚠️ 持久化不在本文件：`tier` 由调用方（壳 / 设置存储）传进来。
 */
export type AssistantTier = 'read-only' | 'read-and-propose';

/** 这个档位下模型看得见的工具（读工具两档都有；写工具只在高一级）。 */
export function assistantGrants(tier: AssistantTier): NonNullable<LocalApiConfig['grants']> {
  const grants: Record<string, boolean> = {};
  for (const tool of LOCAL_API_TOOLS) {
    grants[tool.name] = tool.kind === 'read' || tier === 'read-and-propose';
  }
  return grants;
}

/**
 * 循环开始前一次算完的**出境字段并集**。
 *
 * 🔴 从目录的 `egressFields` 取，不在这里列字段名单 —— 列了就是一份抄件，
 * 而抄件一定漂（本仓库对这件事有账）。
 *
 * ⚠️ 档位决定可达集合：`read-only` 档里**写工具根本不进来**，
 * 所以它们的字段不会出现在披露里 —— 披露只说真会发出去的东西。
 */
export function assistantEgressFields(tier: AssistantTier): readonly string[] {
  const grants = assistantGrants(tier);
  const fields = new Set<string>(ASSISTANT_BASE_EGRESS_FIELDS);
  for (const tool of LOCAL_API_TOOLS) {
    if (grants[tool.name] !== true) continue;
    for (const field of tool.egressFields) fields.add(field);
  }
  return [...fields].sort();
}

/**
 * 一份**给用户看**的出境计划（壳在会话开始前渲染它，用户点头才进循环）。
 *
 * 单独成一个函数而不是藏在循环里：披露必须在**任何一次请求之前**成立，
 * 而"必须在之前"这件事最好由类型逼出来 —— 调用方拿到的是一个纯数据，
 * 不需要发任何请求就能渲染。
 */
export interface AssistantEgressPlan {
  readonly tier: AssistantTier;
  readonly fields: readonly string[];
  /** 会进入模型上下文的工具名（工具名本身也是出境数据）。 */
  readonly tools: readonly string[];
  /** 这次会话**最多**发几次模型调用（上界，不是估计）。 */
  readonly maxRequests: number;
  readonly maxMessages: number;
  readonly maxBytesPerRequest: number;
}

export function planAssistantEgress(tier: AssistantTier): AssistantEgressPlan {
  const grants = assistantGrants(tier);
  return {
    tier,
    fields: assistantEgressFields(tier),
    tools: LOCAL_API_TOOLS.filter((tool) => grants[tool.name] === true).map((tool) => tool.name),
    maxRequests: MAX_ASSISTANT_TOOL_STEPS + 1,
    maxMessages: MAX_ASSISTANT_MESSAGES,
    maxBytesPerRequest: MAX_ASSISTANT_EGRESS_BYTES,
  };
}

/** 会话里的一条消息。`history` 由壳持久化（本地；出境的只是这次实际带上的那几条）。 */
export interface AssistantMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/** 本机读结果只需要这四个界面句子；词条选择留在宿主，避免 app-host 依赖 i18n。 */
export type LocalObservationKey =
  | 'web.ai.chat.local.empty'
  | 'web.ai.chat.local.found'
  | 'web.ai.chat.local.untitled'
  | 'web.ai.chat.local.more';

/** 形状与两端的 `t()` 兼容，实际语言由调用方已有的 locale 决定。 */
export type LocalObservationTranslate = (
  key: LocalObservationKey,
  vars?: Record<string, string | number>,
) => string;

/** 一步的轨迹。界面用它渲染"已调用 N 个工具"（ADR-0045 的"过程可见"）。 */
export interface AssistantStep {
  readonly tool: string;
  readonly kind: 'read' | 'write';
  readonly ok: boolean;
  /** 失败时带工具层的说明原文（诊断数据，不当界面文案）。 */
  readonly note?: string;
}

/** 助手层的失败原因。**每个都独立可展示**，不复用 `ai-unavailable`。 */
export type AssistantFailureReason =
  | 'empty-text'
  | 'text-too-long'
  | 'no-tools-available'
  | 'routing-failed'
  /** 模型一次要求调多个工具。循环**仍然**一次只执行一个 —— 见文件头第 1 条。 */
  | 'multiple-tool-calls'
  /** 模型给的参数读不出来。回问，不猜。 */
  | 'arguments-malformed'
  /** 自动执行的低风险写入被宿主拒绝。 */
  | 'write-failed'
  /** 🔴 某一步要发**披露集合外**的字段 ⇒ 停，不发那一步。 */
  | 'egress-outside-disclosed-set';

export type AssistantOutcome =
  | {
      ok: true;
      kind: 'answer';
      readonly text: string;
      readonly steps: readonly AssistantStep[];
      /** 本轮新增的消息（用户那句 + 助手的回答）。壳负责 append 进历史。 */
      readonly appended: readonly AssistantMessage[];
      readonly health: HealthMap;
      readonly destination?: EgressDestination;
    }
  | {
      ok: true;
      kind: 'proposal';
      readonly text: string;
      readonly proposal: AiToolProposal;
      readonly steps: readonly AssistantStep[];
      readonly appended: readonly AssistantMessage[];
      readonly health: HealthMap;
      readonly destination?: EgressDestination;
      /**
       * 本层的结论：**写意图之后循环就结束**，模型不会再看到它被批准。
       * 低风险意图已落地；高风险意图由界面展示确认卡片。
       */
      readonly stopsHere: true;
    }
  | {
      ok: true;
      kind: 'executed';
      readonly text: string;
      readonly proposal: AiToolProposal;
      readonly result: LocalApiWriteResult;
      readonly steps: readonly AssistantStep[];
      readonly appended: readonly AssistantMessage[];
      readonly health: HealthMap;
      readonly destination?: EgressDestination;
      readonly stopsHere: true;
    }
  | {
      ok: true;
      kind: 'stopped';
      readonly limit: AssistantLimit;
      readonly text: string;
      readonly steps: readonly AssistantStep[];
      readonly appended: readonly AssistantMessage[];
      readonly health: HealthMap;
    }
  | {
      ok: false;
      reason: AssistantFailureReason;
      readonly message: string;
      readonly steps: readonly AssistantStep[];
      /** 路由层的具体原因码，供壳取词条（W1 那一套诊断照原样可用）。 */
      readonly cause?: AiFailureReason;
      /** 这次实际打到的端点 —— 本机端点拒绝来源的诊断要靠它（ADR-0045 §4）。 */
      readonly endpointUrl?: string;
      readonly outsideFields?: readonly string[];
      readonly health: HealthMap;
    };

export interface AssistantTurnDeps {
  readonly routing: AiRoutingConfig;
  readonly consents: readonly EgressConsent[];
  /** 能力档位 —— 第二授权前端的输入，**不是** `localApi.grants`。 */
  readonly tier: AssistantTier;
  readonly host: LocalApiHost;
  /** 最终写入前读取当前助手授权；默认按本轮 tier 生成。 */
  readonly getGrants?: () => LocalApiConfig['grants'];
  /** 本机规则命中后的用户可见句子，由宿主按当前界面语言取唯一词条表。 */
  readonly localize: LocalObservationTranslate;
  /** 一次用户发送的稳定标识；执行档以此防止重放产生重复 op。 */
  readonly executionId?: string;
  /** 已有历史（由壳持久化）。出境的只有这次实际带上消息数组。 */
  readonly history?: readonly AssistantMessage[];
  readonly policy?: AiRoutingPolicy;
  readonly routed?: RoutedDeps;
  /**
   * 预算判定用哪个模型名。**取配置里最长的那个**当上界 ——
   * 字节上界判的是"真要发出去的东西"，而唯一算不进去的字段是 `model` 那一个短串。
   * 让它**偏保守（判定值 ≥ 实际值）**而不是偏松，方向不能反：
   * 偏松意味着实际可能已经越过上限才被发现。
   */
  readonly model?: string;
  /**
   * 日历锚点（「今天是 …」）按哪个时刻算。**注入而不是读真实时钟**，
   * 与 `ai-capture.ts` 的 `source.now` 同一条理由：本层的输出依赖"今天是哪天"，
   * 用真实时钟写出来的测试会过几天变红。省略 = `Date.now()`。
   */
  readonly now?: number;
  /**
   * 规则短路用的规则集。省略 = `DEFAULT_TOOL_SELECTION_RULES`（与单步面板同一份）。
   *
   * 🔴 **不另写一份规则**：单步面板 `requestToolCall` 与助手循环必须按**同一套**
   * 规则判定"这句话本机就能答"。两份规则 = 两个答案，症状是同一句话在
   * 单步面板零出境、在对话里却把数据发出去了，而且两边都"正常工作"。
   */
  readonly rules?: readonly ToolSelectionRule[];
}

const ASSISTANT_SYSTEM_PROMPT = [
  '你是 heyta 任务管理器里的助手，用户可以让你读和改他自己的工作数据。',
  '你可以多次调用只读工具来了解情况，然后再回答或提出一个改动。',
  '需要改动时**一次只提一个**：调用一个写工具，应用会按风险自动执行或交给用户确认。',
  '不要编造工具名，不要把没有对应工具的事情说成能做到。',
  '如果用户的需求在产品里有、但你没有对应工具，就明确说"我这边没有这个能力，但应用里可以做"，并说明在应用里怎么做。',
].join('\n');

/**
 * 本轮的**系统提示** = 固定那段 + 日历锚点 + 日期硬规则。
 *
 * 🔴 锚点按 `now` **每次现算**，不写进上面那个常量：一段会话可以跨过夜，
 * 而"今天"要是被冻在会话创建的那一刻，第二天用户问"今天有什么任务"，
 * 模型就会拿着昨天的日期去查 —— 症状是"助手答得头头是道但整条都错"，
 * 这类错没有任何一层会发现（它完全合法）。
 *
 * ⚠️ 它是 `messages[0]` 的**唯一来源**：调用方把返回值同时交给
 * `assistantMessages()` 和 `invocation.system`，所以两边不可能互相矛盾。
 */
export function assistantSystemPrompt(now: number = Date.now()): string {
  return [
    ASSISTANT_SYSTEM_PROMPT,
    calendarAnchorLine(calendarAnchor(now)),
    CALENDAR_ANCHOR_RULES,
  ].join('\n\n');
}

/**
 * 观察结果里**实际出现**的字段名（一层深度）。
 *
 * 🔴 判据用真实产物的键，不用类型标注：投影层改了什么，这里立刻跟着变 ——
 * 而披露集合是从目录声明来的，两边一对就能发现"声明落后于实现"。
 * ⚠️ 只看一层是刻意的：再深就要为每种嵌套形状写一套遍历，而那一套本身是第二份事实源。
 * 更深的内容由字段的**名字**在目录里声明（例如 `task.note`），因为回送时它是整块内容。
 */
export function observedFieldNames(data: unknown): readonly string[] {
  const names = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        names.add(key);
        // 再下一层也收：投影常常是 `{ task: {...} }` 这种带包装的形状。
        if (inner !== null && typeof inner === 'object' && !Array.isArray(inner)) {
          for (const nested of Object.keys(inner as Record<string, unknown>)) names.add(nested);
        }
      }
    }
  };
  visit(data);
  return [...names].sort();
}

/**
 * 把目录的 `egressFields`（`实体.字段`）折成**该工具允许的字段名集合**。
 *
 * ⚠️ 折成裸字段名是因为观察结果的键就是裸名。这个折法是**有意的宽松**：
 * `task.title` 与 `project.title` 在运行时都算 `title`。
 * 收紧它需要观察结果带类型标签（目前没有），而宽松的代价只是披露比实际更宽 ——
 * 方向是安全的（多披露永远不会把不该发的发出去）。
 */
export function declaredFieldNames(toolName: string): readonly string[] {
  const tool = findTool(toolName);
  if (tool === undefined) return [];
  const names = new Set<string>(
    tool.egressFields.map((field) => field.split('.')[1] ?? field),
  );
  for (const envelope of TOOL_ENVELOPE_EGRESS_FIELDS) names.add(envelope.split('.')[1] ?? envelope);
  return [...names].sort();
}

/**
 * 组装这次要带上模型的消息数组。
 *
 * 🔴 `system` 是**传进来的**，不是在这里现算的：调用方还要把同一个串写进
 * `invocation.system`（出境披露与字节预算都读它）。在这里再算一次就是两份事实源，
 * 而两份迟早会不一致 —— 传进来 ⇒ `messages[0].content === invocation.system`
 * 由**同一个变量**保证。
 *
 * 🔴 `system` / `user` 从这里**派生**，不另写一份。
 */
export function assistantMessages(
  system: string,
  history: readonly AssistantMessage[],
  userText: string,
  toolTranscript: readonly ChatMessage[],
): readonly ChatMessage[] {
  const turn: ChatMessage[] = [{ role: 'system', content: system }];
  for (const message of history) {
    turn.push({ role: message.role, content: message.text });
  }
  turn.push({ role: 'user', content: userText });
  turn.push(...toolTranscript);
  return turn;
}


/** 预算判定里代替真实模型名用的那个串：配置里**最长**的模型名（见 `AssistantTurnDeps.model`）。 */
function budgetModelName(routing: AiRoutingConfig, override: string | undefined): string {
  let longest = override ?? '';
  for (const endpoint of routing.endpoints) {
    if (endpoint.model.length > longest.length) longest = endpoint.model;
  }
  return longest === '' ? 'default' : longest;
}

/**
 * 走一轮：**（必要时）连续读几步 → 一次回答，或以一个写意图收尾**。
 *
 * 失败一律返回可展示的原因，绝不抛错给 UI（与其余五个入口同一纪律）。
 *
 * 🔴 名字必须叫 `request*`：`check:ai-coverage` 判"这个功能有入口吗"用的判据是
 * 实现文件里有没有 `export function request*`。这条不是命名洁癖 —— 它问的是
 * **"用户在哪儿用这个东西？"**，而"碰不到的 AI 功能不是功能，是库"。
 * （它一开始就照红了本文件：那时这里叫 `runAssistantTurn`，界面确实调得到，
 * 但整个包的入口命名一致性也确实是**约定**，改名字比放宽判据便宜。）
 */
/**
 * 本机短路一次性最多列出几条。
 *
 * 这个数字**不是审美**：超过它就不是一条聊天回答了（那是列表界面该做的事），
 * 而"把一整段清单塞进一句回答"会让用户以为助手在复述它读到的全部内容 ——
 * 实际只复述了前 N 条。所以下界必须**明说**还剩多少条没列出。
 */
export const LOCAL_ANSWER_MAX_ITEMS = 8;

/**
 * 把一条**本机读到的**观察结果渲染成回答。渲染不出来就返回 `undefined`。
 *
 * 🔴 为什么允许"渲染不出来"：本函数的职责是**在零出境的前提下给用户一个真答案**，
 * 而不是给任意 JSON 编一句人话。编不出来还硬编，得到的是一句**看起来像回答的谎话**
 * （比"没答"更糟 —— 用户会照着它做决定）。这种情况下调用方退回模型那一步，
 * 而退回这件事本身有测试钉着（见 `ai-assistant.spec.ts` 的"不硬编"那条）。
 *
 * ⚠️ 只认两种形状：数组本身，或对象里**第一个**数组值（投影层就是这么包的，
 * 例如 `{ tasks: [...] }`）。每一项必须有一个能给人看的字：`title` / `name` /
 * `label` / `text`，或者再往里一层（`{ task: { title } }`）。
 * 更深的内容不在这里展开 —— 那是卡片渲染的事，不是回答文案的事。
 */
export function localObservationText(
  _tool: string,
  data: unknown,
  localize: LocalObservationTranslate,
): string | undefined {
  const rows = Array.isArray(data)
    ? data
    : data !== null && typeof data === 'object'
      ? Object.values(data as Record<string, unknown>).find((value) => Array.isArray(value))
      : undefined;
  if (rows === undefined) return undefined;
  if (rows.length === 0) {
    // 🔴 **空集合是一个真答案**，不是"没答案"。带日期参数的规则（`list.today` 传 `dueOn`）
    // 查回空数组时，退回模型意味着：为一句话发一次请求，而请求里唯一的真信息就是
    // "本机一条都没有" —— 模型拿到它也只能说"今天没有任务"，还可能顺手编一条。
    // 所以这里直接答词条，零出境；工具名与链路事实留在 trace/状态。
    return localize('web.ai.chat.local.empty');
  }

  const labelOf = (row: unknown): string | undefined => {
    const source =
      row !== null && typeof row === 'object' && !Array.isArray(row)
        ? (row as Record<string, unknown>)
        : undefined;
    if (source === undefined) return undefined;
    for (const key of ['title', 'name', 'label', 'text'] as const) {
      const value = source[key];
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
    }
    // 投影常见的包装形状：`{ task: { title } }` / `{ project: { name } }`。
    for (const inner of Object.values(source)) {
      if (inner !== null && typeof inner === 'object' && !Array.isArray(inner)) {
        const nested = labelOf(inner);
        if (nested !== undefined) return nested;
      }
    }
    return undefined;
  };

  const labels = rows.map(labelOf);
  // 🔴 一项都没字 ⇒ 渲染不出来（返回 undefined 而不是"某某：无"）。
  // 只要有一项有字就继续：缺字的那一项列成"（这一项没有标题）"，
  // 因为**丢掉它**会让条数与内容对不上，而"共 5 项，只列 3 项"是另一种谎话。
  if (labels.every((label) => label === undefined)) return undefined;

  const shown = labels
    .slice(0, LOCAL_ANSWER_MAX_ITEMS)
    .map((label) => label ?? localize('web.ai.chat.local.untitled'));
  const lines = shown.map((label) => `- ${label}`).join('\n');
  const rest = rows.length - shown.length;
  const tail = rest > 0 ? `\n${localize('web.ai.chat.local.more', { count: rest })}` : '';
  return `${localize('web.ai.chat.local.found', { count: rows.length })}\n${lines}${tail}`;
}

/**
 * 这一句**本机规则**选中的工具（`kind === 'tool'` = 短路可用）。
 *
 * 🔴 导出它是因为有两个消费者必须给出同一个答案：
 *   · {@link requestAssistantTurn}（循环本身：命中就直接跑，一个请求都不发）；
 *   · 对话面板（在**弹出境披露之前**先问这一句要不要出境）。
 * 两处各写一份规则判定，就是 §3.5 抽掉之后又长回来的那种重复 —— 症状是同一句话在
 * 单步面板零出境、在对话里却把数据发出去，而两边都"正常工作"。
 */
export function assistantLocalSelection(
  text: string,
  opts: {
    readonly tier: AssistantTier;
    readonly rules?: readonly ToolSelectionRule[];
    readonly now?: number;
  },
): ToolSelection {
  return resolveToolSelection(text, {
    grants: assistantGrants(opts.tier),
    ...(opts.rules === undefined ? {} : { rules: opts.rules }),
    now: () => opts.now ?? Date.now(),
  });
}

/**
 * 这一句需不需要**出境披露**。
 *
 * 🔴 面板原先无条件弹披露，于是"今天有什么任务"这种本机就答得出的句子会先承诺
 * "这些话要离开本机"、用户点发送、然后一个字都没出去。那句承诺是假的，而代价不是
 * 一次白点 —— 是下一次真需要出境时，用户已经不信这条提示了。
 *
 * ⚠️ 判据只到 `kind === 'tool'`，**不含"结果渲染不渲染得出人话"**：短路命中但渲染失败时
 * 循环会退回模型路径，而那一步仍被出境闸门挡着（没有同意就 `egressNotAuthorized`、
 * 零请求）。所以这里"少弹一次披露"在结构上不可能变成"多发一次请求"。
 */
export function assistantNeedsEgressDisclosure(
  text: string,
  opts: {
    readonly tier: AssistantTier;
    readonly rules?: readonly ToolSelectionRule[];
    readonly now?: number;
  },
): boolean {
  return assistantLocalSelection(text, opts).kind !== 'tool';
}

let anonymousExecutionCounter = 0;

export async function requestAssistantTurn(
  source: { text: string },
  deps: AssistantTurnDeps,
): Promise<AssistantOutcome> {
  const text = source.text.trim();
  const emptySteps: readonly AssistantStep[] = [];
  if (text === '') {
    return { ok: false, reason: 'empty-text', message: '还没有输入内容。', steps: emptySteps, health: {} };
  }
  if (text.length > MAX_TOOL_CALL_TEXT_LENGTH) {
    return {
      ok: false,
      reason: 'text-too-long',
      message: `这句话太长了（${String(text.length)} 个字，上限 ${String(MAX_TOOL_CALL_TEXT_LENGTH)}）。`,
      steps: emptySteps,
      health: {},
    };
  }

  const grants = assistantGrants(deps.tier);
  const tools = toToolDescriptors(grants);
  if (tools.length === 0) {
    return {
      ok: false,
      reason: 'no-tools-available',
      message: '没有任何可用的工具能力。',
      steps: emptySteps,
      health: {},
    };
  }

  const disclosed = new Set(assistantEgressFields(deps.tier));
  const disclosedPlain = [...disclosed].map((field) => field.split('.')[1] ?? field);
  const getGrants = deps.getGrants ?? (() => assistantGrants(deps.tier));
  const runnerDeps = { host: deps.host, grants, getGrants };
  const anchorNow = deps.now ?? Date.now();
  const executionId =
    deps.executionId?.trim() || `assistant-anonymous-${String(++anonymousExecutionCounter)}`;
  const finishWrite = async (
    proposal: AiToolProposal,
    note: string,
    steps: readonly AssistantStep[],
    health: HealthMap,
    destination: EgressDestination | undefined,
  ): Promise<AssistantOutcome> => {
    if (deps.tier === 'read-and-propose' && !aiToolProposalRequiresConfirmation(proposal)) {
      const authorization: AiToolAuthorization = { getGrants };
      const result = await executeAiToolProposal(deps.host, proposal, executionId, authorization);
      if (!result.ok) {
        return { ok: false, reason: 'write-failed', message: result.message, steps, health };
      }
      const textForUser = note === '' ? '已执行。' : note;
      return {
        ok: true,
        kind: 'executed',
        text: textForUser,
        proposal,
        result,
        steps,
        appended: [
          { role: 'user', text },
          { role: 'assistant', text: textForUser },
        ],
        health,
        destination,
        stopsHere: true,
      };
    }
    const textForUser = note === '' ? '我已经准备好这个改动了，等你确认。' : note;
    return {
      ok: true,
      kind: 'proposal',
      text: textForUser,
      proposal,
      steps,
      appended: [
        { role: 'user', text },
        { role: 'assistant', text: textForUser },
      ],
      health,
      destination,
      stopsHere: true,
    };
  };

  // ── 规则先跑：这一句本机就能答 ⇒ **一个请求都不发** ─────────────────────
  //
  // 🔴 顺序是这条判据的全部意义：**先看规则，再决定要不要出境**，而不是"先把
  // 整句发给模型、模型再挑工具"。后者即使结果一样，也已经把用户那句话（连同
  // `today`、工具目录）送出去了。单步面板 `requestToolCall` 一直是这个顺序，
  // 助手循环原先没有 —— 于是同一句"列出所有任务"在两个界面里有两种隐私表现，
  // 而对话界面恰好是用户更不容易想到要看披露的那一个。
  //
  // ⚠️ 规则命中但**渲染不出人话**时不硬编一句回答，退回模型那一步
  // （见 `localObservationText`）。退回是有测试钉着的，不是"反正能跑"。
  const local = assistantLocalSelection(text, {
    tier: deps.tier,
    ...(deps.rules === undefined ? {} : { rules: deps.rules }),
    now: anchorNow,
  });

  if (local.kind === 'tool') {
    const run = await runSelectedTool(local, runnerDeps);

    if (run.kind === 'proposal') {
      return finishWrite(
        run.proposal,
        '',
        [{ tool: run.proposal.tool, kind: 'write', ok: true }],
        {},
        'none',
      );
    }

    if (run.kind === 'observation') {
      const answer = localObservationText(run.tool, run.data, deps.localize);
      if (answer !== undefined) {
        return {
          ok: true,
          kind: 'answer',
          text: answer,
          steps: [{ tool: run.tool, kind: 'read', ok: true }],
          appended: [
            { role: 'user', text },
            { role: 'assistant', text: answer },
          ],
          health: {},
          destination: 'none',
        };
      }
    }
  }

  // 🔴 锚点**一轮算一次**（`anchorNow`，规则短路也用它）：逐步重算会让跨零点的那一轮里
  // "第 1 步按今天查、第 3 步按明天查"，而同一条消息数组里并存两种"今天" —— 模型看到的是
  // 一个自相矛盾的上下文，且没有任何一层会报。
  const system = assistantSystemPrompt(anchorNow);

  const steps: AssistantStep[] = [];
  const toolTranscript: ChatMessage[] = [];
  let health: HealthMap = {};
  let destination: EgressDestination | undefined;
  let lastText = '';

  // 🔴 循环上界是 `MAX_ASSISTANT_TOOL_STEPS`，而**每一次**循环都是一次模型调用，
  // 所以"最多几次请求"也是被这个常量推导的（见 `planAssistantEgress`），不是另写一个数。
  for (let step = 0; ; step += 1) {
    if (step >= MAX_ASSISTANT_TOOL_STEPS) {
      return {
        ok: true,
        kind: 'stopped',
        limit: 'tool-steps',
        text: `我查了 ${String(MAX_ASSISTANT_TOOL_STEPS)} 步还没定下来。请把要做的事说得更具体一点，或者分两次问。`,
        steps,
        appended: [],
        health,
      };
    }

    const messages = assistantMessages(system, deps.history ?? [], text, toolTranscript);
    if (messages.length > MAX_ASSISTANT_MESSAGES) {
      return {
        ok: true,
        kind: 'stopped',
        limit: 'messages',
        text: `这段会话已经长了 ${String(messages.length)} 条消息（上限 ${String(MAX_ASSISTANT_MESSAGES)}）。新开一段会话我可以继续。`,
        steps,
        appended: [],
        health,
      };
    }

    const model = budgetModelName(deps.routing, deps.model);
    const invocation = {
      feature: 'tool-calling' as const,
      // 🔴 派生：这两项**就是** messages 的第 0 条与本轮那句用户话 ——
      // 同一个变量递进去的，所以"披露说的"与"实际发的"不可能不一致。
      system,
      user: text,
      fields: assistantEgressFields(deps.tier),
      tools,
      messages,
    };

    // ── 出境字节上界：**在发之前**判，吃的是真要发的那段 JSON ──────────
    if (egressBytesFor(model, invocation) > MAX_ASSISTANT_EGRESS_BYTES) {
      return {
        ok: true,
        kind: 'stopped',
        limit: 'egress-bytes',
        text: `下一步要发给端点的内容超过 ${String(MAX_ASSISTANT_EGRESS_BYTES)} 字节的上限，我**没有发**它。请缩小范围（比如只看某个清单，或少列几条）。`,
        steps,
        appended: [],
        health,
      };
    }

    const outcome = await invokeRouted(
      deps.routing,
      invocation,
      deps.consents,
      deps.policy,
      deps.routed ?? {},
    );
    health = outcome.health;
    const result = outcome.result;

    if (!result.ok) {
      return {
        ok: false,
        reason: 'routing-failed',
        cause: result.reason,
        endpointUrl: result.endpointUrl,
        message: result.message,
        steps,
        health,
      };
    }

    destination = result.suggestion.destination;
    const calls = result.suggestion.toolCalls;
    lastText = result.suggestion.text;

    if (calls === undefined || calls.length === 0) {
      // 模型说话了、没要工具 ⇒ 这就是本轮的回答。
      return {
        ok: true,
        kind: 'answer',
        text: lastText,
        steps,
        appended: [
          { role: 'user', text },
          { role: 'assistant', text: lastText },
        ],
        health,
        destination,
      };
    }

    // 🔴 一次一个：文件头第 1 条。多调用的正确处置是**回问**，不是"挑一个执行"，
    // 也不是"全都执行"（后者会让一次确认变成 N 次确认）。
    if (calls.length > 1) {
      return {
        ok: false,
        reason: 'multiple-tool-calls',
        message: `你一次要求调用 ${String(calls.length)} 个工具，而我这里一次只做一件事。请说得更具体一点。`,
        steps,
        health,
      };
    }

    const call = calls[0];
    if (call === undefined) {
      return { ok: false, reason: 'arguments-malformed', message: '工具调用读不出来。', steps, health };
    }

    const parsed = parseToolArguments(call.arguments);
    if (!parsed.ok) {
      return {
        ok: false,
        reason: 'arguments-malformed',
        message: `参数读不出来（${parsed.message}），请换个说法再试。`,
        steps,
        health,
      };
    }

    const spec = findTool(call.name);
    const kind: 'read' | 'write' = spec?.kind === 'write' ? 'write' : 'read';

    const run = await runSelectedTool(
      { kind: 'tool', ruleId: `assistant:${call.name}`, tool: call.name, args: parsed.args },
      runnerDeps,
    );

    if (run.kind === 'proposal') {
      steps.push({ tool: run.proposal.tool, kind: 'write', ok: true });
      const note = lastText.trim();
      return finishWrite(run.proposal, note, steps, health, destination);
    }

    if (run.kind === 'observation') {
      // 🔴 披露复查：**送出去之前**比，不是比完再送。
      const actual = observedFieldNames(run.data);
      const allowed = new Set(declaredFieldNames(run.tool));
      const outside = actual.filter((name) => !allowed.has(name) || !disclosedPlain.includes(name));
      if (outside.length > 0) {
        return {
          ok: false,
          reason: 'egress-outside-disclosed-set',
          message: `这一步（${run.tool}）会带上你**没有批准过出境**的字段：${outside.join('、')}。我把它停在这里，一个字节都没发。`,
          steps,
          outsideFields: outside,
          health,
        };
      }
      steps.push({ tool: run.tool, kind: 'read', ok: true });
      toolTranscript.push({
        role: 'tool',
        content: JSON.stringify(run.data),
        toolCallId: call.id,
      });
      continue;
    }

    // denied / failed / none / ambiguous：把**失败本身**回送给模型，让它换一条路。
    // ⚠️ 这一步仍然计入上界 —— 失败不能免费重试到无穷。
    steps.push({
      tool: run.kind === 'denied' || run.kind === 'failed' ? run.tool : call.name,
      kind: 'read',
      ok: false,
      ...(run.kind === 'denied' || run.kind === 'failed' ? { note: run.message } : {}),
    });
    toolTranscript.push({
      role: 'tool',
      content:
        run.kind === 'denied' || run.kind === 'failed'
          ? `工具没有执行成功：${run.message}`
          : '没有匹配到唯一的工具，需要用户说得更具体。',
      toolCallId: call.id,
    });
  }
}
