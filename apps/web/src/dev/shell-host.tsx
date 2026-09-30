/**
 * M2-B 验证入口 —— **共享 UI 渲染原生宿主推过来的真数据**
 * ==========================================================
 *
 * ## 与 `universal-slice.tsx` 的分工（别把两者搞混）
 *
 * | 入口 | 数据从哪来 | 回答的问题 |
 * |---|---|---|
 * | `?slice=1` | **固定种子**（`SEED`） | M2-A：共享 UI 能不能在这个宿主里**渲染出来** |
 * | `?shell=1`（本文件） | 🔴 **原生壳推过来的真数据** | M2-B：壳能不能把它**自己的数据**交给这份 UI |
 *
 * M2-A 用种子数据是**刻意的** —— 那一步要隔离的是"渲染机制"，
 * 混进数据来源只会让失败原因变模糊。但正因如此，**M2-A 不能证明数据通路**，
 * 所以需要本文件。
 *
 * ## 通道形状：宿主**推**，这一侧**收**
 *
 * 原生侧（`apps/desktop-windows/HeytaWindows/MainWindow.xaml.cs`）在页面加载后调用
 * `window.__heytaSetTasks(<json>)`，本文件把它接住并渲染。
 *
 * 🔴 **为什么不是这一侧去拉**（比如 `fetch('/api/tasks')`）：
 * 壳的数据在 **Jint + SQLite** 里，不在一个 HTTP 服务后面。
 * 为一个 spike 去起一个本地 HTTP 服务，等于把"M2 要不要引入一个本地服务"
 * 这个**尚未决定的大问题**偷偷变成既成事实。
 * 推送式通道是最小的那一刀：它只证明"数据能到"，不预设传输方式。
 *
 * ## 🔴 没有数据时**必须显眼地说出来**，不许安静地渲染一个空列表
 *
 * "空列表"在界面上与"同步还没跑"、"数据读不到"长得一模一样 ——
 * 那是本仓最忌讳的失效形态。所以这里把一个显式的探测点
 * （`data-testid="shell-host"`）与"还没收到数据"的提示画出来。
 */

import { useEffect, useState } from 'react';
import { useI18n } from '@heyta/i18n';
import { HeytaUiProvider, TaskList } from '@heyta/ui';
import type { Task } from '@heyta/domain';

/**
 * 原生宿主调用的那个函数。
 *
 * 挂到 `window` 上（而不是等一个 postMessage）：WebView2 的 `ExecuteScriptAsync`
 * 就是往页面里求值一段脚本，直接调用最省层、也最容易在证据里读出发生了什么。
 */
type HeytaSetTasks = (tasksJson: string) => void;

declare global {
  interface Window {
    __heytaSetTasks?: HeytaSetTasks;
    /** 最近一次收到的原始 JSON —— 让外侧的探测能读到"到底收到了什么"。 */
    __heytaLastPayload?: string;
    /**
     * WebView2 注入的宿主对象。**只在 WebView2 里存在** ——
     * 普通浏览器里是 `undefined`，所以这里必须容忍它缺失
     * （见 `sendToHost`）—— 那也让这个入口在浏览器里仍可直接打开调试。
     */
    chrome?: { webview?: { postMessage: (message: string) => void } };
    /** 最近一次**发往宿主**的消息（诊断用，探测能读到）。 */
    __heytaLastSent?: string;
  }
}

/**
 * 页面 → 宿主 的**唯一**出口。
 *
 * 🔴 用 WebView2 自己的 `postMessage`（宿主用 `WebMessageReceived` 接），
 * **不自造轮子** —— 官方通道已经处理好了同源判定、序列化与线程切换。
 *
 * ⚠️ 不在 WebView2 里（普通浏览器）时**返回 false 而不是抛**：
 * 这个入口要能在浏览器里直接打开调试，抛错会让它连渲染都做不了。
 */
function sendToHost(payload: Record<string, unknown>): boolean {
  const webview = window.chrome?.webview;
  if (webview === undefined) return false;
  const message = JSON.stringify(payload);
  window.__heytaLastSent = message;
  webview.postMessage(message);
  return true;
}

export function ShellHost(): React.JSX.Element {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<readonly Task[] | undefined>(undefined);
  const [payloadNote, setPayloadNote] = useState<string>(t('dev.shellHost.waiting'));

  useEffect(() => {
    const receive: HeytaSetTasks = (tasksJson) => {
      // 🔴 解析失败**要说出来**，不许安静地当成空数组 ——
      // "解析失败"与"真的没有任务"在界面上必须能分辨。
      try {
        const parsed: unknown = JSON.parse(tasksJson);
        // 🔴 契约是**信封** `{ tasks: [...] }`，与 `native-bridge.ts` 的
        //    `listTaskEntities()` 返回形状一致（那个函数直接回传桥的
        //    `ctx.getState().tasks`，所以外层信封是桥定的，不是这里定的）。
        //
        // ⚠️ 第一版按**裸数组**收，于是壳推了、页面也收到了、却报
        //    "宿主给的不是一个数组：object" —— 数据通路其实是通的，
        //    错的是我对**形状**的假设。**形状也要实测，别照着想象写契约。**
        if (typeof parsed !== 'object' || parsed === null || !('tasks' in parsed)) {
          setPayloadNote(`${t('dev.shellHost.noTasksField')}：${JSON.stringify(parsed).slice(0, 120)}`);
          setTasks([]);
          return;
        }
        const list = (parsed as { tasks: unknown }).tasks;
        if (!Array.isArray(list)) {
          setPayloadNote(`${t('dev.shellHost.tasksNotArray')}：${typeof list}`);
          setTasks([]);
          return;
        }
        window.__heytaLastPayload = tasksJson;
        setPayloadNote(t('dev.shellHost.received', { count: list.length, bytes: tasksJson.length }));
        setTasks(list as Task[]);
      } catch (error) {
        setPayloadNote(`${t('dev.shellHost.parseFailed')}：${error instanceof Error ? error.message : String(error)}`);
        setTasks([]);
      }
    };
    window.__heytaSetTasks = receive;
    return () => {
      delete window.__heytaSetTasks;
    };
  }, []);

  return (
    <HeytaUiProvider>
      <div
        data-testid="shell-host"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--ht-space-3)',
          padding: 'var(--ht-space-4)',
        }}
      >
        <div
          data-testid="shell-host-source"
          style={{
            fontSize: 'var(--ht-font-size-xs)',
            color: 'var(--ht-color-foreground-subtle)',
          }}
        >
          {t('dev.shellHost.source', { note: payloadNote })}
        </div>

        {tasks === undefined ? (
          // 还没收到数据：显式说出来，而不是画一个空列表。
          <div data-testid="shell-host-waiting">{t('dev.shellHost.waiting')}</div>
        ) : (
          <TaskList
            tasks={tasks}
            onToggleTask={(taskId) => {
              /**
               * 🔴 **写方向**：共享 UI 上的一次点击 → 宿主 → 壳的 SQLite。
               *
               * 与读方向对称：这一侧**不做任何判断**（该不该变、变成什么），
               * 只把"用户点了哪一条"原样交给宿主 ——
               * 业务规则在 `packages/app-host`，那是四端共用的那一份。
               *
               * ⚠️ **本地不乐观更新**：这一版刻意等宿主把新列表推回来再重画。
               * 乐观更新会让"写失败"看起来像"写成功"（列表已经变了），
               * 而本仓最忌讳的正是这个。慢一点，但对得上。
               */
              const task = tasks?.find((x) => x.id === taskId);
              if (task === undefined) return;
              const nextDone = task.completedAt === undefined;
              if (!sendToHost({ op: 'setTaskDone', id: taskId, done: nextDone })) {
                setPayloadNote(t('dev.shellHost.noHostChannel'));
              }
            }}
            fallbackTitle="（无标题）"
            // ⚠️ 刻意**不传** `emptyMessage`：那会是一处**未登记的**手写空态
            //（`check:empty-state` 会红）。这条 spike 入口不需要空态 ——
            // "收到 0 条"已经由上面的 `payloadNote` 说出来了。
            testID="shell-host-list"
          />
        )}
      </div>
    </HeytaUiProvider>
  );
}