/**
 * 便签管理（「我的」页里的一段）—— **只剩接线**
 * =================================================
 *
 * 形状与 `ListsSection` / `TagsSection` 逐字对应：读共享模型的输出 →
 * 渲染共享组件 → 动作完成后重读。行的骨架、排序、摘要截断、「今天」高亮判定
 * 全在 `@heyta/ui` 的 `NotesBoard` + `notes/model.ts`（与 web 同一份源码），
 * 本文件只回答移动端自己的三件事：读哪些数据、调哪个动作、说什么话。
 *
 * 🔴 **本文件里没有一行业务逻辑。**
 * 空内容由 `createNoteActions` 抛错、便签 id 怎么生成、删除是软删还是硬删、
 * 钉选写哪个字段 —— 全部由 `@heyta/app-host` 决定。
 * `apps/*` 里出现 `entityType: 'NOTE'` 字面量会被 `check:layering` 判红；
 * 这里的调用点让 `check:reachability` 的断言 C 对 NOTE 变绿。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 入口走「我的」页里的一段，**不加 tab**（P10）
 *
 * ADR-0015 §4 的判决是"四象限是同一份任务的另一种投影，不新增 tab"，
 * 而 P10 已把移动端第 6 个 tab 判为要撤销。便签与清单/标签一样，读的是
 * **另一批实体**（NOTE）—— 但"不重排标签栏"这条同样适用：底部标签
 * **保持 5 个**（任务 / 日历 / 专注 / 分类 / 我的），便签是本页内的第三段。
 * ⚠️ 代价是发现性：用户要「我的 → 便签」两步才到；脚本按坐标寻址标签栏
 * （108/324/540/756/972），加第 6 个 tab 会同时打爆它们。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三个刻意的决定
 *
 * 1. **不传 `onEdit`。** 移动端**没有便签编辑屏** —— 共享组件据此不渲染
 *    摘要上的编辑入口（`a11yEdit` 因此不会出现）。传一个"打开一个还不存在的屏"
 *    的回调，比没有这个入口更坏。
 * 2. **不传 `excerptLength`。** 走共享默认（`NOTE_EXCERPT_LENGTH = 60`），
 *    与 web 同一行宽；移动端窄屏真放不下时再调，而不是现在先猜一个数字。
 * 3. **错误显示原始文本、不翻译。** 便签超长时 `createNote` 会抛错
 *    （共享组件的 composer 只挡"空白"这一种）。原始信息是**数据**不是文案，
 *    要能拿去搜索/对照日志 —— 与 `HabitsScreen` / `ProfileScreen` 同一条分工。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { Note } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { createNoteActions, type AppHost, type NoteActions } from '@heyta/app-host';
import { NotesBoard } from '@heyta/ui';

import { openTaskHost } from '../db/open-host';
import { notesBoardLabels } from '../lib/notes-display';
import { useMobileSync } from '../sync/store';
import { Card, SectionHeader, Text } from '../ui/kit';

export function NotesSection(): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 🔴 **必须订阅 `dataRevision`**，理由与 `ListsSection` 逐字相同：
   * `listNotes()` 读的是**已物化的内存状态**，同步在后台改了状态**不会**
   * 触发 React 重渲染。不订阅的话，在另一台设备上建的便签，这台设备
   * **同步完了也看不见**，而且没有任何报错 —— 界面只是"看起来没有"。
   */
  const { dataRevision } = useMobileSync();

  const [host, setHost] = useState<AppHost | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  /** 见文件头决定 3：失败原因原样显示，不静默吞。 */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void openTaskHost()
      .then((opened) => {
        // 卸载后 `setState` 是无声的脏写入（切标签很快时必然发生）。
        if (alive) setHost(opened);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  // 与 TasksScreen 同一条规则：动作集从宿主派生，不在界面里新造。
  const actions = useMemo<NoteActions | null>(() => (host ? createNoteActions(host) : null), [host]);

  const read = useCallback((): void => {
    if (actions === null) return;
    // ⚠️ `listNotes()` 是**同步**的（读已物化状态），不是 Promise。
    // 顺序（钉选 → 更新时间 → id）由共享 model 决定，本文件不排。
    setNotes(actions.listNotes());
  }, [actions]);

  useEffect(read, [read, dataRevision]);

  const run = useCallback(
    (pending: Promise<unknown>): void => {
      setError(null);
      void pending
        .then(read)
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
        });
    },
    [read],
  );

  const labels = useMemo(() => notesBoardLabels(t), [t]);

  return (
    <>
      <SectionHeader icon="note.sticky" title={t('notes.title')} />
      <Card>
        {/*
          🔴 内容校验的权威是 `createNoteActions`（空内容抛错、超长拒绝）。
          共享组件的 composer 只在 `trim()` 为空时**不提交** —— 那是交互挡板，
          不是内容规则（见 `NotesBoard` 文件头）。这里不重复判断一遍。
        */}
        <NotesBoard
          notes={notes}
          labels={labels}
          onAdd={(content) => {
            if (actions === null) return;
            run(actions.createNote(content));
          }}
          onRemove={(entityId) => {
            if (actions === null) return;
            run(actions.removeNote(entityId));
          }}
          onTogglePinned={(entityId, pinned) => {
            if (actions === null) return;
            // `pinned` 是**目标值**（不是"切换一下"）—— 共享组件按 `!row.isPinned`
            // 算好传进来，本文件不再取反（取反两次就永远不会变）。
            run(actions.setNotePinnedToToday(entityId, pinned));
          }}
          testID="mobile-notes-board"
        />
      </Card>
      {error !== null ? (
        <Text variant="caption" tone="danger" selectable>
          {error}
        </Text>
      ) : null}
    </>
  );
}
