/**
 * 分类时长（成长视图里的一块）
 * ==============================
 *
 * 用户问的是"我这段时间到底把力气花在哪些事上了"。这一块用一个**泳道图**
 * 回答它：一行一个来源（清单 / 习惯），一行十二格（十二周），格子深 =
 * 那一周这一类做得多。
 *
 * ## 三条必须活着的约束
 *
 * 1. 🔴 **不做排行、不做评价。** 行序按总时长降序 —— 那是**读数**顺序，
 *    不是"第一名"。界面上没有"最多/最少/最差/失衡"任何一句话，
 *    没有奖牌、没有百分号占比、没有把某一行标红。用户在别处（清单编辑界面）
 *    给颜色赋值，颜色只是**身份**，App 永远不知道红色代表什么。
 *
 * 2. 🔴 **不许只用颜色表达信息。** 每一行都有：位置（第几行）、
 *    名字、来源（清单/习惯）、总时长（数字），格子本身是装饰。
 *    8 个色槽在色觉障碍下可能只是深浅不同的灰（见下方"为什么不用颜色区分行"）。
 *
 * 3. 🔴 **口径只有一份。** 归因链、窗口、软删除、缺省 `actualMs` 全部在
 *    `@heyta/domain` 的 `computeCategoryReport` 里；这里的 selector 只摊平状态。
 *    如果这里再算一次"这周多少分钟"，它迟早会和周复盘对不上账 ——
 *    而两个数字在同一个屏幕上时，用户没法知道该信哪个。
 *
 * ## 为什么泳道图用强度色阶、不用分类色
 *
 * 分类色只有 8 个，而"强度"有 5 档；两者相乘就是 40 个颜色，
 * 那既过不了对比度也过不了色盲可分度（见
 * `packages/design-system/tests/category-colors.spec.ts`）。
 * 所以分工是：**分类色只出现在行首的色块和堆叠条里**（编码"是谁"），
 * **格子用共用的强度色阶**（`color.heat-*`，编码"多少"）——
 * 后者是单色阶，深浅即数值，不依赖色相。
 *
 * ## 为什么没有"占比 %"
 *
 * 占比看起来无害，但它把每一行都变成一个比分：用户会开始优化数字分配，
 * 而不是去做事。这一块只回答"做了多久"，不回答"你分配得对不对"。
 */

import { useI18n } from '@heyta/i18n';
import { cssVar } from '@heyta/design-system';
import { DEFAULT_CATEGORY_WEEKS, intensityLevel, type CategoryReport } from '@heyta/domain';

import { text } from '../../lib/text.js';
import { categorySlotColor, unsetSlotColor } from '../../lib/category-colors.js';
import { useTaskStore } from '../tasks/store.js';
import { selectCategoryReport } from '../motivation/selectors.js';
import { KIND_COPY, formatDuration, laneDescription, segmentLabel } from './copy.js';

/** 强度色阶：0 档是"这周没记录"，用中性的 heat-0（不是"没有颜色"）。 */
const HEAT_VARS = [
  'color.heat-0',
  'color.heat-1',
  'color.heat-2',
  'color.heat-3',
  'color.heat-4',
] as const;

export function CategoryBreakdown() {
  const { t } = useI18n();
  const entities = useTaskStore((s) => s.entities);
  const now = useTaskStore((s) => s.now);

  const report = selectCategoryReport(entities, now);

  return (
    <section className="ht-categories">
      {/* ⚠️ section-title 而不是 screen-title —— 与成长视图其余几块一致，
          页面大标题在顶栏上。 */}
      <h2 style={text('section-title')}>{t('web.categories.title')}</h2>
      <p className="ht-categories__note" style={text('caption')}>
        {t('web.categories.note')}
      </p>

      {report.series.length === 0 && report.unassignedMs === 0 ? (
        <p className="ht-categories__empty" style={text('row-meta')}>
          {t('web.categories.empty')}
        </p>
      ) : (
        <>
          <p className="ht-categories__range" style={text('caption')}>
            {t('web.categories.range', {
              start: report.weeks[0]?.start ?? '',
              end: report.weeks.at(-1)?.end ?? '',
            })}
          </p>

          <Swimlanes report={report} />

          {report.peakWeeklyMs > 0 && <WeeklyBars report={report} />}

          {/* 没归到任何类别的时间**如实说出来**。它的正确归宿是
              "给这条清单起个名 / 用清单组织任务"，而不是消失在总数里。 */}
          {report.unassignedMs > 0 && (
            <p className="ht-categories__unassigned" style={text('caption')}>
              {t('web.categories.unassigned', {
                duration: formatDuration(report.unassignedMs, t),
              })}
            </p>
          )}

          {/* 有行但一行都没设色：这是**可发现的入口**，不是错误。
              ⚠️ 不许写成"你还没给清单分色"式的追责语气。 */}
          {report.series.some((row) => row.slot === undefined) && (
            <p className="ht-categories__hint" style={text('caption')}>
              {t('web.categories.hint.unset')}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** 一行一个来源，一行十二格。 */
function Swimlanes({ report }: { report: CategoryReport }) {
  const { t } = useI18n();

  return (
    <div className="ht-categories__lanes">
      {report.series.map((row) => {
        const color = row.slot === undefined ? unsetSlotColor() : categorySlotColor(row.slot);
        return (
          // ⚠️ `role="group"` + aria-label 是**文字事实**，格子本身是装饰 ——
          // 屏幕阅读器只念一次"深度工作（清单），共 5 小时 20 分"，
          // 而不是念十二个格子。
          <div className="ht-categories__lane" key={row.key} role="group" aria-label={laneDescription(row, t)}>
            <div className="ht-categories__lane-head">
              <span
                className="ht-categories__swatch"
                style={{ background: color }}
                aria-hidden="true"
              />
              {/* 槽位号是**文字**，不是颜色 —— 色觉障碍用户靠它把这一行
                  和堆叠条里的那一段对上。 */}
              <span className="ht-categories__slot" style={text('caption')}>
                {row.slot === undefined ? t('web.categories.slot.none') : String(row.slot)}
              </span>
              <span className="ht-categories__name">{row.name}</span>
              <span className="ht-categories__kind" style={text('caption')}>
                {t(KIND_COPY[row.kind])}
              </span>
              <span className="ht-categories__total" style={text('numeric-body')}>
                {formatDuration(row.totalMs, t)}
              </span>
            </div>
            <div className="ht-categories__cells" aria-hidden="true">
              {row.weeklyMs.map((ms, index) => {
                // 强度分档是**跨行共享**的（同一个 peak）—— 两行同样深浅就代表
                // 同样多，这正是"行与行可以比一比节奏"的前提。
                const level = intensityLevel(ms, report.peakWeeklyMs);
                return (
                  <span
                    className="ht-categories__cell"
                    key={report.weeks[index]?.start ?? String(index)}
                    data-level={level}
                    style={{ background: cssVar(HEAT_VARS[level]) }}
                    // 鼠标悬停给出这一格的确切数字 —— 深浅只能看个大概。
                    title={ms === 0 ? t('web.categories.cell.none') : formatDuration(ms, t)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 一周一根柱，按类别堆叠（辅形状）。
 *
 * 它比泳道图**快**（一眼看出"最近几周整体在动"），但看不出趋势的细节 ——
 * 所以它是辅，泳道图是主。柱子高度按**窗口内最高的一周**归一，
 * 与格子的强度分档共用同一个峰值，两处不会出现两种"最深"。
 */
function WeeklyBars({ report }: { report: CategoryReport }) {
  const { t } = useI18n();

  return (
    // `role="img"` + 一个总说明：柱状图对屏幕阅读器是**一张图**，不是一堆节点。
    // 每一段的确切数字由上面的泳道图负责（那里是文字）。
    <div className="ht-categories__bars" role="img" aria-label={t('web.categories.bars.aria')}>
      {report.weeks.map((week, index) => {
        const segments = report.series
          .map((row) => ({
            key: row.key,
            ms: row.weeklyMs[index] ?? 0,
            color: row.slot === undefined ? unsetSlotColor() : categorySlotColor(row.slot),
            label: segmentLabel(row, t),
          }))
          .filter((segment) => segment.ms > 0);

        return (
          <div className="ht-categories__bar" key={week.start} title={`${week.start} · ${formatDuration(week.totalMs, t)}`}>
            <div className="ht-categories__bar-track">
              {/* 从下往上堆：最长的类别在**底部**，于是所有柱子的基线
                  是可比的（从顶部堆会让同一类别在不同柱子里落在不同高度）。 */}
              {segments
                .slice()
                .reverse()
                .map((segment) => (
                  <span
                    className="ht-categories__bar-segment"
                    key={segment.key}
                    title={segment.label}
                    style={{
                      background: segment.color,
                      // 高度是**这一段的占比**，不是绝对值 —— 柱子总高由 track 决定
                      height: `${String((segment.ms / report.peakWeeklyMs) * 100)}%`,
                    }}
                  />
                ))}
            </div>
            <span className="ht-categories__bar-label" style={text('caption')}>
              {week.start.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 窗口周数（导出给测试用：用例不该写死 12，那是配置不是契约）。 */
export const CATEGORY_WINDOW_WEEKS = DEFAULT_CATEGORY_WEEKS;
