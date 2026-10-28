import { useEffect, useRef, type RefObject } from 'react';

/**
 * 模态层的焦点隔离（Web 侧，2026-10-27 全局 UX 整改 P2）
 * ===================================================
 *
 * 只管**焦点这三件事**，不管关闭策略（那归 `packages/ui/src/overlay/dismissal.ts` 那张表）：
 *
 * 1. **初始焦点**落在指定那一枚控件上；不给的话落在容器上 —— 但"给"这件事是判据：
 *    危险确认必须把初始焦点交给**安全侧**（回车的第一下应当是"不删"）。
 * 2. **Tab 不许走出去**：在层内循环。这一条的存在理由不是"规范这么说"，而是
 *    `TrashView.tsx` 的文件头以前**写着**"自绘 dialog + 焦点陷阱"而代码里没有 ——
 *    注释不是判据（AGENTS §6 第 2 条），所以这里把它做成一条能被 e2e 量到的行为。
 * 3. **关掉之后焦点还给触发它的那一枚**：不还的症状不是报错，是键盘用户的下一次 Tab
 *    从页面**开头**重新走起 —— 把"取消"做成了惩罚。
 *
 * ⚠️ 与 `useDirtyDismissGuard`（脏表单那侧）的分工：那一枚捕获的是"**问一句**"那一刻的
 *    焦点、并归还到**出错字段**；这一枚管的是"**层开着**"这一整段。生命周期不同，
 *    所以是两件事，不是第二份实现 —— 收拢到一枚的时机在计划 §P4（共享控件语义层）。
 */
export interface ModalFocusIsolationOptions {
  /** 这一层现在在屏幕上吗。`false` 时不接管焦点，也不做归还。 */
  readonly active: boolean;
  /**
   * 初始焦点该给谁。危险确认传"取消"那一枚。
   *
   * ⚠️ 收的是 **ref** 不是节点：这一层是条件渲染的，effect 跑的那一刻节点才刚挂上；
   *    把 `ref.current` 当依赖传进来，第一次渲染读到的是 `null` —— 症状是"焦点跑到容器上"，
   *    而它只在**第一次**打开时出现，第二次因为缓存就"好了"。
   */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
}

export function useModalFocusIsolation({ active, initialFocusRef }: ModalFocusIsolationOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 只在层**打开那一次**记触发者；写在一个会被重渲染冲掉的局部变量里，归还就会指向 `null`。
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (container === null) return;

    returnFocusTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const initial = initialFocusRef?.current ?? null;
    (initial ?? container).focus();

    const focusables = (): HTMLElement[] =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const items = focusables();
      const first = items.at(0);
      const last = items.at(-1);
      if (first === undefined || last === undefined) {
        // 一层里没有可聚焦的东西：把焦点按在容器上，别让它顺着页面走到背后那一层。
        event.preventDefault();
        container.focus();
        return;
      }
      const activeEl = document.activeElement as HTMLElement | null;
      // 焦点已经在容器上（刚打开、或从外面回来）：Shift+Tab 给末位，Tab 给首位。
      if (activeEl === container || !container.contains(activeEl)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && activeEl === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      // 归还只在**真的关掉**时做一次：卸载（条件渲染关掉这一层）就是"关掉"那一刻。
      const target = returnFocusTo.current;
      returnFocusTo.current = null;
      if (target && document.contains(target)) target.focus();
    };
  }, [active, initialFocusRef]);

  return containerRef;
}
