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
 * 4. 🔴 **编辑本体单独导出成 `SubtaskField`（工单 §8.144）** —— 这一栏现在有两个落点：
 *    详情列画着的时候它住在 `TaskDetailCard` 那一格，行尾只剩一枚**只读徽标** `SubtaskBadge`；
 *    详情列不画（窄档）时整块退回这颗 chip 的 `<details>` 里。两处共用同一份写入语义，
 *    与备注（`NoteField` / `NoteBadge`，§8.138）、重复（`RepeatField` / `RepeatChip`，§8.141）
 *    同一形状 —— 不变量是**每个字段任何时刻只有一个编辑器所有者**。
 *    ⚠️ 这一笔带来的**唯一**行为差别：拒绝提示原来挂在 `<details>` **外面**（收起面板也看得见），
 *    现在挂在 `<select>` **下面**。非法项在界面上根本选不出来（候选是预过滤的），
 *    唯一到达路径是"预过滤之后、写入之前被别的设备改掉"那个跨端竞态 ⇒ 登记在工单 §8.144 边界，
 *    不写成"没有变化"。
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

export function SubtaskField({
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
    <>
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

      {errorKey === undefined ? null : (
        <span
          role="alert"
          data-testid={`subtask-error-${task.id}`}
          style={{ color: 'var(--ht-color-danger)', fontSize: 'var(--ht-font-size-2xs)' }}
        >
          {t(errorKey as Parameters<typeof t>[0])}
        </span>
      )}
    </>
  );
}

/**
 * 行尾那枚**只读徽标** —— 编辑本体搬进栏里之后，列表还要看得出"这一条挂在谁下面"。
 *
 * 🔴 它刻意不是第二份编辑器：没有 `<details>`、没有 `<select>`、没有 `onPress`。
 * 与 `NoteBadge`（§8.138）、`RepeatChip`（§8.141）同一档职责。
 * ⚠️ 没父任务时**不占位**（拍板 #8 的 `record` 那一档）：顶级任务是默认态，
 * 给每一行挂一枚「子任务」空壳等于把列表变成一列噪声。
 */
export function SubtaskBadge({ task }: { task: Task }): React.JSX.Element | null {
  const { t } = useI18n();
  const parentId = task.parentId;
  /**
   * 🔴 取值走 store，不把 `entities` 当参数传进来：徽标住在行尾插槽里，
   * 那里每行只拿得到 `task`。而"父是谁"必须**现取**（父标题可能被别的设备改掉），
   * 握住一条快照就是第二份状态。
   */
  const parent = useTaskStore((s) => (parentId === undefined ? undefined : s.entities.tasks[parentId]));
  if (parent === undefined) return null;
  return (
    <span className="ht-chip ht-chip--on" data-testid={`task-subtask-badge-${task.id}`}>
      <CornerDownRight size={CHIP_ICON_SIZE} aria-hidden="true" />
      <span>{t('web.subtask.under', { title: parent.title })}</span>
    </span>
  );
}

/**
 * 行尾那一颗**子任务 chip**：详情列没在画的时候，编辑本体就住在这它的 `<details>` 里。
 *
 * ⚠️ 与 `NoteEditor` / `TaskRepeat` 同一条：现在由 `App.tsx` 的 `taskPaneInColumn`
 * **条件挂载**，栏里画着的时候这里整个不渲染 ⇒ 同一时刻 DOM 里只有一只 `<select>`。
 */
export function SubtaskPicker({
  task,
  onSetParent,
}: {
  task: Task;
  onSetParent: (parentId: string | undefined) => Promise<void>;
}): React.JSX.Element {
  const { t } = useI18n();
  const entities = useTaskStore((s) => s.entities);
  const currentParent = task.parentId === undefined ? undefined : entities.tasks[task.parentId];

  return (
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

      {/* 候选、写入、拒绝提示那一整块是 `SubtaskField`：与栏里那一支同一份实现。 */}
      <SubtaskField task={task} onSetParent={onSetParent} />
    </details>
  );
}