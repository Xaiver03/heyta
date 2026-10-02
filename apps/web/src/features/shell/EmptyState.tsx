/**
 * 任务列表的空状态 + "当前筛选"判定（Web 端）。从 `App.tsx` 抽出，逻辑逐字未动。
 *
 * 规则：**任何列表都必须有空状态**，且要给出下一步动作。留白屏会让用户以为应用坏了。
 */

import React from 'react';
import { Inbox } from 'lucide-react';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';
import type { TaskFilter } from '../tasks/store.js';

/**
 * 空状态。
 *
 * 规则：**任何列表都必须有空状态**，且要给出下一步动作。
 * 留白屏会让用户以为应用坏了。
 */
export function EmptyState({ filter }: { filter: TaskFilter }): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 空态文案。
   *
   * ⚠️ 存的是**键对**（标题 + 下一步动作），不是句子 —— 句子在词条表里，
   * 渲染时才 `t(...)`。`all` 同时是兜底：出现新的 `filter.kind` 时
   * 不能留一片空白（"任何列表都必须有空状态"，见文件尾注释）。
   */
  const messages: Record<string, { titleKey: MessageKey; hintKey: MessageKey }> = {
    all: {
      titleKey: 'web.shell.empty.all.title',
      hintKey: 'web.shell.empty.all.hint',
    },
    today: {
      titleKey: 'web.shell.empty.today.title',
      hintKey: 'web.shell.empty.today.hint',
    },
    // 不写"今天没有到期"也不写"收集箱是空的"：这一列空下来的意思是
    // **未来 7 天没有安排**，而那个"下一步"是把截止时间放进这几天里。
    next7Days: {
      titleKey: 'web.shell.empty.next7Days.title',
      hintKey: 'web.shell.empty.next7Days.hint',
    },
    completed: {
      titleKey: 'web.shell.empty.completed.title',
      hintKey: 'web.shell.empty.completed.hint',
    },
    quadrant: {
      titleKey: 'web.shell.empty.quadrant.title',
      hintKey: 'web.shell.empty.quadrant.hint',
    },
  };
  const msg = messages[filter.kind] ?? messages['all']!;

  return (
    <div className="ht-empty" data-testid="empty-state">
      <Inbox className="ht-empty__icon" size={ICON_SIZE.xl} aria-hidden="true" />
      <p className="ht-empty__title">{t(msg.titleKey)}</p>
      <p className="ht-empty__hint">{t(msg.hintKey)}</p>
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
   *
   * 写成 `switch` 而不是一串 `if`：加分支时 `never` 兜底会在**编译期**
   * 提醒这里还没处理 —— 这正是判别联合相对宽形状的价值。
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
    case 'next7Days':
    case 'completed':
      return true;
  }
}
