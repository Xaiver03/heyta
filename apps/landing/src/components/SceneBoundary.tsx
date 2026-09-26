/**
 * 场景容错边界
 * ==============
 *
 * 🔴 **这是一道"整页 vs 一节"的闸门，不是一个通用工具箱。**
 *
 * 背景（实测，不是推测）：`SyncScene` 里 `new THREE.WebGLRenderer(...)`
 * 在拿不到 WebGL 上下文时会抛错。effect 里抛出的错误会冒泡到最近的
 * error boundary，而在此之前整棵树**一个 boundary 都没有** ——
 * React 于是卸载整棵组件树，`#root` 变成空的，整张落地页白掉。
 * 详见 `SyncFallback.tsx` 文件头里那组数字。
 *
 * 为什么需要**两道**防线，而不是只留 `SyncScene` 里的 try/catch：
 *   - try/catch 只能盖住"构造渲染器"这一个已知的失败点；
 *   - three 还会在**别处**抛：着色器编译失败、上下文丢失、
 *     驱动层的怪问题、以及将来升级 three 引入的新失败路径。
 *   - 这一个 boundary 把范围钉死在 **WebGL 那一节**：
 *     它坏了就只坏它自己，页面其余部分与它无关。
 *
 * 🔴 **它刻意不接受 `onError` 之外的任何配置**（不传 resetKey、不传多级 fallback）。
 * 一个只在"这一节炸了"时用到的抽象，参数越多越容易写错；
 * 需要更通用的错误处理时，应该另开一个文件，而不是把这个改造成万能组件。
 *
 * 为什么是 class：React **只**支持 class 组件做 error boundary，
 * 没有 hook 版本（`useErrorBoundary` 不存在）。这不是风格选择。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface SceneBoundaryProps {
  children: ReactNode;
  /** 出错时要显示的东西。**必填**：默认值会让人忘记设计降级外观。 */
  fallback: ReactNode;
}

interface SceneBoundaryState {
  failed: boolean;
}

export class SceneBoundary extends Component<SceneBoundaryProps, SceneBoundaryState> {
  override state: SceneBoundaryState = { failed: false };

  static getDerivedStateFromError(): SceneBoundaryState {
    return { failed: true };
  }

  /**
   * 只记日志，不上报。
   *
   * 仓库里没有前端错误上报设施，也**不该**为了这个降级加一个 ——
   * 那会引入第三方依赖（过 AGENTS.md §3.1/§3.2 两道门）并把
   * 一个视觉故障变成一条数据合规问题。留一条 console 记录，
   * 让"用户说 3D 那节是静态的"这件事至少可查。
   */
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 这条日志是**给开发者看的**，不进词条表：它不该出现在界面上。
    console.error('[landing] WebGL 场景初始化失败，已降级为静态图。', error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}