/**
 * 「倒数纪念日」—— 移动端的卡片面（W8 三端接线）
 * ==============================================
 *
 * 🔴 这一屏存在的唯一理由：**W2 建了 `EVENT` 实体、W5 建了共享卡片面、W10 把它接进了
 * AI 工具，而移动端一个入口都没有**。那不是"少做一个页面"，是本仓反复记过的那类失效
 * （"零件都在、线没接"，AGENTS §3.5 末尾两段 / roadmap §5.1 的 P0 与 P2 同一形状）——
 * 症状是**什么错都不报**：数据能同步、AI 能读能写，只有手机上看不见它。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一屏只回答移动端自己的三个问题（与 `HabitsScreen` 逐字同一个形状）
 *
 *   1. 数据从哪来 → `openTaskHost()` 的物化状态 +
 *      `@heyta/app-host` 的 `createEventActions`（建 / 改 / 置顶 / 归档 / 删）；
 *   2. 文案从哪来 → `lib/countdown-display.ts`（复用 `web.countdown.*`，零同义键）；
 *   3. 周边挂什么 → 无。**卡片网格、筛选、二级操作、就地编辑器、空态、错误框
 *      全部是共享 `EventBoard` 的本体**，本文件里一行业务判断都没有。
 *
 * 🔴 这里**不许**出现 `entityType: 'EVENT'` 字面量 —— `check:layering` 的
 *    `no-op-construction-in-apps` 明令禁止"外壳自己拼 op"。本屏的调用点同时让
 *    `check:reachability` 的断言 C 对 EVENT 在**第二个宿主**上变绿
 *    （此前只有 `apps/web/src/features/countdown/store.ts` 一处）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 入口走「我的」的第二层，**不加 tab**（P10 / ADR-0015 §4）
 *
 * 底部标签**保持 5 个**（任务 / 日历 / 专注 / 分类 / 我的）。倒数日读的是另一批实体
 * （EVENT），但"不急着重排标签栏"这条同样适用：真机脚本按坐标寻址标签栏
 * （108/324/540/756/972），加第 6 个 tab 会同时打爆它们。
 * 入口由 `nav/feature-entries.ts` 生成，返回走顶栏（与成长 / 习惯 / 回收站同一个形状）。
 * ⚠️ 代价是发现性：用户要「我的 → 倒数纪念日」两步才到 —— 这是有意的取舍，
 *   也是要产品负责人知道的一条，不是实现细节。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 与 web 的**刻意差异**（逐条列出，别默默加）
 *
 *   1. **不传 `columns`**（省略 = 1）：一行两格是**视口**的概念，而 RN 拿到的
 *      `useWindowDimensions` 是物理屏宽不是视口宽（web 那边为这件事专门写了注释）。
 *      共享层据此单列，与 `QuadrantBoard.twoColumns` 同一个裁决。
 *   2. **失败原因原样显示、不翻译**，且**不清草稿**：`onAdd` 的契约是
 *      `Promise<boolean>`，`true` 才清 —— 那是共享层的红线（便签那条高危不复制）。
 *   3. **归档视图与主视图共用一屏**：切视图由共享层自己的按钮发起，本文件只持有
 *      `view` / `filter` 两个**本地导航态**（不进 op-log、不落盘：手机上"正在看哪一档"
 *      换一台设备没有意义，同步过去反而是噪音）。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { AppHost, EventActions } from '@heyta/app-host';
import { createEventActions } from '@heyta/app-host';
import type { CountdownEvent } from '@heyta/domain';
import type {
  CountdownFilter,
  CountdownView as BoardView,
  EventCard,
  EventCardTexts,
  EventEditPatch,
} from '@heyta/ui';
import { categorySlotToken, EventBoard } from '@heyta/ui';
import { useI18n } from '@heyta/i18n';

import { openTaskHost } from '../db/open-host';
import { useCardExporter } from '../lib/card-export';
import { eventBoardLabels, exportFailureText } from '../lib/countdown-display';
import { datePickerLabels } from '../lib/date-picker-labels';
import { useToday } from '../lib/use-today';
import { useMobileSync } from '../sync/store';
import { useTheme } from '../theme';
import { EmptyState, Screen } from '../ui/kit';

export function CountdownScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 🔴 "今天"由 `useToday` 提供（回前台与跨零点会刷新）。
   * 倒数日的排序与"还有几天"**全部**以它为锚：冻一个 `Date.now()` 会让应用
   * 挂后台一夜之后整列卡片停在昨天，而界面上完全看不出来。
   */
  const { today } = useToday();
  /**
   * 🔴 **必须订阅 `dataRevision`**（`check:materialized-reads` 数 `.listEvents(` 这一处）。
   * 少了它：冷启动落在本屏（空的）→ 去「我的」同步 → 切回来**仍是空的**，
   * 而数据库里那些远端倒数日已经应用了（重启 App 就能看见）。
   */
  const { dataRevision } = useMobileSync();

  const [host, setHost] = useState<AppHost | null>(null);
  /** 打开宿主失败（磁盘 / 驱动）与**写入失败**（动作层抛的校验原因）共用一个通道：
   *  两者都必须让用户看见，"点了没反应"是这一屏最坏的失效。 */
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<CountdownEvent[]>([]);
  const [archivedEvents, setArchivedEvents] = useState<CountdownEvent[]>([]);
  const [view, setView] = useState<BoardView>('active');
  const [filter, setFilter] = useState<CountdownFilter>('all');

  useEffect(() => {
    let alive = true;
    // 🔴 驱动是工厂不是实例：`SqliteAdapter` 会在 close 后靠它重开（见 `db/open-host.ts`）。
    void openTaskHost()
      .then((next) => {
        if (alive) setHost(next);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  // 与 TasksScreen / HabitsScreen 同一条规则：动作集从宿主派生，不在界面里新造。
  const actions = useMemo<EventActions | null>(() => (host ? createEventActions(host) : null), [host]);

  const refresh = useCallback(() => {
    if (!actions) return;
    // ⚠️ 两个 list 都是**同步**的（读已物化状态），不是 Promise。
    // 🔴 顺序（置顶 → 距下一次 → id）**由动作层给**，本文件一次都不 `sort()`；
    //    各端各排一次的结局是同一批卡在不同设备上顺序不同，而没有任何测试会红。
    setEvents(actions.listEvents(today));
    setArchivedEvents(actions.listArchivedEvents(today));
  }, [actions, today]);

  useEffect(() => {
    if (!host) return;
    refresh();
  }, [host, refresh, dataRevision]);

  /**
   * 一次保存 = 一个 op（AGENTS §3.4）。
   *
   * 🔴 这里**不做任何翻译**：`yearly` → RRULE 的构造在 `@heyta/app-host`，
   * 让每个界面自己拼一条规则串，结局是 web 与手机各拼一种、各自都能过自己的测试。
   */
  const patchEvent = useCallback(
    (entityId: string, patch: EventEditPatch): void => {
      if (!actions) return;
      void actions
        .patchEvent(entityId, patch)
        .then(() => {
          setError(null);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(refresh);
    },
    [actions, refresh],
  );

  const runOnce = useCallback(
    (pending: Promise<unknown>): void => {
      void pending
        .then(() => {
          setError(null);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(refresh);
    },
    [refresh],
  );

  const labels = useMemo(() => eventBoardLabels(t), [t]);
  const pickerLabels = useMemo(() => datePickerLabels(t), [t]);

  /**
   * 成品图导出（W7）。
   *
   * 🔴 `useCardExporter()` 是 hook ⇒ 必须排在两个提前 return **之前**
   * （本文件上面那条"hook 数量随渲染变化"的教训同一个形状）。
   * 它要一张真的挂在视图树里的 `<Svg>` 才能栅格化，所以宿主必须把 `surface`
   * 渲染出来 —— 不渲染就等于按钮存在而点了没反应。
   */
  const theme = useTheme();
  const { exportCard, surface } = useCardExporter();
  const [exportError, setExportError] = useState<string | undefined>(undefined);

  const runExport = useCallback(
    (card: EventCard, texts: EventCardTexts): void => {
      void exportCard({
        texts,
        theme: { tokens: theme.tokens, text: theme.text },
        // 与卡片上**同一个表达式**：模板 = 分类色板的一格，没选过就是沉底色。
        // 在界面上挑颜色而不是把 slot 交出去，是为了让共享版面永远不碰色值。
        accentColor:
          card.template === undefined
            ? theme.tokens['color.surface-sunken']
            : theme.tokens[categorySlotToken(card.template)],
        // 文件名里的日期段就是屏上那一行（同一次 `cardTextsFor` 的产物），
        // 所以"图上写的日子"与"文件名里的日子"不可能不一致。
        dateStem: texts.date,
      }).then((result) => {
        if (result.ok) {
          setExportError(undefined);
          return;
        }
        // 用户自己关掉分享面板**不是失败**，界面不许说"导不出来"（那是把人自己的
        // 动作报成设备的错）。这一档与四种失败分开，否则这句话永远在误导人。
        if ('cancelled' in result) return;
        setExportError(exportFailureText(t, result.error, result.detail));
      });
    },
    [exportCard, t, theme],
  );

  /**
   * 🔴 提前 return **必须在所有 hook 之后**（AGENTS §7 记过这个真 bug：
   * 先 return 后 hook 会让两次的 hook 数量不同 → `Rendered more hooks than
   * during the previous render.`，整屏白）。
   */
  const header = {
    title: t('web.shell.views.countdown'),
    actions: [{ icon: 'action.back' as const, label: t('mobile.growth.back'), onPress: onBack }],
  };

  if (host === null) {
    return (
      <Screen {...header}>
        <EmptyState
          icon="action.sync"
          title={t('mobile.tasks.loading.title')}
          hint={t('mobile.tasks.loading.hint')}
        />
      </Screen>
    );
  }

  /**
   * 打开宿主**失败**与**还没有任何倒数日**是两件事：
   * 前者是错误屏（`ErrorNotice`，带原始错误文本），后者由共享 `EventBoard`
   * 自己渲染页面级空态（`check:empty-state` 断言 B：空态只有一个实现，
   * 本文件不许手写"还没有倒数日"）。
   */
  if (error !== null && events.length === 0 && archivedEvents.length === 0) {
    return (
      <Screen {...header}>
        <ErrorNotice message={error} />
      </Screen>
    );
  }

  return (
    <Screen {...header}>
      <EventBoard
        events={view === 'archived' ? archivedEvents : events}
        today={today}
        view={view}
        filter={filter}
        onAdd={(title, date) => {
          if (!actions) return Promise.resolve(false);
          return actions
            .createEvent(title, date)
            .then(() => {
              setError(null);
              refresh();
              // 🔴 `true` = 已落库，共享层据此**才**清草稿。
              return true;
            })
            .catch((e: unknown) => {
              setError(e instanceof Error ? e.message : String(e));
              // 失败**返回 false**：用户的字不能被吃掉（便签那条高危不复制）。
              return false;
            });
        }}
        onPatch={patchEvent}
        onTogglePinned={(entityId, pinned) => {
          if (actions) runOnce(actions.setEventPinned(entityId, pinned));
        }}
        onArchive={(entityId) => {
          if (actions) runOnce(actions.archiveEvent(entityId));
        }}
        onUnarchive={(entityId) => {
          if (actions) runOnce(actions.unarchiveEvent(entityId));
        }}
        onRemove={(entityId) => {
          if (actions) runOnce(actions.removeEvent(entityId));
        }}
        onViewChange={(next) => {
          setView(next);
          refresh();
        }}
        onFilterChange={setFilter}
        // 写失败的原因画在卡片面上方（共享层的那个红框），这里只负责传下去。
        // `error` 同时用于错误屏，所以取的是**同一个 state**：两处各存一份
        // 就会有一处滞后，而"界面说没报错、卡片上面却写着失败"是最难归因的形态。
        error={error ?? undefined}
        // 导出失败是**另一件事**：它不碰任何数据，所以不许借用 `error` 那个通道
        // （借用的后果是"卡片上方写着失败，而那次失败其实什么都没改"）。
        exportError={exportError}
        onExportCard={(_entityId, card, texts) => runExport(card, texts)}
        datePickerLabels={pickerLabels}
        labels={labels}
        testID="countdown-view"
      />
      {/* 栅格化要用的一张离屏 `<Svg>`（1×1、opacity 0、不吃触摸）。少了这一行，
          按钮照样在、点了永远没有图 —— 而那正是本仓登记过的那种"看起来成功了"。 */}
      {surface}
    </Screen>
  );
}

/**
 * 打开宿主失败的整屏提示。
 *
 * 🔴 原始错误**原样附上、不翻译**：它多半是英文的系统信息，但翻译之后就没法
 * 拿去搜索、也没法对照日志（与 `TasksScreen` / `HabitsScreen` 同一条分工）。
 */
function ErrorNotice({ message }: { message: string }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <EmptyState
      icon="group.overdue"
      title={t('mobile.tasks.loadError.title')}
      hint={t('mobile.tasks.loadError.hint')}
      detail={t('mobile.tasks.loadError.detail', { detail: message })}
    />
  );
}
