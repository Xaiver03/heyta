/**
 * Markdown 清单的结构文字（词条表 → `TasksMarkdownCopy`）
 * =========================================================
 *
 * 🔴 分工：**格式（有哪些列、怎么排版）在 `@heyta/app-host`，
 * 措辞（表头/页脚怎么写）在这里。** 这样 app-host 不需要依赖词条表，
 * 而界面也不需要自己判断"导出的清单里该有哪些字段"（那是产品语义）。
 *
 * 与 AI 失败态的做法完全一致：packages 返回结构化 `reason`，壳取词条渲染。
 */

import type { TasksMarkdownCopy } from '@heyta/app-host';
import { Priority } from '@heyta/domain';
import type { I18nValue } from '@heyta/i18n';

/** 从词条表取 Markdown 清单的全部措辞。优先级沿用捕获输入框那组词条（同一件事）。 */
export function tasksMarkdownCopy(t: I18nValue['t']): TasksMarkdownCopy {
  const priorityLabel = (priority: Priority): string => {
    switch (priority) {
      case Priority.High:
        return t('web.capture.priority.high');
      case Priority.Medium:
        return t('web.capture.priority.medium');
      case Priority.Low:
        return t('web.capture.priority.low');
      case Priority.None:
        return t('web.capture.priority.none');
      default:
        return t('web.export.markdown.none');
    }
  };

  return {
    heading: t('web.export.markdown.heading'),
    generatedAt: t('web.export.markdown.generatedAt'),
    empty: t('web.export.markdown.empty'),
    open: t('web.export.markdown.open'),
    done: t('web.export.markdown.done'),
    none: t('web.export.markdown.none'),
    footer: t('web.export.markdown.footer'),
    columns: {
      title: t('web.export.markdown.colTitle'),
      status: t('web.export.markdown.colStatus'),
      due: t('web.export.markdown.colDue'),
      priority: t('web.export.markdown.colPriority'),
      project: t('web.export.markdown.colProject'),
      tags: t('web.export.markdown.colTags'),
    },
    priorityLabel,
  };
}
