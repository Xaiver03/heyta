/**
 * AI provider 端口
 * ==================
 *
 * ADR-0005 §3.2 与 ADR-0006 §3.2 的实现：**一个端口，多种后端**。
 * "自备端点"与"heyta 托管"在**这一层是同一个实现** ——
 * 差别只在 `baseUrl`、`apiKey` 和（由此推导的）出境目的地。
 * 这是刻意的：**如果两种模式各写一个 provider，它们一定会漂移**，
 * 而漂移在这条路径上的后果是"隐私披露与实际行为不一致"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个端口**只能产出建议，不能产生 op**
 *
 * ADR-0005 §3.1：**AI 是输入法，不是业务逻辑。** 它坐在 `dispatch()` **之上**，
 * 只负责把"人话"变成"候选字段"。真正写库必须由用户确认后、
 * 走 `packages/app-host` 的动作层、经 `dispatch()` 完成。
 *
 * 因此本文件的返回类型是 `AiSuggestion`，**它没有任何形状能变成 op**：
 *   - 没有 `OpType`、没有 `entityId`、没有向量时钟
 *   - `fields` 里只有**候选值**，没有"已应用"的语义
 *
 * 这不是靠约定，是靠**类型上做不到**。项目负责人不需要记得"AI 不要直接写库"，
 * 因为这里根本没有能写库的东西。对照 AGENTS.md §3.4：op-log 是唯一写入口。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 依赖策略：**零厂商 SDK**
 *
 * 只用 OpenAI 兼容的 `/chat/completions` HTTP 契约（这已是事实标准：
 * Ollama / LM Studio / vLLM / llama.cpp / 各家中转都实现它）。
 * 理由见 `scripts/check-layering.mjs` 的 `no-vendor-ai-sdk-in-apps`：
 * 厂商 SDK 会把 provider 选择与凭据位置硬编码，而那两样必须能由用户切换。
 * **本包零运行时依赖。**
 */

import {
  assertEnableable,
  classifyDestination,
  type AiSupplyMode,
  type EgressDestination,
} from './supply.js';
import {
  authorizeEgress,
  buildDisclosure,
  type AiFeature,
  type EgressConsent,
  type EgressDisclosure,
} from './egress.js';

/** 一次调用的输入。 */
export interface AiInvocation {
  feature: AiFeature;
  /** 系统提示。由调用方（`packages/app-host` 之上的功能层）提供。 */
  system: string;
  /** 用户内容 —— **这里装的就是要出境的数据**。 */
  user: string;
  /** 本次实际送出的字段名，用于披露。**不能省略**，它就是披露的依据。 */
  fields: readonly string[];
}

/**
 * 建议。**不是 op，也不能变成 op。**
 */
export interface AiSuggestion {
  /** 功能。 */
  feature: AiFeature;
  /** 模型返回的自由文本。**由调用方负责解析** —— 本包不解析，因为它不该懂业务格式。 */
  text: string;
  /** 本次调用的出境目的地，供 UI 标注"这条建议来自云端"。 */
  destination: EgressDestination;
}

/** 调用失败的原因。**分类是为了让 UI 能给出不同的处理**。 */
export type AiFailureReason =
  | 'not-configured'
  | 'egress-not-authorized'
  | 'network'
  | 'http-error'
  | 'empty-response'
  /**
   * 该功能没有配置任何可用端点（或全部被排除）。
   *
   * 与 `not-configured` 的区别：`not-configured` 是"AI 整体没开"，
   * 这个是"AI 开着，但这个功能没有路走" —— 两者的修复动作不同。
   */
  | 'no-route'
  /**
   * 🔴 **首选端点失败，而备用端点在隐私边界之外（需要新的出境授权）。**
   *
   * 这是本设计相对通用 AI 网关的**核心差异**：通用网关会直接换端点重试，
   * 但"换到一台会看到明文的机器上"不是高可用问题，是**隐私问题**。
   * 所以 heyta 在这里**停下来问用户**，而不是自己决定。
   * 见 `routing.ts` 顶部说明与 ADR-0010。
   */
  | 'fallback-needs-consent';

export interface AiFailure {
  ok: false;
  reason: AiFailureReason;
  message: string;
  /** HTTP 错误时的状态码。 */
  status?: number;
}

export type AiResult = { ok: true; suggestion: AiSuggestion } | AiFailure;

/**
 * provider 端口。**只有一个方法，且它返回建议。**
 *
 * ⚠️ 未来若加"流式"，要新开一个方法而不是给这个方法加参数 ——
 * 流式会让"先拿到一部分、再决定要不要继续"成为可能，
 * 而那与"先授权、再出境"的顺序冲突。见 `describeEgressOrder`。
 */
export interface AiProvider {
  readonly mode: AiSupplyMode;
  readonly destination: EgressDestination;
  /** 未配置时为空。UI 用它显示"当前接的是哪个端点"。 */
  readonly endpointLabel: string | undefined;
  invoke(invocation: AiInvocation, consents: readonly EgressConsent[]): Promise<AiResult>;
}

/** 注入依赖。**`fetchImpl` 可注入是为了测试能离线跑**（不需要真模型）。 */
export interface ProviderDeps {
  fetchImpl?: typeof fetch;
  /** 超时（ms）。默认 30 秒 —— 任务管理的交互等不了更久。 */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** 关闭态的 provider：任何调用都明确失败，**不静默返回空建议**。 */
function createDisabledProvider(): AiProvider {
  return {
    mode: 'off',
    destination: 'none',
    endpointLabel: undefined,
    invoke: () =>
      Promise.resolve({
        ok: false,
        reason: 'not-configured',
        message: 'AI 未启用。在设置里选择"使用自己的 AI 端点"即可开启。',
      }),
  };
}

/** 配置。 */
export interface AiProviderConfig {
  mode: AiSupplyMode;
  /** `mode === 'own'` 时必填。指向 OpenAI 兼容的 base，例如 `http://localhost:11434/v1`。 */
  endpoint?: string;
  /** 凭据。⚠️ 存放位置由**壳**决定 —— 必须进系统钥匙串，不能进被同步的存储（ADR-0005 §3.2.1）。 */
  apiKey?: string;
  /** 模型名。 */
  model?: string;
}

/**
 * 组装 provider。
 *
 * 🔴 **它是 provider 端口的"单端点 / 本地 / 测试与历史"执行路径，
 * 不是生产的出境执行点。**
 *
 * 生产（`apps/web` / `apps/node-host` / `apps/mobile`）的出境执行点是
 * `routing.ts` 的 `invokeRouted()` —— 只有它带多端点候选、能力过滤、
 * 回退不跨隐私边界与熔断。本函数**不读 `AiRoutingConfig`**，只有
 * `baseUrl` + 一个 key。
 *
 * 依赖本函数的地方只有三处，都不在生产路径上：本包自己的测试、
 * `apps/web/tests/ai-failure-copy.spec.tsx`（一条文案测试，`apps/**` 属于别的模块
 * 且不许改），以及 `scripts/verify-ai-live.mjs`（活体验证脚本）。
 * 因此**不能删**；也正因如此，它是一个"两套实现"的存量问题：
 * `docs/reference/ai-architecture.md` 把本函数写成生产的执行点，那是**文档漂移**
 * （已登记在交付报告里）。**新增出境功能请接 `invokeRouted`，不要接这里。**
 *
 * 🔴 `assertEnableable` 在**工厂里**就调用，而不是等第一次 `invoke` ——
 * 这样"托管模式因保留策略未定而不许启用"会在**配置那一刻**就失败，
 * 而不是在用户已经打了字、准备提交时才弹错。
 * 对照本项目的一条既有教训：**错误发生得越晚，越像"无缘无故"**。
 */
export function createProvider(config: AiProviderConfig, deps: ProviderDeps = {}): AiProvider {
  if (config.mode === 'off') return createDisabledProvider();

  assertEnableable(config);

  const destination = classifyDestination(config);
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    mode: config.mode,
    destination,
    endpointLabel: config.endpoint,

    async invoke(invocation, consents) {
      // ── 1. 出境闸门。**必须在任何网络动作之前。** ──────────────────────
      const decision = authorizeEgress(
        { feature: invocation.feature, destination, fields: invocation.fields },
        consents,
      );
      if (!decision.allowed) {
        // 把披露一并带回：只说"未授权"而不说"授权后什么会被发出去"，
        // 等于逼用户盲签。
        const d = decision.disclosure;
        const retention = d.retentionText === undefined ? '（保留策略未定案）' : d.retentionText;
        return {
          ok: false,
          reason: 'egress-not-authorized',
          message:
            `该功能需要你先授权数据出境。\n` +
            `发送内容：${d.fields.join('、') || '（无）'}\n` +
            `${d.destinationText}\n保留：${retention}`,
        };
      }

      // ── 2. 组装请求。只发 disclosed 的字段，且**没有额外字段**。 ────────
      // 注意这里没有把整个 task 对象序列化进去 —— 出境的数据面
      // 必须**恰好等于**披露出去的那几个字段，不多一个。
      const body = {
        model: config.model ?? 'default',
        messages: [
          { role: 'system', content: invocation.system },
          { role: 'user', content: invocation.user },
        ],
      };

      // ── 3. 网络。超时用 AbortController，**不能只靠 fetch 的默认行为**。 ─
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const res = await doFetch(`${config.endpoint ?? ''}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey !== undefined && config.apiKey !== ''
              ? { authorization: `Bearer ${config.apiKey}` }
              : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          return {
            ok: false,
            reason: 'http-error',
            status: res.status,
            message: `端点返回 ${String(res.status)}。检查端点地址、模型名与凭据。`,
          };
        }

        const json: unknown = await res.json();
        const text = extractContent(json);
        if (text === undefined || text.trim() === '') {
          return {
            ok: false,
            reason: 'empty-response',
            message: '端点返回了空内容。可能是模型名不对，或该端点不支持 OpenAI 兼容格式。',
          };
        }

        return { ok: true, suggestion: { feature: invocation.feature, text, destination } };
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        return {
          ok: false,
          reason: 'network',
          message: aborted
            ? `请求超过 ${String(timeoutMs)} 毫秒未返回。端点在跑吗？`
            : `无法连接端点：${error instanceof Error ? error.message : String(error)}`,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * 从 OpenAI 兼容响应里取正文。
 *
 * ⚠️ **不信任响应形状**：端点是用户提供的，它可能是 Ollama、一个中转、
 * 或者一个返回 200 + 空 JSON 的反向代理。全部按 `unknown` 处理再逐层收窄，
 * 拿不到就返回 `undefined`，由调用方当成 `empty-response`。
 *
 * 这是本项目有测试钉住的一条：**不要用类型断言去相信外部输入**。
 * 对照 AGENTS.md §7 #14：`as SomeInterface & {...}` 会让编译器彻底静音。
 */
export function extractContent(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first: unknown = choices[0];
  if (typeof first !== 'object' || first === null) return undefined;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return undefined;
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : undefined;
}

/**
 * 出境顺序的说明（给 UI 与文档共用，避免两处各写一份措辞）。
 *
 * 🔴 **"先授权、再出境、再显示结果"这个顺序不能被"边发边显示"替代。**
 * 流式输出看起来更流畅，但它意味着**在你决定要不要之前，数据已经在路上了**。
 * 所以如果将来要加流式，必须先回答"怎么在第一个字节发出前完成授权"。
 *
 * ⚠️ **当前零调用点（连测试都没有）**：它的消费者是**文档** ——
 * `docs/reference/ai-architecture.md` 直接引用了这个常量的取值。
 * 保留它是为了让那条顺序约束有一个**代码里的锚点**，而不是只活在文档的一段话里；
 * 删掉它会让文档引用悬空。壳要展示这条说明时，应当 import 它而不是另抄一份。
 */
export const EGRESS_ORDER_NOTE =
  '顺序：先展示会发送哪些字段 → 用户确认 → 才发请求 → 再显示结果。' +
  '不允许先发再问。';

/**
 * 便捷：拿到披露而不发起调用。UI 在"开启前"用这个。
 *
 * ⚠️ **当前零生产调用点**：壳实际直接调 `buildDisclosure()`
 * （四个 AI 面板各自组装，需要中英双语词条 —— 见
 * `apps/web/src/features/ai/AiCapture.tsx` 等）。
 *
 * 保留的理由：它是"只预览、不发送"这条能力的**端口级表达**，且关闭态的
 * 披露形状由 `tests/disclosure-shape.spec.ts` 钉住（该文件正是为这个函数写的）。
 * 与 `describeRouteIntent()` 同形：**在壳愿意收掉自己那份组装逻辑之前保留**，
 * 不要让它长成第三份实现。
 */
export function previewDisclosure(
  config: AiProviderConfig,
  request: { feature: AiFeature; fields: readonly string[] },
): EgressDisclosure {
  if (config.mode === 'off') {
    // 关闭态 = 没有出境，所以披露就是"本地 / 不适用"。
    //
    // 🔴 这里以前返回 `destinationText: ''` —— 一个**空的披露文本**。
    // 它有两个毛病：界面拿到只会渲染空白；而且它和结构化结论**不可能同时成立**
    // （空字符串没法自证是哪一种目的地）。现在两条路径都走 `buildDisclosure`，
    // 同一个目的地永远得到同一份披露。
    //
    // ⚠️ 返回类型以前是**推断**出来的（两个分支形状不同），所以少一个字段
    // 编译器不会报错 —— 现在显式标注 `EgressDisclosure`，由类型兜住。
    return buildDisclosure({ feature: request.feature, destination: 'none', fields: request.fields });
  }
  assertEnableable(config);
  const destination = classifyDestination(config);
  return buildDisclosure({ feature: request.feature, destination, fields: request.fields });
}