/**
 * 任务列表的空状态 + "当前筛选"判定（Web 端）。从 `App.tsx` 抽出。
 *
 * 🔴 2026-11-25（产品负责人，AGENTS §0.2）：空态**只写事实，不写解释/引导**。
 * 原先这里挂着一整套首启引导（「把脑子里的事先倒出来 / 写一句就行 / 三条示例 /
 * 先自己写」）与每个筛选的「下一步动作」提示句 —— 全部删掉。
 * 空态只留一句事实（「收集箱是空的」这类），怎么做由上面的输入框与交互本身表达。
 */

import React from 'react';
import { HeytaUiProvider, StateIllustration, toEmptyStateViewModel } from '@heyta/ui';
import { useI18n, type MessageKey } from '@heyta/i18n';
import type { TaskFilter } from '../tasks/store.js';

/**
 * 空状态。
 *
 * 只给一句**事实**标题；不给 hint、不给引导、不给示例。
 * 留白由排版承担，不靠文字教用户怎么用。
 */
export function EmptyState({ filter }: { filter: TaskFilter }): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 空态事实标题。`all` 同时是兜底：出现新的 `filter.kind` 时不能留一片空白。
   */
  const titles: Record<string, MessageKey> = {
    all: 'web.shell.empty.all.title',
    today: 'web.shell.empty.today.title',
    next7Days: 'web.shell.empty.next7Days.title',
    completed: 'web.shell.empty.completed.title',
    quadrant: 'web.shell.empty.quadrant.title',
    compound: 'web.shell.empty.compound.title',
  };
  const titleKey = titles[filter.kind] ?? titles['all']!;

  /**
   * 🔴 **判断走共享模型，markup 归本端**（R11 的 (B) 方案）。见 `r11-states-audit-2026-11.md` §7.1。
   * `hint` 传空串：模型把它归一成 `undefined`，那一行就不画（只写事实）。
   */
  const view = toEmptyStateViewModel({
    title: t(titleKey),
    hint: '',
    illustration: 'tasks',
    size: 'page',
  });

  return (
    <div className="ht-empty" data-testid="empty-state">
      {view.illustration === undefined ? null : (
        <HeytaUiProvider>
          <StateIllustration variant={view.illustration} />
        </HeytaUiProvider>
      )}
      <p className="ht-empty__title ht-type-row-title">{view.title}</p>
    </div>
  );
}

export function isActive(current: TaskFilter, target: TaskFilter): boolean {
  if (current.kind !== target.kind) return false;
  /**
   * 🔴 **判别联合的每个带载荷分支都要比载荷，不能只比 `kind`。**
   *
   * 原先只特判了 `quadrant`，其余一律返回 `true` —— 于是**两个不同的清单
   * 会同时显示为当前项**（`kind` 都是 `'project'`），而标签分支加进来之后
   * 同一个问题会扩大到标签。症状是侧栏同时高亮两行，用户以为选中了错的那个。
   */
  switch (current.kind) {
    case 'quadrant':
      return target.kind === 'quadrant' && current.quadrant === target.quadrant;
    case 'project':
      return target.kind === 'project' && current.projectId === target.projectId;
    case 'tag':
      return target.kind === 'tag' && current.tagId === target.tagId;
    case 'all':
    case 'today':
    case 'tomorrow':
    case 'next7Days':
    case 'completed':
      return true;
    case 'compound':
      return (
        target.kind === 'compound' &&
        current.op === target.op &&
        JSON.stringify(current.conditions) === JSON.stringify(target.conditions)
      );
  }
}
