import { ICON_SIZE } from '@heyta/design-system';
/**
 * 回收站
 * ========
 *
 * 删除一直是**软删除 + 墓碑**（`DEL` op → `deletedAt`），因此数据从来没丢 ——
 * 丢的是**看见它的入口**。`apps/web` 只有一个删除按钮，没有任何恢复途径，
 * 于是用户误删之后只能看着它从所有视图里消失，而墓碑还在往每台设备同步。
 *
 * 这个视图补上三件事：
 *   1. **看见 + 恢复** —— 恢复走 store（任务 `restoreTask`、便签 `restoreNote`），
 *      它们各写一条 `UPD { deletedAt: null }`，所以恢复是**可同步**的：
 *      另一台设备回放后条目也回来，不是只改了本地的界面。
 *   2. **彻底删除** —— 一个**二次确认**后的不可逆动作（`purgedAt` 标记）。
 *      确认框必须说清"不可恢复"，因为那正是它与普通删除的唯一区别；
 *      也必须说清"这不是物理擦除"（`confirm.notErasure`），因为那句话容易被
 *      读成"数据已经不存在"。
 *   3. **失败要说出来** —— 动作层现在会区分"没做成"与"永远做不成"（抛错），
 *      界面如果继续 `void promise`，那点下去就是"什么都不发生、也不报错"。
 *
 * 🔴 四路数据源（任务 / 便签 / 清单 / 习惯，W4）**并成一个列表**这件事不在这里判：
 * 形状、标题、时间回退与顺序全在 `@heyta/domain` 的 `toTrashItems()`，
 * 本文件只把两路喂进去（AGENTS §3.5）。
 *
 * 🔴 本文件**不拼 op**、也不直接改 `entities`（AGENTS.md §3.5 / D4）：
 * 所有写操作都经 `store` → `@heyta/app-host` 的动作层。这里只做两件事：
 * 收集用户意图、以及把"要不要确认"这个纯交互状态摆在界面上。
 *
 * ⚠️ 文案全部走词条表（`check:ui-language` 会拦硬编码）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AlertTriangle, RotateCcw, Trash2, X } from 'lucide-react';

import {
  liveTaskCountOfProject,
  toTrashItems,
  type TrashKind,
} from '@heyta/domain';
import { useI18n, type Locale } from '@heyta/i18n';
import { entityLabelOf, HeytaUiProvider, TrashBoard } from '@heyta/ui';

import { useHabitStore } from '../habits/store.js';
import { useNoteStore } from '../notes/store.js';
import { useProjectStore } from '../projects/store.js';
import { selectTrashedTasks, useTaskStore } from '../tasks/store.js';

/**
 * 删除时刻 → 可读时间。
 *
 * 与语言绑定（`ConflictDialog` 的 `formatTime` 同一条理由）：写死 `'zh-CN'`
 * 会让英文界面用中文习惯排日期，而这是最容易被漏掉的一类"看不见的文案"。
 */
function formatDeletedAt(ms: number, locale: Locale): string {
  return new Date(ms).toLocaleString(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TrashView(): React.JSX.Element {
  const { t, locale } = useI18n();
  const trashedTasks = useTaskStore(useShallow(selectTrashedTasks));
  const trashedNotes = useNoteStore((s) => s.trashed);
  // 🔴 已删除的**清单与习惯**（W4 / P-1）。确认框那句"里面还有 N 条任务"要用
  // **全量任务表**，所以那里读的是 `entities.tasks` 整个记录，不是回收站这一路。
  const trashedProjects = useProjectStore((s) => s.trashed);
  const trashedHabits = useHabitStore((s) => s.trashed);
  const restoreTask = useTaskStore((s) => s.restoreTask);
  const purgeTask = useTaskStore((s) => s.purgeTask);
  const restoreNote = useNoteStore((s) => s.restoreNote);
  const purgeNote = useNoteStore((s) => s.purgeNote);
  const restoreProject = useProjectStore((s) => s.restoreProject);
  const purgeProject = useProjectStore((s) => s.purgeProject);
  const restoreHabit = useHabitStore((s) => s.restoreHabit);
  const purgeHabit = useHabitStore((s) => s.purgeHabit);
  const allTasks = useTaskStore((s) => s.entities.tasks);

  /**
   * 🔴 两路数据源**并一处、排一次序**，规则在共享层（`trash/model.ts`）。
   * 在这里 `concat` 之后再 `sort` 一遍，就是"两端两份"的开始。
   */
  const items = useMemo(
    () =>
      toTrashItems({
        tasks: trashedTasks,
        notes: trashedNotes,
        projects: trashedProjects,
        habits: trashedHabits,
      }),
    [trashedTasks, trashedNotes, trashedProjects, trashedHabits],
  );

  /**
   * 正在等待二次确认的那一条 id。
   *
   * 只存 id、不存整条对象：条目会随物化状态重建，存对象会让"确认框里
   * 显示的是不是当前那一条"变成两个状态。id 在这里就是唯一事实。
   */
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * 上一次动作失败的原因。
   *
   * 🔴 原来这里什么都不接：`void restoreTask(id)` 让 store 抛出的
   * "已被彻底删除，无法恢复"变成一个 **unhandled rejection** —— 界面上
   * 点了没反应。动作层越是诚实（它现在会拒绝、会区分两句话），
   * 界面把它咽掉的代价就越大。
   */
  const [error, setError] = useState<string | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement>(null);

  const pending = items.find((item) => item.id === confirmingId);

  /**
   * 四路动作的**穷尽表**：键就是 `TrashKind`。
   *
   * 🔴 用表而不是原先那种 `kind === 'NOTE' ? … : …` 的嵌套三元：加一种实体时，
   *   三元写法**编译照过**、界面上那一类的还原按钮点了什么都不发生；
   *   `Record<TrashKind, …>` 少一路就是编译错误。W4 那一档"列表里有它、
   *   还原没接上"的症状是这样挡掉的。
   *
   * ⚠️ 这是**显示路由**，不是产品判断 —— 该写什么 op 在动作层。
   */
  const byKind: Record<
    TrashKind,
    { restore: (id: string) => Promise<unknown>; purge: (id: string) => Promise<unknown> }
  > = {
    TASK: { restore: restoreTask, purge: purgeTask },
    NOTE: { restore: restoreNote, purge: purgeNote },
    PROJECT: { restore: restoreProject, purge: purgeProject },
    HABIT: { restore: restoreHabit, purge: purgeHabit },
  };

  /** 一次回收站动作：置忙 → 执行 → 失败要说出来 → 收忙。 */
  const run = (id: string, kind: TrashKind, action: 'restore' | 'purge'): void => {
    setBusyId(id);
    setError(undefined);
    void Promise.resolve(byKind[kind][action](id))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBusyId(null);
      });
  };

  const kindOf = (id: string): TrashKind | undefined => items.find((item) => item.id === id)?.kind;

  /**
   * "里面还有 N 条任务"里的那个 N。
   *
   * 🔴 只在确认框指着一条**清单**时才算，而且数的是活的任务
   *   （`liveTaskCountOfProject` 里是 `isLive`）：已删除与已彻底删除的都不算 ——
   *   用 `!inTrash()` 数会把已彻底删除那几条算进来，确认框就在报一条不存在的数据。
   */
  const affectedTasks =
    pending !== undefined && pending.kind === 'PROJECT'
      ? liveTaskCountOfProject(Object.values(allTasks), pending.id)
      : 0;

  // 条目在确认框开着的时候被恢复（比如另一台设备同步过来）→ 自动关掉，
  // 否则用户会对着一个指向已不存在条目的确认框点"彻底删除"。
  useEffect(() => {
    if (confirmingId !== undefined && pending === undefined) setConfirmingId(undefined);
  }, [confirmingId, pending]);

  // Esc 关闭 + 打开时把焦点移进对话框（键盘用户不能还停在背后的列表上）。
  useEffect(() => {
    if (pending === undefined) return;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setConfirmingId(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [pending]);

  return (
    <section className="ht-trash" aria-label={t('web.trash.nav')}>
      {/*
        🔴 **列表来自共享 `TrashBoard`**（与移动端同一份）。
        在此之前两端各写了一份回收站行 —— 而它们的漂移不会报错。
        ⚠️ 确认弹窗**不共享**：它是真的平台差异（这里是自绘 dialog + 焦点陷阱，
        移动端是原生 Modal），所以本板只把 `onPurge` 交出去。
      */}
      {error === undefined ? null : (
        <p className="ht-settings__danger" role="alert" data-testid="trash-error">
          {t('web.trash.error', { reason: error })}
        </p>
      )}
      {/*
        🔴 **必须包 `HeytaUiProvider`**：共享板会 `useHeytaTokens()`，
        而缺了它会在**运行时**抛「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」——
        报错指向 provider，不指向这里。
        ⚠️ 这个坑本仓踩过两次（focus 与 quadrant），所以 `check:ui-provider`
        有一条判据专门扫这个；`TrashBoard` 已在它的登记里。
      */}
      <HeytaUiProvider>
        <TrashBoard
          items={items}
          labels={{
            intro: t('web.trash.intro'),
            emptyTitle: t('web.trash.empty.title'),
            emptyHint: t('web.trash.empty.hint'),
            // 徽标文案的唯一真源是 `common.entity.*`（共享的查表函数），不是这里。
            kindLabel: (kind) => entityLabelOf(kind, t),
            deletedAt: (item) => t('web.trash.deletedAt', { date: formatDeletedAt(item.deletedAt, locale) }),
            restore: (item) => t('web.trash.restore', { title: item.title }),
            purge: (item) => t('web.trash.purge', { title: item.title }),
          }}
          onRestore={(id) => {
            const kind = kindOf(id);
            if (kind === undefined) return;
            run(id, kind, 'restore');
          }}
          // 🔴 这一下**不删**，只打开确认框 —— 不可逆动作必须二次确认。
          onPurge={setConfirmingId}
          busyId={busyId}
          testID="trash-board"
        />
      </HeytaUiProvider>

      {pending !== undefined && (
        <div role="presentation" className="ht-trash__overlay">
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ht-trash-confirm-title"
            className="ht-trash__dialog"
            data-testid="trash-confirm"
          >
            <div className="ht-trash__dialog-head">
              <span className="ht-trash__dialog-icon">
                <AlertTriangle size={ICON_SIZE.md} aria-hidden="true" />
              </span>
              <div className="ht-trash__dialog-body">
                <h2 id="ht-trash-confirm-title" className="ht-trash__dialog-title">
                  {t('web.trash.confirm.title', { title: pending.title })}
                </h2>
                <p className="ht-trash__dialog-text">{t('web.trash.confirm.body')}</p>
                {/*
                  🔴 影响面那句（W4 / P-1）：删清单**不级联删任务**、删习惯**不删打卡记录**。
                  不说这一句，用户会以为连着 N 条一起没了 —— 那是一个会让人**不敢点**、
                  而说的又不是实话的确认框。只在清单 / 习惯这两类上出现。
                */}
                {pending.kind !== 'PROJECT' && pending.kind !== 'HABIT' ? null : (
                  <p className="ht-trash__dialog-text" data-testid="trash-confirm-impact">
                    {pending.kind === 'PROJECT'
                      ? t('web.trash.confirm.projectTasks', { count: affectedTasks })
                      : t('web.trash.confirm.habitLogs')}
                  </p>
                )}
                {/*
                  🔴 与移动端**同一句诚实条款**（W5 把两端措辞对齐的那一格）：
                  `purge` 只加 `purgedAt` 标记，op-log 里的历史载荷没被抹掉。
                  少这一句，界面就是在对一件没发生过的事做承诺。
                */}
                <p className="ht-trash__dialog-text" data-testid="trash-confirm-not-erasure">
                  {t('web.trash.confirm.notErasure')}
                </p>
              </div>
              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                aria-label={t('web.trash.confirm.cancel')}
                onClick={() => setConfirmingId(undefined)}
              >
                <X size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
            </div>

            <div className="ht-trash__dialog-actions">
              <button
                type="button"
                className="ht-btn"
                data-testid="trash-confirm-cancel"
                onClick={() => setConfirmingId(undefined)}
              >
                {t('web.trash.confirm.cancel')}
              </button>
              <button
                type="button"
                className="ht-btn ht-btn--primary"
                data-testid="trash-confirm-submit"
                onClick={() => {
                  // 先关确认框再写：写失败（例如条目已被别处删掉）不该把
                  // 确认框永远卡在屏幕上 —— 失败由上面的 `error` 说给用户。
                  const { id, kind } = pending;
                  setConfirmingId(undefined);
                  run(id, kind, 'purge');
                }}
              >
                {t('web.trash.confirm.submit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
