/**
 * 任务行上的「子任务」控件
 * ==========================
 *
 * ## 🔴 这个文件补的是 Web 端的**第二个**真实空洞（第一个是 `TaskOrganizer`）
 *
 * 在它之前：`packages/domain/src/subtasks.ts`（616 行）**已经写好**了建树、环防护、
 * 深度与子数上限；`packages/app-host` 的 `setParent` 也已经写好（写前调
 * `validateParentChange`，失败即 throw）。**但 Web 上一次调用点都没有** ——
 * `grep -rn 'setParent' apps/web/src` 是空的。
 *
 * ⇒ 症状是"模型支持、树能建、**用户没有任何办法把一个任务变成子任务**"，
 * 而且**不报错**，只是这个功能不存在。这正是方案 §5.5 说的"看起来有其实没有"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三个刻意的决定
 *
 * 1. **候选只列"移过去合法"的那些。** 判据用领域层的 `canSetParent` ——
 *    **不在这里自己算"是不是后代"**：那是产品语义，四端必须给出一模一样的答案
 *    （`packages/domain/src/subtasks.ts` 的文件头就是为这一条写的）。
 *    这样列表里**根本选不到**会造成环/超深的项，而不是让用户选完再报错。
 *
 * 2. **报错仍然要接住并翻成人话。** 候选是预过滤的，但预过滤与真正写入之间
 *    仍可能被别的设备改掉（跨端同步），所以 `setParent` 的 throw **必须**有落点。
 *    翻译走 `@heyta/ui` 的 `subtaskRejectionMessageKey`（唯一一份），
 *    与认证的 `common.auth.error.*` 同一个形状。
 *
 * 3. **用原生 `<select>`，不自造下拉。** 与 `TaskOrganizer` 同一条理由：
 *    原生控件自带键盘操作、读屏语义、移动端适配；也让验收能用 `selectOption`
 *    这种**真交互**，不必模拟坐标点击。
 *
 * 🔴 本文件里**没有一行业务逻辑**：谁是谁的后代、多深算超深、上限是多少 ——
 * 全在 `@heyta/app-host` 与 `@heyta/domain`。这里只做两件事：
 * 把合法的候选取出来、把结果（或拒绝原因）交给用户。
 */

import type { Task } from '@heyta/domain';
import { canSetParent } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { rejectionReasonOf, subtaskRejectionMessageKey } from '@heyta/ui';
import { CornerDownRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useTaskStore } from './store.js';

/** 图标统一尺寸。**不许在 JSX 里散落字面量。** */
const CHIP_ICON_SIZE = 12;

export function SubtaskPicker({
  task,
  onSetParent,
}: {
  task: Task;
  /** 传 `undefined` = 提为顶级。**失败时会被调用方 reject**（原因见 `@heyta/ui` 的映射）。 */
  onSetParent: (parentId: string | undefined) => Promise<void>;
}): React.JSX.Element {
  const { t } = useI18n();
  const entities = useTaskStore((s) => s.entities);
  const [errorKey, setErrorKey] = useState<string | undefined>(undefined);

  const allTasks = useMemo(() => Object.values(entities.tasks), [entities.tasks]);

  /**
   * 可以当父的任务。
   *
   * 🔴 **预过滤用 `canSetParent`（领域层），不是 `id !== task.id` 这种土办法** ——
   * 后者会漏掉"后代"这一整类（把任务挂到它自己的孙子下面 = 环）。
   */
  const candidates = useMemo(
    () =>
      allTasks
        .filter((t2) => t2.deletedAt === undefined)
        .filter((t2) => canSetParent(allTasks, task.id, t2.id))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [allTasks, task.id],
  );

  const currentParent = task.parentId === undefined ? undefined : entities.tasks[task.parentId];

  const onPick = (value: string): void => {
    const parentId = value === '' ? undefined : value;
    setErrorKey(undefined);
    onSetParent(parentId).catch((cause: unknown) => {
      // 🔴 **把拒绝原因翻成人话再显示**，不渲染 `cause.message`：
      // 那是给开发者的诊断串（`改父被拒绝（cycle）：a → b`），
      // 里面有原始 id。与认证那条"message 是诊断数据、不许直接给用户看"同一个纪律。
      setErrorKey(subtaskRejectionMessageKey(rejectionReasonOf(cause)));
    });
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--ht-space-1)' }}>
      <details style={{ display: 'inline-block' }}>
        <summary
          className={currentParent === undefined ? 'ht-chip' : 'ht-chip ht-chip--on'}
          style={{ listStyle: 'none' }}
          data-testid={`subtask-trigger-${task.id}`}
          aria-label={t('web.subtask.trigger.aria', { title: task.title })}
        >
          <CornerDownRight size={CHIP_ICON_SIZE} aria-hidden="true" />
          {/* 归属**常驻可见**：只放进展开面板的话，用户扫一眼列表看不出
              哪些任务是子任务 —— 而"看清现状"正是整理的前提。 */}
          <span>
            {currentParent === undefined
              ? t('web.subtask.none')
              : t('web.subtask.under', { title: currentParent.title })}
          </span>
        </summary>

        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--ht-space-1)',
            fontSize: 'var(--ht-font-size-2xs)',
            color: 'var(--ht-color-foreground-muted)',
          }}
        >
          {t('web.subtask.pick.label')}
          <select
            data-testid={`subtask-select-${task.id}`}
            aria-label={t('web.subtask.pick.aria', { title: task.title })}
            value={task.parentId ?? ''}
            onChange={(e) => {
              onPick(e.target.value);
            }}
            style={{
              minHeight: 'var(--ht-touch-target-min)',
              padding: '0 var(--ht-space-2)',
              borderRadius: 'var(--ht-radius-md)',
              border: 'var(--ht-border-width-thin) solid var(--ht-color-border)',
              background: 'var(--ht-color-background)',
              color: 'var(--ht-color-foreground)',
              fontSize: 'var(--ht-font-size-base)',
            }}
          >
            <option value="">{t('web.subtask.option.topLevel')}</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
          </select>
        </label>
      </details>

      {errorKey === undefined ? null : (
        <span
          role="alert"
          data-testid={`subtask-error-${task.id}`}
          style={{ color: 'var(--ht-color-danger)', fontSize: 'var(--ht-font-size-2xs)' }}
        >
          {t(errorKey as Parameters<typeof t>[0])}
        </span>
      )}
    </span>
  );
}