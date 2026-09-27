/**
 * 任务屏（4 个 tab 的第一个，也是默认落点）
 * ==========================================
 *
 * 产品决策：**默认落在"今天"**，而不是一个扁平列表。
 * 理由：这个产品的核心问题是"今天该干什么"。扁平列表把"今天"这个最重要的
 * 筛选交给用户每次自己找，等于没有默认。
 *
 * 分组顺序按**紧急程度**，不按创建时间：
 *   1. 已过期  —— 最需要被看见的（用 danger 色）
 *   2. 今天
 *   3. 收集箱  —— 没有日期的，还没安排
 *   4. 已完成  —— 收在最后，默认不展开
 *
 * 🔴 这个文件里**没有一行业务逻辑**（AGENTS.md §3.5）：
 * 新建任务写哪些字段、切换完成发什么 op、删除是软删还是硬删 ——
 * 全部来自 `@heyta/app-host` 的 `createTaskActions`。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import type { Project, Tag, Task } from '@heyta/domain';
// `formatDayTitleText` 在壳里把领域层给的 `LocalDate` 说成当前语言：
// **"某一天的标题"的日期语义（`isoWeekday`、`parseLocalDate`）仍只有领域层一份**，
// 壳里只负责措辞（见 `apps/mobile/src/lib/date.ts` 文件头）。
import {
  Priority,
  Quadrant,
  bucketByQuadrant,
  startOfDay,
  toLocalDate,
} from '@heyta/domain';
import { useI18n, type MessageKey } from '@heyta/i18n';
import {
  createProjectActions,
  createTaskActions,
  type AppHost,
  type ProjectActions,
  type TaskActions,
} from '@heyta/app-host';
import { useToday } from '../lib/use-today';
import { formatDayTitleText } from '../lib/date';
import { describeRecurrenceText } from '../lib/recurrence-display';
import { useText, useTheme, useTokens } from '../theme';
import {
  Button,
  EmptyState,
  Fab,
  IconButton,
  Chip,
  Screen,
  SectionHeader,
  Text,
} from '../ui/kit';
import { Icon, type IconName } from '../ui/icons';
/**
 * 🔴 任务行的**机制**现在来自共享层（M1-4）。
 *
 * 以前这个文件里有一个 150 行的本地 `TaskRow`：勾选框、标题、截止/优先级/重复
 * 三个徽章、删除按钮、无障碍名，全部自己写。web 端另有一套。
 *
 * 现在分成两半：
 *   - **机制**（排序、行骨架、44 触控区补偿、checkbox 的 role/state/busy、
 *     空组跳过、分节展平）→ `@heyta/ui`，四个端同一份。
 *   - **内容**（文案、优先级色槽、图标名）→ 仍在本文件，因为这些**本来就不同**：
 *     共享包不能 import `@heyta/i18n`（它会带进第二份 React，APK 启动即崩）。
 *
 * 图标本身通过 `TaskBadges` 共享 —— 字形数据来自框架无关的 `lucide`，
 * 由共享层用自己的 `react-native-svg` 渲染，所以四个端的字形不可能再漂移。
 */
import { TaskBadges, TaskList, type TaskRow as SharedTaskRow, type TaskSection } from '@heyta/ui';

/**
 * 分节头要显示什么 —— **本端自己的**透传数据。
 *
 * 🔴 必须显式声明这个类型并标注到数组上。不标的话 TS 会把数组里每一项的
 * `meta` 各推一个具体类型，得到 `{tone:'danger'} | {tone:undefined} | …` 的联合，
 * 而 `TaskSection<TMeta>` 要求**同一个 T**，于是整组赋值失败。
 * 报错落在 `sections={...}` 那一行，看不出是"少了个类型标注"。
 */
type SectionMeta = {
  readonly icon: IconName;
  readonly title: string;
  readonly tone?: 'muted' | 'danger' | 'primary';
};
import { openTaskHost } from '../db/open-host';
import { useMobileSync } from '../sync/store';

import { dueTone, toDueDisplay, type DueDisplayMode } from '../lib/due-display';
import { priorityBadgeLabel, priorityColorToken } from '../lib/priority';
import { TaskDetailSheet } from './TaskDetailSheet';

// ─────────────────────────────────────────────────────────────
// 新建任务面板
// ─────────────────────────────────────────────────────────────

function Composer({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (title: string) => Promise<void>;
}): React.JSX.Element {
  const tokens = useTokens();
  const text = useText();
  const { native } = useTheme();
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(() => {
    if (value.trim() === '' || busy) return;
    setBusy(true);
    void onSubmit(value)
      .then(() => {
        setValue('');
        onClose();
      })
      .finally(() => setBusy(false));
  }, [value, busy, onSubmit, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      // 说明：遮罩用 material.scrim。它是**纯色半透明**，不需要模糊 ——
      // 这正是它能用在 RN 上、而 chrome-tint 不能的原因。
      statusBarTranslucent
    >
      <Pressable
        style={{ flex: 1, backgroundColor: tokens['material.scrim'] }}
        onPress={onClose}
        accessibilityLabel={t('mobile.tasks.composer.close')}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View
          style={{
            backgroundColor: tokens['color.surface'],
            borderTopLeftRadius: tokens['radius.xl'],
            borderTopRightRadius: tokens['radius.xl'],
            padding: tokens['screen.gutter'],
            gap: tokens['space.3'],
            paddingBottom: tokens['space.8'],
          }}
        >
          <Text variant="section-title">{t('mobile.tasks.new')}</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={t('mobile.tasks.composer.placeholder')}
            placeholderTextColor={tokens['color.foreground-muted']}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
            style={[
              text['row-title'],
              {
                minHeight: tokens['touch-target.min'],
                paddingHorizontal: tokens['space.3'],
                borderRadius: tokens['radius.md'],
                borderWidth: tokens['border-width.thin'],
                borderColor: tokens['color.border'],
                backgroundColor: tokens['color.surface-sunken'],
                color: tokens['color.foreground'],
                // ⚠️ 走归一化访问器。直接传 `tokens['font.sans']` 会把整条 CSS 字体栈
                // 交给 RN，字体解析失败且**不报错**，屏幕上是条纹乱码（已实测）。
                fontFamily: native.fontSans,
              },
            ]}
          />
          <View style={{ flexDirection: 'row', gap: tokens['space.2'] }}>
            <Button
              label={t('mobile.common.cancel')}
              tone="ghost"
              onPress={onClose}
              style={{ flex: 1 }}
            />
            <Button
              label={t('mobile.common.add')}
              tone="primary"
              icon="task.add"
              loading={busy}
              disabled={value.trim() === ''}
              onPress={submit}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// 屏幕
// ─────────────────────────────────────────────────────────────

export function TasksScreen({
  onPendingCountChange,
}: {
  /**
   * 待办数变化时回调，供外壳把它接到「任务」标签的角标上。
   *
   * 为什么是回调而不是让外壳自己算：**待办口径只有一个定义处**，
   * 就在下面的 `groups` 里。外壳再算一遍就是第二个权威 ——
   * 迟早出现"角标写 3、屏幕里 4 条"这种自相矛盾。
   */
  onPendingCountChange?: (pending: number) => void;
} = {}): React.JSX.Element {
  const tokens = useTokens();
  // `locale` 也要：重复规则的句子必须按当前语言说（`describeRecurrenceText`），
  // 否则英文界面上会漏出「每周一、三」。
  const { t, locale } = useI18n();
  const [host, setHost] = useState<AppHost | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  /** 打开详情的任务 id。用 id 而不是 Task 对象：列表刷新后对象会换新引用，
      存对象会让面板在每次同步后拿到过期快照。 */
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  /** 截止时间的呈现方式。与 Web 端 `DueBadge` 的开关一致，默认 `date`。 */
  const [dueMode, setDueMode] = useState<DueDisplayMode>('date');
  /**
   * 「任务」页的两种视图：按今天的**列表**，与按艾森豪威尔矩阵的**四象限**。
   *
   * 🔴 **两种视图读的是同一份数据、同一批任务**，只是分组方式不同 ——
   * 所以它是同一页上的视图切换，**不是第 5 个 tab**
   * （理由见 `docs/adr/0015-four-quadrant-as-derived-view.md` §4：
   *  给象限一个 tab 会暗示"这里有一批新数据"，而其实一条都没有）。
   */
  const [view, setView] = useState<'list' | 'quadrant'>('list');
  // 🔴 "现在"由 `useToday` 提供：**回到前台**与**跨过本地零点**时会刷新。
  //
  // 原来是 `useMemo(() => Date.now(), [])` —— 它把"跨零点"这件真事一起冻住了：
  // 应用挂后台一夜、或就一直开着到第二天，界面上的"今天"还是昨天，
  // 于是昨晚到期的任务仍然显示"今天到期"。详见 `lib/use-today.ts` 的文件头。
  const { now } = useToday();
  // 同步完成 → `dataRevision` 变 → 下面的 effect 重读物化状态。
  const { dataRevision } = useMobileSync();

  useEffect(() => {
    let alive = true;
    // 🔴 驱动是工厂不是实例：`SqliteAdapter` 会在 close 后靠它重开。
    void openTaskHost()
      .then((h) => {
        if (alive) setHost(h);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const actions = useMemo<TaskActions | null>(() => (host ? createTaskActions(host) : null), [host]);
  /**
   * 清单动作集。与 `actions` 同一条纪律：从宿主派生，不在界面里新造。
   *
   * 详情页的「清单」选择器要靠它**新建**清单（建完立刻选中、不用先回「我的」页）。
   */
  const projectActions = useMemo<ProjectActions | null>(
    () => (host ? createProjectActions(host) : null),
    [host],
  );
  /**
   * 可选的清单。**与「我的」页读的是同一份物化状态**，所以两处永远一致。
   *
   * 🔴 这里**不含「收集箱」**：「收集箱」不是一条清单，而是
   * `Task.projectId === undefined`。把假的选项混进真列表，
   * 早晚有人给它加上"删除"或"改名"。
   */
  const [projects, setProjects] = useState<Project[]>([]);
  /**
   * 全部未删除的标签。与清单同一份物化状态、同一条刷新时机 ——
   * 详情页的「标签」多选靠它渲染可选项。
   */
  const [tags, setTags] = useState<Tag[]>([]);

  const refresh = useCallback(() => {
    if (!actions) return;
    // ⚠️ `listTasks()` 是**同步**的（读的是已物化的内存状态），不是 Promise。
    // 我一度写成 `.then(...)` —— 运行时那里直接抛 "then is not a function"，
    // 而界面只是停在"正在打开本地数据"，看起来像数据库慢。
    setTasks(actions.listTasks());
    if (projectActions) {
      setProjects(projectActions.listProjects());
      setTags(projectActions.listTags());
    }
  }, [actions, projectActions]);

  useEffect(() => {
    if (!host) return;
    // 🔴 必须等 `recover()` 走完再读 —— openTaskHost 已经保证了这一点，
    // 这里拿到 host 就意味着日志已重放完毕（AGENTS.md §7 第 9 条）。
    refresh();
    // 🔴 `dataRevision` 是**同步完成**的信号（见 `sync/store.ts` 的字段说明）。
    //
    // 少了它，这个 effect 的依赖 `[host, refresh]` 在整个应用生命周期里都不会变 ——
    // 屏幕一直挂着，于是**同步完成后它不会重读**。实测到的现象：
    // 冷启动落在本屏（空的）→ 去「我的」同步 → 切回本屏 → 仍显示"还没有任务"，
    // 而数据库里那条远端任务**已经应用了**（重启 App 就能看见）。
    // 用户据此会认为"多端同步没成功"，而真相是数据到了、界面没去看。
  }, [host, refresh, dataRevision]);

  const groups = useMemo(() => {
    const today = startOfDay(now);
    const overdue: Task[] = [];
    const dueToday: Task[] = [];
    const inbox: Task[] = [];
    const completed: Task[] = [];
    for (const task of tasks) {
      if (task.completedAt !== undefined) {
        completed.push(task);
      } else if (task.dueDate === undefined) {
        inbox.push(task);
      } else if (startOfDay(task.dueDate) < today) {
        overdue.push(task);
      } else if (startOfDay(task.dueDate) === today) {
        dueToday.push(task);
      } else {
        // 未来的任务暂时归入"收集箱"上方的"今天"之后 ——
        // 完整的"未来"分组留给日历 tab。
        inbox.push(task);
      }
    }
    // 🔴 分组内**倒序展示**（新的在上）。
    //
    // `listTasks()` 给的是 `createdAt` **升序**，那是**跨端一致的规范顺序**
    // （见 `packages/app-host/src/actions.ts`："顺序必须在所有端一致 ——
    // 否则同一份数据在两台设备上显示不同顺序"）。**规范顺序不动。**
    //
    // 但这一层是**视图**，视图有义务把"我刚加的那条"放在看得见的地方。
    // 实测代价：升序展示时，新建的任务落到 10 条列表的**最底部、屏幕外**，
    // 用户唯一的反馈是角标从 9 变成 10 —— 会怀疑"我到底加上了吗"。
    return {
      overdue: overdue.reverse(),
      dueToday: dueToday.reverse(),
      inbox: inbox.reverse(),
      completed: completed.reverse(),
    };
  }, [tasks, now]);

  /**
   * 待办数。**这是全应用唯一的待办口径** —— 屏幕上的摘要文字与标签栏角标
   * 都从这一个值来，不允许各自再算一遍。
   */
  const pending = groups.overdue.length + groups.dueToday.length + groups.inbox.length;

  /**
   * 四象限分桶。**派生，不存储** —— 见 ADR-0015 §2：
   * 一旦象限归属被存成独立数据，它就会和 `important` / `dueDate` 漂移，
   * 而这类 bug 不报错，只让人不再信任界面。
   *
   * ⚠️ `bucketByQuadrant` 会**排除已完成与已删除**的任务（那是它写明的语义：
   * 象限是"待办决策工具"）。所以切到四象限时"已完成"分组会消失 ——
   * 那是设计，不是漏了。
   */
  const quadrants = useMemo(() => bucketByQuadrant(tasks, { now }), [tasks, now]);

  /**
   * 展示顺序：Q1 → Q2 → Q3 → Q4。
   *
   * 🔴 刻意**不用** `Object.values(quadrants)` —— 那依赖对象键的插入顺序，
   * 换个地方构造桶就会悄悄改变展示顺序。象限的排序就是它的语义，写死。
   */
  const QUADRANT_ORDER: Quadrant[] = [
    Quadrant.UrgentImportant,
    Quadrant.ImportantNotUrgent,
    Quadrant.UrgentNotImportant,
    Quadrant.Neither,
  ];

  /**
   * 象限名走 `t()`，**不用 `QUADRANT_META[q].label`**。
   *
   * `QUADRANT_META` 里的 `label` / `hint` 是写死的中文，它是**领域层的元数据**，
   * 不是 UI 文案。`check-ui-language.mjs` 只扫 `apps/`，所以直接用不会报错 ——
   * 那正是危险之处：它会**静默**让英文界面显示中文，而门禁看不见。
   */
  const QUADRANT_LABEL_KEY: Record<Quadrant, MessageKey> = {
    [Quadrant.UrgentImportant]: 'mobile.quadrant.q1',
    [Quadrant.ImportantNotUrgent]: 'mobile.quadrant.q2',
    [Quadrant.UrgentNotImportant]: 'mobile.quadrant.q3',
    [Quadrant.Neither]: 'mobile.quadrant.q4',
  };

  // 🔴 由 id 反查任务，而不是存一份对象：列表刷新后 `Task` 是新引用，
  // 存下来的那份会变成过期快照（改了日期却显示旧值）。
  const detailTask = useMemo(
    () => tasks.find((x) => x.id === detailTaskId),
    [tasks, detailTaskId],
  );

  useEffect(() => {
    onPendingCountChange?.(pending);
  }, [pending, onPendingCountChange]);

  if (error !== null) {
    return (
      <Screen title={t('mobile.tasks.title')}>
        <EmptyState
          icon="group.overdue"
          title={t('mobile.tasks.loadError.title')}
          hint={t('mobile.tasks.loadError.hint')}
          // 🔴 原始错误原样附上（并允许长按复制）：它多半是英文的系统信息，
          // 但**不能翻译** —— 翻译之后就没法拿去搜索、也没法对照日志。
          // 分工是：说明走 `hint` 词条，技术原文走 `detail` 变量。
          detail={t('mobile.tasks.loadError.detail', { detail: error })}
        />
      </Screen>
    );
  }

  if (host === null || actions === null) {
    return (
      <Screen title={t('mobile.tasks.title')}>
        <EmptyState
          icon="action.sync"
          title={t('mobile.tasks.loading.title')}
          hint={t('mobile.tasks.loading.hint')}
        />
      </Screen>
    );
  }

  const nothing = tasks.length === 0;

  /**
   * 分节数据交给共享 `TaskList`（M1-4）。
   *
   * 🔴 以前这里是 30 行手写的「扁平头 + 任务」拼装（`pushGroup` + 一个本地
   * `Row` 联合类型）。那段逻辑本身没错，但它是**机制**：空组跳过、key 稳定、
   * 分节展平 —— 这些四个端一模一样，却各写了一遍。
   * 现在只剩"哪几组、什么标题、什么图标"这个**属于本端的选择**。
   *
   * ⚠️ `meta` 里的 `icon` 是各端自己的图标名（`lucide-react-native` 那一套），
   * 共享层不解释它 —— 它只把整个 `meta` 原样交回给 `renderSectionHeader`。
   */
  const listSections: readonly TaskSection<SectionMeta>[] = [
    { key: 'overdue', tasks: groups.overdue, meta: { icon: 'group.overdue', title: t('mobile.tasks.group.overdue'), tone: 'danger' } },
    { key: 'today', tasks: groups.dueToday, meta: { icon: 'group.today', title: t('mobile.common.today'), tone: 'primary' } },
    { key: 'inbox', tasks: groups.inbox, meta: { icon: 'group.inbox', title: t('mobile.tasks.group.inbox') } },
    { key: 'done', tasks: groups.completed, meta: { icon: 'group.completed', title: t('mobile.tasks.group.completed') } },
  ];

  // 四象限是**固定槽位**布局：空格本身是信息（矩阵的价值就在四个格子同时在），
  // 所以这里用 keepEmptySections 保留空象限的标题，而不是像上面那样藏掉。
  //
  // ⚠️ `.map` 的回调**必须显式写返回类型**：只标注左边的变量不够 ——
  // `.map` 的泛型先从回调推，推出来 `icon` 是字面量 `"task.priority"` 而不是
  // `IconName`，于是整组赋值失败。写上返回类型后 `icon` 才会被**校验**
  // （这也顺带保证图标名拼错会在编译期报出来）。
  const quadrantSections: readonly TaskSection<SectionMeta>[] = QUADRANT_ORDER.map(
    (q): TaskSection<SectionMeta> => ({
      // `Quadrant` 是**数值枚举**，而分节的 `key` 是字符串 —— 显式转，
      // 不做隐式拼接（隐式转换在这里不会报错，但会让 key 的含义变得含糊）。
      key: String(q),
      tasks: quadrants[q],
      meta: { icon: 'task.priority', title: t(QUADRANT_LABEL_KEY[q]) },
    }),
  );

  /**
   * 每条变更期间把该行置灰 —— 防止连点发出两条 op。
   *
   * 以前这个状态在每个 `TaskRow` 内部各存一份（`useState(false)`）。
   * 提到屏幕这一层是因为行组件现在归共享层所有；提到"一条"而不是"一个集合"
   * 也够用 —— 用户一次只可能点一行。
   */
  const [busyId, setBusyId] = useState<string | null>(null);
  const runFor = useCallback(
    (id: string, p: Promise<unknown>): void => {
      setBusyId(id);
      void p.then(refresh).finally(() => {
        setBusyId(null);
      });
    },
    [refresh],
  );

  /**
   * 行内插槽。**这些是"内容"，本来就该各端各写**，所以留在本文件。
   *
   * ⚠️ 这里不能用 hook（`useTokens` 之类）—— `renderMeta` 是在共享组件的
   * 渲染过程中被调用的，那不是组件边界。所以颜色一律从屏幕这一层已经拿到的
   * `tokens` 里取。同理 `notify` 不能在这里调。
   */
  const renderTaskMeta = useCallback(
    (row: SharedTaskRow): React.ReactNode => {
      const task = row.source;
      const due = toDueDisplay(task, dueMode, now, t);
      const badge = priorityBadgeLabel(task.priority, t);
      const repeat = actions.repeatOf(task.id);
      return (
        <TaskBadges
          due={due === null ? null : { text: due.text, overdue: due.overdue }}
          priority={
            badge === null
              ? null
              : { text: badge, color: tokens[priorityColorToken(task.priority ?? Priority.None)] }
          }
          repeat={repeat === undefined ? null : describeRecurrenceText(repeat.rule, t, locale)}
        />
      );
    },
    [actions, dueMode, locale, now, t, tokens],
  );

  const renderTaskTrailing = useCallback(
    (row: SharedTaskRow): React.ReactNode => (
      <IconButton
        icon="task.delete"
        label={t('mobile.tasks.a11y.delete', { title: row.title })}
        color={tokens['color.foreground-subtle']}
        onPress={() => {
          runFor(row.id, actions.remove(row.id));
        }}
      />
    ),
    [actions, runFor, t, tokens],
  );

  /**
   * 行级无障碍文案。
   *
   * 🔴 两条**完整的**词条（`complete：{title}` / `uncomplete：{title}`），
   * 不是"前缀 + 标题"拼出来的句子 —— 拼接的结果没法整体翻译，
   * 不同语言的语序也对不上（"完成：买牛奶" vs "Complete: Buy milk"）。
   * 模板因此必须留在**有 i18n 的这一侧**；共享层只收成品字符串
   * （它不能 import `@heyta/i18n`，那会带进第二份 React）。
   *
   * 重复状态也要进无障碍名：读屏用户看不到那个小图标，而"这条任务会不会
   * 每周回来"直接影响他决定要不要现在做。
   */
  const taskRowLabels = useMemo(
    () => ({
      toggleOn: (row: SharedTaskRow) => t('mobile.tasks.a11y.complete', { title: row.title }),
      toggleOff: (row: SharedTaskRow) => t('mobile.tasks.a11y.uncomplete', { title: row.title }),
      open: (row: SharedTaskRow) => {
        const repeat = actions.repeatOf(row.id);
        return repeat === undefined
          ? t('mobile.tasks.a11y.open', { title: row.title })
          : t('mobile.tasks.a11y.openRepeat', {
              title: row.title,
              repeat: describeRecurrenceText(repeat.rule, t, locale),
            });
      },
    }),
    [actions, locale, t],
  );

  return (
    <View style={{ flex: 1 }}>
      <Screen
        title={t('mobile.tasks.title')}
        actions={[{ icon: 'action.sync', label: t('mobile.common.sync'), onPress: refresh }]}
      >
        {/* 大标题 + 日期。大标题属于**内容区**（会随内容滚动），不属于顶栏。 */}
        <View style={{ paddingTop: tokens['space.2'], gap: tokens['space.1'] }}>
          <Text variant="screen-title">{formatDayTitleText(toLocalDate(now), t)}</Text>
          <Text variant="row-meta" tone="muted">
            {nothing
              ? t('mobile.tasks.summary.empty')
              : t('mobile.tasks.summary.counts', {
                  pending,
                  completed: groups.completed.length,
                })}
          </Text>
        </View>

        {/* 视图切换：**列表**（按今天分组）↔ **四象限**（艾森豪威尔矩阵）。
            两种视图读的是**同一批任务**，只是分组方式不同 —— 见 ADR-0015 §4。 */}
        <View style={{ flexDirection: 'row', gap: tokens['space.2'], paddingTop: tokens['space.2'] }}>
          <Chip
            label={t('mobile.tasks.view.list')}
            selected={view === 'list'}
            onPress={() => {
              setView('list');
            }}
          />
          <Chip
            label={t('mobile.tasks.view.quadrant')}
            selected={view === 'quadrant'}
            onPress={() => {
              setView('quadrant');
            }}
          />
        </View>

        {/* 截止时间两种呈现的开关。
            竞品调研里这是**唯一有规模证据**的时间可视化形态
            （滴答清单的 Task time ↔ Countdown Time），见
            `docs/research/ai-competitive-and-architecture.md` §5.2。
            两种呈现读的是同一个 `dueDate`，所以开关只是换说法、不动数据。 */}
        <View style={{ flexDirection: 'row', gap: tokens['space.2'], paddingTop: tokens['space.2'] }}>
          <Chip
            label={t('mobile.tasks.mode.date')}
            selected={dueMode === 'date'}
            onPress={() => {
              setDueMode('date');
            }}
          />
          <Chip
            label={t('mobile.tasks.mode.countdown')}
            selected={dueMode === 'countdown'}
            onPress={() => {
              setDueMode('countdown');
            }}
          />
        </View>

        {view === 'quadrant' ? (
          /* ⚠️ 这里**不是** 2×2 网格。手机宽 402px，四格每格只剩 ~190px，
             勾选框 + 标题 + 日期塞不下，会挤成三行。**"矩阵"图形是桌面端的
             形态**；手机上的等效表达是**按象限分组的四段** ——
             信息一模一样，且沿用本页已有的 SectionHeader + 行。
             落地页卖的是"不用自己想先做哪个"，那个价值在分组里完整保留。

             ⚠️ 四象限用 `keepEmptySections`：**空格本身是信息**（矩阵的价值
             就在四个格子同时在）。上面那个按今天分组的列表则相反 ——
             一个写着"已完成 0"的标题是噪音，所以那边用默认的跳空。 */
          <View style={{ paddingTop: tokens['space.2'] }}>
            <TaskList
              sections={quadrantSections}
              keepEmptySections
              onToggleTask={(id) => {
                runFor(id, actions.toggleCompleted(id));
              }}
              onOpenTask={(id) => {
                setDetailTaskId(id);
              }}
              busyTaskId={busyId}
              labels={taskRowLabels}
              renderMeta={renderTaskMeta}
              renderTrailing={renderTaskTrailing}
              renderSectionHeader={(section) => (
                <View style={{ paddingTop: tokens['space.3'], gap: tokens['space.1'] }}>
                  <SectionHeader
                    // 🔴 四个象限共用同一个图标。**刻意不给每格配一个语义图标**：
                    // 现有图标集里没有"重要/紧急"这一对，硬套
                    // （比如把 Q3 配成 `conflict.warning`）会给出**错的信号** ——
                    // 那比没有图标更糟。要区分度就得先有字形，那是设计系统的活。
                    icon={section.meta.icon}
                    title={section.meta.title}
                    count={section.tasks.length}
                  />
                  {section.tasks.length === 0 ? (
                    <Text variant="row-meta" tone="muted">
                      {t('mobile.tasks.quadrant.empty')}
                    </Text>
                  ) : null}
                </View>
              )}
            />
          </View>
        ) : nothing ? (
          <EmptyState
            icon="group.inbox"
            title={t('mobile.tasks.empty.title')}
            hint={t('mobile.tasks.empty.hint')}
          />
        ) : (
          <View style={{ paddingTop: tokens['space.2'] }}>
            <TaskList
              sections={listSections}
              onToggleTask={(id) => {
                runFor(id, actions.toggleCompleted(id));
              }}
              onOpenTask={(id) => {
                setDetailTaskId(id);
              }}
              busyTaskId={busyId}
              labels={taskRowLabels}
              renderMeta={renderTaskMeta}
              renderTrailing={renderTaskTrailing}
              renderSectionHeader={(section) => (
                <View style={{ paddingTop: tokens['space.3'] }}>
                  <SectionHeader
                    icon={section.meta.icon}
                    title={section.meta.title}
                    count={section.tasks.length}
                    tone={section.meta.tone}
                  />
                </View>
              )}
            />
          </View>
        )}
      </Screen>

      {actions !== null ? (
        <TaskDetailSheet
          task={detailTask}
          visible={detailTaskId !== null}
          onClose={() => {
            setDetailTaskId(null);
          }}
          actions={actions}
          projects={projects}
          tags={tags}
          projectActions={projectActions}
          onChanged={refresh}
          now={now}
        />
      ) : null}

      <Fab icon="task.add" label={t('mobile.tasks.new')} onPress={() => setComposerOpen(true)} />
      <Composer
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        onSubmit={async (title) => {
          await actions.create(title);
          refresh();
        }}
      />
    </View>
  );
}