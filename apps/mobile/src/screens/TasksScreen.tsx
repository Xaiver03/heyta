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
import type { Task } from '@heyta/domain';
import { Priority } from '@heyta/domain';
import { createTaskActions, type AppHost, type TaskActions } from '@heyta/app-host';
import { useText, useTheme, useTokens } from '../theme';
import {
  Button,
  Checkbox,
  EmptyState,
  Fab,
  IconButton,
  Screen,
  SectionHeader,
  Text,
} from '../ui/kit';
import { Icon, type IconName } from '../ui/icons';
import { openTaskHost } from '../db/open-host';
import { formatDue, formatToday, isOverdue, startOfDay } from '../lib/date';

// ─────────────────────────────────────────────────────────────
// 任务行
// ─────────────────────────────────────────────────────────────

function TaskRow({
  task,
  actions,
  onChanged,
  now,
}: {
  task: Task;
  actions: TaskActions;
  onChanged: () => void;
  now: number;
}): React.JSX.Element {
  const t = useTokens();
  const [busy, setBusy] = useState(false);
  // 🔴 完成态读的是 `completedAt`，不是 `completed`。
  // `Task` 上**没有** `completed` 布尔字段 —— 设计上就用"有没有完成时间"
  // 表达完成（entities.ts:76：「不另设 completed 布尔，避免两者不一致」）。
  const done = task.completedAt !== undefined;
  const overdue = !done && task.dueDate !== undefined && isOverdue(task.dueDate, now);

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
        gap: t['space.1'],
        minHeight: t['size.row-min-height'],
        // 负外边距把勾选框的 44 触控区拉回与屏幕留白对齐 ——
        // 视觉上勾选框距屏边 16，但它的可点区域从 16-11=5 开始（仍在屏内）。
        marginLeft: -(t['touch-target.min'] - t['size.checkbox']) / 2,
      }}
    >
      <Checkbox checked={done} busy={busy} onToggle={() => run(actions.toggleCompleted(task.id))} />

      <Pressable
        onPress={() => run(actions.toggleCompleted(task.id))}
        style={{ flex: 1, paddingVertical: t['space.2'], gap: t['space.1'] }}
        accessibilityRole="button"
        accessibilityLabel={`任务：${task.title}`}
      >
        <Text
          variant="row-title"
          tone={done ? 'subtle' : 'default'}
          numberOfLines={2}
          style={done ? { textDecorationLine: 'line-through' } : undefined}
        >
          {task.title}
        </Text>

        {task.dueDate !== undefined || task.priority !== undefined ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t['space.2'] }}>
            {task.dueDate !== undefined ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t['space.1'] }}>
                <Icon
                  name="task.due"
                  size="xs"
                  color={overdue ? t['color.danger'] : t['color.foreground-subtle']}
                />
                <Text variant="row-meta" tone={overdue ? 'danger' : 'subtle'}>
                  {formatDue(task.dueDate, now)}
                </Text>
              </View>
            ) : null}
            {/* 🔴 `Priority` 是**数值枚举**（High = 3），不是字符串。
                我一开始写成 `task.priority === 'high'` —— TS 报了
                "两个类型没有重叠"，否则这个条件**永远为假**：
                高优先级任务不会显示标记，而且不报任何错。 */}
            {task.priority === Priority.High ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t['space.1'] }}>
                <Icon name="task.priority" size="xs" color={t['color.priority-high']} />
                <Text variant="row-meta" style={{ color: t['color.priority-high'] }}>
                  高优先级
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      <IconButton
        icon="task.delete"
        label={`删除任务：${task.title}`}
        color={t['color.foreground-subtle']}
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
  const t = useTokens();
  const text = useText();
  const { native } = useTheme();
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
        style={{ flex: 1, backgroundColor: t['material.scrim'] }}
        onPress={onClose}
        accessibilityLabel="关闭新建面板"
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View
          style={{
            backgroundColor: t['color.surface'],
            borderTopLeftRadius: t['radius.xl'],
            borderTopRightRadius: t['radius.xl'],
            padding: t['screen.gutter'],
            gap: t['space.3'],
            paddingBottom: t['space.8'],
          }}
        >
          <Text variant="section-title">新建任务</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder="要做什么？"
            placeholderTextColor={t['color.foreground-muted']}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
            style={[
              text['row-title'],
              {
                minHeight: t['touch-target.min'],
                paddingHorizontal: t['space.3'],
                borderRadius: t['radius.md'],
                borderWidth: t['border-width.thin'],
                borderColor: t['color.border'],
                backgroundColor: t['color.surface-sunken'],
                color: t['color.foreground'],
                // ⚠️ 走归一化访问器。直接传 `t['font.sans']` 会把整条 CSS 字体栈
                // 交给 RN，字体解析失败且**不报错**，屏幕上是条纹乱码（已实测）。
                fontFamily: native.fontSans,
              },
            ]}
          />
          <View style={{ flexDirection: 'row', gap: t['space.2'] }}>
            <Button label="取消" tone="ghost" onPress={onClose} style={{ flex: 1 }} />
            <Button
              label="添加"
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
  const t = useTokens();
  const [host, setHost] = useState<AppHost | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  // 冻结"现在"：每次渲染重新取 Date.now() 会让"今天/过期"在跨零点时
  // 与渲染不同步，也会让 useMemo 每次都失效。
  const now = useMemo(() => Date.now(), []);

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

  const refresh = useCallback(() => {
    if (!actions) return;
    // ⚠️ `listTasks()` 是**同步**的（读的是已物化的内存状态），不是 Promise。
    // 我一度写成 `.then(...)` —— 运行时那里直接抛 "then is not a function"，
    // 而界面只是停在"正在打开本地数据"，看起来像数据库慢。
    setTasks(actions.listTasks());
  }, [actions]);

  useEffect(() => {
    if (!host) return;
    // 🔴 必须等 `recover()` 走完再读 —— openTaskHost 已经保证了这一点，
    // 这里拿到 host 就意味着日志已重放完毕（AGENTS.md §7 第 9 条）。
    refresh();
  }, [host, refresh]);

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
    return { overdue, dueToday, inbox, completed };
  }, [tasks, now]);

  /**
   * 待办数。**这是全应用唯一的待办口径** —— 屏幕上的摘要文字与标签栏角标
   * 都从这一个值来，不允许各自再算一遍。
   */
  const pending = groups.overdue.length + groups.dueToday.length + groups.inbox.length;

  useEffect(() => {
    onPendingCountChange?.(pending);
  }, [pending, onPendingCountChange]);

  if (error !== null) {
    return (
      <Screen title="任务">
        <EmptyState
          icon="group.overdue"
          title="打开本地数据库失败"
          hint="数据在本地，不会丢。重开应用通常能恢复。"
          detail={error}
        />
      </Screen>
    );
  }

  if (host === null || actions === null) {
    return (
      <Screen title="任务">
        <EmptyState icon="action.sync" title="正在打开本地数据" hint="首次启动会重放本地 op 日志。" />
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
  pushGroup('overdue', '已过期', 'group.overdue', groups.overdue, 'danger');
  pushGroup('today', '今天', 'group.today', groups.dueToday, 'primary');
  pushGroup('inbox', '收集箱', 'group.inbox', groups.inbox);
  pushGroup('done', '已完成', 'group.completed', groups.completed);

  return (
    <View style={{ flex: 1 }}>
      <Screen title="任务" actions={[{ icon: 'action.sync', label: '同步', onPress: refresh }]}>
        {/* 大标题 + 日期。大标题属于**内容区**（会随内容滚动），不属于顶栏。 */}
        <View style={{ paddingTop: t['space.2'], gap: t['space.1'] }}>
          <Text variant="screen-title">{formatToday(now)}</Text>
          <Text variant="row-meta" tone="muted">
            {nothing
              ? '还没有任务'
              : `${pending} 项待办，${groups.completed.length} 项已完成`}
          </Text>
        </View>

        {nothing ? (
          <EmptyState
            icon="group.inbox"
            title="今天还没有安排"
            hint="点右下角的加号，写下第一件事。"
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
                <TaskRow task={item.task} actions={actions} onChanged={refresh} now={now} />
              )
            }
            contentContainerStyle={{ gap: t['space.1'] }}
          />
        )}
      </Screen>

      <Fab icon="task.add" label="新建任务" onPress={() => setComposerOpen(true)} />
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