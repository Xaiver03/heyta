/**
 * 任务详情里的结构化子项（checklist）编辑面板
 * ==========================================
 *
 * 逐条勾选 + n/m 进度 + 增加 / 删除。读写都走 `Task.checklist`（方案 A）；
 * 老数据只有备注里的 `- [ ]` 时，给一个"转为可勾选子项"的按钮把它**一次性物化**
 * （懒升级，不迁移）——之后才是可勾选的。
 *
 * 样式纪律（AGENTS §5 / `check-l4`）：全部用**模块级 style 常量** + 语义 token
 * （`text()` / `cssVar()`），不在 JSX 里写内联 style 对象字面量、不新开 `.ht-*` 族、
 * 控件复用既有 `.ht-input` / `.ht-chip--action` 类。
 */
import { useState, type CSSProperties } from 'react';
import { cssVar } from '@heyta/design-system';
import { readChecklist, type Task, type TaskChecklistItem } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';

import { text } from '../../lib/text.js';

export interface ChecklistEditorProps {
  task: Task;
  onSetChecklist: (items: { id?: string; text: string; done?: boolean }[]) => void;
  onToggle: (itemId: string, done: boolean) => void;
  onAdd: (text: string) => void;
  onRemove: (itemId: string) => void;
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: cssVar('space.1'),
  marginTop: cssVar('space.3'),
};
const headerStyle: CSSProperties = {
  ...text('group-label'),
  color: cssVar('color.foreground-muted'),
  marginTop: cssVar('space.3'),
  marginBottom: cssVar('space.1'),
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
};
const progressStyle: CSSProperties = {
  ...text('row-meta'),
  color: cssVar('color.foreground-muted'),
};
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: cssVar('space.2'),
  paddingTop: cssVar('space.1'),
  paddingBottom: cssVar('space.1'),
};
const itemTextStyle: CSSProperties = {
  ...text('body-sm'),
  color: cssVar('color.foreground'),
  flex: 1,
};
const doneTextStyle: CSSProperties = {
  ...text('body-sm'),
  color: cssVar('color.foreground-muted'),
  textDecoration: 'line-through',
  flex: 1,
};
const addRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: cssVar('space.2'),
  marginTop: cssVar('space.1'),
};
const legacyRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: cssVar('space.2'),
  marginTop: cssVar('space.1'),
};

function ChecklistRow(props: {
  item: TaskChecklistItem;
  onToggle: (id: string, done: boolean) => void;
  onRemove: (id: string) => void;
  removeAria: string;
}): React.JSX.Element {
  const { item, onToggle, onRemove, removeAria } = props;
  return (
    <div style={rowStyle} data-testid="task-checklist-row">
      <input
        type="checkbox"
        checked={item.done}
        onChange={(e) => onToggle(item.id, e.target.checked)}
        aria-label={item.text}
        data-testid="task-checklist-checkbox"
      />
      <span style={item.done ? doneTextStyle : itemTextStyle}>{item.text}</span>
      <button
        type="button"
        className="ht-chip ht-chip--action"
        aria-label={removeAria}
        data-testid="task-checklist-remove"
        onClick={() => onRemove(item.id)}
      >
        ×
      </button>
    </div>
  );
}

export function ChecklistEditor(props: ChecklistEditorProps): React.JSX.Element | null {
  const { task, onSetChecklist, onToggle, onAdd, onRemove } = props;
  const { t } = useI18n();
  const [draft, setDraft] = useState('');

  // 老数据：只有备注里的 `- [ ]`，没有结构化字段 → 只读展示 + 一个物化按钮。
  if (task.checklist === undefined) {
    const legacy = readChecklist(task);
    if (legacy.length === 0) return null;
    return (
      <section style={wrapStyle} data-testid="task-checklist-legacy">
        <div style={headerStyle}>
          <span>{t('web.tasks.checklist.title')}</span>
          <span style={progressStyle}>
            {t('web.tasks.checklist.progressLabel', {
              done: String(legacy.filter((x) => x.done).length),
              total: String(legacy.length),
            })}
          </span>
        </div>
        {legacy.map((it, i) => (
          <div style={rowStyle} key={`legacy-${String(i)}`}>
            <input type="checkbox" checked={it.done} disabled aria-label={it.text} />
            <span style={it.done ? doneTextStyle : itemTextStyle}>{it.text}</span>
          </div>
        ))}
        <div style={legacyRowStyle}>
          <button
            type="button"
            className="ht-chip ht-chip--action"
            data-testid="task-checklist-convert"
            onClick={() => onSetChecklist(legacy.map((x) => ({ text: x.text, done: x.done })))}
          >
            {t('web.tasks.checklist.convertLegacy')}
          </button>
        </div>
      </section>
    );
  }

  const items = task.checklist;
  const doneCount = items.filter((x) => x.done).length;
  const submit = (): void => {
    const text = draft.trim();
    if (text === '') return;
    onAdd(text);
    setDraft('');
  };

  return (
    <section style={wrapStyle} data-testid="task-checklist">
      <div style={headerStyle}>
        <span>{t('web.tasks.checklist.title')}</span>
        {items.length > 0 ? (
          <span style={progressStyle}>
            {t('web.tasks.checklist.progressLabel', {
              done: String(doneCount),
              total: String(items.length),
            })}
          </span>
        ) : null}
      </div>
      {items.map((it) => (
        <ChecklistRow
          key={it.id}
          item={it}
          onToggle={onToggle}
          onRemove={onRemove}
          removeAria={t('web.tasks.checklist.removeAria', { text: it.text })}
        />
      ))}
      <div style={addRowStyle}>
        <input
          className="ht-input"
          value={draft}
          placeholder={t('web.tasks.checklist.addPlaceholder')}
          aria-label={t('web.tasks.checklist.addPlaceholder')}
          data-testid="task-checklist-add-input"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
    </section>
  );
}
