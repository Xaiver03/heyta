/**
 * 习惯视图：打卡 / 撤销 / 连续天数 / 热力图
 * ============================================
 *
 * 热力图用 `react-activity-calendar`（MIT，2026-09 仍在更新），
 * **不自研** —— 自研要处理日期网格、周起始、跨年、tooltip 定位，
 * 这些都是已解决的问题。
 *
 * ⚠️ 组件库的主题通过 props 传入值，不走 CSS 变量，
 * 所以这里**从设计 token 取值再传进去** —— 保持"值只在 tokens.css 定义"。
 */

import { useState } from 'react';
import { ActivityCalendar } from 'react-activity-calendar';
import { cssVar } from '@heyta/design-system';
import { useI18n, type I18nValue } from '@heyta/i18n';
import { parseCategorySlot } from '@heyta/domain';
import { Check, Flame, Plus, Undo2 } from 'lucide-react';

import { ColorSlotPicker } from '../categories/ColorSlotPicker.js';
import { selectHabitProgress, selectHeatmap, useHabitStore } from './store.js';
import { text } from '../../lib/text.js';
import { activityLabels, heatmapTheme } from '../../lib/heatmap-theme.js';

const NOW_STATE_KEY = 'now';

/**
 * 三个指标各自的一句话。
 *
 * 🔴 词条表没有 ICU：连续 1 天时英文必须走单数兄弟词条
 * （"Streak 1 days" 是一眼可见的坏句子）。三个数字各自分支，
 * 因为它们完全可能一个是 1、另一个不是。
 *
 * 放在组件外、显式收 `t`：这样它既在 JSX 之外拼好句子
 * （门禁只认"字面量紧跟 `t(`"的形状），又不依赖 hook。
 */
function currentStreakText(count: number, t: I18nValue['t']): string {
  return count === 1
    ? t('web.habits.streak.currentOne', { count })
    : t('web.habits.streak.current', { count });
}

function longestStreakText(count: number, t: I18nValue['t']): string {
  return count === 1
    ? t('web.habits.streak.longestOne', { count })
    : t('web.habits.streak.longest', { count });
}

function totalCheckInText(count: number, t: I18nValue['t']): string {
  return count === 1
    ? t('web.habits.streak.totalOne', { count })
    : t('web.habits.streak.total', { count });
}

/** 打卡按钮的无障碍名："撤销今日打卡" / "为它打卡" 是两句话，各自成词条。 */
function checkInLabel(name: string, doneToday: boolean, t: I18nValue['t']): string {
  return doneToday
    ? t('web.habits.a11y.undo', { name })
    : t('web.habits.a11y.checkIn', { name });
}

export function HabitsView() {
  const { t } = useI18n();
  const store = useHabitStore();
  const [draft, setDraft] = useState('');
  // 固定"现在"，避免同一次渲染里跨午夜导致不一致
  const now = Number(sessionStorage.getItem(NOW_STATE_KEY) ?? Date.now());

  const progress = selectHabitProgress(store, now);

  async function add(): Promise<void> {
    await store.addHabit(draft);
    setDraft('');
  }

  return (
    <div style={{ padding: cssVar('space.4') }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        style={{
          display: 'flex',
          gap: cssVar('space.2'),
          marginBottom: cssVar('space.4'),
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('web.habits.addPlaceholder')}
          aria-label={t('web.habits.addLabel')}
          style={{
            flex: 1,
            minHeight: cssVar('touch-target.min'),
            padding: `${cssVar('space.2')} ${cssVar('space.3')}`,
            borderRadius: cssVar('radius.md'),
            border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
            background: cssVar('color.background'),
            color: cssVar('color.foreground'),
            // 输入框字号必须 ≥16px，否则 iOS Safari 聚焦时会自动放大页面
            fontSize: cssVar('font-size.base'),
            fontFamily: cssVar('font.sans'),
          }}
        />
        <button
          type="submit"
          aria-label={t('web.habits.add')}
          style={{
            minWidth: cssVar('touch-target.min'),
            minHeight: cssVar('touch-target.min'),
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
            borderRadius: cssVar('radius.md'),
            border: 'none',
            background: cssVar('color.primary'),
            color: cssVar('color.on-primary'),
          }}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </form>

      {progress.length === 0 && (
        <p style={{ color: cssVar('color.foreground-muted'), fontSize: cssVar('font-size.sm') }}>
          {t('web.habits.empty')}
        </p>
      )}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {progress.map((p) => {
          // 解构一次，免得下面全是 `p.resilience.resilience.xxx` 那种噪音。
          const r = p.resilience.resilience;
          const { repair, freshStart } = p.resilience;

          return (
          <li
            key={p.habit.id}
            style={{
              marginBottom: cssVar('space.3'),
              padding: cssVar('space.3'),
              borderRadius: cssVar('radius.lg'),
              background: cssVar('color.surface'),
              border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: cssVar('space.3'),
                marginBottom: cssVar('space.3'),
              }}
            >
              <div style={{ flex: 1 }}>
                <div className="ht-habit__title">
                  <span className="ht-habit__name" style={text('row-title')}>
                    {p.habit.name}
                  </span>
                  {/* 分类色槽位。它决定这个习惯在「成长 → 分类时长」里那一行
                      的颜色；没设也能显示，只是没有颜色。 */}
                  <ColorSlotPicker
                    value={parseCategorySlot(p.habit.color)}
                    onChange={(slot) => void store.setHabitColor(p.habit.id, slot)}
                    targetName={p.habit.name}
                  />
                </div>
                {/**
                 * 三指标**并存**（计划 §4）：当前连续 / 历史最长 / 累计。
                 *
                 * 🔴 其中「累计」是唯一只增不减、且不被任何中断影响的数字 ——
                 * 它是断链那天用户最需要看见的东西，所以它必须**常驻**，
                 * 不能只在"断链之后"才出现：那样它就成了一句安慰，而不是一个事实。
                 *
                 * ⚠️ 前两个走的是**韧性口径**（`r`：冻结算数），不是日历口径的
                 * `p.streak`。两个"连续"数字**永远不能相减**（ADR-0022）——
                 * 界面上只出现一个，出现的是那个能解释"中断过却还连着"的。
                 */}
                <div
                  className="ht-habit__metrics"
                  // 🔴 数字现在在**句子里**（英文语序要求如此），
                  // 所以等宽数字给在整行上，而不是给某一个 span。
                  style={{ ...text('caption'), fontVariantNumeric: 'tabular-nums' }}
                >
                  <span className="ht-habit__metric ht-habit__metric--current">
                    <Flame size={12} aria-hidden="true" />
                    {currentStreakText(r.current, t)}
                  </span>
                  <span className="ht-habit__metric">{longestStreakText(r.longest, t)}</span>
                  <span className="ht-habit__metric">{totalCheckInText(r.total, t)}</span>
                </div>

                {/**
                 * 冻结**必须明说**。
                 *
                 * 🔴 悄悄替用户吸收一次中断，等于偷走了他对规则的理解：
                 * 他会以为自己从没断过，而这恰好是下一次中断时"我明明一直连着"
                 * 那种困惑与不信任的来源。所以这里写的不是"你还剩几个道具"，
                 * 而是**它刚刚替你保住了什么**。
                 *
                 * 🔴 这一版才**真的**把余额删掉了。上一版这句话写在注释里，
                 * 而紧跟着的代码渲染的正是「还剩 N 个冻结」—— **注释是对的，代码没照做**。
                 * 删它的理由不是审美：
                 *   1. 它是**库存**。它等于在告诉用户"你还有 2 次可以不来的机会"，
                 *      而冻结是给**意外**的宽容，不是**计划内**的额度 —— 这个数字
                 *      把后者摆到了台面上，等于鼓励按额度缺勤。
                 *   2. 它**不可操作**。用户不能主动花掉它、不能多挣、不能选时机。
                 *      一个做什么都用不上的数字就是纯噪声（Apple 的"克制"指的是这个）。
                 *   3. 它把冻结变成了**货币**，而整套体系里没有第二种货币。
                 *      这是唯一一处会让 heyta 读起来像资源管理游戏的地方 —— 调性不统一。
                 *   4. 少了它，"余额"就彻底是**实现细节**：界面上不出现的东西不需要
                 *      稳定的持久化结构。**产品决策把"要不要给它加字段"这个问题消解掉了**
                 *      （完整决策记录见 `docs/adr/0022-resilience-state-stays-derived.md`）。
                 *
                 * 规则本身仍然要可解释，但解释的位置是**首次真正用到的那一刻**——
                 * 也就是下面这一行本身，而不是一个常驻的计数器。
                 */}
                {r.frozenInCurrentRun > 0 && (
                  <p
                    className="ht-habit__freeze"
                    style={{ ...text('caption'), fontVariantNumeric: 'tabular-nums' }}
                  >
                    {t('web.habits.freeze', { count: r.frozenInCurrentRun })}
                  </p>
                )}
              </div>

              <button
                type="button"
                className="ht-habit__checkin"
                onClick={() => {
                  if (p.doneToday) {
                    void store.undoCheckIn(p.habit.id);
                  } else {
                    void store.checkIn(p.habit.id);
                  }
                }}
                aria-label={checkInLabel(p.habit.name, p.doneToday, t)}
                aria-pressed={p.doneToday}
                style={{
                  minWidth: cssVar('touch-target.min'),
                  minHeight: cssVar('touch-target.min'),
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: cssVar('space.1'),
                  padding: `0 ${cssVar('space.3')}`,
                  cursor: 'pointer',
                  borderRadius: cssVar('radius.md'),
                  // 已打卡用主色实心，未打卡用边框 —— 状态差异清晰且不靠颜色单独承载
                  border: `${cssVar('border-width.thin')} solid ${
                    p.doneToday ? cssVar('color.primary') : cssVar('color.border')
                  }`,
                  background: p.doneToday ? cssVar('color.primary') : 'transparent',
                  color: p.doneToday ? cssVar('color.on-primary') : cssVar('color.foreground'),
                  fontSize: cssVar('font-size.2xs'),
                  // 按下反馈：缩放本身由 `.ht-habit__checkin:active` 给（行内写不出伪类），
                  // 这里只把 transform 加进过渡，否则缩放是瞬时跳变。
                  transition: `background ${cssVar('duration.fast')} ${cssVar('ease.standard')}, transform ${cssVar('duration.press')} ${cssVar('ease.standard')}`,
                }}
              >
                {p.doneToday ? (
                  <>
                    <Check size={16} aria-hidden="true" />
                    {t('web.habits.checkedIn')}
                  </>
                ) : (
                  <>
                    {/**
                     * 🔴 这里是 `Plus`，不是 `Undo2`。
                     *
                     * 原来用的是 `Undo2`（一个回退箭头）—— 那是"撤销"的意思，
                     * 却挂在"去打卡"这个按钮上，语义正好反了。
                     * 改成 `Plus`（"加上一次"）之后，两个状态的差别也不只靠颜色：
                     * 「✓ 已打卡」相对「＋ 打卡」，字形本身就不同。
                     */}
                    <Plus size={16} aria-hidden="true" />
                    {t('web.habits.checkIn')}
                  </>
                )}
              </button>
            </div>

            {/**
             * 续接（计划 §4 的"绝不错过两次"）。
             *
             * 🔴 **先给数字，再给按钮。** 反过来的话，这个卡片读起来是
             * "你该做点什么"；而先说"补上就是连续 21 天"，它给的是
             * "补上之后你会得到什么" —— 同一件事，一个是指令，一个是承诺。
             *
             * 🔴 只在 `streakIfRepaired ≥ 2` 时才出现（判据在领域层）。
             * 补一次只换来"连续 1 天"的时候，这个提示帮不到任何人，
             * 只会让人为了一根刚长出来的 1 反复回来 ———— 那是焦虑，不是动力。
             */}
            {repair !== undefined && (
              <div className="ht-habit__action">
                <p
                  className="ht-habit__action-text"
                  style={{ ...text('caption'), fontVariantNumeric: 'tabular-nums' }}
                >
                  {t('web.habits.repair', {
                    date: repair.date,
                    count: repair.streakIfRepaired,
                  })}
                </p>
                <button
                  type="button"
                  className="ht-btn ht-btn--ghost ht-habit__action-btn"
                  onClick={() => void store.checkIn(p.habit.id, repair.date)}
                  aria-label={t('web.habits.a11y.repair', {
                    date: repair.date,
                    name: p.habit.name,
                  })}
                >
                  <Undo2 size={14} aria-hidden="true" />
                  {t('web.habits.repairAction')}
                </button>
              </div>
            )}

            {/**
             * 重新开始（新鲜开始效应）。
             *
             * 🔴 这里**不能**出现"你已经落后了""重新来过吧"这类措辞。
             * 中断超过一周的人此刻最需要的不是被提醒损失，而是被明确告知
             * **过去那些天没有被清掉** —— 已经发生的事不会因为停止而消失，
             * 这是唯一一句能让"重新开始"不显得像从零开始的实话。
             */}
            {freshStart !== undefined && (
              <div className="ht-habit__action">
                <p
                  className="ht-habit__action-text"
                  style={{ ...text('caption'), fontVariantNumeric: 'tabular-nums' }}
                >
                  {t('web.habits.freshStart', {
                    days: freshStart.daysSinceLast,
                    longest: freshStart.longest,
                    total: freshStart.total,
                  })}
                </p>
                <button
                  type="button"
                  className="ht-btn ht-btn--ghost ht-habit__action-btn"
                  onClick={() => void store.checkIn(p.habit.id)}
                  aria-label={t('web.habits.a11y.freshStart', { name: p.habit.name })}
                >
                  {t('web.habits.freshStartAction')}
                </button>
              </div>
            )}

            <ActivityCalendar
              data={selectHeatmap(store, p.habit.id, now, 90)}
              blockSize={10}
              blockMargin={3}
              blockRadius={2}
              showMonthLabels
              showWeekdayLabels={false}
              // 主题色走共享实现（成长页的年度视图用同一份）——
              // 那里记着为什么**必须**是 `var(--ht-…)` 而不能是裸 token 名，
              // 以及为什么空档要用 `heat-0` 而不是 `surface-sunken`。
              theme={heatmapTheme()}
              // 文案也要覆盖 —— 库的默认值是英文（`Less / More`、`Oct`、`N activities in YYYY`）
              labels={activityLabels(t('web.habits.heatmap'), t)}
            />
          </li>
          );
        })}
      </ul>
    </div>
  );
}
