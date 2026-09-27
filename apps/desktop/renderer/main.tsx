/**
 * 桌面端渲染进程入口（M2）
 * ========================
 *
 * 🔴 这一页**没有任何业务逻辑**（AGENTS.md §3.5）。它做三件事：
 *   1. 经 `window.heytaDesktop` 向主进程要数据；
 *   2. 把数据交给 `@heyta/ui` 的**共享** `TaskList` 渲染；
 *   3. 把用户操作原样转发回主进程。
 *
 * 为什么这不只是"顺手复用一下组件"：M1 判据第 4 条要的正是
 * **"桌面端加载的是同一套共享 UI"**。第一版的 `renderer/index.html`
 * 是个自己写的临时页（它自己拼字符串、自己定颜色），只能证明 IPC 通，
 * 证明不了共享 UI 在 Electron 里能跑 —— 而现在这一页里没有任何
 * 属于"任务行长什么样"的代码。
 *
 * ⚠️ 这里**不 import `@heyta/i18n`**。仓库为第二份 React 崩过一次
 * （APK 启动即崩）。文案就在本文件里写成常量 —— 桌面端目前只有中文，
 * 等真要出英文时再谈，而不是现在就为它引入一个会带进第二份 React 的依赖。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { Task } from '@heyta/domain';
import { HeytaUiProvider, TaskList } from '@heyta/ui';

/**
 * 🔴 设计 token。**不引这一行，上面那些 `var(--ht-*)` 全都解析不出来** ——
 * 而失败的样子是"样式静默消失"（字号/间距/颜色全变浏览器默认），
 * **不会报任何错**，`check:design` 也照样是绿的（它检查的是"有没有用 token"，
 * 不是"token 定没定义"）。
 *
 * 与 `apps/web/src/main.tsx` 引的是**同一份** `tokens.css` —— 这正是
 * "三端共享设计系统"的落点。
 */
import '@heyta/design-system/tokens.css';

import type { DesktopRequest } from '../src/ipc-contract';

/**
 * preload 暴露的桥（`window.heytaDesktop`）。
 *
 * 类型**派生自 `DesktopRequest`**，不自己抄一遍方法名 —— 抄一遍的话，
 * 契约改了这里不会报错，只会在运行时静默失败。
 */
interface DesktopBridge {
  request(request: DesktopRequest): Promise<unknown>;
}

declare global {
  interface Window {
    readonly heytaDesktop: DesktopBridge;
  }
}

/**
 * 任务形状**直接用 `@heyta/domain` 的 `Task`**，不在这里 `Pick` 一个窄版本。
 *
 * 第一版写成 `Pick<Task, 'id' | 'title' | 'completedAt'>`，想的是"本页只画这几个"，
 * 结果编译不过：共享 `TaskList` 要的是完整 `Task`，窄类型**不可赋值**给它。
 * 这不是类型系统在找麻烦 —— 窄化等于在这里断言"其余字段不存在"，
 * 而共享组件随时可能开始读 `dueDate`/`priority`（徽章就是这么加的）。
 */
type DesktopTask = Task;

const L = {
  heading: 'heyta',
  subheading: '桌面端 · 共享 UI 垂直切片',
  add: '添加一条示例任务',
  loading: '正在读取本地库…',
  empty: '还没有任务。',
  toggleOn: (title: string): string => `完成：${title}`,
  toggleOff: (title: string): string => `取消完成：${title}`,
} as const;

function App(): React.JSX.Element {
  const [tasks, setTasks] = useState<readonly DesktopTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  /**
   * 读一次库。
   *
   * ⚠️ 每次写操作后**重新读**而不是本地改数组：库才是权威。
   * 本地改的话，一旦主进程侧因为某种原因没有真的写进去，
   * 界面照样显示"成功" —— 那是本仓库反复踩过的"看着对了"。
   */
  const reload = useCallback(async (): Promise<void> => {
    try {
      const rows = (await window.heytaDesktop.request({ method: 'listTasks' })) as DesktopTask[];
      setTasks(rows);
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onToggleTask = useCallback(
    (id: string): void => {
      const current = tasks?.find((task) => task.id === id);
      if (current === undefined) return;
      setBusyTaskId(id);
      window.heytaDesktop
        .request({
          method: 'setCompleted',
          entityId: id,
          completed: current.completedAt == null,
        })
        .then(reload)
        .catch((cause: unknown) => {
          setError(String(cause));
        })
        .finally(() => {
          setBusyTaskId(null);
        });
    },
    [reload, tasks],
  );

  const onAdd = useCallback((): void => {
    // 标题带时间戳：连点几次不会合并成同一条，冒烟里也看得出"真的写进去了"。
    const title = `示例任务 ${new Date().toISOString().slice(11, 19)}`;
    window.heytaDesktop
      .request({ method: 'addTask', title })
      .then(reload)
      .catch((cause: unknown) => {
        setError(String(cause));
      });
  }, [reload]);

  return (
    /**
     * 🔴 这里所有尺寸/颜色都走 **token**（`var(--ht-*)`），不写裸值。
     *
     * 这不是洁癖：`check:design` 的 `SCAN_ROOTS` 现在**包含**
     * `apps/desktop/renderer`（本轮补上，之前漏了 —— 见 `check-hardcoded.mjs` 的注释），
     * 而补上的第一件事就是在这段代码里抓出 6 处裸值。
     * 裸值在这里的代价是"改一次主题要满地找"，而 token 是唯一能让
     * 桌面端跟着 `tokens.css` 一起变的方式。
     */
    <main
      data-testid="desktop-root"
      style={{
        fontFamily: 'system-ui, sans-serif',
        fontSize: 'var(--ht-font-size-sm)',
        lineHeight: 1.6,
        padding: 'var(--ht-space-6)',
      }}
    >
      <header style={{ marginBottom: 'var(--ht-space-4)' }}>
        <h1 style={{ fontSize: 'var(--ht-font-size-lg)', margin: 0 }}>{L.heading}</h1>
        <p style={{ margin: 'var(--ht-space-1) 0 0', color: 'var(--ht-color-foreground-muted)' }}>
          {L.subheading}
        </p>
      </header>

      <button type="button" data-testid="desktop-add" onClick={onAdd}>
        {L.add}
      </button>

      {error !== null ? (
        <p data-testid="desktop-error" style={{ color: 'var(--ht-color-danger-strong)' }}>
          🔴 宿主不可用：{error}
        </p>
      ) : null}

      {tasks === null ? (
        <p data-testid="desktop-loading">{L.loading}</p>
      ) : (
        <TaskList
          testID="desktop-task-list"
          tasks={tasks}
          onToggleTask={onToggleTask}
          busyTaskId={busyTaskId}
          emptyMessage={L.empty}
          labels={{
            toggleOn: (row) => L.toggleOn(row.title),
            toggleOff: (row) => L.toggleOff(row.title),
            open: (row) => row.title,
          }}
        />
      )}
    </main>
  );
}

const container = document.getElementById('root');
if (container === null) {
  // `renderer/index.html` 里写死了这个 id；缺了就是那份文件被改坏了。
  throw new Error('renderer/index.html 缺少 #root');
}

createRoot(container).render(
  <React.StrictMode>
    {/*
      🔴 `HeytaUiProvider` 必须包在最外层。
      共享组件靠它拿主题 token，缺了会**直接抛错**：
          useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用。
      这是仓库刻意的设计 —— 静默降级成默认主题的话，"忘了包 Provider"
      会表现成"暗色系统下渲染成亮色"，是个不崩、只悄悄错的 bug。

      ⚠️ 不传 `value`：让 Provider 自己按系统配色解析。
      桌面端暂时不需要宿主自己覆盖主题。
    */}
    <HeytaUiProvider>
      <App />
    </HeytaUiProvider>
  </React.StrictMode>,
);
