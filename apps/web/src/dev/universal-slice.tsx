/**
 * M1 垂直切片验证入口 —— **这不是产品界面**
 * ==========================================
 *
 * 访问 `?slice=1` 挂载它，其余情况走正常的 `<App />`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么单独开一个入口，而不是把它插进任务页
 *
 * M1 要回答的问题是「**同一份** RN 组件源码，能不能在 Web 上渲染出来」。
 * 回答它只需要一个能确定性挂载组件的场地，**不需要**碰真实的任务页 ——
 * 而把实验组件插进产品界面有两个具体代价：
 *
 * 1. 任务页会**同时出现两份任务列表**（共享组件一份、原 `TaskOrganizer` 一份）。
 *    这不是重构的中间态，是两个真相并存的错误状态。
 * 2. e2e 里有一批按行数/文本计数的断言，重复渲染会以一种
 *    "看起来是测试坏了"的方式失败 —— 而真正坏的是我动了产品界面。
 *
 * 所以这里用**固定的种子数据**，与 op-log、store、同步全部无关：
 * 切片要验的是渲染，混进数据层只会让失败原因变模糊。
 * 真实接线在 M1-4（mobile 的 `TasksScreen`）。
 */

import { useCallback, useState } from 'react';
import { HeytaUiProvider, TaskBadges, TaskList, useHeytaTokens } from '@heyta/ui';
import type { TaskRow } from '@heyta/ui';
import type { Task } from '@heyta/domain';

/**
 * 种子数据**刻意覆盖每种渲染分支**，而不是随便塞几条：
 * 未完成 / 已完成 / 重要 / 有截止 / 无截止 / 空标题。
 * 只测"有标题的未完成任务"的话，删除线、空标题兜底、
 * 排序这几条都不会被真正渲染到。
 *
 * ⚠️ 截止时间**必须一条过去、一条未来**：
 * 第一版两条都用了过去的时间戳，于是"未逾期"那个分支**从来没被渲染过** ——
 * 日历字形与弱色没被验证，而断言"逾期色 ≠ 未逾期色"直接失败，
 * 看起来像配色接错了，实际是数据没覆盖到。分支没被渲染到，
 * 等于那个分支不存在。
 */
const SEED: readonly Task[] = [
  { id: 's1', title: '写 M1 切片验证', createdAt: 0, updatedAt: 0, important: true, dueDate: 1_700_000_000_000 },
  { id: 's2', title: '核对鸿蒙 op-sqlite 版本差', createdAt: 0, updatedAt: 0, dueDate: 4_100_000_000_000 },
  { id: 's3', title: '', createdAt: 0, updatedAt: 0 },
  { id: 's4', title: '已完成的示例', createdAt: 0, updatedAt: 0, completedAt: 1 },
];

export function UniversalSlice(): React.JSX.Element {
  const [tasks, setTasks] = useState<readonly Task[]>(SEED);

  /**
   * 本地的勾选状态：只为证明 `Pressable` 在 Web 上真的可点。
   *
   * ⚠️ 这里**不是**业务逻辑的归属地 —— 真实实现必须走 op-log
   * （`features/tasks/store.ts` 的 `toggleComplete`），否则跨设备不同步。
   * 切片里用本地 state 是因为它要刻意与数据层解耦。
   */
  const onToggleTask = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, completedAt: task.completedAt === undefined ? 1 : undefined }
          : task,
      ),
    );
  }, []);

  return (
    <div style={{ padding: 'var(--ht-space-8)' }}>
      <HeytaUiProvider>
        <TaskList
          tasks={tasks}
          onToggleTask={onToggleTask}
          fallbackTitle="（无标题）"
          emptyMessage="暂无任务"
          testID="universal-slice"
          renderMeta={(row) => <SliceBadges row={row} />}
        />
      </HeytaUiProvider>
    </div>
  );
}

/**
 * 徽章这一段是**刻意接上来**的（M1 徽章）。
 *
 * 图标走的是 `lucide`（纯数据）+ `react-native-svg`（渲染），而
 * `react-native-svg` 在 web 上必须显式指向它的 web 实现 —— 这是整条链路上
 * 最容易断、且断了以后**报错指不到根因**的一环。所以切片必须真的把三种
 * 徽章都画出来，而不是"构建过了就算"。
 *
 * ⚠️ 单独抽成一个组件而不是内联箭头函数，是因为这里要用 `useHeytaTokens()` ——
 * `renderMeta` 是**在 `TaskList` 的渲染过程中被调用**的，那里不是组件边界，
 * 调 hook 会违反 hooks 规则。抽成组件后它自己的 Provider 上下文是通的，
 * 这顺带也验证了"共享 Provider 的 token 能一路流到插槽组件里"。
 */
function SliceBadges({ row }: { row: TaskRow }): React.JSX.Element {
  const tokens = useHeytaTokens();
  // 种子里的时间戳远早于"现在"，所以有截止的两条都按逾期渲染 ——
  // 一条数据同时证明了"逾期变红"与"字形换成警告三角"两个分支。
  const overdue = row.dueAt !== null && row.dueAt < Date.now();
  return (
    <TaskBadges
      due={row.dueAt === null ? null : { text: overdue ? '已逾期' : '还剩 3 天', overdue }}
      priority={row.important ? { text: '高', color: tokens['color.danger'] } : null}
      repeat={row.id === 's2' ? '每周一' : null}
    />
  );
}
