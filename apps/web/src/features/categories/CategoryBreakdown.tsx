/**
 * 分类时长（Web 壳）
 * =====================
 *
 * 🔴 M3 第三刀之后，这个文件**只剩接线**。
 *
 * 泳道（色块 + 槽位号 + 名字 + 来源 + 总时长 + 十二格）、堆叠柱状图、空态 /
 * 区间 / 未归类 / 未设色提示，全部由 `@heyta/ui` 的 `CategoryReportView`
 * 渲染 —— 与 mobile 是**同一份实现**。这里只回答 web 自己的两个问题：
 *
 *   1. 报告从哪来 → `selectCategoryReport`（归因链、窗口、软删除、缺省
 *      `actualMs` 全在 `@heyta/domain` 的 `computeCategoryReport` 里）；
 *   2. 页面周边挂什么 → 区块标题（页面大标题在顶栏上）与文案注入。
 *
 * ## 为什么这一块仍然守着三条约束（现在由共享层落实）
 *
 * 1. 🔴 **不做排行、不做评价。** 行序按总时长降序 —— 那是**读数**顺序，
 *    不是"第一名"。界面上没有"最多/最少/最差/失衡"，颜色只是**身份**。
 * 2. 🔴 **不许只用颜色表达信息。** 每一行都有槽位号、名字、来源、总时长；
 *    格子是装饰。
 * 3. 🔴 **口径只有一份。** 这里不再算任何"这周多少分钟" —— 算第二次就迟早
 *    会和周复盘对不上账，而两个数字在同一屏时用户没法知道该信哪个。
 *
 * ⚠️ `CategoryReportView` 会 import `react-native`（web 上由 Vite 别名到
 * `react-native-web`），所以它必须挂在 `<HeytaUiProvider>` 之内 ——
 * 缺了会在运行时抛错，而类型与单测都不会红（`check:ui-provider` 拦这个）。
 */

import { useI18n } from '@heyta/i18n';
import { CategoryReportView, HeytaUiProvider } from '@heyta/ui';

import { text } from '../../lib/text.js';
import { useTaskStore } from '../tasks/store.js';
import { selectCategoryReport } from '../motivation/selectors.js';
import { categoryReportLabels } from './copy.js';

export function CategoryBreakdown() {
  const { t } = useI18n();
  const entities = useTaskStore((s) => s.entities);
  const now = useTaskStore((s) => s.now);

  const report = selectCategoryReport(entities, now);
  // 只建一次，两处用：`labels.duration` 同时是格子提示的格式化函数。
  const labels = categoryReportLabels(t);

  return (
    <section className="ht-categories">
      {/* ⚠️ section-title 而不是 screen-title —— 与成长视图其余几块一致，
          页面大标题在顶栏上。 */}
      <h2 style={text('section-title')}>{t('web.categories.title')}</h2>
      <HeytaUiProvider>
        <CategoryReportView
          report={report}
          labels={labels}
          showWeeklyBars
          /**
           * 格子 / 柱段的确切时长（深浅只能看个大概，精确值在这里）。
           *
           * 🔴 **只有 web 给这一项** —— mobile 没有鼠标。共享层把它写进
           * `data-cell-title`，提示泡本身由 `app.css` 的 `[data-cell-title]`
           * 规则渲染（`content: attr(data-cell-title)`）：提示是**外观**，
           * 归宿主外壳（L3）；共享层只负责把确切数字放进 DOM。
           * 完整来龙去脉（含"第一版为什么把它丢了"）见 `CategoryReport.tsx` 文件头。
           */
          cellTooltip={labels.duration}
          testID="category-report"
        />
      </HeytaUiProvider>
    </section>
  );
}
