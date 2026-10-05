/**
 * 任务行上的「整理」：清单归属 + 标签
 * ==========================================
 *
 * 🔴 **这个文件补的是 Web 端的一个真实空洞。**
 *
 * 在它之前，Web 能**建**清单和标签（`ProjectsPanel`），却**没法把它们挂到任务上**：
 * `TaskStore.moveToProject` 一直存在、`ProjectActions` 也一直在 ——
 * 但 `moveToProject` 在 Web 里**没有任何调用点**，`tagIds` 更是**全仓库零读写**。
 * 于是 Web 上的标签只能"建出来放在侧栏里看着"，一个都用不上。
 *
 * （移动端在上一轮补的正是同一件事。两端都缺，只是移动端先修的。）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 这一格里今天有三个导出，不是一个
 *
 * 工单 §8.147 把"整理"搬进详情列那一格，走的是这条线已经用了五次的形状
 * （备注 §8.138 / 重复 §8.141 / 子任务 §8.144 / 提醒 §8.145 / 截止 §8.146）：
 * **一份实现、两个落点**，宿主读同一枚 `taskPaneInColumn`。于是必须拆开——
 *
 * | 导出 | 是什么 | 画在哪 |
 * |---|---|---|
 * | `OrganizerField` | 编辑本体（清单下拉 + 标签复选框），**不带**展开机关与浮层外壳 | `TaskDetailCard`（栏里）**和** `TaskOrganizer`（行尾那支内） |
 * | `TagChips` | 只读显示（挂了哪几个标签） | `App.tsx` 行尾：宽档只剩它，窄档在 `TaskOrganizer` 里 |
 * | `TaskOrganizer` | `TagChips` + `<summary>` 触发器 + `<details>` + `.ht-material` 外壳，内嵌 `OrganizerField` | `App.tsx` 行尾，只在窄档 |
 *
 * 🔴 为什么**显示**留在行上、不像截止那样整块撤掉：截止那一格的显示今天另有其人
 * （共享 `TaskBadges` 的 `task-meta` 槽），而**标签在共享层没有对应槽**（见下面第 1 条决定），
 * 这一处 chip 就是它的唯一显示位 —— 撤掉就等于"列表里看不出哪条挂了标签"，
 * 那是 §8.138 那条不变量明确不许的（搬进栏里不能丢掉"扫一眼看得出"）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三个刻意的决定
 *
 * 1. **本控件只管"改"，不管"说"。**
 *    归属结果仍然**常驻可见**，但它现在由共享 `TaskBadges` 的那一槽说出
 *    （两端同一份实现）；标签 chip 留在本文件里，因为共享层没有标签徽章。
 *    原来"只放进展开面板"的顾虑没有变 —— 用户扫一眼列表必须**看得出**哪些任务
 *    已经归了类，那是整理的前提；变的是**由谁来说**。
 *    反过来，把 `<select>` 和一堆复选框直接铺在每一行上，列表就没法看了。
 *
 * 2. **用原生 `<select>` / `<input type="checkbox">`，不自造下拉。**
 *    原生控件自带键盘操作、读屏语义、移动端适配 —— 自造一个"看起来更漂亮"
 *    的下拉，等于把这些全部重做一遍，而且必然做得更差。
 *    这也让验收能用 `selectOption` / `check` 这些**真交互**，不必模拟坐标点击。
 *
 * 3. **一次交互 = 一条 op。** 标签是**整组**交给 `setTags`（契约见
 *    `packages/app-host/src/actions.ts`）：勾一个 = 算出新的一组 = 一条 op。
 *    不在这里"攒一批再提交" —— 那一屏的其它字段（优先级、完成）全是即点即写，
 *    多一种交互节奏只会让人不确定"到底存没存"。
 *
 * 🔴 本文件里**没有一行业务逻辑**：哪些算未删除、顺序是什么、空名字怎么办、
 * 悬空 tagId 要不要拦 —— 全部由 `@heyta/app-host` 决定。
 * 这里只做两件事：把用户想要的那一组算出来，然后交给 store。
 */

import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import type { Task } from '@heyta/domain';
import { SlidersHorizontal, Tag as TagIcon } from 'lucide-react';

import { selectChildProjects, selectTopLevelProjects, useProjectStore } from '../projects/store.js';

/** chip 与图标的统一尺寸。**不许在 JSX 里散落字面量。** */
const CHIP_ICON_SIZE = 12;
const TRIGGER_ICON_SIZE = 14;

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: cssVar('space.1'),
  padding: `${cssVar('space.1')} ${cssVar('space.2')}`,
  borderRadius: cssVar('radius.full'),
  fontSize: cssVar('font-size.xs'),
  color: cssVar('color.foreground-muted'),
  whiteSpace: 'nowrap',
};

/**
 * 只读显示：这条任务挂了哪几个标签。**两档都要画**（宽档行上只剩它）。
 *
 * ⚠️ `tagIds` 里可能有**查不到的 id**（标签在另一台设备上被删了，而这条 op
 * 还没同步过来）。`filter` 掉它们，而不是渲染一个名字为空的 chip ——
 * 后者看起来像界面坏了。数据仍然在 `tagIds` 里，等同步回来就会重新出现。
 */
export function TagChips({ task }: { task: Task }): React.JSX.Element | null {
  const projectState = useProjectStore();
  const assignedTags = projectState.tags.filter((tag) => task.tagIds?.includes(tag.id) ?? false);
  if (assignedTags.length === 0) return null;

  return (
    <>
      {assignedTags.map((tag) => (
        <span key={tag.id} style={chipStyle} data-testid="task-chip-tag">
          <TagIcon size={CHIP_ICON_SIZE} aria-hidden="true" />
          {tag.name}
        </span>
      ))}
    </>
  );
}

/**
 * 编辑本体：清单归属下拉 + 标签复选框。**不带 `<details>`，也不带 `.ht-material`** ——
 * 那两件是"这一格在哪儿画"的细节，属于行尾那一支。
 *
 * 🔴 它**自带两个区块头**（`<label>` 里那句「清单」与 `<fieldset>` 的 `<legend>`「标签」），
 * 所以宿主不许再叠 `<h3>`：两处同一个词说两遍，读到的是"有两个区块"
 * （§8.141 的 R4 与 §8.145 的 M2 钉的就是这一档）。
 * 🔴 它**全程零 `useState`**（两个控件都是受控于 store），所以搬进栏里**不需要** `key` ——
 * §8.145 那条纪律（"有本地 state 才要 key"）在这一格落在"不挂"那一侧，
 * 与截止那一格（`DatePicker` 带 `useState(month)` ⇒ **必须**挂）正好相反。
 */
export function OrganizerField({
  task,
  onMoveToProject,
  onSetTags,
}: {
  task: Task;
  /** 传 `undefined` 表示移出清单（收集箱）。 */
  onMoveToProject: (projectId: string | undefined) => void;
  /** 传**整组**。算"用户想要哪一组"是本组件的责任。 */
  onSetTags: (tagIds: string[]) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const projectState = useProjectStore();

  const tops = selectTopLevelProjects(projectState);

  /** 清单下拉的选项：顶层 + 其子清单（领域层只支持一层）。 */
  const projectOptions = tops.flatMap((top) => [
    { id: top.id, label: top.name },
    ...selectChildProjects(projectState, top.id).map((child) => ({
      id: child.id,
      // 缩进表示层级。用全角空格而不是 `padding` —— `<option>` 的 padding
      // 在各浏览器上表现不一致，而"子清单看起来和顶层一样"会让人选错。
      label: `　${child.name}`,
    })),
  ]);

  return (
    <>
      <label style={{ display: 'flex', flexDirection: 'column', gap: cssVar('space.1') }}>
        <span style={{ fontSize: cssVar('font-size.xs'), color: cssVar('color.foreground-muted') }}>
          {t('web.organize.projectLabel')}
        </span>
        <select
          // 与视觉标签**同名会撞**（读屏与验收都靠这个定位），
          // 所以 aria-label 带上任务标题做区分。
          aria-label={t('web.organize.projectSelect', { title: task.title })}
          data-testid="organize-project-select"
          value={task.projectId ?? ''}
          onChange={(event) => {
            const next = event.target.value;
            // 空字符串 = 「收集箱」。传 `undefined` 而不是 `''` ——
            // app-host 会把它写成 `null`（清除该字段）。
            onMoveToProject(next === '' ? undefined : next);
          }}
        >
          <option value="">{t('web.organize.inbox')}</option>
          {projectOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {projectState.tags.length === 0 ? (
        // 一个标签都没有时**说明去哪建**。留一片空白会让人以为这功能坏了。
        <p style={{ margin: 0, fontSize: cssVar('font-size.xs'), color: cssVar('color.foreground-subtle') }}>
          {t('web.organize.noTags')}
        </p>
      ) : (
        <fieldset
          style={{
            margin: 0,
            padding: 0,
            border: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: cssVar('space.1'),
          }}
        >
          <legend
            style={{
              padding: 0,
              fontSize: cssVar('font-size.xs'),
              color: cssVar('color.foreground-muted'),
            }}
          >
            {t('web.organize.tagsLegend')}
          </legend>
          {projectState.tags.map((tag) => {
            const checked = task.tagIds?.includes(tag.id) ?? false;
            return (
              <label
                key={tag.id}
                style={{ display: 'flex', alignItems: 'center', gap: cssVar('space.2') }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  aria-label={t('web.organize.tagToggle', { name: tag.name, title: task.title })}
                  onChange={() => {
                    const current = task.tagIds ?? [];
                    // 去重与"空数组写 null"由 `app-host` 的 `setTags` 决定。
                    onSetTags(
                      checked
                        ? current.filter((id) => id !== tag.id)
                        : [...current, tag.id],
                    );
                  }}
                />
                {tag.name}
              </label>
            );
          })}
        </fieldset>
      )}
    </>
  );
}

/**
 * 行尾那一整块：只读 chip + 展开机关 + 玻璃浮层，浮层里装的是 `OrganizerField`。
 *
 * ⚠️ 工单 §8.147 起宿主**只在窄档**挂它（`taskPaneInColumn` 为假）——
 * 宽档行上只剩 `TagChips`，编辑本体住在详情列那一格。
 */
export function TaskOrganizer({
  task,
  onMoveToProject,
  onSetTags,
}: {
  task: Task;
  /** 传 `undefined` 表示移出清单（收集箱）。 */
  onMoveToProject: (projectId: string | undefined) => void;
  /** 传**整组**。算"用户想要哪一组"是本组件的责任。 */
  onSetTags: (tagIds: string[]) => void;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: cssVar('space.2'),
        position: 'relative',
      }}
    >
      {/*
        🔴 这里**不再显示清单归属** —— 归属由共享 `TaskBadges` 的那一槽负责
        （两端同一份）。此前它在这里也画一枚 chip，于是归属进了元信息槽之后
        **同一行里出现两遍清单名**。抽取的收尾动作是删掉旧的那份（AGENTS §3.5）。
        标签 chip 留下：共享层没有标签徽章，这里就是它的唯一显示位。
      */}
      <TagChips task={task} />

      <details>
        {/*
          🔴 无障碍名必须带上**是哪一条任务**：读屏用户在一长串列表里听到
          二十个「整理」而无从分辨要给哪个任务归类。
        */}
        <summary
          aria-label={t('web.organize.summary', { title: task.title })}
          /*
            🔴 `data-testid` 不是可有可无的：任务行上**不止一个** `<details>` ——
            后来「备注」也加了一个。此前 e2e 用 `row.locator('summary')` 这种
            **结构选择器**，第二个 disclosure 一出现就变成 strict-mode violation，
            而失败信息指向的是断言，不是"你加了个并列元素"。
            给它一个稳定的钩子，测试就不再依赖"这一行里有几个 summary"。
          */
          data-testid="task-organize-summary"
        >
          <SlidersHorizontal size={TRIGGER_ICON_SIZE} aria-hidden="true" />
        </summary>

        <div
          className="ht-material"
          style={{
            position: 'absolute',
            // 浮层层级来自设计系统的 z 刻度。
            // ⚠️ 这里原本写的是 `zIndex: 1` —— 一个裸数字，被 `check:design` 拦下了。
            // 裸 z-index 的问题是它**只在当前这个组件里看着对**：旁边任何一处
            // 用了更高层级的东西都会盖住它，而那种 bug 只在特定滚动位置才出现。
            zIndex: cssVar('z.popover'),
            insetInlineEnd: 0,
            marginBlockStart: cssVar('space.2'),
            padding: cssVar('space.3'),
            display: 'flex',
            flexDirection: 'column',
            gap: cssVar('space.3'),
            border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
            borderRadius: cssVar('radius.lg'),
            boxShadow: cssVar('shadow.lg'),
          }}
        >
          <OrganizerField
            task={task}
            onMoveToProject={onMoveToProject}
            onSetTags={onSetTags}
          />
        </div>
      </details>
    </span>
  );
}
