/**
 * 任务屏（5 个 tab 的第一个，也是默认落点）
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
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import type { Project, Tag, Task } from '@heyta/domain';
// `formatDayTitleText` 在壳里把领域层给的 `LocalDate` 说成当前语言：
// **"某一天的标题"的日期语义（`isoWeekday`、`parseLocalDate`）仍只有领域层一份**，
// 壳里只负责措辞（见 `apps/mobile/src/lib/date.ts` 文件头）。
import {
  Priority,
  // 🔴 分组归属规则与 Web 共用同一份（见下面 `groups` 的说明）。
  sectionTasks,
  // 标签筛选的判据也共用 —— Web 侧栏点标签走的就是它。
  filterTasks,
  // 搜索判据同样共用 —— Web 的搜索框走的就是它。
  searchTasks,
  // 待办口径也只有一份 —— "哪几组算待办"是产品说法，不是某一屏的选择。
  pendingCount,
  toLocalDate,
} from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
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
// 🔴 「四象限」那一档的实现（P10 收敛后**唯一**的实现）——
// 它是共享 `QuadrantBoard` 的移动宿主，不再是第 6 个 tab 的整屏。
import { QuadrantScreen } from './QuadrantScreen';

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
  // 搜索框要 `fontSans` 与 `row-meta` 两样（都走归一化访问器）。
  const text = useText();
  const { native } = useTheme();
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
   *
   * 🔴 **象限那一档只有一个实现**：`./QuadrantScreen`（它是共享 `QuadrantBoard` 的
   * 移动宿主）。这里以前手写过一份"按象限分组的四段列表"，P10 收敛时已删除 ——
   * 同一件事有两份呈现 = 两份会各自漂移，而且不会有测试变红。
   */
  const [view, setView] = useState<'list' | 'quadrant'>('list');
  /**
   * 标签筛选。`undefined` = 不筛。
   *
   * 🔴 **判据来自 `@heyta/domain` 的 `filterTasks`，与 Web 侧栏点标签是同一份**
   * —— 两端都是"只看带这个标签的未完成任务"。在此之前移动端**根本没有标签筛选入口**，
   * 而 Web 有：同一件能力两端不一致，正是 M1/M2 要避免的。
   */
  const [tagFilter, setTagFilter] = useState<string | undefined>(undefined);
  /**
   * 搜索串。与标签筛选**叠加**（先按标签收窄、再按文字收窄）。
   *
   * 🔴 判据（匹配哪些字段 / 大小写 / 多词是 AND）全在
   * `packages/domain/src/search.ts`，与 Web 的搜索框是**同一份**。
   * ⚠️ 文案复用 `web.shell.search.*` —— 与 `web.export.*` 同一个取舍：
   * 同一件能力两端读同一批 key，就不可能出现「网页能搜备注、手机不能」这种分歧。
   */
  const [query, setQuery] = useState('');
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
    /**
     * 🔴 **归属规则来自 `@heyta/domain`，这里只负责展示顺序。**
     *
     * 这一段以前是自己写的一遍 —— 而 `apps/web` 的 `selectVisibleTasks`
     * 是另一遍（`kind: 'today'` / `'completed'` 等）。**两份互不校验的实现**，
     * 这正是 M1 要拦的东西："什么算逾期、什么算今天"是产品判断，
     * 不该由某个屏幕决定。
     *
     * 现在判据只有一份（`packages/domain/src/task-filter.ts`），
     * 加一个筛选/分组时四端同时拿到它。
     */
    // 🔴 **先按标签筛，再分节** —— 顺序不能反：分节会把已完成分到单独一组，
    // 而 `{kind:'tag'}` 的语义是"只看未完成"（与 Web 侧栏一致），
    // 反过来的话标签视图里会冒出一个"已完成"分组，两端就不一样了。
    const scoped =
      tagFilter === undefined
        ? tasks
        : filterTasks(tasks, { kind: 'tag', tagId: tagFilter }, { now });
    // 🔴 **先筛标签、再搜、最后分节** —— 顺序与 Web 一致。
    //    搜索是在当前筛选之上**收窄**，不替代它；反过来在任何一种筛选下
    //    都会得到不同结果，而用户只会读成"搜索有时候不准"。
    const searched = searchTasks(scoped, query);
    const sections = sectionTasks(searched, { now });
    const { overdue, dueToday, inbox, completed } = sections;
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
  }, [tasks, now, tagFilter, query]);

  /**
   * 待办数。**这是全应用唯一的待办口径** —— 屏幕上的摘要文字与标签栏角标
   * 都从这一个值来，不允许各自再算一遍。
   *
   * 🔴 口径本身来自 `@heyta/domain` 的 `pendingCount`：它原先在这里是
   * `overdue.length + dueToday.length + inbox.length` —— 而"哪几组算待办"
   * 是一个产品说法，不是这一屏的排版选择。写在这里等于四端各有一份。
   */
  const pending = pendingCount(groups);

  // 🔴 四象限的分桶 / 排序 / 展示顺序**都不在本文件**：它们在领域层
  // （`bucketByQuadrant`）与共享层（`@heyta/ui` 的 `quadrant/model.ts`），
  // 由 `./QuadrantScreen` 里的共享 `QuadrantBoard` 直接消费。
  // 本文件曾经手写过一份"四段分节"的同义实现，P10 收敛时已删除。

  // 🔴 由 id 反查任务，而不是存一份对象：列表刷新后 `Task` 是新引用，
  // 存下来的那份会变成过期快照（改了日期却显示旧值）。
  const detailTask = useMemo(
    () => tasks.find((x) => x.id === detailTaskId),
    [tasks, detailTaskId],
  );

  useEffect(() => {
    onPendingCountChange?.(pending);
  }, [pending, onPendingCountChange]);

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
      // ⚠️ 这个回调声明在下面那两个守卫**之前**（hook 必须在守卫之前，见守卫处的注释），
      //    所以 TS 在这里收窄不到 `actions`。实际运行时到不了：`actions === null` 时
      //    组件会在守卫处提前 return，这个回调根本不会被调用。用一句显式判空换回类型安全。
      const task = row.source;
      const due = toDueDisplay(task, dueMode, now, t);
      const badge = priorityBadgeLabel(task.priority, t);
      // ⚠️ 可空调用：这个回调声明在下面那两个守卫**之前**（hook 必须在守卫之前），
      //    所以 TS 收窄不到 `actions`。运行到不了 null —— 那时组件已在守卫处 return。
      //    写成 `?.` 而不是 `!`：拿不到 actions 时语义上就是"这条没有重复规则"，
      //    而 `!` 会把一个真实的类型洞埋进代码里。
      const repeat = actions?.repeatOf(task.id);
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
    (row: SharedTaskRow): React.ReactNode => {
      // ⚠️ 这个回调声明在下面那两个守卫**之前**（hook 必须在守卫之前，见守卫处的注释），
      //    所以 TS 在这里收窄不到 `actions`。实际运行时到不了：`actions === null` 时
      //    组件会在守卫处提前 return，这个回调根本不会被调用。用一句显式判空换回类型安全。
      return (
        <IconButton
          icon="task.delete"
          label={t('mobile.tasks.a11y.delete', { title: row.title })}
          color={tokens['color.foreground-subtle']}
          onPress={() => {
            // ⚠️ 判空放在**这里**而不是让整个回调返回 null：这个回调签名要求返回
            //    `ReactNode`，返回 null 会把 `TaskListLabels` 那一侧的类型一起带偏
            //    （`open` 会变成 `string | null`）。实际运行到不了 null。
            if (actions === null) return;
            runFor(row.id, actions.remove(row.id));
          }}
        />
      );
    },
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
        // ⚠️ 同上：这个 `useMemo` 的 body 立刻执行，但它**声明在守卫之前**。
        //    闭包只在列表真的渲染时被调用，那时 `actions` 一定非空。
        // ⚠️ 同上，可空调用；拿不到 actions 就当这条没有重复规则。
        const repeat = actions?.repeatOf(row.id);
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

  /**
   * 🔴 **两个提前 return 必须在**所有 hook **之后。**
   *
   * 这里踩过一个真 bug（在 Android 模拟器上才暴露）：这两个守卫原本在
   * 组件中部，而 `busyId` / `runFor` / `renderTaskMeta` / `renderTaskTrailing` /
   * `taskRowLabels` **五个 hook 在它们之后**。于是：
   *
   *   第 1 次渲染：`host === null`（还在加载）→ 提前 return，只用掉 24 个 hook；
   *   第 2 次渲染：host 就绪 → 继续往下 → 撞上第 25 个 hook
   *   ⇒ `Rendered more hooks than during the previous render.`，整屏白。
   *
   * ⚠️ 这一条**在单测里永远看不见**：jsdom 测试直接给全了 host/actions，
   * 从来没有"先 null 后就绪"的那两次渲染。只有真跑一次应用才会暴露。
   * 所以它也顺带说明：**"hook 都写在最前面"不是风格偏好，是硬约束。**
   *
   * 代价是下面那三个用到 `actions` 的回调**自己收窄不到**（它们在守卫之前声明），
   * 各自带一句显式判空 —— 见它们的注释。
   */
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

        {/*
          搜索框。

          🔴 **它此前不存在** —— 而 Web 有。同一件能力两端不一致，正是 M1/M2 要避免的。
          判据在 `packages/domain/src/search.ts`（与 Web 共用），这里只负责把字读出来。

          ⚠️ 放**标题之下、视图切换之上**：它是"在当前这一屏里找东西"，
          所以属于内容区（跟着滚），不属于顶栏。
        */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: tokens['space.2'],
            paddingTop: tokens['space.2'],
          }}
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('web.shell.search.placeholder')}
            accessibilityLabel={t('web.shell.search.aria')}
            placeholderTextColor={tokens['color.foreground-subtle']}
            returnKeyType="search"
            // ⚠️ 走归一化访问器。直接传 `tokens['font.sans']` 会把整条 CSS 字体栈
            // 交给 RN，字体解析失败且**不报错**（已实测）。
            style={[
              text['row-meta'],
              {
                flex: 1,
                minHeight: tokens['touch-target.min'],
                paddingHorizontal: tokens['space.3'],
                borderRadius: tokens['radius.md'],
                borderWidth: tokens['border-width.thin'],
                borderColor: tokens['color.border'],
                backgroundColor: tokens['color.surface-sunken'],
                color: tokens['color.foreground'],
                fontFamily: native.fontSans,
              },
            ]}
          />
          {query !== '' ? (
            <Chip
              label={t('web.shell.search.clear')}
              onPress={() => {
                setQuery('');
              }}
            />
          ) : null}
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

        {/*
          标签筛选行。

          🔴 **它必须在空态时也可见** —— 否则"筛选之后一条都没有"会让这一行
          跟着消失，用户**没有办法清掉筛选**，只能杀掉应用。所以它渲染在
          `view === 'quadrant' ? … : nothing ? … : …` **之前**，而不是列表分支里。

          ⚠️ 只在**列表视图**出现：四象限视图是"按重要性/紧迫性分组"，
          在它上面叠一层标签筛选会得到四种"筛过之后还剩几条"，而那一档的
          全部价值就是四个格子同时在场（见下面 `QuadrantScreen` 的说明）。
        */}
        {view === 'list' && tags.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: tokens['space.2'], paddingVertical: tokens['space.2'] }}
          >
            <Chip
              label={t('mobile.tasks.tagFilter.all')}
              selected={tagFilter === undefined}
              onPress={() => {
                setTagFilter(undefined);
              }}
            />
            {tags.map((tag) => (
              <Chip
                key={tag.id}
                label={tag.name}
                selected={tagFilter === tag.id}
                onPress={() => {
                  // 再点一次同一个标签 = 取消筛选（开关语义），否则用户要先点
                  // "全部"才知道能清掉 —— 那是一次没有反馈的摸索。
                  setTagFilter((current) => (current === tag.id ? undefined : tag.id));
                }}
              />
            ))}
          </ScrollView>
        ) : null}

        {view === 'quadrant' ? (
          /*
           * 🔴 象限那一档 = **共享 `QuadrantBoard` 的 2×2 矩阵**（`./QuadrantScreen`）。
           *
           * 这里原来是本文件手写的一份"按象限分组的四段列表"（共享 `TaskList` +
           * `keepEmptySections`），删于 P10 —— 同一件事有两份呈现，就会各自漂移，
           * 而且不会有任何测试变红。现在象限**只有这一个实现**。
           *
           * ⚠️ 行的元信息 / 行尾动作 / 行级无障碍文案全部**复用列表视图的那三份**
           * （`renderTaskMeta` / `renderTaskTrailing` / `taskRowLabels`），
           * 所以两档里的同一行读屏拿到的是同一句话。
           */
          <QuadrantScreen
            tasks={tasks}
            now={now}
            busyTaskId={busyId}
            labels={taskRowLabels}
            renderMeta={renderTaskMeta}
            renderTrailing={renderTaskTrailing}
            onToggleTask={(id) => {
              runFor(id, actions.toggleCompleted(id));
            }}
            onOpenTask={(id) => {
              setDetailTaskId(id);
            }}
          />
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