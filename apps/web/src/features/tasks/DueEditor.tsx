/**
 * 任务的「截止」字段：一份实现、两个落点（工单 §8.146）
 * ====================================================
 *
 * 本文件现在导出**三件**东西，各自住在哪儿是这一单的全部形状：
 *
 * | 产品 | 谁消费 | 画在哪 |
 * |---|---|---|
 * | `DueField` | `TaskDetailCard`（栏里）**和** `DueEditor`（行尾浮层内） | 编辑本体，**在流、无外壳** |
 * | `DueEditor`（`<summary>` + `<details>` + Portal/在流两副外壳） | `App.tsx` 行尾，`taskPaneInColumn` 为假时 | 行上（窄档回落） |
 * | —— 行上**没有**只读徽标这一件 | 截止的显示一直住在共享行的元信息条里（`task-meta` → `TaskBadges.due`） | 行上（两档都在） |
 *
 * 🔴 第三行是这一格与 §8.138/§8.141/§8.144/§8.145 那四格的**唯一形状差**，而且是现量查出来的：
 * 行尾那颗 `<summary>` 原本也在显示当前值（「截止 10月5日」），而同一行的元信息条**已经**在显示
 * 同一个 `dueDate`（`date` 档是 `10-05`、`countdown` 档是「明天」）。也就是说列表上那条任务
 * 此前把同一件事说了两遍。搬走编辑入口时**不补徽标**，就是把那第二份显示一并撤掉 ——
 * 工单 §8.141 第 5 节那条硬约束（截止的**显示**必须留在行上）由既有的 `task-meta` 满足，
 * 不是由本文件满足。
 *
 * 🔴 **这个文件补的是 Web 端的一个真实空洞**（多端覆盖审计 P0-3）：
 * `setDueDate` 的语义一直完整（动作层 + store），但全 Web **零 UI 调用点** ——
 * 唯一沾边的是 AI 捕获确认框的日期输入，那是建任务时，不是事后改。
 * 想给任务设"周五截止"，Web 用户没有任何直接办法；桌面三壳吃同一份载荷，
 * 主战场的 macOS / Windows 同样改不了 due。移动端早就有（详情页的
 * DatePicker），这一刀把两端挪到**同一只**共享选择器上。
 *
 * 三个决定（与 `TaskOrganizer` 同一套惯例）：
 *
 * 1. **用原生 `<details>/<summary>`**：自带键盘操作与读屏语义。
 *    jsdom 不实现 summary 的展开切换 —— 组件级判据直接置 `open`，
 *    "点开"这个用户动作由真浏览器 e2e 钉。
 *    ⚠️ 这套机关属于**行尾那一支**：栏里那一格画的是 `DueField`，没有 `<details>`、
 *    也没有 `.ht-material`（§8.141/§8.144/§8.145 立过的 pane 级不变量）。
 * 2. **月历是共享 `DatePicker`**（`@heyta/ui`）：文案经 `labels` 注入，
 *    日期措辞复用 `common.date.*` / `common.weekday.*` —— 两端同一个说法。
 * 3. **一次选择 = 一条 op**：`onChange` 直接交给 `store.setDueDate`
 *    （清除传 `undefined` ⇒ 动作层写 `null`，能穿过 JSON）。
 *    本文件里**没有一行业务语义**。
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cssVar } from '@heyta/design-system';
import {
  dueDateToEpoch,
  localTimeOf,
  quickDuePickDates,
  toLocalDate,
  type Task,
} from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { DatePicker, WEEKDAY_MESSAGE_KEYS, formatMonthTitleText, type DatePickerQuickPick } from '@heyta/ui';
import { Calendar } from 'lucide-react';

import type { MessageKey } from '@heyta/i18n';

const TRIGGER_ICON_SIZE = 14;

/**
 * 弹层面板的**放置几何**（视口坐标）。三个数都是刻意分开的，各自有名字，
 * 因为"放哪"这件事以前是一个表达式：`rect.bottom + 500 < innerHeight`，
 * 于是"下面放不下就朝上"与"两头都放不下时怎么办"被写进了同一个常数里。
 */
const PANEL_EDGE = 8;
/** 面板与锚点之间的缝。 */
const PANEL_GAP = 8;
/**
 * 面板**估计高**（实测约 474：4 个快捷项 + 月标题 + 星期行 + 6 周，
 * 再加时刻那一行 ≈ 38 ⇒ 512；取 540 留一点余量）。
 *
 * 🔴 它是估计，不是事实 —— 事实由 `e2e/tests/due-date-edit.spec.ts` 那条
 *   "每一格都在视口内"的量兜住：**估计一旦漂小，那条判据立刻红**，
 *   而不是让用户选不到日期。加时刻那一行之前它是 500，
 *   而"面板里新增一栏会被同一条量到"正是留这条判据的理由。
 *
 * 🔴 它是 **export 的**：`apps/web/tests/due-date-edit.spec.tsx` 的那四条
 *   放置判据从这个常数推导，而不是自己抄一个 500 —— 抄的那一份已经漂过一次
 *   （加时刻行后实现变了、测试里的"面板高"还是旧值，四条照样全绿）。
 */
export const DUE_PANEL_HEIGHT_ESTIMATE = 540;

/**
 * 面板顶边落在视口的哪个 y。
 *
 * 三种情形，**第三种以前是"宁低不遮列表头"**（`DueEditor` 文件头那条注释），
 * 也就是"两头都放不下 ⇒ 仍然朝下开"。实测它的后果是**面板被视口底裁掉**：
 * 行落在 y≈500、视口 720 时，最后两周（含 18 号）根本不在屏幕上，
 * 而面板又是 fixed（滚动即关）⇒ **那个日期在界面上选不到**。
 * 遮一下列表头 与 选不到日期 不是同一档代价，所以第三种情形改成**夹进视口**。
 */
export function panelTopFor(
  anchorRect: { top: number; bottom: number },
  viewportHeight: number,
): number {
  const down = anchorRect.bottom + PANEL_GAP + DUE_PANEL_HEIGHT_ESTIMATE;
  const up = anchorRect.top - PANEL_GAP - DUE_PANEL_HEIGHT_ESTIMATE;
  if (down + PANEL_EDGE <= viewportHeight) return anchorRect.bottom + PANEL_GAP;
  if (up >= PANEL_EDGE) return up;
  return Math.max(PANEL_EDGE, viewportHeight - DUE_PANEL_HEIGHT_ESTIMATE - PANEL_EDGE);
}

/** 快捷项 key → 本端措辞。日期数学在 domain，这里只管说话。 */
const QUICK_PICK_LABEL_KEYS: Record<string, MessageKey> = {
  today: 'web.due.today',
  tomorrow: 'web.due.tomorrow',
  weekend: 'web.due.weekend',
  'next-week': 'web.due.nextWeek',
};

/**
 * 截止的**编辑本体**：共享 `DatePicker`（四个快捷项 + 月历 + 清除），**在流**、
 * 不带任何外壳。🔴 工单 §8.146 起它有两个落点 —— 栏里那一格直接画它，
 * 行尾那一支把它装进自己的两副外壳里（`DueEditor`）。
 *
 * ⚠️ 它带**本地 state**（`DatePicker` 里那个"正在看哪个月"），所以栏里那一支
 * 必须挂 `key={task.id}` —— 否则 ↑↓ 换选中时上一条浏览到的月份会跟着人走。
 * 这一格与 §8.145 那条"有本地 state 才要 key"的纪律正好是一组对照。
 */
export function DueField({
  task,
  now,
  onSetDueDate,
}: {
  task: Task;
  /** 冻结的"现在"（ms）。今天从它推，不由组件自己取时钟。 */
  now: number;
  /** 传 `undefined` 表示清除截止（动作层写 `null`）。 */
  onSetDueDate: (due: number | undefined, dueDateLocal?: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();

  const today = toLocalDate(now);
  const value = task.dueDateLocal ?? (task.dueDate === undefined ? undefined : toLocalDate(task.dueDate));

  const quickPicks: readonly DatePickerQuickPick[] = quickDuePickDates(today).map((pick) => ({
    key: pick.key,
    label: t(QUICK_PICK_LABEL_KEYS[pick.key]!),
    date: pick.date,
  }));

  /*
   * 判"有没有时刻"用的是共享层那一份 `localTimeOf`（时间线那条「全天」带
   * 读的是同一个判定）—— 这里如果自己再 `getHours() !== 0` 一次，
   * 就会出现"编辑器说全天、时间线画在 16:00"。
   */
  const timeValue = task.dueDateLocal !== undefined
    ? undefined
    : (task.dueDate === undefined ? undefined : localTimeOf(task.dueDate));

  return (
    <DatePicker
      value={value}
      today={today}
      quickPicks={quickPicks}
      labels={{
        weekdays: WEEKDAY_MESSAGE_KEYS.map((key) => t(key)),
        monthTitle: (month) => formatMonthTitleText(month, t),
        clear: t('web.due.clear'),
        prevMonth: t('web.due.prevMonth'),
        nextMonth: t('web.due.nextMonth'),
        dayLabel: (month, day) => t('web.due.dayLabel', { month, day }),
      }}
      time={{
        value: timeValue,
        // 🔴 没有日期就没有"几点"可言 —— 这一行会画出来但填不进字。
        enabled: value !== undefined,
        labels: {
          timeLabel: t('common.due.timeLabel'),
          allDay: t('common.due.allDay'),
          placeholder: t('common.due.timePlaceholder'),
          aria: t('common.due.timeAria', { title: task.title }),
        },
        onChange: (next) => {
          // `value` 一定在（`enabled` 为假时组件不会回调），这个判断是给
          // 类型看的，不是给运行时兜底的。
          if (value === undefined) return;
          onSetDueDate(dueDateToEpoch(value, next), next === undefined ? value : undefined);
        },
      }}
      onChange={(date) => {
        /*
         * 换日子**搬运已填的时刻**。
         *
         * 🔴 不搬就是"改个日期，16:00 悄悄没了" —— 界面上看不出任何事发生过，
         *   而提醒会因此提前一整天到（提醒算的是 `dueDate - offset`）。
         *   仓里对这件事已有先例：`postponeToToday` 用
         *   `dueDate - startOfDay(dueDate)` 主动把时分搬到新的一天，
         *   同一条立场在这里的输入侧执行一次。
         *   清掉日子（`undefined`）没有"哪一天的几点"可言，那时才真的归零。
         */
        onSetDueDate(
          date === undefined ? undefined : dueDateToEpoch(date, timeValue),
          date !== undefined && timeValue === undefined ? date : undefined,
        );
      }}
    />
  );
}

/**
 * 行尾那一支：`<details>` 展开机关 + 带当前值的触发器 + **两副外壳**（Portal 的 fixed 卡 /
 * details 内的在流卡）。🔴 工单 §8.146 起它**只在详情列没在画时挂在行尾**。
 */
export function DueEditor({
  task,
  now,
  onSetDueDate,
}: {
  task: Task;
  /** 冻结的"现在"（ms）。今天从它推，不由组件自己取时钟。 */
  now: number;
  /** 传 `undefined` 表示清除截止（动作层写 `null`）。 */
  onSetDueDate: (due: number | undefined, dueDateLocal?: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();

  const value = task.dueDateLocal ?? (task.dueDate === undefined ? undefined : toLocalDate(task.dueDate));

  /**
   * 🔴 面板**不能用 `position: absolute`**。实测（2026-10-02，探针
   * `e2e/due-editor-probe.cjs`）：任务列表的行容器是滚动容器
   * （`overflow: hidden auto`），absolute 面板被裁到只剩一条白边 ——
   * 几何在（boundingBox 正常、点击能中）、**画不出来**，与头像菜单
   * 当年被 rail 裁掉是同一族 bug。修法沿用那个先例：**fixed + 实测锚点
   * + 滚动/改窗即关**（关掉比弹在错位置诚实）。
   *
   * ⚠️ 2026-10-04 更正：这句原来写的是"jsdom 不触发 `toggle` ⇒ `anchor` 保持 null
   * ⇒ 面板回落**在流**布局（组件级 op 判据照常工作）"—— **它在 jsdom 27 上不成立**。
   * 探针实测：`details.open = true` 之后**一个宏任务**里 `toggle` 就到了
   * （jsdom 用 `setTimeout(…, 0)` 派发），`requestAnimationFrame` 在第 17ms 回调，
   * 所以组件级用例里 `anchor` 同样会变成非 null、面板同样换到 Portal 那副身体。
   * ⇒ "在流"这一副只在**第一个宏任务之前**存在。用例要面板里的东西一律从
   * `document` 取，不许假定它在哪棵子树里（`due-date-edit.spec.tsx` 就是这么修的）；
   * "真浏览器里弹出位置对"仍由 e2e 钉。
   */
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    const details = detailsRef.current;
    const summary = summaryRef.current;
    if (details === null || summary === null) return;
    const sync = (): void => {
      // toggle 触发时列表可能还没排完（新行插入、分组移动）——
      // 等一帧再量，量到的是稳定后的锚点。
      requestAnimationFrame(() => {
        if (!details.open) {
          setAnchor(null);
          return;
        }
        const rect = summary.getBoundingClientRect();
        setAnchor({
          top: panelTopFor(rect, window.innerHeight),
          right: window.innerWidth - rect.right,
        });
      });
    };
    details.addEventListener('toggle', sync);
    return () => {
      details.removeEventListener('toggle', sync);
    };
  }, []);

  // fixed 面板不跟锚点走 —— 列表一滚就该关，而不是弹在错的地方。
  useEffect(() => {
    if (anchor === null) return;
    const close = (): void => {
      if (detailsRef.current !== null) detailsRef.current.open = false;
      setAnchor(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [anchor]);

  /*
   * 触发器上写的是**这条截止的精度**：`10月4日` 或 `10月4日 16:00`。
   * 编辑本体（`DueField`）里那一行时刻读的是同一个 `localTimeOf` ——
   * 两处各算一次就会出现"触发器说全天、面板里填着 16:00"。
   */
  const timeValue = task.dueDateLocal !== undefined
    ? undefined
    : (task.dueDate === undefined ? undefined : localTimeOf(task.dueDate));
  const valueText =
    value === undefined
      ? undefined
      : `${t('web.due.dayLabel', {
          month: Number(value.slice(5, 7)),
          day: Number(value.slice(8, 10)),
        })}${timeValue === undefined ? '' : ` ${timeValue}`}`;

  /** 编辑本体 —— 两副身体（Portal 的 fixed 卡 / details 内的在流卡）共用同一份。 */
  const panelBody = <DueField task={task} now={now} onSetDueDate={onSetDueDate} />;

  return (
    <details ref={detailsRef}>
      {/*
        无障碍名带上**是哪一条任务**（读屏在一长串列表里要能分辨）；
        `data-testid` 是稳定钩子 —— 行上有多个 `<details>`（备注/整理/…），
        结构选择器撑不住第二个并列元素（TaskOrganizer 的前车之鉴）。
      */}
      <summary
        ref={summaryRef}
        aria-label={t('web.due.summaryAria', { title: task.title })}
        data-testid="due-editor-summary"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: cssVar('space.1'),
          cursor: 'pointer',
          color: cssVar('color.foreground-muted'),
        }}
      >
        <Calendar size={TRIGGER_ICON_SIZE} aria-hidden="true" />
        {t('web.due.trigger')}
        {valueText !== undefined ? (
          <span style={{ color: cssVar('color.foreground') }}>{valueText}</span>
        ) : null}
      </summary>

      {/*
        面板的两副身体：
        - `anchor !== null`（真浏览器，toggle 事件已触发）：**Portal 到 body** 的
          fixed 卡片 —— 行容器带 transform（`r-transform-*`），transform 祖先
          会成为 fixed 的包含块，所以不逃出DOM 子树就必然被滚动容器裁掉
          （实测白边，见文件头）。
        - `anchor === null`（还没收到 `toggle` 的那一帧 / 无 JS 环境）：details 内的**在流**
          卡片，op 判据与无 JS 环境都走它；details 关闭时浏览器原生隐藏它。
      */}
      {anchor !== null ? (
        createPortal(
          <div
            className="ht-material"
            style={{
              position: 'fixed',
              top: anchor.top,
              right: anchor.right,
              zIndex: cssVar('z.popover'),
              padding: cssVar('space.3'),
              border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
              borderRadius: cssVar('radius.lg'),
              boxShadow: cssVar('shadow.lg'),
              backgroundColor: cssVar('color.surface'),
            }}
          >
            {panelBody}
          </div>,
          document.body,
        )
      ) : (
        <div
          className="ht-material"
          style={{
            zIndex: cssVar('z.popover'),
            marginBlockStart: cssVar('space.2'),
            padding: cssVar('space.3'),
            border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
            borderRadius: cssVar('radius.lg'),
            backgroundColor: cssVar('color.surface'),
          }}
        >
          {panelBody}
        </div>
      )}
    </details>
  );
}
