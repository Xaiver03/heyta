#!/usr/bin/env node
/**
 * 门禁：共享清单入口在**默认态可达**（产品裁决 P-1 已于 2026-10-21 立、2026-10-23 翻案）
 * ============================================================================
 *
 * ## 它钉的判断
 *
 * `docs/plans/collaboration-shared-lists.md` §9.2 P-1 当年把入口按在实验开关后面，理由是
 * "内容面到不了用户眼前"。那句理由的前提已经在 M2 之后**不再成立**：
 * `verify:collab-journey` 的"两台真浏览器互见"那一格验过（owner 写的任务出现在 bob 那台、
 * 反向同一件事，读数见计划 §9.11），而 P-1 自己写的翻案条件就是那一句。
 * ⇒ 开关与它的措辞一起退场，入口回到默认渲染。
 *
 * 🔴 **门禁跟着翻方向，不是删掉。** 旧那一版钉"默认不许出现"；如果只是把尺撤了，下一个
 * 人就能在没有任何东西拦的情况下把入口整块摘掉 —— 那同样是一格真坏（共享面板、邀请、
 * 成员管理全在，页面上却找不到门）。所以这里钉的是**反方向的四格 + 一道不许退回去的语义**：
 *
 * | 格 | 判据 | 红形（谁能把它改坏） |
 * |---|---|---|
 * | 1 | 页头那枚入口的渲染点在 | 有人整块摘掉入口，或又把它藏起来 |
 * | 2 | 入口的条件里**不许**再出现实验开关，源码里也不许再有那枚模块 | 有人把 `&& shareExperimental` 塞回去"先按住" |
 * | 3 | 设置 → 同步 里**不许**再有那枚"实验"复选框 | 入口不再读它而开关还画着 = 一枚什么都不放的复选框（旧格 3 反着钉的那一种） |
 * | 4 | 那句"成员之间还看不到彼此改动"的披露**不许**再出现 | 今天它是一句**对外谎报"这功能不能用"**的假话 |
 * | 5 | 入口的条件里必须仍然出现 `syncConfigured` | 有人为了"满足默认可达"把整条条件删了 ⇒ 未配置同步的屏上挂一枚点了必失败的按钮 |
 *
 * ## 为什么是**源码层**，行为层不是已经有测试了吗
 *
 * `apps/web/tests/share-entry-visible.spec.tsx` 钉的是渲染结果，
 * `e2e/tests/collab-journey.spec.ts` 钉的是真浏览器里那条路径。两者都能被**删测试**绕过，
 * 而这一道门禁读的是源码形状 —— 它和测试一起构成"改坏要付两次代价"。
 *
 * ## 历史（别一删了之）
 *
 * 本文件的前身是 `check-share-entry-hidden`（四格钉"默认不可达"，5 臂自检）。翻案时它的
 * 判据 1 换成"不许再有开关"、判据 2/3 反向、判据 4 从"必须披露缺陷"换成"缺陷已不存在，
 * 那句披露本身成了假话"。**记录留在计划 §9.2 与 §9.11**，本文件头是它的现行形状。
 */

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HEYTA_CHECK_ROOT ?? process.cwd();

const APP = 'apps/web/src/App.tsx';
const PANEL = 'apps/web/src/features/sync/SyncSettingsPanel.tsx';
const ZH = 'packages/i18n/src/locales/zh-CN.ts';

/** 页头入口与那枚已退场的开关的可寻址锚点。 */
const ENTRY_TESTID = 'share-open-button';
const STALE_TOGGLE_TESTID = 'share-experimental-toggle';

/**
 * 去掉注释，只留代码（行数不变）。
 *
 * 🔴 为什么必须先去掉：App.tsx 里入口**正上方**那段块注释历史上逐字提到过开关名。
 * 如果判据 2 在原始文本上搜"开关名出现在入口附近"，那么把条件删掉、注释留着 ——
 * 门禁照样报绿。**一条对着注释变绿的门禁，比没有门禁更糟**（它会把"已经检查过了"
 * 这个假信心发给下一个人）。
 *
 * ⚠️ 两种记号都要**认得 URL**，本文件在这上面连栽两次，症状都是"判据报词条不存在"
 * （阳性对照红），而不是判据失灵本身：
 *   1. 先按行、后按块地处理 ⇒ 一行 `//` 注释里写着 `packages/i18n/dist/**`，
 *      那个 `/*` 被当成"开了个块注释"；
 *   2. 只挡 `:` 还不够 ⇒ 文案里的 `` `https://*.example.com` `` 是 `:` `/` `/` `*`，
 *      第一个 `/`（前面是 `:`）跳过了，**第二个 `/` 前面还是 `/`**，于是照样开块、
 *      一路吞到下一个闭记号，那一行之后的整个文件都不再被看见。
 * ⇒ 状态机一次左到右扫描（行注释里不再看任何记号），且 `/*` 必须**前面不是 `:` 也不是 `/`**。
 */
function stripComments(src) {
  let out = '';
  let state = 'code';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const n = src[i + 1];
    const prev = src[i - 1];
    if (state === 'code') {
      if (c === '/' && n === '/' && prev !== ':') {
        state = 'line';
        i += 1;
        continue;
      }
      if (c === '/' && n === '*' && prev !== ':' && prev !== '/') {
        state = 'block';
        i += 1;
        continue;
      }
      out += c;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
      continue;
    }
    if (c === '*' && n === '/') {
      state = 'code';
      i += 1;
      continue;
    }
    // 块注释里的换行要留着：行数不变，报错时才指得回原文件。
    if (c === '\n') out += c;
  }
  return out;
}

const read = (rel) => {
  const path = join(ROOT, rel);
  if (!existsSync(path)) return null;
  return stripComments(readFileSync(path, 'utf8'));
};

const problems = [];

/* ── 格 1 + 格 2 + 格 5：入口在、不受开关约束、但仍要同步已配置 ─────── */
const app = read(APP);
if (app === null) {
  problems.push(['entry-missing', `${APP} 读不到，无法确认共享入口是否还在默认渲染。`]);
} else {
  const entryIdx = app.indexOf(`"${ENTRY_TESTID}"`);
  if (entryIdx === -1) {
    problems.push([
      'entry-missing',
      `页头已经没有 ${ENTRY_TESTID} 的渲染点 —— 内容面已经交付到界面（两台真浏览器互见验过），` +
        '把共享入口整块摘掉等于关掉一扇能用的门。要改这条判据请先在计划 §9.2 里翻 P-1 的翻案。',
    ]);
  } else {
    const windowStart = Math.max(0, entryIdx - 1500);
    const before = app.slice(windowStart, entryIdx);
    const condOpen = before.lastIndexOf('? (');
    if (condOpen === -1) {
      problems.push([
        'entry-unconditional',
        `找不到 ${ENTRY_TESTID} 所属的那段条件渲染（入口附近没有 \`? (\`）—— ` +
          '入口变成无条件渲染了：停在收集箱、或未配置同步的屏上都会挂出一枚点了必失败的按钮。',
      ]);
    } else {
      const brace = before.lastIndexOf('{', condOpen);
      const condition = brace === -1 ? '' : before.slice(brace + 1, condOpen);
      const flat = condition.trim().replace(/\s+/g, ' ');
      if (/shareExperimental|Experimental/.test(condition)) {
        problems.push([
          'entry-regated',
          `入口 ${ENTRY_TESTID} 的渲染条件是 \`${flat}\`，里面又出现了实验开关 —— ` +
            'P-1 那道降级已经在 2026-10-23 翻案（判据：`verify:collab-journey` 的两台互见那一格）。' +
            '要重新按住入口，请先在计划 §9.2 里把那次翻案推翻，而不是在这里加一个 `&&`。',
        ]);
      }
      if (!/syncConfigured/.test(condition)) {
        problems.push([
          'entry-unconditional',
          `入口 ${ENTRY_TESTID} 的渲染条件是 \`${flat}\`，里面没有 syncConfigured —— ` +
            '"默认可达"说的是不再要求实验开关，不是"未配置同步也挂出入口"。',
        ]);
      }
    }
  }

  /* ── 格 2 的另一半：那枚模块不许回来 ───────────────────────────── */
  if (/share-experimental/.test(app)) {
    problems.push([
      'entry-regated',
      `${APP} 的代码里又出现了 share-experimental —— 那枚设备本地开关随 P-1 一起退场了，` +
        '留着它就是"入口有时不出现"的第二个来源（而第二个来源永远不会有人去读那段注释）。',
    ]);
  }

  /* ── 格 3：设置里不许再留一枚什么都不放的复选框 ─────────────────── */
  const panel = read(PANEL);
  if (panel !== null && panel.includes(`"${STALE_TOGGLE_TESTID}"`)) {
    problems.push([
      'stale-toggle',
      `${PANEL} 里还有 data-testid="${STALE_TOGGLE_TESTID}" —— 入口已经不再读那枚开关，` +
        '它现在是一枚勾了什么都不放的复选框（这正是旧 P-1 门禁的格 3 反着钉的那一种坏法）。',
    ]);
  }
}

/* ── 格 4：那句缺陷披露本身现在是一句假话 ─────────────────────────── */
const zh = read(ZH);
if (zh === null) {
  problems.push(['stale-copy', `${ZH} 读不到，无法确认共享入口相关的措辞。`]);
} else if (/看不到彼此改动/.test(zh)) {
  problems.push([
    'stale-copy',
    `${ZH} 里还有"看不到彼此改动"那句 —— 它是 P-1 时期对**当时**的缺陷的披露。` +
      '今天两台真浏览器互见已经验过（计划 §9.11），这句话留着就是对外谎报"这功能不能用"。',
  ]);
}

/* ── 自检：每臂都必须红，另有一条阳性对照（合规副本 ⇒ 一个字都不报） ──
 *
 * 🔴 为什么门禁自带臂：这道尺量的是**源码形状**，而形状判据最典型的坏法是"永远报绿"
 * （搜错了文件、被注释喂饱、条件窗口取窄了）。不注入病灶就没人知道它到底在不在看。
 * 每臂改的都是**临时副本**（`HEYTA_CHECK_ROOT` 指过去），工作树零改动。
 */
const MUTATIONS = {
  'entry-missing': (files) => {
    files[APP] = files[APP].replace(`"${ENTRY_TESTID}"`, '"something-else"');
  },
  'entry-regated': (files) => {
    files[APP] = files[APP].replace(
      'currentProject !== undefined && syncConfigured ? (',
      'currentProject !== undefined && syncConfigured && shareExperimental ? (',
    );
  },
  'entry-unconditional': (files) => {
    files[APP] = files[APP].replace(
      'currentProject !== undefined && syncConfigured ? (',
      'true ? (',
    );
  },
  'stale-toggle': (files) => {
    files[PANEL] = files[PANEL].replace(
      'export function SyncSettingsPanel({',
      `const fixtureToggle = <input data-testid="${STALE_TOGGLE_TESTID}" />;\nexport function SyncSettingsPanel({`,
    );
  },
  'stale-copy': (files) => {
    files[ZH] = files[ZH].replace(
      "  'web.share.open.new':",
      "  'fixture.experimental.note': '成员之间还看不到彼此改动',\n  'web.share.open.new':",
    );
  },
};

const ARMS = [
  ['A 入口整块摘掉 ⇒ 红并点名 entry-missing', 'entry-missing'],
  ['B 把实验开关塞回入口的条件里 ⇒ 红并点名 entry-regated', 'entry-regated'],
  ['C 为了"可达"把整条条件删成无条件渲染 ⇒ 红并点名 entry-unconditional', 'entry-unconditional'],
  ['D 设置里留着那枚复选框 ⇒ 红并点名 stale-toggle', 'stale-toggle'],
  ['E 词条里留着"看不到彼此改动" ⇒ 红并点名 stale-copy', 'stale-copy'],
];

/** 门禁的每条问题都以 `问题码：` 开头 —— 臂就按这个前缀对账，换文案不用改臂。 */
function fixtureRoot(apply) {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-share-entry-'));
  const files = {};
  for (const rel of [APP, PANEL, ZH]) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) throw new Error(`夹具缺文件：${rel}`);
    files[rel] = readFileSync(abs, 'utf8');
  }
  if (apply) apply(files);
  for (const rel of Object.keys(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, files[rel]);
  }
  return dir;
}

function runGate(root) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, HEYTA_CHECK_ROOT: root },
    encoding: 'utf8',
  });
  return (r.stdout ?? '') + (r.stderr ?? '');
}

function selfTest() {
  let failures = 0;
  const clean = fixtureRoot(null);
  try {
    const out = runGate(clean);
    if (out.includes('❌')) {
      console.log(`❌ 阳性对照失败：合规现状被报红\n${out.slice(0, 240)}`);
      failures += 1;
    } else {
      console.log('✅ 阳性对照：现状（入口在且不受开关约束 + 条件仍要 syncConfigured + 无残留开关 + 无旧披露）⇒ 零报红');
    }
  } finally {
    rmSync(clean, { recursive: true, force: true });
  }

  for (const [label, code] of ARMS) {
    const mutate = MUTATIONS[code];
    let dir;
    let out = '';
    let mutationApplied = false;
    try {
      dir = fixtureRoot((files) => {
        const before = JSON.stringify(files);
        mutate(files);
        mutationApplied = JSON.stringify(files) !== before;
      });
      if (!mutationApplied) {
        console.log(`❌ 臂 ${label} —— 病灶没注进去（源码形状变了，臂要跟着改）`);
        failures += 1;
        continue;
      }
      out = runGate(dir);
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
    const hit = out.includes('❌') && out.includes(`${code}：`);
    console.log(`${hit ? '✅' : '❌'} 臂 ${label}${hit ? '' : ` —— 实际输出：${out.trim().slice(0, 200)}`}`);
    if (!hit) failures += 1;
  }
  console.log(`\n臂数 ${ARMS.length}（由本脚本自己打印），失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();

if (problems.length > 0) {
  console.error('❌ 共享清单入口的"默认态可达"被破坏了：\n');
  for (const [code, text] of problems) console.error(`   ${code}：${text}\n`);
  console.error(
    '   判据与 P-1 的翻案记录见 scripts/check-share-entry-visible.mjs 文件头与\n' +
      '   docs/plans/collaboration-shared-lists.md §9.2 / §9.11。',
  );
  process.exit(1);
}

console.log(
  `✅ 共享入口默认态可达：${ENTRY_TESTID} 在渲染点上 / 条件里没有实验开关且仍要求 syncConfigured / ` +
    `设置里没有残留的 ${STALE_TOGGLE_TESTID} / 词条里没有那句已过时的缺陷披露（4 格 5 判）`,
);
