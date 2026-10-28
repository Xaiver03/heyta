import { closePolicyOf, dismissActionFor, type ClosedOverlay } from '@heyta/ui';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

import { useModalFocusIsolation } from './useModalFocusIsolation.js';

/**
 * Web 原生的模态壳（全局 UX 线 P6）
 * ================================
 *
 * ## 为什么是"再抽一枚"，而不是直接用共享的 `OverlayModal`
 *
 * 计划 §P6 原本写的是"迁到 `OverlayModal`"。那一格今天量完了，两条读数把它否证：
 *
 *   · `OverlayModal` 的外壳是 react-native-web 的 `Modal`，它的 DOM 由 RN 的 `View` 组成，
 *     而 **RNW 的 `View` 不透传 `className`**（真浏览器实测：给它 `className="probe-…"`，
 *     `querySelectorAll('.probe-…').length === 0`）⇒ 宿主的 CSS 族贴不上去，
 *     "迁过去还是这个样子"这件事做不到；
 *   · 反过来，它在真浏览器里**确实挂载且激活**（`aria-modal=1`、`role=dialog=1`、
 *     `body` 子节点增量 0 ⇒ 就地渲染）—— 所以 §7 第 606 条那句"Web 里那一层根本不出现"
 *     是当时**测早了一帧**，不是一般性质。
 *
 * ⇒ 本期的形状：**判断共享、渲染分端**（与 P1 的 `useDirtyDismissGuard`、
 *   P2 的 `DangerConfirmDialog` 同一条分工）。这一枚是 Web 那一半的壳；
 *   原生端那一半继续用 `OverlayModal`。**两枚壳查的是同一张表**
 *   （`packages/ui/src/overlay/dismissal.ts`），所以"该不该问、能不能绕、有没有 ×"
 *   在两端不可能答成两样。
 *
 * ## 这一枚只拥有三件事
 *
 *   1. 遮罩 + 面板两层 DOM（`role="dialog"` / `aria-modal` / `aria-labelledby` / testID）；
 *   2. 三条关闭通道**全部问表**（背景、Esc、以及表里"给不给 ×"），组件里不许内联比较策略值；
 *   3. 焦点那一套：初始焦点给**安全侧**、Tab 不外逃、关闭归还触发者（`useModalFocusIsolation`）。
 *
 * 布局、宽度、文案、动作区里放哪几枚按钮全在宿主 —— 所以宿主传类名进来，
 * 迁移本身**不产生视觉变化**（这是这一期能用截图验收的前提）。
 *
 * ⚠️ 面板**就地画在宿主的堆叠上下文里**（不 portal 到 `body` + 全局 z 阶梯）：
 *    教训与复量见 §7 第 607 条（`popover(500) > modal(400)` 倒挂 ⇒ 画得出来点不动）。
 */
export interface WebModalShellProps {
  /** 宿主自己的两枚类名（遮罩 / 面板）。缺省用共享壳那两枚 `ht-web-modal__*`。 */
  readonly overlayClass?: string;
  readonly dialogClass?: string;
  /** `aria-labelledby` 指向宿主那一枚标题的 id。 */
  readonly labelledBy?: string;
  /**
   * 查哪一行策略（`CLOSED_OVERLAYS` 里的一个）。
   * 🔴 宿主只许**选行**，不许在这里改口径 —— 口径只住那张表。
   */
  readonly policy: ClosedOverlay;
  /** testID 前缀：`${testId}` 落在面板上；`${testId}-scrim` 落在遮罩上。 */
  readonly testId: string;
  /** 安全侧出口（表里判成 `dismiss`/`cancel` 的通道都走它）。 */
  readonly onCancel: () => void;
  /** 表里判成 `ask-discard` 时的通道 —— 关之前要先问一句，而问法归宿主。省略＝关不掉（安全侧默认）。 */
  readonly onDismissAttempt?: (via: 'scrim' | 'escape') => void;
  /**
   * 这一格是否落"模态强制表态"（`requiresModalCommitment` 的读数，由宿主派生）。
   * 它**只**决定焦点接管的强度，不决定画不画这一层（理由见 `DangerConfirmDialog` 文件头）。
   */
  readonly modalCommitment?: boolean;
  readonly children: ReactNode;
  /** 初始焦点给哪一枚（危险确认那类必须给**安全侧**）。 */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * 这一层正在忙（提交中）。落成真属性 `aria-busy` —— 读屏用户据此知道
   * "按下去的那一下已经在跑了"，而不是"界面没反应"。
   * ⚠️ 第二枚消费者（`CategoryCreateDialog`）带来的：它的壳上原本就有这一格，
   *    壳没有它就只能让宿主保留自己的 `role="dialog"` —— 那等于没迁。
   */
  readonly busy?: boolean;
  /**
   * 画在**遮罩层内、面板之外**的那一格（默认没有）。
   *
   * 🔴 唯一的用途是宿主的"先问一句"确认层（`modal-dirty-form` 的 `ask` 通道）：
   *    它必须与面板在**同一个堆叠上下文**里、且在面板之后出现，才能压住面板
   *    而不去跟 z-index 比数字（§7 第 607 条）。放进 `children` 就变成面板的子节点，
   *    会被面板的 `overflow` 裁掉。
   */
  readonly overlayChildren?: ReactNode;
}

export function WebModalShell({
  overlayClass,
  dialogClass,
  labelledBy,
  policy: policyKey,
  testId,
  onCancel,
  onDismissAttempt,
  modalCommitment = true,
  children,
  initialFocusRef,
  busy = false,
  overlayChildren,
}: WebModalShellProps): ReactNode {
  const containerRef = useModalFocusIsolation({ active: modalCommitment, initialFocusRef });
  const policy = closePolicyOf(policyKey);

  const requestDismiss = (channel: 'scrim' | 'escape'): void => {
    /**
     * 🔴 提交中**任何关闭通道都不动手**（含 Esc 与背景）。
     *
     * 这一格不是"防双击"那种 UI 礼貌：这一层的写请求已经发出去了，
     * 关掉它就没有地方接住结果（成功要收层、失败要留错误文案）。
     * 第二枚消费者（`CategoryCreateDialog`）原本在自己那 50 行里用 `busyRef` 守它 ——
     * 那是每一枚壳都要重写一遍的东西，收到这里来。
     */
    if (busy) return;
    const action = dismissActionFor(policy, channel === 'escape' ? policy.escape : policy.scrim);
    if (action === 'none') return;
    if (action === 'ask') {
      onDismissAttempt?.(channel);
      return;
    }
    onCancel();
  };

  const requestDismissRef = useRef(requestDismiss);
  requestDismissRef.current = requestDismiss;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestDismissRef.current('escape');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      role="presentation"
      className={overlayClass ?? 'ht-web-modal__overlay'}
      data-testid={`${testId}-scrim`}
      /**
       * 🔴 背景通道走 **mousedown + 目标判定**，不走 `click`。
       *    用 `click` 的话，"在输入框里按下、松手时指针已经滑到背景上"会被算成
       *    点了背景 ⇒ 用户只是在字段里选文字，整层就关了（脏表单那一档还会弹出
       *    「放弃修改？」）。第二枚消费者（`CategoryCreateDialog`）原本就是
       *    `onMouseDown` + `target === currentTarget`，那是它对的形状，壳不该倒退。
       */
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        requestDismiss('scrim');
      }}
    >
      {overlayChildren}
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        /* 只在真的忙时落这一格：不忙时**不写**而不是写 `"false"` ——
           否则这次抽取会给原本没有该属性的壳（危险确认）凭空加一个 DOM 属性。 */
        aria-busy={busy ? true : undefined}
        aria-labelledby={labelledBy}
        className={dialogClass ?? 'ht-web-modal__dialog'}
        data-testid={testId}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    </div>
  );
}
