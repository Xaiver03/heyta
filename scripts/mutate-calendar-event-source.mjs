#!/usr/bin/env node
/**
 * W6「EVENT 成为日历的第二个事件源」判据的变异验证
 * ==================================================
 *
 * 用法：`node scripts/mutate-calendar-event-source.mjs`（**串行**跑；一轮约 3–6 分钟）
 *
 * ## 为什么这一单特别需要它
 *
 * W6 的承诺只有一句话：**一条没有截止日的倒数日也能上日历**。
 * 这句话有三个可以各自坏掉的层，而每一层坏掉时界面的表现都恰好是"什么都没发生"：
 *
 *   · 共享模型把事件源接成了"有截止时间才显示" —— 格子照画任务，倒数日凭空消失；
 *   · 宿主没把数据喂进来（或喂了个空数组）—— 界面与"这台设备确实没有倒数日"逐像素相同
 *     （§7 第 195 条，`events` 是必填 prop，它只挡得住"根本没传"）；
 *   · 某一个面（侧栏 / 日档 / 年档 / 当天那个数字）没跟上 —— 同一屏两套口径。
 *
 * **没有一条会自己报错。** 所以每条变异都写明必须看到**哪几条具名用例**变红，
 * 抓错地方算漏（臂存活 = 那条承诺当下没有任何一层在守）。
 *
 * ## 判"抓到"的标准
 *
 * 整条套件红是不够的：一个改坏了共享板的变异会让每一格都红，那证明不了**具体哪条**判据在挡。
 * 每条臂的 `expect` 是用例标题里的**子串**，必须在红集合里逐条出现。
 *
 * ## 臂数别抄进任何文档
 *
 * 这套臂会随判据长。要读数看脚本自己打印的那一行（AGENTS §7 的"臂数由装置自己打印"）。
 *
 * ⚠️ 只碰列出的那几个文件的字节，每条臂跑完**立刻**按原文写回并校验 sha256。
 *    写回之前会再读一次：这期间若有别的进程改过它，就停下报错，
 *    而不是拿我这一轮的副本覆盖掉别人的编辑（共享工作树）。
 *    测试闸门（内存护栏）拒绝启动时**整轮判为没跑成**（退出码 2），
 *    绝不当成"臂存活"或"判据没牙"。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const UI_MODEL = join(ROOT, 'packages/ui/src/calendar/model.ts');
const UI_BOARD = join(ROOT, 'packages/ui/src/calendar/CalendarBoard.tsx');
const UI_DAY_BOARD = join(ROOT, 'packages/ui/src/calendar/CalendarDayBoard.tsx');
const UI_YEAR_BOARD = join(ROOT, 'packages/ui/src/calendar/CalendarYearBoard.tsx');
const WEB_VIEW = join(ROOT, 'apps/web/src/features/calendar/CalendarView.tsx');
const MOBILE_SCREEN = join(ROOT, 'apps/mobile/src/screens/CalendarScreen.tsx');

/** 三种载体：一条 jsdom 套件、一批 node 单测、一把常驻门禁。 */
const TARGETS = {
  'ui-model': {
    cwd: join(ROOT, 'packages/ui'),
    argv: ['npx', 'vitest', 'run', 'tests/calendar-cell-bars.spec.ts'],
    kind: 'vitest',
  },
  'web-source': {
    cwd: join(ROOT, 'apps/web'),
    argv: ['npx', 'vitest', 'run', 'tests/calendar-event-source.spec.tsx'],
    kind: 'vitest',
  },
  'web-year': {
    cwd: join(ROOT, 'apps/web'),
    argv: ['npx', 'vitest', 'run', 'tests/calendar-year-board.spec.tsx'],
    kind: 'vitest',
  },
  gate: {
    cwd: ROOT,
    argv: ['node', 'scripts/check-materialized-reads.mjs'],
    kind: 'gate',
  },
};

const MUTATIONS = [
  {
    name: 'M1 事件源接成"有截止时间才显示"（把 W6 的核心判据原样否掉）',
    file: UI_MODEL,
    from: '  for (const event of events) {\n    decorated.push({',
    to: '  for (const event of events.filter((e) => (e as { dueDate?: unknown }).dueDate !== undefined)) {\n    decorated.push({',
    target: 'ui-model',
    expect: ['只有倒数日、一条任务都没有的一天', '封顶把两个源一起算'],
  },
  {
    name: 'M2 一屏网格那段区间直接返回空（宿主喂了也没数）',
    file: UI_MODEL,
    from: '  return groupEventsByOccurrence(events, from, to);',
    to: '  return new Map();',
    target: 'web-source',
    expect: ['一条倒数日、零条任务', '同一条倒数日在**当天那块**'],
  },
  {
    name: 'M3 格子的状态色不认第二个源（条画了、点不画 = 同一屏两套口径）',
    file: UI_MODEL,
    from: "  if (tasks.length === 0 && events.length === 0) return 'plain';",
    to: "  if (tasks.length === 0) return 'plain';",
    target: 'ui-model',
    expect: ['这天只有倒数日：给 primary', '那天不给 danger'],
  },
  {
    name: 'M10 任务全做完就把这天读成"清空了"（倒数日被 subtle 那一档吞掉）',
    file: UI_MODEL,
    from: "  if (pending.length === 0) return events.length > 0 ? 'primary' : 'subtle';",
    to: "  if (pending.length === 0) return 'subtle';",
    target: 'ui-model',
    expect: ['任务全做完了但这天有倒数日'],
  },
  {
    name: 'M4 Web 宿主喂字面空数组（必填 prop 挡不住的那种"没接"）',
    file: WEB_VIEW,
    from: '          events={events}',
    to: '          events={[]}',
    target: 'gate',
    expect: ['字面空数组'],
  },
  {
    name: 'M5 移动端宿主不再读倒数日（`listEvents` 那一句被删）',
    file: MOBILE_SCREEN,
    from: '    setEvents(eventActions.listEvents(today));',
    to: '    setEvents([]);',
    target: 'gate',
    expect: ['没有读任何倒数日'],
  },
  {
    name: 'M6 移动端宿主读了却不喂（半条接线）',
    file: MOBILE_SCREEN,
    from: '        events={events}',
    to: '        ',
    target: 'gate',
    expect: ['没有把它作为'],
  },
  {
    name: 'M7 日档的"全天带"不画倒数日行（倒数日没有时刻，那一行是它唯一的家）',
    file: UI_DAY_BOARD,
    from: '<CalendarEventRowList events={dayEvents} testID={`${testID}-all-day-events`} />',
    to: '<CalendarEventRowList events={[]} testID={`${testID}-all-day-events`} />',
    target: 'web-source',
    expect: ['日档里它在**全天带**'],
  },
  {
    name: 'M8 年档那张缩略月历不认第二个源（12 张卡另一套数）',
    file: UI_YEAR_BOARD,
    from: 'calendarDayTone(dayTasks, dayEvents, today, date)',
    to: 'calendarDayTone(dayTasks, [], today, date)',
    target: 'web-year',
    expect: ['只有倒数日的那一天也画点'],
  },
  {
    name: 'M9 当天那个数字只数任务（格子里明明有一条，旁边写着 0）',
    file: UI_BOARD,
    from: '          {dayTasks.length + dayEvents.length}',
    to: '          {dayTasks.length}',
    target: 'web-source',
    expect: ['当天标题旁边那个数字'],
  },
];

/**
 * 🔴 变异落在 `packages/ui/**` 而载体是 **web 套件**时，必须先重建 `@heyta/ui`。
 *
 * 不是仪式，是这条链的真实形状：`apps/web` 的测试 `import { CalendarBoard } from '@heyta/ui'`，
 * 而那个 specifier 解析到的是 **`dist`**（`packages/ui/package.json` 的 exports）。
 * 不重建的话，注入的字节**根本不进被测载体** —— 那一臂会以"存活"收场，
 * 而它真正证明的只是我的探针没接到被改的那份代码上（§7 元规则 1：先怀疑探针）。
 * 载体是 `ui-model`（vitest 直接跑 `../src/calendar/model.js`）或静态门禁时不需要重建。
 */
function needsUiBuild(mutation) {
  return mutation.file.startsWith(join(ROOT, 'packages', 'ui')) && mutation.target.startsWith('web');
}

const target_kind = (mutation) => TARGETS[mutation.target].kind;

function buildUi() {
  const r = spawnSync('pnpm', ['--filter', '@heyta/ui', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 600_000,
  });
  if ((r.status ?? 1) !== 0) {
    console.error('❌ `@heyta/ui` 重建失败 —— 停在这里（继续跑只会得到读不出结论的臂）：\n');
    console.error(`${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-2000));
    process.exit(1);
  }
}

const digest = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** 载体是否被内存护栏挡在外面（那是环境，不是判据）。 */
const BAILED = /内存闸门拒绝启动/;

/** 跑一条臂的载体：返回退出码、红集合（具名用例标题）与原始输出。 */
function runTarget(key) {
  const target = TARGETS[key];
  const r = spawnSync(target.argv[0], target.argv.slice(1), {
    cwd: target.cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 900_000,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const reds =
    target.kind === 'vitest' ? [...out.matchAll(/^\s*[×x]\s+(.+?)\s+\d+(?:\.\d+)?ms\s*$/gm)].map((m) => m[1]) : [];
  return { code: r.status ?? 1, reds, out };
}

const files = [...new Set(MUTATIONS.map((m) => m.file))];
const originals = new Map(files.map((p) => [p, readFileSync(p, 'utf8')]));
const pristine = new Map(files.map((p) => [p, digest(p)]));

function restore(path, expectedMutatedDigest) {
  const now = digest(path);
  if (now !== expectedMutatedDigest) {
    console.error(
      `❌ ${path} 在这期间被**别的进程**改过（digest 与我写进去的那份不一致）。\n` +
        '   变异脚本停在这里，不覆盖那份编辑 —— 请确认没有并发写者后重跑。',
    );
    process.exit(1);
  }
  writeFileSync(path, originals.get(path));
  if (digest(path) !== pristine.get(path)) {
    console.error(`❌ 写回后 ${path} 的 digest 与起跑时不一致 —— 停在这里，别继续跑下一臂。`);
    process.exit(1);
  }
}

/** 阳性对照：不注入任何变异，载体必须是绿的（否则下面每一条"红"都可能是环境红）。 */
function control() {
  // 🔴 先按**当前源码**重建一次：对照组里那些 web 载体读的是 `dist`，
  //   拿一份过期的 `dist` 去对照，"绿"只证明旧产物是绿的（§7 第 27 条）。
  buildUi();
  const results = [];
  for (const key of Object.keys(TARGETS)) {
    const { code, out } = runTarget(key);
    if (BAILED.test(out)) {
      console.error(`❌ 对照组被内存护栏挡在外面（${key}）—— 这一轮**没跑成**，不是判据没牙。`);
      process.exit(2);
    }
    results.push({ key, code });
    console.log(`   对照 ${key}: exit ${code}`);
    if (code !== 0) {
      console.error(`❌ 对照组 ${key} 基线就是红的 —— 先修基线，再来问"变异能不能红"。`);
      process.exit(1);
    }
  }
}

const survived = [];
const bailed = [];

console.log(`变异验证：共 ${MUTATIONS.length} 臂（臂数由本脚本打印，别抄进文档）\n`);
console.log('── 阳性对照（不注入变异，载体必须全绿）─────────────────────────');
control();

for (const m of MUTATIONS) {
  const source = originals.get(m.file);
  const occurrences = source.split(m.from).length - 1;
  if (occurrences !== 1) {
    console.error(`❌ ${m.name}：目标字节在 ${m.file} 里出现 ${occurrences} 次（需要恰好 1 次）。`);
    process.exit(1);
  }
  const before = digest(m.file);
  writeFileSync(m.file, source.replace(m.from, m.to));
  const after = digest(m.file);
  if (needsUiBuild(m)) buildUi();

  const { code, reds, out } = runTarget(m.target);
  restore(m.file, after);
  if (before !== pristine.get(m.file)) {
    console.error(`❌ ${m.file} 起跑时的字节就与清单不符（有并发写者）。`);
    process.exit(1);
  }

  if (BAILED.test(out)) {
    bailed.push(m.name);
    console.log(`⏸  ${m.name}\n     载体被内存护栏挡在外面 —— 这一臂**没跑成**（不当成存活，也不当成抓到）。`);
    continue;
  }

  /*
    🔴 静态门禁没有"用例"，它的红写在**输出文本**里。
    第一版这里对所有载体都比 `reds`（只对 vitest 解析过），于是三条 gate 臂
    在载体**确实已经红**（exit 1）的情况下被记成"存活" —— 那是探针读错了自己的传感器，
    不是判据没牙。红集合按载体种类取。
  */
  const haystack = TARGETS[m.target].kind === 'vitest' ? reds : [out];
  const missing = m.expect.filter((needle) => !haystack.some((h) => h.includes(needle)));
  if (code === 0 || missing.length > 0) {
    survived.push({ name: m.name, missing, code, reds });
    console.log(`❌ 存活 ${m.name}`);
    console.log(`     载体 exit ${code}；没看到的具名判据：${missing.join(' / ') || '（无）'}`);
    if (target_kind(m) === 'vitest') {
      console.log(`     本轮实际红集合（${reds.length} 条）：\n       ${reds.join('\n       ') || '（空）'}`);
    } else {
      console.log(`     门禁输出尾部：\n${out.split('\n').slice(-12).join('\n')}`);
    }
  } else {
    console.log(`✅ 抓到 ${m.name}`);
    if (target_kind(m) === 'vitest') {
      console.log(`     红：${reds.filter((r) => m.expect.some((e) => r.includes(e))).join(' | ')}`);
    } else {
      console.log(`     门禁按具名判据报错：${m.expect.join(' / ')}`);
    }
  }
}

// 🔴 收尾必须按**已还原的源码**再重建一次：臂里那些 web 载体读的是 `dist`，
//    最后一臂留下的那份带变异的产物如果就这么躺在树里，下一轮验收（以及任何
//    真浏览器 / 打包）打的就是被改坏的字节 —— §7 第 27 条那个"APK 里是旧 bundle"的同族。
buildUi();

console.log('');
if (bailed.length > 0) {
  console.error(`⚠️  ${String(bailed.length)} 臂因内存护栏没跑成（等串行窗口重跑，别当成结论）：`);
  for (const n of bailed) console.error(`   · ${n}`);
}
if (survived.length > 0) {
  console.error(`\n❌ ${String(survived.length)} 臂存活 —— 那些承诺当下没有任何一层在守。`);
  process.exit(1);
}
if (bailed.length > 0) process.exit(2);
console.log(`✅ 全部 ${String(MUTATIONS.length)} 臂都被具名判据抓到。`);
