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
 * **子任务**（`SubtaskField`，§8.144）、**提醒**（`ReminderField`，§8.145）、
 * **截止**（`DueField`，§8.146）与**清单 + 标签**（`OrganizerField`，§8.147）：
 * 每一单的同一笔提交里都要把行尾那半撤掉（`App.tsx` 的 `taskPaneInColumn` 反向条件），
 * 所以不存在"同一字段两处可编辑"的那个中间态；列表侧留下的分别是**只读徽标** `NoteBadge`、
 * **只读徽标** `RepeatChip`、**只读徽标** `SubtaskBadge` 与**只读徽标** `ReminderBadge`（"扫一眼要能看出哪条任务写过 /
 * 是重复的 / 挂在谁下面 / 挂了几条提醒"这一档不因为搬进栏里就丢掉），
 * 以及**只读 chip** `TagChips` —— 标签那一档留的是 chip 而不是"整块不画"，因为
 * **标签在共享层没有对应槽**（截止有 `task-meta`，标签没有），撤掉就等于列表里看不出哪条挂了标签。
 * ⚠️ 这一条是**分阶段**的，不是"这一单顺手做完"：其余字段（AI）
 * 仍住在行尾，登记成后续单，每一单都要重做"搬进来 + 行里撤掉"这两半，不许只搬一半。
 *
 * 另有一族**不是"从行尾搬进来"、而是此前根本没有手动入口**的字段也住在这里：
 * **标题改名**（`TitleField`，W7 —— `app-host` 的 `rename` 在 Web 上零调用点）与
 * **手动优先级**（原生 select，W7 —— `setPriority` 此前只有 AI 批量写入一个调用方）。
 * 它们在行尾没有"那半"要撤：行上从来没有过标题编辑器，优先级在行上也只有只读徽标。
 * 🔴 截止那一格特别记一笔：`check:row-single-source` 的断言 A 要求"复选框 + 标题 + 截止"三种信号
 * 同时出现在任务行里，所以截止的**显示**必须留在行上 —— 这一条**不是靠本文件满足的**：
 * 行上的显示早就在共享元信息条里（`task-meta` → `TaskBadges.due`），而原先行尾那颗触发器
 * 是它的**第二份**显示，所以这一格搬走时不留徽标（现量与理由在 `DueEditor.tsx` 文件头）。
 *
 * 🔴 **四分组（W6，审计 §4.6「详情列功能太全、层级不够」）**：此前七格字段是一条
 * 纵向平铺（备注 → 子任务 → 清单标签 → 重复 → 截止 → 优先级 → 提醒），层级只靠
 * 各自的区块头撑。现在固定四组、每组装一枚**分组头**，组内才是字段：
 *
 *   1. **基本信息**：标题（`TitleField`）、备注（`NoteField`）
 *   2. **时间**：截止（`DueField`）、提醒（`ReminderField`）
 *   3. **组织**：清单 + 标签（`OrganizerField`）、子任务（`SubtaskField`）、优先级（select）
 *   4. **自动化**：重复（`RepeatField`，其自定义 RRULE 已收进「高级」折叠，见该文件头第 4 条）
 *
 * 🔴 **优先级归「组织」而不是「时间」**（W7 原落点在截止与提醒之间）：优先级不是
 * 时间量 —— 它与"何时发生"无关；它是"这条任务在系统里怎么归置"的维度（四象限
 * 视图正是 优先级 × 截止 的投影，与清单/标签同属归置属性）。放进「时间」组是
 * 按旧 DOM 相邻硬凑的语义。AI 拆解/估时目前**没有**详情列入口（AI 仍住在行尾
 * 输入区），「自动化」组暂只有重复一格 —— 空组不画，组本身保留。
 *
 * ⚠️ 分组是**纯排布**：不新增字段、不改任何一格的提交语义/keys/接线 ——
 * W7 的改名与优先级两格原样纳入（只挪住址，见工单 W6 的前置认知）。
 *
 * ⚠️ 为什么这里**没有**未选中时的空态句子：沿用便签那一格的先例（§8.130 —— 未选中时那一格
 * 什么都不放）。习惯那一格放一句"选一条习惯…"是因为那块板子必须始终挂载
 * （`motivation.spec` 的白屏检测前提），任务这一格没有同样的约束。
 *
 * 🔴 未选中 / 那条已在别处被删 ⇒ 返回 `null`，而不是留一只指向不存在 id 的输入框。
 */
import { useRef, useState, type CSSProperties } from 'react';
import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { Priority, type Task } from '@heyta/domain';

import { useSelected } from '../../lib/selection.js';
import { text } from '../../lib/text.js';
import { NoteField } from './NoteEditor.js';
import { RepeatField } from './TaskRepeat.js';
import { SubtaskField } from './SubtaskPicker.js';
import { DueField } from './DueEditor.js';
import { OrganizerField } from './TaskOrganizer.js';
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

/*
 * 四分组的**分组头**（W6，审计 §4.6）。与 `blockLabelStyle` 同一条理由：模块级常量，
 * 不给 `check-l4-no-style` 的棘轮加数。
 *
 * 🔴 档位取 `headline`（base + semibold，AGENTS §5 文字层级表里"子块/卡片标题"
 * 那一档 —— 设置面板的 `.ht-settings__h3` 就是这一档）。两个刻意不取的邻居：
 *   - **不取 `section-title`（lg + semibold）**：面单那只 h2 标题就是 lg，
 *     四枚分组头若同为 lg，标题就失去了统领层级（一屏里五个同号标题 = 没有标题）；
 *   - **不取 `group-label`（sm + muted，即下面字段标签那一档）**：分组头与
 *     字段标签同档同色，四组与七枚字段标签就混成一层 —— 分组等于没分。
 * 于是面单内是三层：标题（lg）→ 分组头（base + semibold，前景色）→
 * 字段标签（sm + semibold，muted）。分组间距走 `space.4`（比字段标签的
 * `space.3` 大一档，"组间 > 组内"用间距说出来）。
 */
const groupHeaderStyle: CSSProperties = {
  ...text('headline'),
  color: cssVar('color.foreground'),
  marginTop: cssVar('space.4'),
  marginBottom: cssVar('space.2'),
};

/*
  标题改名那一格的两枚样式。与 `blockLabelStyle` 同一条理由：模块级常量，
  不给 `check-l4-no-style` 的棘轮加数。共同前提：字号/字重/行高/文字色全部来自
  `.ht-app__detail-heading`（class 选择器压得过 `reset.css` 的 `input` 元素选择器），
  这里只补"像一只标题、不像一只表单框"的那几件事。
*/
/** 待机态（那只 `<h2>`）：光标呈文本状，是"点它可以改"的入口暗示。 */
const titleIdleStyle: CSSProperties = {
  cursor: 'text',
};

/**
 * 编辑态（接替 h2 的那只输入框）：剥掉输入框默认的边框/底色/内边距，
 * 让它接在那只 h2 原来的位置上 —— 外观仍是标题层级，编辑的是标题本身。
 * 🔴 刻意**不动 `outline`**（AGENTS §5）：焦点环是编辑态唯一的视觉信号，
 * 抹掉它就是那条"最常见的可访问性回归"。
 */
const titleInputStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  margin: 0,
  width: '100%',
};

/**
 * 标题那一格（W7）：默认仍是那只**只读** `<h2>`，点它（或聚焦后按 Enter）进入改名。
 *
 * 🔴 为什么是"点进去改"而不是常驻输入框：这一格的既有判据认的是"pane 里有一只
 * `h2`、文本就是标题"（`tests/task-detail-card.spec.tsx` 与 e2e 的
 * `detail-pane-task.spec.ts` 都在读它），把 h2 换成常驻输入框会把那些判据全打断，
 * 而"点开才改"在桌面对照（滴答/Todoist 的详情面）里也是标题改名的常态形态。
 *
 * 提交纪律与 `NoteField` 同一条（一个用户意图 = 一条 op）：
 * **失焦或 Enter 才提交**，Esc 还原；trim 后为空或没变**不发 op** ——
 * 动作层的校验（空标题 throw、找不到任务 throw）不在这一层复判（见 store 的
 * `renameTask`）。零业务逻辑：这里只把用户打的字读出来交给 store。
 *
 * 🔴 编辑会话**锚在 `task.id` 上，而不是给本组件挂 `key={task.id}` 重挂**。
 * 两个理由：
 *   ① 语义上"换选中 = 退场"用一枚 id 锚就能表达（`editingFor !== task.id` ⇒ 待机态），
 *      上一条没提交的草稿天然不跟着人走 —— 不需要靠卸载整个组件来重置。
 *   ② 实测 React 19.3（jsdom/`act` 环境）对 pane **首位**子元素的 keyed 重挂会
 *      **留下旧节点**：换选中后 DOM 里**两只 h2 并存**（旧的甲在前），既有判据
 *      `querySelector('h2')` 读到的是旧的那只。同形状的 key 在其余几位（备注 /
 *      子任务 / 重复 / 截止）没踩到，唯独首位踩到 —— 不追根因到 React 内部，
 *      换一条不依赖"keyed 重挂"的写法，行为两样全保（复现见
 *      `tests/task-detail-edit.spec.tsx` 的"换选中"一族）。
 */
function TitleField({ task, onRename }: { task: Task; onRename: (title: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  /** 正在改名的是哪一条（`null` = 待机态）。换人 ⇒ 会话作废，见下。 */
  const [editingFor, setEditingFor] = useState<string | null>(null);
  /**
   * 一次编辑会话只提交一次。Enter 提交后输入框随即卸载，个别环境仍会对它补一发
   * `focusout` —— 没有这道闸，同一次改名会走两遍 `commit`，写出两条 op。
   */
  const settled = useRef(false);

  // 换了人 ⇒ 上一场会话作废（渲染期派生重置，React 认可的"props 变了调 state"形态；
  // 不用 effect 兜底 —— 那会先画一帧"上一条的编辑态"再消失）。
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
    // 空或没变都不发 op："点开又点走"不该给任务白写一条标题 op（与 NoteField 同一条）。
    if (trimmed === '' || trimmed === task.title) return;
    onRename(trimmed);
  };

  if (!editing) {
    return (
      <h2
        className="ht-app__detail-heading"
        data-testid="task-detail-title"
        style={titleIdleStyle}
        // 键盘也能进改名（读屏/纯键盘用户与鼠标点击是同一件事）。
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
      // 非受控 + autoFocus：提交时机（失焦/Enter）与打字的重渲染本就不该绑在一起
      // （NoteField 文件头第 2/4 条）。
      autoFocus
      defaultValue={task.title}
      onBlur={(event) => {
        commit(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          // `currentTarget` 而不是 `target`：React 的 KeyboardEvent 没把 target
          // 收窄成元素（FocusEvent/ChangeEvent 才有），只有 currentTarget 是带类型的。
          commit(event.currentTarget.value);
        } else if (event.key === 'Escape') {
          // 还原：退出编辑、不发 op（后续若还补来 focusout，被 `settled` 闸挡下）。
          end();
        }
      }}
    />
  );
}

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
        标题（W7 起可改）。内容仍是**用户自己的字**，原样呈现、不翻译（与行内那颗
        chip 的预览同一个口径）；改名走 `store.renameTask` → `app-host` 的 `rename`
        —— 那条路此前在 Web 上**零调用点**，这是补上的第一只手动入口。
        ⚠️ 待机态这一块刻意只有标题，没有复选框也没有截止 —— `check:row-single-source`
        的断言 A 认的"任务行"是三种信号同时出现在同一棵子树里，这一格是**面单**不是第二份行实现。
        🔴 W6 起它是面单的统领元素、**不属于任何一组**：四枚分组头排在它下面
        （同取 lg 会让标题失去层级，见 `groupHeaderStyle` 那段注释）。
      */}
      {/* `overflow-wrap` 在 `.ht-app__detail-task` 上给（它是可继承属性），
          所以这里不需要行内样式 —— 22rem 的一栏里一个长英文单词不许把栏撑破。 */}
      <TitleField
        task={task}
        onRename={(title) => {
          void store.renameTask(task.id, title);
        }}
      />

      {/* ══ 分组一：基本信息（W6，审计 §4.6）═══════════════════════════ */}
      <h3 style={groupHeaderStyle} data-testid="task-detail-group">
        {t('web.tasks.detail.section.basic')}
      </h3>

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
      />
    </div>
  );
}
