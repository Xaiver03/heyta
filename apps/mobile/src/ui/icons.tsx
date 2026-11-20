/**
 * 图标层
 * ======
 *
 * 🔴 存在的理由：**禁止 emoji 当图标**（AGENTS.md §5、UIX Pro Max、Taste 三条规则一致）。
 * emoji 的问题不是不好看，是**不受设计系统控制**：它在三端渲染成完全不同的字形，
 * 颜色不能跟随 `color.primary`，尺寸不能跟随 token，也没有描边权重可以统一。
 *
 * 做法：所有图标**集中在这里**登记。组件不许自己 import Lucide ——
 * 那样会出现同一个语义在不同界面用两个图标，而且没人发现。
 *
 * 为什么先查库而不是自己画：Lucide 是 ISC（宽松白名单内）、周更（1.48.0 发于 2026-09-24）、
 * 三端可用（底层 `react-native-svg`，鸿蒙侧 `@react-native-oh-tpl/react-native-svg` 提供
 * `harmony/svg.har`）。自己画 SVG 路径 = 重复造轮子，且必然与无障碍/网格不一致。
 *
 * ⚠️ 尺寸默认取 `icon.*` token，标签栏另有 `nav.tab-icon-size` —— 两者**刻意分开**：
 * 图标基准尺寸会变，而标签栏图标的视觉效果不该跟着变（它和 11px 的字标签一起看）。
 */

import React from 'react';
import {
  TaskCheckGlyph, CalendarGlyph, TimerGlyph, AiSparkGlyph, PersonGlyph, SearchGlyph, MoreGlyph,
  AiMarkGlyph, BackGlyph, CloseGlyph, ChevronDownGlyph, ChevronUpGlyph,
  PlusGlyph, CheckGlyph, TrashGlyph, SyncGlyph, FolderGlyph,
  ChartColumnGlyph, FlameGlyph, CalendarClockGlyph, PaperclipGlyph, ImagePlusGlyph,
  TriangleAlertGlyph, RepeatGlyph, RotateCcwGlyph, BellGlyph, FlagGlyph,
  ArrowUpRightGlyph, PinGlyph, PinOffGlyph, ArchiveGlyph, ArchiveRestoreGlyph,
  SquareCheckGlyph, TagGlyph, StickyNoteGlyph, ListTodoGlyph, InboxGlyph,
  CircleCheckBigGlyph, SmartphoneGlyph, MonitorGlyph, TargetGlyph, CoffeeGlyph,
  PlayGlyph, PauseGlyph, SquareGlyph, Link2Glyph, WrenchGlyph,
  ChevronRightGlyph, CalendarDaysGlyph, CalendarRangeGlyph, LayoutGridGlyph, SettingsGlyph,
  SendGlyph, ArrowUpDownGlyph, CrownGlyph, InfoGlyph, Share2Glyph,
  PencilGlyph, TrophyGlyph, BadgeCheckGlyph, CopyGlyph, ShieldCheckGlyph,
} from './custom-icons';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowUpDown,
  ArrowUpRight,
  BadgeCheck,
  Bell,
  CalendarDays,
  CalendarClock,
  CalendarRange,
  LayoutGrid,
  ChartColumn,
  Check,
  Copy,
  Crown,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CircleCheckBig,
  Coffee,
  Ellipsis,
  Flag,
  Flame,
  Folder,
  Info,
  Inbox,
  ImagePlus,
  Link2,
  ListTodo,
  Monitor,
  Pause,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  RotateCcw,
  Search,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Square,
  SquareCheck,
  Wrench,
  StickyNote,
  Tag,
  Target,
  Timer,
  TriangleAlert,
  Trash2,
  Trophy,
  User,
  X,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTokens } from '../theme';

/**
 * 图标登记表。`name` 是**语义名**（`tab.tasks`），不是图标名（`ListTodo`）——
 * 与设计 token 同样的理由：换图标库时语义名不用改。
 */
const ICONS = {
  // 底部标签栏的五个 tab（见 `nav/TabBar.tsx`）
  'tab.tasks': TaskCheckGlyph as unknown as typeof ListTodo,
  'tab.calendar': CalendarGlyph as unknown as typeof CalendarDays,
  'tab.focus': TimerGlyph as unknown as typeof Timer,
  // ⚠️ 这一行只**新增**一个登记项，依赖的是文件里已有的 `ChartColumn` 导入
  // （与热点图、统计有关的那一类图标）。纯附加改动，冲突时按并集收，
  // 若上游重写时删掉了 `ChartColumn`，修法是把导入补回来 —— 一个词。
  'tab.categories': ChartColumnGlyph as unknown as typeof ChartColumn,
  'tab.ai': AiMarkGlyph as unknown as typeof Sparkles,
  'tab.habits': FlameGlyph as unknown as typeof Flame,
  'tab.countdown': CalendarClockGlyph as unknown as typeof CalendarClock,
  'tab.profile': PersonGlyph as unknown as typeof User,
  'action.attach': PaperclipGlyph as unknown as typeof Paperclip,
  'action.image': ImagePlusGlyph as unknown as typeof ImagePlus,

  // 任务
  'task.add': PlusGlyph as unknown as typeof Plus,
  'task.done': CheckGlyph as unknown as typeof Check,
  'task.delete': TrashGlyph as unknown as typeof Trash2,
  'task.due': CalendarClockGlyph as unknown as typeof CalendarClock,
  'task.overdue': TriangleAlertGlyph as unknown as typeof TriangleAlert,
  'task.repeat': RepeatGlyph as unknown as typeof Repeat,
  'task.reopen': RotateCcwGlyph as unknown as typeof RotateCcw,
  'task.reminder': BellGlyph as unknown as typeof Bell,
  'task.priority': FlagGlyph as unknown as typeof Flag,
  /** 旗标（提醒事项的"标记为重要"）。与优先级共用一个 Flag 字形。 */
  'task.flag': FlagGlyph as unknown as typeof Flag,

  /**
   * 行上下文菜单与左滑动作（`docs/plans/row-actions-redesign.md` §3.4 的移动那一列）。
   *
   * 🔴 语义名而不是图标名：菜单项与左滑那枚用的是**同一组语义**，
   * 换字形只改这一处。`task.unabandon` 用 `ArchiveRestore` 而不是 `RotateCcw`，
   * 因为 `task.reopen` 已经是「取消完成」那一格 —— 同一个字形在两处表示两件事，
   * 正是本文件开头要避免的那类缺陷（依据 `ADR-0083` §3.1：放弃与完成互不推导）。
   */
  'task.open': ArrowUpRightGlyph as unknown as typeof ArrowUpRight,
  'task.pin': PinGlyph as unknown as typeof Pin,
  'task.unpin': PinOffGlyph as unknown as typeof PinOff,
  'task.abandon': ArchiveGlyph as unknown as typeof Archive,
  'task.unabandon': ArchiveRestoreGlyph as unknown as typeof ArchiveRestore,
  'task.select': SquareCheckGlyph as unknown as typeof SquareCheck,
  /**
   * 清单（PROJECT）。
   *
   * 🔴 用 `Folder` 而不是 `ListTodo` —— 后者已经是「任务」这个 tab 的字形，
   * 两者同时出现在详情页上下两处（tab 栏 + 清单选择器）会让人以为
   * 点清单就是回任务列表。**语义名相同就复用，不同就必须换字形。**
   */
  'task.project': FolderGlyph as unknown as typeof Folder,

  /**
   * 标签。
   *
   * 🔴 与 `task.project` **必须不同字形**：清单和标签在数据模型上是两个实体，
   * 在界面上又出现在同一屏的相邻两段（「我的」页）。同一个 Folder 画两次
   * 会让人以为"标签"是清单的另一种写法。
   */
  'task.tag': TagGlyph as unknown as typeof Tag,

  /**
   * 便签（NOTE）。
   *
   * 🔴 与 `task.reminder`（Bell）**必须不同字形**：便签是一条独立记录
   * （可不挂清单、可钉到「今天」），与「提醒」是两件事。也不复用 `Inbox` ——
   * 那是 `group.inbox`「收集箱」分组的字形，语义不同。
   */
  'note.sticky': StickyNoteGlyph as unknown as typeof StickyNote,

  // 分组
  'group.today': ListTodoGlyph as unknown as typeof ListTodo,
  'group.inbox': InboxGlyph as unknown as typeof Inbox,
  'group.overdue': TriangleAlertGlyph as unknown as typeof TriangleAlert,
  'group.completed': CircleCheckBigGlyph as unknown as typeof CircleCheckBig,

  // 冲突解决
  // 🔴 语义名而不是图标名：`conflict.warning` 而不是 `triangle-alert`。
  // 与 Web 端 `ConflictDialog` 用的是同一组语义（AlertTriangle / Monitor / Smartphone），
  // 于是两端在同一个情境下画的是同一个字形。
  'conflict.warning': TriangleAlertGlyph as unknown as typeof TriangleAlert,
  'device.local': SmartphoneGlyph as unknown as typeof Smartphone,
  'device.remote': MonitorGlyph as unknown as typeof Monitor,
  'action.keep': CheckGlyph as unknown as typeof Check,

  // 专注
  // 与任务图标同样的理由：语义名（`focus.pause`）而不是图标名（`Pause`）——
  // 换图标库时语义名不用改，而且"暂停"在两处必须是同一个字形。
  'focus.work': TargetGlyph as unknown as typeof Target,
  'focus.break': CoffeeGlyph as unknown as typeof Coffee,
  'focus.play': PlayGlyph as unknown as typeof Play,
  'focus.pause': PauseGlyph as unknown as typeof Pause,
  'focus.abort': SquareGlyph as unknown as typeof Square,
  'focus.stats': ChartColumnGlyph as unknown as typeof ChartColumn,
  'focus.streak': FlameGlyph as unknown as typeof Flame,
  'focus.link': Link2Glyph as unknown as typeof Link2,

  // 通用
  'action.prev-month': ChevronLeft,
  /**
   * 「点进去还有一层」。与 `action.next-month`（翻到下个月）**必须分开** ——
   * 同一个字形（ChevronRight）承载两个语义会让用户读错：
   * 一个说"时间往后"，一个说"层级往下"。
   *
   * 🔴 2026-11-15 补：`ProfileScreen` 的账号卡一直缺这枚箭头，
   * 注释写着"图标注册表里没有一枚 `action.disclose`……登记为欠账"。
   * 现在补上，账号卡就能画出"这里能进"。
   */
  /**
   * AI 工具箱。原来它和「AI 助手」共用 `AssistantMark` ——
   * 两行名字都以「AI」开头、图标又一样，读起来是同一件事。
   * 图标在这类列表里是**唯一的区分线索**，撞图标等于丢线索。
   */
  'action.toolbox': WrenchGlyph as unknown as typeof Wrench,
  'action.disclose': ChevronRightGlyph as unknown as typeof ChevronRight,
  /** 往下展开（"点我换一档"）。与 `action.disclose` 同一个字形家族，方向不同。 */
  'action.disclose-down': ChevronDown,
  /*
   * 日历档位字形（`CalendarViewMenu` 每行一枚）。
   * 语义名而不是图标名 —— 与全仓其余图标同一个规矩。
   */
  'calendar.month': CalendarDaysGlyph as unknown as typeof CalendarDays,
  'calendar.week': CalendarRangeGlyph as unknown as typeof CalendarRange,
  'calendar.day': CalendarClockGlyph as unknown as typeof CalendarClock,
  'calendar.year': LayoutGridGlyph as unknown as typeof LayoutGrid,
  'action.next-month': ChevronRight,
  // 🔴 「返回」与「上一月」是**不同语义**，所以用不同字形：`ArrowLeft` 是
  // 进出层级的通用返回，`ChevronLeft` 是月历的翻页。两者在成长屏与日历屏
  // 各出现一次，字形相同会让人以为它们做同一件事。
  'action.back': BackGlyph as unknown as typeof ArrowLeft,
  'action.close': CloseGlyph as unknown as typeof X,
  'action.settings': SettingsGlyph as unknown as typeof Settings,
  // 🔴 与共享 `SearchPanel` 输入行里那个放大镜**同一个字形**：入口和它打开的
  // 东西长得不一样，用户就不会把这两个认成同一件事。
  'action.search': SearchGlyph as unknown as typeof Search,
  'action.send': SendGlyph as unknown as typeof Send,
  'assistant.new-session': Plus,
  /**
   * 排序档位。`ArrowUpDown` 是"这一列可以换个顺序看"的通用字形，
   * 而 `ListTodo` / `Inbox` 都已经各自占住了"任务"与"收集箱"的语义 ——
   * 借用它们会让 chip 读起来像"切换到某个视图"，而它改的是顺序不是内容。
   */
  'action.sort': ArrowUpDownGlyph as unknown as typeof ArrowUpDown,
  'action.sync': SyncGlyph as unknown as typeof RefreshCw,
  /**
   * 「或者用别的方式」那一组的标题图标。
   *
   * 🔴 用 `Ellipsis`（三个点）而不是 `Plus`：这一组**不新增任何东西**，它只是
   * 把主路之外还剩的路摆出来。`Plus` 会读成"点这里加一条"。
   */
  /**
   * 订阅 / 权益。**不再借 `action.more`（省略号）** ——
   * 2026-11-14 看图才发现「订阅」那一行前面是一枚「⋯」。
   * 省略号在 UI 里唯一的含义是"还有更多"，把它当"订阅"用是**没有语义**。
   */
  'action.subscription': CrownGlyph as unknown as typeof Crown,
  /** 外观与语言（显示相关）。此前借的是齿轮，而齿轮在设置语境里是"设置"本身。 */
  'action.display': MonitorGlyph as unknown as typeof Monitor,
  /** 关于 / 帮助。同一个错：「关于与帮助」也曾借 `action.more`。 */
  'action.info': InfoGlyph as unknown as typeof Info,
  'action.more': MoreGlyph as unknown as typeof Ellipsis,
  'action.expand': ChevronDownGlyph as unknown as typeof ChevronDown,
  'action.collapse': ChevronUpGlyph as unknown as typeof ChevronUp,
  /**
   * 导出 / 分享。
   *
   * 🔴 语义名是 `action.share` 而不是 `action.download`：移动端**没有**
   * `<a download>`，导出走的是系统分享面板（`Share.share`）。用云朵下载箭头
   * 会承诺一个并不存在的动作 —— 图标和按钮文案必须说同一件事。
   */
  'action.share': Share2Glyph as unknown as typeof Share2,
  /**
   * 「改名」。
   *
   * 🔴 与共享组件 `OrganizerList` 行上那支铅笔**同一个字形**（`Pencil`）：
   * 清单/标签的行内改名走共享层，习惯的改名入口在宿主（输入控件规范不同、
   * 各自各写一份），两处长得不一样会让人以为是两种不同的动作。
   */
  'action.rename': PencilGlyph as unknown as typeof Pencil,

  /**
   * 成长（激励体系）。
   *
   * 「今天」与「连续」**复用**已有的 `group.today` / `focus.streak` ——
   * 语义相同就该是同一个字形。另外三个是这个界面独有的语义，各给一个
   * 新字形（周视图 / 里程碑 / 身份），避免与任务、专注的图标混在一起。
   */
  'growth.week': CalendarRangeGlyph as unknown as typeof CalendarRange,
  'growth.milestones': TrophyGlyph as unknown as typeof Trophy,
  'growth.identity': BadgeCheckGlyph as unknown as typeof BadgeCheck,
  /**
   * 「带走这一周」（把周小结复制成纯文本）。与 `growth.week` **不同字形**：
   * 那一个是"这一周的数据"，这一个是"把这段文字交出去"—— 共享层的
   * `ShareSummarySection` 用的也是复制图标，两端同一个语义该是同一个字形。
   */
  'growth.share': CopyGlyph as unknown as typeof Copy,

  /**
   * 隐私同意面板。
   *
   * 🔴 与 `action.settings`（齿轮）**不同字形**：那里是"改偏好"，这里是
   * "这台设备能不能对外说话"的法律决定。同一个字形会让用户以为同意是
   * 一个可以随时改的普通开关，而撤回它需要一条单独的路径（PIPL 第 15 条）。
   */
  'privacy.consent': ShieldCheckGlyph as unknown as typeof ShieldCheck,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** 尺寸档位：对应 `icon.*` token，外加标签栏专用的一档。 */
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'tab';

export interface IconProps {
  name: IconName;
  /**
   * 默认 `md`。标签栏用 `tab`。
   *
   * 🔴 也接受 **token 全名**（`'icon.sm'`）：形状契约
   * （`packages/design-system/src/choice-row-shape.ts` 这类）登记的是
   * `TokenName`，让调用方自己把 `'icon.sm'` 拆成 `'sm'` 会在每个调用点
   * 复制一次那条规则，而复制必然漂移。
   */
  size?: IconSize | `icon.${IconSize}`;
  /** 描边色。不传则用 `color.foreground`。 */
  color?: string;
  /** 描边宽度。Lucide 默认 2；标签栏用 2 更清楚，正文旁用 1.75 更轻。 */
  strokeWidth?: number;
}

export function Icon({
  name,
  size = 'md',
  color,
  strokeWidth = 2,
}: IconProps): React.JSX.Element {
  const t = useTokens();
  const Glyph = ICONS[name];
  // 标签栏图标用 nav 组的 token（它与 11px 字标签同居，视觉尺寸是配套的），
  // 其余用 icon 组。
  // `tab` 不属于 `icon.*` 那一族（它有自己与 11px 字标签配套的尺寸）。
  const px = size === 'tab'
    ? t['nav.tab-icon-size']
    : t[(size.startsWith('icon.') ? size : `icon.${size}`) as `icon.${Exclude<IconSize, 'tab'>}`];

  return (
    <Glyph
      size={px}
      strokeWidth={strokeWidth}
      color={color ?? t['color.foreground']}
      // 🔴 Lucide 的图标是**线性**的：靠 stroke 上色，`fill` 默认是 'none'。
      // 选中态若要"实心"，不能只换 color（那是换个颜色的空心），
      // 得换一个实心的图标名或单独处理。这里统一保持线性 ——
      // 选中态用**颜色 + 指示条**表达，而不是实心，避免两种字形风格混用。
    />
  );
}
