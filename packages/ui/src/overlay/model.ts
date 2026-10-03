/**
 * 锚点弹层的定位（共享模型）
 * ==========================
 *
 * 「贴着触发器弹出一块面板，哪边空间大就往哪边弹，并夹在视口内」这件事，
 * web 与原生壳上是**同一套算术**，但**取尺寸的手段完全不同**（web 用
 * `getBoundingClientRect`，RN 用 `measureInWindow`）。所以从这里切开：
 * **算术在这一层（宿主无关），测量由宿主注入。**
 *
 * 🔴 为什么整段 `AccountMenu` 的定位搬不进来：`packages/ui/src/index.ts` 文件头
 * 明写这一层进不来任何 DOM 标签，而那段代码的承重件恰恰是 DOM —— 除了 rect，
 * 还有**捕获阶段的 scroll 监听**（rail / main 自己是滚动容器，滚动事件不冒泡到
 * window，冒泡阶段挂上去等于没挂，面板会停在原地而内容已经滚走）。
 * 那两件事留在宿主里，只有这里能留的算术被抽出来。
 */

/** 触发器（锚点）在视口坐标系里的上下边缘与左边缘。 */
export type TriggerRect = {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
};

/** 面板自身的尺寸 —— 只用到宽高，位置由本函数决定。 */
export type PanelSize = {
  readonly width: number;
  readonly height: number;
};

/** 可放置区域（web 是视口，RN 是窗口）的尺寸。 */
export type AnchoredPanelViewport = {
  readonly width: number;
  readonly height: number;
};

export type PanelPlacement = 'above' | 'below';

export type AnchoredPanelPosition = {
  readonly top: number;
  readonly left: number;
  readonly placement: PanelPlacement;
};

/**
 * `gap`：面板与触发器之间的间距；`edge`：面板与视口边缘之间留的安全距离。
 * 🔴 两个都由宿主从设计 token 传进来（`--ht-space-1` / `--ht-space-2`），
 * 这一层不设默认值 —— 在这里写死一个数字就是裸值（AGENTS §5 规则 1）。
 */
export type AnchoredPanelOptions = {
  readonly gap: number;
  readonly edge: number;
};

/**
 * 求面板应放置的位置。
 *
 * 垂直：**哪边空间大就往哪边弹**，不是"下面装不下才翻上去"。塌缩态（≤768px）的
 * 头像在底部导航里，下方看着塞得下，但那样面板会盖住触发它的那条栏 —— 那正是
 * 实测被判错的形态（`e2e/account-menu.spec.ts` 的塌缩态用例）。
 * 两侧空间相等时留在下方（`>` 是严格的）。
 *
 * 水平：贴着触发器左边缘，再夹进视口（右边越界与左边越界都夹到 `edge`）。
 */
export function placeAnchoredPanel(
  trigger: TriggerRect,
  panel: PanelSize,
  viewport: AnchoredPanelViewport,
  options: AnchoredPanelOptions,
): AnchoredPanelPosition {
  const { gap, edge } = options;
  const roomAbove = trigger.top - gap - edge;
  const roomBelow = viewport.height - trigger.bottom - gap - edge;
  const placement: PanelPlacement = roomAbove > roomBelow ? 'above' : 'below';
  const top =
    placement === 'above'
      ? Math.max(edge, trigger.top - gap - panel.height)
      : trigger.bottom + gap;
  const left = Math.min(
    Math.max(edge, trigger.left),
    Math.max(edge, viewport.width - panel.width - edge),
  );
  return { top, left, placement };
}
