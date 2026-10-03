/**
 * 标签管理（「我的」页里的一段）—— **只剩接线**
 * =================================================
 *
 * M3 第九刀（projects）：与清单**同一个 `OrganizerList`**（`kind="tag"`）。
 * 本文件只提供"标签"的语义：读哪些数据、调哪个动作、说什么话。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 标签与清单**不是替代关系**
 *
 * 清单是"一件任务属于哪个容器"（一个任务只能在一个清单），
 * 标签是"这件任务还跟什么有关"（一个任务可以有多个）。
 *
 * 在此之前：`EntityBase` 上有 `tagIds`、`ProjectActions` 有 `createTag` / `listTags`、
 * 线协议里 `TAG` 也是合法的 `entityType`，**但全仓库没有任何一处读写过 `tagIds`**。
 * 也就是说：标签在数据模型里存在了好几个月，在产品上**完全不存在**。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 两个刻意的决定
 *
 * 1. **删除标签不删任务，只把它从任务身上摘掉。**
 *    与清单同一条原则（`project-actions.ts` 文件头第 2 条）：删一个分组不该
 *    毁掉里面的东西。但标签这里更微妙 —— 用户看到"标签在 N 个任务上用着"时
 *    会以为删标签=动那些任务，所以要**在界面上说清楚**（`mobile.tags.removeHint`）。
 * 2. **不改名。** 与清单一致：改名要一个内联编辑态，会把这一段的交互重量翻倍。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 与 `ListsSection` 同一条形状，但**不再各写一份 JSX**
 *
 * 迁移前两段共用的是"移动端本地"的 `OrganizerSection`，而 web 那边**根本不是
 * 这个组件** —— 所以"清单/标签行长什么样"仍然是两份实现。现在两段与 web
 * 走同一个共享 `OrganizerList`（行骨架只有一份），层级/计数口径在共享模型里。
 *
 * 🔴 本文件里**没有一行业务逻辑**：空名字由 `createTag` 抛错、删除写什么 op、
 * 标签 id 怎么生成，全部由 `@heyta/app-host` 决定。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { Tag } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { createProjectActions, type AppHost, type ProjectActions } from '@heyta/app-host';
import { OrganizerList, toOrganizerNodes, toTagItems } from '@heyta/ui';

import { openTaskHost } from '../db/open-host';
import { useMobileSync } from '../sync/store';
import { Button, Card, SectionHeader, Text, TextField } from '../ui/kit';

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
  const [name, setName] = useState('');
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

  /** 标签是平表（没有父子关系），共享层把它包成"没有子级的树"。 */
  const nodes = useMemo(() => toOrganizerNodes(toTagItems(tags)), [tags]);

  const add = useCallback((): void => {
    const trimmed = name.trim();
    if (trimmed === '' || actions === null) return;
    setName('');
    run(actions.createTag(trimmed));
  }, [actions, name, run]);

  return (
    <>
      <SectionHeader icon="task.tag" title={t('mobile.profile.section.tags')} />
      <Card>
        {/*
          🔴 与清单**同一个组件**（`kind` 只影响 React key 前缀与测试 id）。
          本条**不传 `counts`**。⚠️ 理由不是"标签没有未完成任务数这个概念" ——
          那个概念成立（2026-10-01 已在共享层算出来：`openTagCounts`，
          web 侧栏标签行现在每行有数字）。这里不传是**版面**决定：
          这两段住在「我的」页，是一张**管理清单**（建名 / 删除），
          不是滴答参照图里那列带数字的**导航栏**。
        */}
        <OrganizerList
          kind="tag"
          items={nodes}
          labels={{
            removeLabel: (label) => t('mobile.tags.remove', { name: label }),
            // 只接改名、不接归档：`Tag` 领域实体里**没有** `archived` 字段
            // （`Project` 有），所以这里没有"归档标签"这个意图可表达。
            // 共享层的规矩是"文案与回调成对"—— `labels.archive` 省略即不画那个按钮，
            // 于是缺的不是接线，而是领域里还没有的那个概念。
            rename: {
              button: (label) => t('common.organizer.rename.button', { name: label }),
              save: t('common.organizer.rename.save'),
              cancel: t('common.organizer.rename.cancel'),
            },
            empty: t('common.organizer.tags.empty'),
            emptyHint: t('common.organizer.tags.empty.hint'),
          }}
          onRename={(item, next) => {
            if (actions === null) return;
            run(actions.renameTag(item.id, next));
          }}
          onRemove={(item) => {
            if (actions === null) return;
            run(actions.removeTag(item.id));
          }}
          busy={busy}
          testID="mobile-tags-list"
        />
      </Card>
      <Text variant="caption" tone="subtle">
        {t('mobile.tags.removeHint')}
      </Text>

      <TextField
        label={t('mobile.tags.nameLabel')}
        value={name}
        onChangeText={setName}
        placeholder={t('mobile.tags.newPlaceholder')}
        autoCapitalize="sentences"
      />
      <Button
        label={t('mobile.tags.add')}
        tone="secondary"
        icon="task.add"
        loading={busy}
        disabled={name.trim() === ''}
        onPress={add}
      />
    </>
  );
}
