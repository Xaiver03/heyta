/**
 * 捕获框日期面板的 **Web 外壳**（锚定浮层）
 * ===========================================
 *
 * 面板里的东西是共享的（`@heyta/ui` 的 `CaptureDuePanel`）；这个文件只回答
 * web 自己的两件事：**画在哪儿** 与 **怎么收掉**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么必须 Portal 到 `body`，不能就地画
 *
 * 与 `DueEditor` 同一个实测结论：任务列表的行容器带 `overflow: hidden auto`
 * 与 `transform`，`absolute` 面板被裁到只剩一条边（几何在、点得中、**画不出来**），
 * `fixed` 不逃出子树时 `transform` 祖先又成了它的包含块。
 * 修法沿用先例：**fixed + Portal + 实测锚点**。
 *
 * 🔴 为什么关闭动作要查表，不在这里判
 *
 * `docs/agents/overlay-feedback.md` 那条硬规则：一层浮层能不能被点背景关掉
 * 是**全仓一个答案**，不许各写一遍。这一层吃 `popover` 那一档
 * （scrim/escape 都 `dismiss`、不配 ×）—— 它成立的原因是**关掉不丢任何东西**：
 * 面板里每点一格都当场写进胶囊（`model.ts` 的覆盖态），没有"改了没确定"这种中间态。
 * 哪天面板改成"确定才生效"，这一档就必须升成 `popover-dirty-form`，
 * 那时要改的是这张表和这个 prop，**不是**在这里加一句 confirm。
 */

import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { closePolicyOf, placeAnchoredPanel } from '@heyta/ui';

/** 胶囊的锚点 id —— 共享组件里那一枚 `testID="capture-due-capsule"`。 */
const CAPSULE_TEST_ID = 'capture-due-capsule';

export function CaptureDuePopover({
  content,
  onClose,
  title,
}: {
  readonly content: React.ReactNode;
  readonly onClose: () => void;
  readonly title: string;
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const trigger = document.querySelector<HTMLElement>(`[data-testid="${CAPSULE_TEST_ID}"]`);
    const previousFocus = document.activeElement;
    const policy = closePolicyOf('popover');

    const place = (): void => {
      if (trigger === null) return;
      const rect = trigger.getBoundingClientRect();
      const padding = Number.parseFloat(getComputedStyle(panel).paddingLeft) || 0;
      /*
       * 🔴 可用底边**不是视口底边**。塌缩档（≤768）那条底部导航（`.ht-compact-rail`）
       * 是应用自己的常驻栏，浮层压在它上面 = 面板底边那几条出口点不到
       * （375×720 实测，看图抓到；上一版只量"外壳越没越视口"，那条是绿的）。
       *
       * 这一格是**宿主知识**，不下沉进 `placeAnchoredPanel`：共享那份只管
       * "给定可用区域该往哪边弹"，谁占掉了底部那 60px 由每一端自己说
       * （移动端用的是 BottomSheet，本来就没有这条栏）。
       */
      const rail = document.querySelector<HTMLElement>('.ht-compact-rail');
      const railTop = rail?.getBoundingClientRect().top ?? window.innerHeight;
      const usableBottom = Math.min(window.innerHeight, railTop - padding);
      const roomAbove = Math.max(0, rect.top - padding - padding);
      const roomBelow = Math.max(0, usableBottom - rect.bottom - padding - padding);
      // 面板是 fixed 的：最大高度必须跟着"往哪边弹"这一判走，否则贴着视口底开
      // 会画出视口外，而最后两周根本点不到（`DueEditor` 那格翻过的同一个错）。
      const available = Math.max(roomAbove, roomBelow);
      panel.style.maxBlockSize = `${available}px`;
      // 🔴 光设 maxBlockSize **不裁内容，只是让它溢出**。限高必须落在内层滚动容器上：
      // 外壳负责位置，内层负责"溢出的部分还能滚到"。
      const scroller = panel.firstElementChild;
      if (scroller instanceof HTMLElement) {
        scroller.style.maxBlockSize = `${Math.max(0, available - padding * 2)}px`;
      }
      const size = panel.getBoundingClientRect();
      const pos = placeAnchoredPanel(
        rect,
        size,
        { width: window.innerWidth, height: usableBottom },
        { gap: padding, edge: padding },
      );
      panel.style.top = `${pos.top}px`;
      panel.style.left = `${pos.left}px`;
    };
    place();

    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    observer?.observe(panel);

    const dismiss = (event: PointerEvent): void => {
      if (policy.scrim !== 'dismiss') return;
      if (!(event.target instanceof Node)) return;
      if (panel.contains(event.target) || trigger?.contains(event.target)) return;
      closeRef.current();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (policy.escape !== 'dismiss') return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      // 关掉了要把焦点还给胶囊；胶囊已经不在了（提交后清空）才回落到原来的焦点。
      if (trigger?.isConnected) trigger.focus();
      else if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(
    <div
      ref={panelRef}
      className="ht-material ht-material--popover"
      data-testid="capture-due-popover"
      role="dialog"
      aria-label={title}
    >
      {/*
        内层这一层**只负责滚动**：外层那块是卡片（位置、底色、阴影），
        内层承接 `place()` 算出来的限高。少了它，视口不够高时内容溢出，
        面板底边那几条出口就压在底部导航下面 —— 375 档实测踩过（看图抓到的，不是断言抓到的）。
      */}
      <div className="ht-material__popover-scroll" data-testid="capture-due-scroll">{content}</div>
    </div>,
    document.body,
  );
}
