/**
 * 标签管理（B 包 R8）—— 改名 / 合并 / 批量
 * ===========================================
 *
 * 补的缺口：在它之前，标签只有**侧栏逐行改名**（`ProjectsPanel` 的 `OrganizerList`），
 * 没有管理面 —— 合并两个标签只能"把每条任务的标签一个个改过去"，而"批量"根本不存在。
 * 取证见 `docs/research/ticktick-surface-matrix.md`（判它是 P0 缺口）。
 *
 * ## 层级（入口表）
 *
 * 作用域 = **全局**（它改的是标签表，与"当前选中哪一条"无关）⇒ 只许落在
 * 全局层或视图层。今天的载体是任务视图页头 `⋯` 里的一枚（视图层）+ 这张浮层。
 * 登记行见 `docs/plans/r14-entry-table.md` 的 `manageTags`。
 * 代价档：改名 / 合并 / 批量删都是**可恢复**的（软删除 + 合并有撤销），
 * 所以不进危险区（J5）—— 但删除那一枚带就地二次确认（见 `OrganizerList` 的
 * `labels.confirmRemove`），因为它一次作用于**多行**。
 *
 * ## 🔴 为什么合并是"一条 op"，以及界面因此**不能**假装数据被改写了
 *
 * 合并只写**被合并掉的那条标签**（`{ deletedAt, mergedInto }`）。任务的 `tagIds`
 * **原样不动** —— "这条任务挂着哪些标签"由 `@heyta/domain` 的 `resolveTagIds()`
 * 解析（读侧别名）。所以：
 *   · 合并**一条 op**、可撤销（⌘Z 一次全回来）；
 *   · 界面上"这个标签还有几条任务"必须用**有效**计数
 *     （`tagManager.usageCount` → `tagUsageCount`），不是 `tagIds.includes` 的数量。
 *
 * ## 为什么用共享的 `OrganizerList` 画行
 *
 * "一个标签在列表里长什么样"只有一份实现（它同时被侧栏与移动端用）。
 * 这里只给它加两样东西：行首换成**多选框**（`renderLeading` 插槽）、上面一条**批量动作条**。
 * 🔴 本文件**零内联样式**：布局与配色全在 L1/L2（`OrganizerList` 的 `StyleSheet`）
 * 与 `.ht-btn` 族里 —— `features/**` 的内联样式是棘轮账本（`check:l4`），
 * 而这张面没有任何"必须内联"的动态几何。
 */

import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { indexTags, resolveTagIds, type Tag, type Task } from '@heyta/domain';
import { useDirtyDismissGuard } from '../../lib/form/useDirtyDismissGuard.js';
import { WebModalShell } from '../../lib/dialog/WebModalShell.js';
import { EmptyState, OrganizerList, toOrganizerNodes } from '@heyta/ui';
import { useI18n } from '@heyta/i18n';

import { useTaskStore } from '../tasks/store.js';
import { useProjectStore } from '../projects/store.js';
import { tagManager } from './store.js';

export interface TagsManagerProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * 一张标签管理浮层。
 *
 * 关闭策略：`modal-dirty-form` —— 这一层**有输入**（改名输入框），关掉会丢用户刚打的字，
 * 所以三条通道都先问一句（判据在 `closePolicyOf`，本文件不自己判）。
 */
export function TagsManager({ open, onClose }: TagsManagerProps): React.JSX.Element | null {
  const { t } = useI18n();
  const projects = useProjectStore();
  const tasks = useTaskStore();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const tagIndex = useMemo(() => indexTags(projects.tags), [projects.tags]);
  const allTasks: Task[] = useMemo(() => Object.values(tasks.entities.tasks), [tasks.entities.tasks]);

  /** 每行"有效挂着多少条任务"（含已完成、含被别名指过来的）。口径只有 `tagUsageCount` 一处。 */
  const usage = useMemo(
    () =>
      Object.fromEntries(projects.tags.map((tag: Tag) => [tag.id, tagManager.usageCount(tag.id)])) as Record<
        string,
        number
      >,
    // `usageCount` 读的是 op-log 的物化状态；`entities` 变一次就要重算一次。
    [projects.tags, tasks.entities],
  );

  const dirty = selected.size > 0;
  const guard = useDirtyDismissGuard({
    overlay: 'modal-dirty-form',
    isDirty: () => dirty,
    onDismiss: onClose,
  });

  const nodes = useMemo(
    () => toOrganizerNodes(projects.tags),
    [projects.tags],
  );

  const toggleSelected = useCallback((id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // 选择变了 ⇒ 上一次的合并目标可能已经不在选中集合里了。
    setMergeTarget(null);
    setNotice(null);
  }, []);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      // 失败**不进静默**：动作层给的是人话（"找不到标签" / "不能合并进它自己"），
      // 原样显示在面里，不弹第二个浮层（`overlay-feedback.md`：一处只留一句）。
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const mergeSelected = useCallback(
    (targetId: string) => {
      const sources = [...selected].filter((id) => id !== targetId);
      if (sources.length === 0) return;
      void run(async () => {
        // 每个源各一条 op（载荷里的 `mergedInto` 各不相同）。`mergeMany` 里串行派发。
        await tagManager.mergeMany(sources, targetId);
        setSelected(new Set());
        setMergeTarget(null);
        setNotice(t('web.tags.manage.selected', { count: 0 }));
      });
    },
    [run, selected, t],
  );

  const removeSelected = useCallback(() => {
    const ids = [...selected];
    if (ids.length === 0) return;
    void run(async () => {
      // **一条 DEL op 带 `entityIds`**（同类型同载荷的既有批量形状）。
      await tagManager.removeMany(ids);
      setSelected(new Set());
    });
  }, [run, selected]);

  if (!open) return null;

  const selectedList = [...selected];
  const mergeImpact =
    mergeTarget === null || selectedList.length < 2
      ? undefined
      : // 影响面用**有效**任务数：把所有源的计数加起来会重复算同一条任务。
        {
          taskCount: mergeTarget === null ? 0 : tagManager.usageCount(mergeTarget),
        };

  return createPortal(
    <WebModalShell
      policy="modal-dirty-form"
      testId="tags-manager"
      labelledBy="tags-manager-title"
      onCancel={() => {
        guard.requestDismiss('escape');
      }}
      onDismissAttempt={(via) => {
        guard.requestDismiss(via);
      }}
      busy={busy}
    >
      <h2 id="tags-manager-title" className="ht-type-h3" data-testid="tags-manager-title">
        {t('web.tags.manage.title')}
      </h2>
      <p className="ht-type-caption">{t('web.tags.manage.hint')}</p>

      {selectedList.length > 0 ? (
        <div data-testid="tags-manager-bulk" role="group" aria-label={t('web.tags.manage.selected', { count: selectedList.length })}>
          <p className="ht-type-caption" role="status">
            {t('web.tags.manage.selected', { count: selectedList.length })}
          </p>
          {selectedList.length < 2 ? (
            <p className="ht-type-caption">{t('web.tags.manage.needTwo')}</p>
          ) : (
            <>
              {mergeTarget === null ? null : (
                <div role="group" data-testid="tags-manager-merge-confirm">
                  <p className="ht-type-caption" role="status">
                    {t('web.tags.manage.mergeConfirmImpact', {
                      count: mergeImpact?.taskCount ?? 0,
                      target: projects.tags.find((tag) => tag.id === mergeTarget)?.name ?? '',
                      sources: selectedList
                        .filter((id) => id !== mergeTarget)
                        .map((id) => projects.tags.find((tag) => tag.id === id)?.name ?? '')
                        .join('、'),
                    })}
                  </p>
                  <button
                    type="button"
                    className="ht-btn ht-btn--ghost"
                    data-testid="tags-manager-merge-submit"
                    disabled={busy}
                    onClick={() => {
                      if (mergeTarget !== null) mergeSelected(mergeTarget);
                    }}
                  >
                    {t('web.tags.manage.mergeConfirmSubmit')}
                  </button>
                  <button
                    type="button"
                    className="ht-btn ht-btn--ghost"
                    data-testid="tags-manager-merge-cancel"
                    onClick={() => {
                      setMergeTarget(null);
                    }}
                  >
                    {t('web.tags.manage.mergeConfirmCancel')}
                  </button>
                </div>
              )}
            </>
          )}
          <button
            type="button"
            className="ht-btn ht-btn--ghost"
            data-testid="tags-manager-bulk-delete"
            disabled={busy}
            onClick={removeSelected}
          >
            {t('web.tags.manage.bulkDelete', { count: selectedList.length })}
          </button>
        </div>
      ) : null}

      {notice === null ? null : (
        <p className="ht-type-caption" role="status" data-testid="tags-manager-notice">
          {notice}
        </p>
      )}

      {/*
        🔴 行首换成多选框（`renderLeading` 插槽）：勾选是**这一面独有**的意图，
        不进共享层（侧栏那一份不需要多选，而"标签行要不要多选"是宿主的选择）。
        改名仍然走共享层那一份（`onRename`）—— 行内编辑器的形状只有一份。
      */}
      {/*
        🔴 空态用**共享的** `EmptyState`（`@heyta/ui`），不传 `labels.empty`：
        后者在 `check:empty-state` 眼里是"视图里手写空态词条"（新增债务），
        而共享组件正是那道门禁指名的正确做法。`size='block'` 因为这里是浮层里的一段，
        不是一整页。
      */}
      {projects.tags.length === 0 ? (
        <EmptyState
          title={t('common.organizer.tags.empty')}
          hint={t('common.organizer.tags.empty.hint')}
          size="section"
          testID="tags-manager-empty"
        />
      ) : null}
      <OrganizerList
        kind="tag"
        items={nodes}
        counts={usage}
        busy={busy}
        labels={{
          removeLabel: (name) => t('web.tags.delete', { name }),
          rename: {
            button: (name) => t('common.organizer.rename.button', { name }),
            save: t('common.organizer.rename.save'),
            cancel: t('common.organizer.rename.cancel'),
          },
          confirmRemove: {
            ask: (name) => t('common.organizer.confirm.ask', { name }),
            impact: (count) => t('common.organizer.confirm.impactTags', { count }),
            confirm: t('common.organizer.confirm.delete'),
            cancel: t('common.organizer.confirm.cancel'),
          },
        }}
        onRename={(item, name) => {
          void run(async () => {
            await tagManager.rename(item.id, name);
          });
        }}
        onRemove={(item) => {
          void run(async () => {
            await tagManager.removeMany([item.id]);
          });
        }}
        renderLeading={(item) => (
          <input
            type="checkbox"
            checked={selected.has(item.id)}
            aria-label={t('web.tags.manage.select', { name: item.name })}
            data-testid={`tags-manager-select-${item.id}`}
            onChange={() => {
              toggleSelected(item.id);
            }}
          />
        )}
        renderItemExtra={(item) =>
          selectedList.length >= 2 ? (
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              data-testid={`tags-manager-merge-into-${item.id}`}
              disabled={busy}
              onClick={() => {
                setMergeTarget(item.id);
              }}
            >
              {t('web.tags.manage.mergeLabel', { name: item.name })}
            </button>
          ) : null
        }
        testID="tags-manager-list"
      />

      <button
        type="button"
        className="ht-btn ht-btn--ghost"
        data-testid="tags-manager-close"
        onClick={() => {
          guard.requestDismiss('escape');
        }}
      >
        {t('web.tags.manage.close')}
      </button>
      {guard.guard}
    </WebModalShell>,
    document.body,
  );
}

/**
 * 一行里"还剩哪些标签"的解析（导出给测试与将来的行内复用）。
 *
 * ⚠️ 它只是 `resolveTagIds` 的转发，存在的理由是让测试能在**不 import 领域包**
 * 的情况下断言"合并之后这条任务的有效标签里没有 A"。
 */
export function effectiveTagIdsOf(task: Task, tags: readonly Tag[]): string[] {
  return resolveTagIds(task.tagIds, indexTags(tags));
}
