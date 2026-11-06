/**
 * 任务详情面板
 * ==============
 *
 * 2026-11：从"编辑表单"重排成 **内容层 + 折叠层**
 * （`docs/plans/task-detail-ticktick-parity.md` §3 #7 / #8）。
 *
 * 重排前的形状是 13 个区段**一次性全展开**：带"标题"标签的输入框、备注、排程预览、
 * 清单、上级任务、标签、截止、排期、重复（含自定义 RRULE 输入框）、提醒、优先级、
 * 重要、两个按钮。三宗罪（都是`docs/agents/ux-principles.md`上已写明的判据）：
 *
 *   1. **首屏回答的是"这条记录有哪些列"**，不是"这是什么任务" —— 标题是一格输入框。
 *   2. 🔴 **动作区不常驻**（§3，判据 S1）：完成 / 删除在滚动内容**之外**，
 *      面板哪怕开在 0.6 档也要滚到底才够得着。现在它们走 `BottomSheet` 的
 *      `footer` —— 那块**不在** `ScrollView` 里（见 `packages/ui/src/overlay/BottomSheet.tsx`
 *      的 `styles.footer` 挂在 `Animated.View` 上、`ScrollView` 之后）。
 *   3. **没有"次要"这个概念**（§4，判据 S4）：13 段平铺。
 *      现在收起态只画"属性名 → 当前值"一行，**编辑控件在收起态一个都不渲染**
 *      （`{open ? children : null}`，不是 `display:none`）。
 *
 * 结构：
 *
 *   把手 + 标题栏（拖拽由原语负责）
 *   ├─ 头部三件套：清单切换 ⌄ / 优先级旗标 / ⋯（展开全部）
 *   ├─ 内容层（常驻可见，不折叠）：勾选框 → 日期状态行（含「顺延到今天」）→
 *   │   标题正文（大字，点击进入编辑）→ 备注正文 → 排程预览
 *   ├─ 折叠层：截止（日期状态行本身就是它的触发器）· 提醒 / 重复 / 排期 /
 *   │   优先级 / 重要 / 清单 / 上级任务 / 标签
 *   └─ 底部常驻动作条：完成（或取消完成）/ 删除 / 关闭
 *
 * 面板的 `title`（原语的**可访问名称**，也是它唯一渲染的标题文字）现在给的是
 * **这条任务所属的清单名**：原来那句"任务详情"不回答任何问题，而"这条挂在哪个容器下"
 * 是首屏缺的那一格上下文；任务本体由内容层的大字标题回答。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 几个刻意的交互决定（重排后仍然成立）
 *
 * 1. **点任务行打开详情，不再切换完成**（行上的主操作是"打开它"）；面板内的
 *    完成有**两处**入口：内容层的勾选框 + 底部常驻动作条，都不需要滚动。
 * 2. **每个控件改完立即写**（一处意图 = 一个 op，AGENTS.md §3.4）。
 *    标题是**唯一**例外：它必须等内容确定，所以离开输入框 / 收起面板时才提交 ——
 *    每敲一个字写一个 op 会把 op-log 灌满噪音。
 * 3. **档位记忆落在设备本地偏好**（`prefs/device-prefs`，与「排序档位」同一张表、
 *    同一条"永不抛"契约）：原语的优先级是 记忆 > `defaultDetent` > medium，
 *    所以用户上次拖到哪一档，下次打开还在那一档。
 *
 * 🔴 本文件里**没有一行业务逻辑**：写哪些字段、清除写成 `null` 还是 `undefined`、
 * 删除是软删还是硬删、"推到哪算顺延"、"什么算逾期"，全部来自
 * `@heyta/app-host` 的 `createTaskActions` 与 `@heyta/domain` 的 `computeCountdown`
 * （经 `lib/due-display.ts` 复用同一份，没有第二套日期算术）。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, TextInput, View } from 'react-native';
// 🔴 选择器用的是**已有的**那一枚依赖（头像那一条链已经在用它）。
// 附件这一刀因此没有引入任何新依赖（AGENTS §3.1/§3.2 那两道门不在这里被绕过）。
import { pick } from '@react-native-documents/picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Priority,
  attachmentSizeIn,
  buildTaskTree,
  canSetParent,
  dueDateToEpoch,
  formatCompactLocalDate,
  isCompleted,
  isImportant,
  // 🔴 自定义 RRULE 的合法性判据 —— 与领域层同一份（B2-3 的移动端尾巴）。
  isValidRecurrenceRule,
  localTimeOf,
  toLocalDate,
  type Project,
  type Tag,
  type Task,
} from '@heyta/domain';
import type { MessageKey } from '@heyta/i18n';
import { useI18n } from '@heyta/i18n';
import { MAX_ATTACHMENT_BYTES } from '@heyta/shared-schema';
import {
  REPEAT_PRESET_IDS,
  planTimelineBlock,
  readTaskActivity,
  repeatPresetRule,
  type AttachmentActions,
  type ProjectActions,
  type RepeatPresetId,
  type TaskActions,
  type TaskActivityOpSource,
  type TaskActivityRead,
} from '@heyta/app-host';
import {
  BottomSheet,
  ChecklistPlanPreview,
  ReminderList,
  SHEET_DETENTS,
  TaskRow,
  formatDuration,
  priorityColorToken,
  rejectionReasonOf,
  subtaskRejectionMessageKey,
  taskActivityCoverageMessageKey,
  taskActivityDeviceMessageKey,
  taskActivityFieldMessageKeys,
  taskActivityKindMessageKey,
  toTaskRow,
  type SheetDetent,
  type TaskRowLabels,
} from '@heyta/ui';

import { formatStamp } from '../lib/date';
import { readPickedDocument, type AttachmentPickError } from '../lib/attachment-pick';
import { dueTone, toDueDisplay } from '../lib/due-display';
import { PRIORITY_ORDER, priorityLabel } from '../lib/priority';
import { describeRecurrenceText } from '../lib/recurrence-display';
import { reminderFaceNotice } from '../lib/reminder-delivery-display';
import { reminderListLabels } from '../lib/reminders-display';
import { timelineLabels } from '../lib/timeline-labels';
import { useTaskReminders } from '../lib/reminders';
import { useReminderDelivery } from '../lib/use-reminder-delivery';
import { readDevicePref, writeDevicePref } from '../prefs/device-prefs';
import { useText, useTheme, useTokens } from '../theme';
// 🔴 DatePicker 已上提到共享层（批一，多端入口覆盖 goal §2）：
// web 补 due 编辑时两端要同一只选择器。本地的 `ui/DatePicker.tsx` 已删 ——
// 消费共享份，不留第二份（AGENTS §3.5 的收尾纪律）。
import { DatePicker } from '@heyta/ui';
import { datePickerLabels, datePickerTimeLabels } from '../lib/date-picker-labels';
import { quickDatePicks } from '../lib/quick-dates';
import { Icon } from '../ui/icons';
import { Button, Chip, HStack, IconButton, Stack, Text, TextField } from '../ui/kit';

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
  yearly: 'mobile.detail.repeat.yearly',
};

/**
 * 读文件那一步的失败 → 界面那一句话。
 *
 * 🔴 用 `Record<AttachmentPickError, MessageKey>`（穷尽表）而不是一个带默认值的映射：
 * 以后新加一种错误码却忘了配文案，这里直接编译不过，而不是运行时落到一句笼统的话。
 * 表里**没有**"取消"那一格，因为 `AttachmentPickError` 里就没有那一档 ——
 * 取消是 `pick()` 被拒，走下面那条 `OPERATION_CANCELED` 的分支，不该有句子。
 */
const PICK_ERROR_KEYS: Record<AttachmentPickError, MessageKey> = {
  'no-channel': 'mobile.detail.attachments.error.no-channel',
  'too-large': 'mobile.detail.attachments.error.too-large',
  'read-failed': 'mobile.detail.attachments.error.read-failed',
};

/**
 * 上传被拒的 reason → 那句话。
 *
 * `rejectionReasonOf` 从动作层抛上来的 `（reason）` 括号里取词，词表与
 * `attachment-http.ts` 的 `AttachmentUploadResult.reason` 同源。
 * 认不出来的 reason 落回那句统称 —— **不是**落回"上传失败"里最像的那一条：
 * 猜错方向的提示比一句笼统的话更害人（本仓库在密码锁那一栏踩过这个坑）。
 */
const UPLOAD_ERROR_KEYS: Record<string, MessageKey> = {
  'too-large': 'mobile.detail.attachments.error.too-large',
  'quota-exceeded': 'mobile.detail.attachments.error.quota-exceeded',
  network: 'mobile.detail.attachments.error.network',
  'no-channel': 'mobile.detail.attachments.error.no-channel',
};
const UPLOAD_FALLBACK_KEY: MessageKey = 'mobile.detail.attachments.error.rejected';

/**
 * 折叠层的区段。
 *
 * 🔴 这一张表只管**界面上有哪几格可展开**，不表达任何业务优先级 ——
 * 它是 `accessibilityState.expanded` 与「⋯ 展开全部」的公共依据，
 * 所以必须是一处定义（否则"展开全部"会漏掉某一段，而漏掉的那段看不见）。
 */
const SECTION_IDS = [
  'reminders',
  'repeat',
  'schedule',
  'priority',
  'important',
  'project',
  'parent',
  'tags',
  'activity',
] as const;

type SectionId = (typeof SECTION_IDS)[number];

type OpenSections = Partial<Record<SectionId, boolean>>;

/**
 * 档位记忆落在**设备本地偏好**（`prefs/device-prefs`）。
 *
 * 🔴 为什么落这里而不是同步实体：面板开在多高是"这台设备这块屏"的事，
 * 跟账号跑到另一台设备上没有任何意义（与 `task.sort` 同一格判断，
 * 见 `lib/task-sort.ts` 的 `PREF_KEY_TASK_SORT`）。
 * ⚠️ `device-prefs` 的契约是**永不抛**，读不到就 `undefined` —— 那时由原语
 * 按 记忆 > 默认档 > medium 的链子回落，界面不自己猜。
 */
const PREF_KEY_TASK_DETAIL_DETENT = 'taskDetailSheet.detent';

/** 盘上的字符串 → 档位。不在允许集合内（值被写坏 / 档位模型改过）就当没记住。 */
function readRememberedDetent(): SheetDetent | undefined {
  const raw = readDevicePref(PREF_KEY_TASK_DETAIL_DETENT);
  if (raw === undefined) return undefined;
  // 🔴 校验用的是**共享层那张档位表**，不是本地抄的三个字面量 ——
  // 原语那边 `resolveInitialDetent` 也会再判一次（不变量 2），两处读同一份定义才可能对得上。
  return (SHEET_DETENTS as readonly string[]).includes(raw) ? (raw as SheetDetent) : undefined;
}

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
  onOpenSubtask,
  activitySource,
  attachmentActions,
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
  /**
   * 打开某条**子任务**的详情。不传时子任务行整行不可点（共享 `TaskRow` 的契约：
   * 「不给 `onOpenTask` = 行不可点」，而不是降级成"点一下就切换完成" ——
   * 那个默认值会让忘了传变成**误改数据**）。
   *
   * 🔴 归派由宿主决定，本文件不判断"点子任务该算什么"：现在移动端把它接成
   * `selection.select('task', id)`，也就是把面板切到那条子任务上。
   */
  onOpenSubtask?: (taskId: string) => void;
  /**
   * 「任务动态」那一格的读数来源 = 本机的 op-log（`host.engine` 直接满足这个形状）。
   *
   * 🔴 传 `null` 时这一格**整格不出现**，而不是出现但空着：这条流水说的是
   * "这台设备上记录到的变更"，没有日志来源就没有这句话可说，画一个空列表会
   * 被读成"这条任务没被改过" —— 那是不实陈述。
   *
   * ⚠️ 它只能是**本地**日志：服务端从设计上看不到明文 op（E2EE 那条），
   * 也没有"问服务端要这条任务的历史"这条路。
   */
  activitySource: TaskActivityOpSource | null;
  /**
   * 附件动作集（工单 #9），由宿主用**它自己的**服务端地址与令牌拼好再传进来。
   *
   * 🔴 这一屏不读同步配置、不拼 URL、不碰令牌：那些是宿主的事（AGENTS §3.5）。
   * 传 `null` 时那一格**整格不出现** —— 与「任务动态」同一套立场：没有来源就没有
   * 那句话可说，画一个空的"附件"区会被读成"这条任务没有附件"，而真相是
   * "这台设备还没接上附件通道"。
   */
  attachmentActions: AttachmentActions | null;
}): React.JSX.Element | null {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const text = useText();
  const { native, reducedMotion } = useTheme();
  const { t, locale } = useI18n();

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  /** 行内「新建清单」的输入态与草稿名。 */
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  /** 行内「添加子任务」的输入态、草稿名与被拒时的人话（空串 = 没有错误）。 */
  const [newSubtaskOpen, setNewSubtaskOpen] = useState(false);
  const [newSubtaskName, setNewSubtaskName] = useState('');
  const [subtaskError, setSubtaskError] = useState('');
  /** 行内「新建标签」的输入态与草稿名（标签区没有它时，那句空态文案就无处可指）。 */
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  /**
   * 附件（工单 #9）的三个状态。
   *
   * ⚠️ `attachmentBusy` 与 `pendingRemoveId` 都是**防重复**的：上传是一次网络往返，
   * 连点两下会传两份字节，而第二份的 op 会因为 id 不同而真的多出一条附件 ——
   * 数据层拦不住这件事（两个都是合法意图），只能在提交期间禁用入口。
   * `pendingRemoveId` 是二次确认的那一条（见 `runRemoveAttachment`）。
   */
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  /** 二次确认的超时句柄（超时就退回「移除」，不让按钮永久停在"再点一次"）。 */
  const removeConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 改父被拒时的**人话**（空串 = 没有错误）。 */
  const [parentError, setParentError] = useState('');
  /**
   * 折叠层：哪些区段是展开的。缺省**全部收起**（§4「配置项默认收起」）。
   *
   * 🔴 展开态只存在内存里，**不落盘**：换一条任务还保持上次展开着哪几格，
   * 读起来像"面板记得我刚才动过谁"，而用户已经在看另一条任务了。
   */
  const [openSections, setOpenSections] = useState<OpenSections>({});
  /** 截止日期那一格的展开态（它的触发器就是内容层的日期状态行）。 */
  const [dueOpen, setDueOpen] = useState(false);
  /** 标题 / 备注：正文态与编辑态。默认正文态 —— 首屏不是表单（§1 的判据）。 */
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  /** 上次拖到哪一档（`undefined` = 还没记过，交给原语的默认链子）。 */
  const [rememberedDetent, setRememberedDetent] = useState<SheetDetent | undefined>(
    readRememberedDetent,
  );

  const taskId = task?.id;

  /**
   * 「任务动态」是这一屏上**唯一**需要异步读的一格 —— 别的格子都是直接从实体
   * 上算出来的，而这条流水读的是本机 op-log（`getOpsForEntity` 是一次查询）。
   *
   * 🔴 状态里必须带 `taskId`：面板可以在不卸载的情况下从一条任务切到另一条
   * （内容层下面的"打开子任务"就是这条路）。不带的话，上一条任务的流水会
   * 画在当前任务下面 —— 界面看起来完全正常，而用户读到的是别人的历史。
   *
   * `read === null` 表示**读失败**，与"读到了、但一条都没有"是两件事，
   * 所以它们是两句不同的文案（把故障念成"这条任务没被改过"是不实陈述）。
   */
  const [activity, setActivity] = useState<{
    readonly taskId: string;
    readonly read: TaskActivityRead | null;
  } | null>(null);

  useEffect(() => {
    const current = task;
    if (activitySource === null || current === undefined) return;
    // 只在展开时读：没打开那一格也去查历史，等于把"看详情"变成"查流水"。
    if (openSections.activity !== true) return;
    let alive = true;
    void readTaskActivity(
      activitySource,
      { id: current.id, createdAt: current.createdAt },
      // 🔴 不带旧值/新值：这一格要说的是"改了什么字段"，而载荷里的旧值可能是
      // 另一条任务的标题之类；要显示值得先做逐字段的格式化（日期/优先级/清单），
      // 那是另一刀的范围。`includeValues: false` 让共享层根本不产出那些值。
      { includeValues: false },
    )
      .then((read) => {
        if (alive) setActivity({ taskId: current.id, read });
      })
      .catch(() => {
        if (alive) setActivity({ taskId: current.id, read: null });
      });
    return () => {
      alive = false;
    };
    // `task` 在依赖里：写完之后父层会刷新出一个新的实体对象，于是这一格
    // 自动重新读 —— 不需要再自己维护一个"变更计数"。
  }, [activitySource, task, openSections.activity]);

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
    uncertainOccurrences,
    error: reminderError,
    addBeforeDue,
    addAbsoluteInOneHour,
    snooze,
    dismiss,
    remove: removeReminder,
  } = useTaskReminders(taskId);

  const reminderLabels = useMemo(() => reminderListLabels(t), [t]);

  /**
   * 送达被系统闸门挡住时那一行降级状态（"到点不会响" / "可能迟到几分钟"）。
   *
   * 🔴 这一行的**全部意义**是"拒了之后看得见、并且有回头路"：授权一旦被系统拒掉，
   * 应用自己再也问不出第二个弹窗，所以这里必须同时给出跳系统设置的入口。
   * 判定（哪一句、这一行在这台设备上存不存在、一条都没有时不许报警）在
   * `lib/reminder-delivery-display.ts` 的纯函数里；本文件只做绑定（AGENTS §3.5）。
   *
   * ⚠️ 读数由 `useReminderDelivery()` 持有，与设置页那一节**同一份、同一套重读时机**，
   * 包括"答完系统弹窗"那一声 —— 那个弹窗不把应用退到后台，光靠 AppState 是等不来的。
   */
  const delivery = useReminderDelivery();
  const deliveryNotice = useMemo(
    () => (delivery.readings === null
      ? null
      : reminderFaceNotice(delivery.readings, Platform.OS, reminders, now)),
    [delivery.readings, reminders, now],
  );

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
  // 排期段（多端不同入口：触屏端在详情里排期，web 载荷用拖拽 —— ADR-0043 §5）。
  const startLocal = task?.startDateLocal ?? (task?.startDate === undefined ? undefined : toLocalDate(task.startDate));
  /** 时长档位（分钟）。与 `setSchedule` 的夹取档一致，全落在 [5, 480] 内。 */
  const DURATION_CHIPS: readonly number[] = [30, 60, 120, 240];
  const durationChipLabel = (minutes: number): string =>
    formatDuration(minutes, planLabels.gantt);

  /**
   * 面板内用到的**全部**样式。
   *
   * 🔴 为什么集中在这里而不是各写 `style={{…}}`：`screens/**` 的内联样式是一条
   * **只减不增**的棘轮（`check:l4-no-style` 断言 C 数的是含 `style={{` 的行），
   * 而重排要新增不少行容器。写成 `useMemo` 出来的对象再按名字引用，
   * 一是把这一族几何决定收在一处，二是**不还债就新增违规**。
   * 取值仍然全部来自 token（断言 A 扫的是裸值，不是内联写法）。
   */
  const styles = useMemo(
    () => ({
      grow: { flex: 1 },
      /** 芯片组那一行：换行是内容驱动的，不是设计尺度。 */
      chipRow: {
        flexDirection: 'row' as const,
        flexWrap: 'wrap' as const,
        gap: tokens['space.2'],
      },
      /** 属性行（收起态那一行）：标签在左、值在右（§1 的 `inline` 解剖）。 */
      propRow: {
        alignItems: 'center' as const,
        gap: tokens['space.2'],
        minHeight: tokens['touch-target.min'],
      },
      propValue: { textAlign: 'right' as const },
      /** 头部三件套：清单名占满剩余宽度，两枚图标按钮靠右。 */
      headerRow: {
        alignItems: 'center' as const,
        gap: tokens['space.2'],
      },
      headerChip: {
        alignItems: 'center' as const,
        flexDirection: 'row' as const,
        // 长清单名要让位给右侧两枚图标按钮：`flexShrink` 是比例，不是设计尺度。
        flexShrink: 1,
        gap: tokens['space.1'],
        minHeight: tokens['touch-target.min'],
        paddingHorizontal: tokens['space.3'],
        borderRadius: tokens['radius.full'],
        backgroundColor: tokens['color.surface-sunken'],
      },
      pressed: { transform: [{ scale: tokens['motion.press-scale'] }] },
      /** 内容层的标题正文（大字 = "这是什么任务"）。 */
      /** 内容层的备注正文。 */
      contentNote: { color: tokens['color.foreground-muted'] },
      /** 行内新建清单那一格的输入框外观（与 `kit.TextField` 同一组 token）。 */
      listNameInput: {
        minHeight: tokens['touch-target.min'],
        paddingHorizontal: tokens['space.3'],
        borderRadius: tokens['radius.md'],
        backgroundColor: tokens['color.surface-sunken'],
        color: tokens['color.foreground'],
        fontFamily: native.fontSans,
      },
    }),
    [tokens, native],
  );

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
   * 每次换任务 / 重新打开面板：收起**所有**在途状态。
   *
   * 不收的话：上次敲了一半的清单名、展开到一半的区段会留在下一条任务的
   * 面板里，看起来像"这块面板有自己的记忆"。
   */
  useEffect(() => {
    setNewListOpen(false);
    setNewListName('');
    setOpenSections({});
    setDueOpen(false);
    setEditingTitle(false);
    setEditingNote(false);
  }, [taskId, visible]);

  const toggleSection = useCallback((id: SectionId): void => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const allSectionsOpen = SECTION_IDS.every((id) => openSections[id] === true);

  /** 「⋯」：一次展开全部属性区段，再点收起。判据就是 `SECTION_IDS` 那张表。 */
  const toggleAllSections = useCallback((): void => {
    setOpenSections((prev) => {
      const everyOpen = SECTION_IDS.every((id) => prev[id] === true);
      if (everyOpen) return {};
      const next: OpenSections = {};
      for (const id of SECTION_IDS) next[id] = true;
      return next;
    });
  }, []);

  /**
   * 记住档位（原语在拖拽吸附 / 点把手后回调）。
   *
   * ⚠️ 写不进（原生库不可用）时**不报警**：后果只是"下次打开回到默认档"，
   * 而 `device-prefs` 的契约是永不抛 + 由调用方决定怎么说。这里选择不在界面上
   * 为一次纯手势偏好占一行红字。
   */
  const rememberDetent = useCallback((next: SheetDetent): void => {
    setRememberedDetent(next);
    writeDevicePref(PREF_KEY_TASK_DETAIL_DETENT, next);
  }, []);

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
    // 编辑态是**输入框**的形状，关掉时把正文态交回来，
    // 否则下次打开会停在一格空输入框上（而首屏不该是表单）。
    setEditingTitle(false);
    setEditingNote(false);
    onClose();
  }, [commitTitle, commitNote, onClose]);

  /** Android back first dismisses the keyboard; a second back closes the sheet. */
  const handleRequestClose = useCallback((): void => {
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    close();
  }, [close]);

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

  /**
   * 🔴 与上面两个 hook 一样，**必须待在那条提前返回之上**（理由见 `customDraft`
   * 那一段：放在 `if (task === undefined) return null` 之后，"面板打开"那一次渲染
   * 会多出 hook，release 包里表现为应用凭空消失）。
   *
   * 就地添加子任务。**必须有 `.catch`**：`createSubtask` 在超深 / 超子数 / 父已删除时
   * 会 throw，而 `run` 不带 catch —— 交给它会变成一条 unhandled rejection，
   * 用户看到的是"点了没反应"（与 `runSetParent` 同一条教训）。
   *
   * 🔴 界面上**不判断**能不能建：上限由 app-host 问领域层拿答案。
   * 在这里预先禁用按钮等于把同一套规则写第二遍，两份规则迟早不一致。
   */
  const runAddSubtask = useCallback((): void => {
    if (task === undefined) return;
    const trimmed = newSubtaskName.trim();
    if (trimmed === '') return;
    setSubtaskError('');
    setBusy(true);
    void actions
      .createSubtask(task.id, trimmed)
      .then(() => {
        // 建完**清空草稿**：留着上一次的标题会让"再建一条"变成"改一条"，
        // 而用户按回车时会把上一条的名字又写一遍。
        setNewSubtaskName('');
        onChanged();
      })
      .catch((cause: unknown) => {
        setSubtaskError(t(subtaskRejectionMessageKey(rejectionReasonOf(cause)) as MessageKey));
      })
      .finally(() => {
        setBusy(false);
      });
  }, [actions, newSubtaskName, onChanged, t, task]);

  /**
   * 就地新建标签并**点亮到这条任务上**。两步 = 两个用户意图 = 两条 op，
   * 与「新建清单并放进去」同一形状（reducer 不支持混合实体的那条 op）。
   * `setTags` 是整组覆盖，所以传的是"现有的一组 + 新的那个"。
   */
  const runAddTag = useCallback((): void => {
    if (task === undefined || projectActions === null) return;
    const trimmed = newTagName.trim();
    if (trimmed === '') return;
    run(
      projectActions
        .createTag(trimmed)
        .then((tagId) => actions.setTags(task.id, [...(task.tagIds ?? []), tagId])),
    );
    setNewTagName('');
    setNewTagOpen(false);
  }, [actions, newTagName, projectActions, run, task]);

  /**
   * 加一个附件：选 → 读字节 → 传字节 → 发 op（工单 #9）。
   *
   * 🔴 **必须有 `.catch`**（与 `runAddSubtask` 同一条教训）：这条链上每一步都可能拒，
   * 而 `run` 不带 catch —— 交给它就是 unhandled rejection，用户看到的是"点了没反应"。
   *
   * 🔴 每一种失败各说一句人话，不许折叠：`no-channel` 是这台设备的事实
   * （换台电脑才行），`too-large` 要换一个文件，`quota-exceeded` 要清理已有内容，
   * `network` 可以原样再试。合成一句"上传失败"就会让一半的用户去做一件没用的事。
   *
   * ⚠️ `targetId` 在按下去那一刻就定下来：面板可以在不卸载的情况下切到另一条任务，
   * 用 `task.id` 收尾会把附件挂到**当时正在显示的那条**任务上，而不是用户
   * 选文件时看的那条。
   */
  const runAddAttachment = useCallback((): void => {
    if (task === undefined || attachmentActions === null || attachmentBusy) return;
    const targetId = task.id;
    const maxMb = String(Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024)));
    setAttachmentError('');
    setAttachmentBusy(true);
    void pick({ allowMultiSelection: false })
      .then(async (picked): Promise<void> => {
        const doc = picked[0];
        if (doc === undefined) return;
        const read = await readPickedDocument({
          uri: doc.uri,
          name: doc.name,
          type: doc.type ?? doc.nativeType,
          size: doc.size,
        });
        if (!read.ok) {
          setAttachmentError(t(PICK_ERROR_KEYS[read.error], { max: maxMb }));
          return;
        }
        await attachmentActions.addAttachment(targetId, {
          fileName: read.fileName,
          contentType: read.contentType,
          dataBase64: read.dataBase64,
        });
        onChanged();
      })
      .catch((cause: unknown): void => {
        // 系统选择器里按取消是**正常路径**，不是一句错误（头像那一条同一个处理）。
        if ((cause as { code?: string }).code === 'OPERATION_CANCELED') return;
        setAttachmentError(t(UPLOAD_ERROR_KEYS[rejectionReasonOf(cause) ?? ''] ?? UPLOAD_FALLBACK_KEY, { max: maxMb }));
      })
      .finally(() => {
        setAttachmentBusy(false);
      });
  }, [attachmentActions, attachmentBusy, onChanged, t, task]);

  /**
   * 移除附件。第一次点只把按钮翻成「再点一次确认移除」，第二次才真删。
   *
   * 🔴 为什么是**确认**而不是**撤销**：撤销做不到 —— 字节已经还给服务端了，
   * 而这条通道上没有读端点（原因见 `attachment-http-contract.ts`）。
   * 给不出撤销就不能假装给得起，只能把摩擦挪到动作前面
   * （`overlay-feedback` 那条"要么撤销、要么确认"）。
   *
   * ⚠️ 确认窗口会超时退回原样：不然按钮会一直停在"再点一次"，
   * 而用户早已忘了自己点过第一次。
   */
  const runRemoveAttachment = useCallback(
    (attachmentId: string): void => {
      if (attachmentActions === null || attachmentBusy) return;
      if (pendingRemoveId !== attachmentId) {
        setPendingRemoveId(attachmentId);
        if (removeConfirmTimer.current !== null) clearTimeout(removeConfirmTimer.current);
        removeConfirmTimer.current = setTimeout(() => {
          setPendingRemoveId(null);
        }, 6_000);
        return;
      }
      if (removeConfirmTimer.current !== null) {
        clearTimeout(removeConfirmTimer.current);
        removeConfirmTimer.current = null;
      }
      setPendingRemoveId(null);
      setAttachmentError('');
      setAttachmentBusy(true);
      void attachmentActions
        .removeAttachment(attachmentId)
        .then(() => {
          onChanged();
        })
        .catch((cause: unknown) => {
          setAttachmentError(t(UPLOAD_ERROR_KEYS[rejectionReasonOf(cause) ?? ''] ?? UPLOAD_FALLBACK_KEY));
        })
        .finally(() => {
          setAttachmentBusy(false);
        });
    },
    [attachmentActions, attachmentBusy, onChanged, pendingRemoveId, t],
  );

  // 换任务 / 卸载时把确认态与定时器清掉：留着会把"上一条任务上没点完的确认"
  // 带到这一条任务的附件上。
  useEffect(() => {
    setPendingRemoveId(null);
    setAttachmentError('');
    return () => {
      if (removeConfirmTimer.current !== null) {
        clearTimeout(removeConfirmTimer.current);
        removeConfirmTimer.current = null;
      }
    };
  }, [taskId]);

  if (task === undefined) return null;

  /**
   * 这一条任务上的附件（软删的不进、`createdAt` 升序）。
   *
   * 🔴 过滤与顺序都问动作层拿，本文件不 `filter(taskId === …)` ——
   * 写在这里就会出现"电脑上删掉的附件在手机上还在"，而 op-log 里两条记录都对。
   */
  const attachmentRows = attachmentActions?.attachmentsForTask(task.id) ?? [];
  /** 体积那一行的措辞：档位由领域层判（`attachmentSizeIn`），单位词在词条里。 */
  const attachmentSizeLabel = (bytes: number): string => {
    const size = attachmentSizeIn(bytes);
    return t(`mobile.detail.attachments.size.${size.unit}` as MessageKey, { n: size.value });
  };
  /**
   * 「添加附件」那枚入口的两态文案（上传中念"正在上传…"）。
   *
   * ⚠️ 与 `removeLabel` 同一条理由：`check:ui-language` 把 `label={…}` 花括号里的
   * **每个**字面量都当待渲染文案（它防的是"把英文藏进三元"那类假绿），
   * 所以句子先算出来再交给 prop，而不是把两个 i18n key 写进扫描面里。
   */
  const addAttachmentLabel = t(
    attachmentBusy ? 'mobile.detail.attachments.uploading' : 'mobile.detail.attachments.add',
  );

  const dueLocal = task.dueDateLocal ?? (task.dueDate === undefined ? undefined : toLocalDate(task.dueDate));
  const todayLocal = toLocalDate(now);
  // 共享 DatePicker 的注入物（快捷项日期数学在 domain，措辞在这里）。
  const datePicks = quickDatePicks(todayLocal, t);
  const datePickerText = datePickerLabels(t);
  /**
   * 这条截止**现在带不带时刻**，以及带的是几点。
   *
   * 🔴 判定只读共享层那一份 `localTimeOf`，而且**一次渲染只算这一次**：
   * 时刻栏显示的值与换日子时要搬运的值必须是同一个读数，否则会出现
   * "栏里写着 16:00、写进库里的却是 00:00"。时间线上那条「全天」带读的
   * 也是同一个函数 —— 两端各判一次就会分叉（AGENTS §3.5）。
   * ⚠️ 不能写 `localTimeOf(task.dueDate ?? 0)`：`0` 是 1970-01-01，在 UTC+8 上
   * 读得出 08:00 —— 一条本来没有截止的任务会被安上一个凭空的时刻。
   */
  const dueTimeValue = task.dueDateLocal !== undefined
    ? undefined
    : (task.dueDate === undefined ? undefined : localTimeOf(task.dueDate));
  const dueTimeText = datePickerTimeLabels(t, task.title);
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
   * 日期状态行（内容层，常驻可见）。
   *
   * 🔴 "什么算逾期"、"逾期几天"**不在这里判**：两档读数都来自
   * `lib/due-display.ts`，而它本身只是 `@heyta/domain` 的 `computeCountdown` /
   * `formatRemaining` 的一层薄壳 —— 与任务行上的徽标、Web 的 `DueBadge` **同一份规则**。
   * 自己在这里 `Date.now() - dueDate` 除一天的话，两端会说两种话（那个漂移的来龙去脉
   * 写在 `lib/due-display.ts` 文件头）。
   */
  const dueDateText = toDueDisplay(task, 'date', now, t);
  const dueRemaining = toDueDisplay(task, 'countdown', now, t);
  const isOverdue = dueRemaining?.overdue === true;

  /** 重复规则的锚点。
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

  // ── 折叠层的收起态读数（属性名 → 当前值，§1 的 `inline` 解剖）──
  // 只是**把已有的值说出来**，不判断该不该显示：字段语义仍来自实体本身。
  const projectName = task.projectId === undefined
    ? undefined
    : projects.find((p) => p.id === task.projectId)?.name;
  const listValue = projectName ?? t('mobile.detail.project.inbox');
  const parentValue =
    tasks.find((candidate) => candidate.id === task.parentId)?.title ??
    t('mobile.detail.parent.topLevel');
  const assignedTagNames = tags
    .filter((tag) => task.tagIds?.includes(tag.id) ?? false)
    .map((tag) => tag.name);
  const tagValue = assignedTagNames.length === 0
    ? t('mobile.detail.value.none')
    : t(assignedTagNames.length === 1 ? 'mobile.detail.value.tagsOne' : 'mobile.detail.value.tags', {
        count: assignedTagNames.length,
      });
  const repeatValue = activePreset !== undefined
    ? t(REPEAT_LABEL_KEYS[activePreset])
    : (customRule !== undefined
      ? describeRecurrenceText(customRule, t, locale)
      : t('mobile.detail.repeat.none'));
  const scheduleStartText = startLocal === undefined
    ? undefined
    : formatCompactLocalDate(startLocal, now);
  const scheduleValue = [
    scheduleStartText,
    task.durationMinutes === undefined
      ? undefined
      : durationChipLabel(task.durationMinutes),
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
  const priorityValue = priorityLabel(task.priority ?? Priority.None, t);
  const remindersValue =
    reminders.length === 0
      ? t('mobile.detail.value.none')
      : t(reminders.length === 1 ? 'mobile.detail.value.remindersOne' : 'mobile.detail.value.reminders', {
          count: reminders.length,
        });
  const dueSectionValue = dueDateText === null ? t('mobile.detail.due.notSet') : dueDateText.text;

  /**
   * 任务动态的收起态读数。
   *
   * 还没读到（没展开过 / 在途 / 刚切到这条任务）时给**空串**而不是"无"：
   * "无"是一句关于这条任务的断言，而我们这时候什么都不知道。
   */
  const activityLoaded = activity !== null && activity.taskId === task.id ? activity : undefined;
  const activityEvents = activityLoaded?.read?.events ?? [];
  const activityValue =
    activityLoaded === undefined
      ? ''
      : activityLoaded.read === null
        ? t('mobile.detail.activity.unavailable')
        : activityEvents.length === 0
          ? t('mobile.detail.value.none')
          : t('mobile.detail.activity.count', { count: activityEvents.length });
  /** 覆盖范围那句：`complete` 时是 `undefined`（这时不多嘴）。 */
  const activityNoticeKey =
    activityLoaded?.read === null || activityLoaded?.read === undefined
      ? undefined
      : taskActivityCoverageMessageKey(activityLoaded.read.coverage);

  /**
   * 内容层交给共享的 `TaskRow` —— 见下面 JSX 里那段"为什么"。
   * 行模型是 `toTaskRow` 造的，**不是**这里自己拼的字段表。
   */
  const detailRow = toTaskRow(task, { fallbackTitle: t('mobile.detail.title.untitled') });
  const detailRowLabels: TaskRowLabels = {
    // 与任务行同一句词条（带标题），不在界面里拼「完成：」+ 标题 ——
    // 那会让另一种语言的语序对不上。
    toggleOn: () => t('mobile.tasks.a11y.complete', { title: task.title }),
    toggleOff: () => t('mobile.tasks.a11y.uncomplete', { title: task.title }),
    // 🔴 面板语境里点行体**不是**"打开详情"（已经在详情里了），而是进标题编辑。
    // `onOpenTask` 本来就只把"按了行体"这件事交回宿主，组件不认识它算哪件事
    // （`TaskRow.tsx:106-113` 同一条分工）—— 但无障碍名必须说实话。
    open: () => t('mobile.detail.edit.title'),
  };

  /**
   * 子任务列表：取数口径**走共享的 `buildTaskTree`**，不在这里
   * `tasks.filter(t => t.parentId === task.id)` 数一遍（与 `TasksScreen.tsx`
   * 数子任务那格同一个理由）。那棵树还顺手做了三件本文件做不对的事：
   * 稳定排序（`compareTaskSiblings`）、打断数据里已有的环、把"父已删除"的孩子
   * 提到顶层。自己 filter 会得到**另一种**答案 —— 同一份数据在两台设备上
   * 子任务顺序不同、条数不同，而且没有任何一处报错（§3.5）。
   *
   * ⚠️ 「什么算完成」用的是领域层的 `isCompleted`，不是这里再写一次
   * `completedAt === undefined` —— 那个谓词此前已经因为在两处各写一遍而分叉过。
   */
  const subtaskNodes = buildTaskTree(tasks).nodeById.get(task.id)?.children ?? [];
  const subtaskDone = subtaskNodes.filter((node) => isCompleted(node.task)).length;

  return (
    /**
     * 外壳走共享原语 `BottomSheet`（适配层 §4 **T7**）。
     *
     * 🔴 迁移后**刻意不变**的四条（都是已拍板的行为，不是可以顺手改的）：
     *   · 压暗用 `material.scrim`（0.32）而不是 `color.overlay`（0.5）：
     *     这块面板的读数是在真机上量出来的，改深是一次无人要求的视觉变更；
     *   · 「收起面板也要提交标题与备注」由 `close` 保证 —— 背景 / 下拉 / ×
     *     三条通道都走它（`BottomSheet` 里它们共用 `onDismiss`）；
     *   · Android 第一次返回先收键盘、第二次才关 —— 走 `onBack`，它与 ×
     *     **不是**一回事：键盘开着时点 × 只收起键盘会读成"点了没反应"；
     *   · 键盘避让的 `behavior` 与原来逐字相同（iOS `padding` / 其余 `height`）。
     *
     * 本轮在原语**之外**补上两格：`rememberedDetent` + `onDetentChange`
     * （档位记忆，落到设备本地偏好），以及 `footer`（常驻动作条 ——
     * 它挂在 `ScrollView` **之外**，所以不需要滚动就能点，见 §3 判据 S1）。
     */
    <BottomSheet
      visible={visible}
      // 可访问名称 + 标题栏文字：这条任务挂在哪个清单下（"任务详情"不回答任何问题）。
      title={listValue}
      labels={{
        close: t('mobile.detail.close'),
        expand: t('mobile.detail.sheet.expand'),
        collapse: t('mobile.detail.sheet.collapse'),
      }}
      onDismiss={close}
      onBack={handleRequestClose}
      rememberedDetent={rememberedDetent}
      onDetentChange={rememberDetent}
      bottomInset={insets.bottom}
      testID="task-detail-sheet"
      footer={
        // 🔴 常驻动作条（§3 / 判据 S1）。原来这两个按钮在滚动内容**末尾**，
        // 0.6 档要滚到底才够得着 —— 那是现成的违规，不是风格偏好。
        <HStack gap="default">
          <Button
            label={done ? t('mobile.detail.markIncomplete') : t('mobile.detail.markComplete')}
            tone="secondary"
            icon={done ? 'task.reopen' : 'task.done'}
            loading={busy}
            onPress={() => {
              run(actions.setCompleted(task.id, !done));
            }}
            testID="task-detail-complete"
            style={styles.grow}
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
            testID="task-detail-delete"
          />
          <Button
            label={t('mobile.settings.close')}
            tone="ghost"
            onPress={close}
            testID="task-detail-close-button"
          />
        </HStack>
      }
    >
      {/* ── 头部三件套 ────────────────────────────────────────────────
          替代原来那句没用的"任务详情"标题：一屏之内先回答
          「在哪 / 多重 / 还有哪些属性」。三枚都是**触发器**，
          点了展开对应的区段 —— 界面自己不写任何字段。 */}
      <HStack align="center" gap="default" style={styles.headerRow}>
        <Pressable
          onPress={() => {
            toggleSection('project');
          }}
          accessibilityRole="button"
          accessibilityLabel={t('mobile.detail.header.switchList')}
          testID="task-detail-list"
          style={({ pressed }) => [styles.headerChip, pressed ? styles.pressed : null]}
        >
          <Icon name="task.project" size="sm" color={tokens['color.foreground-muted']} />
          <Text variant="row-meta" numberOfLines={1}>
            {listValue}
          </Text>
          <Icon name="action.expand" size="xs" color={tokens['color.foreground-subtle']} />
        </Pressable>
        <View style={styles.grow} />
        <IconButton
          icon="task.priority"
          label={t('mobile.detail.field.priority')}
          testID="task-detail-priority-flag"
          onPress={() => {
            toggleSection('priority');
          }}
        />
        <IconButton
          icon="action.more"
          label={allSectionsOpen
            ? t('mobile.detail.section.collapseAll')
            : t('mobile.detail.section.expandAll')}
          testID="task-detail-more"
          onPress={toggleAllSections}
        />
      </HStack>

      {/* ── 内容层（常驻可见，不折叠）──────────────────────────────────
          顺序是"勾选框 → 日期状态 → 标题 → 备注"：
          勾选框必须在**首屏**（原来要滚到底才够得着完成），
          日期状态行把"要不要现在做"回答掉，标题是正文而不是带标签的输入框。 */}
      {/* 🔴 勾选框 + 标题**不在这里画**。那棵"复选框 + 标题 + 截止"的子树在
          `packages/ui` 的 `TaskRow` 里只有一份，而 `check:row-single-source` 锚定的
          就是那一棵 —— 宿主再画一遍就是第二份行实现（本轮实测：把勾选框拆成
          `packages/ui` 的独立控件同样会让锚点断掉，见工单 §6.1）。
          点行体 = 进标题编辑，不是"打开详情"；理由与无障碍名见上面 `detailRowLabels`。 */}
      <TaskRow
        row={detailRow}
        // 详情面板是这条任务被"读"的地方，不是被"扫"的地方 ⇒ 走共享组件的
        // `detail` 档（差的就是标题那枚语义样式，几何与插槽照旧跟 `comfortable` 一致）。
        density="detail"
        busy={busy}
        labels={detailRowLabels}
        onToggleTask={() => {
          run(actions.setCompleted(task.id, !done));
        }}
        onOpenTask={() => {
          setEditingTitle(true);
        }}
      />

      <HStack align="center" gap="tight">
        {/* 日期状态行 = 截止那一格的**触发器**：收起态看得见当前值，
            点开才出 `DatePicker`（§4 判据：收起态里被折叠的控件数量为 0）。 */}
        <Pressable
          onPress={() => {
            setDueOpen((open) => !open);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: dueOpen }}
          testID="task-detail-due-toggle"
          style={({ pressed }) => [styles.propRow, styles.grow, pressed ? styles.pressed : null]}
        >
          <Icon
            name={isOverdue ? 'task.overdue' : 'task.due'}
            size="sm"
            color={isOverdue ? tokens['color.danger'] : tokens['color.foreground-subtle']}
          />
          <Text variant="row-meta" grow numberOfLines={1}>
            {dueSectionValue}
          </Text>
          {/* 「已逾期 N 天」单独一句、单独一档红：句子由 `lib/due-display` 从
              领域层那份天数计算里说出来，这里只决定它排在日子后面。 */}
          {isOverdue && dueRemaining !== null ? (
            <Text variant="row-meta" tone={dueTone(dueRemaining.urgency)}>
              {dueRemaining.text}
            </Text>
          ) : null}
          {/* 顺延：`postponeToToday` 在动作层已经写好很久（推到哪、保不保留时刻
              都在那里），移动端此前**零调用点** —— 这一格补的就是它。
              🔴 按钮只在逾期时出现：对没逾期 / 已完成的任务点「顺延到今天」是倒退，
              而动作层会幂等地什么都不做 —— 画一个按下去什么都不发生的入口比不画更糟。 */}
          {isOverdue ? (
            <Button
              label={t('mobile.detail.postpone.today')}
              tone="ghost"
              onPress={() => {
                run(actions.postponeToToday(task.id));
              }}
              testID="task-detail-postpone"
            />
          ) : null}
          <Icon
            name={dueOpen ? 'action.collapse' : 'action.expand'}
            size="xs"
            color={tokens['color.foreground-subtle']}
          />
        </Pressable>
      </HStack>

      {dueOpen ? (
        <Stack gap="default">
          <DatePicker
            value={dueLocal}
            today={todayLocal}
            quickPicks={datePicks}
            labels={datePickerText}
            // 🔴 屏上有两张 `DatePicker`（截止 / 排期起点），而组件的 testID 默认值
            // 是 `date-picker`，时刻栏由此派生成 `date-picker-time-input`。
            // 不传宿主前缀 ⇒ 两条派生出**同一个** testID，设备脚本就分不清它点的是
            // 哪一张（`verify:mobile-*` 那一族按 testID 找元素，见 AGENTS §6.1）。
            testID="task-due"
            // 🔴 时刻栏整块住在共享层（`DatePickerTime`），这里只注入**值**与**措辞**。
            // 移动端此前一直不传这个 prop —— 而共享层那句"不传就一个节点都不画"
            // 让它安静了整批：结果是"能看日子、不能定时刻"。
            time={{
              value: dueTimeValue,
              // 没有日子就没有"几点"可言 —— 栏会画出来但填不进字（灰由共享层负责）。
              enabled: dueLocal !== undefined,
              labels: dueTimeText,
              onChange: (next) => {
                // `enabled` 为假时组件不回调；这一句是给类型看的，不是运行时兜底。
                if (dueLocal === undefined) return;
                run(actions.setDueDate(
                  task.id,
                  dueDateToEpoch(dueLocal, next),
                  next === undefined ? dueLocal : undefined,
                ));
              },
            }}
            onChange={(date) => {
              // 🔴 清除传 `undefined`，由 app-host 写成 `null`
              // （见 `TaskActions.setDueDate` 的注释）。
              //
              // 🔴 换日子**搬运这条已有的时刻**（`dueTimeValue`，与时刻栏读的
              // 同一个数）：这条任务可能从 web 或自然语言输入那里带着 16:00
              // 同步过来，这里只写日子的话时刻就静默归零 —— 而提醒算的是
              // `dueDate - offset`，归零等于把提醒挪了一整天。界面上不会有任何异常。
              run(
                actions.setDueDate(
                  task.id,
                  date === undefined ? undefined : dueDateToEpoch(date, dueTimeValue),
                  date !== undefined && dueTimeValue === undefined ? date : undefined,
                ),
              );
            }}
          />
        </Stack>
      ) : null}

      {/* 标题正文（大字，点击进入编辑）。
          🔴 首屏不再是"写着『标题』的输入框"—— 那是"这条记录有哪些列"的形状。
          编辑态用的仍是 `kit.TextField`（`onBlur` 提交的语义一字未动），
          离开输入框时收回正文态。 */}
      {/* 标题的**显示**已经在那一行里了（`TaskRow` 画它），所以这里只画编辑态。
          ⚠️ 编辑时行仍在上方显示已提交的标题 —— 这是"行骨架只有一份"的代价之一，
          记在工单 §6.2。 */}
      {editingTitle ? (
        <TextField
          label={t('mobile.detail.field.title')}
          value={title}
          onChangeText={setTitle}
          onBlur={() => {
            commitTitle();
            setEditingTitle(false);
          }}
          onSubmitEditing={() => {
            commitTitle();
            setEditingTitle(false);
          }}
          placeholder={t('mobile.tasks.composer.placeholder')}
          testID="task-detail-title"
        />
      ) : null}

      {/* 备注正文（同上）。空备注画那句已有的提示 —— 它是**入口的说明**，
          不是"暂无数据"那种把可用功能藏起来的样子。 */}
      {editingNote ? (
        <TextField
          label={t('mobile.detail.field.note')}
          value={note}
          onChangeText={setNote}
          onBlur={() => {
            commitNote();
            setEditingNote(false);
          }}
          multiline
          lines={4}
          testID="task-detail-note"
        />
      ) : (
        <Pressable
          onPress={() => {
            setEditingNote(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('mobile.detail.edit.note')}
          testID="task-detail-note-text"
          style={({ pressed }) => (pressed && !reducedMotion ? styles.pressed : undefined)}
        >
          <Text
            variant="row-title"
            tone={note.trim() === '' ? 'subtle' : 'muted'}
            style={styles.contentNote}
            numberOfLines={3}
          >
            {note.trim() === '' ? t('mobile.detail.note.placeholder') : note}
          </Text>
        </Pressable>
      )}

      {/* ── 子任务（内容层，常驻不折叠）─────────────────────────────────
          它是**工作内容**（这条任务由哪几件小事组成），不是"这条记录的某一列"，
          所以留在内容层与备注并列，而不是塞进折叠层（§1 的内容 / 折叠分工）。

          🔴 行骨架仍然只有那一份：每条子任务渲染共享 `<TaskRow>`，本文件里没有
          `<Checkbox` —— 多画一棵"勾选框 + 标题 + 截止"就是第二份行实现
          （`check:row-single-source` 锚的正是这件事）。

          ⚠️ 档位选 `compact` 而不是 `minimal`：`minimal` 那一档**没有触控下限**，
          而这里的勾选框是要用手指点的（`DENSITY_SPEC` 里 compact 的 44 就是勾选框的
          触控下限）。子任务的截止/尾部插槽都不给 —— `showMeta` 由档位决定，
          这一屏上"哪件事还没做完"才是信息，日期不是。 */}
      {subtaskNodes.length > 0 ? (
        <HStack align="center" gap="tight" testID="task-detail-subtasks-head">
          <Text variant="row-meta" tone="subtle">
            {t('mobile.detail.field.subtasks')}
          </Text>
          <View style={styles.grow} />
          <Text variant="row-meta" tone="subtle" testID="task-detail-subtasks-count">
            {t('mobile.detail.subtasks.progress', {
              done: subtaskDone,
              total: subtaskNodes.length,
            })}
          </Text>
        </HStack>
      ) : null}

      {subtaskNodes.map((node) => (
        <TaskRow
          key={node.task.id}
          row={toTaskRow(node.task, { fallbackTitle: t('mobile.detail.title.untitled') })}
          density="compact"
          busy={busy}
          labels={{
            toggleOn: () => t('mobile.tasks.a11y.complete', { title: node.task.title }),
            toggleOff: () => t('mobile.tasks.a11y.uncomplete', { title: node.task.title }),
            open: () => t('mobile.detail.subtasks.open', { title: node.task.title }),
          }}
          onToggleTask={() => {
            // 「什么算完成」问领域层的 `isCompleted`，不在这里比 `completedAt`。
            run(actions.setCompleted(node.task.id, !isCompleted(node.task)));
          }}
          // 🔴 宿主没给这个入口时**不传** `onOpenTask`：共享 `TaskRow` 的契约是
          // "不给则整行不可点"，而不是把它降级成"点行 = 切换完成" —— 那个默认值
          // 会让"忘了传"表现成误改数据。
          onOpenTask={onOpenSubtask}
        />
      ))}

      {subtaskNodes.length === 0 && !newSubtaskOpen ? (
        <Text variant="caption" tone="subtle">
          {t('mobile.detail.subtasks.empty')}
        </Text>
      ) : null}

      {newSubtaskOpen ? (
        <HStack align="center" gap="default">
          <View style={styles.grow}>
            {/* 复用 `NewListNameInput`（名字里的 "List" 是它出生的那一格）：
                它内部处理了"聚焦与卸载撞在同一帧"那条 Fabric 崩溃路径 ——
                这一格同样是在条件分支里挂载，换一只裸 `<TextInput autoFocus>`
                会把那批 `Heyta-2026-10-24-*.ips` 重新放出来。 */}
            <NewListNameInput
              value={newSubtaskName}
              onChangeText={setNewSubtaskName}
              accessibilityLabel={t('mobile.detail.subtasks.newPlaceholder')}
              placeholder={t('mobile.detail.subtasks.newPlaceholder')}
              placeholderTextColor={tokens['color.foreground-subtle']}
              style={[text['row-title'], styles.listNameInput]}
            />
          </View>
          <Button
            label={t('mobile.detail.subtasks.add')}
            tone="secondary"
            disabled={newSubtaskName.trim() === ''}
            testID="task-detail-subtask-submit"
            onPress={runAddSubtask}
          />
        </HStack>
      ) : (
        <View style={styles.chipRow}>
          <Chip
            label={t('mobile.detail.subtasks.add')}
            selected={false}
            icon="task.add"
            testID="task-detail-add-subtask"
            onPress={() => {
              setSubtaskError('');
              setNewSubtaskOpen(true);
            }}
          />
        </View>
      )}

      {subtaskError !== '' ? (
        <Text variant="row-meta" tone="danger" testID="task-detail-subtask-error">
          {subtaskError}
        </Text>
      ) : null}

      {/*
        ── 附件（工单 #9）─────────────────────────────────────────────
        放在**内容层**，不是折叠层：附件是这条任务的内容，不是它的配置
        （判据见 ux-principles §1 —— 折叠层只放"属性名 → 当前值"那一副解剖）。

        🔴 宿主没给动作集时整格**不出现**，与「任务动态」同一立场：
        画一个空的附件区会被读成"这条任务没有附件"，而真相是通道没接上。

        ⚠️ 这一格只有"加上 / 列出 / 移除"三条，**没有"点开"** ——
        读字节要等原生那条下载通道（理由与那条守着它的断言都在
        `packages/shared-schema/src/attachment-http-contract.ts`）。
      */}
      {attachmentActions !== null ? (
        <>
          <HStack align="center" gap="default">
            <Text variant="caption" tone="subtle">
              {t('mobile.detail.attachments.title')}
            </Text>
            {attachmentRows.length > 0 ? (
              <Text variant="caption" tone="subtle">
                {t('mobile.detail.attachments.count', { n: attachmentRows.length })}
              </Text>
            ) : null}
          </HStack>

          {attachmentRows.map((item) => {
            /**
             * 「移除」按钮的两态文案。
             *
             * ⚠️ 这里**不写成** `label={cond ? t(a) : t(b)}`：`check:ui-language`
             * 会把 `label={…}` 花括号里的每个字面量都当待渲染的文案（那是它防假绿的
             * 设计），于是两个 i18n key 都会被念成"硬编码文案"。
             * 先把句子算出来，再交给 `label` —— 语义不变，扫描面也不被骗过去。
             */
            const removeLabel = t(
              pendingRemoveId === item.id
                ? 'mobile.detail.attachments.remove.confirm'
                : 'mobile.detail.attachments.remove',
            );
            return (
              <HStack key={item.id} align="center" gap="default">
                <View style={styles.grow}>
                  <Text variant="row-title">{item.fileName}</Text>
                  {/* 大小只有服务端测到的那一格才念得出口；老数据缺它就整行不显示体积，
                      而不是显示 0 —— "0 字节"与"不知道多大"是两句话。 */}
                  {item.sizeBytes !== undefined ? (
                    <Text variant="row-meta" tone="subtle">
                      {attachmentSizeLabel(item.sizeBytes)}
                    </Text>
                  ) : null}
                </View>
                <Button
                  label={removeLabel}
                  tone="secondary"
                  disabled={attachmentBusy}
                  testID={`task-detail-attachment-remove-${item.id}`}
                  onPress={() => {
                    runRemoveAttachment(item.id);
                  }}
                />
              </HStack>
            );
          })}

          {attachmentRows.length === 0 ? (
            <Text variant="caption" tone="subtle">
              {t('mobile.detail.attachments.empty')}
            </Text>
          ) : null}

          <View style={styles.chipRow}>
            <Chip
              label={addAttachmentLabel}
              selected={false}
              icon="task.add"
              testID="task-detail-add-attachment"
              onPress={runAddAttachment}
            />
          </View>

          {attachmentError !== '' ? (
            <Text variant="row-meta" tone="danger" testID="task-detail-attachment-error">
              {attachmentError}
            </Text>
          ) : null}
        </>
      ) : null}

      {/* 清单排程预览：备注里写了清单（或 AI 拆解过）时才有内容可排。
          它是任务内部坐标系，与时间线板的关系由预览自己的说明文字标明。 */}
      {planBlock?.hasChecklist ? (
        <ChecklistPlanPreview block={planBlock} labels={planLabels} now={now} />
      ) : null}

      {/* ── 折叠层 ──────────────────────────────────────────────────────
          每段收起态只有"属性名 → 当前值"，**编辑控件一个都不渲染**（§4 判据 S4）。
          值仍然看得见，所以这一层是 `inline` 属性面板的解剖，不是"藏起来"（§1）。 */}

      {/*
        提醒（B1-1 的界面层）。
        ============================================================
        🔴 面板挂在**任务详情**里，不是第 6 个 tab —— ADR-0015 §4 与 P10
        已经判决过"底部标签保持 5 个"，而且 `scripts/verify-mobile-*`
        按坐标（108/324/540/756/972）寻址标签栏。

        🔴 整块的标题、空态、状态徽标、按钮排布全在共享 `ReminderList` 里
        （web 与移动同一份源码），本文件只把 hook 的动作与文案摆上去。

        ⚠️ 展开态里共享组件**自己会再画一行「提醒」标题**：它与本行那句
        属性名同源（同一个 `reminder.title` 词条），共享层没有"标题可关"的
        prop（要关得改 `packages/ui/**`，本轮范围之外）。
      */}
      <DetailSection
        label={t('reminder.title')}
        value={remindersValue}
        open={openSections.reminders === true}
        onToggle={() => {
          toggleSection('reminders');
        }}
        testID="task-detail-section-reminders"
      >
        <ReminderList
          reminders={reminders}
          uncertainOccurrences={uncertainOccurrences}
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
          deliveryBlocked={
            deliveryNotice === null
              ? undefined
              : {
                  text: t(deliveryNotice.key),
                  // 这台设备给不出那一页时**不画入口**（画一个点了没反应的按钮比没有更糟），
                  // 但那句话照说 —— 通知被拒是事实，没有回头路也不能不说。
                  settings: deliveryNotice.canOpen
                    ? {
                        label: t('reminder.delivery.openSettings'),
                        onPress: () => { delivery.open(deliveryNotice.row); },
                      }
                    : undefined,
                }
          }
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
      </DetailSection>

      <DetailSection
        label={t('mobile.detail.field.repeat')}
        value={repeatValue}
        open={openSections.repeat === true}
        onToggle={() => {
          toggleSection('repeat');
        }}
        testID="task-detail-section-repeat"
      >
        <Stack gap="default">
          <View style={styles.chipRow}>
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
            「完成后顺延」（2026-11-06，滴答对齐 §五 第 3 步的移动端半边）。

            为什么是一枚可切换的 chip 而不是一个 Switch：本屏**没有**开关控件的先例
            （`grep -rn onValueChange apps/mobile/src` 为零），新引入一种控制形状要连带
            定 track/thumb 的语义色，那是设计系统的口径；而这一格与上面的预设是同一类东西
            —— "对这条重复规则的一个选择"，用同一排 chip 的形状说同一档事实。
            没有规则时不画（与 web 那一格同规矩：按下去不会有任何变化的行不留）。
          */}
          {repeat !== undefined && (
            <>
              <View style={styles.chipRow}>
                <Chip
                  label={t('mobile.detail.repeat.afterCompletion')}
                  selected={task.repeatAfterCompletion === true}
                  testID="task-detail-repeat-after-completion"
                  onPress={() => {
                    run(
                      actions.setRepeatAfterCompletion(
                        task.id,
                        task.repeatAfterCompletion !== true,
                      ),
                    );
                  }}
                />
              </View>
              <Text variant="row-meta" tone="muted">
                {t('mobile.detail.repeat.afterCompletionHint')}
              </Text>
            </>
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
        </Stack>
      </DetailSection>

      {/* 排期段（时间线 P2 的触屏入口）：开始 + 时长决定这条任务在时间线板上的条。
          与截止是两件事 —— 截止是"什么时候到期"，排期是"什么时候做"。 */}
      <DetailSection
        label={t('mobile.detail.field.schedule')}
        value={scheduleValue === '' ? t('mobile.detail.value.none') : scheduleValue}
        open={openSections.schedule === true}
        onToggle={() => {
          toggleSection('schedule');
        }}
        testID="task-detail-section-schedule"
      >
        <Stack gap="default">
          <Text variant="row-meta" tone="muted">
            {t('mobile.detail.schedule.hint')}
          </Text>
          <Text variant="row-meta" tone="muted">
            {t('mobile.detail.schedule.start')}
          </Text>
          <DatePicker
            value={startLocal}
            today={todayLocal}
            quickPicks={datePicks}
            labels={datePickerText}
            // 与截止那张分开（见上面 `task-due` 那段理由）。
            testID="task-schedule-start"
            onChange={(date) => {
              // 显式 `undefined` ⇒ 动作层写成 `null`（清除排期起点）。
              run(
                actions.setSchedule(
                  task.id,
                  date === undefined
                    ? { startDate: undefined }
                    : { startDate: dueDateToEpoch(date), startDateLocal: date },
                ),
              );
            }}
          />
          <Text variant="row-meta" tone="muted">
            {t('mobile.detail.schedule.duration')}
          </Text>
          <View style={styles.chipRow}>
            <Chip
              label={t('mobile.detail.schedule.none')}
              selected={task.durationMinutes === undefined}
              onPress={() => {
                run(actions.setSchedule(task.id, { durationMinutes: undefined }));
              }}
            />
            {DURATION_CHIPS.map((minutes) => (
              <Chip
                key={minutes}
                label={durationChipLabel(minutes)}
                selected={task.durationMinutes === minutes}
                onPress={() => {
                  run(actions.setSchedule(task.id, { durationMinutes: minutes }));
                }}
              />
            ))}
          </View>
        </Stack>
      </DetailSection>

      <DetailSection
        label={t('mobile.detail.field.priority')}
        value={priorityValue}
        open={openSections.priority === true}
        onToggle={() => {
          toggleSection('priority');
        }}
        testID="task-detail-section-priority"
      >
        <View style={styles.chipRow}>
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
      </DetailSection>

      {/* 四象限的第一个轴。
          🔴 **为什么这里只有一个开关、没有第二个**：紧急由 `dueDate` 推导，
             让人再填一遍就是重复劳动，而且两个字段一定会不一致
             （ADR-0015 §3）。所以用户只回答"这件事重要吗"。

          🔴 **为什么读的是 `isImportant(task)` 而不是 `task.important`**：
             `important` 是后加字段，老数据没有它。直接读会得到 `undefined`
             → 开关显示为"关"，而 `isImportant` 会回退到优先级推导
             （HIGH 视为重要）。用裸字段会造成**界面与象限视图不一致**：
             详情页说"不重要"，象限里它在 Q1。 */}
      <DetailSection
        label={t('mobile.detail.field.important')}
        value={important ? t('mobile.detail.important.yes') : t('mobile.detail.important.no')}
        open={openSections.important === true}
        onToggle={() => {
          toggleSection('important');
        }}
        testID="task-detail-section-important"
      >
        <Stack gap="default">
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
        </Stack>
      </DetailSection>

      <DetailSection
        label={t('mobile.detail.field.project')}
        value={listValue}
        open={openSections.project === true}
        onToggle={() => {
          toggleSection('project');
        }}
        testID="task-detail-section-project"
      >
        <Stack gap="default">
          <View style={styles.chipRow}>
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
            <HStack align="center" gap="default">
              <View style={styles.grow}>
                {/*
                  🔴 用 `NewListNameInput` 而不是裸 `<TextInput autoFocus>`：
                  这一格在 `{newListOpen && …}` 里，于是"聚焦"与"卸载"会撞在
                  同一帧，而 Fabric 的 `focus`/`blur` 是 **void 异步方法** ——
                  那条路径上的异常不会被转成 JSError，只会 `abort`
                  （四次 `Heyta-2026-10-24-*.ips` 都停在
                  `RCTTurboModule.mm:467`，且报告里既没有 `asi` 也没有
                  `exceptionReason`）。组件内部把这个竞态消掉了，
                  见 `NewListNameInput` 的注释。
                */}
                <NewListNameInput
                  value={newListName}
                  onChangeText={setNewListName}
                  // 🔴 与段落标题「清单」**不同名**：同名会让无障碍树里
                  // 出现两个「清单」，按标签取节点就得靠 role 去猜。
                  accessibilityLabel={t('mobile.detail.project.newPlaceholder')}
                  placeholder={t('mobile.detail.project.newPlaceholder')}
                  placeholderTextColor={tokens['color.foreground-subtle']}
                  style={[text['row-title'], styles.listNameInput]}
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
            </HStack>
          )}
        </Stack>
      </DetailSection>

      {/* ── 子任务（上级任务）──────────────────────────────────────────
          🔴 在它之前：`packages/domain/src/subtasks.ts`（616 行，建树 + 环防护 +
          深度/子数上限）与 `app-host` 的 `setParent` **都已经写好**，
          但移动端**一次调用点都没有** —— 于是"模型支持、树能建、
          用户没有任何办法造出一个子任务"，且**不报错**。
          （Web 端本轮已补，这里是移动端的那一半。） */}
      <DetailSection
        label={t('mobile.detail.field.parent')}
        value={parentValue}
        open={openSections.parent === true}
        onToggle={() => {
          toggleSection('parent');
        }}
        testID="task-detail-section-parent"
      >
        <Stack gap="default">
          <View style={styles.chipRow}>
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
        </Stack>
      </DetailSection>

      {/* 标签：与清单**并列但语义不同** —— 清单是"属于哪个容器"（单选），
          标签是"还跟什么有关"（多选）。所以这里是开关式的 Chip，
          不是一个"选中就切换"的互斥组。

          🔴 每次点击都写**整组**（`setTags`），一条 op。
          在界面里维护"待改动集合"再一次性提交是另一种做法，但那会让
          "点了之后立刻同步"变成"要点保存才同步"，而这一屏的其他字段
          （截止日、重复、优先级）全是即点即写 —— 不一致的交互更贵。 */}
      <DetailSection
        label={t('mobile.detail.field.tags')}
        value={tagValue}
        open={openSections.tags === true}
        onToggle={() => {
          toggleSection('tags');
        }}
        testID="task-detail-section-tags"
      >
        <Stack gap="default">
          {tags.length === 0 ? (
            <Text variant="caption" tone="subtle">
              {t('mobile.detail.tags.empty')}
            </Text>
          ) : (
            <View style={styles.chipRow}>
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

          {/* 就地新建标签。🔴 那句空态文案指的是**这一枚按钮**，
              所以它俩必须同进同出：只留文案不留入口，等于把用户支走到别的屏
              去办这一屏能办的事（此前那句「先到『我的』页新建」就是这么写的）。
              按钮文案复用 `mobile.tags.add` —— 「我的」页那枚同名按钮说的是同一件事，
              两处同一个叫法，不造第二个名字。 */}
          {projectActions !== null && !newTagOpen ? (
            <View style={styles.chipRow}>
              <Chip
                label={t('mobile.tags.add')}
                selected={false}
                icon="task.add"
                testID="task-detail-add-tag"
                onPress={() => {
                  setNewTagOpen(true);
                }}
              />
            </View>
          ) : null}

          {newTagOpen && projectActions !== null ? (
            <HStack align="center" gap="default">
              <View style={styles.grow}>
                <NewListNameInput
                  value={newTagName}
                  onChangeText={setNewTagName}
                  // 与段落标题「标签」不同名：同名会让无障碍树里出现两个「标签」，
                  // 按标签取节点就得靠 role 去猜（与清单那格同一条纪律）。
                  accessibilityLabel={t('mobile.tags.newPlaceholder')}
                  placeholder={t('mobile.tags.newPlaceholder')}
                  placeholderTextColor={tokens['color.foreground-subtle']}
                  style={[text['row-title'], styles.listNameInput]}
                />
              </View>
              <Button
                label={t('mobile.tags.add')}
                tone="secondary"
                disabled={newTagName.trim() === ''}
                testID="task-detail-tag-submit"
                onPress={runAddTag}
              />
            </HStack>
          ) : null}
        </Stack>
      </DetailSection>

      {/* ── 任务动态（本机 op-log 的流水）───────────────────────────────
          🔴 这一格的**来源只有本机日志**：服务端从设计上看不到明文 op，
          也没有"向服务端要这条任务的历史"这条路。所以它必须带那句覆盖范围
          （`coverage` 不是 'complete' 时），否则用户把增量当成了完整历史。

          ⚠️ 没有日志来源（`activitySource === null`）时**整格不出现**：
          出现而空着会被读成"这条任务没被改过" —— 那是替用户下了一句我们
          没有依据的结论。 */}
      {activitySource !== null ? (
        <DetailSection
          label={t('mobile.detail.field.activity')}
          value={activityValue}
          open={openSections.activity === true}
          onToggle={() => {
            toggleSection('activity');
          }}
          testID="task-detail-section-activity"
        >
          <Stack gap="tight">
            {activityNoticeKey !== undefined ? (
              <Text variant="caption" tone="subtle" testID="task-detail-activity-notice">
                {t(activityNoticeKey)}
              </Text>
            ) : null}

            {activityLoaded !== undefined && activityLoaded.read === null ? (
              // 读失败也要有话说，而且说的必须是"读不到"，不是"没有变更"。
              <Text variant="caption" tone="danger" testID="task-detail-activity-failed">
                {t('mobile.detail.activity.unavailable')}
              </Text>
            ) : null}

            {activityEvents.map((event) => (
              <HStack key={event.opId} align="center" gap="tight">
                <Text variant="row-meta" tone="subtle">
                  {formatStamp(event.at)}
                </Text>
                <Text variant="row-meta" grow>
                  {[
                    t(taskActivityKindMessageKey(event.kind)),
                    // 两个字段可以共用一句话（「重复」= 规则 + 锚点），所以这里
                    // 收的是**去重后的 key 集合**，映射在共享层只有一份。
                    ...taskActivityFieldMessageKeys(event).map((key) => t(key)),
                    ...(event.batched ? [t('mobile.detail.activity.batched')] : []),
                    t(taskActivityDeviceMessageKey(event.local)),
                  ].join(' · ')}
                </Text>
              </HStack>
            ))}
          </Stack>
        </DetailSection>
      ) : null}
    </BottomSheet>
  );
}

/**
 * 折叠层的一格：收起态只有「属性名 → 当前值」这一行。
 * ====================================================
 *
 * 🔴 两条判据写在这里，不是写在注释里：
 *
 *   · **收起态必须仍看得见当前值**（`ux-principles.md` §1 的 `inline` 属性面板解剖：
 *     改同一对象的几个属性 = 标签在左、值在右）—— 所以值不是"点开才知道"的东西。
 *   · **收起态里被折叠的控件数量为 0**（§4 判据 S4）—— `{open ? children : null}`
 *     是**不渲染**，不是 `display:none`。后者会让控件仍然进无障碍树、仍然可被
 *     读屏点到，而界面上看不见 —— 那是本仓在别的屏上踩过的形状。
 *
 * ⚠️ 展开状态由宿主（`openSections` 那张表）持有而不是本组件：
 * 头部那枚「⋯ = 展开全部」要能一次打开所有格子，各段自己记就等于没有总开关。
 */
function DetailSection({
  label,
  value,
  open,
  onToggle,
  testID,
  children,
}: {
  readonly label: string;
  readonly value: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly testID: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const tokens = useTokens();
  const { reducedMotion } = useTheme();
  const styles = useMemo(
    () => ({
      row: {
        alignItems: 'center' as const,
        gap: tokens['space.2'],
        minHeight: tokens['touch-target.min'],
      },
      value: { textAlign: 'right' as const },
      pressed: { transform: [{ scale: tokens['motion.press-scale'] }] },
    }),
    [tokens],
  );

  return (
    <Stack gap="default">
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        // `expanded` 是读屏用户的"这一格还能点开" —— 只有可见的箭头是不够的。
        accessibilityState={{ expanded: open }}
        testID={testID}
        style={({ pressed }) => [styles.row, pressed && !reducedMotion ? styles.pressed : null]}
      >
        <Icon
          name={open ? 'action.collapse' : 'action.expand'}
          size="xs"
          color={tokens['color.foreground-subtle']}
        />
        <Text variant="row-title">{label}</Text>
        <Text variant="row-meta" tone="subtle" grow numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      </Pressable>
      {open ? children : null}
    </Stack>
  );
}

/**
 * 「行内新建清单」的名字输入框 —— 只为**消掉一个真实崩溃**而存在。
 * ==================================================================
 *
 * ## 为什么不能直接写 `<TextInput autoFocus />`
 *
 * 这一格渲染在 `{newListOpen && …}` 里。`autoFocus` 让 view 去抢第一响应者，
 * 而收紧面板 / 建完清单都会让同一个子树 unmount —— **两件事可能落在同一帧**。
 *
 * Fabric 的视图命令（`focus` / `blur`，来自 `ViewNativeComponent` 的
 * `codegenNativeCommands`）是**返回 void 的异步方法**，走
 * `ObjCTurboModule::performVoidMethodInvocation`。那条路径的 `@catch` 只做
 * `@throw exception`（`RCTTurboModule.mm:462-464`）—— **不**像同步路径那样
 * 转成 `JSError`。异常于是逃出 dispatch block ⇒ `std::terminate` ⇒ `SIGABRT`。
 *
 * 🔴 **代价是"拿到报告也没用"**：正因为那一支不转换，`.ips` 里**既没有 `asi`
 * 也没有 `exceptionReason`**（`Heyta-2026-10-24-*.ips` 三份都核过，顶层键里
 * 根本没这两项）。所以正确的做法不是"等复现去抓"，而是**从形状上不让它发生**。
 *
 * ## 两条纪律（与 `@heyta/ui` 的 `CaptureComposer` 同一套）
 *
 *   1. **延后一拍再聚焦** —— 让父层的 modal / `KeyboardAvoidingView` 先完成
 *      订阅与测量（本项目已经踩过一次"键盘先于父层出现"）；
 *   2. **卸载前先 `blur()`** —— 把第一响应者交还掉，**再**让 view 被摘下。
 *
 * 只在原生端生效：`react-native-web` 的 `TextInput` 没有这条原生命令，
 * 不走 Fabric 那条路，也就没有这个竞态。
 */
function NewListNameInput({
  value,
  onChangeText,
  accessibilityLabel,
  placeholder,
  placeholderTextColor,
  style,
}: {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly accessibilityLabel: string;
  readonly placeholder: string;
  readonly placeholderTextColor: string;
  readonly style: React.ComponentProps<typeof TextInput>['style'];
}): React.JSX.Element {
  const ref = useRef<TextInput>(null);

  useEffect(() => {
    const timer = setTimeout(() => ref.current?.focus(), 0);
    return () => {
      clearTimeout(timer);
      // 🔴 这一行是修复本身：卸载前先交还第一响应者。
      ref.current?.blur();
    };
  }, []);

  return (
    <TextInput
      ref={ref}
      value={value}
      onChangeText={onChangeText}
      accessibilityLabel={accessibilityLabel}
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      style={style}
    />
  );
}
