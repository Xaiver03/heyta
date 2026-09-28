/**
 * AI 出境披露 —— 共享层的**纯逻辑**（无 RN、无 i18n）
 * ====================================================
 *
 * ## 为什么需要这一层：五份手抄的披露，其中一份漏了安全维度
 *
 * 「发送前披露」原本在 web 里被**手抄了 5 份**（`AiBreakdown` / `AiPrioritize` /
 * `AiDuration` / `AiCapture` / `AiToolRun`）。前四份归一化 testid 后 `diff`
 * 只差注释与前缀，**第 5 份漂移了**：
 *
 * | 维度 | 前四份 | `AiToolRun`（修复前） |
 * |---|---|---|
 * | 目的地（发给谁） | 有 | 有（但没有 `endpoint`，也没有 `-kind` 子节点） |
 * | **回退链** | 有 | 🔴 **无** |
 * | 保留策略（留多久） | 有 | 🔴 **无 testid** |
 * | 会发送哪些字段 | 有 | 🔴 **无 testid** |
 * | **E2EE 警告** | 有 | 🔴 **无** |
 *
 * 这不是"有意取舍"：`AiToolRun.tsx:104` 拿到的 `target` 带 `fallbacks`，
 * 而 `packages/ai` 的 `invokeRouted()` 是**生产唯一出境执行点**、
 * 多端点回退是它的核心语义（`'fallback-needs-consent'` 这个失败原因的存在
 * 本身就证明回退会发生）。⇒ **工具调用这条路径确实可能把数据发给另一家公司，
 * 而界面没有说。而没有任何测试会红** —— 这正是"同一个组件被抄 5 份"的代价。
 *
 * 本文件把"必须披露哪些维度、顺序如何、testid 怎么拼"变成**一份可测的纯逻辑**，
 * 组件（`AiDisclosure.tsx`）只负责把它摆到 RN 原语上。
 *
 * ## 必须披露的维度（判据出处）
 *
 * | 维度 | 出处 |
 * |---|---|
 * | 目的地（发给谁 / 模型 / 本地还是远端） | `docs/reference/ai-architecture.md` §3.3 `destinationText` |
 * | 保留策略（留多久） | 同上 §3.3 `retentionText`；§14 判据 7「发给谁 + 发什么 + 留多久」 |
 * | 会发送哪些字段 | 同上 §3.3、§4.5「数据面恰好等于披露面」、判据 8「逐项列出，不许 `['*']`」 |
 * | **回退链** | 同上 **§5.1「回退不得跨越隐私边界」**、判据 4 |
 * | **E2EE 警告** | 同上 §2.4「托管文案必须否认 E2EE」、判据 6 |
 *
 * ## ⚠️ 本文件不 import `@heyta/i18n`（会拖进第二份 React）
 *
 * 与 `task-list/model.ts` / `empty-state/model.ts` 同一条纪律。文案由宿主注入，
 * 本文件只产出**结构**（哪些行要渲染、testid 叫什么）。
 */

/**
 * 一条披露**维度**。顺序即渲染顺序 —— 顺序也是契约的一部分：
 * 读者先看到"发给谁"，再看到"还会回退到谁"，最后才是警告。
 */
export const AI_DISCLOSURE_DIMENSIONS = [
  'destination',
  'fallbacks',
  'retention',
  'fields',
  'e2ee-warning',
] as const;

export type AiDisclosureDimension = (typeof AI_DISCLOSURE_DIMENSIONS)[number];

/**
 * 共享层渲染披露时需要的**最小**目的地视图。
 *
 * ⚠️ 刻意不是 `@heyta/ai` 的 `ResolvedCandidate`，也不是 web 的
 * `ResolvedRouteTarget`：共享层不依赖那两个包（前者会拉进 AI 依赖图，
 * 后者是 web 壳的东西）。宿主负责把它的 target 映射成这 5 个字段 ——
 * 映射本身就是"披露说的 = 界面拿到的"这条不变式的唯一接缝。
 */
export interface AiDisclosureTarget {
  readonly label: string;
  readonly endpoint: string;
  readonly model: string;
  readonly isLocal: boolean;
  /** 🔴 回退链上**其余**端点的标签（不含首选）。空数组 = 不回退。 */
  readonly fallbacks: readonly string[];
}

/** `toAiDisclosureViewModel` 的输入。 */
export interface AiDisclosureInput {
  readonly target: AiDisclosureTarget;
  /** 会出境的字段，**逐项**。空数组也照样渲染（"什么都没发"也是一种披露）。 */
  readonly fields: readonly string[];
  /** 保留策略文案。`undefined` = 策略未定案 → 不渲染该行。 */
  readonly retentionText: string | undefined;
  /** 列表分隔符（中英标点不同，由宿主给）。 */
  readonly separator: string;
}

/** 一行的 testid 拼法。**唯一一处**决定 testid 形状。 */
export interface AiDisclosureTestIds {
  readonly destination: string;
  readonly destinationKind: string;
  readonly fallbacks: string;
  readonly fallbackList: string;
  readonly retention: string;
  readonly retentionText: string;
  readonly fields: string;
  readonly fieldList: string;
  readonly e2eeWarning: string;
}

/**
 * `testIdPrefix` + 维度名 → 完整 testid。
 *
 * 🔴 **拼出来的必须与改造前逐字一致** —— 披露接缝被现有测试大量断言
 * （实测计数：`destination` 30 / `fields` 37 / `retention` 24 /
 * `no-target` 23 / `e2ee-warning` 7 / `fallbacks` 3）。各面板的前缀是
 * `ai-` / `prioritize-` / `duration-` / `capture-` / `ai-tool-`，
 * 所以这里只做"前缀 + 维度名"这一种拼法。
 */
export function aiDisclosureTestIds(prefix: string): AiDisclosureTestIds {
  return {
    destination: `${prefix}destination`,
    destinationKind: `${prefix}destination-kind`,
    fallbacks: `${prefix}fallbacks`,
    fallbackList: `${prefix}fallback-list`,
    retention: `${prefix}retention`,
    retentionText: `${prefix}retention-text`,
    fields: `${prefix}fields`,
    fieldList: `${prefix}field-list`,
    e2eeWarning: `${prefix}e2ee-warning`,
  };
}

/** 披露视图模型 —— 组件照着它渲染，测试照着它断言（同一份事实）。 */
export interface AiDisclosureViewModel {
  readonly label: string;
  readonly endpoint: string;
  readonly model: string;
  readonly isLocal: boolean;
  readonly fallbacks: readonly string[];
  readonly fallbackText: string;
  readonly retentionText: string | undefined;
  readonly fieldsText: string;
  /**
   * 🔴 **这一次会渲染哪些维度** —— 跨面板一致性断言的判据。
   *
   * 它是纯函数算出来的，所以"同一套 target 下 5 个面板渲染同一组维度"这件事
   * 可以在 node 里测穿，不需要 DOM。
   */
  readonly dimensions: readonly AiDisclosureDimension[];
}

/**
 * 一个 target **必须**披露哪些维度。
 *
 * 判据是"这个 target 事实上有哪些后果"：
 *   · `destination` / `retention` / `fields` —— 永远有；
 *   · `fallbacks` —— 只有真有回退候选时才渲染（没有回退时说"还会发给别人"
 *     是在制造噪音，也会教用户忽略这一行）；
 *   · `e2ee-warning` —— 只有**远端**才渲染（本机端点数据不出设备，
 *     对它说"不受端到端加密保护"是错的）。
 */
export function requiredDisclosureDimensions(
  target: AiDisclosureTarget,
): readonly AiDisclosureDimension[] {
  const required: AiDisclosureDimension[] = ['destination'];
  if (target.fallbacks.length > 0) required.push('fallbacks');
  required.push('retention', 'fields');
  if (!target.isLocal) required.push('e2ee-warning');
  return required;
}

/** 把宿主给的 input 折成一份视图模型。**没有分支差异，只有数据差异。** */
export function toAiDisclosureViewModel(input: AiDisclosureInput): AiDisclosureViewModel {
  const { target } = input;
  const fallbacks = [...target.fallbacks];
  return {
    label: target.label,
    endpoint: target.endpoint,
    model: target.model,
    isLocal: target.isLocal,
    fallbacks,
    fallbackText: fallbacks.join(input.separator),
    retentionText: input.retentionText,
    fieldsText: input.fields.join(input.separator),
    dimensions: requiredDisclosureDimensions(target),
  };
}

/**
 * 🔴 跨面板一致性：哪些维度**不是每个面板都渲染**。
 *
 * 返回空数组 = 一致。这正是"第 5 份漏了回退链与 E2EE"能被一条断言抓住的形状：
 * 修复前，`AiToolRun` 的那份视图缺 `fallbacks` 与 `e2ee-warning`，
 * 于是这里会返回 `['fallbacks', 'e2ee-warning']`。
 *
 * ⚠️ 它**只在调用方给的是同一条路由解析**时才有意义。给两组不同的 target
 * 进来，返回的差异是**正确的**差异，不是漂移 —— 所以调用方要负责固定输入。
 */
export function disclosureParityGaps(
  views: readonly AiDisclosureViewModel[],
): readonly AiDisclosureDimension[] {
  if (views.length === 0) return [];
  const sets = views.map((view) => new Set(view.dimensions));
  return AI_DISCLOSURE_DIMENSIONS.filter((dimension) =>
    sets.some((set) => !set.has(dimension)),
  );
}
