#!/usr/bin/env node
/**
 * 习惯频次编辑器的判据臂台（工单 H5）。
 *
 * 要回答的问题只有一个：`apps/mobile/tests/habit-frequency-entry.spec.ts` 那 9 条与
 * `apps/web/tests/habit-frequency-editor.spec.tsx` 那 11 条是不是仪式？
 *
 * 五份坏，**两端同时注入**（频次编辑器有两份画法，只改一端的话"另一端没被同一份坏
 * 打红"会被读成"两端的判据是重复的"，而它其实只说明我只改了一半）：
 *
 *   A1 摘要口径回到宿主自己拼句子        ⇒ M2
 *   A2 分隔符在组件里 inline（第二份所有者）⇒ M3
 *   A3 两档的零件无条件渲染              ⇒ M4 + G11
 *   A4 `.catch` 接住却不显示             ⇒ M6 + G8
 *   A5 已经是"每天"时仍再发一条清除       ⇒ M5 + G4
 *
 * 🔴 期望红集是**逐臂点名**的，不是"有红就行"：少了 = 判据没牙，多了 = 这一臂同时
 *    打到了别的判据，那"这条臂证的是哪一档"就说不清了。
 *
 * ⚠️ 本臂台**不跑 e2e**：几何那一档（Q6）的牙在 `mutate-habits-two-column.mjs` 的
 *    N5 臂上（那一台已经有 `vite preview` 载体与端口等待）。这里跑 e2e 只会多占一次
 *    载体而不多给一条读数。
 * ⚠️ 它会原地改两份源文件，每臂收尾复原并核对 md5；vitest 被宿主内存护栏挡住时
 *    报 `PROBE_BROKEN` 并**不记成判据红**。
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-habit-frequency.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const MOBILE_SLOT = 'apps/mobile/src/ui/habit-frequency-slot.tsx';
const WEB_EDITOR = 'apps/web/src/features/habits/HabitFrequencyEditor.tsx';

const md5 = (s) => createHash('md5').update(s).digest('hex');

const runVitest = (cwd, bin, spec) => {
  const r = spawnSync(bin, ['run', spec], {
    cwd: path.join(ROOT, cwd),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 128 * 1024 * 1024,
    timeout: 900_000,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const line = (out.match(/^[ \t]*Tests[ \t].*$/m) || [''])[0].trim();
  return {
    rc: r.status ?? 1,
    line,
    passed: Number(/(\d+) passed/.exec(line)?.[1] ?? -1),
    failed: Number(/(\d+) failed/.exec(line)?.[1] ?? -1),
    out,
    bailed: /内存闸门拒绝启动/.test(out),
  };
};

/** 一次臂：两端各跑一份 spec，红集取**并集**（标题前缀 M* / G* 自带归属）。 */
const runBoth = () => {
  const m = runVitest(
    'apps/mobile',
    path.join(ROOT, 'apps/mobile', 'node_modules', '.bin', 'vitest'),
    'tests/habit-frequency-entry.spec.ts',
  );
  const w = runVitest(
    'apps/web',
    path.join(ROOT, 'apps/web', 'node_modules', '.bin', 'vitest'),
    'tests/habit-frequency-editor.spec.tsx',
  );
  const titles = [
    ...new Set([
      ...[...m.out.matchAll(/^[ \t]*×\s+(M\d)/gm)].map((x) => x[1]),
      ...[...w.out.matchAll(/^[ \t]*×\s+(G\d+)/gm)].map((x) => x[1]),
    ]),
  ];
  return { m, w, titles };
};

const ARMS = [
  {
    name: 'A1 摘要口径回到宿主自己拼（第二份「哪种频次说哪句话」）',
    edits: [
      {
        file: MOBILE_SLOT,
        from: `import { HABIT_WEEKDAY_MESSAGE_KEYS, habitFrequencySummaryKey } from '@heyta/ui';`,
        to: `import { HABIT_WEEKDAY_MESSAGE_KEYS } from '@heyta/ui';`,
      },
      {
        file: MOBILE_SLOT,
        from: `  const summaryKey = habitFrequencySummaryKey(frequency);`,
        to: `  // MUTATION-ARM A1（临时）：口径不再问共享层，宿主自己拼句子。
  const summaryKey = 'web.habits.freq.summary.daily' as const;`,
      },
    ],
    expectTitles: ['M2'],
  },
  {
    name: 'A2 列举分隔符在组件里 inline（第二份所有者）',
    edits: [
      {
        file: MOBILE_SLOT,
        from: `import { LIST_SEPARATOR } from '../lib/recurrence-display';`,
        to: `// MUTATION-ARM A2（临时）：不声明表、直接在用的地方写死标点。
const SEP: Record<string, string> = { 'zh-CN': '、', en: ', ' };`,
      },
      {
        file: MOBILE_SLOT,
        from: `.join(LIST_SEPARATOR[locale]),`,
        to: `.join(SEP[locale]),`,
      },
    ],
    expectTitles: ['M3'],
  },
  {
    name: 'A3 两档的零件无条件渲染（界面把不生效的规则一起摆出来）',
    edits: [
      {
        file: MOBILE_SLOT,
        from: `          {isWeekly ? (`,
        to: `          {true ? (`,
      },
      {
        file: WEB_EDITOR,
        from: `          {isWeekly ? (`,
        to: `          {true ? (`,
      },
    ],
    expectTitles: ['M4', 'G11'],
  },
  {
    name: 'A4 `.catch` 接住却不显示（失败与"点了没反应"是同一件事）',
    edits: [
      {
        file: MOBILE_SLOT,
        from: `    void onSet(next).catch(() => {
      setFailed(true);
    });`,
        to: `    // MUTATION-ARM A4（临时）：吞掉 reject。
    void onSet(next).catch(() => {});`,
      },
      {
        file: WEB_EDITOR,
        from: `    void onSet(next).catch(() => {
      setFailed(true);
    });`,
        to: `    void onSet(next).catch(() => {});`,
      },
    ],
    expectTitles: ['M6', 'G8'],
  },
  {
    name: 'A5 已经是「每天」时仍再发一条清除（把 null 写成 null 也是脏 op）',
    edits: [
      {
        file: MOBILE_SLOT,
        from: `              if (isDaily) return;`,
        to: `              // MUTATION-ARM A5（临时）：不做幂等判断。`,
      },
      {
        file: WEB_EDITOR,
        from: `                if (isDaily) return;`,
        to: `                // MUTATION-ARM A5（临时）：不做幂等判断。`,
      },
    ],
    expectTitles: ['M5', 'G4'],
  },
];

const FILES = [MOBILE_SLOT, WEB_EDITOR];
const originals = new Map(FILES.map((rel) => [rel, readFileSync(path.join(ROOT, rel), 'utf8')]));
const restoreAll = () => {
  for (const [rel, text] of originals) writeFileSync(path.join(ROOT, rel), text);
};

const fail = (msg) => {
  restoreAll();
  console.log(`RIG_RESULT=PROBE_BROKEN ${msg}`);
  process.exit(2);
};

/* ── 基线：两端都必须干净，否则臂台没有资格判红 ───────────────────── */
const b = runBoth();
if (b.m.bailed || b.w.bailed) {
  restoreAll();
  console.log('RIG_RESULT=PROBE_BROKEN 载体被宿主内存护栏挡住 —— 这一轮**没跑成**，不是判据红');
  process.exit(2);
}
if (b.m.rc !== 0 || b.m.failed > 0 || b.m.passed < 9) {
  fail(`干净态 mobile 层不干净（要 >=9 passed / 0 failed）：${b.m.line}\n尾巴：\n${b.m.out.slice(-1500)}`);
}
if (b.w.rc !== 0 || b.w.failed > 0 || b.w.passed < 11) {
  fail(`干净态 web 层不干净（要 >=11 passed / 0 failed）：${b.w.line}\n尾巴：\n${b.w.out.slice(-1500)}`);
}
console.log(`基线：mobile=${b.m.line}｜web=${b.w.line}`);

let ok = 0;
const bad = [];
for (const arm of ARMS) {
  /* 🔴 同一枚文件被一条臂改**两处**时，锚点必须在"已经落了前一处"的那份文本上数。
     原来这里每条 edit 都从 `originals` 起算、各自整写一次，于是**除最后一条外全部静默失效**：
     A1 的"删掉 import"被"改 summaryKey"那次写回覆盖，A2 的"import 换 SEP 表"被
     ".join(SEP)" 那次覆盖 —— 两臂跑出来"一条都没红"，读数长得像**判据没牙**，
     实际是**注入根本没进文件**（现量：手工落 A1 那两处之后 M2 立刻红）。
     这一族与 §7 第 273 条同向（变异要先过"到底进没进产物"那道前置），区别只是
     它坏在臂台自己身上、而且坏的方向是**诬陷判据**。 */
  const staged = new Map();
  for (const edit of arm.edits) {
    const text = staged.get(edit.file) ?? originals.get(edit.file);
    const hits = text.split(edit.from).length - 1;
    if (hits !== 1) {
      restoreAll();
      fail(`${arm.name}：锚点在 ${edit.file} 里命中 ${String(hits)} 次（必须恰好 1 次）—— 锚点漂了，注入会打空`);
    }
    staged.set(edit.file, text.replace(edit.from, edit.to));
  }
  // 全部锚点都验过之后再落盘（一半注入一半没注入会得出无法归因的读数）。
  for (const [rel, mutated] of staged) writeFileSync(path.join(ROOT, rel), mutated);
  // 落盘后**再核一次**：写进去的内容必须真的含每一份注入（打空在这里就报，不留给读数去猜）。
  for (const [rel, mutated] of staged) {
    if (readFileSync(path.join(ROOT, rel), 'utf8') !== mutated) {
      fail(`${arm.name}：${rel} 落盘后与注入文本不一致 —— 这一臂的读数不作数`);
    }
  }

  const m = runBoth();
  if (m.m.bailed || m.w.bailed) {
    restoreAll();
    console.log(
      `RIG_RESULT=PROBE_BROKEN ${arm.name}：变异态被内存护栏挡住 —— 这一臂**没跑成**，不记成判据红`,
    );
    process.exit(2);
  }
  const exact =
    m.titles.length === arm.expectTitles.length &&
    arm.expectTitles.every((t) => m.titles.includes(t));
  console.log(`── ${arm.name}`);
  console.log(`   ${m.m.line}｜${m.w.line}`);
  console.log(`   红集=${m.titles.join(' ｜ ') || '(解析不到标题)'}  期望=${arm.expectTitles.join(' ｜ ')} ⇒ ${exact ? '有牙' : '不干净'}`);
  if (exact) ok += 1;
  else bad.push(`${arm.name}（红集=${m.titles.join(',') || '空'}，期望=${arm.expectTitles.join(',')}）`);

  restoreAll();
  for (const [rel, text0] of originals) {
    if (md5(readFileSync(path.join(ROOT, rel), 'utf8')) !== md5(text0)) {
      fail(`${arm.name}：复原失败，${rel} 与基线 md5 不同，必须手工核对`);
    }
  }
}

const back = runBoth();
console.log(`复原：BACK_TO_CLEAN=true 复跑 mobile=${back.m.line}｜web=${back.w.line}`);
if (bad.length || back.m.rc !== 0 || back.w.rc !== 0) {
  console.log(
    `RIG_RESULT=FAIL 未如预期=${bad.join(' | ') || '(无)'} 复原复跑绿=${String(
      back.m.rc === 0 && back.w.rc === 0,
    )}`,
  );
  process.exit(1);
}
console.log(
  `RIG_RESULT=${String(ok)}/${String(ARMS.length)}（每臂都是：两端同时注入，红集逐条等于点名那几条）`,
);
