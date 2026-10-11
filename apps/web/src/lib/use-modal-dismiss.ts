import { useEffect, useRef, type RefObject } from 'react';

/**
 * 模态层的键盘出口（§8.2 第 6 条：两处 `role="dialog" aria-modal="true"`
 * 却没有 Esc、焦点也不入内）。
 *
 * 🔴 **监听挂捕获阶段**，不是因为它更快，而是因为冒泡那一条在这里根本收不到事件：
 * `@heyta/ui` 的表单字段是 react-native-web 的 `TextInput`，它在 keydown 里无条件
 * `stopPropagation()`（AGENTS §7 第 80 条，实测：keyup 能到 window、keydown 到不了）。
 * 认证面板的焦点通常就在口令输入框里 ⇒ 冒泡阶段的监听永远不触发，
 * 而那正是"写了 Esc 却按了没反应"的形状。已有的四份 Esc 浮层（搜索、批量工具条、
 * 迷你助手、设置）也都挂捕获，同一理由。
 *
 * ⚠️ **它不 stop 任何东西**。窗口上的捕获监听按注册顺序执行，面板比它下面那些层
 * 后挂载 ⇒ 它排在那几层后面，拦不到它们；真去用 `stopImmediatePropagation()`
 * 会把别人那几层的键盘行为一起摘掉。所以这里的已知边界是：
 * **面板开在设置浮层里时，一次 Esc 会连着关掉两层。**
 * 这不是这一单要改的东西（那一单要先把"谁是顶层"做成有主人的判断），
 * 但也不许把它读成"一次 Esc 只关一层"已经成立。
 *
 * ## 三件事，各挡一种坏
 *
 * 1. **焦点入内**：`aria-modal="true"` 说"屏幕阅读器现在只该看到这一块"，
 *    而焦点还在背后的页面上时，读屏用户按 Tab 就走进了那个"已经不存在"的层。
 *    只在焦点还不在面板里时才移动它 —— 面板里已经有人（例如自动聚焦的输入框）就不要抢。
 * 2. **还给触发者**：关闭时把焦点交回挂载前那一刻的活动元素，
 *    且仅当**它还在文档里**、**且当前焦点确实落在面板内**才交回 ——
 *    否则会把已经自己处理过焦点的那条链（头像菜单关合时自己会还原焦点）
 *    再抢一次，症状是"关掉面板之后焦点乱跳"。
 * 3. **卸载即解绑**：面板的打开/关闭就是本组件的挂载/卸载（`SyncBar` 里是条件渲染），
 *    所以没有 `open` 参数要维护，也没有"关了但监听还在"的余地。
 *
 * @param dialogRef 面板根元素（`role="dialog"` 那一层，需要 `tabIndex={-1}` 才收得到焦点）
 * @param dismiss   按 Esc 时要做的事 —— 由调用方决定关哪一层（面板里有子层时先关子层）
 */
export function useModalDismiss(
  dialogRef: RefObject<HTMLElement | null>,
  dismiss: () => void,
): void {
  const latest = useRef(dismiss);
  const trigger = useRef<Element | null>(null);

  useEffect(() => {
    latest.current = dismiss;
  }, [dismiss]);

  useEffect(() => {
    const dialog = dialogRef.current;
    // 记的是"挂载那一刻的焦点"，而 `document.body` 不算一个触发者
    // （它没有可聚焦语义，`body.focus()` 是无操作 —— 记了等于没记，
    // 还会把"焦点丢失"伪装成"已还原"）。App.tsx 的 `sheetReturnFocus` 同一条判断。
    const active = document.activeElement;
    trigger.current = active !== document.body ? active : null;
    if (dialog !== null && !dialog.contains(active)) {
      dialog.focus();
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      latest.current();
    };
    window.addEventListener('keydown', onKey, true);

    return () => {
      window.removeEventListener('keydown', onKey, true);
      const back = trigger.current;
      // 🔴 这里用的是**局部那一份 dialog**，不是 `dialogRef.current`：
      // React 卸载时先摘 ref、后跑 cleanup（实测：拿 ref 判会让这一支永远不执行，
      // 症状是"关掉面板后焦点掉在文档体上"）。
      //
      // "焦点还在自己这一层"要算两种形状：面板还在文档里时 `activeElement` 在它内部；
      // 节点已被 React 摘走时 `activeElement` 落回 `document.body` —— 那是"没人接住焦点"，
      // 不是"别人已经接住了"。真被别的层接走（例如触发它的那个菜单自己还原了焦点）时
      // 两种都不成立 ⇒ 不抢。
      const ours = document.activeElement === document.body
        || (dialog !== null && dialog.contains(document.activeElement));
      if (
        ours
        && back instanceof HTMLElement
        && back.isConnected
      ) {
        back.focus();
      }
    };
    // 只在挂载/卸载时建立与拆除：effect 里只读 `latest`/`dialogRef` 两枚 ref，
    // 而 `dismiss` 的更新由上面那条 effect 单独负责，所以这里不需要跟它重绑监听。
  }, [dialogRef]);
}
