/**
 * WebGL 那一节的静态替代
 * ========================
 *
 * 🔴 **这个文件存在的唯一理由是：WebGL 起不来时，页面不能整张白掉。**
 *
 * 已实测的崩溃链路（无头 Chrome 里把 GPU 关掉就能复现）：
 *
 *   1. `SyncScene` 的 effect 里 `new THREE.WebGLRenderer(...)` 抛
 *      `Error: THREE.WebGLRenderer: Error creating WebGL context.`；
 *   2. effect 里抛出的错误会**冒泡到最近的 error boundary**，
 *      而在此之前这棵树上一个 boundary 都没有；
 *   3. 于是 React **卸载整棵组件树** —— 不是这一节消失，是
 *      `#root.innerHTML` 从 90,891 字符变成 **0**，
 *      `document.documentElement.scrollHeight` 从 7133 掉到 757。
 *      导航、英雄区、能力、展厅、价格、页脚**全部白掉**。
 *
 * 这不是"只有无头浏览器才会遇到"的情况。现实里拿不到 WebGL 上下文的场合包括：
 * 关掉了硬件加速的浏览器、企业策略禁用 WebGL、隐私浏览器/防指纹模式、
 * GPU 驱动在黑名单里、老旧或低端设备、以及 iOS 锁定模式。
 * 对一个落地页来说，**"最炫的那一节降级"和"整页打不开"是两个数量级的差别。**
 *
 * 所以这里有两道防线，缺一不可（职责不同）：
 *   - `SyncScene` 自己 try/catch 渲染器构造，拿不到上下文就渲染本组件 → 保住头部与图例；
 *   - `SceneBoundary` 作为兜底，接住 three 在**别处**抛出的任何错误
 *     （初始化失败之外的：编译着色器、丢上下文、后续版本改动）。
 *
 * 🔴 本组件**不导入 three**、不碰 canvas、不创建任何上下文 ——
 * 它必须在"WebGL 完全不可用"的环境里也能渲染出来，否则它就不是降级方案。
 * 它用同一套语义 token，所以亮色/暗色都跟着走，不需要单独的暗色规则。
 */

export function SyncFallback(): React.JSX.Element {
  return (
    <div className="lp-sync__fallback">
      {/*
        静态节点图：形状对应 3D 场景里的「几台设备 + 它们之间的改动」，
        不是装饰性涂鸦。`aria-hidden` 是因为它只是同一段文字的另一种呈现，
        读屏用户已经从标题、导语和图例拿到了全部信息 ——
        重复朗读一遍图形没有增加任何信息。
      */}
      <svg
        className="lp-sync__graph"
        viewBox="0 0 320 180"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        <g className="lp-sync__graph-edges">
          <line x1="64" y1="92" x2="160" y2="46" />
          <line x1="160" y1="46" x2="256" y2="104" />
          <line x1="64" y1="92" x2="160" y2="140" />
          <line x1="160" y1="140" x2="256" y2="104" />
        </g>
        <g className="lp-sync__graph-nodes">
          <circle cx="64" cy="92" r="15" />
          <circle cx="160" cy="46" r="15" />
          <circle cx="256" cy="104" r="15" />
          <circle cx="160" cy="140" r="15" />
        </g>
        <g className="lp-sync__graph-packets">
          <circle cx="112" cy="69" r="4" />
          <circle cx="208" cy="75" r="4" />
          <circle cx="112" cy="116" r="4" />
          <circle cx="208" cy="122" r="4" />
        </g>
      </svg>
    </div>
  );
}