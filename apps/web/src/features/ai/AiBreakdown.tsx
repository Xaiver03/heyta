/**
 * AI 拆解 —— 面向用户的入口
 * ============================
 *
 * 这是把 `requestBreakdown()` 接到用户手指上的那一层。
 * 在它之前，能力都在，但**用户点不到**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 本文件存在的核心理由：**发送前的披露**
 *
 * 计划 §5 的验收判据 ④ 写着：
 *
 * > **出境披露**：发送前显示"发给哪个端点 + 发哪几个字段"
 *
 * 这不是"更好的 UX"，是这套设计能成立的前提。heyta 是端到端加密的，
 * 而 AI 是唯一的**明文出境口**。用户必须在自己按下发送之前，
 * 看到**到底什么会离开这台设备**。
 *
 * 所以流程被刻意拆成两步，且**中间那一步不能省**：
 *
 *   1. 点击 → 计算并显示披露（**只算，不发**）
 *   2. 用户看到之后按"发送" → 才真的发
 *
 * ⚠️ 一个容易犯的错误是把披露做成"发送中的提示"或"发送后的日志"。
 * 那等于没有披露 —— 用户已经没有机会反悔了。
 *
 * ## 🔴 第二步：AI 的输出不会自己写进数据
 *
 * 模型回来的是一份**提议**（`BreakdownProposal`）。它要经过用户再按一次，
 * 才经 `setNote` 写进 `Task.note` —— 而那条路走 op-log。
 *
 * 这与 `AiSuggestion` "类型上不能变成 op"是同一条纪律的两端：
 * 类型上做不到，界面上也不做。
 */

import { useState } from 'react';
import { AlertTriangle, Cloud, HardDrive, Sparkles, X } from 'lucide-react';

import { renderPreferenceHints, type PreferenceSet } from '@heyta/domain';
import {
  buildDisclosure,
  fromHealthSnapshot,
  isLoopbackEndpoint,
  resolveRoute,
} from '@heyta/ai';
import type {
  AiHealthSnapshot,
  EgressDestination,
  AiRoutingConfig,
  EgressConsent,
  HealthMap,
  SecretStore,
} from '@heyta/ai';
import {
  buildBreakdownInvocation,
  manualChecklistSkeleton,
  mergeChecklistIntoNote,
  requestBreakdown,
  type BreakdownProposal,
} from '@heyta/app-host';
import type { Task } from '@heyta/domain';

/** 路由解析结果里"这个功能会走到哪个端点"。 */
export interface ResolvedTarget {
  endpointId: string;
  label: string;
  endpoint: string;
  model: string;
  isLocal: boolean;
  /** `resolveRoute` 算出的目的地类别 —— 传给 `buildDisclosure`，不在这里重新判。 */
  destination: EgressDestination;
  /**
   * 🔴 回退链上**其余**的端点标签（不含首选）。
   *
   * 回退是真实行为 —— 首选失败会自动试下一个。所以披露只说首选是不够的：
   * 用户同意了 A，数据却可能发到 B（**另一家公司**）。
   * 而这一类切换**不会报错**，因为最终成功了。
   */
  fallbacks: readonly string[];
}

/**
 * 算出这个功能当前的**首选目标**（只看第一个候选，与 `invokeRouted` 一致）。
 *
 * 🔴 披露必须用**真实路由配置**算，不能自己猜"大概是本机"。
 * 猜错的披露比没有披露更糟 —— 它给了一个错误的保证。
 *
 * ⚠️ 这里不复制 `resolveRoute` 的全部过滤（能力、熔断、URL 合法性）：
 * 那会让同一套规则有两个实现。本函数只负责"取首选候选并描述它"，
 * 真正的过滤仍由 `invokeRouted` 在发送时执行。
 * 若两者结论不一致（例如端点刚好跳闸了），失败会照常显示出来，不会静默。
 */
export function resolvePreferredTarget(
  routing: AiRoutingConfig,
  options: { now?: number } = {},
): ResolvedTarget | undefined {
  // 🔴🔴 **用 `packages/ai` 的 `resolveRoute`，不要在这里做一份平行的过滤。**
  //
  // 早先这里自己遍历 `chain`，只跳过 `undefined` / `disabled`，
  // 而 `resolveRoute` 还会按**能力、熔断、远端开关、URL 合法性**过滤。
  // 两套规则 ⇒ 两套结论。实测：
  //
  //   路由 [A(缺 long_context), B(齐全)]
  //     本函数 → 披露"将发往 A（a.example.com）"
  //     invokeRouted → 实际请求打到 b.example.com
  //     结果 ok = true  ← **成功了，所以用户永远不会知道去了 B**
  //
  // 用户同意了 A，数据发给了 B（**另一家公司**）。这是披露准确性问题，
  // 与 ADR-0010 §3.11 记的回环 bug 是同一个形状：同一件事两个实现。
  //
  // ⚠️ 用 `resolveRoute` 之后，"披露"和"发送"至少在**过滤规则**上不可能分歧。
  // 唯一的剩余差异是熔断状态（这里是配置意图，发送时才检查），
  // 而回退链本来就一并披露了，所以即便真的回退，用户也已经看到过 B。
  const resolution = resolveRoute(routing, 'breakdown', { now: options.now ?? Date.now() });
  const first = resolution.candidates[0];
  if (first === undefined) return undefined;

  return {
    endpointId: first.endpointConfig.id,
    label: first.endpointConfig.label,
    endpoint: first.endpointConfig.endpoint,
    model: first.model,
    // 回环判据同样只有一份 —— `packages/ai` 的 `isLoopbackEndpoint`。
    isLocal: isLoopbackEndpoint(first.endpointConfig.endpoint),
    destination: first.destination,
    fallbacks: resolution.candidates.slice(1).map((c) => c.endpointConfig.label),
  };
}

type Phase = 'idle' | 'disclosing' | 'loading' | 'proposal' | 'failed';

export interface AiBreakdownProps {
  task: Task;
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  secrets: SecretStore;
  /**
   * 🔴 上次会话落盘的**熔断状态**。
   *
   * 这个 prop 存在的唯一理由是：**不传它，落盘就是白做的**。
   *
   * `onHealth` 早就在写了（第 7 轮），但没有任何地方读回来 ——
   * 于是"端点连着失败三次、已跳闸"这件事活不过一次刷新，
   * 用户每次打开都要再撞一次同一个坏端点。
   *
   * ⚠️ 传的是**原始快照**而不是 `HealthMap`：解析要在**发送那一刻**做，
   * 这样过期时间是对着"现在"算的。提前解析会让冷却期在页面开着的
   * 过程中被冻结（跳闸本该 60 秒后自愈）。
   */
  healthSnapshot?: AiHealthSnapshot | undefined;
  /** 写入备注。**必须经 store 的 `setNote`**（那条路走 op-log）。 */
  onApplyNote: (note: string) => Promise<void>;
  /**
   * 每次调用后把**熔断状态**交回给调用方落盘。
   *
   * ⚠️ 不管是成功还是失败都要交 —— 失败正是要记的东西。
   * 不落盘的话，"这个端点连着失败三次、已经跳闸"重启就忘了，
   * 下次启动会立刻再撞一次（见 `packages/ai/src/health-store.ts`）。
   */
  onHealth?: (health: HealthMap) => void;
  /** 仅在测试里注入。生产用 `globalThis.fetch`。 */
  fetchImpl?: typeof fetch;
  /**
   * 记忆层推断出的偏好集（见 `@heyta/domain` 的 `inferPreferences`）。
   *
   * ⚠️ **可选的，默认「没有记忆」** —— 即 fail closed：
   * 忘了传的后果是"这次拆解不带偏好"，而不是"偷偷多发数据"。
   * 主开关关闭时 `inferPreferences` 返回的本身就是空集，
   * 两条路径都不会漏出去（见 ADR-0014）。
   */
  preferenceSet?: PreferenceSet | undefined;
}

export function AiBreakdown(props: AiBreakdownProps): React.JSX.Element {
  const { task, routing, consents, secrets, onApplyNote, onHealth, preferenceSet } = props;

  const [phase, setPhase] = useState<Phase>('idle');
  const [proposal, setProposal] = useState<BreakdownProposal | undefined>(undefined);
  const [failure, setFailure] = useState<string>('');
  const [applied, setApplied] = useState(false);

  const target = resolvePreferredTarget(routing);

  /**
   * 🔴 偏好 → 提示。**这里也是出境面的一个决定点**：
   * `renderPreferenceHints` 按用途过滤（拆解只要粒度/风格/估时），
   * 并且主开关关闭时返回空数组 —— 所以下面两个用途不可能漏。
   */
  const hints = preferenceSet === undefined ? [] : renderPreferenceHints(preferenceSet, 'breakdown');

  const invocation = buildBreakdownInvocation(
    {
      title: task.title,
      ...(task.note === undefined ? {} : { note: task.note }),
    },
    hints,
  );

  /**
   * 🔴 披露内容由 `packages/ai` 的 `buildDisclosure()` 组装 ——
   * 它的文档写着"测试与 UI 共用同一条路径"，而早先 UI **没有**用它，
   * 于是漏掉了其中一整维：「留多久」。
   */
  const disclosure =
    target === undefined
      ? undefined
      : buildDisclosure({
          feature: 'breakdown',
          destination: target.destination,
          fields: invocation.fields,
        });

  async function send(): Promise<void> {
    setPhase('loading');
    const outcome = await requestBreakdown(
      { title: task.title, ...(task.note === undefined ? {} : { note: task.note }) },
      {
        routing,
        consents,
        // 🔴 同一个 `hints` 既进 invocation（决定披露与请求体），
        // 也进这里（决定真正发出去的内容）—— **只算一次**，
        // 否则两处可能算出不同的东西，披露就会和实际发送不一致。
        preferences: hints,
        routed: {
          secretStore: secrets,
          // 🔴 **发送那一刻**才解析快照 —— 冷却期是对着"现在"算的。
          // 用 `fromHealthSnapshot` 而不是直接丢进去：它不抛错、会封顶跳闸、
          // 会丢掉坏条目（见 `packages/ai/src/health-store.ts`）。
          healthSeed: fromHealthSnapshot(props.healthSnapshot ?? {}, Date.now()),
          ...(props.fetchImpl === undefined ? {} : { fetchImpl: props.fetchImpl }),
        },
      },
    );

    // 🔴 成功与失败都要交回 —— 失败正是熔断的依据。
    onHealth?.(outcome.health);

    if (outcome.ok) {
      setProposal(outcome.proposal);
      setPhase('proposal');
      return;
    }
    setFailure(outcome.message);
    setPhase('failed');
  }

  async function apply(): Promise<void> {
    if (proposal === undefined) return;
    await onApplyNote(mergeChecklistIntoNote(task.note, proposal.items));
    setApplied(true);
    setPhase('idle');
  }

  function reset(): void {
    setPhase('idle');
    setProposal(undefined);
    setFailure('');
    setApplied(false);
  }

  // ── 空闲：只是一个按钮 ────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <span className="ht-ai">
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid={`ai-breakdown-${task.id}`}
          aria-label={`用 AI 拆解：${task.title}`}
          onClick={() => {
            setApplied(false);
            setPhase('disclosing');
          }}
        >
          <Sparkles size={12} aria-hidden="true" />
          AI 拆解
        </button>
        {applied && (
          <span className="ht-ai__done" data-testid={`ai-applied-${task.id}`}>
            已写入备注
          </span>
        )}
      </span>
    );
  }

  // ── 🔴 披露：只算，不发 ───────────────────────────────────────────────
  if (phase === 'disclosing') {
    return (
      <div className="ht-ai__panel" role="dialog" aria-label="AI 拆解 —— 发送前确认" data-testid="ai-disclosure">
        <div className="ht-ai__head">
          <span>发送前确认</span>
          <button type="button" className="ht-btn ht-btn--ghost" aria-label="取消" onClick={reset}>
            <X size={12} aria-hidden="true" />
          </button>
        </div>

        {target === undefined ? (
          <p className="ht-ai__warn" data-testid="ai-no-target">
            <AlertTriangle size={12} aria-hidden="true" />
            还没有给「拆解任务」配置端点。去「设置」里添加端点并指定路由。
          </p>
        ) : (
          <>
            <p className="ht-ai__row" data-testid="ai-destination">
              {target.isLocal ? (
                <HardDrive size={12} aria-hidden="true" />
              ) : (
                <Cloud size={12} aria-hidden="true" />
              )}
              将发往：<strong>{target.label}</strong>
              <code>{target.endpoint}</code>
              <span>模型 {target.model}</span>
              <span className="ht-ai__tag" data-testid="ai-destination-kind">
                {target.isLocal ? '数据不出设备' : '数据会离开设备'}
              </span>
            </p>

            {/* 🔴 回退链必须披露 —— 首选失败时会自动换一个端点，
                而那是**另一家公司**。成功了就没有任何提示，
                所以只能在这里先说清楚。 */}
            {target.fallbacks.length > 0 && (
              <p className="ht-ai__row ht-ai__row--warn" data-testid="ai-fallbacks">
                <AlertTriangle size={12} aria-hidden="true" />
                如果它失败，会接着依次尝试：
                <strong data-testid="ai-fallback-list">{target.fallbacks.join('、')}</strong>
              </p>
            )}

            {/* 🔴 「留多久」是披露的三维之一（发给谁 / 发什么 / 留多久）。
                早先这一维完全没显示 —— `describeRetention()` 有现成的文案，
                而 UI 用的是自己手写的那一套。 */}
            {disclosure !== undefined && (
              <p className="ht-ai__row" data-testid="ai-retention">
                保留：<strong data-testid="ai-retention-text">
                  {disclosure.retentionText ?? '未定案 —— 在 heyta 说明清楚之前，这个端点不允许启用。'}
                </strong>
              </p>
            )}

            <p className="ht-ai__row" data-testid="ai-fields">
              将发送这些字段：
              <strong data-testid="ai-field-list">{invocation.fields.join('、')}</strong>
            </p>

            {!target.isLocal && (
              <p className="ht-ai__warn" data-testid="ai-e2ee-warning">
                <AlertTriangle size={12} aria-hidden="true" />
                这台设备上的任务内容是端到端加密的，而发出去的这一份<strong>不受端到端加密保护</strong>。
              </p>
            )}

            <div className="ht-ai__actions">
              <button type="button" className="ht-btn" data-testid="ai-send" onClick={() => void send()}>
                发送
              </button>
              <button type="button" className="ht-btn ht-btn--ghost" onClick={reset}>
                取消
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div className="ht-ai__panel" data-testid="ai-loading">
        <span>正在等待端点返回…</span>
      </div>
    );
  }

  // ── 🔴 提议：AI 的输出不会自己写进去 ──────────────────────────────────
  if (phase === 'proposal' && proposal !== undefined) {
    return (
      <div className="ht-ai__panel" role="dialog" aria-label="AI 拆解结果" data-testid="ai-proposal">
        <div className="ht-ai__head">
          <span>拆解结果（{proposal.items.length} 项）</span>
          <span className="ht-ai__tag" data-testid="ai-proposal-source">
            {proposal.destination === 'none' ? '来自本机' : '来自云端'}
          </span>
        </div>

        {proposal.truncated && (
          <p className="ht-ai__warn" data-testid="ai-truncated">
            <AlertTriangle size={12} aria-hidden="true" />
            结果太多，只保留了前 {proposal.items.length} 项。
          </p>
        )}

        <ul className="ht-ai__items" data-testid="ai-items">
          {proposal.items.map((item, index) => (
            <li key={`${String(index)}-${item}`}>{item}</li>
          ))}
        </ul>

        <p className="ht-ai__note">
          确认后会作为 <strong>Markdown 清单追加</strong>到这条任务的备注里，原来的备注不会被动。
        </p>

        <div className="ht-ai__actions">
          <button type="button" className="ht-btn" data-testid="ai-apply" onClick={() => void apply()}>
            写入备注
          </button>
          <button type="button" className="ht-btn ht-btn--ghost" onClick={reset}>
            不要了
          </button>
        </div>
      </div>
    );
  }

  // ── 失败：给出**具体原因**，并提供不依赖 AI 的退路 ─────────────────────
  return (
    <div className="ht-ai__panel" role="dialog" aria-label="AI 拆解失败" data-testid="ai-failed">
      <div className="ht-ai__head">
        <span>没能拆解</span>
        <button type="button" className="ht-btn ht-btn--ghost" aria-label="关闭" onClick={reset}>
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      <p data-testid="ai-failure-message">{failure}</p>
      <div className="ht-ai__actions">
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid="ai-manual"
          onClick={() => {
            void onApplyNote(mergeChecklistIntoNote(task.note, ['', '', '']));
            reset();
          }}
        >
          手动写一份空清单
        </button>
        <button type="button" className="ht-btn ht-btn--ghost" onClick={reset}>
          关闭
        </button>
      </div>
    </div>
  );
}

/** 供别处复用的骨架文案（也是"AI 不可用时的退路"）。 */
export { manualChecklistSkeleton };
