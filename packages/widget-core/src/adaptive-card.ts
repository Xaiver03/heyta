/**
 * Windows（PWA widget）的 **Adaptive Card 模板 + 数据构建**。
 * ==========================================================
 *
 * ## 🔴 为什么这一层在 `widget-core` 而不是在 `apps/web`
 *
 * Windows 组件的渲染**不是 HTML**，是 **Adaptive Card 模板 + JSON 数据**：
 *
 * ```
 * manifest.widgets[i].ms_ac_template  →  模板 URL（静态，随应用发布）
 * manifest.widgets[i].data            →  初始数据
 * widgets.updateByTag(tag, { data })  →  刷新数据
 * ```
 *
 * 于是「组件长什么样」= 模板，「组件显示什么」= 数据。**数据这一半必须与其它三端
 * 从同一份载荷算出来** —— 否则 Windows 会显示一份与 iOS/Android 不同的任务列表，
 * 而这是最不可能被发现的缺陷（没人会同时盯着三个平台的同一台设备）。
 *
 * 所以：**数据构建在这里（纯函数、可测、吃同一份 golden fixture）**，
 * 模板也在这里（**生成**成 JSON 文件给 manifest 用，见下），
 * 只有 service worker 的胶水留在 `apps/web`。
 *
 * ## 🔴 模板是**生成物**，不是手写的
 *
 * `apps/web/public/widgets/*.json` 由 `pnpm --filter @heyta/widget-core gen:adaptive-cards`
 * 从本文件的 `ADAPTIVE_CARD_TEMPLATES` 生成。理由与黄金夹具完全一样：
 * 手写的模板会与 `buildAdaptiveCardData` 漂移，而**漂移的表现是组件显示空白或 `${xxx}` 字面量** ——
 * 在 Windows 上才会看到，本机看不见。有一条测试钉着"磁盘上的 JSON === 重新生成的结果"。
 *
 * ⚠️ **顺序也是契约的一部分**（和快照载荷一样）：Adaptive Card 的
 * `$data` 数组按顺序渲染，而载荷里的顺序是"选择器决定的顺序"。
 * 这里**不重排**，只映射。
 *
 * ## 本文件的两个"不"（都是刻意的）
 *
 * 1. **不显示倒计时** —— 见 `buildFocusCardData` 的注释，与 Android `FocusWidgetModel`
 *    的取舍逐条一致：`remainingSeconds` 是**发布那一刻**的快照，画出来就是错的。
 * 2. **不画项目色** —— 载荷带的是已解析的 `{ light, dark }` 十六进制（决策 D7），
 *    而 Adaptive Card 的文本色只接受枚举（`default`/`dark`/`light`/`accent`/`good`/`warning`/`attention`），
 *    **不接受任意色值**。这是一个**平台能力边界**，不是遗漏 ——
 *    强行用 `Image` 拼色块会让每一行多一次网络往返，不值得。
 */

import { QUADRANT_META, Quadrant } from '@heyta/domain';

import type { WidgetPayload, WidgetTask } from './contract.js';

/** 四款组件在 Windows 上的**标签**（`tag`）—— 刷新时用它定位要更新哪一款。 */
export const ADAPTIVE_CARD_KINDS = ['today', 'quadrant', 'habits', 'focus'] as const;

export type AdaptiveCardKind = (typeof ADAPTIVE_CARD_KINDS)[number];

export const ADAPTIVE_CARD_SCHEMA =
  'http://adaptivecards.io/schemas/adaptive-card.json';

/**
 * Adaptive Card 版本。
 *
 * ⚠️ 选 **1.5** 而不是最新：`Action.Execute`（组件里唯一可用的交互动作）从 **1.4** 起可用，
 * 而 Windows 组件宿主对更高版本的解析覆盖率没有保证。**用能满足需求的最低版本** ——
 * 版本号写高了不会报错，只会让组件在某些宿主版本上**整个渲染不出来**。
 */
export const ADAPTIVE_CARD_VERSION = '1.5';

// ─────────────────────────────────────────────────────────────────────
// 数据形状
// ─────────────────────────────────────────────────────────────────────

/** 一行任务（今日 / 四象限共用）。 */
export interface AdaptiveCardTaskRow {
  id: string;
  title: string;
  /** 当前是否已完成 —— 也决定点击时要写回的目标状态。 */
  done: boolean;
  /** 点击时要写回的目标状态 = `!done`。**在数据里算好**，不让模板做逻辑。 */
  targetIsDone: boolean;
  /** 完成态的视觉（模板直接绑它，避免模板里写条件表达式）。 */
  style: 'default' | 'good';
  strikethrough: boolean;
}

export interface AdaptiveCardTodayData {
  kind: 'today';
  /**
   * 🔴 快照不可信（登出 / 解不开 / 版本不认识）时为 `true`。
   *
   * 四款组件**都有这个字段**，理由是本项目最反对的那类缺陷：
   * 不知道的时候**不能装作知道**。"今天没有任务"在真正不知道的时候是**撒谎** ——
   * 用户看到它就不会去做那件事。所以四款组件的模板第一条都是
   * 「打开 Heyta 以显示小组件」，且**真实内容整块**在 `showPlaceholder` 时隐藏。
   */
  showPlaceholder: boolean;
  dayStr: string;
  count: number;
  isEmpty: boolean;
  rows: AdaptiveCardTaskRow[];
}

export interface AdaptiveCardQuadrantSlot {
  key: string;
  label: string;
  hint: string;
  count: number;
  isEmpty: boolean;
  rows: AdaptiveCardTaskRow[];
}

export interface AdaptiveCardQuadrantData {
  kind: 'quadrant';
  /** 见 `AdaptiveCardTodayData.showPlaceholder`。 */
  showPlaceholder: boolean;
  dayStr: string;
  slots: AdaptiveCardQuadrantSlot[];
}

export interface AdaptiveCardHabitRow {
  id: string;
  title: string;
  doneToday: boolean;
  /** 已格式化好的连续天数文案。**不在模板里做字符串拼接** —— 那是本地化的位置。 */
  streakLabel: string;
  /** 未完成时为空串，模板绑它即可。 */
  doneLabel: string;
}

export interface AdaptiveCardHabitsData {
  kind: 'habits';
  /** 见 `AdaptiveCardTodayData.showPlaceholder`。 */
  showPlaceholder: boolean;
  dayStr: string;
  isEmpty: boolean;
  rows: AdaptiveCardHabitRow[];
}

/**
 * 专注组件的四种状态。
 *
 * ⚠️ 与 Android `FocusWidgetState` **逐条对应**（`PLACEHOLDER`/`STALE`/`IDLE`/`ACTIVE`）。
 * 两端状态机不一致的话，同一个用户在两个设备上会看到不同的结论。
 */
export type AdaptiveCardFocusState = 'placeholder' | 'stale' | 'idle' | 'active';

export interface AdaptiveCardFocusData {
  kind: 'focus';
  /** 见 `AdaptiveCardTodayData.showPlaceholder`。`stale` 时**不**是占位（那条另有文案）。 */
  showPlaceholder: boolean;
  state: AdaptiveCardFocusState;
  dayStr: string | null;
  /** 仅 `active` 时非空。 */
  sessionTitle: string;
  /** 仅 `active` 时非空。**目标时长**（静态事实，不会随时间变）。 */
  targetLabel: string;
}

export type AdaptiveCardData =
  | AdaptiveCardTodayData
  | AdaptiveCardQuadrantData
  | AdaptiveCardHabitsData
  | AdaptiveCardFocusData;

// ─────────────────────────────────────────────────────────────────────
// 内部：一行任务
// ─────────────────────────────────────────────────────────────────────

function toTaskRow(task: WidgetTask): AdaptiveCardTaskRow {
  const done = task.isDone === true;
  return {
    id: task.id,
    title: task.title,
    done,
    targetIsDone: !done,
    style: done ? 'good' : 'default',
    strikethrough: done,
  };
}

/** 秒 → "25 分钟"。非整数分钟向上取整；0 秒给 "不到 1 分钟"。 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '不到 1 分钟';
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} 分钟`;
}

// ─────────────────────────────────────────────────────────────────────
// 数据构建（纯函数）
// ─────────────────────────────────────────────────────────────────────

/**
 * 今日任务的数据。
 *
 * 🔴 **不排序、不过滤** —— 载荷里的顺序就是选择器的顺序（已完成沉底由选择器负责）。
 * 在这里再排一次的话，Android / iOS 的组件的顺序会与 Windows 不同，
 * 而三份实现各自都有自己的"看起来对"的理由。
 */
export function buildTodayCardData(payload: WidgetPayload, dayStr: string): AdaptiveCardTodayData {
  const rows = payload.today.map(toTaskRow);
  return {
    kind: 'today',
    dayStr,
    count: rows.length,
    isEmpty: rows.length === 0,
    rows,
    showPlaceholder: false,
  };
}

/** 四象限的数据。四个槽**恒定存在**（空的也给，模板不用做存在性判断）。 */
export function buildQuadrantCardData(
  payload: WidgetPayload,
  dayStr: string,
): AdaptiveCardQuadrantData {
  // 🔴 **显式列出四个槽**，不用 `Object.values(Quadrant)` ——
  //    数字枚举的 `Object.values` 会同时返回**名字和数字**
  //    （`['UrgentImportant', …, 1, 2, 3, 4]`），于是模板里会多出 4 个
  //    标签为 `undefined` 的空槽。`selectors.ts` 的 `selectQuadrant` 里
  //    已经踩过同一个坑并留了注释 —— 这里照同样的写法。
  const slots: AdaptiveCardQuadrantSlot[] = [
    Quadrant.UrgentImportant,
    Quadrant.ImportantNotUrgent,
    Quadrant.UrgentNotImportant,
    Quadrant.Neither,
  ].map((slot) => {
    const meta = QUADRANT_META[slot];
    const rows = ((payload.quadrant ?? {})[String(slot)] ?? []).map(toTaskRow);
    return {
      key: String(slot),
      // ⚠️ 标签来自 `@heyta/domain` 的 `QUADRANT_META`，**不是这里写的字符串** ——
      //    四象限的显示名已经有三个手抄本（域 / Android strings.xml / iOS WidgetStrings），
      //    这里**刻意不从第四处抄**。见账本 U11。
      label: meta.label,
      hint: meta.hint,
      count: rows.length,
      isEmpty: rows.length === 0,
      rows,
    };
  });
  return { kind: 'quadrant', dayStr, slots, showPlaceholder: false };
}

export function buildHabitsCardData(payload: WidgetPayload, dayStr: string): AdaptiveCardHabitsData {
  const rows: AdaptiveCardHabitRow[] = (payload.habits ?? []).map((habit) => ({
    id: habit.id,
    title: habit.title,
    doneToday: habit.doneToday === true,
    // ⚠️ 0 天**不显示**"连续 0 天" —— 那读起来像在怪用户。
    streakLabel: habit.streak > 0 ? `连续 ${habit.streak} 天` : '',
    doneLabel: habit.doneToday === true ? '今天已完成' : '',
  }));
  return { kind: 'habits', dayStr, isEmpty: rows.length === 0, rows, showPlaceholder: false };
}

/**
 * 专注的数据。
 *
 * ## 🔴 为什么不显示倒计时（与 Android `FocusWidgetModel` 的取舍逐条一致）
 *
 * `WidgetFocus.remainingSeconds` 是**发布那一刻**算出来的快照，而且契约里
 * **没有任何绝对时间锚点**。于是应用在 09:00 发布"剩余 25:00"，
 * 用户 09:10 看一眼组件 —— 组件照着画就会显示 **"剩余 25:00"**。
 *
 * 那不是"稍微不准"，那是**错的**：它看起来是对的（一个整整齐齐的倒计时），
 * 用户没有理由怀疑它；而真实剩余是 15:00。更糟的是 `active` 也是冻结的 ——
 * 一场 09:25 就结束的专注，10:00 时组件还会说"专注中"。
 *
 * | 快照说 | 这里画 |
 * |---|---|
 * | 没有快照 / 解不开 | `placeholder` |
 * | 快照过期 | `stale` |
 * | `active == false` | `idle` |
 * | `active == true` | `active`：会话标题 + **目标时长**（静态事实，过多久都不会过期） |
 *
 * ⚠️ 正确的修法是给 `WidgetFocus` 加绝对字段 `endsAt`（账本 **U8**）——
 * 那是一次**契约变更**，四端解析器 + 黄金夹具都要动。**本轮刻意不做**：
 * 四端现在的"只画静态量"是**自洽且不撒谎**的，`endsAt` 是增强而不是修 bug。
 */
export function buildFocusCardData(payload: WidgetPayload, dayStr: string): AdaptiveCardFocusData {
  // ⚠️ 契约里 `focus` 是**可选**字段。缺失时按"没有进行中的专注"处理（`idle`），
  //    而不是 `placeholder` —— `placeholder` 的语义是"**快照**没拿到"，
  //    那由 `buildFocusCardFallback` 负责。把两者混起来的话，
  //    "应用发布了一份没带 focus 的快照"会显示成"打开 Heyta 以显示小组件"，
  //    而应用明明已经打开过了 —— 用户会去重装应用。
  const focus = payload.focus;

  if (!focus || focus.active !== true) {
    return {
      kind: 'focus',
      state: 'idle',
      dayStr,
      sessionTitle: '',
      targetLabel: '',
      showPlaceholder: false,
    };
  }

  return {
    kind: 'focus',
    state: 'active',
    dayStr,
    sessionTitle: focus.sessionTitle ?? '',
    showPlaceholder: false,
    // ⚠️ 用 `targetSeconds`（目标）而不是 `remainingSeconds`（剩余）。
    targetLabel:
      typeof focus.targetSeconds === 'number' && focus.targetSeconds > 0
        ? `目标 ${formatDuration(focus.targetSeconds)}`
        : '',
  };
}

/** 占位 / 过期态的数据（快照拿不到时用）。 */
export function buildFocusCardFallback(state: 'placeholder' | 'stale'): AdaptiveCardFocusData {
  return {
    kind: 'focus',
    state,
    dayStr: null,
    sessionTitle: '',
    targetLabel: '',
    // `stale` 有自己的文案（"数据已过期，打开 Heyta 刷新"），不是占位
    showPlaceholder: state === 'placeholder',
  };
}

/**
 * 四款组件的**占位数据**：快照不可信时推这个。
 *
 * 🔴 必须**四款都有**，而且必须是各自 kind 的形状。
 * 用一款的占位数据去填另一款，模板绑定的字段一个都对不上 ——
 * 组件会显示一堆空白（或者字面量 `${count}`），而且在 Windows 上才看得见。
 * `tests/adaptive-card.spec.ts` 的"模板绑的每个字段在数据里都存在"
 * 那条测试**覆盖不到**这种情况（占位数据没有走它），所以有一条单独的测试
 * 逐款断言占位数据的形状与正常数据一致。
 */
export function buildAdaptiveCardPlaceholder(kind: AdaptiveCardKind): AdaptiveCardData {
  switch (kind) {
    case 'today':
      return { kind: 'today', dayStr: '', count: 0, isEmpty: true, rows: [], showPlaceholder: true };
    case 'quadrant':
      return { kind: 'quadrant', dayStr: '', slots: [], showPlaceholder: true };
    case 'habits':
      return { kind: 'habits', dayStr: '', isEmpty: true, rows: [], showPlaceholder: true };
    case 'focus':
      return buildFocusCardFallback('placeholder');
  }
}

export function buildAdaptiveCardData(
  kind: AdaptiveCardKind,
  payload: WidgetPayload,
  dayStr: string,
): AdaptiveCardData {
  switch (kind) {
    case 'today':
      return buildTodayCardData(payload, dayStr);
    case 'quadrant':
      return buildQuadrantCardData(payload, dayStr);
    case 'habits':
      return buildHabitsCardData(payload, dayStr);
    case 'focus':
      return buildFocusCardData(payload, dayStr);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 模板
// ─────────────────────────────────────────────────────────────────────

export interface AdaptiveCardTemplate {
  $schema: string;
  type: 'AdaptiveCard';
  version: string;
  body: unknown[];
  actions?: unknown[];
}

/** 一行任务的模板片段（今日 / 四象限共用）。 */
function taskRowTemplate(): unknown {
  return {
    type: 'ColumnSet',
    spacing: 'Small',
    selectAction: {
      type: 'Action.Execute',
      // 🔴 `taskId` 与 `targetIsDone` **必须**在 `data` 里：
      //    Windows 的 `widgetclick` 事件把这里的东西原样交给 service worker，
      //    而 service worker 要凭它写一条意图。少一个字段 = 点击被丢掉，
      //    且**没有任何错误**（事件照常触发，只是什么都做不了）。
      verb: 'toggle',
      data: { taskId: '${id}', targetIsDone: '${targetIsDone}' },
    },
    columns: [
      { type: 'Column', width: 'auto', items: [{ type: 'TextBlock', text: '·', size: 'Medium' }] },
      {
        type: 'Column',
        width: 'stretch',
        items: [
          {
            type: 'TextBlock',
            text: '${title}',
            wrap: true,
            color: '${style}',
            strikethrough: '${strikethrough}',
          },
        ],
      },
    ],
  };
}

function textBlock(text: string, extra: Record<string, unknown> = {}): unknown {
  return { type: 'TextBlock', text, wrap: true, ...extra };
}

/** 占位文案（四款组件共用同一句）。 */
const PLACEHOLDER_TEXT = '打开 Heyta 以显示小组件';

/**
 * 每款组件模板的**共同开头**：一条占位文案 + 一个"真实内容"容器。
 *
 * 🔴 把这条抽出来不是为了少写几行，而是为了让**四款组件不可能漏掉占位态**。
 * 四款里漏掉一款的症状是：登出之后那一款还在显示旧任务 ——
 * 而用户已经登出了。这是决策 D6 点名要防的事。
 */
function withPlaceholderGate(realContent: unknown[]): unknown[] {
  return [
    textBlock(PLACEHOLDER_TEXT, { isSubtle: true, isVisible: '${showPlaceholder}' }),
    { type: 'Container', isVisible: '${!showPlaceholder}', items: realContent },
  ];
}

export const ADAPTIVE_CARD_TEMPLATES: Record<AdaptiveCardKind, AdaptiveCardTemplate> = {
  today: {
    $schema: ADAPTIVE_CARD_SCHEMA,
    type: 'AdaptiveCard',
    version: ADAPTIVE_CARD_VERSION,
    body: withPlaceholderGate([
      textBlock('今日任务', { weight: 'Bolder', size: 'Medium' }),
      textBlock('${count} 项', { isSubtle: true, spacing: 'None' }),
      textBlock('今天没有任务', { isSubtle: true, isVisible: '${isEmpty}' }),
      { type: 'Container', $data: '${rows}', items: [taskRowTemplate()] },
    ]),
  },
  quadrant: {
    $schema: ADAPTIVE_CARD_SCHEMA,
    type: 'AdaptiveCard',
    version: ADAPTIVE_CARD_VERSION,
    body: withPlaceholderGate([
      textBlock('四象限', { weight: 'Bolder', size: 'Medium' }),
      {
        type: 'Container',
        $data: '${slots}',
        items: [
          textBlock('${label}（${count}）', { weight: 'Bolder', spacing: 'Medium' }),
          textBlock('${hint}', { isSubtle: true, spacing: 'None' }),
          { type: 'Container', $data: '${rows}', items: [taskRowTemplate()] },
        ],
      },
    ]),
  },
  habits: {
    $schema: ADAPTIVE_CARD_SCHEMA,
    type: 'AdaptiveCard',
    version: ADAPTIVE_CARD_VERSION,
    body: withPlaceholderGate([
      textBlock('习惯', { weight: 'Bolder', size: 'Medium' }),
      textBlock('还没有习惯', { isSubtle: true, isVisible: '${isEmpty}' }),
      {
        type: 'Container',
        $data: '${rows}',
        items: [
          {
            type: 'ColumnSet',
            spacing: 'Small',
            columns: [
              {
                type: 'Column',
                width: 'stretch',
                items: [textBlock('${title}')],
              },
              {
                type: 'Column',
                width: 'auto',
                items: [textBlock('${doneLabel}', { color: 'good' })],
              },
            ],
          },
          textBlock('${streakLabel}', { isSubtle: true, size: 'Small', spacing: 'None' }),
        ],
      },
    ]),
  },
  focus: {
    $schema: ADAPTIVE_CARD_SCHEMA,
    type: 'AdaptiveCard',
    version: ADAPTIVE_CARD_VERSION,
    body: withPlaceholderGate([
      // ⚠️ 这四句是**互斥**的四种状态，不是四条并列的提示。
      //    用一个 `state` 字段而不是四个布尔量，是为了让"同时显示两句"
      //    在数据层面就**不可能**构造出来。
      textBlock('数据已过期，打开 Heyta 刷新', {
        isSubtle: true,
        isVisible: "${state == 'stale'}",
      }),
      textBlock('没有进行中的专注', { isSubtle: true, isVisible: "${state == 'idle'}" }),
      textBlock('${sessionTitle}', {
        weight: 'Bolder',
        isVisible: "${state == 'active'}",
      }),
      textBlock('${targetLabel}', {
        isSubtle: true,
        isVisible: "${state == 'active'}",
      }),
      // 🔴 这里**没有** `remainingSeconds` 的绑定 —— 见 `buildFocusCardData`。
      //    模板里留一个没被绑定的字段不会报错，只会让组件显示字面量 `${x}`；
      //    而漏掉"不许有倒计时"这条规则**不会有任何症状**，所以它写在测试里。
    ]),
  },
};

// ─────────────────────────────────────────────────────────────────────
// 生成物序列化
// ─────────────────────────────────────────────────────────────────────

/**
 * 把四份模板渲染成**要落盘的 JSON 文本**。
 *
 * 🔴 这个函数是**唯一**的序列化入口：生成脚本用它写文件，
 * 测试用它算"重新生成的结果"并与磁盘比对。
 * 两处各写一遍 `JSON.stringify(..., 2)` 的话，缩进/换行差一个字符
 * 就会让"漂移检查"永远红（或者更糟：永远绿，因为两边都不对）。
 */
export function serializeAdaptiveCardTemplates(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kind of ADAPTIVE_CARD_KINDS) {
    // 末尾补换行 —— 仓库里所有生成物都带，缺它会让 `git diff` 出现 "\ No newline" 噪音
    out[`${kind}.json`] = `${JSON.stringify(ADAPTIVE_CARD_TEMPLATES[kind], null, 2)}\n`;
  }
  return out;
}
