/**
 * 移动端频次编辑器（工单 H5）—— 口径与分隔符都只许有一份
 * =======================================================
 *
 * ## 为什么这一族**只有源码层**
 *
 * 写入路径的**行为**判据不在这里，也不该在这里：移动端与 web 用的是同一个
 * `createHabitActions`（AGENTS §3.5：宿主只做接线），所以"一条 UPD、清除写 null、
 * 非法值抛、归一、另一台设备读得到、判定侧真的按它数计划日"这六件事已经由
 * `packages/app-host/tests/habit-actions.spec.ts` 的 F1–F10 在**真引擎 + 真 SQLite**
 * 上钉住了。在这里再跑一遍只会是把同一副夹具复制第二遍。
 *
 * 本壳没有 RN 组件测试栈（理由见 [`habit-create-entry.spec.ts`](./habit-create-entry.spec.ts)
 * 文件头），所以"接线在不在、有没有长出第二份事实源"只能读源码文本。
 *
 * ## 这一单真正要防的两格
 *
 *   1. 🔴 **"哪一种频次说哪句话"被抄进宿主**：共享层已经把 `habitFrequencySummaryKey`
 *      与 `HABIT_WEEKDAY_MESSAGE_KEYS` 导出来了。宿主自己写一份的症状是
 *      "同一个 `weekly`，web 说『每周 一、三』、移动端说『周一、周三』"，两边都不报错；
 *   2. 🔴 **列举分隔符长出第二张表**：`、` 这类纯标点进不了词条表（`check:ui-language`
 *      要求 zh 词条含汉字），所以它只能住在代码里 —— 而代码里那位所有者是
 *      `lib/recurrence-display.ts`。M3 数的是**全壳**命中数，不是"本文件有没有"。
 *
 * 🔴 **M3 当场照出一处既有手抄**：`src/ai/disclosure.tsx` 里那张
 *    `Record<'zh-CN' | 'en', string>` 与单源那张**键值逐字相同**（`Locale = 'zh-CN' | 'en'`），
 *    也就是说它一天都没坏过、也没有任何一层会红 —— 而它是第二份事实源。
 *    已删掉它并改为 `import { LIST_SEPARATOR } from '../lib/recurrence-display'`
 *    （跨线改动，三条齐：一子可删 / 运行时形状逐字相同 / `git checkout --` 一枚文件可回退）。
 *
 * ⚠️ 所有反向判据都先 `stripComments`：注释里出现被禁的字符串会让判据**假绿**。
 */

import { describe, expect, it } from 'vitest';

import { mobileSources, read, stripComments } from './source-reading';

const SCREEN = 'apps/mobile/src/screens/HabitsScreen.tsx';
const SLOT = 'apps/mobile/src/ui/habit-frequency-slot.tsx';
const SEPARATOR_OWNER = 'apps/mobile/src/lib/recurrence-display.ts';

describe('移动端频次编辑器的接线与单一口径（源码层）', () => {
  const screen = stripComments(read(SCREEN));
  const slot = stripComments(read(SLOT));

  it('M1 详情层渲染频次编辑器，且按下走 `actions.setHabitFrequency`', () => {
    expect(screen, '详情层没有渲染 HabitFrequencySlot').toMatch(/<HabitFrequencySlot\b/);
    expect(screen, '入口没接到动作层').toMatch(/actions\s*\.\s*setHabitFrequency\(/);
    // 🔴 必须把 promise **交回组件**：本壳的 `runFor` 只置灰、不显示原因，
    //    交给它就得到"点了没反应"（与 web 那条 `不包 run()`` 同一条理由）。
    expect(screen, '把 promise 吞在宿主里了（组件拿不到失败）').toMatch(
      /onSet=\{[\s\S]{0,80}chooseFrequency/,
    );
  });

  it('M2 🔴 摘要口径来自共享层，宿主里没有第二份「哪一种频次说哪句话」', () => {
    expect(slot, '没有引用共享层的 habitFrequencySummaryKey').toMatch(
      /import\s*\{[^}]*\bhabitFrequencySummaryKey\b[^}]*\}\s*from\s*'@heyta\/ui'/,
    );
    expect(slot, '没有引用共享层的 HABIT_WEEKDAY_MESSAGE_KEYS').toMatch(
      /HABIT_WEEKDAY_MESSAGE_KEYS/,
    );
    // 反向：宿主里不许出现自己拼的句子（`'每周 '` 前缀 / `周` + 星期名字面量拼接）。
    expect(slot, '宿主里自己拼了「每周 …」这句话').not.toMatch(/['"`]每周\s/);
    expect(slot, '宿主里自己拼了「每 … 天」这句话').not.toMatch(/['"`]每\s*\$?\{?[^'"`]*天['"`]/);
    // 阳性对照：共享层那两份确实存在（否则上面两条会因为"根本没这功能"而假绿）。
    const ui = stripComments(read('packages/ui/src/habits/model.ts'));
    expect(ui, '共享层的频次摘要口径不见了').toMatch(/export function habitFrequencySummaryKey/);
    expect(ui, '共享层的星期词条表不见了').toMatch(/export const HABIT_WEEKDAY_MESSAGE_KEYS/);
  });

  it('M3 🔴 列举分隔符全壳只许有一处定义（第二处不报错，只会漂移）', () => {
    const definers = mobileSources().filter((rel) =>
      /LIST_SEPARATOR\s*[:=]/.test(stripComments(read(rel))),
    );
    expect(definers, `分隔符表出现了多位所有者：${definers.join(' , ')}`).toEqual([
      SEPARATOR_OWNER,
    ]);
    // 直接写死标点的那条路也堵住（不声明表、在组件里 inline `'、'`）。
    const inline = mobileSources()
      .filter(
        (rel) => rel !== SEPARATOR_OWNER && /['"]、['"]/.test(stripComments(read(rel))),
      )
      .sort();
    expect(
      inline,
      `绕过单源写死顿号的文件（登记过的债见本条注释）：${inline.join(' , ')}`,
    ).toEqual([]);
    // 阳性对照：频次摘要确实**取**了那位所有者，而不是没用到所以没红。
    expect(slot, '频次摘要没走 LIST_SEPARATOR 那一份单源').toMatch(
      /import\s*\{\s*LIST_SEPARATOR\s*\}\s*from/,
    );
  });

  it('M4 🔴 只画当前那一档的零件（两档同时摆着 = 界面在说谎）', () => {
    /* ⚠️ 极性：这一条**只能写正向**。第一版写成"不许出现 `<View>{HABIT_WEEKDAY_MESSAGE_KEYS.map`"，
       而正确代码里那个 `<View>` 就在 `isWeekly ? (` 的分支里，紧跟着一行就是 `.map(` ⇒ 干净代码被判红。
       判据在干净代码上红与永不通过一样有害（同仓 `habit-create-entry.spec.ts` J5 第一版同一个错）。
       正向断言同样挡得住那个变异：把 `{isWeekly ? (` 摘掉，`.map(` 前面就不再是那个条件 ⇒ 转红。 */
    expect(slot, '星期那一排没有挂在 weekly 条件里').toMatch(
      /\{isWeekly\s*\?\s*\([\s\S]{0,220}?HABIT_WEEKDAY_MESSAGE_KEYS\.map/,
    );
    expect(slot, 'N 那一行没有挂在 interval 条件里').toMatch(
      /\{isInterval\s*\?\s*\([\s\S]{0,220}?habit-freq-n-/,
    );
    // 阳性对照：两个条件各自都还在（有人写成 `{true ? (` 也能过上面两条）。
    // ⚠️ 不能把 `open` 也算进来：折叠面板本身就是 `{open ? (`，那是真条件。
    expect(slot, '档位条件被摘成了常量').not.toMatch(/\{\s*(?:true|1)\s*\?\s*\(/);
  });

  it('M5 清空=退回每天；已经是每天时不再发第二条', () => {
    expect(slot, '清空日子集合发的是空集合（动作层会抛 ⇒ 点了没反应）').toMatch(
      /next\.length === 0 \? undefined/,
    );
    expect(slot, '已经是"每天"时再点那一格还会发一条脏 op').toMatch(/if \(isDaily\) return;/);
    // 切到 weekly 时给"今天那一档"，而不是空集合。
    expect(slot, '切到每周时没带日子').toMatch(/daysOfWeek:\s*\[\s*isoWeekday\(today\)\s*\]/);
  });

  it('M6 失败必须看得见（`.catch` 里要写错误态，只 `.catch(() => {})` 等于没接）', () => {
    expect(slot, '没有接住 reject').toMatch(/\.catch\(/);
    expect(slot, '接住了却没显示').toMatch(/\.catch\([\s\S]{0,80}setFailed\(/);
  });

  it('M7 文案全走词条（界面里不许硬编码中文）', () => {
    expect(slot, 'JSX 里有硬编码中文').not.toMatch(/>\s*[\u4e00-\u9fa5]{2,}\s*</);
    for (const key of [
      'web.habits.freq.toggle',
      'web.habits.freq.daily',
      'web.habits.freq.weekly',
      'web.habits.freq.interval',
      'web.habits.freq.nDays',
      'web.habits.freq.invalid',
      'web.habits.freq.intervalHint',
      'web.habits.freq.aria',
    ]) {
      expect(slot, `少了词条 ${key}（中英必须同步）`).toContain(`'${key}'`);
      expect(read('packages/i18n/src/locales/zh-CN.ts'), `zh 少了 ${key}`).toContain(
        `'${key}'`,
      );
      expect(read('packages/i18n/src/locales/en.ts'), `en 少了 ${key}`).toContain(`'${key}'`);
    }
  });

  it('M8 全壳 `setHabitFrequency` 调用点恰好一枚（多了就是有人另开了一条写入口）', () => {
    const hits = mobileSources()
      .filter((rel) => /actions\s*\.\s*setHabitFrequency\(/.test(stripComments(read(rel))))
      .sort();
    expect(hits, `调用点不是恰好一枚：${hits.join(' , ')}`).toEqual([SCREEN]);
  });

  it('M9 🔴 频次改动只能经动作层进 op-log（不许落进本地 state）', () => {
    /* ⚠️ 本条第一版写成"屏里不许出现 `setHabits(`"，把**合法的读侧状态**
       （`const aliveHabits = actions.listHabits(); setHabits(aliveHabits)`）也判红了 ——
       同一个错在 `habit-create-entry.spec.ts` 的 J5 已经犯过一次并留了注释。
       要防的形状是"在本地把频次改出来"，不是"屏里存在 React state"。 */
    for (const bad of [
      /habit\.frequency\s*=[^=]/, // 直接写对象上的字段
      /setHabits\(\s*habits\.map\(/, // 在本地数组上把某条的频次换掉
      /setHabits\(\s*\[[\s\S]{0,60}frequency/, // 本地拼一条带频次的习惯塞进去
    ]) {
      expect(`${screen}\n${slot}`, `绕开 op-log 写频次：${bad.source}`).not.toMatch(bad);
    }
    // 阳性对照：喂给 `setHabits` 的那个值**就是**物化读的返回（J5 钉同一条，这里要频次侧的正面）。
    expect(
      screen,
      '界面那份数组不是来自物化读 `actions.listHabits()`',
    ).toMatch(/const aliveHabits = actions\.listHabits\(\);[\s\S]{0,120}setHabits\(aliveHabits\)/);
    expect(screen, '没走 actions').toMatch(/actions\s*\.\s*setHabitFrequency\(/);
  });
});
