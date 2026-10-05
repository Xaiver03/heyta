/**
 * 习惯频次编辑器（工单 H5，web 端）
 * ==================================
 *
 * 与 `HabitGoalEditor.tsx` 同一个交互形状（摘要常驻 + 展开 + chip 提交），
 * 因为它们改的是同一枚实体的两个字段，用户在两者之间来回跳时不该换模型。
 *
 * 🔴 样式全部走 `habits.css` 里的类，**一条 `style={{…}}` 都没有**：
 *    `scripts/check-l4-no-style.mjs` 的棘轮现在是 98（只减不增），新组件里加内联样式
 *    会直接把 `pnpm check` 弄红 —— 而那与"这段样式该不该是内联"是两个问题，
 *    本文件按门禁的口径写（同 `.ht-habit__pane-head` 那一族：要靠类才守得住的样式）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一单补的是**写入口**，不是判定
 *
 * `isScheduledOn` → `computeStreak` **一直**按频次数"计划日"（`habit-streak.ts:131/158/227/360`，
 * 那里的注释自己写着"否则每周一次的习惯永远只有 1"）。缺的是任何能把 `frequency`
 * 写进去的路径 —— 于是那套口径对界面不可达（§7 第 195 条"字段看起来有功能"那个形状：
 * typecheck、构建、既有测试一个都不会红）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三条**不是顺手写的**规则
 *
 * 1. **合法性在动作层判**，不在这里：`normalizeHabitFrequency`（`@heyta/app-host`）
 *    才是 `everyNDays ≥ 1`、星期 1–7、空集合抛的那道闸。这里只做"让用户发不出非法值"
 *    那一半（第 2 条），两边不各判一遍。
 * 2. **七天都不选 = 退回"每天"**，不是发一个空 `daysOfWeek`：空集合在判定侧是
 *    "没有计划日"（连续天数恒 0），把它当"每天"会在用户没打算打卡的日子里判他断链；
 *    而发空集合会被动作层**抛**，界面上就是"点了没反应"。所以这一格走"清除"。
 * 3. **「每天一次」发的是清除（`undefined`），不是 `{type:'daily'}`**：
 *    两者读出来是同一句话（摘要那条已经合并了），但存两种表示就让同一个语义有
 *    两份存量（§3.3：已落盘的数据会长期存在）。
 *
 * ⚠️ 「每隔几天」必须**按了那档才提交**：跟着 keystroke 写会把输入 `10` 变成
 *    先写 `1`（被归一成"每天"）再写 `10` —— 两条 op，中间那条还是用户没要的状态。
 */

import { useState } from 'react';

import { CalendarDays, Repeat } from 'lucide-react';
import { ICON_SIZE } from '@heyta/design-system';
import { isoWeekday, type Habit, type HabitFrequency, type LocalDate } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import {
  HABIT_WEEKDAY_MESSAGE_KEYS,
  habitFrequencySummaryKey,
  type HabitFrequencySummaryKey,
} from '@heyta/ui';

import { LIST_SEPARATOR } from '../ai/locale-punctuation.js';

interface HabitFrequencyEditorProps {
  habit: Habit;
  /** `undefined` = 清除（回到"每天"）。失败会 reject，由本组件接住并显示。 */
  onSet: (frequency: HabitFrequency | undefined) => Promise<void>;
  /** 「今天」：切到「每周挑几天」时给一个默认日子，而不是发一个空集合。 */
  today: LocalDate;
}

export function HabitFrequencyEditor({
  habit,
  onSet,
  today,
}: HabitFrequencyEditorProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 草稿是**字符串**：`''` 与 `'0'` 必须能分辨（与 `HabitGoalEditor` 同一条理由）。 */
  const [draftN, setDraftN] = useState('2');

  const frequency = habit.frequency;
  const days = frequency?.type === 'weekly' ? frequency.daysOfWeek : [];
  const everyN = frequency?.type === 'interval' ? frequency.everyNDays : 2;

  const isDaily = frequency === undefined || frequency.type === 'daily';
  const isWeekly = frequency?.type === 'weekly';
  const isInterval = frequency?.type === 'interval';

  const summaryKey: HabitFrequencySummaryKey = habitFrequencySummaryKey(frequency);
  const summary =
    summaryKey === 'web.habits.freq.summary.interval' ||
    summaryKey === 'web.habits.freq.summary.intervalOne'
      ? t(summaryKey as never, { n: String(everyN) })
      : summaryKey === 'web.habits.freq.summary.weekly'
        ? t(summaryKey as never, {
            // 🔴 分隔符**不是词条**：`、` 一个汉字都没有，而词条表有两条硬规则都要求
            //    zh 词条至少含一个汉字（`check-ui-language` 规则 2 + i18n 的 catalog 测试）。
            //    本仓的正字法单源在 `features/ai/locale-punctuation.ts`，这里取它而不是
            //    再开一张表 —— 第一版我确实加了 `web.habits.freq.separator`，被门禁当场拦下，
            //    而那正是它存在的理由（同一判断的第二份所有者不会报错，只会漂移）。
            days: days.map((day) => t(HABIT_WEEKDAY_MESSAGE_KEYS[day - 1] as never)).join(LIST_SEPARATOR[locale]),
          })
        : t(summaryKey as never);

  const submit = (next: HabitFrequency | undefined): void => {
    // 🔴 自己接住 reject：`HabitDetailCard` 那个 `run()` 只 `.finally()` 没有 `.catch`，
    //    交给它就会变成一条 unhandled rejection，用户看到"点了没反应"。
    void onSet(next).catch(() => {
      setFailed(true);
    });
  };

  return (
    <span className="ht-habit__freq">
      <button
        type="button"
        className="ht-habit__freq-toggle"
        aria-expanded={open}
        aria-label={t('web.habits.freq.aria' as never, { name: habit.name })}
        data-testid={`habit-freq-toggle-${habit.id}`}
        onClick={() => {
          // 每次展开都把草稿同步回当前真值：否则上次没提交的数字会留着，
          // 用户再展开时看到的是一个"看起来已经生效"的值。
          setDraftN(String(everyN));
          setFailed(false);
          setOpen((was) => !was);
        }}
      >
        <Repeat aria-hidden="true" />
        {/* 摘要常驻可见：折叠着也要知道这条习惯多久一次 —— 这是改它的前提。 */}
        <span className="ht-habit__freq-word" data-testid={`habit-freq-summary-${habit.id}`}>
          {summary}
        </span>
      </button>

      {open ? (
        <div
          className="ht-habit__freq-panel"
          role="group"
          aria-label={t('web.habits.freq.aria' as never, { name: habit.name })}
          data-testid={`habit-freq-panel-${habit.id}`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          <div className="ht-habit__freq-tiers">
            <button
              type="button"
              className="ht-habit__freq-chip"
              aria-pressed={isDaily}
              data-testid={`habit-freq-daily-${habit.id}`}
              onClick={() => {
                // 规则 3：发**清除**，不是 `{type:'daily'}`。
                // 🔴 已经是"每天"时**一条 op 都不发**：再点一次发的是"把 null 写成 null"，
                //    状态没变而 op-log 多一条 —— 与 `checkIn` 第二次返回 false 同一条纪律。
                if (isDaily) return;
                submit(undefined);
              }}
            >
              {t('web.habits.freq.daily' as never)}
            </button>
            <button
              type="button"
              className="ht-habit__freq-chip"
              aria-pressed={isWeekly}
              data-testid={`habit-freq-weekly-${habit.id}`}
              onClick={() => {
                if (isWeekly) return;
                // 默认给"今天那一档"：空集合会被动作层抛，而"点了 chip 没反应"
                // 正是本仓库反复栽过的那一种坏。
                submit({ type: 'weekly', daysOfWeek: [isoWeekday(today)] });
              }}
            >
              {t('web.habits.freq.weekly' as never)}
            </button>
            <button
              type="button"
              className="ht-habit__freq-chip"
              aria-pressed={isInterval}
              data-testid={`habit-freq-interval-${habit.id}`}
              onClick={() => {
                const parsed = Number(draftN);
                if (draftN.trim() === '' || !Number.isInteger(parsed) || parsed < 1) {
                  setFailed(true);
                  return;
                }
                setFailed(false);
                submit({ type: 'interval', everyNDays: parsed });
              }}
            >
              {t('web.habits.freq.interval' as never)}
            </button>
          </div>

          {isWeekly ? (
            <div className="ht-habit__freq-days">
              {HABIT_WEEKDAY_MESSAGE_KEYS.map((key, index) => {
                const day = index + 1;
                const on = days.includes(day);
                return (
                  <button
                    key={key}
                    type="button"
                    className="ht-habit__freq-chip"
                    aria-pressed={on}
                    data-testid={`habit-freq-day-${day}-${habit.id}`}
                    onClick={() => {
                      const next = on ? days.filter((d) => d !== day) : [...days, day].sort();
                      // 规则 2：清空 = 退回每天，而不是发一个空集合。
                      submit(next.length === 0 ? undefined : { type: 'weekly', daysOfWeek: next });
                    }}
                  >
                    {/* zh 的 `common.weekday.*` 是裸「一」；en 那几个本身是 "Mon"。
                        两边都直接画词条，不在代码里拼「周」字头 ——
                        拼出来的字符串既过不了 `check:ui-language`，也会在英文里长出「周Mon」。 */}
                    {t(key as never)}
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* 🔴 这一行 + 那句提示**只在「每隔几天」那一档生效时才画**（工单 H5 看图照出来的）：
              第一版它们无条件渲染，于是摘要写着「每周 二」，面板里却同时摆着一个
              值为 2 的"每隔几天做一次"输入框和一句"按日历固定隔 2 天排一次"的说明 ——
              界面把一个**当前不生效**的规则连数字一起显示给用户看。
              7 条 e2e 断言当时全绿：它们验的是"该有的在不在"，没验"不该来的别来"。 */}
          {isInterval ? (
            <>
              <label className="ht-habit__freq-n">
                <CalendarDays aria-hidden="true" />
                {t('web.habits.freq.nDays' as never)}
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={draftN}
                  onChange={(event) => {
                    setDraftN(event.target.value);
                  }}
                  aria-label={t('web.habits.freq.nDays' as never)}
                  data-testid={`habit-freq-n-${habit.id}`}
                />
              </label>

              {/* 这条不是装饰：`interval` 的锚点是**固定日历格**（`isScheduledOn` 拿
                  `1970-01-01` 取模），不是"从建立习惯那天起每 N 天"。不写出来，
                  用户会以为今天选了「每 3 天」下一次必然是三天后。 */}
              <span className="ht-habit__freq-hint">
                {t('web.habits.freq.intervalHint' as never, { n: draftN.trim() === '' ? '1' : draftN })}
              </span>
            </>
          ) : null}

          {failed ? (
            <span className="ht-habit__freq-error" data-testid={`habit-freq-error-${habit.id}`}>
              {/* 🔴 报错要说**为什么**，不能把字段标签再念一遍：第一版这里写的就是
                  `web.habits.freq.nDays`（"每隔几天做一次"），于是"输入非法"与
                  "这一栏叫什么"在界面上长得一样 —— 那是把失败吞成"点了没反应"的另一种写法。 */}
              {t('web.habits.freq.invalid' as never)}
            </span>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
