/**
 * 标签管理（「我的」页里的一段）
 * ==============================
 *
 * 补的是清单之后剩下的那块归类缺口：**同一个任务要跨清单出现在多个视角里**。
 * 清单是"一件任务属于哪个容器"（一个任务只能在一个清单），
 * 标签是"这件任务还跟什么有关"（一个任务可以有多个）—— 两者不是替代关系。
 *
 * 在此之前：`EntityBase` 上有 `tagIds`、`ProjectActions` 有 `createTag` / `listTags`、
 * 线协议里 `TAG` 也是合法的 `entityType`，**但全仓库没有任何一处读写过
 * `tagIds`**（`apps/web` 的 projects store 只列了标签，也没法把它打到任务上）。
 * 也就是说：标签在数据模型里存在了好几个月，在产品上**完全不存在**。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 两个刻意的决定
 *
 * 1. **删除标签不删任务，只把它从任务身上摘掉。**
 *    与清单同一条原则（`project-actions.ts` 文件头第 2 条）：删一个分组不该
 *    毁掉里面的东西。但标签这里更微妙 —— 用户看到"标签在 N 个任务上用着"时
 *    会以为删标签=动那些任务，所以要**在界面上说清楚**（`mobile.tags.removeHint`）。
 *
 * 2. **不改名。** 与清单一致：改名要一个内联编辑态，会把这一段的交互重量翻倍。
 *    先用起来，没做的不假装做了。
 *
 * ⚠️ 界面结构与 `ListsSection` **完全同一个形状**，所以共用 `OrganizerSection`。
 * 本文件只提供"标签"的语义：读哪些数据、调哪个动作、说什么话。
 *
 * 🔴 本文件里**没有一行业务逻辑**：空名字由 `createTag` 抛错、删除写什么 op、
 * 标签 id 怎么生成，全部由 `@heyta/app-host` 决定。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { Tag } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { createProjectActions, type AppHost, type ProjectActions } from '@heyta/app-host';

import { openTaskHost } from '../db/open-host';
import { useMobileSync } from '../sync/store';
import { OrganizerSection, type OrganizerItem } from './OrganizerSection';

export function TagsSection(): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 🔴 与 `ListsSection` 同一条理由：`listTags()` 读的是**已物化的内存状态**，
   * 同步在后台改了状态**不会**触发 React 重渲染。不订阅 `dataRevision` 的话，
   * 在另一台设备上建的标签，这台设备**同步完了也看不见**，而且没有任何报错。
   * （`scripts/check-materialized-reads.mjs` 也会拦。）
   */
  const { dataRevision } = useMobileSync();

  const [host, setHost] = useState<AppHost | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void openTaskHost().then((opened) => {
      if (alive) setHost(opened);
    });
    return () => {
      alive = false;
    };
  }, []);

  const actions = useMemo<ProjectActions | null>(
    () => (host ? createProjectActions(host) : null),
    [host],
  );

  const read = useCallback((): void => {
    if (actions === null) return;
    // ⚠️ 同步调用，不是 Promise。
    setTags(actions.listTags());
  }, [actions]);

  useEffect(read, [read, dataRevision]);

  const run = useCallback(
    (p: Promise<unknown>) => {
      setBusy(true);
      void p
        .then(read)
        .finally(() => {
          setBusy(false);
        });
    },
    [read],
  );

  const add = useCallback(
    (name: string): void => {
      if (actions === null) return;
      run(actions.createTag(name));
    },
    [actions, run],
  );

  const remove = useCallback(
    (item: OrganizerItem): void => {
      if (actions === null) return;
      run(actions.removeTag(item.id));
    },
    [actions, run],
  );

  return (
    <OrganizerSection
      icon="task.tag"
      title={t('mobile.profile.section.tags')}
      items={tags}
      emptyText={t('mobile.tags.empty')}
      emptyHint={t('mobile.tags.empty.hint')}
      removeLabel={(name) => t('mobile.tags.remove', { name })}
      removeHint={t('mobile.tags.removeHint')}
      nameLabel={t('mobile.tags.nameLabel')}
      placeholder={t('mobile.tags.newPlaceholder')}
      addLabel={t('mobile.tags.add')}
      busy={busy}
      onAdd={add}
      onRemove={remove}
    />
  );
}