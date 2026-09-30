/**
 * 回收站
 * ========
 *
 * 删除一直是**软删除 + 墓碑**（`DEL` op → `deletedAt`），因此数据从来没丢 ——
 * 丢的是**看见它的入口**。`apps/web` 只有一个删除按钮，没有任何恢复途径，
 * 于是用户误删之后只能看着它从所有视图里消失，而墓碑还在往每台设备同步。
 *
 * 这个视图补上两件事：
 *   1. **看见 + 恢复** —— 单条恢复走 `store.restoreTask`，它写一条
 *      `UPD { deletedAt: null }`，所以恢复是**可同步**的：
 *      另一台设备回放后条目也回来，不是只改了本地的界面。
 *   2. **彻底删除** —— 一个**二次确认**后的不可逆动作（`purgedAt` 标记）。
 *      确认框必须说清"不可恢复"，因为那正是它与普通删除的唯一区别。
 *
 * 🔴 本文件**不拼 op**、也不直接改 `entities`（AGENTS.md §3.5 / D4）：
 * 所有写操作都经 `store` → `@heyta/app-host` 的动作层。这里只做两件事：
 * 收集用户意图、以及把"要不要确认"这个纯交互状态摆在界面上。
 *
 * ⚠️ 文案全部走词条表（`check:ui-language` 会拦硬编码）。
 */

import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AlertTriangle, RotateCcw, Trash2, X } from 'lucide-react';

import { useI18n, type Locale } from '@heyta/i18n';
import { HeytaUiProvider, TrashBoard } from '@heyta/ui';

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
  const trashed = useTaskStore(useShallow(selectTrashedTasks));
  const restoreTask = useTaskStore((s) => s.restoreTask);
  const purgeTask = useTaskStore((s) => s.purgeTask);

  /**
   * 正在等待二次确认的那条任务 id。
   *
   * 只存 id、不存整条任务：任务对象会随物化状态重建，存对象会让"确认框里
   * 显示的是不是当前那一条"变成两个状态。id 在这里就是唯一事实。
   */
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement>(null);

  const pending = trashed.find((task) => task.id === confirmingId);

  // 条目在确认框开着的时候被恢复（比如另一台设备同步过来）→ 自动关掉，
  // 否则用户会对着一个指向已不存在任务的确认框点"彻底删除"。
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
      {/*
        🔴 **必须包 `HeytaUiProvider`**：共享板会 `useHeytaTokens()`，
        而缺了它会在**运行时**抛「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」——
        报错指向 provider，不指向这里。
        ⚠️ 这个坑本仓踩过两次（focus 与 quadrant），所以 `check:ui-provider`
        有一条判据专门扫这个；`TrashBoard` 已在它的登记里。
      */}
      <HeytaUiProvider>
        <TrashBoard
          items={trashed}
          labels={{
            intro: t('web.trash.intro'),
            emptyTitle: t('web.trash.empty.title'),
            emptyHint: t('web.trash.empty.hint'),
            // ⚠️ 收**整条任务**：`deletedAt ?? updatedAt` 那条回退规则两端必须一致。
            deletedAt: (task) =>
              t('web.trash.deletedAt', {
                date: formatDeletedAt(task.deletedAt ?? task.updatedAt, locale),
              }),
            restore: (task) => t('web.trash.restore', { title: task.title }),
            purge: (task) => t('web.trash.purge', { title: task.title }),
          }}
          onRestore={(id) => {
            void restoreTask(id);
          }}
          // 🔴 这一下**不删**，只打开确认框 —— 不可逆动作必须二次确认。
          onPurge={setConfirmingId}
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
                <AlertTriangle size={20} aria-hidden="true" />
              </span>
              <div className="ht-trash__dialog-body">
                <h2 id="ht-trash-confirm-title" className="ht-trash__dialog-title">
                  {t('web.trash.confirm.title', { title: pending.title })}
                </h2>
                <p className="ht-trash__dialog-text">{t('web.trash.confirm.body')}</p>
              </div>
              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                aria-label={t('web.trash.confirm.cancel')}
                onClick={() => setConfirmingId(undefined)}
              >
                <X size={16} aria-hidden="true" />
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
                  // 确认框永远卡在屏幕上 —— 动作层的错误由调用方按需上报。
                  const id = pending.id;
                  setConfirmingId(undefined);
                  void purgeTask(id);
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
