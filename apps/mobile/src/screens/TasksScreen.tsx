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
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import type { Project, Task } from '@heyta/domain';
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
  Checkbox,
  EmptyState,
  Fab,
  IconButton,
  Chip,
  Screen,
  SectionHeader,
  Text,
} from '../ui/kit';
import { Icon, type IconName } from '../ui/icons';
import { openTaskHost } from '../db/open-host';
import { useMobileSync } from '../sync/store';

import { dueTone, toDueDisplay, type DueDisplayMode } from '../lib/due-display';
import { priorityBadgeLabel, priorityColorToken } from '../lib/priority';
import { TaskDetailSheet } from './TaskDetailSheet';

// ─────────────────────────────────────────────────────────────
// 任务行
// ─────────────────────────────────────────────────────────────

function TaskRow({
  task,
  actions,
  onChanged,
  now,
  dueMode,
  onOpen,
}: {
  task: Task;
  actions: TaskActions;
  onChanged: () => void;
  now: number;
  dueMode: DueDisplayMode;
  onOpen: () => void;
}): React.JSX.Element {
  const tokens = useTokens();
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  // 🔴 完成态读的是 `completedAt`，不是 `completed`。
  // `Task` 上**没有** `completed` 布尔字段 —— 设计上就用"有没有完成时间"
  // 表达完成（entities.ts:76：「不另设 completed 布尔，避免两者不一致」）。
  const done = task.completedAt !== undefined;

  // 🔴 截止显示与档位全部来自 `@heyta/domain` 的共享实现
  // （`lib/due-display.ts` 只是把它包成"给 UI 的形状"）。
  // 这里曾经用的是本地的 `formatDue` —— 它与共享实现已经说了两种话
  // （`已过期` vs `已逾期`、`9月26日` vs `还剩 8 天`）。
  const due = toDueDisplay(task, dueMode, now, t);
  const priorityBadge = priorityBadgeLabel(task.priority, t);
  // 重复规则是**同步读**物化状态（`repeatOf` 不发 op），放在渲染里没有问题。
  // 它同时决定了要不要多画一个标记、以及读屏时怎么念这条任务。
  const repeat = actions.repeatOf(task.id);
  const priorityColor = tokens[priorityColorToken(task.priority ?? Priority.None)];

  const run = useCallback(
    (p: Promise<unknown>) => {
      setBusy(true);
      void p
        .then(onChanged)
        .finally(() => setBusy(false));
    },
    [onChanged],
  );

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens['space.1'],
        minHeight: tokens['size.row-min-height'],
        // 负外边距把勾选框的 44 触控区拉回与屏幕留白对齐 ——
        // 视觉上勾选框距屏边 16，但它的可点区域从 16-11=5 开始（仍在屏内）。
        marginLeft: -(tokens['touch-target.min'] - tokens['size.checkbox']) / 2,
      }}
    >
      <Checkbox
        checked={done}
        busy={busy}
        // 两种状态各写一条**完整的**词条（`complete：{title}` / `uncomplete：{title}`），
        // 不写成"前缀 + 标题"拼出来的句子 —— 拼接的结果没法整体翻译，
        // 不同语言的语序（"完成：买牛奶" vs "Complete: Buy milk"）也对不上。
        label={
          done
            ? t('mobile.tasks.a11y.uncomplete', { title: task.title })
            : t('mobile.tasks.a11y.complete', { title: task.title })
        }
        onToggle={() => run(actions.toggleCompleted(task.id))}
      />

      {/* 🔴 点行 = **打开详情**，不再切换完成。
          行上的主操作应该是"打开它"；切换完成有专门的勾选框，
          而且那样更可达：勾选框有自己的无障碍名，读屏用户能直接说
          "完成：买牛奶"，不必先打开详情再找按钮。 */}
      <Pressable
        onPress={onOpen}
        style={{ flex: 1, paddingVertical: tokens['space.2'], gap: tokens['space.1'] }}
        accessibilityRole="button"
        // 重复状态要进无障碍名：读屏用户看不到那个小图标，
        // 而"这条任务会不会每周回来"直接影响他决定要不要现在做。
        // 两条完整词条（不带重复 / 带重复），理由同勾选框。
        accessibilityLabel={
          repeat === undefined
            ? t('mobile.tasks.a11y.open', { title: task.title })
            : t('mobile.tasks.a11y.openRepeat', {
                title: task.title,
                repeat: describeRecurrenceText(repeat.rule, t, locale),
              })
        }
      >
        <Text
          variant="row-title"
          tone={done ? 'subtle' : 'default'}
          numberOfLines={2}
          style={done ? { textDecorationLine: 'line-through' } : undefined}
        >
          {task.title}
        </Text>

        {due !== null || priorityBadge !== null || repeat !== undefined ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] }}>
            {due !== null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens['space.1'] }}>
                <Icon
                  name={due.overdue ? 'task.overdue' : 'task.due'}
                  size="xs"
                  color={due.overdue ? tokens['color.danger'] : tokens['color.foreground-subtle']}
                />
                <Text variant="row-meta" tone={dueTone(due.urgency)}>
                  {due.text}
                </Text>
              </View>
            ) : null}
            {/* 🔴 `Priority` 是**数值枚举**（High = 3），不是字符串。
                我一开始写成 `task.priority === 'high'` —— TS 报了
                "两个类型没有重叠"，否则这个条件**永远为假**：
                高优先级任务不会显示标记，而且不报任何错。
                现在映射只在 `lib/priority.ts` 一处，并有可失败的测试。 */}
            {priorityBadge !== null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens['space.1'] }}>
                <Icon name="task.priority" size="xs" color={priorityColor} />
                <Text variant="row-meta" style={{ color: priorityColor }}>
                  {priorityBadge}
                </Text>
              </View>
            ) : null}
            {/* 重复标记。规则串 → 句子在 `lib/recurrence-display.ts`；
                **解析**仍然只有 `packages/domain` 一份（`recurrenceParts`）。
                这里此前直接渲染 `describeRecurrence` 的返回值 —— 那是一句中文，
                英文界面上会漏出「每周一、三」，而它是跨包的返回值、门禁扫不到。 */}
            {repeat !== undefined ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens['space.1'] }}>
                <Icon name="task.repeat" size="xs" color={tokens['color.foreground-subtle']} />
                <Text variant="row-meta" tone="muted">
                  {describeRecurrenceText(repeat.rule, t, locale)}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      <IconButton
        icon="task.delete"
        label={t('mobile.tasks.a11y.delete', { title: task.title })}
        color={tokens['color.foreground-subtle']}
        onPress={() => run(actions.remove(task.id))}
      />
    </View>
  );
}

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
  const { t } = useI18n();
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

  const refresh = useCallback(() => {
    if (!actions) return;
    // ⚠️ `listTasks()` 是**同步**的（读的是已物化的内存状态），不是 Promise。
    // 我一度写成 `.then(...)` —— 运行时那里直接抛 "then is not a function"，
    // 而界面只是停在"正在打开本地数据"，看起来像数据库慢。
    setTasks(actions.listTasks());
    if (projectActions) setProjects(projectActions.listProjects());
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

  // 用一个扁平的「分组头 + 任务」序列喂给 FlatList ——
  // 比嵌套 SectionList 更容易控制空分组（空分组不该显示标题）。
  type Row =
    | {
        kind: 'header';
        key: string;
        title: string;
        icon: IconName;
        count: number;
        tone?: 'muted' | 'danger' | 'primary';
      }
    | { kind: 'task'; key: string; task: Task };

  const rows: Row[] = [];
  const pushGroup = (
    key: string,
    title: string,
    icon: IconName,
    list: Task[],
    tone?: 'muted' | 'danger' | 'primary',
  ): void => {
    // 🔴 空分组不渲染标题 —— 一个写着"已完成 0"的标题是纯噪音。
    if (list.length === 0) return;
    rows.push({ kind: 'header', key: `h-${key}`, title, icon, count: list.length, tone });
    for (const task of list) rows.push({ kind: 'task', key: task.id, task });
  };
  pushGroup('overdue', t('mobile.tasks.group.overdue'), 'group.overdue', groups.overdue, 'danger');
  pushGroup('today', t('mobile.common.today'), 'group.today', groups.dueToday, 'primary');
  pushGroup('inbox', t('mobile.tasks.group.inbox'), 'group.inbox', groups.inbox);
  pushGroup('done', t('mobile.tasks.group.completed'), 'group.completed', groups.completed);

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
             落地页卖的是"不用自己想先做哪个"，那个价值在分组里完整保留。 */
          <View style={{ gap: tokens['space.3'], paddingTop: tokens['space.2'] }}>
            {QUADRANT_ORDER.map((q) => {
              const list = quadrants[q];
              return (
                <View key={q} style={{ gap: tokens['space.1'] }}>
                  <SectionHeader
                    // 🔴 四个象限共用同一个图标。**刻意不给每格配一个语义图标**：
                    // 现有图标集里没有"重要/紧急"这一对，硬套
                    // （比如把 Q3 配成 `conflict.warning`）会给出**错的信号** ——
                    // 那比没有图标更糟。要区分度就得先有字形，那是设计系统的活。
                    icon="task.priority"
                    title={t(QUADRANT_LABEL_KEY[q])}
                    count={list.length}
                  />
                  {list.length === 0 ? (
                    <Text variant="row-meta" tone="muted">
                      {t('mobile.tasks.quadrant.empty')}
                    </Text>
                  ) : (
                    list.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        actions={actions}
                        onChanged={refresh}
                        now={now}
                        dueMode={dueMode}
                        onOpen={() => {
                          setDetailTaskId(task.id);
                        }}
                      />
                    ))
                  )}
                </View>
              );
            })}
          </View>
        ) : nothing ? (
          <EmptyState
            icon="group.inbox"
            title={t('mobile.tasks.empty.title')}
            hint={t('mobile.tasks.empty.hint')}
          />
        ) : (
          <FlatList
            data={rows}
            scrollEnabled={false}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) =>
              item.kind === 'header' ? (
                <SectionHeader
                  icon={item.icon}
                  title={item.title}
                  count={item.count}
                  tone={item.tone}
                />
              ) : (
                <TaskRow
                  task={item.task}
                  actions={actions}
                  onChanged={refresh}
                  now={now}
                  dueMode={dueMode}
                  onOpen={() => {
                    setDetailTaskId(item.task.id);
                  }}
                />
              )
            }
            contentContainerStyle={{ gap: tokens['space.1'] }}
          />
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