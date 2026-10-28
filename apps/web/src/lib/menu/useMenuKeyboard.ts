import { MENU_FOCUS_INDEX_ON_OPEN, menuActionOf } from '@heyta/ui';
import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

/**
 * 菜单键盘的**渲染那一半**（全局 UX 线 P5）
 * =======================================
 *
 * 🔴 这一层只干三件 DOM 的事：数出菜单项、把焦点挪过去、把关闭动作转给宿主。
 * **"这枚键该发生什么"一个字都不在这里判断** —— 那归 `packages/ui/src/control/menu.ts`，
 * 三处菜单（账号菜单 / rail 的 More / 习惯的 More）因此不可能再各答一份。
 * 判据：AGENTS §3.5（宿主外壳不许有业务判断）+ 本线 P5 的目标"不在三处复制事件处理"。
 *
 * ## 焦点进入与归还（计划 §P5 判据里的那一格）
 *
 *   · 打开 ⇒ 焦点进第一项（`MENU_FOCUS_INDEX_ON_OPEN`），不是留在触发者上 ——
 *     留在触发者上时，用户按方向键会**滚页面**而不是走菜单；
 *   · Esc ⇒ 关掉并把焦点还给触发者；Tab ⇒ 关掉但**不**还（两格相反，理由在共享层注释里）。
 *
 * ## 嵌套层
 *
 * `nestedOpen` 为真时共享层会把整把键盘让出去（含 Esc）。
 * 这一格治的是"菜单里再开一层对话框，按一次 Esc 两层一起没"。
 */
export interface UseMenuKeyboardArgs {
  readonly open: boolean;
  /** 菜单容器（`role="menu"` 那一层）。 */
  readonly containerRef: Readonly<RefObject<HTMLElement | null>>;
  /** 触发它的那枚按钮（Esc 之后焦点回它）。 */
  readonly triggerRef: Readonly<RefObject<HTMLElement | null>>;
  /**
   * 宿主关面板。`refocusTrigger` 由共享判断给出，宿主**不许**自己决定还不还。
   */
  readonly onClose: (reason: { readonly refocusTrigger: boolean }) => void;
  /** 这一层之上是否开着嵌套的模态（对话框/确认层）。 */
  readonly nestedOpen?: boolean;
  /** 菜单项选择器。默认 `[role="menuitem"]`；有分隔符/子菜单时宿主可收窄。 */
  readonly itemSelector?: string;
  /**
   * 是否由这一层负责"焦点进入"。默认 true。
   *
   * ⚠️ 唯一该传 `false` 的理由是宿主自己有一枚**进度的**门槛（例如账号菜单要等 fixed
   * 坐标量好、面板从 `hidden` 变可见之后 `.focus()` 才生效）。
   * 那种情况下宿主自己那一格**必须仍用 `MENU_FOCUS_INDEX_ON_OPEN`** ——
   * 可以晚一帧，不可以换一项。
   */
  readonly focusOnOpen?: boolean;
  /**
   * 归还焦点的那一下。默认 `.focus()`。
   *
   * ⚠️ 面板挂在 `document.body` 上、且宿主在滚动容器里时要传
   * `(el) => el?.focus({ preventScroll: true })`（rail 的 More 就是这一格）——
   * 默认的 `.focus()` 会把页面滚到面板原来的锚点，用户看到的是"关个菜单页面跳一下"。
   */
  readonly focusTrigger?: (trigger: HTMLElement | null) => void;
}

const DEFAULT_ITEM_SELECTOR = '[role="menuitem"]';
/** 类型查找的输入缓冲窗口（毫秒）：超过它就当作重新起头。 */
const TYPEAHEAD_RESET_MS = 500;

function itemsOf(container: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (item) => item.offsetParent !== null || item.getClientRects().length > 0,
  );
}

export function useMenuKeyboard({
  open,
  containerRef,
  triggerRef,
  onClose,
  nestedOpen = false,
  itemSelector = DEFAULT_ITEM_SELECTOR,
  focusOnOpen = true,
  focusTrigger = (trigger) => trigger?.focus(),
}: UseMenuKeyboardArgs): (event: ReactKeyboardEvent<HTMLElement>) => void {
  const typedRef = useRef('');
  const typedAtRef = useRef(0);

  // 关掉时清掉类型查找缓冲：否则下次打开时残留的前缀会立刻把焦点甩到某一项。
  useEffect(() => {
    if (!open) {
      typedRef.current = '';
      typedAtRef.current = 0;
    }
  }, [open]);

  /** 焦点进入：打开的那一帧把焦点放到第一项。 */
  useEffect(() => {
    if (!open || !focusOnOpen) return;
    const container = containerRef.current;
    if (container === null) return;
    const items = itemsOf(container, itemSelector);
    const target = items[MENU_FOCUS_INDEX_ON_OPEN];
    if (target !== undefined) {
      // 等一帧：面板刚挂载时 `offsetParent` 还可能量不到（portal + 定位测量）。
      requestAnimationFrame(() => target.focus());
    }
  }, [containerRef, focusOnOpen, itemSelector, open]);

  /**
   * 一枚键的处理：读现状 → 问共享判断 → 执行 DOM 那一半。
   *
   * 两个入口共用它（面板上的 `onKeyDown`，与下面那条"焦点还没进菜单时"的捕获监听），
   * 所以**不存在**"两处各解释一遍按键"。
   */
  const dispatch = useCallback(
    (key: string, ctrlKey: boolean, altKey: boolean, metaKey: boolean, prevent: () => void, stop: () => void): void => {
      const container = containerRef.current;
      if (container === null) return;
      const items = itemsOf(container, itemSelector);
      const active = document.activeElement;
      const activeIndex = items.findIndex((item) => item === active);

      // 类型查找的缓冲在这里维护（计时归宿主，判断归共享层）。
      const now = Date.now();
      const isPlainChar = key.length === 1 && !ctrlKey && !altKey && !metaKey;
      if (!isPlainChar || now - typedAtRef.current > TYPEAHEAD_RESET_MS) typedRef.current = '';
      const typed = isPlainChar ? `${typedRef.current}${key}` : undefined;
      typedAtRef.current = now;
      if (typed !== undefined) typedRef.current = typed;

      const action = menuActionOf({
        key,
        itemCount: items.length,
        activeIndex,
        labels: items.map((item) => item.textContent ?? ''),
        typed,
        nestedOpen,
        withModifier: ctrlKey || altKey || metaKey,
      });

      switch (action.kind) {
        case 'focus': {
          prevent();
          items[action.index]?.focus();
          return;
        }
        case 'activate': {
          prevent();
          items[action.index]?.click();
          return;
        }
        case 'close': {
          /**
           * 🔴 只有**要自己挪焦点**的那一种才 `preventDefault`。
           *
           * `refocusTrigger` 为假（Tab）时不拦默认行为：Tab 的意思就是"去下一枚控件"，
           * 拦了它、又不挪焦点，焦点就留在正在被卸载的那枚菜单项上（浏览器把它丢给
           * `body`），用户按 Tab 却"什么都没发生"。
           * 这一格是真浏览器腿抓出来的：第一版两种关闭都 `preventDefault`，
           * 于是 Tab 之后焦点仍停在触发者上 —— 与 Esc 那格混成同一个答案。
           */
          stop();
          if (action.refocusTrigger) prevent();
          typedRef.current = '';
          onClose({ refocusTrigger: action.refocusTrigger });
          if (action.refocusTrigger) focusTrigger(triggerRef.current);
          return;
        }
        case 'ignore':
          return;
      }
    },
    [containerRef, focusTrigger, itemSelector, nestedOpen, onClose, triggerRef],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>): void => {
      dispatch(event.key, event.ctrlKey, event.altKey, event.metaKey, () => {
        event.preventDefault();
      }, () => {
        event.stopPropagation();
      });
    },
    [dispatch],
  );

  /**
   * 🔴 焦点**还没进菜单**时的那一格（P5 的真浏览器腿抓出来的）。
   *
   * 面板上的 `onKeyDown` 只在焦点位于菜单内时才收得到键。而"打开"与"焦点进入"
   * 之间有一帧（`requestAnimationFrame`，账号菜单还要等 fixed 坐标量好）——
   * 那一帧里焦点还在触发者上，此时按 Tab：菜单的处理器一个字都收不到，
   * 于是面板**留着开着**而焦点已经走掉，就是本线最难查的那类"看不见却开着"。
   * 习惯的 More 第一次跑就红在这一格（它只有一项，焦点进入的时机最靠后）。
   *
   * 出路不是"在那个文件里再补一条监听"（那又回到各写一份），
   * 而是这一层统一接住：**目标不在面板内**时按同一份判断处理；
   * 在面板内的仍走 React 那条路，两者对同一枚键不会都动手。
   */
  useEffect(() => {
    if (!open) return;
    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      const container = containerRef.current;
      if (container !== null && container.contains(event.target as Node | null)) return;
      dispatch(event.key, event.ctrlKey, event.altKey, event.metaKey, () => {
        event.preventDefault();
      }, () => {
        event.stopPropagation();
      });
    };
    document.addEventListener('keydown', onDocumentKeyDown, true);
    return () => document.removeEventListener('keydown', onDocumentKeyDown, true);
  }, [containerRef, dispatch, open]);

  return onKeyDown;
}
