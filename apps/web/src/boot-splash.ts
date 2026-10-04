/**
 * 首屏（启动）动画的**退场接线**。
 *
 * ## 它为什么必须存在
 *
 * `apps/web/index.html` 里那段 `HEYTA-BOOT-SPLASH` 是生成物：一块
 * `position: fixed; inset: 0; z-index: var(--heyta-boot-z)`（阶梯最上一档，
 * 900）的满屏遮罩。**没有这段代码时，它会永远盖在应用上面** ——
 * 应用照常挂载、照常工作，只是用户再也点不到，而界面判据"截图非空白 +
 * 数得出主蓝"会**满分通过**（那块底板就是主蓝 #2563EB）。
 * 这正是环境陷阱 §7 第 82 条的形状：判据回答"有没有东西"，回答不了
 * "用户看见的是不是我们要的那一屏"。
 *
 * ## 为什么用 MutationObserver 而不是在某个组件里调用
 *
 * `main.tsx` 有**四条**渲染出口（`?shell=1` 壳验证入口、`?slice=1` 通用切片、
 * 正常 `<App />`、存储不可用时的 `ErrorScreen`）。挂在任何一条上都漏掉另外
 * 三条 —— 而 `?shell=1` 那条恰好是 macOS / Windows 原生壳 `package-app.sh`
 * 打进安装包时加载的入口，漏了它 = 装出来的桌面端**永远停在品牌帧**。
 *
 * 观察 `#root` 的**第一个子节点**就不一样了：四条出口都经过
 * `root.render(...)` 往这个容器里塞东西，"容器非空"是它们共同的必要条件。
 * 于是这里只有一个接线点，而且它失败的方式是"遮罩不消失"（立刻可见），
 * 不是"某个分支忘了调"（要走到那条分支才发现）。
 *
 * ## 时长不许出现在这里
 *
 * 退场动画的时长/缓动全在生成的那段 `<style>` 里（值来自 `tokens.css` 的
 * `duration.splash-exit` / `ease.exit`）。本文件只监听 `animationend`，
 * 所以它**没有**一个自己拍的毫秒数 —— 改 token 之后这里不需要跟着改，
 * 也就不会漂。`prefers-reduced-motion` 下那条媒体查询把时长压到 1ms，
 * 动画仍然发生、`animationend` 仍然触发，因此这个分支不需要特判。
 */

const BOOT_ELEMENT_ID = 'heyta-boot';
const LEAVING_CLASS = 'heyta-boot--leaving';

/**
 * 让首屏遮罩在应用**第一次画出内容**时退场。
 *
 * 必须在 `createRoot(container)` 之后、任何 `root.render()` 之前调用 ——
 * 反过来会漏掉"render 已完成但观察者还没挂上"这一种竞态，
 * 而那种情况下遮罩同样永远不消失。
 *
 * @param appRoot `#root` 容器（`main.tsx` 在容器缺失时已经先显式抛错，
 *                所以正常路径上拿到的就是真实容器；类型仍写成可空，是因为
 *                下面还有一条「拿不到容器时不许静默」的兜底）。
 */
export function armBootSplashDismiss(appRoot: HTMLElement | null): void {
  const boot = document.getElementById(BOOT_ELEMENT_ID);
  // 没有品牌帧就不需要退场：这一条同时兜住"打包时没跑生成器"的老产物，
  // 它必须是**安静**的（这里没东西可退场，报错只会把应用本身也拖下水）。
  if (boot === null) return;

  const leave = () => {
    if (boot.classList.contains(LEAVING_CLASS)) return;
    boot.classList.add(LEAVING_CLASS);
    // 动画结束后摘掉节点：留着它，`pointer-events: none` 虽然不挡点击，
    // 但无障碍树里会一直有一个 role="img" 的满屏元素，屏幕阅读器会把
    // 它念在应用**之前**（而它已经不承担任何信息了）。
    const remove = () => boot.remove();
    boot.addEventListener('animationend', remove, { once: true });
    // 退场动画被浏览器判定为"没有动画可跑"时 animationend 永不触发
    // （例如生成物被 CDN 改写、或用户在系统层面强制关掉动画）。
    // 这种情况**立刻**摘掉 —— 宁可没有淡出，也不能把应用盖住。
    if (getComputedStyle(boot).animationName === 'none') remove();
  };

  if (appRoot === null) {
    // 容器都没有 ⇒ 上面 `main.tsx` 的显式抛错已经接管了这一屏。
    // 这里不静默返回：把原因写进遮罩的 aria-label，读屏用户至少能听到
    // "找不到挂载点"，而不是一句 "heyta"。
    boot.setAttribute('aria-label', `${boot.getAttribute('aria-label') ?? ''} · mount point missing`);
    return;
  }

  // 已经非空（React 比这行代码先跑完的可能）就直接退场，否则观察第一次变化。
  if (appRoot.childNodes.length > 0) {
    leave();
    return;
  }
  const observer = new MutationObserver(() => {
    if (appRoot.childNodes.length === 0) return;
    observer.disconnect();
    leave();
  });
  observer.observe(appRoot, { childList: true });
}
