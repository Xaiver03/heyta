/**
 * 移动端习惯的文案接线测试
 * ==========================
 *
 * 🔴 这里防的**不是"连续算错了"**（那在 `@heyta/domain` 与
 * `@heyta/app-host#habitGrowth` 里，各有自己的测试），而是**两端漂移与假话**：
 *
 *   1. `habitBoardLabels` 是移动端与共享 `HabitBoard` 的**唯一接缝** ——
 *      少给一项、或给错了命名空间，共享层不会报错，只是界面上少一句话
 *      （TS 会拦"少给字段"，但拦不住"给错 key"）。
 *   2. 🔴 **单数分支**：词条表没有 ICU，`count === 1` 时必须走兄弟词条 ——
 *      "Streak 1 days" 是一眼可见的坏句子，而它**不会让任何别的测试变红**。
 *   3. 🔴 **不许传 `cellTooltip`**：它是悬停提示，手机没有鼠标。
 *      传了就是承诺一个不存在的交互（共享层会据此产出 `data-cell-title`）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { translate, type MessageKey } from '@heyta/i18n';
import { describe, expect, it } from 'vitest';

import { MOBILE_HEATMAP_MONTH_KEYS, habitBoardLabels, habitListLabels } from '../src/lib/habits-display';

/** 与界面同一条路：走真的词条表（缺 key 会**抛**，不是返回空串）。 */
const zh = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate('zh-CN', key, vars);
const en = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate('en', key, vars);

describe('habitBoardLabels：映射到共享层契约', () => {
  it('打卡按钮的两个状态与两个无障碍名（不同词条，不是前缀拼接）', () => {
    const labels = habitBoardLabels(zh);
    expect(labels.checkIn).toBe('打卡');
    expect(labels.checkedIn).toBe('已打卡');
    expect(labels.checkInA11y({ name: '喝水', doneToday: false })).toBe('为「喝水」打卡');
    expect(labels.checkInA11y({ name: '喝水', doneToday: true })).toBe('撤销「喝水」今日打卡');
  });

  it('🔴 三个数字各自分支：`count === 1` 时英文走**单数**词条', () => {
    const zhLabels = habitBoardLabels(zh);
    const enLabels = habitBoardLabels(en);
    // 中文无单复数，两句逐字相同（en 侧才会不同）。
    expect(zhLabels.streakCurrent(1)).toBe('连续 1 天');
    expect(zhLabels.streakCurrent(3)).toBe('连续 3 天');
    // 英文：1 天必须是 "day"，不是 "days"。
    expect(enLabels.streakCurrent(1)).toBe('Streak 1 day');
    expect(enLabels.streakCurrent(3)).toBe('Streak 3 days');
    expect(enLabels.streakLongest(1)).toBe('Longest 1 day');
    expect(enLabels.streakLongest(4)).toBe('Longest 4 days');
    expect(enLabels.streakTotal(1)).toBe('Total 1 day');
    expect(enLabels.streakTotal(9)).toBe('Total 9 days');
  });

  it('冻结说明**说的是"保住了几天"，不是余额**（ADR-0022：余额不上界面）', () => {
    const labels = habitBoardLabels(zh);
    const text = labels.freeze(2);
    expect(text).toContain('2');
    expect(text).toContain('冻结');
    // 🔴 库存措辞不许出现：它会把"给意外的宽容"变成"计划内的额度"。
    expect(text).not.toContain('还剩');
    expect(text).not.toContain('可用');
  });

  it('补打卡 / 重新开始：日期与数字都进句子', () => {
    const labels = habitBoardLabels(zh);
    expect(labels.repair({ date: '2026-09-27', count: 5 })).toContain('2026-09-27');
    expect(labels.repair({ date: '2026-09-27', count: 5 })).toContain('5');
    expect(labels.repairAction).toBe('补上');
    expect(labels.repairA11y({ date: '2026-09-27', name: '喝水' })).toContain('喝水');

    const fresh = labels.freshStart({ days: 9, longest: 21, total: 40 });
    expect(fresh).toContain('9');
    expect(fresh).toContain('21');
    expect(fresh).toContain('40');
    // 🔴 "重新开始不会清掉它们"是那句文案的**全部意义**，不许被改掉。
    expect(fresh).toContain('都还在');
    expect(labels.freshStartA11y('喝水')).toContain('喝水');
  });

  it('空态与热力图总述都带上该有的变量', () => {
    const labels = habitBoardLabels(zh);
    expect(labels.empty).not.toBe('');
    const grid = labels.heatmap.grid({ name: '喝水', total: 42, days: 90 });
    expect(grid).toContain('喝水');
    expect(grid).toContain('42');
    expect(grid).toContain('90');
  });

  it('月份是 1–12 且与 web 共用同一批 key（不新增同义键）', () => {
    const labels = habitBoardLabels(zh);
    const enLabels = habitBoardLabels(en);
    expect(labels.heatmap.month(1)).toBe('1月');
    expect(labels.heatmap.month(12)).toBe('12月');
    expect(enLabels.heatmap.month(1)).toBe('Jan');
    expect(enLabels.heatmap.month(12)).toBe('Dec');
    // 越界（理论上不会发生）必须兜到 1 月，而不是渲染 `undefined`。
    expect(labels.heatmap.month(0)).toBe('1月');
  });

  it('🔴 不传 `cellTooltip`：手机没有鼠标，不许承诺悬停', () => {
    expect(habitBoardLabels(zh).heatmap.cellTooltip).toBeUndefined();
  });

  it('图例共用「少 / 多」那一对既有词条', () => {
    const labels = habitBoardLabels(zh);
    expect(labels.heatmap.less).toBe('少');
    expect(labels.heatmap.more).toBe('多');
  });
});

/**
 * 清单（`HabitProgressList`）那一层的文案
 * ========================================
 *
 * 🔴 「列表 + 窗格」把习惯面拆成两块，而**两块各有三个数字**：窗格（`HabitBoard`）
 * 上是三枚 chip，清单上是一整句 `aria-label`。它们读的是同一个 `row` 的三个字段，
 * 但**过了两条不同的函数**。症状：详情板说"连续 1 天"，清单那一行读屏说
 * "Streak 1 days" —— 两句都"是英语/是中文"，没有任何一层会报错。
 *
 * 所以这一组钉的不是"话好不好听"，而是**两条路必须走同一对分支**。
 *
 * ⚠️ 这条判据只能拿**字符串**比（`assertEquals` 到 `habitBoardLabels` 那几个函数），
 * 因为移动端测试跑在 vitest/node 里，`@heyta/ui` 的**值** import 不了
 * （它顶层 import react-native 的 Flow 源码，实测整个 spec 转译失败）——
 * 类型 `import type` 可以，值不行。同一个理由见上面 `MOBILE_HEATMAP_MONTH_KEYS`。
 *
 * ✅ **变异验证**（2026-10-01，基线 14 passed → 每条注入 → 按字节恢复 → 14 passed，
 * 且恢复后文件与开场**字节一致**）。注入都落在 `habitListLabels` 这一处，红的用例是：
 *
 * | 注入 | 结果 |
 * |---|---|
 * | M1 `row` 用 `total: current` 顶替第三个数 | 2 红：三个数字各自念 + 走 web 那三条 key |
 * | M2 `list` 换成 `web.habits.week.aria` | 2 红：清单标题带名字 + 走 web 那三条 key |
 * | M3 `streakCurrent` 去掉 `count === 1` 分支 | **恰好 1 红**：与详情板同一对分支 |
 * | M4 `selectA11y` 传空名字 | 2 红：选择提示带名字 + 走 web 那三条 key |
 * | M5 整句改成手工拼 `longest ${longest} days, ${total} check-ins` | 3 红：三个数字 + 英文 (1,1,1) + 走 web 那三条 key |
 *
 * ⚠️ **第一轮跑出来的证据全部作废过**，成因值得留着：harness 被 `| head` 接走，
 * SIGPIPE 把它杀死 ⇒ bash 的 `trap … EXIT` 没跑 ⇒ M3 的故障**留在了源码里**；
 * 下一轮开场"备份"是从这份脏文件读的，于是它最后那条 `diff -q 一致` **自证**了。
 * 一般规律：**变异 harness 不许接管道**，而"恢复已验证"必须比对**开场之前的字节**
 * （sha256），不能比对"上一轮结束时手上那份"。
 */
describe('habitListLabels：清单的整句与三枚 chip 不许各说各话', () => {
  it('行首整句把三个数字**各自**念出来（不是同一个数复制三遍）', () => {
    const labels = habitListLabels(zh);
    const text = labels.row({ name: '喝水', current: 3, longest: 21, total: 40 });
    expect(text).toContain('喝水');
    expect(text).toContain('3');
    expect(text).toContain('21');
    expect(text).toContain('40');
    // 只改一个数字，整句必须跟着变 —— 钉住"它是变量插值，不是写死的句子"。
    expect(labels.row({ name: '喝水', current: 5, longest: 21, total: 40 })).not.toBe(
      labels.row({ name: '喝水', current: 3, longest: 21, total: 40 }),
    );
  });

  it('🔴 英文在 (1, 1, 1) 下不许出现 `1 days` / `1 check-ins`', () => {
    // 词条表**没有 ICU 复数**，所以整句这条 key 必须写成"单数安全"的形状
    // （`{n}-day` 复合词 + `in total`）。改成 `longest {longest} days` 会当场红。
    const text = habitListLabels(en).row({ name: 'Drink', current: 1, longest: 1, total: 1 });
    expect(text).not.toMatch(/\b1 days\b/);
    expect(text).not.toContain('1 check-ins');
    // 但 >1 时得是复数 —— 只钉单数会让它退化成永远 "day"。
    expect(text).toContain('1-day');
    const many = habitListLabels(en).row({ name: 'Drink', current: 2, longest: 3, total: 4 });
    expect(many).toContain('2-day');
    expect(many).toContain('3-day');
  });

  it('清单标题与选择提示都带名字（不是空串占位）', () => {
    const labels = habitListLabels(zh);
    expect(labels.list).toBe('习惯清单');
    expect(labels.selectA11y('喝水')).toContain('喝水');
    expect(labels.selectA11y('喝水')).not.toBe('喝水');
    expect(habitListLabels(en).list).toBe('Habits list');
  });

  it('🔴 空态在 labels 里，不在视图里（`check:empty-state` 断言 B）', () => {
    // 共享清单**自己**渲染"还没有习惯"（`HabitsScreen` 里不再出现这句）。
    // 少给这一项 → 空库时那一片是**真空**，而 TS 会拦（必填）；
    // 给成空串 → 拦不住，界面照样空白，所以这里连非空白一起钉。
    const labels = habitListLabels(zh);
    expect(labels.empty).toBe(zh('web.habits.empty'));
    expect(labels.empty.trim()).not.toBe('');
    expect(habitListLabels(en).empty).toBe(en('web.habits.empty'));
    // ⚠️ 与详情板同一个 key —— 两条路对"为什么是空的"只许有一个答案。
    expect(labels.empty).toBe(habitBoardLabels(zh).empty);
  });

  it('🔴 三个数字的句子与详情板**同一对分支**（清单不许自己再写一份单复数）', () => {
    const list = habitListLabels(en);
    const board = habitBoardLabels(en);
    for (const count of [1, 2, 9]) {
      expect(list.streakCurrent(count)).toBe(board.streakCurrent(count));
      expect(list.streakLongest(count)).toBe(board.streakLongest(count));
      expect(list.streakTotal(count)).toBe(board.streakTotal(count));
    }
    // 中文同样共用（无单复数，两句相同）。
    expect(habitListLabels(zh).streakCurrent(1)).toBe('连续 1 天');
  });

  it('🔴 走的是 web DOM 清单那三条 key，没有新增同义键', () => {
    // 同一句话在两端长成两个样子 = 「列表 + 窗格」最容易被悄悄做坏的地方，
    // 而词条表里多一条同义键**不会**让任何测试变红。所以钉"取到的字符串就是
    // 那条既有 key 的值"，而不是钉"有个字符串"。
    const labels = habitListLabels(zh);
    expect(labels.list).toBe(zh('web.habits.list.aria'));
    expect(labels.selectA11y('喝水')).toBe(zh('web.habits.row.selectA11y', { name: '喝水' }));
    expect(labels.row({ name: '喝水', current: 3, longest: 21, total: 40 })).toBe(
      zh('web.habits.row.aria', { name: '喝水', current: 3, longest: 21, total: 40 }),
    );
  });
});

describe('月份 key 的副本与共享层一致（本文件是那条漂移的守卫）', () => {
  it('移动端那份副本 = `packages/ui/src/habits/model.ts` 的 `HEATMAP_MONTH_KEYS`', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    // ⚠️ `HEYTA_HABITS_SHARED_MODEL` 是**只读接缝**，只给故障注入用
    // （把共享层源码复制到 `/tmp`、改一处、指过去）。不设时就是真实路径。
    const source = readFileSync(
      process.env.HEYTA_HABITS_SHARED_MODEL ??
        resolve(here, '../../../packages/ui/src/habits/model.ts'),
      'utf8',
    );
    const start = source.indexOf('export const HEATMAP_MONTH_KEYS');
    expect(start, '共享层找不到 `HEATMAP_MONTH_KEYS` —— 判据锚点已失效').toBeGreaterThanOrEqual(0);
    const end = source.indexOf('];', start);
    expect(end, '`HEATMAP_MONTH_KEYS` 之后找不到 `];` —— 判据锚点已失效').toBeGreaterThan(start);
    const shared = [...source.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(shared).toEqual([...MOBILE_HEATMAP_MONTH_KEYS]);
  });
});

/**
 * 工单 W6：数量行那三条文案（`labels.amount` / `amountPlusA11y` / `amountMinusA11y`）
 *
 * 🔴 这一组防的是两种**都不会报错**的坏法：
 *  · 共享层的三个字段是必填的，所以"没接"会被 TS 拦住 —— 但"接成另一批 key"不会。
 *    两端各建一条同义键（`mobile.habits.amount` vs `common.habits.amount.today`），
 *    症状是同一条习惯在两端说出两句话，而词条表里多一条键不会让任何东西变红。
 *  · 单位为空时那句兜底必须走**已有的** `web.habits.goal.defaultUnit`，
 *    不能在共享层猜"次"（对"每天 30 分钟"是错的），也不该再建一条。
 */
describe('数量行文案（W6）', () => {
  const AMOUNT_KEYS = [
    'common.habits.amount.today',
    'common.habits.amount.plus',
    'common.habits.amount.minus',
  ] as const;

  it('🔴 句子带得上三个数，单位为空时补「次」/「times」（走既有的那条 fallback）', () => {
    const zhLabels = habitBoardLabels(zh);
    const enLabels = habitBoardLabels(en);
    const withUnit = zhLabels.amount({ value: 5, target: 8, unit: '杯' });
    expect(withUnit).toContain('5');
    expect(withUnit).toContain('8');
    expect(withUnit).toContain('杯');
    // 空单位 ⇒ 必须有兜底量纲，否则渲染成「今天 5/8 」，像少了个字。
    const noUnit = zhLabels.amount({ value: 5, target: 8, unit: '' });
    expect(noUnit).toContain(zh('web.habits.goal.defaultUnit'));
    expect(enLabels.amount({ value: 5, target: 8, unit: '' })).toContain(
      en('web.habits.goal.defaultUnit'),
    );
    // 中英两条都得是**有内容**的句子（zh 侧纯占位符会被 `check:ui-language` 当漏翻）。
    expect(noUnit).not.toBe(withUnit);
    expect(enLabels.amount({ value: 0, target: 8, unit: 'cups' })).toContain('0');
  });

  it('🔴 两个步进按钮的无障碍名带习惯名（多个习惯同时在场时"加 1"指不出是谁的）', () => {
    const labels = habitBoardLabels(zh);
    expect(labels.amountPlusA11y({ name: '喝水' })).toContain('喝水');
    expect(labels.amountMinusA11y({ name: '喝水' })).toContain('喝水');
    // 两句必须**不同**：同一个名会让读屏用户分不清按下的是哪个。
    expect(labels.amountPlusA11y({ name: '喝水' })).not.toBe(labels.amountMinusA11y({ name: '喝水' }));
  });

  it('🔴 与 web 用的是**同一批** key —— 移动端不许另建一套同义词', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const read = (rel: string): string => readFileSync(resolve(here, rel), 'utf8');
    const keysIn = (src: string): string[] =>
      [...src.matchAll(/'(common\.habits\.amount\.[a-z]+)'/g)].map((m) => m[1]!).sort();
    // 本文件（移动端那份构造器）。⚠️ 期望值也要 `sort()`：`keysIn` 排过序，
    // 不排就把"顺序不同"读成"key 不同"。
    const mobile = keysIn(read('../src/lib/habits-display.ts'));
    const web = keysIn(read('../../../apps/web/src/features/habits/HabitsView.tsx'));
    const expected = [...AMOUNT_KEYS].sort();
    expect(mobile, '移动端没接全这三条').toEqual(expected);
    expect(web, 'web 没接全这三条').toEqual(expected);
    expect(mobile, '两端用的是不同的那批 key —— 同一条习惯会说两句话').toEqual(web);
  });
});
