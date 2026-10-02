/**
 * 任务详情面板
 * ==============
 *
 * 🔴 **这个面板补的是"能日常用"里最大的一块缺口。**
 *
 * 在此之前移动端只能做三件事：建一个**只有标题**的任务、勾完成、删除。
 * 也就是说：
 *   - 截止日期设不了 → 所有任务都落在「收集箱」，「今天」永远是空的；
 *   - 优先级设不了 → `TaskActions.setPriority` / `setImportant` 写好了却没入口；
 *   - 标题改不了 → 打错一个字只能删掉重建。
 *
 * 「今天」是这个产品的核心视图（`TasksScreen` 文件头写着"这个产品的核心问题是
 * 今天该干什么"），而**没有截止日期就永远到不了今天** —— 数据层早就齐了
 * （`TaskActions` 有 `rename` / `setDueDate` / `setPriority` / `moveToProject`），
 * 缺的一直是这个界面。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 两个刻意的交互决定
 *
 * 1. **点任务行打开详情，不再切换完成。** 行上的主操作应该是"打开它"；
 *    切换完成有专门的勾选框 —— 那也**更可达**：勾选框有独立的
 *    `accessibilityLabel`，读屏用户能直接说"完成：买牛奶"，
 *    而不是先打开详情再找完成按钮。
 * 2. **每个控件改完立即写**（一处意图 = 一个 op，AGENTS.md §3.4）。
 *    攒起来最后统一提交会让"改了日期然后直接退出"丢掉改动。
 *    标题是**唯一**例外：它必须等内容确定，所以离开输入框 / 收起面板时才提交 ——
 *    每敲一个字写一个 op 会把 op-log 灌满噪音。
 *
 * 🔴 本文件里**没有一行业务逻辑**：写哪些字段、清除写成 `null` 还是 `undefined`、
 * 删除是软删还是硬删，全部来自 `@heyta/app-host` 的 `createTaskActions`。
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

import {
  Priority,
  canSetParent,
  dueDateToEpoch,
  isImportant,
  // 🔴 自定义 RRULE 的合法性判据 —— 与领域层同一份（B2-3 的移动端尾巴）。
  isValidRecurrenceRule,
  toLocalDate,
  type Project,
  type Tag,
  type Task,
} from '@heyta/domain';
import type { MessageKey } from '@heyta/i18n';
import { useI18n } from '@heyta/i18n';
import {
  REPEAT_PRESET_IDS,
  planTimelineBlock,
  repeatPresetRule,
  type ProjectActions,
  type RepeatPresetId,
  type TaskActions,
} from '@heyta/app-host';
import { ChecklistPlanPreview, ReminderList, rejectionReasonOf, subtaskRejectionMessageKey } from '@heyta/ui';

import { formatStamp } from '../lib/date';
import { PRIORITY_ORDER, priorityColorToken, priorityLabel } from '../lib/priority';
import { describeRecurrenceText } from '../lib/recurrence-display';
import { reminderListLabels } from '../lib/reminders-display';
import { timelineLabels } from '../lib/timeline-labels';
import { useTaskReminders } from '../lib/reminders';
import { useText, useTheme, useTokens } from '../theme';
import { DatePicker } from '../ui/DatePicker';
import { Button, Chip, IconButton, SectionHeader, Text, TextField } from '../ui/kit';

/**
 * 重复预设 → 词条 key。
 *
 * ⚠️ 这里只有 key。"每周到底是哪一天"、"工作日是哪几天"是产品语义，
 * 在 `@heyta/app-host` 的 `repeat-presets.ts` 里（§3.5 的判据）。
 * 把语义放在界面里的后果是 Web 端落地时出现第二份，两份对"工作日"的理解
 * 只要差一天，同一个用户在两台设备上就会看到不同的重复日期，且都不报错。
 */
const REPEAT_LABEL_KEYS: Record<RepeatPresetId, MessageKey> = {
  daily: 'mobile.detail.repeat.daily',
  weekly: 'mobile.detail.repeat.weekly',
  weekdays: 'mobile.detail.repeat.weekdays',
  monthly: 'mobile.detail.repeat.monthly',
};

export function TaskDetailSheet({
  task,
  visible,
  onClose,
  actions,
  projects,
  tags,
  projectActions,
  tasks,
  onChanged,
  now,
}: {
  /** 当前打开的任务。`undefined` = 没有选中任何任务。 */
  task: Task | undefined;
  visible: boolean;
  onClose: () => void;
  actions: TaskActions;
  /**
   * 可选的清单（**不含「收集箱」** —— 那个选项不是实体，见下面的渲染）。
   */
  projects: Project[];
  /**
   * 全部未删除的标签。**空数组是合法且常见的情况**（还没建过标签），
   * 不是"加载失败" —— 所以下面渲染的是一句指路文案，而不是什么都不画。
   */
  tags: Tag[];
  /** 要新建清单时需要它。为 `null` 时「新建清单」不出现（宿主还没打开）。 */
  projectActions: ProjectActions | null;
  /**
   * **全部未删除的任务** —— 子任务的候选父从这里挑。
   *
   * 🔴 刻意传**全量**而不是"当前视图里可见的"：父任务可能在任何视图里
   * （甚至已完成、被筛掉），而"把一个任务挂到某条看不见的任务下"是完全合法的操作。
   * 用可见列表当选集，会让子任务这个功能**随机地做不成**，且看起来像"没有这个选项"。
   */
  tasks: Task[];
  onChanged: () => void;
  now: number;
}): React.JSX.Element | null {
  const tokens = useTokens();
  const text = useText();
  const { native } = useTheme();
  const { t, locale } = useI18n();

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  /** 行内「新建清单」的输入态与草稿名。 */
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  /** 改父被拒时的**人话**（空串 = 没有错误）。 */
  const [parentError, setParentError] = useState('');

  const taskId = task?.id;

  /**
   * 提醒面板的接线（见 `lib/reminders.ts`）。
   *
   * 🔴 **必须在提前 return 之前调用** —— `task === undefined` 时本组件会
   * `return null`，那个 return 在所有 hook 之后（见文件里那两处注释：
   * 提前 return 会让两次渲染的 hook 数量不同，React 直接报错）。
   * `taskId === undefined` 由 hook 自己兜住（返回空列表 + 空操作），
   * 所以这里可以无条件调用。
   *
   * ⚠️ 提醒的**动作**全部来自 hook（唯一一处 `createReminderActions`）；
   * 本文件只管把它们摆到共享 `ReminderList` 上。
   */
  const {
    reminders,
    error: reminderError,
    addBeforeDue,
    addAbsoluteInOneHour,
    snooze,
    dismiss,
    remove: removeReminder,
  } = useTaskReminders(taskId);

  const reminderLabels = useMemo(() => reminderListLabels(t), [t]);

  /**
   * 清单排程预览（时间线重画 2026-10-01：板上不再画任务内部的清单甘特图，
   * 那个能力**降级到这里** ——「点开看」，且共享层会标明它是任务内部坐标系）。
   * 纯函数；`task` 变了才重算。提前 return 之前调用（hook 顺序纪律）。
   */
  const planBlock = useMemo(
    () =>
      task === undefined
        ? null
        : planTimelineBlock({ id: task.id, title: task.title, note: task.note }),
    [task],
  );
  const planLabels = useMemo(() => timelineLabels(t).plan, [t]);

  // 🔴 只按**任务 id 与可见性**重同步，依赖里**刻意没有** `task.title`。
  // 带上它的话，正在打字时只要有一次后台同步回来（或冲突解决改了标题），
  // 输入框里的草稿会被直接冲掉 —— 而且用户看到的只是"字自己变了"。
  // 代价是：面板开着时别处改了标题，这里不会实时跟着变。这个取舍是刻意的，
  // 因为"保住用户正在打的字"比"显示别处的最新值"重要。
  useEffect(() => {
    setTitle(task?.title ?? '');
    // 备注同理，而且它比标题更怕被冲掉 —— 备注更长、写起来更慢。
    setNote(task?.note ?? '');
  }, [taskId, visible]);

  /**
   * 每次面板打开时收起「新建清单」那一行。
   *
   * 不收的话：上次敲了一半的名字会留在下一次打开的面板里，
   * 而用户已经换了一条任务 —— 看起来像"新建清单的输入框有自己的记忆"。
   */
  useEffect(() => {
    setNewListOpen(false);
    setNewListName('');
  }, [taskId, visible]);

  /**
   * 改父。**必须自己接住拒绝** —— 通用的 `run()` 只 `.then(onChanged)`，
   * 没有 `.catch`，而 `setParent` 在环 / 超深 / 超子数时**会 throw**
   * ⇒ 直接交给 `run` 会变成一条 **unhandled rejection**，
   * 用户看到的是"点了没反应"，控制台里才有原因。
   *
   * ⚠️ 显示的是**词条里的人话**，不是 `cause.message` ——
   * 后者是给开发者的诊断串（含原始 id）。与 web 侧同一条纪律。
   */
  const runSetParent = useCallback(
    (parentId: string | undefined): void => {
      setParentError('');
      setBusy(true);
      void actions
        .setParent(task?.id ?? '', parentId)
        .then(onChanged)
        .catch((cause: unknown) => {
          setParentError(t(subtaskRejectionMessageKey(rejectionReasonOf(cause)) as MessageKey));
        })
        .finally(() => {
          setBusy(false);
        });
    },
    [actions, onChanged, t, task?.id],
  );

  const run = useCallback(
    (p: Promise<unknown>) => {
      setBusy(true);
      void p
        .then(onChanged)
        .finally(() => {
          setBusy(false);
        });
    },
    [onChanged],
  );

  /**
   * 提交标题。**空标题不提交** —— `rename` 会抛错，而用户把标题清空
   * 通常只是打字过程中的一步，不是"我要一个没有标题的任务"。
   */
  const commitTitle = useCallback((): void => {
    if (task === undefined) return;
    const next = title.trim();
    if (next === '' || next === task.title) return;
    run(actions.rename(task.id, next));
  }, [task, title, run, actions]);

  /**
   * 提交备注。**清空 = 清除**（传 `undefined`，`app-host` 写成 `null`）。
   *
   * 🔴 在它之前移动端**没有任何备注输入框** —— `Task.note` 与 `setNote` 都在，
   * 但唯一调用点是 AI（拆解 checklist / 估时写时长）。也就是说这条任务上的备注
   * 只能由 AI 写，用户自己写不了（见 `docs/research/dida365-feature-benchmark.md` §3 #4）。
   *
   * 与标题同样**离开输入框才提交**：备注更长，每敲一个字写一条 op 会把 op-log
   * 灌满噪音（AGENTS.md §3.4 的"一个用户意图 = 一个 op"）。
   */
  const commitNote = useCallback((): void => {
    if (task === undefined) return;
    const trimmed = note.trim();
    const next = trimmed === '' ? undefined : note;
    // 没变就不写 —— 否则"点开详情又退出"会给每条任务白写一条 op。
    if (next === (task.note === undefined || task.note === '' ? undefined : task.note)) return;
    run(actions.setNote(task.id, next));
  }, [task, note, run, actions]);

  const close = useCallback((): void => {
    commitTitle();
    // 🔴 收起面板也要提交备注。只在 `onBlur` 提交的话，用户写完直接点「关闭」
    // 会丢掉刚打的字 —— 而移动端上"写完就关"是最常见的动作。
    commitNote();
    onClose();
  }, [commitTitle, commitNote, onClose]);

  /**
   * 自定义 RRULE 的输入草稿与错误（B2-3 的移动端尾巴）。
   *
   * 🔴 在这一刀之前，**移动端只能选预设**：web 上能填
   * `FREQ=WEEKLY;INTERVAL=2`，手机上填不了 —— 同一件能力两端不一致
   * （"每两周"这种规则在手机上只能**看见**、不能**设置**）。
   *
   * `customError` 存的是**词条 key**，不是拼好的句子：错误文案必须跟着语言走
   * （与 `subtaskRejectionMessageKey` 同一个形状）。
   *
   * 🔴🔴 **这两个 `useState` 与下面的 `useCallback` 必须待在这一行之上。**
   * 紧跟着的 `if (task === undefined) return null;` 是一个**提前返回**：
   * 把 hook 放在它之后，"面板打开"（`task` 从 `undefined` 变成有值）那一次渲染
   * 就会**多出几个 hook** —— React 直接抛
   * `Rendered more hooks than during the previous render`。
   * release 包里没有红屏，表现是**应用凭空消失**（`am_crash` 里只留下
   * `at TaskDetailSheet`）。这个 bug 是本刀实测崩出来的，不是设想。
   */
  const [customDraft, setCustomDraft] = useState('');
  const [customError, setCustomError] = useState<MessageKey | undefined>(undefined);

  /**
   * 应用自定义规则。
   *
   * 🔴 **非法输入就地报错，且一条 op 都不写** —— 不靠"写失败"来发现串不合法。
   * 判据是领域层的 `isValidRecurrenceRule`（与 web 的 `TaskRepeat` 同一份）：
   * 空串与 `FREQ=` 都进不去，而它们能通过"看起来像 RRULE"的粗略检查。
   */
  const applyCustomRule = useCallback(() => {
    // 提前返回之后 `task` 一定有值，但那一条在 hook 之后才成立 —— 这里自己兜一次。
    if (task === undefined) return;
    const rule = customDraft.trim();
    if (rule === '') {
      setCustomError('mobile.detail.repeat.error.empty');
      return;
    }
    if (!isValidRecurrenceRule(rule)) {
      setCustomError('mobile.detail.repeat.error.invalid');
      return;
    }
    setCustomError(undefined);
    run(actions.setRepeat(task.id, rule));
  }, [customDraft, actions, task, run]);

  if (task === undefined) return null;

  const dueLocal = task.dueDate === undefined ? undefined : toLocalDate(task.dueDate);
  const todayLocal = toLocalDate(now);
  const done = task.completedAt !== undefined;
  /**
   * 当前是否"重要"。
   *
   * 🔴 用 `isImportant()` 而不是裸的 `task.important`：后者是后加字段，
   * 老数据没有它，直接读会得到 `undefined`（开关显示"关"），
   * 而 `isImportant` 会回退到优先级推导（HIGH 视为重要）。
   * 用裸字段会让**详情页与象限视图各说一套**：详情说"不重要"，
   * 任务却在 Q1 —— 用户只会认为象限坏了。
   */
  const important = isImportant(task);

  /**
   * 重复规则的锚点。
   *
   * 🔴 **必须与 `TaskActions.setRepeat` 将要钉的锚点一模一样**
   * （`dueDate ? toLocalDate(dueDate) : today()`）。差一天的话，
   * 面板上"每周"高亮着的那一项，对应的却是锚点那一周的另一天 ——
   * 用户点「每周」得到的是"每周二"，而界面上没有任何地方会显示这件事。
   */
  const repeatAnchor = dueLocal ?? todayLocal;
  const repeat = actions.repeatOf(task.id);
  /** 当前规则恰好等于哪个预设（都不是则为 `undefined`，走"自定义"那条展示）。 */
  const activePreset = repeat === undefined
    ? undefined
    : REPEAT_PRESET_IDS.find((id) => repeatPresetRule(id, repeatAnchor) === repeat.rule);
  /** 规则存在、但不属于任何预设（例如另一台设备上设的"每两周"）。 */
  const customRule = repeat !== undefined && activePreset === undefined ? repeat.rule : undefined;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      {/* 遮罩。**刻意不进无障碍树。**
          理由有两条，第二条是实测踩出来的：

          1. 它的作用只是"点空白处关掉"，而读屏用户已经有右上角那个
             **有名字的**关闭按钮。两个控件共用一个可访问名，读屏会把同一个
             名字念两遍，而它们做的是同一件事。
          2. 它的 bounds 覆盖整屏，于是"中心点"落在下半部分 ——
             而面板从底部升起、最高占 90%，中心点就压在**面板上**。
             按坐标点"关闭任务详情"会打到面板，面板关不掉
             （验收脚本实测：连点 5 步都没关掉，后面每一步都在面板还开着的
             状态下找列表行）。 */}
      <Pressable
        style={{ flex: 1, backgroundColor: tokens['material.scrim'] }}
        onPress={close}
        accessible={false}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View
          style={{
            backgroundColor: tokens['color.surface'],
            borderTopLeftRadius: tokens['radius.xl'],
            borderTopRightRadius: tokens['radius.xl'],
            // ⚠️ 只给纵向内边距，不给固定 height ——
            // 同一节点上同时给 height 与 padding 会让内容在被压缩的盒子里居中。
            paddingTop: tokens['space.4'],
            paddingBottom: tokens['space.8'],
            gap: tokens['space.3'],
            maxHeight: '90%',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: tokens['screen.gutter'],
            }}
          >
            <Text variant="section-title">{t('mobile.detail.title')}</Text>
            <IconButton
              icon="action.close"
              label={t('mobile.detail.close')}
              color={tokens['color.foreground-muted']}
              onPress={close}
            />
          </View>

          <ScrollView
            style={{ paddingHorizontal: tokens['screen.gutter'] }}
            contentContainerStyle={{ gap: tokens['space.4'], paddingBottom: tokens['space.2'] }}
            // 键盘弹起时，点快捷项/日期格应当直接生效而不是先收键盘
            keyboardShouldPersistTaps="handled"
          >
            <View style={{ gap: tokens['space.1'] }}>
              <Text variant="row-meta" tone="muted">
                {t('mobile.detail.field.title')}
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                onBlur={commitTitle}
                onSubmitEditing={commitTitle}
                returnKeyType="done"
                accessibilityLabel={t('mobile.detail.field.title')}
                placeholder={t('mobile.tasks.composer.placeholder')}
                placeholderTextColor={tokens['color.foreground-subtle']}
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
                    // ⚠️ 走归一化访问器。直接传 `tokens['font.sans']` 会把整条
                    // CSS 字体栈交给 RN，字体解析失败且**不报错**（已实测）。
                    fontFamily: native.fontSans,
                  },
                ]}
              />
            </View>

            <View style={{ gap: tokens['space.1'] }}>
              <Text variant="row-meta" tone="muted">
                {t('mobile.detail.field.note')}
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                onBlur={commitNote}
                multiline
                // 备注是长文本，不该被"完成"键打断 —— 收起键盘靠点别处或关闭面板。
                // 面板本身是 ScrollView，键盘弹起时有 KeyboardAvoidingView 兜着。
                numberOfLines={4}
                textAlignVertical="top"
                accessibilityLabel={t('mobile.detail.field.note')}
                placeholder={t('mobile.detail.note.placeholder')}
                placeholderTextColor={tokens['color.foreground-subtle']}
                style={[
                  text['row-meta'],
                  {
                    minHeight: tokens['touch-target.min'],
                    paddingHorizontal: tokens['space.3'],
                    paddingVertical: tokens['space.2'],
                    borderRadius: tokens['radius.md'],
                    borderWidth: tokens['border-width.thin'],
                    borderColor: tokens['color.border'],
                    backgroundColor: tokens['color.surface-sunken'],
                    color: tokens['color.foreground'],
                    // ⚠️ 走归一化访问器。直接传 `tokens['font.sans']` 会把整条
                    // CSS 字体栈交给 RN，字体解析失败且**不报错**（已实测）。
                    fontFamily: native.fontSans,
                  },
                ]}
              />
              {/* 如实说明"什么时候存" —— 失焦才提交是刻意的，
                  但用户看不见这条规则时会以为它已经在同步了。 */}
              <Text variant="row-meta" tone="muted">
                {t('mobile.detail.note.hint')}
              </Text>
            </View>

            {/* 清单排程预览：备注里写了清单（或 AI 拆解过）时才有内容可排。
                它是任务内部坐标系，与时间线板的关系由预览自己的说明文字标明。 */}
            {planBlock !== null && (
              <ChecklistPlanPreview block={planBlock} labels={planLabels} now={now} />
            )}

            <View style={{ gap: tokens['space.2'] }}>
              <SectionHeader icon="task.project" title={t('mobile.detail.field.project')} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.2'] }}>
                {/* 🔴 「收集箱」是**未归类**的显示名，不是一条真清单：
                    它对应 `projectId === undefined`，任何 PROJECT 实体里都没有它。
                    所以它是一个**选项**，但永远不参与增删改。 */}
                <Chip
                  label={t('mobile.detail.project.inbox')}
                  selected={task.projectId === undefined}
                  onPress={() => {
                    // 清除传 `undefined`，由 app-host 写成 `null`
                    // （见 `TaskActions.moveToProject`）。
                    run(actions.moveToProject(task.id, undefined));
                  }}
                />
                {projects.map((project) => (
                  <Chip
                    key={project.id}
                    label={project.name}
                    selected={task.projectId === project.id}
                    onPress={() => {
                      run(actions.moveToProject(task.id, project.id));
                    }}
                  />
                ))}
                {projectActions !== null && !newListOpen && (
                  <Chip
                    label={t('mobile.detail.project.create')}
                    selected={false}
                    icon="task.add"
                    onPress={() => {
                      setNewListOpen(true);
                    }}
                  />
                )}
              </View>

              {/* 行内新建：**建完立刻把这任务放进去**。
                  分两步（先去「我的」页建、再回来选）会让"边整理边建清单"
                  这个最常见的动作变成一次跨页往返。 */}
              {newListOpen && projectActions !== null && (
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: tokens['space.2'] }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      value={newListName}
                      onChangeText={setNewListName}
                      // 🔴 与段落标题「清单」**不同名**：同名会让无障碍树里
                      // 出现两个「清单」，按标签取节点就得靠 role 去猜。
                      accessibilityLabel={t('mobile.detail.project.newPlaceholder')}
                      placeholder={t('mobile.detail.project.newPlaceholder')}
                      placeholderTextColor={tokens['color.foreground-subtle']}
                      autoFocus
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
                          fontFamily: native.fontSans,
                        },
                      ]}
                    />
                  </View>
                  <Button
                    label={t('mobile.detail.project.create')}
                    tone="secondary"
                    disabled={newListName.trim() === ''}
                    onPress={() => {
                      const trimmed = newListName.trim();
                      if (trimmed === '') return;
                      // 两步走的是**两个用户意图 = 两个 op**（建清单、把任务放进去），
                      // 不是一条混合实体 op —— reducer 不支持后者，会静默不生效
                      // （见 `packages/domain/src/entities.ts` 里 repeatRule 那段）。
                      run(
                        projectActions.createProject(trimmed).then((id) => actions.moveToProject(task.id, id)),
                      );
                      setNewListOpen(false);
                      setNewListName('');
                    }}
                  />
                </View>
              )}
            </View>

            {/* 标签：与清单**并列但语义不同** —— 清单是"属于哪个容器"（单选），
                标签是"还跟什么有关"（多选）。所以这里是开关式的 Chip，
                不是一个"选中就切换"的互斥组。

                🔴 每次点击都写**整组**（`setTags`），一条 op。
                在界面里维护"待改动集合"再一次性提交是另一种做法，但那会让
                "点了之后立刻同步"变成"要点保存才同步"，而这一屏的其他字段
                （截止日、重复、优先级）全是即点即写 —— 不一致的交互更贵。 */}
            <View style={{ gap: tokens['space.2'] }}>
              {/* ── 子任务（上级任务）──────────────────────────────────────
                  🔴 在它之前：`packages/domain/src/subtasks.ts`（616 行，建树 + 环防护 +
                  深度/子数上限）与 `app-host` 的 `setParent` **都已经写好**，
                  但移动端**一次调用点都没有** —— 于是"模型支持、树能建、
                  用户没有任何办法造出一个子任务"，且**不报错**。
                  （Web 端本轮已补，这里是移动端的那一半。） */}
              <View style={{ gap: tokens['space.2'] }}>
                <SectionHeader icon="task.project" title={t('mobile.detail.field.parent')} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.2'] }}>
                  <Chip
                    label={t('mobile.detail.parent.topLevel')}
                    selected={task.parentId === undefined}
                    onPress={() => {
                      runSetParent(undefined);
                    }}
                  />
                  {/* 🔴 候选**预先过滤**：用领域层的 `canSetParent`，不是"id 不等于自己"。
                      后者会漏掉"后代"这一整类 ⇒ 用户能选出**造出环**的组合，
                      而环的后果是树构建/折叠/计数**无限递归**。 */}
                  {tasks
                    .filter((t2) => t2.deletedAt === undefined)
                    .filter((t2) => canSetParent(tasks, task.id, t2.id))
                    .map((t2) => (
                      <Chip
                        key={t2.id}
                        label={t2.title}
                        selected={task.parentId === t2.id}
                        onPress={() => {
                          runSetParent(t2.id);
                        }}
                      />
                    ))}
                </View>
                {parentError !== '' && (
                  <Text variant="row-meta" tone="danger">
                    {parentError}
                  </Text>
                )}
              </View>

              <SectionHeader icon="task.tag" title={t('mobile.detail.field.tags')} />
              {tags.length === 0 ? (
                <Text variant="caption" tone="subtle">
                  {t('mobile.detail.tags.empty')}
                </Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.2'] }}>
                  {tags.map((tag) => {
                    const assigned = task.tagIds?.includes(tag.id) ?? false;
                    return (
                      <Chip
                        key={tag.id}
                        label={tag.name}
                        selected={assigned}
                        onPress={() => {
                          const current = task.tagIds ?? [];
                          // 去重与"空数组写 null"都由 app-host 的 `setTags` 决定，
                          // 这里只负责算出用户想要的那一组。
                          const next = assigned
                            ? current.filter((id) => id !== tag.id)
                            : [...current, tag.id];
                          run(actions.setTags(task.id, next));
                        }}
                      />
                    );
                  })}
                </View>
              )}
            </View>

            <View style={{ gap: tokens['space.2'] }}>
              <SectionHeader icon="task.due" title={t('mobile.detail.field.dueDate')} />
              <DatePicker
                value={dueLocal}
                today={todayLocal}
                onChange={(date) => {
                  // 🔴 清除传 `undefined`，由 app-host 写成 `null`
                  // （见 `TaskActions.setDueDate` 的注释）。
                  run(actions.setDueDate(task.id, date === undefined ? undefined : dueDateToEpoch(date)));
                }}
              />
            </View>

            <View style={{ gap: tokens['space.2'] }}>
              <SectionHeader icon="task.repeat" title={t('mobile.detail.field.repeat')} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.2'] }}>
                <Chip
                  label={t('mobile.detail.repeat.none')}
                  selected={repeat === undefined}
                  onPress={() => {
                    run(actions.setRepeat(task.id, undefined));
                  }}
                />
                {REPEAT_PRESET_IDS.map((id) => (
                  <Chip
                    key={id}
                    label={t(REPEAT_LABEL_KEYS[id])}
                    selected={activePreset === id}
                    onPress={() => {
                      const rule = repeatPresetRule(id, repeatAnchor);
                      // 锚点非法时 `repeatPresetRule` 返回 undefined。
                      // 这里**什么都不做**而不是发一条垃圾规则：一条
                      // `BYDAY=undefined` 能通过 `isValidRecurrenceRule`
                      // （FREQ 还在），但一次都不命中 —— 静默的空规则最难查。
                      if (rule === undefined) return;
                      run(actions.setRepeat(task.id, rule));
                    }}
                  />
                ))}
                {/* 不属于任何预设的规则（例如另一台设备设的"每两周"）。
                    **必须显示出来**，否则面板看上去像"这条任务不重复"，
                    而用户一点「每天」就把那条规则悄悄换掉了。 */}
                {customRule !== undefined && (
                  <Chip
                    label={describeRecurrenceText(customRule, t, locale)}
                    selected
                    icon="task.repeat"
                    onPress={() => {
                      run(actions.setRepeat(task.id, undefined));
                    }}
                  />
                )}
              </View>
              {repeat !== undefined && (
                <Text variant="row-meta" tone="muted">
                  {t('mobile.detail.repeat.current', {
                    rule: describeRecurrenceText(repeat.rule, t, locale),
                  })}
                </Text>
              )}
              {/*
                自定义 RRULE（B2-3 的移动端尾巴）。

                🔴 在此之前**移动端只能选预设** —— 用户想要"每两周"就得去网页上设，
                而手机上那条规则只能看见、不能改。输入框与按钮都用**已有的**
                `TextField` / `Button`（样式在 `ui/kit.tsx` 里，本文件不新增内联样式：
                `screens/**` 的内联样式是**只减不增**的棘轮，见 `check:l4-no-style`）。

                ⚠️ 错误文案走 `hint` + `hintTone="danger"`：不额外挂一个错误块，
                否则"合法但没提交"时那块空白会一直占位。
              */}
              <TextField
                label={t('mobile.detail.repeat.customLabel')}
                value={customDraft}
                onChangeText={(next) => {
                  setCustomDraft(next);
                  // 用户开始改输入，就把上一次的错误收掉 —— 否则他改对了
                  // 那句红字还挂着，看起来像"改了也没用"。
                  if (customError !== undefined) setCustomError(undefined);
                }}
                placeholder={t('mobile.detail.repeat.customPlaceholder')}
                hint={customError === undefined ? t('mobile.detail.repeat.customHint') : t(customError)}
                hintTone={customError === undefined ? 'subtle' : 'danger'}
              />
              <Button
                label={t('mobile.detail.repeat.customApply')}
                tone="ghost"
                onPress={applyCustomRule}
              />
            </View>

            {/*
              提醒（B1-1 的界面层）。
              ============================================================
              🔴 面板挂在**任务详情**里，不是第 6 个 tab —— ADR-0015 §4 与 P10
              已经判决过"底部标签保持 5 个"，而且 `scripts/verify-mobile-*`
              按坐标（108/324/540/756/972）寻址标签栏。

              🔴 整块的标题、空态、状态徽标、按钮排布全在共享 `ReminderList` 里
              （web 与移动同一份源码），本文件只把 hook 的动作与文案摆上去。
              因此这里**不再套一个 `<SectionHeader>`**：组件自己会渲染
              `labels.title` 作为区段标题，套两层会出现两个"提醒"。

              ⚠️ 刻意**没有**外包一层 `View style={{ gap }}`：一来组件内部
              已有 `space.3` 的纵向间距，二来 `screens/**` 的内联样式有
              **只减不增**的基线（`check:l4-no-style` 断言 C），
              这里不必新增一处。
            */}
            <ReminderList
              reminders={reminders}
              // 显式传 `now` —— 跨过触发点时徽标要跟着从"待触发"变"已到点"；
              // `useToday()` 在回到前台与跨零点时会刷新它（见 `lib/use-today.ts`）。
              now={now}
              // 没有截止时间时，共享组件只留**绝对时刻**那一个入口，
              // 并显示 `labels.noDueDate` 解释原因 —— 它**不会**渲染
              // 写着「截止时」的按钮（那个按钮按下去必然抛错）。
              hasDueDate={task.dueDate !== undefined}
              onAdd={addBeforeDue}
              onAddAbsolute={addAbsoluteInOneHour}
              onSnooze={snooze}
              onDismiss={dismiss}
              onRemove={removeReminder}
              labels={reminderLabels}
              // 🔴 时刻格式化注入移动端唯一的实现：**不用 `Intl`**
              // （Hermes 上 Intl 是可选编译的，拿不到会抛）。见 `lib/date.ts`。
              formatWhen={formatStamp}
              testID="task-reminders"
            />
            {/*
              动作抛错必须**看得见**（任务没有截止时间、超过每任务上限）。
              原始信息是**数据**不是文案，所以**不翻译** —— 要能拿去搜索/对照日志
              （与 `HabitsScreen` / `ProfileScreen` 的错误显示同一条分工）。
            */}
            {reminderError !== null ? (
              <Text variant="caption" tone="danger" selectable>
                {reminderError}
              </Text>
            ) : null}

            <View style={{ gap: tokens['space.2'] }}>
              <SectionHeader icon="task.priority" title={t('mobile.detail.field.priority')} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.2'] }}>
                {PRIORITY_ORDER.map((p) => (
                  <Chip
                    key={String(p)}
                    label={priorityLabel(p, t)}
                    selected={(task.priority ?? Priority.None) === p}
                    color={tokens[priorityColorToken(p)]}
                    onPress={() => {
                      run(actions.setPriority(task.id, p));
                    }}
                  />
                ))}
              </View>
            </View>

            {/* 四象限的第一个轴。
                🔴 **为什么这里只有一个开关、没有第二个**：紧急由 `dueDate` 推导，
                   让人再填一遍就是重复劳动，而且两个字段一定会不一致
                   （ADR-0015 §3）。所以用户只回答"这件事重要吗"。

                🔴 **为什么读的是 `isImportant(task)` 而不是 `task.important`**：
                   `important` 是后加字段，老数据没有它。直接读会得到 `undefined`
                   → 开关显示为"关"，而 `isImportant` 会回退到优先级推导
                   （HIGH 视为重要）。用裸字段会造成**界面与象限视图不一致**：
                   详情页说"不重要"，象限里它在 Q1。 */}
            <View style={{ gap: tokens['space.2'] }}>
              <SectionHeader icon="task.priority" title={t('mobile.detail.field.important')} />
              <Chip
                label={
                  important
                    ? t('mobile.detail.important.off')
                    : t('mobile.detail.important.on')
                }
                selected={important}
                onPress={() => {
                  run(actions.setImportant(task.id, !important));
                }}
              />
              <Text variant="row-meta" tone="muted">
                {t('mobile.detail.important.hint')}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: tokens['space.2'] }}>
              <Button
                label={
                  done ? t('mobile.detail.markIncomplete') : t('mobile.detail.markComplete')
                }
                tone="secondary"
                icon={done ? 'task.reopen' : 'task.done'}
                loading={busy}
                onPress={() => {
                  run(actions.setCompleted(task.id, !done));
                }}
                style={{ flex: 1 }}
              />
              <Button
                label={t('mobile.detail.delete')}
                tone="danger"
                icon="task.delete"
                loading={busy}
                onPress={() => {
                  // 删除后立刻收起面板：留在一个"不存在的任务"详情上是死路
                  run(actions.remove(task.id));
                  onClose();
                }}
                style={{ flex: 1 }}
              />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
