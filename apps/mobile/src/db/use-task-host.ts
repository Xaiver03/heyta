/**
 * 取应用宿主的**唯一**钩子（屏幕侧）
 * ==============================================================
 *
 * 🔴 这个文件治的是 U16 那条 P0 的第二层（崩溃审计 2026-11-08 · §H.4）。
 *
 * 病情：`open-host.ts` 里那种单例对人类是够用的，对 React 不够 ——
 * 19 个屏幕各自写着
 *
 *     const [host, setHost] = useState<AppHost | null>(null);
 *     useEffect(() => { void openTaskHost().then(setHost); }, []);
 *
 * 拿到的是**快照**，而依赖数组是空的 ⇒ 那个 effect 一辈子只跑一次。
 * 于是本机数据被销毁（主动注销、或**别的设备注销后同步读到信号** —— 后一条路
 * 完全不导航、屏幕原地继续挂着）之后：
 *
 *   1. `resetTaskHostCache()` 把单例作废、把旧 adapter `close()` 掉；
 *   2. 屏幕手里那个 `AppHost` 还指着**同一个已作废的 adapter**；
 *   3. 下一次读/写落到 `AdapterDestroyedError`。
 *
 * 而且它**不会自己好** —— 屏幕上没有任何东西会再调一次 `openTaskHost()`。
 * 用户看到的是"注销之后随手点哪个标签都报错，只有杀进程重开才恢复"。
 *
 * 治法不是给 19 个屏幕逐个补一行，而是把"**宿主换代**"变成一件可观察的事：
 * `open-host.ts` 暴露 `subscribeTaskHostEpoch` / `getTaskHostEpoch`，
 * 屏幕一律经本钩子取宿主。换代 ⇒ 订阅者重跑 ⇒ 自动重新取到新宿主。
 *
 * ⚠️ 为什么是钩子而不是"返回一个稳定的代理对象"：`AppHost.getState()` 是**同步**的
 * （`host.engine.getState()` 也是）。代理在"新宿主还没打开"的那一帧里没有同步答案，
 * 只能抛或者返回旧值 —— 前者把问题挪个地方，后者是**静默拿旧库的数据给用户看**。
 * 钩子可以把"正在重开"如实表达成 `host === null`，界面画的还是它原来那个加载态。
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppHost } from '@heyta/app-host';
import {
  getOpenTaskHostIfReady,
  getTaskHostEpoch,
  openTaskHost,
  subscribeTaskHostEpoch,
} from './open-host';

export type TaskHostState = {
  /** 已就绪的宿主；打开中、或刚换代还没打开完时为 `null`。 */
  readonly host: AppHost | null;
  /** 打开失败的原因（已归一成可显示的一句话）；没失败为 `null`。 */
  readonly error: string | null;
};

export type TaskHostOptions = {
  /**
   * 打开失败时的回调。给"本来就把这句错误写进自己错误态"的屏用 ——
   * 迁移时只换取宿主的来源，不碰它们的渲染逻辑。
   */
  readonly onError?: (message: string) => void;
};

/**
 * 订阅"当前这一代宿主"。
 *
 * 返回值里 `host === null && error === null` 的含义是**正在打开**，
 * 这与各屏原有的"首帧 host 还是 null"完全一致 —— 所以迁移过来时
 * 界面上的加载态、提前 return、hook 计数都不会变（`TasksScreen` 那条约 24 个 hook
 * 的界线上尤其要紧，见该文件里"第 1 次渲染 / 第 2 次渲染"那段注释）。
 */
export function useTaskHost(options?: TaskHostOptions): TaskHostState {
  /**
   * 🔴 `onError` 走 ref：调用方普遍写成内联箭头（`onError: (m) => setError(m)`），
   * 那个函数每次渲染都是新的。直接进依赖数组会让 effect 每次渲染都重跑 ——
   * 而它重跑的代价是**再开一次宿主**。
   */
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

  const epoch = useSyncExternalStore(
    subscribeTaskHostEpoch,
    getTaskHostEpoch,
    getTaskHostEpoch,
  );
  const [host, setHost] = useState<AppHost | null>(() => getOpenTaskHostIfReady() ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    /**
     * 🔴 换代的第一件事是**把旧宿主放开**（而不是继续渲染它）。
     * 作废与"屏幕发现作废"之间隔着一次 React 提交，这段时间里任何写入
     * 都会打到已销毁的 adapter 上；渲染成 `null` 让界面回到加载态，
     * 那些写入口本来就有 `if (host === null) return`。
     */
    setHost(getOpenTaskHostIfReady() ?? null);
    setError(null);
    void openTaskHost()
      .then((opened) => {
        if (alive) setHost(opened);
      })
      .catch((e: unknown) => {
        // 与各屏原来的归一方式逐字一致：`e instanceof Error ? e.message : String(e)`。
        const message = e instanceof Error ? e.message : String(e);
        if (!alive) return;
        setError(message);
        // 各屏原本把这句话写进自己的错误态；迁移后照旧回灌，界面一个字都不用改。
        onErrorRef.current?.(message);
      });
    return () => {
      // 卸载后 `setState` 是无声的脏写入（切标签很快时必然发生）。
      alive = false;
    };
  }, [epoch]);

  return { host, error };
}
