/**
 * 任务行上的「截止」控件
 * =======================
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
 * 2. **月历是共享 `DatePicker`**（`@heyta/ui`）：文案经 `labels` 注入，
 *    日期措辞复用 `common.date.*` / `common.weekday.*` —— 两端同一个说法。
 * 3. **一次选择 = 一条 op**：`onChange` 直接交给 `store.setDueDate`
 *    （清除传 `undefined` ⇒ 动作层写 `null`，能穿过 JSON）。
 *    本文件里**没有一行业务语义**。
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cssVar } from '@heyta/design-system';
import { dueDateToEpoch, quickDuePickDates, toLocalDate, type Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { DatePicker, WEEKDAY_MESSAGE_KEYS, formatMonthTitleText, type DatePickerQuickPick } from '@heyta/ui';
import { Calendar } from 'lucide-react';

import type { MessageKey } from '@heyta/i18n';

const TRIGGER_ICON_SIZE = 14;

/** 快捷项 key → 本端措辞。日期数学在 domain，这里只管说话。 */
const QUICK_PICK_LABEL_KEYS: Record<string, MessageKey> = {
  today: 'web.due.today',
  tomorrow: 'web.due.tomorrow',
  weekend: 'web.due.weekend',
  'next-week': 'web.due.nextWeek',
};

export function DueEditor({
  task,
  now,
  onSetDueDate,
}: {
  task: Task;
  /** 冻结的"现在"（ms）。今天从它推，不由组件自己取时钟。 */
  now: number;
  /** 传 `undefined` 表示清除截止（动作层写 `null`）。 */
  onSetDueDate: (due: number | undefined) => void;
}): React.JSX.Element {
  const { t } = useI18n();

  const today = toLocalDate(now);
  const value = task.dueDate === undefined ? undefined : toLocalDate(task.dueDate);

  /**
   * 🔴 面板**不能用 `position: absolute`**。实测（2026-10-02，探针
   * `e2e/due-editor-probe.cjs`）：任务列表的行容器是滚动容器
   * （`overflow: hidden auto`），absolute 面板被裁到只剩一条白边 ——
   * 几何在（boundingBox 正常、点击能中）、**画不出来**，与头像菜单
   * 当年被 rail 裁掉是同一族 bug。修法沿用那个先例：**fixed + 实测锚点
   * + 滚动/改窗即关**（关掉比弹在错位置诚实）。
   *
   * jsdom 不触发 `toggle` 事件 ⇒ `anchor` 保持 null ⇒ 面板回落**在流**布局
   * （组件级 op 判据照常工作）；"真浏览器里弹出位置对"由 e2e 钉。
   */
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [anchor, setAnchor] = useState<{ top?: number; bottom?: number; right: number } | null>(
    null,
  );

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
        // 面板实测高 ~474。放下面放不下、上面也放不下时，宁低不遮列表头。
        const panelHeightEstimate = 500;
        const openDown =
          rect.bottom + panelHeightEstimate < window.innerHeight || rect.top < panelHeightEstimate;
        setAnchor({
          top: openDown ? rect.bottom + 8 : undefined,
          bottom: openDown ? undefined : window.innerHeight - rect.top + 8,
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

  const quickPicks: readonly DatePickerQuickPick[] = quickDuePickDates(today).map((pick) => ({
    key: pick.key,
    label: t(QUICK_PICK_LABEL_KEYS[pick.key]!),
    date: pick.date,
  }));

  const valueText =
    value === undefined
      ? undefined
      : t('web.due.dayLabel', {
          month: Number(value.slice(5, 7)),
          day: Number(value.slice(8, 10)),
        });

  /** 选择器本体 —— 两副身体（Portal 的 fixed 卡 / details 内的在流卡）共用。 */
  const panelBody = (
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
      onChange={(date) => {
        onSetDueDate(date === undefined ? undefined : dueDateToEpoch(date));
      }}
    />
  );

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
        - `anchor === null`（jsdom 不触发 toggle / 兜底）：details 内的**在流**
          卡片，op 判据与无 JS 环境都走它；details 关闭时浏览器原生隐藏它。
      */}
      {anchor !== null ? (
        createPortal(
          <div
            className="ht-material"
            style={{
              position: 'fixed',
              top: anchor.top,
              bottom: anchor.bottom,
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
