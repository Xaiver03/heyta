/**
 * Markdown 清单的结构文字（词条表 → `TasksMarkdownCopy`）
 * =========================================================
 *
 * 🔴 分工与 Web 端**逐字一致**（`apps/web/src/features/settings/export-copy.ts`）：
 * **格式（有哪些列、怎么排版）在 `@heyta/app-host`，措辞在词条表。**
 * 这样 app-host 不需要依赖词条表，而界面也不需要自己判断"导出的清单里该有哪些字段"。
 *
 * ⚠️ 为什么这里复用 `web.export.markdown.*` 与 `web.capture.priority.*`
 * 而不是新开一套 `mobile.export.markdown.*`：
 * 那份措辞描述的是**导出文档本身**，不是 Web 壳 —— 两台设备导出的文件必须
 * 说同样的话，尤其是页脚那句「这是导出文件，还不能导回来」。
 * 两个前缀各一套 key，漂移就只是时间问题，而且**没有任何一处会报错**。
 * 所以宁可让 key 前缀看起来有点历史包袱，也不制造第二个事实源。
 *
 * ⚠️ 本文件**不 import `react-native`**：`lib/` 会被 node 里的单测直接加载。
 */

import type { TasksMarkdownCopy } from '@heyta/app-host';
import { Priority } from '@heyta/domain';

import type { Translate } from '../i18n/translate';

/** 从词条表取 Markdown 清单的全部措辞。优先级沿用捕获输入框那组词条（同一件事）。 */
export function tasksMarkdownCopy(t: Translate): TasksMarkdownCopy {
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
