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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { Task } from '@heyta/domain';
import { filterTasks, indexTags, type Tag, type TaskFilter } from '@heyta/domain';
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

/**
 * `window.heytaDesktop` 的形状在 `bridge.ts` 里声明（两个渲染页共用一份，
 * 抄两遍的话改一边不会报错 —— 而 `declare global` 是**全局增强**，
 * 只要那个文件在编译单元里就生效，所以这里不需要 import 它）。
 */

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
  emptyToday: '今天没有到期的任务。',
  viewAll: '全部',
  viewToday: '今天',
  viewCurrent: '当前视图：',
  toggleOn: (title: string): string => `完成：${title}`,
  toggleOff: (title: string): string => `取消完成：${title}`,
} as const;

function App(): React.JSX.Element {
  const [tasks, setTasks] = useState<readonly DesktopTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  /**
   * 当前视图那一档。默认「全部」= 本切片一直以来的行为。
   *
   * 🔴 这一档**不是这里定义的**：`TaskFilter` 与"什么算今天"全在
   * `packages/domain/src/task-filter.ts`，这一页只调 `filterTasks`。
   * 托盘里那条「今天」推来的是一条**意图**（`{kind:'showToday'}`），
   * 不是筛选条件，所以壳里一行判断都没长出来（AGENTS.md §3.5）。
   */
  const [filter, setFilter] = useState<TaskFilter>({ kind: 'all' });
  /**
   * 标签解析表：`id → Tag` 的**全量**表（含被合并掉的墓碑行）。
   *
   * 🔴 它不是"可选标签列表"（桌面端没有选择器），而是 `filterTasks` 的
   * `context.tags`：合并只写标签那一行，`task.tagIds` 里仍留着旧 id，
   * 所以"这条任务有哪些标签"只有 `@heyta/domain` 的 `resolveTagIds` 能回答。
   * 取数走 `listTagAliasTable`（不是 `listTags`），理由在 `reload` 里。
   */
  const [tagTable, setTagTable] = useState<Record<string, Tag>>({});

  /**
   * 读一次库。
   *
   * ⚠️ 每次写操作后**重新读**而不是本地改数组：库才是权威。
   * 本地改的话，一旦主进程侧因为某种原因没有真的写进去，
   * 界面照样显示"成功" —— 那是本仓库反复踩过的"看着对了"。
   */
  const reload = useCallback(async (): Promise<void> => {
    try {
      /*
        🔴 两条读一起取：任务 + **全量标签表**。
        标签表不是给"选择器"用的（桌面端目前没有标签选择器），它是
        `filterTasks` 的 `context.tags`：合并只写标签那一行，不重写任务的
        `tagIds`，所以"可见标签"必须由 `@heyta/domain` 的 `resolveTagIds` 算。

        ⚠️ 读的是 `listTagAliasTable`（**含墓碑/别名**），**不是** `listTags`
        （只回存活）。后者里没有别名那一行，拿它当解析表会让只挂着被合并 id 的
        任务的**有效标签变成空数组** —— 按目标标签筛时它们整体消失，且不报错。
        两条通道的名字刻意不同，别互换。判据见
        `apps/desktop/tests/tag-alias-filter.spec.ts`。
      */
      const [rows, tagRows] = await Promise.all([
        window.heytaDesktop.request({ method: 'listTasks' }),
        window.heytaDesktop.request({ method: 'listTagAliasTable' }),
      ]);
      setTasks(rows as DesktopTask[]);
      setTagTable(indexTags(tagRows as Tag[]));
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * 订阅主进程推来的命令（托盘「今天」、快速添加落库后的"重新读一次"）。
   *
   * ⚠️ 命令**不带数据**，所以这里收到之后仍然要自己去读库 ——
   * 见上面那条"库才是权威"的纪律。
   */
  useEffect(() => {
    window.heytaDesktop.onCommand((command) => {
      if (command.kind === 'showToday') setFilter({ kind: 'today' });
      else if (command.kind === 'reloadTasks') void reload();
    });
  }, [reload]);

  /**
   * 筛选后的行。`now` 显式传给共享筛选（那个文件头的纪律：判断层不自己读时钟）。
   *
   * 🔴 **`tags` 必须传**（标签合并的读侧别名）：合并只写标签那一行
   * （`Tag.mergedInto`），**不重写任务的 `tagIds`**，所以不传时那一支退回
   * "按 id 精确匹配" —— 只挂着被合并掉的 A 的任务在按 B 筛时**一条都筛不到**
   * （症状："合并之后我的任务不见了"，不报错）。
   */
  const rows = useMemo(
    () =>
      tasks === null
        ? null
        : filterTasks(tasks, filter, { now: Date.now(), tags: tagTable }),
    [tasks, filter, tagTable],
  );

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

      {/*
        视图那一档。存在的理由是托盘那条「今天」需要一个**看得见的落点**：
        只有命令没有界面标记的话，用户按完不知道自己在哪一档，也就回不去。
        🔴 两档都调同一个 `filterTasks`，所以"今天"这一档的判据与 web/手机端同源。
      */}
      <div
        data-testid="desktop-view-row"
        style={{ marginTop: 'var(--ht-space-4)', display: 'flex', gap: 'var(--ht-space-2)' }}
      >
        <button
          type="button"
          data-testid="desktop-view-all"
          aria-pressed={filter.kind === 'all'}
          onClick={() => setFilter({ kind: 'all' })}
        >
          {L.viewAll}
        </button>
        <button
          type="button"
          data-testid="desktop-view-today"
          aria-pressed={filter.kind === 'today'}
          onClick={() => setFilter({ kind: 'today' })}
        >
          {L.viewToday}
        </button>
      </div>

      {/*
        🔴 这一行是**必需的**，不是装饰：这一页的按钮是浏览器默认样式，
        `aria-pressed` 在这里**画不出任何可见差别**，用户按了「今天」之后
        看不出自己在哪一档、也就不知道按哪颗回去。界面要如实说话。
        （共享组件里有专门的选中态，那是设计系统那一档的事，不在这条分包里造第二套。）
      */}
      <p
        data-testid="desktop-view-label"
        style={{ margin: 'var(--ht-space-2) 0 0', color: 'var(--ht-color-foreground-muted)' }}
      >
        {L.viewCurrent}
        {filter.kind === 'today' ? L.viewToday : L.viewAll}
      </p>

      {tasks === null ? (
        <p data-testid="desktop-loading">{L.loading}</p>
      ) : (
        <TaskList
          testID="desktop-task-list"
          tasks={rows ?? []}
          onToggleTask={onToggleTask}
          busyTaskId={busyTaskId}
          emptyMessage={filter.kind === 'today' ? L.emptyToday : L.empty}
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
