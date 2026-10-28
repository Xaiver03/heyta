/**
 * 脏表单的「先问一句」接线（Web 侧）
 * ================================
 *
 * 判据不在这里，也不在产品页里：**它只住在 `closePolicyOf` 那张表**
 * （`packages/ui/src/overlay/dismissal.ts`）。这个 hook 干的是宿主该干的活 ——
 * 把表里那条通道查出来、在"真的会丢"的时候把确认框挂上、取消后把焦点还回去。
 *
 * 🔴 三条各自写死的规则，都在这里收成一处：
 *
 *   1. **`deny` 就是什么都不做**（危险确认与强制阅读那一档），不"顺手关一下"；
 *   2. **`ask` 只在真的脏时才问**。空表单也拦一道确认，是把成本转嫁给每一次正常操作；
 *   3. **确认框自己不给"绕过"出口**：它按 `danger-confirm` 那一档接 ——
 *      禁背景、无 ×、Esc 等价于安全侧的「继续编辑」。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这里的 dialog 是 Web 自绘，而不是共享的 `DangerDialog`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 共享的 `OverlayModal` 地基是 react-native-web 的 `Modal`。实测（2026-10-27，
 * `apps/web` 的 vite dev 构建）：**它在这个宿主里根本不挂载** ——
 * 现量读数：`asking=true`、`guard` 非 null、provider 子树里那枚标记 div 已经在
 * `document.body` 上，而 `ModalPortal` 该 append 的那一层**一个都没有**
 * （`body.children` 只多了标记那一枚），`[aria-modal]` 计数 0、
 * `[role="dialog"]` 仍是捕获浮层那一枚。全程无 console.error、无 pageerror
 * ⇒ 不是抛错，是**静默不渲染**。
 * jsdom 那边（`apps/web/tests/overlay-modal-contract.spec.tsx`）却是绿的 ——
 * 所以这一条只能在真浏览器里发现，正是 §6.2 要真浏览器判据的理由。
 *
 * 结论：**判断共享，渲染分端**（计划 §5 的边界）。Web 用下面这一枚 dialog，
 * 原生端继续用 `DangerDialog`；两边查的是同一张表，所以"该不该问、能不能绕过"
 * 只有一份答案。`packages/ui` 的 `Modal` 在 web 宿主失效这件事登记进
 * `docs/reference/environment-traps.md`，并改写了计划 §P6 的前提。
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { closePolicyOf, dismissActionFor, type ClosedOverlay } from '@heyta/ui';

/** 一次"想关"是从哪条通道来的。 */
export type DismissChannel = 'scrim' | 'escape' | 'systemBack';

export interface DirtyDismissGuard {
  /** 三条关闭通道**都**只许调这一个函数 —— 不许在页面里自己判能不能关。 */
  readonly requestDismiss: (channel: DismissChannel) => void;
  /**
   * 现在正在问。宿主拿它**挡住自己那三条通道的监听器** ——
   * 确认框开着时，页面在 capture 阶段挂的 Esc/pointerdown 会先于确认框收到事件，
   * 不挡就会把"问"再问一遍，甚至把确认框的 Esc（= 继续编辑）抢走。
   */
  readonly asking: boolean;
  /** 需要渲染进树里的确认框（没在问的时候是 `null`）。 */
  readonly guard: React.JSX.Element | null;
}

const scrimStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: cssVar('z.modal-commitment'),
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: cssVar('space.4'),
  background: cssVar('color.overlay'),
} as unknown as React.CSSProperties;

const dialogStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: cssVar('space.3'),
  boxSizing: 'border-box',
  inlineSize: 'min(28rem, 100%)',
  padding: cssVar('space.5'),
  borderRadius: cssVar('radius.lg'),
  background: cssVar('color.surface'),
  boxShadow: cssVar('shadow.lg'),
} as unknown as React.CSSProperties;

const titleStyle = {
  margin: 0,
  fontSize: cssVar('font-size.lg'),
  fontWeight: cssVar('font-weight.semibold'),
  color: cssVar('color.foreground'),
} as unknown as React.CSSProperties;

const bodyStyle = {
  margin: 0,
  fontSize: cssVar('font-size.sm'),
  lineHeight: cssVar('line-height.normal'),
  color: cssVar('color.foreground-muted'),
} as unknown as React.CSSProperties;

const actionsStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: cssVar('space.3'),
} as unknown as React.CSSProperties;

/**
 * 确认框本体。它自己的关闭语义也**只查表**（`danger-confirm`），
 * 所以"点背景 = 丢弃"这种形状在这一层写不出来。
 */
function DiscardConfirm({
  title,
  body,
  keepLabel,
  dropLabel,
  onCancel,
  onConfirm,
}: {
  readonly title: string;
  readonly body: string;
  readonly keepLabel: string;
  readonly dropLabel: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const keepRef = useRef<HTMLButtonElement>(null);
  const policy = closePolicyOf('danger-confirm');
  const escapeAction = dismissActionFor(policy, policy.escape);
  const scrimAction = dismissActionFor(policy, policy.scrim);

  // 初始焦点落在**安全那一侧**（「继续编辑」），不是危险按钮。
  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  // 🔴 **不 portal 到 `document.body`**：确认框画在**它所拦的那一层的层叠上下文里**，
  // 靠"同一个上下文里后来者在上"压在宿主面板之上。挂回 body 就要跟宿主比 z-index 数值，
  // 而本仓的 z 刻度是乱的（`.ht-habit-create-dialog` 占 `z.splash`=900，
  // 日历快速捕获占 `z.popover`=500）—— 比数字是一场军备竞赛，P7 要治的是刻度本身。
  //
  // 层：`z.modal-commitment`，**不是** `z.modal`。
  // 实测到的刻度缺陷：`--ht-z-popover: 500` 高于 `--ht-z-modal: 400` ⇒ 锚定浮层压住模态承诺层。
  // 现量（2026-10-27）：用 `z.modal` 时确认框只剩标题那一行露出来，两个按钮的命中点落在
  // 捕获浮层上，Playwright 等 60s 点不到。根治是把 `popover` 降到 `modal` 之下，
  // 但那是 12 处 `z.popover` 消费者的独立纵切（计划 §P7）；这里先用有名字的那一档。
  return (
    <div
      data-testid="discard-confirm-scrim"
      style={scrimStyle}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (escapeAction === 'close') onCancel();
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (scrimAction === 'close') onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="discard-confirm"
        style={dialogStyle}
      >
        <h2 id={titleId} style={titleStyle}>{title}</h2>
        <p style={bodyStyle}>{body}</p>
        <div style={actionsStyle}>
          <button
            ref={keepRef}
            type="button"
            className="ht-btn ht-btn--ghost"
            data-testid="discard-confirm-cancel"
            onClick={onCancel}
          >
            {keepLabel}
          </button>
          <button
            type="button"
            className="ht-btn ht-btn--danger"
            data-testid="discard-confirm-confirm"
            onClick={onConfirm}
          >
            {dropLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * @param isDirty 现在有没有"丢了就回不来"的内容。用 getter 而不是布尔值，
 *   是因为锚定层那一族的草稿住在被包起来的共享组件里（宿主读不到 state，
 *   但按 DOM 读得到输入框），且 dismiss 发生在事件回调里 —— 快照会过期。
 */
export function useDirtyDismissGuard({
  overlay,
  isDirty,
  onDismiss,
}: {
  readonly overlay: ClosedOverlay;
  readonly isDirty: () => boolean;
  readonly onDismiss: () => void;
}): DirtyDismissGuard {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const policy = closePolicyOf(overlay);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  /**
   * 🔴 `requestDismiss` 的身份必须**稳定**：锚定层把三条通道挂在
   * `useLayoutEffect` 里的一次性 document 监听上，回调换身份会让那个 effect 重跑 ——
   * 症状是"确认框一开，面板重新定位、焦点被抢回输入框"。所以这里读 ref，不进 deps。
   */
  const askingRef = useRef(false);
  askingRef.current = asking;

  const requestDismiss = useCallback(
    (channel: DismissChannel) => {
      if (askingRef.current) return;
      const action = dismissActionFor(policy, policy[channel]);
      if (action === 'none') return;
      if (action === 'ask' && isDirtyRef.current()) {
        returnFocusTo.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setAsking(true);
        return;
      }
      onDismissRef.current();
    },
    [policy],
  );

  const guard = asking ? (
    <DiscardConfirm
      title={t('web.overlay.discard.title')}
      body={t('web.overlay.discard.body')}
      keepLabel={t('web.overlay.discard.keep')}
      dropLabel={t('web.overlay.discard.drop')}
      onCancel={() => {
        setAsking(false);
        // 🔴 焦点要还给**原来那一枚**控件：确认框收回去之后把焦点丢在
        // `<body>` 上，键盘用户就得从头 Tab 一遍 —— 那是把"取消"做成了惩罚。
        returnFocusTo.current?.focus();
      }}
      onConfirm={() => {
        setAsking(false);
        onDismissRef.current();
      }}
    />
  ) : null;

  return { requestDismiss, asking, guard };
}
