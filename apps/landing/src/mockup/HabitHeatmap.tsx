/**
 * 真实界面复现：习惯热力图
 * ==========================
 *
 * 复现对象：`apps/web/src/features/habits/HabitsView.tsx`（用 `react-activity-calendar` 画）。
 *
 * 🔴 这里**不引入那个库**，而是用纯 CSS Grid 画格子 ——
 * 落地页只需要一个静态复现，为它装一个日历库是把依赖成本花在展示品上。
 * 交互只放在每条习惯的一枚「打卡」按钮上；26×7 格子本身保持静态，避免制造
 * 几百个不可用的小触点。
 *
 * 🔴 配色规则必须复现：**深浅即数值，不靠色相区分**（`color.heat-0..4`）。
 * 用五种颜色表示五档强度对色盲用户是不可读的；单色阶的深浅才是。
 */

import { useMemo, useState } from 'react';

import { useI18n, type I18nValue } from '@heyta/i18n/provider';

import {
  MOCK_HABIT_HEAT_LEVELS,
  MOCK_HABIT_HEAT_WEEKS,
  MOCK_HABIT_KEYS,
  mockHeatCellClass,
} from './habit-shape.js';

export interface Habit {
  name: string;
  streak: string;
  /** 用来生成稳定图案的种子 —— 见 `levelFor`。 */
  seed: number;
  /** 基础完成密度，0..1。 */
  density: number;
}

/**
 * 列数从**登记处**取（原来的 `const WEEKS = 26` 是本文件自己的一份）。
 * `levelFor` 的"最近几周更密"曲线依赖它，所以两处必须同一个值 ——
 * 各写一份会让图案曲线在改窗口时悄悄变形（而图案"看起来仍然像热力图"）。
 */
const WEEKS = MOCK_HABIT_HEAT_WEEKS;

/**
 * 确定性的"假数据"。
 *
 * 🔴 **不能用 `Math.random()`**：热力图每次重渲染都会换一副图案，
 * 而 React 严格模式会渲染两遍 —— 用户会看到它在闪。
 * 而且同一张页面每次刷新都不一样，看起来像数据在乱跳。
 *
 * 用一个 sin 散列得到稳定的 0..1，再按密度的阈值映射到 0..4 档。
 * 周末刻意压低，最近几周刻意抬高 —— 让它看起来像真的习惯曲线，
 * 而不是均匀噪声。
 *
 * 导出是为了让测试能验证"确定性"这条不变量（见 `tests/determinism.spec.ts`）。
 */
export function levelFor(habit: Habit, week: number, day: number): 0 | 1 | 2 | 3 | 4 {
  const noise = Math.sin(habit.seed * 7.13 + week * 12.9898 + day * 78.233) * 43758.5453;
  const unit = noise - Math.floor(noise); // 0..1，稳定

  const weekend = day === 5 || day === 6 ? 0.55 : 1;
  const recency = 0.75 + (week / WEEKS) * 0.45; // 越近越密
  const score = unit * weekend * recency;

  // 🔴 阈值必须随密度**下降**，不能上升。
  // 这里原本写的是 `threshold = habit.density`，于是密度 0.95 的习惯几乎全落
  // 0 档、密度 0.1 的反而全落 4 档 —— 热力图整个是**反的**，
  // 而且肉眼看不出是 bug（图案本身仍然"像"热力图）。
  // 是 `tests/determinism.spec.ts` 里"密度高的习惯整体档位更高"这条抓出来的。
  //
  // 语义上密度 = 完成频率，所以密度越高、门槛越低。用 `1 − density` 当门槛，
  // 并夹一个下限，避免 density = 1 时门槛归零让所有格子都满档。
  const cutoff = Math.max(0.05, 1 - habit.density);
  if (score > cutoff * 1.6) return 4;
  if (score > cutoff * 1.2) return 3;
  if (score > cutoff * 0.8) return 2;
  if (score > cutoff * 0.4) return 1;
  return 0;
}

function Heatmap({ habit, checkedIn }: { habit: Habit; checkedIn: boolean }): React.JSX.Element {
  const weeks = Array.from({ length: WEEKS }, (_, w) => w);
  const days = Array.from({ length: 7 }, (_, d) => d);

  return (
    <div className="mk-heat">
      {weeks.map((week) =>
        days.map((day) => {
          const isToday = week === WEEKS - 1 && day === 6;
          const level = isToday && checkedIn ? 4 : levelFor(habit, week, day);
          return (
            <span
              key={`${String(week)}-${String(day)}`}
              // 类名来自登记处（0 档没有修饰类）—— 见 `habit-shape.ts`。
              className={mockHeatCellClass(level)}
            />
          );
        }),
      )}
    </div>
  );
}

export function HabitHeatmap({ interactive = false }: { interactive?: boolean }): React.JSX.Element {
  const { t } = useI18n();

  // 数据挪进组件内是文案迁移的硬要求（模块级拿不到 `t`）。取舍见 `Landing.tsx` 文件头。
  const habits = useMemo<Habit[]>(
    () => [
      {
        name: t('landing.mock.habit.earlyRise'),
        streak: t('landing.mock.habit.earlyRise.streak'),
        seed: 1,
        density: 0.82,
      },
      {
        name: t('landing.mock.habit.reading'),
        streak: t('landing.mock.habit.reading.streak'),
        seed: 2,
        density: 0.61,
      },
      {
        name: t('landing.mock.habit.running'),
        streak: t('landing.mock.habit.running.streak'),
        seed: 3,
        density: 0.38,
      },
    ],
    [t],
  );

  return (
    <div className="mk-habits">
      {habits.map((habit) => (
        <HabitCard key={habit.name} habit={habit} interactive={interactive} t={t} />
      ))}
    </div>
  );
}

function HabitCard({
  habit,
  interactive,
  t,
}: {
  habit: Habit;
  interactive: boolean;
  t: I18nValue['t'];
}): React.JSX.Element {
  const [checkedIn, setCheckedIn] = useState(false);

  return (
    <section className="mk-habit">
      <div className="mk-habit__head">
        <span className="mk-habit__name">{habit.name}</span>
        <span className="mk-habit__streak">{habit.streak}</span>
      </div>
      <Heatmap habit={habit} checkedIn={checkedIn} />
      {interactive ? (
        <button
          type="button"
          className="mk-habit__check-in"
          aria-label={t('web.habits.a11y.checkIn', { name: habit.name })}
          aria-pressed={checkedIn}
          onClick={() => setCheckedIn((current) => !current)}
        >
          {t(checkedIn ? 'web.habits.checkedIn' : 'web.habits.checkIn')}
        </button>
      ) : null}
      <div className="mk-heat__legend">
        <span>{t(MOCK_HABIT_KEYS.less)}</span>
        {/*
          🔴 图例的格数由**登记处**推导（`MOCK_HABIT_HEAT_LEVELS`），
          不是手抄 5 个 <span>：手抄的那一版漏一档/多一档都不会报错，
          图例仍然"看起来像一个图例"（与 `quadrant-shape.ts` 同一个理由）。
        */}
        {MOCK_HABIT_HEAT_LEVELS.map((level) => (
          <span key={level} className={mockHeatCellClass(level)} />
        ))}
        <span>{t(MOCK_HABIT_KEYS.more)}</span>
      </div>
    </section>
  );
}
