import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@heyta/i18n';
import { receiptTimingOf, type ReceiptKind } from '@heyta/ui';
import './undo-receipt.css';

/**
 * 一条**带动作的自消回执**（撤销那一档）
 * ======================================
 *
 * 时长、能不能暂停、失败后留不留 —— 都**不在这里写**，查
 * `@heyta/ui` 的 `receiptTimingOf()`（判据正文与"为什么 8 秒不是 5 秒"在那个文件头）。
 * 本文件只负责把它渲染成 Web 上的一条就地回执。
 *
 * 🔴 立项时这里有三处各写各的形状（`App.tsx` 批量、`QuadrantBoard` 移动、
 * 移动端两处），全是 `setTimeout(…, 5000)`：没有暂停，两处失败写进会飘走的
 * `role="status"`，而批量那一枚连 `aria-live` 都没有 —— 读屏用户根本不知道
 * 屏幕上出现过一条可以撤销的东西。收编到这一处之后，同一条承诺只有一个实现。
 *
 * ## 三个不显然的形状，都是被判据逼出来的
 *
 * ① **暂停不重置**。手放到按钮上再挪开，剩下的是**原来还剩的那段**，
 *    不是又一个 8 秒。否则"把手挪开"会白送一整段窗口，
 *    而回执永远挂在页头那一行里挤占布局。实现是一个 `remainingRef`：
 *    每次 effect 卸载（暂停/依赖变化）时把没用完的那段扣下来，
 *    重新起算时从 `remainingRef` 起，**不从 `durationMs` 起**。
 * ② **失败之后不再自消**：容器留在那儿（按钮仍可再点一次 —— 撤销是
 *    幂等的，见 Skill `destructive-actions.md` §2 前提 3），
 *    同时**新**插入一个 `role="alert"` 的节点。
 *    🔴 不把容器的 role 从 `status` 改成 `alert`：同一枚节点换 role，
 *    多数读屏器不会重新播报 —— 那正是"失败没被宣布"的另一种写法。
 * ③ **成功就整条消失**（不是留一句"已撤销"）：撤销之后对象回到列表里，
 *    屏幕上已经有了证据，再留一条回执是第二份同一件事的陈述。
 */
export interface UndoReceiptProps {
  /** 回执正文：必须自带对象名或数量（"撤销删除 3 个任务"），由宿主用 `t()` 拼好注入。 */
  readonly label: string;
  /** 真正的撤销。reject 就落进"失败留在屏幕上"那一格；不许在调用方 `void` 掉。 */
  readonly onUndo: () => Promise<void>;
  /**
   * 容器那一格的 `data-testid`（动作按钮自动是它 + `-action`，失败那枚是 + `-failure`）。
   *
   * 🔴 用 DOM 属性名而不是自造一个 `testId` prop，是被一枚**别线的门禁**教的：
   * `apps/landing` 的页头登记处拿"`App.tsx` 里 `.ht-header__actions` 那一段的
   * `data-testid` 全集"逐项对账（`app-shell-shape.ts:224-227` 明写这条判据）。
   * 第一版这里写 `testId="bulk-undo"`，运行时 DOM 一模一样，但那一段源码里
   * 不再有字面的 `data-testid="bulk-undo"` ⇒ 展厅对账当场红。
   * 名字跟着 DOM 走，比"运行时等价"更耐用：**读源码的人与那把尺看到的是同一件事**。
   */
  readonly 'data-testid': string;
  /** 默认 `undo` 那一档（8 秒 + 两路暂停）。纯文本回执用 `notice`。 */
  readonly kind?: ReceiptKind;
  /** 窗口走完、撤销成功之后请宿主清掉自己那一格状态。失败时**不**调用。 */
  readonly onDismiss?: () => void;
}

export function UndoReceipt({
  label, onUndo, kind = 'undo', onDismiss, ...rest
}: UndoReceiptProps): React.JSX.Element | null {
  const testId = rest['data-testid'];
  const { t } = useI18n();
  const timing = receiptTimingOf(kind);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef<number>(timing?.durationMs ?? 0);
  const hoverRef = useRef(false);
  const focusRef = useRef(false);

  /**
   * 🔴 查不到策略时**不**兜一个默认时长 —— 那条路等于在表外新建一份裁决，
   * 而它永远不会红。这里的保守方向是"不自消"（Skill 对第 3–4 级的默认就是
   * 不许自动消失），代价只是一条常驻回执，不是一段承诺被悄悄缩短。
   * `kind` 的取值范围就是那张表的键，正常调用走不到这一格。
   */
  const autoDismiss = timing !== undefined && timing.autoDismiss;

  useEffect(() => {
    if (hidden || busy || failure !== undefined || paused || !autoDismiss || timing === undefined) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => {
      setHidden(true);
      onDismiss?.();
    }, remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [autoDismiss, busy, failure, hidden, onDismiss, paused, timing]);

  if (hidden) return null;

  /** 两个通道任一在场就暂停；两条都离开才继续走剩下的那段。 */
  const syncPaused = (): void => {
    const next = hoverRef.current || focusRef.current;
    if (next !== paused) setPaused(next);
  };

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      await onUndo();
      setHidden(true);
      onDismiss?.();
    } catch (caught: unknown) {
      // 不 `void`、不吞：这一格红过就写在 Skill §8 第二条的病灶上。
      setFailure(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="ht-undo-receipt"
      data-testid={testId}
      role="status"
      aria-live="polite"
      onPointerEnter={() => { hoverRef.current = true; syncPaused(); }}
      onPointerLeave={() => { hoverRef.current = false; syncPaused(); }}
      onFocus={() => { focusRef.current = true; syncPaused(); }}
      onBlur={() => { focusRef.current = false; syncPaused(); }}
    >
      <button
        type="button"
        className="ht-btn ht-btn--ghost ht-undo-receipt__action"
        data-testid={`${testId}-action`}
        disabled={busy}
        onClick={() => { void run(); }}
      >
        {busy ? t('web.feedback.undo.busy') : label}
      </button>
      {failure === undefined ? null : (
        <span className="ht-undo-receipt__failure" data-testid={`${testId}-failure`} role="alert">
          {t('web.feedback.undo.failed', { reason: failure })}
        </span>
      )}
    </div>
  );
}
