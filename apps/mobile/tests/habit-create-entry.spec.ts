/**
 * 移动端「新建习惯」这条线**真的接到底**吗（工单 H2）
 * ====================================================
 *
 * ## 为什么这一单只有判据、没有功能
 *
 * 现量（2026-10-06 00:4x）：入口早在 `b2b5455a`（09-28 22:02「移动端对齐 Web 的同一批能力」）
 * 就落地了 —— `HabitsScreen.tsx` 里 `Card` 内 `TextField` + 主按钮，`:446` 调
 * `actions.createHabit(name)`。缺的是**钉住它的那几条判据**：
 * `grep -rln createHabit apps/mobile/tests` 当时只命中 `organizer-rename.spec.ts`
 * （那是清单/标签那条线），**习惯新建本身 0 条**。
 *
 * ## 为什么是**两层**：行为层 + 源码层
 *
 * **行为层**（B1–B4）用真 `OpLogEngine` + 真 SQLite（`:memory:`），与
 * [`organizer-rename.spec.ts`](./organizer-rename.spec.ts) 同一副夹具。它钉的是
 * 工单 H2 判据里那两条**源码读不出来**的事：一条意图恰好一条 op（fan-out 只有数
 * 整条日志才藏不住），以及**另一台设备读到同一条习惯**（用第二个 clientId、
 * 第二个空库 `applyRemote` 这条日志 —— 那是设备级验收 `verify:mobile-*` 在单元层
 * 没有的钉子）。
 *
 * **源码层**（J1–J7）钉接线。`apps/mobile` 刻意没有 RN 组件测试栈
 * （`@testing-library/react-native` 不在依赖里，引它要先过 AGENTS §3.1–3.2 两道门；
 * 同一取向与理由见 [`habit-goal-entry.spec.ts`](./habit-goal-entry.spec.ts) 文件头）。
 * 而这一族要防的失效**恰好是"接线断了"**：动作层有、界面画得出来、
 * 用户点了没反应或写了个本地数组 —— **都不报错**。
 *
 * ⚠️ 本文件**不 import `@heyta/ui` 的值**（移动端 vitest 跑在 node 里，而 `@heyta/ui`
 *    的 `dist` 顶层 import `react-native`，值导入会让整个文件转译失败），
 *    也不 import `react-native`（在 node 里加载它直接失败）。
 *
 * ## 每条都点名它防的那一份坏（能红的方式各不相同，所以逐条留着）
 *
 *   B1 新建 = 全局恰好 +1 条 op，且那条 CREATE 只带 `name` + `target` ⇒ 挡 fan-out
 *      与"顺手多写一个字段"
 *   B2 重放整条日志后这条习惯仍在 ⇒ 挡"写进了内存态但没写进日志"（症状：当场看着
 *      建好了，重开 App 就没了）
 *   B3 🔴 第二台设备读到同一条 ⇒ 挡"只写本地数组"（工单 H2 点名的那条变异）
 *   B4 空白名动作层抛错且 op 数不变 ⇒ 这一条是**本屏注释里写着的依赖**
 *      （`HabitsScreen.tsx:441`「动作层对空名字抛错」）。契约的事实源在
 *      `packages/app-host/tests/habit-actions.spec.ts`；这里只钉"消费方以为它成立"
 *      那一格 —— 它哪天不成立了，本屏的拦截就成了唯一一道，而唯一一道不该存在。
 *   J1 入口不在了 / 换成了别的动作 ⇒ 用户又回到"手机建不了习惯"
 *   J2 空名不写 ⇒ 点一下按钮就落一条 `name: ''` 的习惯（界面上像凭空多了一条空白）
 *   J3 失败要被接住并**进 setError** ⇒ `runFor` 那种只 `.finally()` 的写法会变成
 *      unhandled rejection，用户看到的是"点了没反应"（同仓 `habit-goal-entry.spec.ts`
 *      J5 同一族）
 *   J4 写成功要刷新 ⇒ 数据进了 op-log 而列表不动（"要等下一次同步才看得见"）
 *   J5 界面那份数组**只能来自物化读** ⇒ 本地拼一条塞进数组就是 AGENTS §3.4 那条
 *      "UI 不得绕开 op-log"。⚠️ 本条第一版把合法的 `setHabits(listHabits())`
 *      也判红了 —— 判据在干净代码上红与判据永不通过一样有害，形状见那条注释。
 *   J6 全壳**恰好一个**新建调用点 ⇒ 第二份实现 = 两套裁决（§3.5 那段 clientId 漂移的教训）
 *   J7 文案必须走词条 ⇒ `packages/i18n` 是唯一文案事实源（`check:ui-language` 的同族，
 *      但那条门禁扫的是通用界面，这里点名这一处）
 */

import { mobileSources, read, stripComments } from './source-reading';

import type { Habit } from '@heyta/domain';
import { createHabitActions, type HabitActions } from '@heyta/app-host';
import { OpLogEngine, emptyState, replayOperations, type MaterializedState } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// 读文件 / 剥注释 / 列源码这三件事住在 `./source-reading`（工单 H5 起收口成一份；
// 原来本文件与 `habit-icon-picker.spec.ts` 各有一份**已经漂移**的实现 ——
// 一份剥注释用 `^\s*//`、另一份用 `^[ \t]*//`，这正是"同一判断写两遍"的必然结果）。
const SCREEN = 'apps/mobile/src/screens/HabitsScreen.tsx';

// ── 行为层夹具（与 organizer-rename.spec.ts 同一副；真引擎、真 SQLite、零 mock）──
let adapter: SqliteAdapter;
let engine: OpLogEngine;
let habits: HabitActions;
let clock = 1_700_000_000_000;
const now = (): number => clock;

let seq = 0;
const nextHabitId = (): string => {
  seq += 1;
  return `habit-create-${String(seq).padStart(3, '0')}`;
};

const state = (): MaterializedState => engine.getState() as unknown as MaterializedState;

/** 整条日志的长度 —— fan-out 在这里藏不住（不是"这个实体的 op +1"）。 */
const opCount = async (): Promise<number> => (await engine.getAllOps()).length;

/** 把当前日志整条重放一遍 = "重开 App"后应当看到的状态。 */
const rehydrated = async (): Promise<MaterializedState> =>
  replayOperations(emptyState(), await engine.getAllOps());

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({ store: new DbOpLogStore(adapter), clientId: 'client-mobile-a', now });
  clock = 1_700_000_000_000;
  seq = 0;
  habits = createHabitActions(engine, { newHabitId: () => nextHabitId(), now });
});

afterEach(async () => {
  await adapter.close();
});

describe('移动端新建习惯的落库形状（行为层：真引擎 + 真 SQLite）', () => {
  it('B1 新建一条 = 全局恰好 +1 条 op，且那条 CREATE 只带 name 与 target', async () => {
    const before = await opCount();

    clock += 1_000;
    const id = await habits.createHabit('  喝水  ');

    expect(await opCount(), '一条意图发出了多条 op（fan-out，AGENTS §3.4）').toBe(before + 1);
    const ops = await engine.getOpsForEntity('HABIT', id);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.opType).toBe(OpType.Create);
    // 🔴 键集合逐字钉住：多写一个字段（`updatedAt`、`icon`、`frequency`…）在这一格
    //    上是"看着无害"的，但它在 §3.3 那条上是**落盘数据会长期存在**的那一类。
    expect(Object.keys(ops[0]?.payload ?? {}).sort()).toEqual(['name', 'target']);
    expect(ops[0]?.payload.name).toBe('喝水');
    expect((state().habits[id] as Habit).name).toBe('喝水');
  });

  it('B2 重放整条日志后这条习惯仍在（挡"写进内存态但没写进日志"）', async () => {
    const id = await habits.createHabit('阅读');

    const after = await rehydrated();
    const revived = after.habits[id] as Habit | undefined;
    expect(revived, '重放之后这条习惯不存在 —— 重开 App 就没了').toBeDefined();
    expect(revived?.name).toBe('阅读');
  });

  it('B3 🔴 另一台设备读到同一条习惯（第二个 clientId + 第二个空库，走 applyRemote）', async () => {
    const id = await habits.createHabit('跑步');
    const ops = await engine.getAllOps();

    const otherAdapter = new SqliteAdapter({
      schema: INDEXEDDB_SCHEMA,
      driverFactory: () => new NodeSqliteDriver(':memory:'),
    });
    await otherAdapter.init();
    try {
      const other = new OpLogEngine({
        store: new DbOpLogStore(otherAdapter),
        clientId: 'client-mobile-b',
        now,
      });
      const result = await other.applyRemote(ops);
      // 判据①：那批 op **真的被应用了**（不是被幂等闸门吞掉、也不是被向量时钟挡住）。
      expect(result.applied, `远端批次没有应用任何 op（skipped=${String(result.skipped)}）`).toHaveLength(
        ops.length,
      );
      // 判据②：另一台设备的**动作层**读得到，而不是只有裸状态读得到 ——
      // 界面消费的是 `listHabits()`，物化状态对了而这里读不到同样是"手机上看不见"。
      const onOther = createHabitActions(other, { newHabitId: () => 'unused', now }).listHabits();
      expect(onOther.map((h) => h.id), '另一台设备读到的不是同一条').toEqual([id]);
      expect(onOther[0]?.name).toBe('跑步');
    } finally {
      await otherAdapter.close();
    }
  });

  it('B4 空白名动作层抛错且 op 数不变（本屏 `:441` 那句注释依赖的正是这条）', async () => {
    const before = await opCount();
    await expect(habits.createHabit('   \n ')).rejects.toThrow(/不能为空/);
    expect(await opCount(), '空名也落了一条 op').toBe(before);
  });
});

describe('移动端新建习惯的接线（源码级；本壳没有组件测试栈）', () => {
  const src = stripComments(read(SCREEN));

  it('J1 界面上有常驻的新建入口：TextField + 主按钮，按下走 `actions.createHabit`', () => {
    expect(src, '新建输入框被摘掉了').toMatch(/<TextField\b[\s\S]{0,400}?value=\{draft\}/);
    expect(src, '新建按钮没调动作层').toMatch(/actions\s*\.\s*createHabit|void actions\n\s*\.createHabit/);
  });

  it('J2 空名**在写入之前**就返回（顺序也要成立：拦必须在 createHabit 之前）', () => {
    const guard = src.indexOf("if (name === '') return;");
    const call = src.search(/\.createHabit\(/);
    expect(guard, '没有空名拦截').toBeGreaterThan(-1);
    expect(call, '没找到 createHabit 调用点').toBeGreaterThan(-1);
    expect(guard, '空名拦跑到了写入之后 —— 那等于没拦').toBeLessThan(call);
  });

  it('J3 失败被接住**并且进 setError**（只 `.catch(() => {})` 等于把错误吞掉）', () => {
    const call = src.search(/\.createHabit\(/);
    const after = src.slice(call);
    const catchAt = after.search(/\.catch\(/);
    expect(catchAt, 'createHabit 之后没有 .catch —— 失败会变成 unhandled rejection').toBeGreaterThan(
      -1,
    );
    // 接住之后必须落到错误状态：吞掉错误的 catch 与没有 catch 对用户是同一件事
    //（都是"点了没反应"），但它会让上面那条 `.catch(` 判据永远绿。
    expect(
      after.slice(catchAt, catchAt + 220),
      '.catch 里没有 setError —— 失败被静默吞掉',
    ).toMatch(/setError\(/);
  });

  it('J4 写成功要 refresh（否则列表不动，用户以为没建成）', () => {
    const call = src.search(/\.createHabit\(/);
    const after = src.slice(call, call + 900);
    expect(after, '新建成功后没重读物化状态').toMatch(/refresh\(\)/);
  });

  it('J5 界面上那份数组**只能来自物化读**，不许本地造（AGENTS §3.4）', () => {
    /* 🔴 本条第一版写的是"不许出现 `setHabits(`"，它在**干净代码上就红**了：
       这一屏本来就要把物化状态存进 React state（`refresh()` 里的
       `setHabits(aliveHabits)`），那是合法的读侧状态，不是绕开 op-log。
       一条会把正确代码判红的判据与一条永不通过的判据一样有害 —— 前者逼人删掉判据。
       要防的形状是"**本地拼出一个习惯再塞进数组**"（那才是绕过 op-log 写业务态）。 */
    for (const bad of [/habits\.(push|unshift|splice|pop)\(/, /setHabits\(\s*\[/]) {
      expect(src, `出现了本地数组写入（绕开 op-log）：${bad.source}`).not.toMatch(bad);
    }
    // 正面：喂给 `setHabits` 的那个值必须**就是** `listHabits()` 的返回，
    // 中间不许有 `.filter(` / `.map(` 之外的加工（改一条本地副本 = 第二份事实）。
    expect(
      src,
      '界面那份数组不是来自物化读 `actions.listHabits()`',
    ).toMatch(/const aliveHabits = actions\.listHabits\(\);[\s\S]{0,120}setHabits\(aliveHabits\)/);
  });

  it('J6 🔴 全壳的新建调用点**恰好一枚**（第二份实现 = 两套裁决）', () => {
    const hits = mobileSources()
      .filter((rel) => stripComments(read(rel)).includes('.createHabit('))
      .map((rel) => rel);
    expect(hits, `调用点不是恰好一枚：${hits.join(' , ')}`).toEqual([SCREEN]);
  });

  it('J7 新建入口的三个文案全走词条（界面里不许有硬编码中文）', () => {
    // 反面判据先有阳性对照：这条线上确实有中文，但只许出现在注释里 —— 注释已被剥掉，
    // 所以下面这三条字面量**任何一个出现**都是回归。
    for (const literal of ["'新建习惯'", "'新习惯名称'", "'习惯名称'"]) {
      expect(src, `硬编码文案进了界面：${literal}`).not.toContain(literal);
    }
    // 正面：用的就是 web 那同一批键（端间同词，不是各起一套）。
    expect(src, '没复用 web.habits.add* 那批键').toContain("t('web.habits.addLabel')");
    expect(src).toContain("t('web.habits.addPlaceholder')");
    expect(src).toContain("t('web.habits.add')");
  });
});
