/**
 * TipTap 富文本备注编辑器（C1 ② web 编辑侧）
 *
 * 替换 NoteEditor.tsx 里的 textarea，保持同一条写入语义：
 * - 失焦才提交（一个用户意图 = 一条 op）
 * - 空串写 undefined
 * - 没变不发 op
 * - 外部改动（同步/AI）通过 key 刷进来
 */

import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { markdownToHtml, htmlToMarkdown } from './markdown-bridge.js';

interface RichNoteFieldProps {
  note: string | undefined;
  onSetNote: (note: string | undefined) => void;
  placeholder?: string;
  ariaLabel?: string;
}

export function RichNoteField({
  note,
  onSetNote,
  placeholder = '',
  ariaLabel,
}: RichNoteFieldProps): React.JSX.Element {
  const noteRef = useRef(note);
  noteRef.current = note;

  const editor = useEditor({
    extensions: [StarterKit],
    content: note ? markdownToHtml(note) : '',
    editorProps: {
      attributes: {
        class: 'ht-note-editor',
        'data-testid': 'task-note-input',
        'aria-label': ariaLabel ?? '',
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    parseOptions: {
      preserveWhitespace: false,
    },
  });

  useEffect(() => {
    if (!editor) return;
    const externalHtml = note ? markdownToHtml(note) : '';
    const currentHtml = editor.getHTML();
    if (externalHtml !== currentHtml && !editor.isFocused) {
      editor.commands.setContent(externalHtml, { emitUpdate: false });
    }
  }, [note, editor]);

  const handleBlur = () => {
    if (!editor) return;
    const html = editor.getHTML();
    const markdown = htmlToMarkdown(html);
    const trimmed = markdown.trim() === '' ? undefined : markdown;
    const current = noteRef.current === undefined || noteRef.current === '' ? undefined : noteRef.current;
    if (trimmed === current) return;
    onSetNote(trimmed);
  };

  if (!editor) return <div className="ht-note-editor ht-note-editor--loading" />;

  return (
    <div onBlur={handleBlur}>
      <EditorContent editor={editor} />
    </div>
  );
}
