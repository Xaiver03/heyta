/**
 * 底部面板的档位模型（纯函数，宿主无关）
 * ======================================
 *
 * 适配层 §4 **T7** 的实测读数：移动端 4 个 `*Sheet.tsx` 名不符实 ——
 * `maxHeight:'90%'` 单档 7 处、居中 `justifyContent:'center'` 2 处，
 * 而**把手 / 拖拽 / 分档 / 记忆档位全仓 0 处**（`docs/reference/overlay-feedback-adaptation.md`）。
 * 这一份是"分档"那一格的判据，与 `dismissal.ts` 同形状：
 * **一张表 + 一组纯函数**，组件里不许再内联算高度。
 *
 * ## 三档是 30 / 60 / 90，不是随手挑的三个数
 *
 * · `small` 0.3 —— 一屏能看见底下三个任务行。再矮就没有"面板"的形状了，
 *   会读成一条吸附在底部的工具栏。
 * · `medium` 0.6 —— 默认对话高度：底下还留着 40% 的上下文，
 *   用户能看见自己是从哪一行点进来的。**这一档就是默认档**
 *   （`DEFAULT_SHEET_DETENT`），"半屏面板"名不符实的那条实测缺陷就是它没被当默认。
 * · `large` 0.9 —— 顶部必须留一条缝。**贴满 100% 就没有"背景"可点了**，
 *   而"点背景关掉"是这一类唯一的随手出口（见 `dismissal.ts` 的 `bottom-sheet`）。
 *
 * ## 🔴 三条不变量（用例钉在 `packages/ui/tests/overlay-sheet-detents.spec.ts`）
 *
 * 1. **空档位集合不许静默变成"全档"。** 宿主写"这层只允许一档"而归一化悄悄
 *    还给三档，等于宿主那句约束没有生效 —— 所以空集合回落成 `['medium']`
 *    （单档 = 没有把手可拖的那一类），**不是**回落成全部。
 * 2. **记忆的档位失效时必须回落。** 宿主换过允许集合之后，上次记住的那一档
 *    可能已经不在集合里。记住了就永远用它，会让记忆变成一条
 *    **绕过档位约束的后台通道**（`resolveInitialDetent` 负责）。
 * 3. **吸附结果是集合内的某一档，永不越界。** 拖拽可以拖到 0，
 *    但松手只能落在允许档位上（`detentForHeight` 负责）。
 *
 * ## 🔴 默认档是 `medium`（2026-11 改；决定依据在 `fallbackDetent`）
 *
 * 这一格原来是"没有记忆时用最大档"，实测读数是**打开即准全屏**：
 * 底部面板的全部意义是底下还看得见上下文，0.9 把任务列表糊干净之后，
 * 它和居中模态就没有区别了（压暗那一格也是同一个理由，见 `BottomSheet.tsx`）。
 */

/** 一档。命名跟 iOS `UISheetPresentationController.Detent` 对齐，不 numerically 命名。 */
export type SheetDetent = 'small' | 'medium' | 'large';

/** 规范顺序：小 → 大。`normalizeDetents` 与 `nextDetent` 都按它排序。 */
export const SHEET_DETENTS = ['small', 'medium', 'large'] as const satisfies readonly SheetDetent[];

/** 档位 → 视口高度占比。改这三个数等于改三端观感，别在组件里另起一份。 */
export const DETENT_FRACTION: Record<SheetDetent, number> = {
  small: 0.3,
  medium: 0.6,
  large: 0.9,
};

/** 一档占多少（0–1）。 */
export function detentFraction(detent: SheetDetent): number {
  return DETENT_FRACTION[detent];
}

/**
 * 面板**没有记忆**时该开在哪一档。
 *
 * 🔴 这一份是唯一的默认值出口：组件里不许再写 `'large'` / `0.9`，
 * 那会变成第二处默认值定义（改一档只改得动一处的那种"两处"）。
 */
export const DEFAULT_SHEET_DETENT = 'medium' satisfies SheetDetent;

/** 一档的像素高度。视口高度由 `useWindowDimensions()` 给出，不由调用方猜。 */
export function detentHeight(detent: SheetDetent, viewportHeight: number): number {
  // 🔴 取整：不取整会让相邻两帧的 height 差出亚像素，原生侧反复重排。
  return Math.round(viewportHeight * DETENT_FRACTION[detent]);
}

/**
 * 归一化之后的档位集合：**至少一个**。
 *
 * 用元组类型而不是数组，是为了让 `list[0]` 在 `noUncheckedIndexedAccess` 下
 * 仍然是 `SheetDetent` —— 否则每个取首元素的调用点都要写一次 `!`，
 * 而那些 `!` 迟早会被复制到某个真的可能为空的地方。
 */
export type NonEmptyDetents = readonly [SheetDetent, ...SheetDetent[]];

/**
 * 宿主给的档位集合 → 归一化（按规范顺序排序 + 去重）。
 *
 * 🔴 **空集合返回 `['medium']`，不是返回全部**（不变量 1）。
 */
export function normalizeDetents(allowed: readonly SheetDetent[]): NonEmptyDetents {
  const kept = SHEET_DETENTS.filter((detent) => allowed.includes(detent));
  // 🔴 不写 `as NonEmptyDetents`：`filter` 的结果确实丢掉了"非空"这一层，
  // 而一次断言会把这份不可信复制给后面每一个取元素的调用点。
  // 这里把"空"真正判掉一次，之后 `list[0]` 就是类型安全的。
  const first = kept[0];
  if (first === undefined) return ['medium'];
  return [first, ...kept.slice(1)];
}

/** 集合里最小的那一档。 */
export function smallestDetent(allowed: readonly SheetDetent[]): SheetDetent {
  return normalizeDetents(allowed)[0];
}

/** 集合里最大的那一档。 */
export function largestDetent(allowed: readonly SheetDetent[]): SheetDetent {
  const list = normalizeDetents(allowed);
  return list[list.length - 1] ?? list[0];
}

/**
 * 没有可用记忆时的落点：允许集合里**最接近默认档**的那一档。
 *
 * 🔴 不是最大档 —— 那正是"打开即准全屏、把上下文糊掉"的来源（见文件头那一节）。
 * 🔴 也不是最小档 —— 宿主明明允许 `medium`，开在 30% 会读成"面板自己变矮了"。
 * ⚠️ **平局取更矮那一侧**：`['small','large']` 这种被宿主砍掉 medium 的集合里，
 * 两档到 0.6 的距离都是 0.3，保守的那一侧才是"默认不许吞掉上下文"这条理由的延伸。
 * 平局靠"严格按更小才替换 + 规范顺序小→大"落地，不靠 `<=`。
 */
export function fallbackDetent(allowed: readonly SheetDetent[]): SheetDetent {
  const list = normalizeDetents(allowed);
  const target = detentFraction(DEFAULT_SHEET_DETENT);
  let best: SheetDetent = list[0];
  let bestGap = Math.abs(detentFraction(best) - target);
  for (const detent of list) {
    const gap = Math.abs(detentFraction(detent) - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = detent;
    }
  }
  return best;
}

/**
 * 点把手 / 点标题栏：往上一档，到顶回到最小档。
 *
 * 🔴 单档时返回自己 —— 那一类**没有把手可拖**，返回"循环后的下一档"
 * 会让它凭空多出一个档位。
 */
export function nextDetent(
  current: SheetDetent,
  allowed: readonly SheetDetent[],
): SheetDetent {
  const list = normalizeDetents(allowed);
  if (list.length === 1) return list[0];
  const at = list.indexOf(current);
  // 当前档已不在允许集合里（宿主刚改过）⇒ 从头开始，而不是原样返回 current ——
  // 那样把手会"点了没反应"，而原因藏在调用方。
  if (at < 0) return list[0];
  return list[(at + 1) % list.length] ?? list[0];
}

/**
 * 松手时的吸附：落在一个像素高度上，取**最近的允许档**。
 *
 * 🔴 入参可以是任意高度（拖拽能拖到 0、也能拖过最大档），返回值**必然在集合内**。
 */
export function detentForHeight(
  height: number,
  viewportHeight: number,
  allowed: readonly SheetDetent[],
): SheetDetent {
  const list = normalizeDetents(allowed);
  let best: SheetDetent = list[0];
  let bestGap = Number.POSITIVE_INFINITY;
  for (const detent of list) {
    const gap = Math.abs(detentHeight(detent, viewportHeight) - height);
    if (gap < bestGap) {
      bestGap = gap;
      best = detent;
    }
  }
  return best;
}

/**
 * 打开时该落在哪一档（"有一个候选值"的那一格）。
 *
 * 🔴 **没有记忆时用 `fallbackDetent(allowed)`（= medium 那一侧），不是最大档。**
 * 旧决定写的是"这批面板从 `maxHeight:'90%'` 迁过来，默认压到 60% 会让『字段不见了』
 * 看起来像 bug"——那条顾虑成立的对象是**内容可见性**，解法却是**默认高度**，两者不是一回事：
 * medium 那一档下面是可滚动的内容区，一个字段都没少，只是要多滚一下才看到；
 * 而 0.9 少掉的是**面板底下的那一屏任务**，那个没有任何手势能找回来。
 * 所以新决定依据 = 默认档保留上下文，"看全字段"交给滚动，"看全面板"交给手势与记忆。
 *
 * ⚠️ 记忆失效（不在允许集合内）时同样回落（不变量 2），**不**原样返回记住的那一档 ——
 * 否则宿主的档位约束会被记忆绕过。
 */
export function resolveInitialDetent(
  remembered: SheetDetent | undefined,
  allowed: readonly SheetDetent[],
): SheetDetent {
  const list = normalizeDetents(allowed);
  if (remembered !== undefined && list.includes(remembered)) return remembered;
  return fallbackDetent(list);
}

/**
 * 非受控面板**起始档位**的完整优先级：宿主持久层的记忆 > 宿主写的默认档 > `fallbackDetent`。
 *
 * 🔴 为什么记忆要压过 `hostDefault`：这条链存在的理由就是"用户上次拖到哪一档，
 * 下次还开在那一档"。让宿主写死的默认档赢，等于每次打开都把用户的手势选择抹掉，
 * 而那正是这一格立项时要修的缺陷（`onDetentChange` 全仓零宿主使用）。
 * ⚠️ 受控（`detent`）不进这里 —— 那一格由组件直接透传，本函数只管非受控。
 * ⚠️ 记忆是**异步**读上来的（宿主先渲染后取本地库）：所以它必须能在挂载之后
 * 才被送进来，靠的就是这一份优先级 + 组件里那次"只采纳、不回写"的更新。
 */
export function resolveDetentSeed(
  remembered: SheetDetent | undefined,
  hostDefault: SheetDetent | undefined,
  allowed: readonly SheetDetent[],
): SheetDetent {
  if (remembered !== undefined) return resolveInitialDetent(remembered, allowed);
  if (hostDefault !== undefined) return resolveInitialDetent(hostDefault, allowed);
  return fallbackDetent(allowed);
}

/**
 * 拖到多矮松手就该关掉 —— 判据是**最小档的一半**，不是某个写死的像素数。
 *
 * 用相对量而不是绝对值：整块面板在 4.7 寸与 12.9 寸上的最小档差一倍，
 * 一个写死的 80px 在其中一端必然手感不对。
 */
export function dismissThresholdPx(
  allowed: readonly SheetDetent[],
  viewportHeight: number,
): number {
  return Math.round(detentHeight(smallestDetent(allowed), viewportHeight) / 2);
}

/** 松手那一刻要不要关。与 `dismissThresholdPx` 同一条判据，分成两个入口是为了让组件只调一次。 */
export function shouldDismissOnRelease(
  visibleHeight: number,
  allowed: readonly SheetDetent[],
  viewportHeight: number,
): boolean {
  return visibleHeight < dismissThresholdPx(allowed, viewportHeight);
}
