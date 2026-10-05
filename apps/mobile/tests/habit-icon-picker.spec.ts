/**
 * 移动端图标选择器（工单 H3）—— 字形只许有一份事实源
 * ====================================================
 *
 * ## 这一单真正要防的东西
 *
 * `packages/ui` 与 `apps/web` 各有一张 `HABIT_GLYPHS`（前者配 `lucide` 的**图标数据**，
 * 后者配 `lucide-react` 的**组件**）。这两张**结构上必须分开** —— 画的不是同一种东西 ——
 * 它们的一致性早就有钉子：`apps/web/tests/habits-list-pane.spec.tsx` 的 F 组逐对比。
 *
 * 🔴 但 F 组管不到的那一格，正是本单会造出来的：移动端接了选择器之后，仓库里随时可能
 *    出现**第三张** `key → 字形`（宿主里手抄一份最省事）。它坏的时候两端都不报错，
 *    症状只是"清单上是水滴、点开选择器是月亮"，或者反过来。
 *    ⇒ S2 那条判据把"移动端不许出现字形表的**定义**"钉成红的。
 *
 * 同族的第二格：`key → 词条` 那张表**没有**平台差异，以前只住在 web 的
 * `habit-glyphs.ts` 里。移动端要复用就只能再抄一份 —— 所以本单把它**提到共享层**，
 * 并把 web 那份手抄删掉（抽取的收尾动作是删掉旧的那份，不是再写一份更好的）。
 * ⇒ S3 同时钉"共享层有"与"web 那份已经不在了"。
 *
 * ## 两层判据
 *
 * **行为层 K1–K4**（真 `OpLogEngine` + 真 SQLite，与 `organizer-rename.spec.ts` 同一副夹具）：
 *   K1 选一个图标 = **全局**恰好 +1 条 op，那条 UPD 只带 `icon`（挡 fan-out 与顺手多写）
 *   K2 传 `undefined` 落的是 `null`（"不写这个键 = 不改"与"清除"是两件事，
 *      混了就得到"用户点默认，界面退回派生而磁盘上还是旧 key"的两套状态）
 *   K3 闭集之外的值 ⇒ 动作层**抛**且 op 数不变（界面不自己判，见 `parseHabitIcon`）
 *   K4 读路径：没挑过 ⇒ 派生且**稳定**；挑过 ⇒ 就是挑的那个；清除 ⇒ 回到派生。
 *      这条是界面上「默认」那一格"说的是真话"的数据层依据。
 *
 * **源码层 S1–S6**（`apps/mobile` 刻意没有 RN 组件测试栈，理由见
 * [`habit-create-entry.spec.ts`](./habit-create-entry.spec.ts) 文件头）：
 *   S1 详情层有入口，且按下走 `actions.setHabitIcon`
 *   S2 🔴 移动端**不许**自己定义 `key → 字形` 表（第三份事实源）
 *   S3 字形词条表住在共享层且 web 那份手抄已删
 *   S4 选项来自闭集 `HABIT_ICONS`（不写死数量），且「默认」那一格在
 *   S5 文案全走词条（界面里不许硬编码中文）
 *   S6 全壳 `setHabitIcon` 调用点**恰好一枚**
 *
 * ⚠️ 本文件不 import `react-native`，也不 import `@heyta/ui` 的**值**
 *    （移动端的 vitest 跑在 node 里，`@heyta/ui` 的 `dist` 顶层 import `react-native`，
 *    值导入会让整个 spec 文件转译失败）—— S2/S3 因此读源码文本，这也是它们唯一能读的方式。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Habit } from '@heyta/domain';
import { habitIconOf, HABIT_ICONS } from '@heyta/domain';
import { createHabitActions, type HabitActions } from '@heyta/app-host';
import { OpLogEngine, type MaterializedState } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCREEN = 'apps/mobile/src/screens/HabitsScreen.tsx';
const SLOT = 'apps/mobile/src/ui/habit-icon-slot.tsx';
const UI_GLYPHS = 'packages/ui/src/habits/HabitProgressList.tsx';
const WEB_GLYPHS = 'apps/web/src/features/habits/habit-glyphs.ts';

const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

/** `apps/mobile/src` 下所有源文件（与 `habit-create-entry.spec.ts` 同一份走法）。 */
function mobileSources(): string[] {
  const root = join(REPO, 'apps/mobile/src');
  const acc: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) acc.push(relative(REPO, full));
    }
  };
  walk(root);
  return acc.sort();
}

// ── 行为层夹具 ─────────────────────────────────────────────────────────
let adapter: SqliteAdapter;
let engine: OpLogEngine;
let habits: HabitActions;
let clock = 1_700_000_000_000;
const now = (): number => clock;

let seq = 0;
const nextHabitId = (): string => {
  seq += 1;
  return `habit-icon-${String(seq).padStart(3, '0')}`;
};

const opCount = async (): Promise<number> => (await engine.getAllOps()).length;
const habitOf = (id: string): Habit =>
  (engine.getState() as unknown as MaterializedState).habits[id] as Habit;

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({ store: new DbOpLogStore(adapter), clientId: 'client-icon-a', now });
  clock = 1_700_000_000_000;
  seq = 0;
  habits = createHabitActions(engine, { newHabitId: () => nextHabitId(), now });
});

afterEach(async () => {
  await adapter.close();
});

describe('习惯图标的落库与读路径（行为层）', () => {
  it('K1 选一个图标 = 全局恰好 +1 条 op，那条 UPD 只带 icon', async () => {
    const id = await habits.createHabit('喝水');
    const before = await opCount();

    clock += 1_000;
    await habits.setHabitIcon(id, 'moon');

    expect(await opCount(), '一次选图标发出了多条 op（AGENTS §3.4）').toBe(before + 1);
    const ops = await engine.getOpsForEntity('HABIT', id);
    const last = ops[ops.length - 1];
    expect(last?.opType).toBe(OpType.Update);
    expect(Object.keys(last?.payload ?? {}), '那条 UPD 多写了别的字段').toEqual(['icon']);
    expect(last?.payload.icon).toBe('moon');
    expect(habitOf(id).icon).toBe('moon');
  });

  it('K2 传 undefined 落的是 null（"清除"必须与"不改"是两件不同的事）', async () => {
    const id = await habits.createHabit('阅读');
    await habits.setHabitIcon(id, 'leaf');
    expect(habitOf(id).icon).toBe('leaf');

    await habits.setHabitIcon(id, undefined);
    const ops = await engine.getOpsForEntity('HABIT', id);
    const last = ops[ops.length - 1];
    expect(last?.opType).toBe(OpType.Update);
    // 🔴 **op** 上键必须在、值是 `null`：写成"少一个键"会让回放层分不清"没改"和"改回默认"，
    //    而 `habit.icon` 的旧值会活下来 —— 症状是界面上选了「默认」、重开 App 又变回去。
    expect(Object.keys(last?.payload ?? {})).toEqual(['icon']);
    expect(last?.payload.icon).toBeNull();
    // 物化状态里则是**键被删掉**（reducer 的"清除 = 删键"约定，与 `color` 同一套）：
    // 读出来是 `undefined`，于是 `habitIconOf` 走派生 —— 那才是「默认」要的效果。
    // ⚠️ 这一格刻意写成 `toBeUndefined` 而不是 `toBeNull`：状态里的 `null` 与 `undefined`
    //    在这条约定下不是同一个东西，把断言改成 `null` 会红，而红得对。
    expect(habitOf(id).icon).toBeUndefined();
    expect(habitIconOf(habitOf(id)), '删键之后读不到派生字形').toBe(
      habitIconOf({ id, name: '阅读' } as unknown as Habit),
    );
  });

  it('K3 闭集之外的值由动作层抛，且一条 op 都不写', async () => {
    const id = await habits.createHabit('跑步');
    const before = await opCount();

    await expect(habits.setHabitIcon(id, 'trophy' as never)).rejects.toThrow(/闭集/);
    expect(await opCount(), '非法值照样落库了').toBe(before);
    expect(habitOf(id).icon, '非法值改掉了原值').toBeUndefined();
  });

  it('K4 读路径：没挑过 ⇒ 派生且稳定；挑过 ⇒ 就是它；清除 ⇒ 回到派生', async () => {
    const id = await habits.createHabit('冥想');

    const derived = habitIconOf(habitOf(id));
    expect(HABIT_ICONS, `派生值不在闭集里：${derived}`).toContain(derived);
    expect(habitIconOf(habitOf(id)), '派生值不稳定（同一 id 两次不一样）').toBe(derived);

    await habits.setHabitIcon(id, 'music');
    expect(habitIconOf(habitOf(id))).toBe('music');

    await habits.setHabitIcon(id, undefined);
    expect(
      habitIconOf(habitOf(id)),
      '清除之后没有回到那个派生值 —— 「默认」那一格就在说谎',
    ).toBe(derived);
  });
});

describe('移动端图标选择器的接线与单一事实源（源码层）', () => {
  const screen = stripComments(read(SCREEN));
  const slot = stripComments(read(SLOT));

  it('S1 详情层渲染选择器，且按下走 `actions.setHabitIcon`', () => {
    expect(screen, '详情层没有渲染 HabitIconSlot').toMatch(/<HabitIconSlot\b/);
    expect(screen, '入口没接到动作层').toMatch(/actions\s*\.\s*setHabitIcon\(/);
  });

  it('S2 🔴 移动端不许自己定义「key → 字形」表（第三份事实源）', () => {
    /* 这一条是本单最值钱的钉子：F 组只比 web 清单与共享清单那两张，
       宿主里再手抄一张**不会让它红**，而症状是"清单水滴 / 选择器月亮"。 */
    const definers = mobileSources().filter((rel) =>
      /(?:const|let|var)\s+HABIT_GLYPHS\s*[:=]/.test(stripComments(read(rel))),
    );
    expect(definers, `移动端出现了自己的字形表：${definers.join(' , ')}`).toEqual([]);
    // 反向阳性对照：本屏确实**引用**了共享层那张（否则上面那条会因为"没用它"而假绿）。
    expect(slot, '选择器没有引用共享层的 HABIT_GLYPHS').toMatch(
      /import\s*\{[^}]*\bHABIT_GLYPHS\b[^}]*\}\s*from\s*'@heyta\/ui'/,
    );
    // 清单那侧也一样：它画的是同一张表，不是自己算的。
    expect(stripComments(read(UI_GLYPHS)), '共享层那张字形表不见了').toMatch(
      /const HABIT_GLYPHS\s*:/,
    );
  });

  it('S3 字形词条表住在共享层，web 那份手抄已删', () => {
    const ui = stripComments(read(UI_GLYPHS));
    expect(ui, '词条表不在共享层').toMatch(/const HABIT_ICON_LABEL_KEYS\s*=/);
    // 穷尽性仍然要成立：`as const satisfies Record<HabitIcon, string>`。
    expect(ui, '词条表丢了穷尽性（加第 9 个 key 不会再有编译错误）').toMatch(
      /satisfies Record<HabitIcon, string>/,
    );
    const web = stripComments(read(WEB_GLYPHS));
    expect(
      web,
      'web 又长回一份手抄的词条表（抽取的收尾动作是删掉旧那份）',
    ).not.toMatch(/'web\.habits\.icon\.drop'/);
    expect(web, 'web 没从共享层取词条表').toMatch(/export \{ HABIT_ICON_LABEL_KEYS \} from '@heyta\/ui'/);
  });

  it('S4 选项来自闭集，且「默认」那一格在（挑过要能退回去）', () => {
    expect(slot, '选择器写死了字形列表，没走闭集').toMatch(/HABIT_ICONS\.map\(/);
    expect(slot, '少了「默认」那一格').toMatch(/t\('web\.habits\.icon\.default'\)/);
    // 再点一次同一个 = 退回派生（与色槽同一条补救动作，不需要第 9 格表达"取消"）。
    expect(slot, '重复点同一个字形不会退回派生').toMatch(
      /effective === icon && value === icon \? undefined : icon/,
    );
    // 磁盘上的值必须先解析再当类型用（否则不认识的历史值会把 undefined 喂给字形表）。
    expect(slot, '没有先过 parseHabitIcon').toMatch(/parseHabitIcon\(habit\.icon\)/);
  });

  it('S5 选择器的文案全走词条（界面里不许硬编码中文）', () => {
    expect(slot, '有硬编码文案').not.toMatch(/>\s*[\u4e00-\u9fa5]{2,}\s*</);
    for (const key of [
      'web.habits.icon.toggle',
      'web.habits.icon.group',
      'web.habits.icon.default',
      'web.habits.icon.a11y',
      'web.habits.icon.a11yDefault',
    ]) {
      // 只比**带引号的 key**：`a11y` 那两条是 `t('…', { name })` 带参数的形状，
      // 判 `t('…')` 会让它们假红（形近的两个 key 也挡不住，所以逐条列出来）。
      expect(slot, `少了词条 ${key}`).toContain(`'${key}'`);
    }
  });

  it('S6 🔴 全壳 `setHabitIcon` 调用点恰好一枚（第二份实现 = 两套裁决）', () => {
    const hits = mobileSources()
      .filter((rel) => stripComments(read(rel)).includes('setHabitIcon('))
      .map((rel) => rel);
    expect(hits, `调用点不是恰好一枚：${hits.join(' , ')}`).toEqual([SCREEN]);
  });
});
