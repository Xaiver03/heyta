/**
 * 便签编辑卡 —— **同一个编辑器，两个落点**。
 *
 * 落点由宿主决定（工单 C1 拍板 #1："选中某条 = 同一格换成该实体面单，不另开第三处"）：
 *   · 详情列放得下且没被收起 ⇒ 渲染在 `.ht-app__detail` 里（`App.tsx` 那一支）；
 *   · 否则 ⇒ 渲染在便签板**上方**（`NotesView` 那一支，也就是本文件落地前的唯一形状）。
 * 两支永不同时存在（`NotesView` 拿的是同一个布尔的反向），所以 DOM 里始终只有一枚编辑器 ——
 * 这条是 `apps/web/tests/note-editor-placement.spec.tsx` 的承重判据之一。
 *
 * 🔴 为什么单独一个文件而不是在 `NotesView` 里渲染两遍：编辑器的接线
 * （保存只在真落成时才收面板、取消、`editError`、`key={id}` 防过期快照）抄两遍
 * 迟早会漂 —— AGENTS §3.5 那两条"抽出实现却没删旧的"事故就是这个形状。
 *
 * ⚠️ 自带一层 `HeytaUiProvider`：共享 `NoteEditor` 会 `useHeytaUiTheme()`，
 * 落在 Provider 外会在运行时抛（`check:ui-provider` 拦的就是这个）。
 * `App.tsx` 里那层 Provider 覆盖不到详情列，所以这一层不能省。
 */
import { useMemo } from 'react';
import { useI18n, type I18nValue } from '@heyta/i18n';
import { HeytaUiProvider, NoteEditor, type NoteEditorLabels } from '@heyta/ui';

import { selection, useSelected } from '../../lib/selection.js';
import { useNoteStore } from './store.js';

/** 构造共享 `NoteEditor` 的全部文案。字段名与 `NoteEditorLabels` 逐项对应，漏了编译不过。 */
export function noteEditorLabels(t: I18nValue['t']): NoteEditorLabels {
  return {
    // 占位符**复用 composer 那一句**：两处问的是同一件事（"写点什么"），
    // 各起一条词条迟早会漂成两种说法。
    placeholder: t('notes.composer.placeholder'),
    save: t('notes.save'),
    cancel: t('notes.cancel'),
  };
}

/**
 * @param inset 是否带**详情列那一栏的内边距**。
 * 🔴 必填，且刻意不是"默认值等于原行为"：`check:detail-pane-slot` 那条门禁不许装配处
 * 手写 DOM 标记（`<div className=…>` 写在 `App.tsx` 的槽里就是它抓的形状），
 * 所以这一层壳只能住在**生产者**里 —— 而住进来之后，"哪一支带 inset"必须显式说清，
 * 不能让便签板那一支悄悄继承一个默认值。
 */
export function NoteEditorCard({ inset }: { inset: boolean }): React.JSX.Element | null {
  const { t } = useI18n();
  const notes = useNoteStore((s) => s.notes);
  const updateNote = useNoteStore((s) => s.updateNote);
  const editError = useNoteStore((s) => s.editError);
  const editorLabels = useMemo(() => noteEditorLabels(t), [t]);

  /**
   * 正在编辑的那条 = **选中的那一条**（`null` = 没开）。读共享选中态而不是本地 state，
   * ↑↓ 换选中时这一格才会跟着换（工单 W1b 的第 2 条腿）。
   */
  const editingId = useSelected('note');
  const editing = editingId === null ? undefined : notes.find((note) => note.id === editingId);
  // 便签在别处被删掉（另一台设备的墓碑）→ 面板自然消失，而不是留一个指向不存在 id 的输入框。
  if (editing === undefined) return null;

  const face = (
    <HeytaUiProvider>
      <NoteEditor
        key={editing.id}
        initialContent={editing.content}
        labels={editorLabels}
        error={editError ?? null}
        onSave={(content) => {
          // 只有真落成了才收面板：失败时错误要留在屏幕上，
          // 否则用户看到的是"点了保存，面板自己关了，什么也没改"。
          void updateNote(editing.id, content).then((ok) => {
            if (ok) selection.select('note', null);
          });
        }}
        onCancel={() => {
          selection.select('note', null);
        }}
        testID="notes-editor"
      />
    </HeytaUiProvider>
  );
  // 回落那一支**不包壳**：DOM 与这一单之前逐字节相同（少一个 div 就少一处样式意外）。
  return inset ? <div className="ht-app__detail-note">{face}</div> : face;
}
