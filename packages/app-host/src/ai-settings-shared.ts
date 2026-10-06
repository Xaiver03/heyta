/**
 * AI 设置页的**宿主无关判定**（AGENTS §3.5）。
 *
 *   · `destinationForFeature()` / `recomputeConsents()` —— 抽自 `apps/web` 的
 *     `AiSettings.tsx`（那边留着同样的注释说"绝不自己再写一套目的地比对 ——
 *     两套规则一定会漂移，而这是隐私闸门"）。移动端要接 AI 时**必然**需要同一份，
 *     所以它不能继续住在 `apps/web` 里：那样第二端要么抄一遍，要么"看着像但不一样"。
 *
 * ⚠️ **这里不许出现返回词条 key 的函数**（`MessageKey` 之类）。
 * `packages/app-host` 刻意不依赖 `@heyta/i18n`（见 `ai-route-target.ts` /
 * `share-summary.ts` 文件头那两条理由），所以"哪个状态说哪句话"这类映射
 * **按设计留在各壳里**（web 是 `features/settings/health-copy.ts`，
 * 移动是 `apps/mobile/src/ai/copy.ts`）。本仓库试过把它抽进来，
 * 在 `tsup` 的 dts 阶段以 `TS2307: Cannot find module '@heyta/i18n'` 失败。
 *
 * 🔴 这一层只读配置、只算结论，**不发任何请求**，也**不碰任何存储** ——
 * 存储通道归壳（web 是 localStorage，原生端是 SQLite/偏好）。
 */

import {
  classifyDestination,
  requiresEgressConsent,
  retainValidConsents,
  type AiFeature,
  type AiRoutingConfig,
  type EgressConsent,
  type EgressDestination,
} from '@heyta/ai';

/**
 * 一个功能当前会走到的目的地 —— **由端点推导**，不读存储里的声明，也不硬编码。
 *
 * 🔴 不许在壳里硬编码 `'user-endpoint'`：硬编码的后果是授权记录看起来**永远合理**，
 * 于是"同意的是 A、实际放行的是 B"这件事没有任何地方会发现 —— 而这正是出境闸门存在的理由。
 *
 * 链上只要有一个端点会把明文送出设备，就必须为那个目的地征求授权
 * （回退候选各自过闸门，见 `invokeRouted`）。
 */
export function destinationForFeature(
  feature: AiFeature,
  routing: AiRoutingConfig,
): EgressDestination {
  for (const target of routing.routes[feature] ?? []) {
    const endpoint = routing.endpoints.find((e) => e.id === target.endpointId);
    if (endpoint === undefined) continue;
    const destination = classifyDestination({ mode: 'own', endpoint: endpoint.endpoint });
    if (requiresEgressConsent(destination)) return destination;
  }
  return 'none';
}

/**
 * 路由变了 → 授权跟着**重算**。
 *
 * 🔴 唯一的过滤事实源是 `retainValidConsents()`（`packages/ai/src/egress.ts`）。
 * 这里只按功能把它调用一次，绝不自己再写一套目的地比对。
 *
 * 不重算的后果：旧授权一直躺在存储里，等用户删掉旧端点、再配一个新端点时，
 * 那条记录会重新变得可匹配 —— 于是"我没同意过的组合"被放行。
 *
 * 遍历的集合取"路由里出现过的功能 ∪ 授权里出现过的功能"，与原先"遍历全部 `AiFeature`"
 * 等价：两边都没出现的功能，`retainValidConsents(∅, 'none')` 本来就是 `∅`。
 * 这样这一层就不再依赖一份功能清单 —— 功能清单的唯一事实源是 `AiFeature` 联合类型，
 * 而那条"加成员就全套接线"的规矩由 `check:ai-coverage` 守着。
 */
export function recomputeConsents(
  consents: readonly EgressConsent[],
  routing: AiRoutingConfig,
): EgressConsent[] {
  const byFeature = new Map<AiFeature, EgressConsent[]>();
  for (const consent of consents) {
    const bucket = byFeature.get(consent.feature) ?? [];
    bucket.push(consent);
    byFeature.set(consent.feature, bucket);
  }
  const features = new Set<AiFeature>([
    ...byFeature.keys(),
    ...(Object.keys(routing.routes) as AiFeature[]),
  ]);
  const kept: EgressConsent[] = [];
  for (const feature of features) {
    kept.push(
      ...retainValidConsents(byFeature.get(feature) ?? [], destinationForFeature(feature, routing)),
    );
  }
  return kept;
}

