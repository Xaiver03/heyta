/**
 * 把 service worker 挂上，并给应用提供「排空组件点击」的入口。
 * =================================================================
 *
 * ## 🔴 只在生产构建里注册
 *
 * `vite dev` 下不注册。理由不是洁癖：
 * - dev 的模块是**带时间戳按需编译**的，SW 的 `fetch` 处理器会把它们当普通资源
 *   拦一次，HMR 的失败方式会变成"改了代码没反应"（而**不报错**）；
 * - 一个装过生产 SW 的 `localhost:5173` 会让开发者调试到的是**缓存里的旧代码**。
 *
 * 这条不影响 W3-2 的实测（那是 `vite preview` / 真实域名，都是生产构建）。
 *
 * ## ⚠️ `widgets` manifest 成员是 Edge 专有
 *
 * Chrome 上这个文件里的东西**全部装不上**（`navigator.serviceWorker` 有，
 * 但 `self.widgets` 没有）。所以这里注册 SW 是**无害且必要**的：
 * 没有 SW 就没有 `widgetclick` / `widgetinstall`，Windows 上组件根本不会出现。
 */

import type { RawWidgetClick } from './sw-core.js';

/**
 * service worker 的 URL —— **必须由 `BASE_URL` 派生，不能写死 `/sw.js`**。
 *
 * 🔴 这里原先写的是常量 `'/sw.js'`，在线上是坏的（2026-09-30 真浏览器验收抓到）：
 * 应用挂在 `https://heyta.waytofuture.cn/app/` 下，而 `/sw.js` 指的是**站点根** ——
 * 那里服务的是落地页，于是注册请求拿回 `text/html`：
 *
 * ```
 * SecurityError: Failed to register a ServiceWorker … script
 * ('https://heyta.waytofuture.cn/sw.js'): The script has an unsupported MIME type ('text/html')
 * ```
 *
 * 后果不是"少个功能"：**Edge 上组件根本不出现**，而这是本仓库
 * `check:widgets` / Adaptive Card 那一整条链的宿主入口。
 *
 * `BASE_URL` 正是"应用挂在什么路径下"（构建时由 `vite build --base=` 注入）：
 * 子路径部署是 `/app/`、根路径是 `/`，两种形态**同一行代码都对**。
 * 不要改成写死 `/app/` —— `vite dev` / `vite preview` 跑在根路径，那样会把它们弄坏。
 */
export function serviceWorkerUrl(): string {
  return `${import.meta.env.BASE_URL}sw.js`;
}

export function registerWidgetServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;

  // 不在 `?slice=1` 的验证入口里注册：那条路径连 op-log 都不初始化，
  // 混进 SW 只会让切片验证的失败原因变模糊。
  if (new URLSearchParams(window.location.search).has('slice')) return;

  // 🔴 **不能只挂在 `load` 上**：这个调用现在由隐私同意闸门驱动（链 5 / G-12），
  // 而闸门是在 `await initOpLog()` **之后**才补跑的 —— 那一刻 `load` 早就放完了，
  // 监听器永远不会触发，症状是**生产构建里 SW 从来不注册**（真浏览器实测：
  // `getRegistration()` 恒为 `null`，而**没有任何报错**）。
  // 保留等 `load` 的本意（不和小组件首屏抢带宽）不变，只补上"已经 load 完"这一支。
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

function register(): void {
  navigator.serviceWorker.register(serviceWorkerUrl()).catch((error: unknown) => {
    // 注册失败**不能影响应用可用性** —— 小组件是增强，不是功能前提。
    // 但要留痕：Windows 上组件不出现的第一个排查点就是这里。
    console.warn('[heyta] service worker 注册失败，小组件将不可用', error);
  });
}

/**
 * 读走组件点击日志（读后即清）。
 *
 * 🔴 **结果必须交给 `@heyta/widget-core` 的 `mergeIntent` 处理**，
 * 不能在这里自己判"要不要翻状态" —— 合并语义四端只有一份，
 * 在这里写第二份的话，漂移的表现是"某个平台的取消偶尔不生效"。
 *
 * 返回 `[]` 覆盖所有失败情况（没有 SW、SW 还没就绪、超时）：
 * 应用启动路径上不能因为"小组件子系统"挂掉而卡住。
 */
export function drainWidgetClicks(timeoutMs = 2000): Promise<RawWidgetClick[]> {
  if (!('serviceWorker' in navigator)) return Promise.resolve([]);
  if (!import.meta.env.PROD) return Promise.resolve([]);

  return new Promise<RawWidgetClick[]>((resolve) => {
    let settled = false;
    const finish = (value: RawWidgetClick[]): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    // 超时兜底：SW 被浏览器停掉时 `postMessage` 不会 reject，只会**永不回复**。
    // 没有这个兜底的话应用启动会永远挂在这一步。
    const timer = window.setTimeout(() => finish([]), timeoutMs);

    navigator.serviceWorker.ready
      .then((registration) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event: MessageEvent<unknown>) => {
          window.clearTimeout(timer);
          const data = event.data as { type?: string; clicks?: unknown } | null;
          if (data?.type === 'heyta:clicks' && Array.isArray(data.clicks)) {
            finish(data.clicks as RawWidgetClick[]);
          } else {
            finish([]);
          }
        };
        const worker = registration.active ?? registration.waiting ?? registration.installing;
        worker?.postMessage({ type: 'heyta:widget-drain' }, [channel.port2]);
      })
      .catch(() => {
        window.clearTimeout(timer);
        finish([]);
      });
  });
}

/** 把算好的 Adaptive Card 数据交给 SW 去推给组件。 */
export function pushWidgetData(
  kind: 'today' | 'quadrant' | 'habits' | 'focus',
  data: unknown,
  placeholder: unknown,
  dayStr: string,
  validUntil: number,
): Promise<void> {
  if (!('serviceWorker' in navigator)) return Promise.resolve();
  if (!import.meta.env.PROD) return Promise.resolve();

  return navigator.serviceWorker.ready
    .then((registration) => {
      const worker = registration.active ?? registration.waiting ?? registration.installing;
      // ⚠️ 这里**不能**用 MessageChannel 等回复：`putWidgetData` + `updateByTag`
      //    是"发出去就不管"的操作，等它会把页面渲染卡在推送完成上
      //    （而 `updateByTag` 在用户没装组件时会等待一个很短但非零的时间）。
      // 🔴 `dayStr` / `validUntil` **必须**一起发。少了它们，SW 缓存的这条数据
      //    就永远无法被判为过期 —— 而"永远不过期"在 Windows 上等于
      //    "永远显示旧任务"。SW 那边会**拒绝**没有期限的数据（见 `sw-core.ts`）。
      //    这两个值都由应用算（`planWidgetPublish`），与 iOS/Android 同源。
      worker?.postMessage({
        type: 'heyta:widget-data',
        kind,
        data,
        placeholder,
        dayStr,
        validUntil,
      });
    })
    .catch(() => {
      // 推不出去不影响应用 —— 组件会显示上一次的数据（由 `validUntil` 判过期）
    });
}

/**
 * 把**执行失败**的意图写回 SW 的点击日志（下次 drain 重试）。
 *
 * ⚠️ 写回**失败**时（SW 不可用 / 超时）我们**什么也做不了**：
 * 那几条意图已经随 drain 从日志里清掉了。这不是可以掩盖的事 ——
 * 所以调用方只能保证"不影响应用启动"，**不保证"意图一定不丢"**。
 * 这与移动端 `drain.ts` 文件头最后一段是同一个取舍。
 */
export function requeueWidgetIntents(intents: readonly RawWidgetClick[]): Promise<void> {
  if (intents.length === 0) return Promise.resolve();
  if (!('serviceWorker' in navigator)) return Promise.resolve();
  if (!import.meta.env.PROD) return Promise.resolve();

  return navigator.serviceWorker.ready
    .then((registration) => {
      const worker = registration.active ?? registration.waiting ?? registration.installing;
      worker?.postMessage({ type: 'heyta:widget-requeue', intents: [...intents] });
    })
    .catch(() => {
      // 留痕但不上抛：这段挂在应用启动路径上
      console.warn('[heyta] 失败意图写回 service worker 失败，这几条点击已丢失');
    });
}
