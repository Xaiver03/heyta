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

import { useSelected } from '../../lib/selection.js';
import { currentState, dispatchChecked, dispatchIntent } from '../../lib/oplog.js';
import { DangerConfirmDialog } from '../../lib/dialog/DangerConfirmDialog.js';
import { useProjectStore } from '../projects/store.js';
import { useReminderStore } from '../reminders/store.js';
import { useSyncStore } from '../sync/store.js';
import { ShareCommentsSection } from '../share/ShareCommentsSection.js';
import { useShareMembers } from '../share/use-share-members.js';
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
  /**
   * 委派（#15）：只有**共享清单**里的任务才有可指派的成员池。
   * `shareId` 从任务所属清单上取（`Project.shareId`，缺席 = 个人清单）。
   * 🔴 这两个 hook 必须在"任务不存在就返回 null"之前调用（hooks 不可条件调用），
   * 所以它们读的是 `picked` 而不是下面那个已判活/已删的 `task`。
   */
  const shareId =
    picked?.projectId === undefined ? undefined : store.entities.projects[picked.projectId]?.shareId;
  const shareMembers = useShareMembers(shareId);
  const myAccountId = useSyncStore((state) => state.accountId);
  /**
   * 🔴 "在不在"要判两件事：**表里有这条**，且它**没被删掉**。
   *
   * 软删（`DEL` op → reducer 写 `deletedAt`）不会把任务从 `entities.tasks` 里拿掉 ——
   * 它是回收站那一格的住户，墓碑必须留着（`packages/domain/src/entities.ts:37`）。
   * 而删除那一刻，选中态是留在这一条上的（列表里那行消失了，`selection` 没人清）。
   * 所以只看"表里有没有"会让这一格继续画一条**界面上已经不存在的任务**：
   * 标题和备注都还在栏里，用户读到的是"这条任务还在，只是我没选它"。
   */

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
    if (activePanel === null) return undefined;
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
  }, [activePanel]);

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

      {/*
        区块头复用词条表里已有的那一句「备注」：占位符复用 composer 那句是同一个理由
        （两处问的是同一件事，各起一条词条迟早漂成两种说法）。
      */}
      <h3 style={blockLabelStyle}>{t('web.note.toggle')}</h3>

      {task.note && task.note.trim() !== '' ? (
        <div
          className="ht-note-preview"
          data-testid="task-note-rendered"
          dangerouslySetInnerHTML={{ __html: renderNoteMarkdown(task.note) }}
        />
      ) : null}

      {/*
        🔴 `key={task.id}`：`NoteField` 里那只输入框是**非受控**的（`defaultValue` +
        `key={note}`），↑↓ 换选中时如果外层不换 key，两条备注恰好同字的任务会让框里
        留着上一条的内容 —— 而界面看起来"跟着换了"（标题已经换了）。
      */}
      <NoteField
        key={task.id}
        task={task}
        onSetNote={(note) => {
          void store.setNote(task.id, note);
        }}
      />

      <ChecklistEditor
        key={`checklist-${task.id}`}
        task={task}
        onSetChecklist={(items) => {
          void store.setChecklist(task.id, items);
        }}
        onToggle={(itemId, done) => {
          void store.toggleChecklistItem(task.id, itemId, done);
        }}
        onAdd={(text) => {
          void store.addChecklistItem(task.id, text);
        }}
        onRemove={(itemId) => {
          void store.removeChecklistItem(task.id, itemId);
        }}
      />

      {/* ══ 分组二：时间（W6）════════════════════════════════════════ */}
      <h3 style={groupHeaderStyle} data-testid="task-detail-group">
        {t('web.tasks.detail.section.time')}
      </h3>

      {/*
        截止（§8.146）。区块头复用行尾那颗触发器已经在说的 `web.due.trigger`（「截止」）——
        两处问的是同一件事，另起一条词条迟早漂成两种说法。
        这一格里**没有** `<details>`、也**没有** Portal 与 `.ht-material`：那三件都是
        "行尾那一支在哪儿画"的细节（与 §8.141 的 R4、§8.144 的 S4、§8.145 的 M4/M5 同一条纪律），
        栏里要的只是编辑本体。这一格也**不放只读徽标**：截止的显示在共享行的元信息条上
        （`task-meta`），两档都在，理由见 `DueEditor.tsx` 文件头那张表的第三行。
        🔴 `key={task.id}`：`DatePicker` 带**本地 state**（"正在看哪个月"），↑↓ 换选中时
        不换 key 会把上一条浏览到的月份带过来 —— 与组织那一格的 `OrganizerField`
        （零 useState ⇒ 不挂 key）正好是那条纪律的两面。
      */}
      <h3 style={blockLabelStyle}>{t('web.due.trigger')}</h3>
      <DueField
        key={`due-${task.id}`}
        task={task}
        now={store.now}
        onSetDueDate={(due, dueDateLocal) => {
          void store.setDueDate(task.id, due, dueDateLocal);
        }}
      />

      {/*
        提醒（§8.145）。与重复那一格同一条理由，这里**不叠 `h3`**：共享的 `ReminderList`
        自带区块头（`labels.title` 渲染成 `accessibilityRole="header"`，见
        `packages/ui/src/reminders/ReminderList.tsx`），两处同一个词说两遍，读到的是"有两个区块"。
        行尾那一支的玻璃浮层外壳（`.ht-compose-panel ht-material`）也**不跟着本体进栏** ——
        一栏里漂一块 `position: absolute` 的板子，用户读到的是"这格里浮着不属于这格的东西"
        （§8.141 的 R4 钉的就是这一档）。
        ⚠️ 这里**没有** `key`，而且不是漏掉：这一组的两格都要 key 是因为它们各自带**本地草稿 state**
        （非受控框 / 月历浏览态），而 `ReminderField` 与 `ReminderList` 全程只有
        `useMemo`、零 `useState`（提醒列表来自 store，按 `task.id` 取）。↑↓ 换选中时它没有
        上一条的状态可带 —— "搬进栏里就要加 keys"不是这条纪律，**有本地 state 才是**。
      */}
      <ReminderField task={task} />

      {/* ══ 分组三：组织（W6）═══════════════════════════════════════ */}
      <h3 style={groupHeaderStyle} data-testid="task-detail-group">
        {t('web.tasks.detail.section.organize')}
      </h3>

      {/*
        清单 + 标签（§8.147）。🔴 与重复/提醒那两格同一条理由，这里**不叠 `h3`**：
        `OrganizerField` 自带两个区块头（`<label>` 里那句「清单」与 `<fieldset>` 的
        `<legend>`「标签」），两处同一个词说两遍，读到的是"有两个区块"。
        行尾那一支的 `<details>` 与 `.ht-material` 也**不跟着本体进栏**（§8.141 的 R4、
        §8.145 的 M4/M5、§8.146 的 D3/D4 钉的都是这一档，pane 级那一条判据在 e2e 层只有
        T10 一个消费者 —— 任何一格套上外壳都红在它身上）。
        ⚠️ 这里**没有** `key`，而且不是漏掉：两个控件全部受控于 store、整块零 `useState`，
        所以 §8.145 那条"有本地 state 才要 key"落在**不挂**那一侧 ——
        与时间组里截止那一格正好相反（`DatePicker` 带 `useState(month)` ⇒ 必须挂）。
      */}
      <OrganizerField
        task={task}
        onMoveToProject={(projectId) => {
          void store.moveToProject(task.id, projectId);
        }}
        onSetTags={(tagIds) => {
          void store.setTags(task.id, tagIds);
        }}
      />

      {/*
        子任务（§8.144）。区块头复用词条表里已有的那一句「子任务」（`web.subtask.none`）——
        它在行尾那颗 chip 上说的就是同一件事，另起一条词条迟早漂成两种说法。
        🔴 编辑本体里**没有** `<details>`：那是行尾那一支的展开机关，栏里要的只是控件本身
        （与重复那一格同一条理由）。
        `key={task.id}`：拒绝提示是本地 state，↑↓ 换选中时不换 key 会把上一条的提示带过来。
      */}
      <h3 style={blockLabelStyle}>{t('web.subtask.none')}</h3>
      <SubtaskField
        key={`subtask-${task.id}`}
        task={task}
        onSetParent={(parentId) => store.setParent(task.id, parentId)}
      />

      {/*
        优先级（W7）。此前 Web 上它是"只读显示（共享徽标）+ AI 批量写入"——
        `TaskActions.setPriority` 与 `store.setPriority` 一直存在，却没有任何
        手动控件调用它：用户点不了自己的优先级，只能等 AI 批量写。
        区块头复用 AI 拆解已在说的 `web.ai.capture.field.priority`（「优先级」），
        选项文案复用 AI 排优先级那四条 `web.ai.prioritize.priority.*`（无/低/中/高）
        —— 两处问的是同一件事，另起词条迟早漂成两种说法。**零新增词条**。
        原生 `<select>`（与清单下拉同一条理由：键盘、读屏、移动端适配都不自造）；
        受控于 store、零本地 state ⇒ 不挂 key（§8.145 那条纪律落在"不挂"那一侧）。
        🔴 选项顺序对齐 `Priority` 枚举（None→Low→Medium→High，`packages/domain`），
        value 用枚举数值串 —— 界面不发明第二套优先级词表。
        🔴 W6 起归「组织」组（W7 的原落点在截止与提醒之间，那是 DOM 相邻不是语义）：
        优先级不是时间量，是"任务怎么归置"的维度 —— 四象限视图正是
        优先级 × 截止 的投影，与清单/标签同属归置属性。裁决全文见文件头。
      */}
      <h3 style={blockLabelStyle}>{t('web.ai.capture.field.priority')}</h3>
      <select
        data-testid="task-priority-select"
        aria-label={t('web.ai.capture.field.priority')}
        value={String(task.priority ?? Priority.None)}
        onChange={(event) => {
          const next = Number(event.target.value) as Priority;
          // 没变不发 op：select 的 change 本只在值变化时触发，这道闸挡的是
          // 与"老数据里 priority 缺失时的回显值（None）"比较的那一类假变化。
          if (next === (task.priority ?? Priority.None)) return;
          void store.setPriority(task.id, next);
        }}
      >
        <option value={String(Priority.None)}>{t('web.ai.prioritize.priority.none')}</option>
        <option value={String(Priority.Low)}>{t('web.ai.prioritize.priority.low')}</option>
        <option value={String(Priority.Medium)}>{t('web.ai.prioritize.priority.medium')}</option>
        <option value={String(Priority.High)}>{t('web.ai.prioritize.priority.high')}</option>
      </select>

      {/*
        指派（#15 委派 UI）。只有共享清单（`shareId` 在册）才画这一格 ——
        个人清单里"指派"没有意义（没有成员池），画一个永远只有一个选项的下拉
        等于界面上多一个假控件。成员名册来自 `useShareMembers`（服务端
        `ShareApiClient.listMembers`），写入走**既有**的 `store.setAssignee`
        → `patchDetails(assigneeUserId)`（ADR-0088 的唯一写入通道，一条 UPD op）。
        原生 `<select>`，与上面优先级同一档（键盘 / 读屏 / 移动端都不自造）。
        `value=""` = 未指派；成员选项的 value 是成员账号 id（字符串）。
        ⚠️ 名册没取到时只剩「未指派」一项 —— 那是降级，不是第二套判据。
      */}
      {shareId === undefined ? null : (
        <>
          <h3 style={blockLabelStyle}>{t('web.tasks.detail.assign.label')}</h3>
          <select
            data-testid="task-assignee-select"
            aria-label={t('web.tasks.detail.assign.label')}
            value={task.assigneeUserId ?? ''}
            onChange={(event) => {
              const next = event.target.value;
              void store.setAssignee(task.id, next === '' ? undefined : next);
            }}
          >
            <option value="">{t('web.tasks.detail.assign.unassigned')}</option>
            {shareMembers.map((member) => (
              <option key={member.memberId} value={member.userId}>
                {member.userId === myAccountId
                  ? t('web.tasks.detail.assign.me')
                  : t('web.tasks.detail.assign.member', { id: member.userId })}
              </option>
            ))}
          </select>
        </>
      )}

      {/* ══ 分组四：自动化（W6）═════════════════════════════════════ */}
      <h3 style={groupHeaderStyle} data-testid="task-detail-group">
        {t('web.tasks.detail.section.automation')}
      </h3>

      {/*
        重复。🔴 它**自带**区块头（编辑本体的 `<legend>` 就是那一句「重复规则」），
        所以这里不再叠一枚字段级的 `h3` —— 两处同一个词说两遍，读到的是"有两个区块"。
        这一格里也**没有浮层外壳**：`.ht-material` 与 `position: absolute` 属于行尾那一支
        （"这一格在哪儿画"的细节），栏里要的只是控件本身。
        ⚠️ W6 起控件**内部**多了一枚「高级」折叠 `<details>`（自定义 RRULE 收进去，
        见 `TaskRepeat.tsx` 文件头第 4 条）—— 那是编辑本体自带的进阶分区，不是行尾
        浮层外壳，pane 级不变量按"折叠默认收起 + 主编辑器不许藏进折叠"重新钉（见
        `tests/task-detail-groups.spec.tsx`）。
        `key={task.id}` 与备注同一理由：自定义 RRULE 那只草稿框是受控的本地 state，
        ↑↓ 换选中时不换 key 就会把上一条任务没提交的草稿带过来。
      */}
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

      {/*
        AI 那一格（宿主注入，见 `automationSlot` 的注释）。
        空组不画：`automationSlot` 没给时这一组只剩重复，与改前逐字相同。
      */}
      {automationSlot === undefined ? null : (
        <div data-testid="task-detail-automation-slot">{automationSlot}</div>
      )}

      {/*
        ══ 附件（工单 #9 的 web 移植）═══════════════════════════════════════
        🔴 **这一行就是"它真的挂在详情面上"的全部证据**：去掉它，附件区从界面上消失
        而数据仍在（`apps/web/tests/task-detail-attachments.spec.tsx` 的判据 ② 钉着
        "去掉挂载点 ⇒ 判据 ① 必须失败"）。
        `key={task.id}`：这一格有本地状态（在途 / 失败句 / 待确认的那一条），
        ↑↓ 换选中时不换 key 会把上一条的失败句带过来 —— 与备注 / 截止 / 子任务同一格纪律。
        四个 `attachment*` 的接线全在这个组件里（动作集、上传通道、确认档），
        宿主（`App.tsx`）一个字都不用知道 —— 与 `ReminderField` 同一条边界。
      */}
      <AttachmentField key={`attachments-${task.id}`} task={task} />

      {/*
        ══ 协作区：评论（W4）═══════════════════════════════════════════
        🔴 它**刻意不是第五个「分组」**：`task-detail-group` 那四枚（基本 / 时间 / 组织 /
        自动化）是被审计 §4.6 钉死的**任务属性**分组，而评论不是任务属性 ——
        它是协作线索（只存在于共享清单）。按产品定义推导：属性分组之下另起一块区域，
        标题视觉上同款（同一枚 `groupHeaderStyle`）但**不冒充分组**（不挂那个 testid）。
        `tests/task-detail-groups.spec.tsx` 数的正是 `task-detail-group`，它继续钉那四枚。
        是否给协作单独立「区」的口径写回台账，等审计更新时一并收。
      */}
      <h3 style={groupHeaderStyle} data-testid="task-detail-collaboration">
        {t('common.entity.COMMENT')}
      </h3>
      <div data-testid="task-detail-comments">
        <ShareCommentsSection taskId={task.id} />
      </div>

      {/*
        ══ 底部工具条（C2，滴答对齐 2026-11）═══════════════════════════════
        一行快捷入口：收集箱（移动清单）、文本格式（备注富文本）、更多。
        与滴答的详情面底部工具条同形 —— 把高频操作从分组里提到随手可点的位置。
        🔴 三个按钮都是**快捷入口**，不是第二份编辑器：点击后聚焦到对应分组/字段，
        真正的编辑仍在上面那四组里。
      */}
      {/*
        底部工具条（C2，滴答对齐）。滴答那一排是「移动到 / 富文本 / 更多」。
        这里画**三枚**，每枚做的都是它标签说的那件事：

          · 「移动到」→ 把「组织」分组里那个清单下拉滚到眼前并聚焦（`organize-project-select`
            就是改归属的那个控件，`onMoveToProject` 走 store → op-log）。
          · 「备注」→ 聚焦备注框（`task-note-input`）。
          · 「更多」→ 打开这一条的任务操作菜单（置顶 / 优先级 / 标签 / 移动到 / 删除）。

        🔴 **「文本格式」没有画，这是裁决不是漏掉**：富文本是本计划 C1（选型 + 许可证门禁
        都还没过），现在这块只是纯文本框 —— 画一枚格式按钮等于给用户一个按下去什么都不变
        的控件。等 C1 落地再补第三枚的位置（那一枚才是它）。
        ⚠️ 前两枚是**导航**（滚过去 + 交还焦点），不是第二次写入入口 —— 字段本身仍只有一处
        可改，`check:row-single-source` 与详情列那套单源纪律管的是后者；第三枚也不写任何东西，
        它只是把动作区的锚点交给宿主，动作本体还是 `TaskRowMenu` 那一份。
      */}

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
