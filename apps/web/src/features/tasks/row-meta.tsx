/**
 * 任务行的行内元信息（Web 端）—— **渲染只有一份**
 * =================================================
 *
 * 🔴 这一刀收的是类 F（"抽出了共享实现，但没把旧那份删掉"）。
 * 改之前 web 的 `App.tsx` 里 `renderTaskMeta` 是手写的
 * `<span data-testid="task-meta">` + `<DueBadge/>` + `P{数字}`，
 * 而移动端早就在用共享 `TaskBadges` —— 于是"同一件事"有两种字形、两种颜色规则、
 * 两种语言行为（`P3` 中英都是数字）。移动端的行还显示重复，web 不显示。
 * 现在两端都只经过 `TaskBadges`。
 *
 * ## 为什么是一个**组件**而不是 `App.tsx` 里的箭头函数
 *
 * `renderMeta` 是**在 `TaskList` 的渲染过程中被调用**的，那里不是组件边界 ——
 * 在里面调 `useI18n()` / `useHeytaTokens()` 违反 hooks 规则
 * （`apps/web/src/dev/universal-slice.tsx` 的 `SliceBadges` 是同一个先例，
 * 它的注释就是把这件事写下来的地方）。抽成组件后它自己的 context 是通的，
 * 这顺带也验证了"共享 Provider 的 token 能一路流到插槽组件里"。
 *
 * ## 分工照旧：共享层管字形与顺序，宿主管文案与颜色取值
 *
 * 截止文案仍由 `lib/due-display.ts` 算（那份"说法"是刻意各端各写的，
 * 理由写在它的文件头），这里只把 `{text, overdue}` 交给共享层；
 * 逾期变红、字形换成警告三角**不在这里做**（`TaskBadges` 负责）。
 */

import React from 'react';
import { computeCountdown, Priority } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { TaskBadges, listNameFor, useHeytaTokens, type TaskRow as SharedTaskRow } from '@heyta/ui';

import { dueText, type DueDisplayMode } from '../../lib/due-display.js';
import { useProjectStore } from '../projects/store.js';
import { priorityBadgeText, priorityColorToken } from './priority-display.js';

export function TaskRowMeta({
  row,
  mode,
  now,
}: {
  row: SharedTaskRow;
  mode: DueDisplayMode;
  now: number;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const tokens = useHeytaTokens();
  // 🔴 归属的判断在共享层（`listNameFor`），这里只交"清单表 + 收集箱这个词"。
  // 原先 web 是在行尾的整理 chip 里自己 `projects.find(...)` 查一次名字 ——
  // 那是第二份"什么算有归属"（缺口登记在计划文档 §6.6）。
  const projects = useProjectStore((s) => s.projects);
  const task = row.source;

  const due = dueText(task, mode, now, t);
  const priority = priorityBadgeText(task.priority, t);

  return (
    <TaskBadges
      testID="task-meta"
      list={listNameFor(projects, task.projectId, t('web.organize.inbox'))}
      due={
        due === null ? null : { text: due, overdue: computeCountdown(task, { now }).overdue }
      }
      priority={
        priority === null
          ? null
          : {
              text: priority,
              color: tokens[priorityColorToken(task.priority ?? Priority.None)],
            }
      }
    />
  );
}
