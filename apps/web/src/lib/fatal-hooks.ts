/**
 * 全局致命错误钩子 —— 接住 ErrorBoundary **接不住**的那三类
 * =========================================================
 *
 * 【为什么需要它（崩溃审计 2026-11-08 · U12 第 2 条 P0）】
 *
 * 审计时全仓 grep `unhandledrejection` / `addEventListener('error')` / `reportError`
 * 命中 **0**。也就是说这个应用此前**没有任何**全局错误观测点：
 *
 *   - `main.tsx` 里有若干 `void somePromise()`（`verifyLibraryOwner` /
 *     `hydrateLastSyncedAt` / `refreshPendingUpload` …）；
 *   - 事件处理器里的抛错；
 *   - `setTimeout` 回调里的抛错。
 *
 * 这三类**都逃过 React 的错误边界**（React 只接渲染期与生命周期），
 * 所以既不会变成错误屏、也不会留下任何痕迹 —— 用户的体感是"点了没反应"。
 *
 * 【它做什么、不做什么】
 *
 * 做：把三类错误统一收口，留痕（console）+ 可选上报 + 置一个可查询的
 * "本进程出过致命错误"标记（供错误屏/诊断页读取）。
 *
 * 不做：**不试图自动恢复**。自动重新渲染一棵已经出错的树，会把状态搞得更乱；
 * 这里只保证"失败可见"，恢复由用户的重试或刷新决定。
 *
 * ⚠️ 为什么不用 `reportError()`：它在 React 19 里会被 React 接走并可能触发
 * 自身的错误流程，行为随版本变；`addEventListener` 是稳定语义。
 */

export interface FatalErrorRecord {
  readonly kind: 'error' | 'unhandledrejection';
  /** 归一化后的消息（`Error.message`，非 Error 用 `String()` 的安全版）。 */
  readonly message: string;
  /** 原始值，供诊断与上报。 */
  readonly raw: unknown;
  /** 发生时刻（`Date.now()`）。 */
  readonly at: number;
}

export interface FatalHooksOptions {
  /** 上报回调（可选）。它自己抛错会被吞掉 —— 上报不能再成为错误源。 */
  onFatal?: (record: FatalErrorRecord) => void;
  /**
   * 是否接管 `console.error` 之外的输出。默认只 `console.error`。
   * 测试里可关掉以免污染输出。
   */
  silent?: boolean;
}

/** 本进程已发生的致命错误（最近的在前，最多保留 20 条）。 */
const records: FatalErrorRecord[] = [];
const MAX_RECORDS = 20;

/**
 * 安全地把任意值转成一行文本。
 *
 * 为什么要自己写：`String()` 对 `Object.create(null)` 会抛（没有 `toString`），
 * 而这里恰恰是在错误处理路径上 —— 处理错误本身抛错是最不可接受的一种失败。
 */
function safeMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  try {
    return String(value);
  } catch {
    return '[无法字符串化的错误值]';
  }
}

/** 读本进程已发生的致命错误（副本，调用方改不到内部状态）。 */
export function fatalErrorRecords(): FatalErrorRecord[] {
  return [...records];
}

/** 本进程是否出过致命错误（供诊断页/错误屏决定要不要多显示一块）。 */
export function hasFatalError(): boolean {
  return records.length > 0;
}

/** 清空记录（测试用；生产上没有任何调用点）。 */
export function resetFatalErrorRecords(): void {
  records.length = 0;
}

/**
 * 装上全局钩子。**必须在任何 `root.render()` 之前调用** ——
 * 否则启动链早期（模块求值、首个 effect）的错误会落在窗口之外。
 *
 * 幂等：重复调用不会重复注册（用模块级标记），因为 `main.tsx` 的
 * 热更新与某些壳会重复执行到这个模块。
 *
 * @returns 卸载函数（测试用；生产上不卸载 —— 它就是这个进程的生命周期）。
 */
let installed = false;

export function installFatalErrorHooks(options: FatalHooksOptions = {}): () => void {
  if (installed) return () => undefined;
  installed = true;

  const record = (kind: FatalErrorRecord['kind'], raw: unknown): void => {
    const entry: FatalErrorRecord = { kind, message: safeMessage(raw), raw, at: Date.now() };
    records.unshift(entry);
    if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
    if (options.silent !== true) {
      try {
        console.error(`[heyta] ${kind === 'error' ? '未捕获错误' : '未处理的 Promise 拒绝'}`, raw);
      } catch {
        // console 被禁用：什么都做不了。
      }
    }
    try {
      options.onFatal?.(entry);
    } catch {
      // 上报失败不改变"已经记录下来"这件事。
    }
  };

  const onError = (event: ErrorEvent): void => {
    // 资源加载失败（img/script 的 error）也走这里，但它们的 `error` 是 null；
    // 那不是致命错误，跳过以免噪声淹没真正的崩溃。
    if (event.error === null && event.message === '') return;
    record('error', event.error ?? event.message);
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    record('unhandledrejection', event.reason);
  };

  globalThis.addEventListener('error', onError);
  globalThis.addEventListener('unhandledrejection', onRejection);

  return () => {
    globalThis.removeEventListener('error', onError);
    globalThis.removeEventListener('unhandledrejection', onRejection);
    installed = false;
  };
}
