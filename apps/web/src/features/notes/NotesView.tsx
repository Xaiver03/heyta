/**
 * 便签视图（Web 壳）
 * ====================
 *
 * 🔴 M3 第十刀之后，这个文件**只剩接线**：便签板（输入行、摘要、钉选徽标、
 * 删除按钮、空态）全部由 `@heyta/ui` 的 `NotesBoard` 渲染 ——
 * 与 mobile 是**同一份实现**。
 *
 * 这里只回答 web 自己的两个问题：
 *   1. 便签从哪来 → `useNoteStore`（`listNotes()` 已经是未删除 + 规范顺序）；
 *   2. 文案键怎么填 → `notesBoardLabels(t)`（共享层不 import i18n）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 `HeytaUiProvider` 必须包在**这一处**
 *
 * `App.tsx` 里 `tasks` 那棵树的 Provider **不会覆盖到这里** ——
 * `{view === 'notes' && <NotesView />}` 是它的兄弟节点。
 * `NotesBoard` 会 `useHeytaUiTheme()`，落在 Provider 外会在运行时抛
 * 「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」，而类型与单测都不会红
 * （M3 第二刀 focus 就是这样崩的；`check:ui-provider` 现在能拦这个）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 空态**不在这里写**
 *
 * 「还没有便签」由共享 `NotesBoard` 用 `labels.empty` 渲染。
 * 在这里再写一句"还没有便签"会让同一个空态长出第二份实现
 * （`check:empty-state` 的断言抓的就是视图里手写的空态标记）。
 *
 * ⚠️ **刻意不传 `onEdit`**：web 目前没有便签编辑入口（那需要另一个界面）。
 * 不传的语义是"不渲染编辑入口"，而不是"渲染一个按下去没反应的按钮"。
 */

import { useMemo } from 'react';
import { useI18n, type I18nValue } from '@heyta/i18n';
import { HeytaUiProvider, NotesBoard, type NotesBoardLabels } from '@heyta/ui';

import { useNoteStore } from './store.js';

/** 构造共享 `NotesBoard` 的全部文案。字段名与 `NotesBoardLabels` 逐项对应，漏了编译不过。 */
export function notesBoardLabels(t: I18nValue['t']): NotesBoardLabels {
  return {
    empty: t('notes.empty'),
    emptyHint: t('notes.empty.hint'),
    composerPlaceholder: t('notes.composer.placeholder'),
    add: t('notes.add'),
    pin: t('notes.pin'),
    unpin: t('notes.unpin'),
    remove: t('notes.remove'),
    badgeToday: t('notes.badge.today'),
    // 无障碍名依赖**那一条便签的摘要**，所以是函数而不是句子。
    a11yEdit: (excerpt) => t('notes.a11y.edit', { excerpt }),
    a11yRemove: (excerpt) => t('notes.a11y.remove', { excerpt }),
    a11yPin: (excerpt) => t('notes.a11y.pin', { excerpt }),
    a11yUnpin: (excerpt) => t('notes.a11y.unpin', { excerpt }),
  };
}

export function NotesView(): React.JSX.Element {
  const { t } = useI18n();
  const notes = useNoteStore((s) => s.notes);
  const addNote = useNoteStore((s) => s.addNote);
  const removeNote = useNoteStore((s) => s.removeNote);
  const togglePinned = useNoteStore((s) => s.togglePinned);

  const labels = useMemo(() => notesBoardLabels(t), [t]);

  return (
    <HeytaUiProvider>
      <NotesBoard
        notes={notes}
        onAdd={(content) => {
          void addNote(content);
        }}
        onRemove={(entityId) => {
          void removeNote(entityId);
        }}
        onTogglePinned={(entityId, pinned) => {
          void togglePinned(entityId, pinned);
        }}
        labels={labels}
        testID="notes-board"
      />
    </HeytaUiProvider>
  );
}
