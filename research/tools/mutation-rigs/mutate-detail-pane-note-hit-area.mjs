#!/usr/bin/env node
/**
 * 便签行"整行可点"（工单 §8.151 / 待办 #51）的变异臂。
 *
 * 它守的是**命中面积**这一档：`packages/ui/src/notes/NotesBoard.tsx` 里那只入口
 * 必须撑满整行（除尾部动作那一列），而"今天"徽标必须在它**里面**。
 * 两臂各对应一种坏，且都是**只有真浏览器看得见**的坏 —— jsdom 那十条落点判据
 * （`apps/web/tests/note-editor-placement.spec.tsx`）一条都不会红，因为它不跑布局。
 *
 *   H1 去掉 `alignSelf:'stretch'` ⇒ 入口缩回摘要那一段的高度 ⇒ 上下那一圈空白点不到（N6）
 *   H2 把徽标挪回入口**外面** ⇒ 徽标那一段落在可点区域之外（点它 = 点空白）（N6）
 *   H3 动作列 `marginLeft:-120` ⇒ 它与撑大的入口盒子相交（N7，§8.153）
 *   H4 钉选那颗顺带 `onEdit?.()` ⇒ 点它是"打开编辑层"而不是"钉这一条"（N7）
 *   H5 删除那颗的 `onPress` 清空 ⇒ 它画在那儿但什么都不做（N7）
 *
 * 🔴 **这一台必须先重打 `packages/ui` 的 dist 再打 `apps/web`**。
 *   载体是 `vite preview` + `apps/web/dist`，而 vite 打进去的是 **`packages/ui/dist`**，
 *   不是 `packages/ui/src`。第一趟（手工跑的，没进这台臂台）我只重打了 `apps/web` ⇒
 *   **两臂都存活**，读数长得像"这两条判据没有牙"，实际是变异根本没进产物（§7 第 27 条那一族）。
 *   判据的载体决定变异必须落在哪一层 —— 这一台的 `build()` 里有两道，缺一道就是假读数。
 *
 * 跑法（仓库根）：
 *   node research/tools/mutation-rigs/mutate-detail-pane-note-hit-area.mjs          # 全部臂（臂数由它自己打印）
 *   node research/tools/mutation-rigs/mutate-detail-pane-note-hit-area.mjs H1       # 点名一臂
 * ⚠️ 占 4371 端口、起 Chromium、**原地改工作树里的 NotesBoard.tsx**（收尾复原并核对 md5）。
 * ⚠️ 臂 id 只在本台内唯一（本台 = H1/H2）。id 撞了不会报错，只会把两臂的预期红集混成一团。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SRC = 'packages/ui/src/notes/NotesBoard.tsx';
const JSDOM_SPEC = 'tests/note-editor-placement.spec.tsx';
const E2E_SPEC = 'tests/detail-pane-note-editor.spec.ts';
const WEB_BIN = (rel) => path.join(ROOT, 'apps/web', 'node_modules', '.bin', rel);
const UI_BIN = (rel) => path.join(ROOT, 'packages/ui', 'node_modules', '.bin', rel);

/**
 * 每臂 = 一组**逐字锚点**替换（任一锚点没命中即 PROBE_BROKEN，不许静默跳过）
 * + 该臂必须点名的红集（用例标题前缀 + 报错里的判据句子片段）。
 */
const ARMS = [
  {
    name: 'H1',
    label: '去掉撑满行高',
    title: 'N6',
    edits: [["      alignSelf: 'stretch',\n      justifyContent: 'center',", "      justifyContent: 'center',"]],
    expectE2e: ['入口没撑满行高'],
  },
  {
    name: 'H2',
    label: '徽标挪回入口外面',
    title: 'N6',
    edits: [
      [
        "                    testID={`note-edit-${row.id}`}\n                  >\n                    {excerptText}\n                    {badgeNode}\n                  </Pressable>",
        "                    testID={`note-edit-${row.id}`}\n                  >\n                    {excerptText}\n                  </Pressable>",
      ],
      [
        "                  </Pressable>\n                )}",
        "                  </Pressable>\n                )}\n                {onEdit === undefined ? null : badgeNode}",
      ],
    ],
    expectE2e: ['「今天」徽标不在入口里面'],
  },
  {
    name: 'H3',
    label: '动作列整体压进入口的盒子里',
    title: 'N7',
    edits: [["    actions: {\n      flexDirection: 'row',", "    actions: {\n      marginLeft: -120,\n      flexDirection: 'row',"]],
    expectE2e: ['入口与钉选那颗的盒子相交'],
  },
  {
    name: 'H4',
    label: '钉选那颗顺带打开编辑层',
    title: 'N7',
    edits: [
      [
        "onPress={() => {\n                      onTogglePinned(row.id, !row.isPinned);",
        "onPress={() => {\n                      onEdit?.(row.id);\n                      onTogglePinned(row.id, !row.isPinned);",
      ],
    ],
    expectE2e: ['点钉选那颗顺带打开了编辑层'],
  },
  {
    name: 'H5',
    label: '删除那颗不做事',
    title: 'N7',
    edits: [
      [
        "onPress={() => {\n                      onRemove(row.id);\n                    }}",
        "onPress={() => {\n                      /* 变异：这一颗什么都不做 */\n                    }}",
      ],
    ],
    expectE2e: ['删除那一下没把那条删掉'],
  },
];

const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const arms = requested.length === 0 ? ARMS : ARMS.filter((a) => requested.includes(a.name));
if (arms.length === 0) {
  console.log(`VERDICT=PROBE_BROKEN 点名了 ${requested.join(',')}，本台只有 ${ARMS.map((a) => a.name).join('/')} —— 一枚都没匹配上`);
  process.exit(2);
}

const orig = readFileSync(path.join(ROOT, SRC), 'utf8');
const origMd5 = createHash('md5').update(orig).digest('hex');
const md5 = () => createHash('md5').update(readFileSync(path.join(ROOT, SRC))).digest('hex');

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, {
    cwd: path.join(ROOT, cwd),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 128 * 1024 * 1024,
  });
  return { rc: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
};

const tallyVitest = (out) => {
  const line = (out.match(/^[ \t]*Tests[ \t].*$/m) || [''])[0];
  return { line: line.trim(), passed: Number(/(\d+) passed/.exec(line)?.[1] ?? -1), failed: Number(/(\d+) failed/.exec(line)?.[1] ?? -1) };
};

const tallyPlaywright = (out) => {
  const grab = (word) => {
    const hits = [...out.matchAll(new RegExp(`^[ \\t]*(\\d+) ${word}(?:[ \\t(]|$)`, 'gm'))];
    return hits.length === 0 ? -1 : Number(hits[hits.length - 1][1]);
  };
  const passed = grab('passed');
  const failed = grab('failed');
  return { passed, failed, line: `passed=${String(passed)} failed=${String(failed)}` };
};

/** 🔴 两道构建，顺序不能反（ui 的 dist 是 web 的输入）。 */
const build = () => {
  const u = run(UI_BIN('tsup'), [], 'packages/ui');
  if (u.rc !== 0) return { rc: u.rc, out: `packages/ui tsup 失败：\n${u.out.slice(-1200)}` };
  const t = run(WEB_BIN('tsc'), ['-b'], 'apps/web');
  if (t.rc !== 0) return { rc: t.rc, out: `tsc -b 失败：\n${t.out.slice(-1200)}` };
  const v = run(WEB_BIN('vite'), ['build'], 'apps/web');
  return { rc: v.rc, out: v.out };
};

const jsdom = () => {
  const r = run(WEB_BIN('vitest'), ['run', JSDOM_SPEC], 'apps/web');
  return { ...tallyVitest(r.out), rc: r.rc, out: r.out };
};

/**
 * 🔴 每一趟 e2e 之前必须等 4371 **真的空下来**。
 * 实测形状（本台第一趟）：上一臂的 `vite preview` 在 Playwright 收尾时没有被立刻回收，
 * 下一趟的 webServer 报 `Port 4371 is already in use` 却**照常把用例跑完了** ——
 * 而它服务的是**上一臂那一份 dist**（vite preview 的静态清单在启动时快照）。
 * 于是"复原后复跑"读出来的是上一臂的坏：红的判据长得像 H2 的判据，实际是载体没换。
 * 这不是抖动，是**载体身份**问题 ⇒ 响亮地停，不重试成绿。
 */
const PORT = 4371;
const portBusy = () => run('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN'], '.').rc === 0;
const waitPortFree = (where) => {
  for (let i = 0; i < 40; i += 1) {
    if (!portBusy()) return;
    run('sleep', ['0.5'], '.');
  }
  fail(`${where}：${PORT} 端口在 20s 内没有释放 —— 上一趟的载体还活着，这一趟的读数会属于它`);
};

const e2e = () => {
  waitPortFree('e2e 起跑前');
  const r = run(
    path.join(ROOT, 'e2e', 'node_modules', '.bin', 'playwright'),
    ['test', '-c', 'playwright.detail-pane.config.ts', E2E_SPEC],
    'e2e',
  );
  const t = tallyPlaywright(r.out);
  // 端口冲突时 Playwright 会**照常报数**（见上面那段），所以红/绿都不算读数。
  if (/Port \d+ is already in use|already used/.test(r.out)) {
    fail(`e2e 那一趟的 webServer 没起来（端口被占），它打印的任何计数都不属于这一臂：\n${r.out.slice(-600)}`);
  }
  return { ...t, rc: r.rc, out: r.out };
};

const restore = () => writeFileSync(path.join(ROOT, SRC), orig);
const fail = (msg) => {
  restore();
  console.log(`VERDICT=PROBE_BROKEN ${msg}`);
  process.exit(2);
};

const apply = (arm) => {
  let text = orig;
  for (const [from, to] of arm.edits) {
    if (!text.includes(from)) return `锚点没命中：${JSON.stringify(from.slice(0, 60))}…`;
    text = text.replace(from, to);
  }
  writeFileSync(path.join(ROOT, SRC), text);
  return null;
};

// 基线：干净态两层都绿，否则臂台没有资格判红。
const b = build();
if (b.rc !== 0) fail(`干净态打不出包：\n${b.out.slice(-1200)}`);
const bj = jsdom();
if (bj.rc !== 0 || bj.passed < 10) fail(`干净态 jsdom 层不干净（要 >=10 passed）：${bj.line}`);
const be = e2e();
if (be.rc !== 0 || be.passed < 7 || be.failed > 0) fail(`干净态 e2e 层不干净（要 >=7 passed / 0 failed）：${be.line}`);
console.log(`基线：jsdom=${bj.line}｜e2e=${be.line}`);

let ok = 0;
for (const arm of arms) {
  const err = apply(arm);
  if (err !== null) fail(`${arm.name} ${err}`);
  if (md5() === origMd5) fail(`${arm.name} 注入没有落盘：源文件与干净态逐字节相同`);
  const mb = build();
  if (mb.rc !== 0) fail(`${arm.name} 变异态打不出包（注入不该导致构建失败）：\n${mb.out.slice(-800)}`);

  const mj = jsdom();
  const me = e2e();
  const blind = mj.failed <= 0 && mj.passed === bj.passed;
  const redTitles = [
    ...new Set([...me.out.matchAll(/✘[^\n]*?›\s*(N\d[^\n]*?)\s*$/gm)].map((m) => (m[1] ?? '').trim().slice(0, 46))),
  ];
  const hit = arm.expectE2e.every((frag) => me.out.includes(frag));
  const teeth = me.rc !== 0 && me.failed >= 1 && redTitles.some((t) => t.startsWith(arm.title)) && hit;
  console.log(
    `${arm.name} ${arm.label}：jsdom=${mj.line}（盲区腿=${blind ? '成立' : '不成立'}）｜e2e=${me.line} 红集=${redTitles.join(' ｜ ') || '(解析不出标题)'}｜有牙腿=${teeth ? '成立' : '不成立'}`
  );
  if (blind && teeth) ok += 1;

  restore();
  if (md5() !== origMd5) fail(`${arm.name} 复原失败：md5 与基线不同，必须手工核对`);
  const rb = build();
  if (rb.rc !== 0) fail(`复原后打不出包：\n${rb.out.slice(-800)}`);
}

const rj = jsdom();
const re = e2e();
console.log(`复原：BACK_TO_CLEAN=true 复跑 jsdom=${rj.line}｜e2e=${re.line}`);
if (rj.rc !== 0 || re.rc !== 0) fail(`复原后复跑不绿：jsdom rc=${rj.rc} e2e rc=${re.rc}`);
console.log(ok === arms.length ? `RIG_RESULT=${ok}/${arms.length}` : `RIG_RESULT=${ok}/${arms.length}（有臂没红 ⇒ 那一条判据没有牙）`);
process.exit(ok === arms.length ? 0 : 1);
