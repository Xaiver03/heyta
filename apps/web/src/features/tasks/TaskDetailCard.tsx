/**
 * 任务详情面单 —— 三段式紧凑卡片（对标滴答清单 + 本仓 UX 原则）
 * ============================================================
 *
 * 信息架构：
 *   1. 顶部紧凑属性条（`.ht-detail-header`）：日期/时刻、提醒、重复三枚按需触发器 + 右端优先级选择；
 *   2. 中部纯净内容区（`.ht-detail-body`）：完成状态提示、父任务面包屑（仅非顶级时显示）、
 *      可点改标题、正文备注、检查项、已挂标签胶囊（仅非空时显示）、已上传附件列表（仅非空时显示）、
 *      共享清单评论（仅共享清单且会话就绪时显示）；
 *   3. 底部常驻工具栏（`.ht-detail-toolbar`）：左端所属清单直接切换 + 右端检查项/标签/父任务/附件/更多操作。
 *
 * 核心约束：
 *   · 每个单值字段在 Web 端仅有本文件一处编辑器落点（`check:field-single-source`）；
 *   · 未设置的属性在内容区零占位、零说明废话（`AGENTS.md §0.2` / `ux-principles.md §4, §11`）；
 *   · 次级编辑器通过面单内联浮层（`.ht-detail-popover`）按需展开，互斥单开，支持 Esc 与点外部收起。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { cssVar, ICON_SIZE } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';
import {
  Priority,
  aliveAttachmentsForTask,
  indexTags,
  localTimeOf,
  requiresModalCommitment,
  resolveDangerTier,
  resolveTags,
  toLocalDate,
  type Task,
} from '@heyta/domain';
import { createAttachmentActions, createAttachmentBlobPort, type ActionContext } from '@heyta/app-host';
import { MAX_ATTACHMENT_BYTES } from '@heyta/shared-schema';
import {
  AttachmentList,
  attachmentFailureReasonOf,
  type AttachmentFailureReason,
  type AttachmentListLabels,
} from '@heyta/ui';
import {
  Bell,
  Calendar,
  ChevronDown,
  CornerDownRight,
  Flag,
  FolderOpen,
  ListTodo,
  MoreHorizontal,
  Paperclip,
  Repeat,
  Tag,
} from 'lucide-react';

import { selection, useSelected } from '../../lib/selection.js';
import { currentState, dispatchChecked, dispatchIntent } from '../../lib/oplog.js';
import { DangerConfirmDialog } from '../../lib/dialog/DangerConfirmDialog.js';
import { useProjectStore } from '../projects/store.js';
import { useReminderStore } from '../reminders/store.js';
import { useSyncStore } from '../sync/store.js';
import { ShareCommentsSection } from '../share/ShareCommentsSection.js';
import { text } from '../../lib/text.js';
import { NoteField } from './NoteEditor.js';
import { ChecklistEditor } from './ChecklistEditor.js';
import { renderNoteMarkdown } from './markdown-render.js';
import { RepeatField } from './TaskRepeat.js';
import { SubtaskField } from './SubtaskPicker.js';
import { DueField } from './DueEditor.js';
import { TagChips, TagPickerField, useProjectMoveModel } from './TaskOrganizer.js';
import { ReminderField } from '../reminders/ReminderPanel.js';
import { useTaskStore } from './store.js';

type DetailPopoverKind = 'due' | 'reminder' | 'repeat' | 'tags' | 'subtask';

/** 待机态（`<h2>`）：光标呈文本状，表达点击即可改名。 */
const titleIdleStyle: CSSProperties = {
  cursor: 'text',
};

/** 编辑态输入框：沿用标题层级外观，保留全局 `:focus-visible` 焦点环。 */
const titleInputStyle: CSSProperties = {
  borderWidth: cssVar('border-width.thin'),
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: cssVar('radius.md'),
  background: 'transparent',
  paddingInline: cssVar('space.2'),
  paddingBlock: cssVar('space.1'),
  margin: 0,
  width: '100%',
};

/** 完成态只读提示：走 `caption` 辅助档，与 `h2` 标题明显拉开层级。 */
const statusLineStyle: CSSProperties = {
  ...text('caption'),
  color: cssVar('color.foreground-muted'),
  marginBottom: cssVar('space.1'),
};

const attachmentErrorStyle: CSSProperties = {
  ...text('caption'),
  color: cssVar('color.danger'),
  marginTop: cssVar('space.1'),
};

function TitleField({ task, onRename }: { task: Task; onRename: (title: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const settled = useRef(false);

  if (editingFor !== null && editingFor !== task.id) {
    setEditingFor(null);
  }
  const editing = editingFor === task.id;

  const begin = (): void => {
    settled.current = false;
    setEditingFor(task.id);
  };

  const end = (): void => {
    settled.current = true;
    setEditingFor(null);
  };

  const commit = (value: string): void => {
    if (settled.current) return;
    end();
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === task.title) return;
    onRename(trimmed);
  };

  if (!editing) {
    return (
      <h2
        className="ht-app__detail-heading"
        data-testid="task-detail-title"
        style={titleIdleStyle}
        tabIndex={0}
        onClick={begin}
        onKeyDown={(event) => {
          if (event.key === 'Enter') begin();
        }}
      >
        {task.title}
      </h2>
    );
  }

  return (
    <input
      data-testid="task-detail-title-input"
      className="ht-app__detail-heading"
      style={titleInputStyle}
      aria-label={t('web.ai.capture.field.titleAria')}
      autoFocus
      defaultValue={task.title}
      onBlur={(event) => {
        commit(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit(event.currentTarget.value);
        } else if (event.key === 'Escape') {
          end();
        }
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 附件：仅在已有附件时展示列表；上传触发器常驻底栏工具条
 * ═══════════════════════════════════════════════════════════════════════ */

const attachmentContext: ActionContext = {
  dispatch: (intent) => dispatchIntent(intent),
  dispatchChecked: (build) => dispatchChecked(build),
  getState: currentState,
};

const attachmentActions = createAttachmentActions(attachmentContext, {
  blobs: createAttachmentBlobPort(
    {
      get baseUrl(): string {
        return useSyncStore.getState().baseUrl;
      },
    },
    () => useSyncStore.getState().token,
  ),
});

const MAX_ATTACHMENT_MB = String(Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024)));

const ATTACHMENT_ERROR_KEYS: Record<AttachmentFailureReason, MessageKey> = {
  'too-large': 'mobile.detail.attachments.error.too-large',
  'quota-exceeded': 'mobile.detail.attachments.error.quota-exceeded',
  network: 'mobile.detail.attachments.error.network',
  'no-channel': 'mobile.detail.attachments.error.no-channel',
  'read-failed': 'mobile.detail.attachments.error.read-failed',
  rejected: 'mobile.detail.attachments.error.rejected',
};
const ATTACHMENT_FALLBACK_KEY: MessageKey = ATTACHMENT_ERROR_KEYS.rejected;

function attachmentFailureKey(cause: unknown): MessageKey {
  const reason = attachmentFailureReasonOf(cause);
  return reason === undefined ? ATTACHMENT_FALLBACK_KEY : ATTACHMENT_ERROR_KEYS[reason];
}

type FileReadResult = { readonly ok: true; readonly dataBase64: string } | { readonly ok: false };

function readFileBase64(file: File): Promise<FileReadResult> {
  return new Promise<FileReadResult>((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => {
      resolve({ ok: false });
    };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        resolve({ ok: false });
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma < 0 ? { ok: false } : { ok: true, dataBase64: result.slice(comma + 1) });
    };
    reader.readAsDataURL(file);
  });
}

const REMOVE_ATTACHMENT_TIER = resolveDangerTier({
  affectedCount: 1,
  undoAvailable: false,
  destroysIrrecoverableResource: true,
});

function AttachmentField({
  task,
  fileInputRef,
  onBusyChange,
}: {
  task: Task;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onBusyChange: (busy: boolean) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const attachmentsTable = useTaskStore((state) => state.entities.attachments);
  const rows = useMemo(
    () => aliveAttachmentsForTask(Object.values(attachmentsTable), task.id),
    [attachmentsTable, task.id],
  );

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MessageKey | undefined>(undefined);
  const [pendingRemove, setPendingRemove] = useState<{ readonly id: string; readonly fileName: string } | undefined>(
    undefined,
  );

  const updateBusy = (next: boolean): void => {
    setBusy(next);
    onBusyChange(next);
  };

  const remove = (id: string): void => {
    setFailure(undefined);
    updateBusy(true);
    void attachmentActions
      .removeAttachment(id)
      .catch((cause: unknown) => {
        setFailure(attachmentFailureKey(cause));
      })
      .finally(() => {
        updateBusy(false);
      });
  };

  const submitPicked = (input: HTMLInputElement): void => {
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined || busy) return;
    const targetId = task.id;
    setFailure(undefined);
    updateBusy(true);
    const run = async (): Promise<void> => {
      try {
        const read = await readFileBase64(file);
        if (!read.ok) {
          setFailure('mobile.detail.attachments.error.read-failed');
          return;
        }
        await attachmentActions.addAttachment(targetId, {
          fileName: file.name,
          ...(file.type === '' ? {} : { contentType: file.type }),
          dataBase64: read.dataBase64,
        });
      } catch (cause: unknown) {
        setFailure(attachmentFailureKey(cause));
      } finally {
        updateBusy(false);
      }
    };
    void run();
  };

  const labels: AttachmentListLabels = {
    empty: null,
    add: t('mobile.detail.attachments.add'),
    uploading: t('mobile.detail.attachments.uploading'),
    remove: t('mobile.detail.attachments.remove'),
    size: {
      bytes: (n) => t('mobile.detail.attachments.size.bytes', { n }),
      kb: (n) => t('mobile.detail.attachments.size.kb', { n }),
      mb: (n) => t('mobile.detail.attachments.size.mb', { n }),
    },
  };

  return (
    <>
      {rows.length > 0 ? (
        <>
          <h3 className="ht-type-caption ht-detail-section-title" data-testid="task-detail-attachments">
            {t('mobile.detail.attachments.title')}
          </h3>
          <AttachmentList
            items={rows}
            labels={labels}
            busy={busy}
            showAddButton={false}
            onAdd={() => {
              setFailure(undefined);
              fileInputRef.current?.click();
            }}
            onRemove={(id) => {
              const row = rows.find((item) => item.id === id);
              if (row === undefined) return;
              setPendingRemove({ id: row.id, fileName: row.fileName });
            }}
            testID="task-attachments"
          />
        </>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        hidden
        data-testid="task-attachment-file-input"
        onChange={(event) => {
          submitPicked(event.currentTarget);
        }}
      />

      {failure === undefined ? null : (
        <p role="alert" style={attachmentErrorStyle} data-testid="task-attachment-error">
          {t(failure, { max: MAX_ATTACHMENT_MB })}
        </p>
      )}

      {pendingRemove === undefined ? null : (
        <DangerConfirmDialog
          testId="task-attachment-remove-confirm"
          labelledBy="task-attachment-remove-confirm-title"
          modalCommitment={requiresModalCommitment(REMOVE_ATTACHMENT_TIER)}
          cancelLabel={t('web.rowMenu.cancel')}
          confirmLabel={t('mobile.detail.attachments.remove')}
          onCancel={() => {
            setPendingRemove(undefined);
          }}
          onConfirm={() => {
            const target = pendingRemove;
            setPendingRemove(undefined);
            remove(target.id);
          }}
        >
          <h2 id="task-attachment-remove-confirm-title">{t('mobile.detail.attachments.remove')}</h2>
          <p data-testid="task-attachment-remove-confirm-name">{pendingRemove.fileName}</p>
        </DangerConfirmDialog>
      )}
    </>
  );
}

export function TaskDetailCard({
  automationSlot,
  onShowActions,
}: {
  automationSlot?: React.ReactNode;
  onShowActions?: (taskId: string, anchor: { readonly x: number; readonly y: number }) => void;
} = {}): React.JSX.Element | null {
  const { t } = useI18n();
  const store = useTaskStore();
  const projects = useProjectStore((s) => s.projects);
  const tags = useProjectStore((s) => s.tags);

  const selectedId = useSelected('task');
  const picked = selectedId === null ? undefined : store.entities.tasks[selectedId];
  const task = picked !== undefined && picked.deletedAt === undefined ? picked : undefined;

  const [activePanel, setActivePanel] = useState<DetailPopoverKind | null>(null);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [panelTaskId, setPanelTaskId] = useState<string>(selectedId ?? '');

  const paneRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (task !== undefined && panelTaskId !== task.id) {
    setPanelTaskId(task.id);
    setActivePanel(null);
    setChecklistOpen(false);
    setAttachmentBusy(false);
  }

  useEffect(() => {
    if (activePanel === null) {
      if (task === undefined) return undefined;
      const onDismissTask = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;
        selection.select('task', null);
      };
      document.addEventListener('keydown', onDismissTask);
      return () => {
        document.removeEventListener('keydown', onDismissTask);
      };
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setActivePanel(null);
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (popoverRef.current?.contains(target) === true) return;
      if (target.closest('[data-detail-popover-trigger="true"]') !== null) return;
      setActivePanel(null);
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [activePanel, task]);

  if (task === undefined) return null;

  return <TaskDetailCardInner
    task={task}
    paneRef={paneRef}
    popoverRef={popoverRef}
    fileInputRef={fileInputRef}
    activePanel={activePanel}
    setActivePanel={setActivePanel}
    checklistOpen={checklistOpen}
    setChecklistOpen={setChecklistOpen}
    attachmentBusy={attachmentBusy}
    setAttachmentBusy={setAttachmentBusy}
    projects={projects}
    tags={tags}
    automationSlot={automationSlot}
    onShowActions={onShowActions}
  />;
}

function TaskDetailCardInner({
  task,
  paneRef,
  popoverRef,
  fileInputRef,
  activePanel,
  setActivePanel,
  checklistOpen,
  setChecklistOpen,
  attachmentBusy,
  setAttachmentBusy,
  projects,
  tags,
  automationSlot,
  onShowActions,
}: {
  task: Task;
  paneRef: RefObject<HTMLDivElement | null>;
  popoverRef: RefObject<HTMLDivElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  activePanel: DetailPopoverKind | null;
  setActivePanel: (next: DetailPopoverKind | null | ((prev: DetailPopoverKind | null) => DetailPopoverKind | null)) => void;
  checklistOpen: boolean;
  setChecklistOpen: (next: boolean) => void;
  attachmentBusy: boolean;
  setAttachmentBusy: (busy: boolean) => void;
  projects: ReturnType<typeof useProjectStore.getState>['projects'];
  tags: ReturnType<typeof useProjectStore.getState>['tags'];
  automationSlot?: React.ReactNode;
  onShowActions?: (taskId: string, anchor: { readonly x: number; readonly y: number }) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const store = useTaskStore();
  const reminderCount = useReminderStore((s) => s.byTask[task.id]?.length ?? 0);
  const { options: projectOptions, inboxBlocked, moveUnavailable } = useProjectMoveModel(task);

  const togglePanel = (kind: DetailPopoverKind): void => {
    setActivePanel((prev) => (prev === kind ? null : kind));
  };

  const focusInPane = (testId: string): void => {
    const target = paneRef.current?.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (target === null || target === undefined) return;
    target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
  };

  const dateVal =
    task.dueDateLocal ?? (task.dueDate === undefined ? undefined : toLocalDate(task.dueDate));
  const timeVal =
    task.dueDateLocal !== undefined
      ? undefined
      : task.dueDate === undefined
        ? undefined
        : localTimeOf(task.dueDate);
  const scheduleLabel =
    dateVal === undefined
      ? t('web.due.trigger')
      : `${t('web.due.dayLabel', {
          month: Number(dateVal.slice(5, 7)),
          day: Number(dateVal.slice(8, 10)),
        })}${timeVal === undefined ? '' : ` ${timeVal}`}`;
  const isPastToday =
    dateVal !== undefined && task.completedAt === undefined && dateVal < toLocalDate(store.now);

  const dueBtnClass = [
    'ht-btn',
    'ht-btn--ghost',
    'ht-detail-header__btn',
    isPastToday
      ? 'ht-detail-header__btn--late'
      : dateVal !== undefined
        ? 'ht-detail-header__btn--active'
        : '',
  ]
    .filter(Boolean)
    .join(' ');

  const reminderBtnClass = [
    'ht-btn',
    'ht-btn--ghost',
    'ht-detail-header__btn',
    reminderCount > 0 ? 'ht-detail-header__btn--active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const repeatBtnClass = [
    'ht-btn',
    'ht-btn--ghost',
    'ht-detail-header__btn',
    task.repeatRule !== undefined ? 'ht-detail-header__btn--active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const parentTask =
    task.parentId === undefined ? undefined : store.entities.tasks[task.parentId];
  const assignedTags = useMemo(
    () => resolveTags(task.tagIds, indexTags(tags)),
    [task.tagIds, tags],
  );
  const currentProject = useMemo(
    () => (task.projectId === undefined ? undefined : projects.find((p) => p.id === task.projectId)),
    [projects, task.projectId],
  );
  const isSharedTask = currentProject?.shareId !== undefined;
  const priorityValue = task.priority ?? Priority.None;
  const topPopoverShown =
    activePanel === 'due' || activePanel === 'reminder' || activePanel === 'repeat';
  const bottomPopoverShown = activePanel === 'tags' || activePanel === 'subtask';

  return (
    <div ref={paneRef} className="ht-app__detail-task" data-testid="task-pane">
      {/* ══ 一、顶部紧凑属性条 ═══════════════════════════════════════════ */}
      <div className="ht-detail-header" data-testid="task-detail-header">
        <button
          type="button"
          data-detail-popover-trigger="true"
          className={dueBtnClass}
          data-testid="task-detail-due-trigger"
          aria-label={t('web.due.summaryAria', { title: task.title })}
          aria-pressed={activePanel === 'due'}
          aria-expanded={activePanel === 'due'}
          onClick={() => togglePanel('due')}
        >
          <Calendar size={ICON_SIZE.sm} aria-hidden="true" />
          <span>{scheduleLabel}</span>
        </button>

        <button
          type="button"
          data-detail-popover-trigger="true"
          className={reminderBtnClass}
          data-testid="task-detail-reminder-trigger"
          aria-label={t('reminder.a11y.list', { title: task.title })}
          aria-pressed={activePanel === 'reminder'}
          aria-expanded={activePanel === 'reminder'}
          onClick={() => togglePanel('reminder')}
        >
          <Bell size={ICON_SIZE.sm} aria-hidden="true" />
          {reminderCount > 0 ? <span>{String(reminderCount)}</span> : null}
        </button>

        <button
          type="button"
          data-detail-popover-trigger="true"
          className={repeatBtnClass}
          data-testid="task-detail-repeat-trigger"
          aria-label={t('web.repeat.summary', { title: task.title })}
          aria-pressed={activePanel === 'repeat'}
          aria-expanded={activePanel === 'repeat'}
          onClick={() => togglePanel('repeat')}
        >
          <Repeat size={ICON_SIZE.sm} aria-hidden="true" />
        </button>

        <div className={`ht-detail-header__priority ht-detail-header__priority--${String(priorityValue)}`}>
          <Flag size={ICON_SIZE.sm} aria-hidden="true" />
          <select
            className="ht-detail-header__priority-select"
            data-testid="task-priority-select"
            aria-label={t('web.ai.capture.field.priority')}
            value={String(priorityValue)}
            onChange={(event) => {
              const next = Number(event.target.value) as Priority;
              if (next === priorityValue) return;
              void store.setPriority(task.id, next);
            }}
          >
            <option value={String(Priority.None)}>{t('web.ai.prioritize.priority.none')}</option>
            <option value={String(Priority.Low)}>{t('web.ai.prioritize.priority.low')}</option>
            <option value={String(Priority.Medium)}>{t('web.ai.prioritize.priority.medium')}</option>
            <option value={String(Priority.High)}>{t('web.ai.prioritize.priority.high')}</option>
          </select>
        </div>
      </div>

      {/* 顶部按需浮层槽（日期 / 提醒 / 重复） */}
      {topPopoverShown ? (
        <div ref={popoverRef} className="ht-detail-popover" data-testid="task-detail-popover">
          {activePanel === 'due' ? (
            <DueField
              key={`due-${task.id}`}
              task={task}
              now={store.now}
              onSetDueDate={(due, dueDateLocal) => {
                void store.setDueDate(task.id, due, dueDateLocal);
              }}
            />
          ) : null}
          {activePanel === 'reminder' ? <ReminderField task={task} /> : null}
          {activePanel === 'repeat' ? (
            <RepeatField
              key={`repeat-${task.id}`}
              task={task}
              now={store.now}
              onSetRepeat={(rule) => {
                void store.setRepeat(task.id, rule);
              }}
              onSetAfterCompletion={(on) => {
                void store.setRepeatAfterCompletion(task.id, on);
              }}
            />
          ) : null}
        </div>
      ) : null}

      {/* ══ 二、中部纯净内容区 ═══════════════════════════════════════════ */}
      <div className="ht-detail-body">
        {task.completedAt !== undefined ? (
          <p data-testid="task-pane-status" style={statusLineStyle}>
            {t('task.pane.completed')}
          </p>
        ) : null}

        {parentTask !== undefined && parentTask.deletedAt === undefined ? (
          <button
            type="button"
            data-detail-popover-trigger="true"
            className="ht-detail-parent-chip"
            data-testid="task-detail-parent-chip"
            onClick={() => togglePanel('subtask')}
          >
            <CornerDownRight size={ICON_SIZE.xs} aria-hidden="true" />
            <span>{t('web.subtask.under', { title: parentTask.title })}</span>
          </button>
        ) : null}

        <TitleField
          task={task}
          onRename={(title) => {
            void store.renameTask(task.id, title);
          }}
        />

        {task.note && /(?:^|\n)\s*(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s)|(\*\*|__|~~|`|\[.+?\]\(.+?\))/.test(task.note) ? (
          <div
            className="ht-note-preview"
            data-testid="task-note-rendered"
            onClick={() => {
              focusInPane('task-note-input');
            }}
            dangerouslySetInnerHTML={{ __html: renderNoteMarkdown(task.note) }}
          />
        ) : null}

        <NoteField
          key={task.id}
          task={task}
          onSetNote={(note) => {
            void store.setNote(task.id, note);
          }}
        />

        <ChecklistEditor
          key={`checklist-${task.id}`}
          forceOpen={checklistOpen}
          task={task}
          onSetChecklist={(items) => {
            void store.setChecklist(task.id, items);
          }}
          onToggle={(itemId, done) => {
            void store.toggleChecklistItem(task.id, itemId, done);
          }}
          onAdd={(itemText) => {
            void store.addChecklistItem(task.id, itemText);
          }}
          onRemove={(itemId) => {
            void store.removeChecklistItem(task.id, itemId);
          }}
        />

        {assignedTags.length > 0 ? (
          <button
            type="button"
            data-detail-popover-trigger="true"
            className="ht-detail-tags-strip"
            data-testid="task-detail-tags-strip"
            aria-label={t('web.organize.tagsLegend')}
            onClick={() => togglePanel('tags')}
          >
            <TagChips task={task} />
          </button>
        ) : null}

        {automationSlot === undefined ? null : (
          <div data-testid="task-detail-automation-slot">{automationSlot}</div>
        )}

        <AttachmentField
          key={`attachments-${task.id}`}
          task={task}
          fileInputRef={fileInputRef}
          onBusyChange={setAttachmentBusy}
        />

        {isSharedTask ? (
          <ShareCommentsSection taskId={task.id} heading={t('common.entity.COMMENT')} />
        ) : null}
      </div>

      {/* 底部按需浮层槽（标签 / 父任务归属） */}
      {bottomPopoverShown ? (
        <div
          ref={popoverRef}
          className="ht-detail-popover ht-detail-popover--bottom"
          data-testid="task-detail-popover"
        >
          {activePanel === 'tags' ? (
            <TagPickerField
              task={task}
              onSetTags={(tagIds) => {
                void store.setTags(task.id, tagIds);
              }}
            />
          ) : null}
          {activePanel === 'subtask' ? (
            <SubtaskField
              key={`subtask-${task.id}`}
              task={task}
              onSetParent={(parentId) => store.setParent(task.id, parentId)}
            />
          ) : null}
        </div>
      ) : null}

      {moveUnavailable ? (
        <p role="status" data-testid="organize-move-blocked" className="ht-detail-toolbar__blocked">
          {t('web.organize.moveBlockedShared')}
        </p>
      ) : null}

      {/* ══ 三、底部常驻工具栏 ═══════════════════════════════════════════ */}
      <div className="ht-detail-toolbar" data-testid="task-detail-toolbar">
        <div className="ht-detail-toolbar__list-picker">
          <FolderOpen size={ICON_SIZE.sm} aria-hidden="true" />
          <select
            className="ht-detail-toolbar__list-select"
            data-testid="organize-project-select"
            aria-label={t('web.organize.projectSelect', { title: task.title })}
            disabled={moveUnavailable}
            value={task.projectId ?? ''}
            onChange={(event) => {
              const next = event.target.value;
              void store.moveToProject(task.id, next === '' ? undefined : next);
            }}
          >
            <option value="" disabled={inboxBlocked}>
              {t('web.organize.inbox')}
            </option>
            {projectOptions.map((option) => (
              <option
                key={option.id}
                value={option.id}
                disabled={option.blocked}
                title={option.blocked ? t('web.organize.moveBlockedShared') : undefined}
              >
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown size={ICON_SIZE.xs} aria-hidden="true" />
        </div>

        <div className="ht-detail-toolbar__actions">
          <button
            type="button"
            className="ht-btn ht-btn--ghost ht-detail-toolbar__btn"
            aria-label={t('web.tasks.checklist.title')}
            data-testid="task-detail-checklist-trigger"
            onClick={() => {
              setChecklistOpen(true);
              setTimeout(() => {
                focusInPane('task-checklist-add-input');
              }, 0);
            }}
          >
            <ListTodo size={ICON_SIZE.sm} aria-hidden="true" />
          </button>

          <button
            type="button"
            data-detail-popover-trigger="true"
            className="ht-btn ht-btn--ghost ht-detail-toolbar__btn"
            aria-label={t('web.organize.tagsLegend')}
            aria-pressed={activePanel === 'tags'}
            aria-expanded={activePanel === 'tags'}
            data-testid="task-detail-tag-trigger"
            onClick={() => togglePanel('tags')}
          >
            <Tag size={ICON_SIZE.sm} aria-hidden="true" />
          </button>

          <button
            type="button"
            data-detail-popover-trigger="true"
            className="ht-btn ht-btn--ghost ht-detail-toolbar__btn"
            aria-label={t('web.subtask.trigger.aria', { title: task.title })}
            aria-pressed={activePanel === 'subtask'}
            aria-expanded={activePanel === 'subtask'}
            data-testid="task-detail-subtask-trigger"
            onClick={() => togglePanel('subtask')}
          >
            <CornerDownRight size={ICON_SIZE.sm} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="ht-btn ht-btn--ghost ht-detail-toolbar__btn"
            aria-label={
              attachmentBusy ? t('mobile.detail.attachments.uploading') : t('mobile.detail.attachments.add')
            }
            disabled={attachmentBusy}
            data-testid="attachment-add"
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            <Paperclip size={ICON_SIZE.sm} aria-hidden="true" />
          </button>

          {onShowActions ? (
            <button
              type="button"
              className="ht-btn ht-btn--ghost ht-detail-toolbar__btn"
              aria-label={t('web.rowMenu.label', { title: task.title })}
              data-testid="task-detail-more"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onShowActions(task.id, { x: rect.left, y: rect.bottom });
              }}
            >
              <MoreHorizontal size={ICON_SIZE.sm} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
