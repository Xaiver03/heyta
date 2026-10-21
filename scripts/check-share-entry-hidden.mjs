#!/usr/bin/env node
/**
 * 门禁：共享清单入口在**默认态下不可达**（产品裁决 P-1）
 * ======================================================
 *
 * ## 它钉的判断
 *
 * `docs/plans/collaboration-shared-lists.md` §9.2 P-1：共享清单的元数据面（邀请 / 角色 /
 * 转让）今天全链都在，**内容面整段断** —— `downloadOps` 零消费者、任务与清单的写路径仍进
 * 个人 op-log，所以两个成员互相看不到对方的改动。入口因此从"看起来可用"降级成
 * **"默认不放出来 + 一条措辞明确的实验开关"**。
 *
 * 🔴 这条降级是一个**产品判断**，不是一个代码风格。而产品判断最容易被"顺手改亮"：
 * 下一个人看见 `&& shareExperimental` 挡在他的功能上，第一反应是删掉它让按钮出来。
 * 所以这里钉四格，缺一格就红：
 *
 * | 格 | 判据 | 红形 |
 * |---|---|---|
 * | 1 | 默认值是关 | 有人把 `DEFAULT_ENABLED` 翻成 `true` |
 * | 2 | 页头那枚入口的**渲染条件里必须出现开关** | 有人把第三道条件从 `&&` 里摘掉 |
 * | 3 | 开关在设置里存在，且 App 真的接了它的状态与回调 | 有人留了一枚不接线的开关（点了没反应） |
 * | 4 | 那句说明仍然写着"看不到彼此改动" + "只在这台设备" | 有人把缺陷披露精简成"启用共享清单" |
 *
 * ## 为什么是**源码层**，行为层不是已经有测试了吗
 *
 * `apps/web/tests/share-entry-experimental.spec.tsx` 钉的是"同样的前置下入口不出现"，
 * `e2e/tests/collab-journey.spec.ts` 钉的是真浏览器里那条路径。两者都能被**删测试**绕过，
 * 而这一道门禁读的是源码形状 —— 它和测试一起构成"改坏要付两次代价"。
 *
 * ## 🔴 翻案条件（撤掉隐藏时该改哪里）
 *
 * M1（下行链路接通）+ M2（写路径路由）落地，且两台独立浏览器上下文互相看得到对方的改动
 * 验过 ⇒ 把 `DEFAULT_ENABLED` 翻成 `true`，**同时**把本文件改成钉"可达"：
 * 判据 1 换成断言默认为真、判据 2 换成断言入口不再受开关约束、判据 3/4 随开关一起退场。
 * ⚠️ 不要一删了之 —— 删掉门禁等于把这条判断的**记录**也删了。
 */

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HEYTA_CHECK_ROOT ?? process.cwd();

const LIB = 'apps/web/src/lib/share-experimental.ts';
const APP = 'apps/web/src/App.tsx';
const PANEL = 'apps/web/src/features/sync/SyncSettingsPanel.tsx';
const ZH = 'packages/i18n/src/locales/zh-CN.ts';

/** 页头入口与设置里那枚开关的可寻址锚点。 */
const ENTRY_TESTID = 'share-open-button';
const TOGGLE_TESTID = 'share-experimental-toggle';

/**
 * 去掉注释，只留代码（行数不变）。
 *
 * 🔴 为什么必须先去掉：App.tsx 里挡在入口**正上方**的那段块注释**逐字提到了
 * `shareExperimental`**（它解释的就是这道条件为什么在）。如果判据 2 在原始文本上搜
 * "开关名出现在入口附近"，那么把条件删掉、注释留着 —— 门禁照样报绿。
 * **一条对着注释变绿的门禁，比没有门禁更糟**（它会把"已经检查过了"这个假信心发给下一个人）。
 *
 * ⚠️ 两种记号都要**认得 URL**，本文件在这上面连栽两次，症状都是"判据 4 报词条不存在"
 * （阳性对照红），而不是判据失灵本身：
 *   1. 先按行、后按块地处理 ⇒ 一行 `//` 注释里写着 `packages/i18n/dist/**`，
 *      那个 `/*` 被当成"开了个块注释"；
 *   2. 只挡 `:` 还不够 ⇒ 文案里的 `` `https://*.example.com` `` 是 `:` `/` `/` `*`，
 *      第一个 `/`（前面是 `:`）跳过了，**第二个 `/` 前面还是 `/`**，于是照样开块、
 *      一路吞到下一个闭记号，那一行之后的整个文件都不再被看见。
 * ⇒ 状态机一次左到右扫描（行注释里不再看任何记号），且 `/*` 必须**前面不是 `:` 也不是 `/`**。
 *
 * **一条对着注释失灵的门禁，比没有门禁更糟** —— 它会把"已经检查过了"这个假信心发给下一个人。
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

/* ── 格 1：默认值是关 ─────────────────────────────────────────────── */
const lib = read(LIB);
if (lib === null) {
  problems.push([
    'default-on',
    `${LIB} 不见了 —— 共享入口的默认值现在住在哪？P-1 那条判断需要一个能寻址的家。`,
  ]);
} else if (!/const\s+DEFAULT_ENABLED\s*=\s*false\s*;/.test(lib)) {
  problems.push([
    'default-on',
    `${LIB} 里找不到 \`const DEFAULT_ENABLED = false;\` —— 默认值被改了。` +
      ' 入口默认放出来就是拿用户的信任测进度（内容面还没接通），翻案要按本文件头那三格判据走。',
  ]);
}

/* ── 格 2：入口的渲染条件里必须出现开关 ────────────────────────────── */
const app = read(APP);
if (app === null) {
  problems.push(['unguarded-entry', `${APP} 读不到，无法确认共享入口是否仍受开关约束。`]);
} else {
  const entryIdx = app.indexOf(`"${ENTRY_TESTID}"`);
  if (entryIdx === -1) {
    // 入口整个不存在 = 比"默认关"更隐藏，本身不违 P-1；但如果开关还在，那就是枚**指向空处的开关**。
    if (app.includes('shareExperimental')) {
      problems.push([
        'switch-points-nowhere',
        `设置里还有实验开关（App 里出现 shareExperimental），但页头入口 ${ENTRY_TESTID} 已经不在 —— ` +
          '用户在打开一枚什么都不放出来的开关。要么把入口接回来，要么连开关一起撤。',
      ]);
    }
  } else {
    const windowStart = Math.max(0, entryIdx - 1500);
    const before = app.slice(windowStart, entryIdx);
    const condOpen = before.lastIndexOf('? (');
    if (condOpen === -1) {
      problems.push([
        'unguarded-entry',
        `找不到 ${ENTRY_TESTID} 所属的那段条件渲染（入口附近没有 \`? (\`）—— ` +
          '入口现在是无条件渲染的，P-1 的"默认不可达"没了。',
      ]);
    } else {
      const brace = before.lastIndexOf('{', condOpen);
      const condition = brace === -1 ? '' : before.slice(brace + 1, condOpen);
      if (!/shareExperimental/.test(condition)) {
        problems.push([
          'unguarded-entry',
          `入口 ${ENTRY_TESTID} 的渲染条件是 \`${condition.trim().replace(/\s+/g, ' ')}\`，` +
            '里面没有 shareExperimental —— 这道条件不再受实验开关约束，等于把入口默认放出来。',
        ]);
      }
    }
  }

  /* ── 格 3：开关在设置里存在，且 App 真的接线了 ─────────────────── */
  const panel = read(PANEL);
  if (panel === null || !panel.includes(`"${TOGGLE_TESTID}"`)) {
    problems.push([
      'switch-not-wired',
      `${PANEL} 里没有 data-testid="${TOGGLE_TESTID}" —— 入口默认隐藏了，可用户没有任何一条**明确措辞**的路能放出它，` +
        'P-1 的降级就变成了彻底砍掉功能。',
    ]);
  }
  if (!app.includes('shareExperimental={') || !app.includes('onToggleShareExperimental={')) {
    problems.push([
      'switch-not-wired',
      `${APP} 没把开关的状态与回调传给 SyncSettingsPanel（要同时出现 shareExperimental={ 与 onToggleShareExperimental={）` +
        ' —— 设置里那枚复选框是一枚**没人读的开关**，勾了不会放出入口。',
    ]);
  }
}

/* ── 格 4：措辞必须还在披露缺陷 ───────────────────────────────────── */
const zh = read(ZH);
if (zh === null) {
  problems.push(['copy-without-disclosure', `${ZH} 读不到，无法确认那枚开关的措辞。`]);
} else {
  const keyIdx = zh.indexOf("'web.share.experimental.note'");
  const end = keyIdx === -1 ? -1 : zh.indexOf("',", keyIdx);
  const note = keyIdx === -1 || end === -1 ? null : zh.slice(keyIdx, end);
  if (note === null) {
    problems.push([
      'copy-without-disclosure',
      `${ZH} 里没有 web.share.experimental.note 这条词条 —— 开关只剩一个动词。`,
    ]);
  } else if (!/看不到/.test(note) || !/这台设备/.test(note)) {
    problems.push([
      'copy-without-disclosure',
      '开关那句说明必须同时说清两件事：**成员之间还看不到彼此的改动**（今天缺的是哪一半）' +
        '与**只在这台设备上放出入口**（他手机上的不是同一件事）。现在的措辞：' +
        note.replace(/^.*?:\s*/, '').slice(0, 80),
    ]);
  }
}

/* ── 自检：每臂都必须红，另有一条阳性对照（合规副本 ⇒ 一个字都不报） ──
 *
 * 🔴 为什么门禁自带臂：这道尺量的是**源码形状**，而形状判据最典型的坏法是"永远报绿"
 * （搜错了文件、被注释喂饱、条件窗口取窄了）。不注入病灶就没人知道它到底在不在看。
 * 每臂改的都是**临时副本**（`HEYTA_CHECK_ROOT` 指过去），工作树零改动。
 */
const MUTATIONS = {
  'default-on': (files) => {
    files[LIB] = files[LIB].replace('const DEFAULT_ENABLED = false;', 'const DEFAULT_ENABLED = true;');
  },
  'unguarded-entry': (files) => {
    files[APP] = files[APP].replace(
      'currentProject !== undefined && syncConfigured && shareExperimental',
      'currentProject !== undefined && syncConfigured',
    );
  },
  'switch-not-wired': (files) => {
    files[APP] = files[APP].replace('onToggleShareExperimental={onToggleShareExperimental}', '');
  },
  'copy-without-disclosure': (files) => {
    // 形状宽容：`check:ui-language` 要求词条**一行一条**，所以这里不能把换行写进正则。
    files[ZH] = files[ZH].replace(
      /('web\.share\.experimental\.note':\s*)'[^']*'/,
      "$1'启用共享清单功能。'",
    );
  },
  'switch-points-nowhere': (files) => {
    // 入口整段被删，而开关留着 —— 那一枚复选框从此什么都不放。
    files[APP] = files[APP].replace(`"${ENTRY_TESTID}"`, '"something-else"');
  },
};

const ARMS = [
  ['A 默认值翻成开 ⇒ 红并点名 default-on', 'default-on'],
  ['B 从入口条件里摘掉开关 ⇒ 红并点名 unguarded-entry', 'unguarded-entry'],
  ['C 撤掉 App 的回调接线 ⇒ 红并点名 switch-not-wired', 'switch-not-wired'],
  ['D 把缺陷披露精简成"启用共享清单功能" ⇒ 红并点名 copy-without-disclosure', 'copy-without-disclosure'],
  ['E 入口没了而开关还留着 ⇒ 红并点名 switch-points-nowhere', 'switch-points-nowhere'],
];

/** 门禁的每条问题都以 `问题码：` 开头 —— 臂就按这个前缀对账，换文案不用改臂。 */
function fixtureRoot(apply) {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-share-entry-'));
  const files = {};
  for (const rel of [LIB, APP, PANEL, ZH]) {
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
      console.log('✅ 阳性对照：现状（默认关 + 入口受开关约束 + 开关已接线 + 措辞在披露）⇒ 零报红');
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
  console.error('❌ 共享清单入口的"默认不可达"（P-1）被破坏了：\n');
  for (const [code, text] of problems) console.error(`   ${code}：${text}\n`);
  console.error(
    '   判据与翻案条件见 scripts/check-share-entry-hidden.mjs 文件头与\n' +
      '   docs/plans/collaboration-shared-lists.md §9.2 P-1。',
  );
  process.exit(1);
}

console.log(
  `✅ 共享入口默认不可达：默认为关 / 入口受 ${ENTRY_TESTID} 那条件里的开关约束 / ` +
    `设置里有已接线的 ${TOGGLE_TESTID} / 措辞仍在披露缺陷（4 格）`,
);
