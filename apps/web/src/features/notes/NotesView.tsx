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
 * ⚠️ ~~**刻意不传 `onEdit`**~~ **（2026-10-03 多端第二批已补上，留原文是为了让
 * 后来者认出这个形状）**：共享编辑器 {@link NoteEditor} 已经在
 * `@heyta/ui`（与移动端**同一份实现**），本视图现在传 `onEdit`，
 * 摘要那段因此变成可点的入口，点它在列表上方展开编辑面板。
 * 当年那句"不传的语义是不渲染编辑入口，而不是渲染一个按下去没反应的按钮"
 * 仍然是这里的判据 —— 面板与入口要么一起有，要么一个都不留。
 */

import { useMemo } from 'react';
import { useI18n, type I18nValue } from '@heyta/i18n';
import {
  HeytaUiProvider,
  NoteEditor,
  NotesBoard,
  type NoteEditorLabels,
  type NotesBoardLabels,
} from '@heyta/ui';

import { selection, useSelected } from '../../lib/selection.js';
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

/** 构造共享 `NoteEditor` 的全部文案。与上面同一纪律：字段对不上编译不过。 */
export function noteEditorLabels(t: I18nValue['t']): NoteEditorLabels {
  return {
    // 占位符**复用 composer 那一句**：两处问的是同一件事（"写点什么"），
    // 各起一条词条迟早会漂成两种说法。
    placeholder: t('notes.composer.placeholder'),
    save: t('notes.save'),
    cancel: t('notes.cancel'),
  };
}

export function NotesView(): React.JSX.Element {
  const { t } = useI18n();
  const notes = useNoteStore((s) => s.notes);
  const addNote = useNoteStore((s) => s.addNote);
  const updateNote = useNoteStore((s) => s.updateNote);
  const removeNote = useNoteStore((s) => s.removeNote);
  const togglePinned = useNoteStore((s) => s.togglePinned);
  const editError = useNoteStore((s) => s.editError);

  /**
   * 正在编辑的那条便签 = **选中的那一条**（`null` = 面板没开）。
   *
   * 🔴 用 **id** 而不是 `Note` 对象：`refresh()` 之后对象会换新引用，
   * 存对象会让面板在每次同步后拿到一份过期快照（与移动端同一个取舍）。
   * 而它读的是共享选中态、不是本地 `useState`：搜索那条入口只能把 id 交进选中态，
   * 面板才会在切到便签视图时显示**被点的那一条**（此前 `openNoteFromSearch` 把 id 丢了，
   * 用户看到的只是"视图换了，什么都没打开"）。
   */
  const editingId = useSelected('note');

  const labels = useMemo(() => notesBoardLabels(t), [t]);
  const editorLabels = useMemo(() => noteEditorLabels(t), [t]);
  const editing = editingId === null ? undefined : notes.find((note) => note.id === editingId);
  // 便签在别处被删掉了（另一台设备同步过来的墓碑）→ 面板自然消失，
  // 而不是留着一个指向不存在的 id 的输入框。
  const activeEditing = editing !== undefined ? editing : null;

  return (
    <HeytaUiProvider>
      {activeEditing === null ? null : (
        <NoteEditor
          key={activeEditing.id}
          initialContent={activeEditing.content}
          labels={editorLabels}
          error={editError ?? null}
          onSave={(content) => {
            void updateNote(activeEditing.id, content).then((ok) => {
              // 只有真落成了才收面板：失败时错误要留在屏幕上，
              // 否则用户看到的是"点了保存，面板自己关了，什么也没改"。
              if (ok) selection.select('note', null);
            });
          }}
          onCancel={() => {
            selection.select('note', null);
          }}
          testID="notes-editor"
        />
      )}
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
        onEdit={(entityId) => {
          selection.select('note', entityId);
        }}
        labels={labels}
        testID="notes-board"
      />
    </HeytaUiProvider>
  );
}
