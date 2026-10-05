/**
 * 移动端月历的接线与"不许有第二份判断"（工单 H4，源码层）
 * ======================================================
 *
 * 本壳没有 RN 组件测试栈（理由见 [`habit-create-entry.spec.ts`](./habit-create-entry.spec.ts)
 * 文件头），所以"接线在不在、有没有长出第二份事实源"只能读源码文本。
 * 行为判据在别处：窗口裁决在 `packages/domain/tests/habit-backfill.spec.ts`（B1–B9），
 * 渲染在 `packages/ui/tests/habit-month-model.spec.ts` 与 `apps/web/tests/habit-month-board.spec.tsx`。
 *
 * 🔴 这一族真正要防的三格：
 *   1. **宿主自己判"这天能不能补"**（X4）：症状是手机允许补 3 天而 web 只允许 1 天，
 *      两边都不报错，而它是同一条产品规则；
 *   2. **列头/月份名再抄一份**（X3）：与 `HABIT_GLYPHS` 同一条理由；
 *   3. **给触屏设备注入悬停提示**（X7）：那等于承诺一个不存在的交互
 *      （`HabitBoard` 的 `cellTooltip` 同一条约定 —— 移动端不传）。
 */

import { describe, expect, it } from 'vitest';

import { mobileSources, read, stripComments } from './source-reading';

const SCREEN = 'apps/mobile/src/screens/HabitsScreen.tsx';
const DISPLAY = 'apps/mobile/src/lib/habits-display.ts';

describe('移动端月历的接线（源码层）', () => {
  const screen = stripComments(read(SCREEN));
  const display = stripComments(read(DISPLAY));

  it('X1 详情区挂了共享月历，且没有做成可选插槽', () => {
    // 工单 H7 之后挂的是**容器**（月历与年卡共用一枚游标，各挂一块板就是各持一枚）。
    expect(screen, '没挂 HabitTrendBoard').toMatch(/<HabitTrendBoard\b/);
    // §7 第 195 条那个形状：可选插槽会把"宿主没接"伪装成"做完了"。
    expect(screen, '把月历做成了可选插槽').not.toMatch(/renderMonthBoard/);
    expect(screen, '没接宿主的 labels').toMatch(/labels=\{trendLabels\}/);
    expect(screen, 'labels 不是来自 habits-display').toMatch(
      /const trendLabels = useMemo\(\n?\s*\(\) => \(\{ tabs: habitTrendTabs\(t\), month: monthLabels/,
    );
  });

  it('X2 🔴 打卡与撤销都带**那一天**（漏掉参数会记到今天，而界面看起来成功了）', () => {
    expect(screen, '打卡没带日期').toMatch(
      /actions\.checkIn\(habitId,\s*date\)(,\s*value)?/,
    );
    expect(screen, '撤销没带日期').toMatch(/actions\.undoCheckIn\(habitId,\s*date\)/);
    // 阳性对照：屏里确实存在**不带日期**的那条正常打卡（主按钮），两者不是同一处。
    expect(screen).toMatch(/runFor\(habitId, actions\.checkIn\(habitId, date\)\)/);
  });

  it('X3 列头与月份名来自共享层，移动端没再抄一份', () => {
    expect(display, '没引用共享层那份星期表').toMatch(
      /import\s*\{[^}]*\bWEEKDAY_MESSAGE_KEYS\b[^}]*\}\s*from\s*'@heyta\/ui'/,
    );
    expect(display, '月份标题没走共享的格式化').toMatch(/formatMonthTitleText\(date, t\)/);
    expect(display, '格子日期没走共享的格式化').toMatch(/formatDayTitleText\(date, t\)/);
    // 反向：不许在本文件里出现自己拼的月份/星期名。
    expect(display, '自己拼了「N月」').not.toMatch(/['"`]\$\{?\w*\}?月['"`]/);
    // 阳性对照：共享层那两份确实在（否则上面会因为"根本没这东西"而假绿）。
    const dateText = stripComments(read('packages/ui/src/calendar/date-text.ts'));
    expect(dateText, '共享层的星期表不见了').toMatch(/export const WEEKDAY_MESSAGE_KEYS/);
    expect(dateText, '共享层的月份标题不见了').toMatch(/export function formatMonthTitleText/);
  });

  it('X4 🔴 宿主里不许出现第二份"这天能不能补"的判断', () => {
    /* 三个具体的坏形状，逐个点名（不是"看着不像在判断"）：
       · 自己算日期差（`diffDays` / `isoWeekday`）来判窗口，
       · 自己写 `backfillDays` 的读取，
       · 自己判"是不是今天"（`toLocalDate(now)` 与 `-1` 天比较）。
       窗口唯一裁决者是 `@heyta/domain#habitDayState`（`packages/domain/tests/habit-backfill.spec.ts`
       的 B8 钉的是全仓命中数，这一条钉的是移动端这一侧）。 */
    const monthSides = [screen, display];
    for (const src of monthSides) {
      expect(src, '宿主里自己数天数').not.toMatch(/diffDays\(/);
      expect(src, '宿主里自己读 backfillDays').not.toMatch(/backfillDays/);
      expect(src, '宿主里自己判窗口边界').not.toMatch(/REPAIR_WINDOW_DAYS/);
    }
    // 六档 key 表必须**正好六项**：多一项就是有人往词表里加了第七档，
    // 而 `HabitDayState` 是封闭词表（少一项会被 `satisfies Record<…>` 编译期拦掉）。
    /* ⚠️ 抽的是**词条名后缀**而不是对象键：`logged:` 不带引号而 `'not-scheduled':` 带，
       第一版按"带引号的档位名"去匹配，于是六项只数到两项 —— 判据在干净代码上红
       与永不通过一样有害（这一族在本仓已经犯过第三次：J5、M4、这次）。 */
    const block = display.match(/const MONTH_STATE_KEYS = \{[\s\S]*?\};/);
    expect(block, '六档 key 表不见了').not.toBeNull();
    const entries = [
      ...block![0].matchAll(/web\.habits\.month\.(logged|today|backfillable|notScheduled|future|tooOld)/g),
    ];
    expect([...new Set(entries.map((m) => m[1]))].sort()).toEqual([
      'backfillable',
      'future',
      'logged',
      'notScheduled',
      'today',
      'tooOld',
    ]);
  });

  it('X5 文案全走词条（界面里不许硬编码中文）', () => {
    expect(screen, 'JSX 里有硬编码中文').not.toMatch(/>\s*[\u4e00-\u9fa5]{2,}\s*</);
    for (const key of [
      'web.habits.month.grid',
      'web.habits.month.window',
      'web.habits.month.logged',
      'web.habits.month.today',
      'web.habits.month.backfillable',
      'web.habits.month.notScheduled',
      'web.habits.month.future',
      'web.habits.month.tooOld',
      'web.habits.month.outOfMonth',
    ]) {
      expect(display, `移动端没消费 ${key}`).toContain(`'${key}'`);
      expect(read('packages/i18n/src/locales/zh-CN.ts'), `zh 少了 ${key}`).toContain(`'${key}'`);
      expect(read('packages/i18n/src/locales/en.ts'), `en 少了 ${key}`).toContain(`'${key}'`);
    }
  });

  it('X6 🔴 全壳的挂载点恰好一枚，而**没有人绕过容器**直接挂月历', () => {
    const hits = mobileSources()
      .filter((rel) => stripComments(read(rel)).includes('<HabitTrendBoard'))
      .sort();
    expect(hits, `容器挂载点不是恰好一处：${hits.join(' , ')}`).toEqual([SCREEN]);
    /* 🔴 反向那半才是这一条的牙：`HabitMonthBoard` 在 H7 之后是**受控**的
       （`month` 必填），谁直接挂它谁就得自己存一枚游标 —— 而那枚游标与容器那枚
       不需要任何错误就会漂成"年卡停在 2025、月历还在 2026"（§7 第 195 条同一族：
       多出来的那份不是重复，是第二个事实源）。 */
    const bypass = mobileSources().filter((rel) => stripComments(read(rel)).includes('<HabitMonthBoard'));
    expect(bypass, `有人绕过容器直接挂月历：${bypass.join(' , ')}`).toEqual([]);
  });

  it('X7 触屏不注入悬停提示（不传就是不承诺一个不存在的交互）', () => {
    expect(display, '移动端注入了 cellTitle').not.toMatch(/cellTitle\s*:/);
    // 阳性对照：web 那份**确实**注入了（否则"没有"会因为两边都漏了而假绿）。
    const web = stripComments(read('apps/web/src/features/habits/board-labels.ts'));
    expect(web, 'web 那份没有悬停提示').toMatch(/cellTitle\s*:/);
    expect(web, 'web 的悬停提示没用同一句读数').toMatch(/cellTitle\s*:\s*\(\{\s*text\s*\}\)\s*=>\s*text/);
  });
});
