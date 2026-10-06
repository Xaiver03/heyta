/**
 * W8a：习惯"累计"那一格的**值与词同源**。
 *
 * 生产者的事实（现量于 2026-10-03）：
 * `computeHabitResilience().total = achieved.size`（`packages/domain/src/habit-resilience.ts:197`）
 * 数的是**达成天数**，不是打卡次数 —— `HabitLog` 的 id 是 `habitId:date`
 * （`packages/app-host/src/habit-actions.ts:155-157`），一天结构上只可能有一条；
 * W6 之后还会出现"打了卡但没达标"的天（`value < target`），那类天**不进** `achieved`，
 * 于是"条数""次数""天数"三者从此互不相等。
 * ⇒ 任何把这个数印成「N 次」/「N check-ins」的句子都是**事实错误**，不是风格问题。
 *
 * 这条以前没有任何一层在守：词条写"累计 {count} 次"，值写 `achieved.size`，两边各自绿了几个版本。
 * 竞品的一手口径也站在"天"这一侧 —— Loop 的 `totalCount` =
 * `originalEntries.filter { value == YES_MANUAL }.count()`
 * （见 [`docs/research/detail-pane-alignment-and-spaced-review.md`](../../docs/research/detail-pane-alignment-and-spaced-review.md) C1b-Q2）。
 *
 * 🔴 变异臂（六条，逐臂看颜色 —— "做过变异"不等于"判据有牙"）：
 * 1. `web.habits.row.aria` 的"累计 {total} 天"改回`次` ⇒ 第 2 组红。
 * 2. `web.habits.streak.total{,One}` 两条改回`次` ⇒ 第 2 组红（专测"chip 走 `{count}` 不走 `{total}`"那个分支）。
 * 3. en `web.habits.streak.total` 改回 `'{count} check-ins'` ⇒ 第 3 组红。
 * 4. 把带 `累计 {total}` 的句子搬进一个**不在清单里**的键 ⇒ 第 4 组"漏登记"红。
 * 5. 🔴 把某条句子里的 `{total}` **改名**成别的占位符 ⇒ 第 1 组"成员形状"红。
 *    这条是第一版实测出来的洞：那时判据写的是 `if (!value.includes('{total}')) continue` ——
 *    占位符一改，那条就被**静默跳过**，实测**整套 26 条全绿**。
 *    所以现在是"每个键声明自己必须带哪种占位符，缺席即红"，而不是"带着就跑、不带就跳"。
 * 6. 负向对照：`累计 {count} 天` 换成 `打卡 {count} 天` ⇒ 必须**仍然绿**（证明它认的是语义，不是字面）。
 */
import { describe, expect, it } from 'vitest';

import { en } from '../src/locales/en.js';
import { zhCN, type MessageKey } from '../src/locales/zh-CN.js';

/** 把 `resilience.total` 印进**整句**的键，数字走 `{total}`。 */
const SENTENCE_KEYS = [
  'web.habits.row.aria',
  'web.habits.freshStart',
  'mobile.growth.streak.freshStart',
  'mobile.growth.streak.a11y',
] as const satisfies readonly MessageKey[];

/** 单独成格的三条，数字走 `{count}`。 */
const CHIP_KEYS = [
  'web.habits.streak.total',
  'web.habits.streak.totalOne',
  'mobile.growth.streak.total',
] as const satisfies readonly MessageKey[];

/** 全部生产者键 = 漏登记判据的白名单。 */
const PRODUCER_KEYS: readonly MessageKey[] = [...SENTENCE_KEYS, ...CHIP_KEYS];

/**
 * 单独成格、且周围没有任何句子交代单位的那两条 —— 它们自己必须说单位。
 *
 * 🔴 为什么不是"每条都得带单位"：`mobile.growth.streak.total` 的英文是 `Total: {count}`，
 * 而同一张卡的 `mobile.growth.streak.current` 写着 **"Current streak (days)"** ——
 * 单位在卡头声明过一次。逐条补 `days` 会把 `Longest: {days}` / `Total: {count}` 这一族
 * 带进 "1 days" 那个 `catalog.spec.ts` 拦的 HAZARD 形状（它们**没有** `…One` 兄弟键）。
 * 所以规则是：**不带单位不是谎话，带错单位才是；单独成格的那条必须带单位。**
 */
const MUST_CARRY_UNIT_EN: readonly MessageKey[] = ['web.habits.streak.total', 'web.habits.streak.totalOne'];

const QUANTITY_ZH = /次/u;
const QUANTITY_EN = /check-?ins?/iu;

/** `{total}` 之后多长的窗口算"同一个数量短语"。够包住" 天都还在"，够不着从句末尾。 */
const WINDOW = 14;

/** 取占位符后面的窗口。🔴 占位符缺席**就是失败**，不是跳过（见文件头变异臂 5）。 */
function afterToken(value: string, token: string, key: string): string {
  const at = value.indexOf(token);
  expect(
    at,
    `${key} 不再含 ${token} 占位符 —— 生产者换了形状，判据必须响，不能静默跳过这一条`,
  ).toBeGreaterThanOrEqual(0);
  return value.slice(at + token.length, at + token.length + WINDOW);
}

describe('习惯"累计"那一格的值与词同源（W8a）', () => {
  it('清单不是空的，且每一条的**形状**就是它声明的那种（阳性对照）', () => {
    // 后面三组全靠"这个键带着哪个占位符"来定位，所以先把前提本身钉死：
    // 键存在、中英都有、带它该带的占位符。清单为空或键名漂了，这里就红。
    expect(SENTENCE_KEYS).toHaveLength(4);
    expect(CHIP_KEYS).toHaveLength(3);
    for (const key of SENTENCE_KEYS) {
      expect(zhCN[key], `中文表缺 ${key}`).toBeTruthy();
      expect(en[key], `英文表缺 ${key}`).toBeTruthy();
      expect(zhCN[key], `${key} 应当带 {total}`).toContain('{total}');
      expect(en[key], `${key} 英文侧应当带 {total}`).toContain('{total}');
    }
    for (const key of CHIP_KEYS) {
      expect(zhCN[key], `中文表缺 ${key}`).toBeTruthy();
      expect(en[key], `英文表缺 ${key}`).toBeTruthy();
      expect(zhCN[key], `${key} 应当带 {count}`).toContain('{count}');
    }
  });

  it('中文：每个"累计"说的都是**天**，不是次', () => {
    // 两种形状各走各的门：只按 `{total}` 扫会把三条 chip 漏干净（变异臂 2 专测这个）。
    for (const key of CHIP_KEYS) {
      expect(zhCN[key], `${key} 说完了数字却没说是"天"`).toMatch(/天/u);
      expect(zhCN[key], `${key} 把一个天数说成了次数`).not.toMatch(QUANTITY_ZH);
    }
    for (const key of SENTENCE_KEYS) {
      const tail = afterToken(zhCN[key], '{total}', key);
      expect(tail, `${key} 说完了数字却没说是"天"`).toMatch(/天/u);
      expect(tail, `${key} 把一个天数说成了次数`).not.toMatch(QUANTITY_ZH);
    }
  });

  it('英文：说了单位的必须说 day(s)，任何一条都不许把它说成 check-in(s)', () => {
    for (const key of MUST_CARRY_UNIT_EN) {
      expect(en[key], `${key} 说了单位却没说 day`).toMatch(/days?\b/u);
      expect(en[key], `${key} 把天数说成了次数`).not.toMatch(QUANTITY_EN);
    }
    for (const key of CHIP_KEYS) {
      expect(en[key], `${key} 把天数说成了次数`).not.toMatch(QUANTITY_EN);
    }
    // 整句只看 `{total}` 后面的窗口：英文 freshStart 那句 "since your last check-in"
    // 说的是"上一次打卡"这件事，不是那个数，与 `{total}` 隔着一整个从句。
    for (const key of SENTENCE_KEYS) {
      expect(afterToken(en[key], '{total}', key), `${key} 把天数说成了次数`).not.toMatch(QUANTITY_EN);
    }
  });

  it('🔴 生产者集合没有第五处漏登记', () => {
    const registered = new Set<string>(PRODUCER_KEYS);
    const strays = Object.entries(zhCN)
      .filter(([key, value]) => !registered.has(key) && value.includes('累计') && value.includes('{total}'))
      .map(([key]) => key);
    expect(strays, '这些句子也在印同一个"达成天数"，却没进清单 ⇒ 判据会漏守').toEqual([]);
  });
});
