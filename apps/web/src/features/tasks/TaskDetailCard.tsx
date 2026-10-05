/**
 * 任务面单 —— 选中某条任务时，那一格里画的东西（工单 §8.138）
 * ==========================================================
 *
 * 这一格是"详情面本体"那一单（§8.125 第 3 节 DoD）的**任务那一格**，
 * 也是 §8.130 记下的那道二选一（"行内展开编辑 vs 栏里编辑"）落地的一半。
 *
 * 🔴 裁决是**栏里编辑**。三条理由，按承重排：
 *   ① 拍板 #1 已经说过"选中某条 = 同一格换成该实体面单"，而任务是本应用的**主对象** ——
 *      那一格对别的实体都换了、只对任务空着，等于这条裁决在它最该成立的地方不成立。
 *   ② 滴答的取证（调研 A3 状态二）：选中一条 ⇒ 第四栏换成详情面，里面是
 *      **大号标题 + 备注全文 + 子任务/提醒/标签区块 + 所属清单**；Todoist 的一手句子是
 *      "click a task to open the task view"。行内展开是**没有目的地**那一档的做法。
 *   ③ 行尾那一坨常驻控件实测要 **517px**（1440 视口下整行的 48%，见 `App.tsx`
 *      `renderTaskTrailing` 那段注释与台账 G9）—— 把字段往栏里搬，行的宽度问题才真的解决。
 *
 * 🔴 所以本文件遵守的不变量是：**每个字段任何时刻只有一个编辑器所有者**。
 * 已搬进来的是**备注**（`NoteField`，§8.138）、**重复**（`RepeatField`，§8.141）、
 * **子任务**（`SubtaskField`，§8.144）与**提醒**（`ReminderField`，§8.145）：
 * 每一单的同一笔提交里都要把行尾那半撤掉（`App.tsx` 的 `taskPaneInColumn` 反向条件），
 * 所以不存在"同一字段两处可编辑"的那个中间态；列表侧留下的分别是**只读徽标** `NoteBadge`、
 * **只读徽标** `RepeatChip`、**只读徽标** `SubtaskBadge` 与**只读徽标** `ReminderBadge`（"扫一眼要能看出哪条任务写过 /
 * 是重复的 / 挂在谁下面 / 挂了几条提醒"这一档不因为搬进栏里就丢掉）。
 * ⚠️ 这一条是**分阶段**的，不是"这一单顺手做完"：其余字段（清单标签 / 截止 / AI）
 * 仍住在行尾，登记成后续单，每一单都要重做"搬进来 + 行里撤掉"这两半，不许只搬一半。
 * 🔴 截止那一栏特别注明：`check:row-single-source` 的断言 A 要求"复选框 + 标题 + 截止"三种信号
 * 同时出现在任务行里，所以截止的**显示**必须留在行上，能搬的只有它的**编辑入口**。
 *
 * ⚠️ 为什么这里**没有**未选中时的空态句子：沿用便签那一格的先例（§8.130 —— 未选中时那一格
 * 什么都不放）。习惯那一格放一句"选一条习惯…"是因为那块板子必须始终挂载
 * （`motivation.spec` 的白屏检测前提），任务这一格没有同样的约束。
 *
 * 🔴 未选中 / 那条已在别处被删 ⇒ 返回 `null`，而不是留一只指向不存在 id 的输入框。
 */
import type { CSSProperties } from 'react';
import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';

import { useSelected } from '../../lib/selection.js';
import { text } from '../../lib/text.js';
import { NoteField } from './NoteEditor.js';
import { RepeatField } from './TaskRepeat.js';
import { SubtaskField } from './SubtaskPicker.js';
import { ReminderField } from '../reminders/ReminderPanel.js';
import { useTaskStore } from './store.js';

/*
  这个是**模块级常量**而不是 `style={{…}}` 字面量：后者会被
  `scripts/check-l4-no-style.mjs` 按出现次数计进棘轮（web 上限 104，余量 6）。
  文字档位整条从 `TEXT_STYLES` 取（AGENTS §5：不许只挑字号）。
  本单**不新起 `ht-*` 族** —— `check:row-single-source` 的那枚棘轮余量为 0（28 = 基线 28），
  所以栏内边距走既有的 `.ht-app__detail-task`、标题走既有的 `.ht-app__detail-heading`。
*/
const blockLabelStyle: CSSProperties = {
  ...text('group-label'),
  color: cssVar('color.foreground-muted'),
  marginTop: cssVar('space.3'),
  marginBottom: cssVar('space.1'),
};

/**
 * 详情列里的任务面单。
 *
 * 🔴 它**只**在详情列画（`App.tsx` 那一支要求 `detailColumnShown`），所以这里没有
 * `inset` 参数：便签与习惯那两个生产者有第二落点（板子/列表旁边），因此"哪一支带内边距"
 * 必须显式说清；这一格的窄档回落**住在行尾**（那颗 chip），不是同一只卡片的第二个落点。
 * 内边距由 `.ht-app__detail-task` 给（挂在既有 `.ht-app` 族下，理由见上面棘轮那段）。
 */
export function TaskDetailCard(): React.JSX.Element | null {
  const { t } = useI18n();
  const store = useTaskStore();

  /**
   * 这一栏展开的那一条 = **共享选中态**，不是又一个本地状态，也没有本地回落。
   *
   * 🔴 存 id 不存对象：`entities.tasks` 每次 op 后都是新表，握住对象会让面单显示一份
   * 过期的标题 / 备注。渲染时从表里现取。
   */
  const selectedId = useSelected('task');
  const picked = selectedId === null ? undefined : store.entities.tasks[selectedId];
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
  if (task === undefined) return null;

  return (
    <div className="ht-app__detail-task" data-testid="task-pane">
      {/*
        标题是**用户自己的字**，原样呈现、不翻译（与行内那颗 chip 的预览同一个口径）。
        ⚠️ 这一行刻意只有标题，没有复选框也没有截止 —— `check:row-single-source` 的断言 A
        认的"任务行"是三种信号同时出现在同一棵子树里，这一格是**面单**不是第二份行实现。
      */}
      {/* `overflow-wrap` 在 `.ht-app__detail-task` 上给（它是可继承属性），
          所以这里不需要行内样式 —— 22rem 的一栏里一个长英文单词不许把栏撑破。 */}
      <h2 className="ht-app__detail-heading">{task.title}</h2>

      {/*
        区块头复用词条表里已有的那一句「备注」：占位符复用 composer 那句是同一个理由
        （两处问的是同一件事，各起一条词条迟早漂成两种说法）。
      */}
      <h3 style={blockLabelStyle}>{t('web.note.toggle')}</h3>

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
        重复。🔴 它**自带**区块头（编辑本体的 `<legend>` 就是那一句「重复规则」），
        所以这里不再叠一枚 `h3` —— 两处同一个词说两遍，读到的是"有两个区块"。
        这一格里也**没有浮层外壳**：`.ht-material` 与 `position: absolute` 属于行尾那一支
        （"这一格在哪儿画"的细节），栏里要的只是控件本身。
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
      />

      {/*
        提醒（§8.145）。与重复那一格同一条理由，这里**不叠 `h3`**：共享的 `ReminderList`
        自带区块头（`labels.title` 渲染成 `accessibilityRole="header"`，见
        `packages/ui/src/reminders/ReminderList.tsx`），两处同一个词说两遍，读到的是"有两个区块"。
        行尾那一支的玻璃浮层外壳（`.ht-compose-panel ht-material`）也**不跟着本体进栏** ——
        一栏里漂一块 `position: absolute` 的板子，用户读到的是"这格里浮着不属于这格的东西"
        （§8.141 的 R4 钉的就是这一档）。
        ⚠️ 这里**没有** `key`，而且不是漏掉：上面三格都要 key 是因为它们各自带**本地草稿 state**
        （非受控框 / 拒绝提示 / RRULE 草稿），而 `ReminderField` 与 `ReminderList` 全程只有
        `useMemo`、零 `useState`（提醒列表来自 store，按 `task.id` 取）。↑↓ 换选中时它没有
        上一条的状态可带 —— "搬进栏里就要加 key"不是这条纪律，**有本地 state 才是**。
      */}
      <ReminderField task={task} />
    </div>
  );
}
