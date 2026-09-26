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
import { cssVar, cssVarName } from '@heyta/design-system';
import { useI18n, type I18nValue } from '@heyta/i18n';
import { Check, Flame, Plus, Undo2 } from 'lucide-react';

import { selectHabitProgress, selectHeatmap, useHabitStore } from './store.js';

const NOW_STATE_KEY = 'now';

/**
 * 连续天数 → 一句话。
 *
 * 🔴 词条表没有 ICU：连续 1 天时英文必须走单数兄弟词条
 * （"Streak 1 days" 是一眼可见的坏句子）。两个数字各自分支，
 * 因为它们完全可能一个是 1、另一个不是。
 *
 * 放在组件外、显式收 `t`：这样它既在 JSX 之外拼好句子
 * （门禁只认"字面量紧跟 `t(`"的形状），又不依赖 hook。
 */
function streakText(current: number, longest: number, t: I18nValue['t']): string {
  const currentText = t(
    current === 1 ? 'web.habits.streak.currentOne' : 'web.habits.streak.current',
    { count: current },
  );
  const longestText = t(
    longest === 1 ? 'web.habits.streak.longestOne' : 'web.habits.streak.longest',
    { count: longest },
  );
  // 分隔符是纯标点，不属于任何一种语言。
  return `${currentText} · ${longestText}`;
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
        {progress.map((p) => (
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
                <div
                  style={{
                    fontWeight: cssVar('font-weight.semibold'),
                    color: cssVar('color.foreground'),
                    fontSize: cssVar('font-size.sm'),
                  }}
                >
                  {p.habit.name}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: cssVar('space.1'),
                    fontSize: cssVar('font-size.2xs'),
                    color: cssVar('color.foreground-muted'),
                  }}
                >
                  <Flame size={12} aria-hidden="true" />
                  {streakText(p.streak.current, p.streak.longest, t)}
                </div>
              </div>

              <button
                type="button"
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
                  transition: `background ${cssVar('duration.fast')} ${cssVar('ease.standard')}`,
                }}
              >
                {p.doneToday ? (
                  <>
                    <Check size={16} aria-hidden="true" />
                    {t('web.habits.checkedIn')}
                  </>
                ) : (
                  <>
                    <Undo2 size={16} aria-hidden="true" />
                    {t('web.habits.checkIn')}
                  </>
                )}
              </button>
            </div>

            <ActivityCalendar
              data={selectHeatmap(store, p.habit.id, now, 90)}
              blockSize={10}
              blockMargin={3}
              blockRadius={2}
              showMonthLabels
              showWeekdayLabels={false}
              // ⚠️ 库通过 props 收值，不吃 CSS 变量 ——
              // 所以在这里从 token 取值传入，保证值仍然只有一个来源
              theme={{
                // ⚠️ 必须用 token 名。我第一版在 dark 里写了裸 '#1e293b' ——
                // 那正是设计门禁要拦的东西：裸值不会随主题切换而更新，
                // 而且绕过了对比度测试。
                // 空档用 muted（亮）/ surface（暗），两者都是主题感知的语义 token。
                light: [
                  cssVarName('color.surface-sunken'),
                  cssVarName('color.primary'),
                  cssVarName('color.primary'),
                  cssVarName('color.primary'),
                  cssVarName('color.primary'),
                ],
                dark: [
                  cssVarName('color.surface'),
                  cssVarName('color.primary'),
                  cssVarName('color.primary'),
                  cssVarName('color.primary'),
                  cssVarName('color.primary'),
                ],
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
