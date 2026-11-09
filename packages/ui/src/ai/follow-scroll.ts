/**
 * 流式跟随：**什么时候该自动滚到底，什么时候不该**
 * ================================================
 *
 * ## 为什么这需要单独一个模块
 *
 * "流式期间自动滚到底"听起来是一行 `scrollTop = scrollHeight`。它不是。
 *
 * 真正的问题是：**用户往上滚看历史时，内容还在长。** 此时无脑滚到底会把用户
 * 拽回底部。这条缺陷的症状很典型 —— 用户说"它自己跳"，而代码里没有任何地方
 * 写着"跳"，只有一句看起来无害的"滚到底"。
 *
 * assistant-ui 为这件事写了 544 行状态机（`packages/store/src/utils/
 * thread-viewport-auto-scroll.ts`，见 `docs/research/ai-chat-motion-source-study.md`
 * §2.3），其中区分了 `scrolledUp` / `escapedClamp` / `inFlightDownward` /
 * `followPaused` 等多种状态。
 *
 * 我们**不照搬它**（它是 DOM 专属，且解决的一部分问题是浏览器 clamp 行为，
 * RN 上没有）。这里只保留真正跨平台的那部分判断，做成纯函数：
 *
 *   · **粘底**：用户本来就在底部 ⇒ 新内容到达时跟着滚。
 *   · **脱钩**：用户往上滚了 ⇒ 停止跟随，直到他自己滚回底部。
 *   · **阈值**：不是"像素级精确到底"才算在底部 —— 差几个像素、或停在
 *     底部附近，都该算"他想看最新"。否则浮点误差会让跟随莫名失效。
 *
 * ## 为什么不在这里直接碰 DOM / RN
 *
 * `packages/ui` 是单份代码跑 web + RN（无 `.native/.web` 分叉）。滚动容器在
 * 两端的形状完全不同（DOM 是 `scrollTop`/`scrollHeight`/`clientHeight`，
 * RN 是 `onScroll` 的 `contentOffset`/`contentSize`/`layoutMeasurement`）。
 * 所以这里只判定**"该不该跟随"**，具体怎么滚由调用方做 —— 判定逻辑于是
 * 可以在 node 里测穿，两端共用同一条判据。
 */

/**
 * 一个滚动容器的**当前几何**。
 *
 * 三个值就是为了让两端都能填：
 *   · DOM：`scrollTop` / `scrollHeight` / `clientHeight`
 *   · RN ：`contentOffset.y` / `contentSize.height` / `layoutMeasurement.height`
 */
export interface ScrollGeometry {
  /** 已滚过的距离（顶端对齐时为 0）。 */
  readonly offset: number;
  /** 内容总高度。 */
  readonly contentHeight: number;
  /** 视口高度。 */
  readonly viewportHeight: number;
}

/**
 * 判定"离底部还有多远"时容许的误差（像素）。
 *
 * 🔴 为什么不能是 0：`scrollHeight - clientHeight - scrollTop` 在浏览器里
 * 受**设备像素比**与**亚像素布局**影响，常留下 0.5~2px 的零头。
 * 要求精确等于 0 会让"用户明明就在底部"被判定成"他滚上去了"，
 * 症状是跟随**随机**失效（同一段内容，有时跟有时不跟）。
 *
 * 24 是常用的"一指以内"量级；对聊天流足够宽容，又不至于把"真滚上去了"
 * 误判成"还在底部"。
 */
export const FOLLOW_THRESHOLD_PX = 24;

/** 离底部还有多少像素（可能为负 —— 内容比视口短时 `offset` 会超出）。 */
export function distanceFromBottom(geometry: ScrollGeometry): number {
  return geometry.contentHeight - geometry.viewportHeight - geometry.offset;
}

/**
 * 用户在**这一刻**是否处于"想跟最新"的状态。
 *
 * ⚠️ 这个函数是**无状态**的：它只看当前这一帧的几何。状态（"已经脱钩了"）
 * 由调用方持有 —— 见 `applyScrollIntent`。
 */
export function isNearBottom(
  geometry: ScrollGeometry,
  threshold: number = FOLLOW_THRESHOLD_PX,
): boolean {
  /**
   * 🔴 内容**比视口还短**时永远算"在底部"。
   *
   * 这时 `distanceFromBottom` 是负数（内容没填满），而"跟随"在这里是
   * 无意义的 —— 没有任何可滚的东西。若不特判，不同平台对"短内容时
   * offset 是什么"的处理不同（有的给 0，有的给负值），会让跟随状态
   * 在内容刚开始出现的那几帧里抖动。
   */
  if (geometry.contentHeight <= geometry.viewportHeight) return true;
  return distanceFromBottom(geometry) <= threshold;
}

/** 用户滚动之后，**该不该继续跟随**。 */
export interface FollowDecision {
  /** 之后是否跟随（新内容到达时滚到底）。 */
  readonly follow: boolean;
  /** 这一帧的状态是否发生了变化（调用方据此决定要不要写 state）。 */
  readonly changed: boolean;
}

/**
 * 把"用户滚动了"这一事件折进跟随状态。
 *
 * 🔴 这是本模块唯一有状态语义的地方，而它的规则只有一条：
 *
 *   **用户在底部附近 ⇒ 恢复跟随；用户在中间/顶部 ⇒ 停止跟随。**
 *
 * 没有"滚上去一点点也继续跟"的中间档 —— 那正是"它自己跳"的来源。
 * 用户一旦明确离开了底部，跟随就该停，直到他自己回到附近。
 *
 * @param follow 上一帧的跟随状态。
 * @param geometry 用户滚动之后的几何。
 * @param threshold 底部容差。
 */
export function applyScrollIntent(
  follow: boolean,
  geometry: ScrollGeometry,
  threshold: number = FOLLOW_THRESHOLD_PX,
): FollowDecision {
  const nowNearBottom = isNearBottom(geometry, threshold);

  /**
   * ⚠️ 这里**原先**有一段"内容比视口短就提前 return"的分支，已经删掉。
   *
   * 理由是变异测试证明它**测不到**：`isNearBottom` 在内容不足一屏时
   * `distanceFromBottom` 为负、必然 ≤ 阈值，所以那个分支与下面的正常路径
   * 结果完全一致 —— 它是一段不会改变行为的死代码。
   *
   * 留着它的代价不是性能，是**误导**：后来者会以为"短内容"是一条需要
   * 单独处理的特例，于是在改动时维护两条本该一致的路径。
   * 真正的特判在 `isNearBottom` 里，那里是**必要**的（阈值可能被调用方显式
   * 传成负数，那时 `distance <= threshold` 不足以覆盖短内容）。
   */
  if (nowNearBottom === follow) return { follow, changed: false };
  return { follow: nowNearBottom, changed: true };
}

/**
 * 内容变化（流式新片段到达 / 新消息追加）之后，**该不该滚到底**。
 *
 * 与 `applyScrollIntent` 分开，是因为两者的触发源不同：
 *   · 那个是"用户滚了"（可能停止跟随）；
 *   · 这个是"内容长了"（跟随状态下才滚）。
 *
 * 🔴 内容变长**不会**让脱钩的用户重新粘上 —— 这是刻意的。
 * 一个已经滚上去看历史的用户，不该因为回答又多了 20 个字就被拽回底部。
 */
export function shouldFollowOnContentChange(follow: boolean): boolean {
  return follow;
}
