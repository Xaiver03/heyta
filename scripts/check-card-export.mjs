#!/usr/bin/env node
/**
 * 成品图导出对账（倒数纪念日批次二 W7）
 * =====================================================================
 *
 * ## 为什么必须有这一条，而不是只靠 `apps/mobile/tests/card-export.spec.ts`
 *
 * 那条判据（21 项）测的是换算与接线的**取值**。它测不到两件只有从仓库外面才看得见的形状：
 *
 *   1. **`@heyta/ui/node` 这条边界是不是还成立**。
 *      主入口 `@heyta/ui` 的 `theme.tsx` 在运行时 import `react-native`，
 *      所以任何"顺手把带 RN 的文件加进 `node.ts`"的改动，都会让**移动端整个测试套**
 *      变成 `RolldownError: Flow is not supported`（本轮实测就是这个错），
 *      而报红的地方离根因很远。A1 直接在 node 里 import 一次它。
 *   2. **版面有没有长出第二份**。
 *      三端各画一次版面是本单最大的风险（它的表现是"屏幕上好看、导出的图错位"，
 *      只有人眼看得出）。A2 数的是全仓的定义点，不是某一端的 import。
 *
 * ## 判据（四条，各自能红 —— 变异臂与读数写在
 * `docs/plans/countdown-w7-device-export.md` §6）
 *
 * · A1 `@heyta/ui/node` 在 node 里加载得了（不拖进 `react-native`）。
 * · A2 `buildCardExportLayout` 全仓**恰好一个**定义点，且在 `packages/ui`。
 * · A3 三端绘制器都 import 共享版面，且没有一个自己重定义了 `CardExportDrawOp`。
 * · A4 🔴 零网络是**扫出来**的：导出这条路上的每个文件（web / 共享 / 移动端 / 原生）
 *      一个网络调用都没有，而同一把尺子喂已知命中的样本必须数得出非零。
 *
 * ⚠️ A4 的取样是**逐个点名**的，不是目录枚举 —— 目录里混着别人的文件，
 * 而"少扫一个文件"在这条判据上等于漏一个出网点。新增了导出相关的文件
 * 而不登记进来，本条不会自动变宽，这是刻意的（它逼人来加）。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const lines = [];
const say = (text) => lines.push(text);
let failed = 0;
const fail = (text) => {
  failed += 1;
  say(`   ❌ ${text}`);
};
const pass = (text) => say(`   ✅ ${text}`);

/** 剥掉块注释与行注释：把一行调用注释掉来糊过判据，是本仓记过的第一种假绿。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/[^\n]*/gmu, '$1');
}

const codeOf = (relPath) => {
  const abs = join(ROOT, relPath);
  return { abs, source: stripComments(readFileSync(abs, 'utf8')) };
};

// ─────────────────────────────────────────────────────────────────────
// 导出这条路上的文件清单（逐个点名）
// ─────────────────────────────────────────────────────────────────────
const SHARED_LAYOUT = 'packages/ui/src/countdown/card-export-layout.ts';
const SHARED_NODE_ENTRY = 'packages/ui/src/node.ts';
const WEB_PAINTER = 'apps/web/src/features/countdown/card-export.ts';
const WEB_HOST = 'apps/web/src/features/countdown/CountdownView.tsx';
const MOBILE_UNITS = 'apps/mobile/src/lib/card-export-units.ts';
const MOBILE_PAINTER = 'apps/mobile/src/lib/card-export.tsx';
const MOBILE_NATIVE_JS = 'apps/mobile/src/lib/card-export-native.ts';
const MOBILE_HOST = 'apps/mobile/src/screens/CountdownScreen.tsx';
const ANDROID_MODULE =
  'apps/mobile/android/app/src/main/java/com/heytamobile/fs/CardExportModule.kt';
const IOS_MODULE = 'apps/mobile/ios/Heyta/HeytaCardExportModule.swift';

const EXPORT_PATH = [
  SHARED_LAYOUT,
  SHARED_NODE_ENTRY,
  WEB_PAINTER,
  WEB_HOST,
  MOBILE_UNITS,
  MOBILE_PAINTER,
  MOBILE_NATIVE_JS,
  MOBILE_HOST,
  ANDROID_MODULE,
  IOS_MODULE,
];

say('');
say('──────────────────────────────────────────────────────────────────────────────');
say('成品图导出对账（W7）');
say(`   ROOT = ${relative(process.cwd(), ROOT) || '.'}`);
say('──────────────────────────────────────────────────────────────────────────────');
say('');

// ── A1 ──────────────────────────────────────────────────────────────
say('【A1】`@heyta/ui/node` 这条 RN-free 边界还成立（在 node 里真 import 一次）');
say('');
{
  const cwd = join(ROOT, 'apps/mobile');
  let error = null;
  try {
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e', "import('@heyta/ui/node').then((m) => process.stdout.write(Object.keys(m).length > 0 ? 'LOADED' : 'EMPTY'));"],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    error = e;
  }
  if (error !== null) {
    const detail = String(error.stderr ?? error.message).split('\n').slice(0, 3).join(' / ');
    fail(
      '`@heyta/ui/node` 在 node 里加载不了 —— 这条入口被人加了带 `react-native` 的文件。' +
        `症状：${detail}`,
    );
  } else {
    pass('加载成功：`node.ts` 里没有混进运行时依赖 `react-native` 的文件。');
    say(
      '   ℹ️  这条红过的形状：主入口的 `theme.tsx` import RN，node 里加载它得到 ' +
        '`RolldownError: Flow is not supported`，而报红的地方是**移动端整个测试套**。',
    );
  }
}
say('');

// ── A2 ──────────────────────────────────────────────────────────────
say('【A2】版面全仓**恰好一个**生产者（`buildCardExportLayout` 的定义点）');
say('');
{
  const skip = new Set(['node_modules', 'dist', 'build', '.git', 'Pods', 'ios-derive', 'tmp']);
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs);
      } else if (/\.(ts|tsx)$/u.test(name) && !name.endsWith('.d.ts')) {
        const source = stripComments(readFileSync(abs, 'utf8'));
        if (/^\s*(export )?function buildCardExportLayout/mu.test(source)) {
          hits.push(relative(ROOT, abs));
        }
      }
    }
  };
  for (const top of ['packages', 'apps', 'server', 'scripts']) {
    const abs = join(ROOT, top);
    try {
      walk(abs);
    } catch {
      /* 该目录不存在就跳过（不是失败：少一个顶层目录不等于版面有两份） */
    }
  }
  if (hits.length !== 1) {
    fail(
      `定义点应是 1 个，实测 ${String(hits.length)} 个：${JSON.stringify(hits)} —— ` +
        '版面写两遍 = 两张会漂移的图，而漂移只有人眼看得出',
    );
  } else if (!hits[0].startsWith('packages/ui/')) {
    fail(`唯一的生产者在 ${hits[0]}，不在 packages/ui —— 共享层被挪进了某个端`);
  } else {
    pass(`唯一生产者：${hits[0]}`);
  }
  // 阳性对照：抽取规则真抓得到东西（否则"只有一个"可能是"一个都没抓到"）。
  const { source: layoutSource } = codeOf(SHARED_LAYOUT);
  if (!/^\s*(export )?function buildCardExportLayout/mu.test(layoutSource)) {
    fail('阳性对照失败：抽取规则连版面文件本身都没抓到，上面那条"恰好一个"没有意义');
  }
}
say('');

// ── A3 ──────────────────────────────────────────────────────────────
say('【A3】各端只画不判：import 共享版面，且不自己重定义绘制指令的形状');
say('');
{
  const painters = [WEB_PAINTER, MOBILE_UNITS, MOBILE_PAINTER];
  for (const rel of painters) {
    const { source } = codeOf(rel);
    const importsShared = /from '@heyta\/ui(\/node)?'/u.test(source);
    if (!importsShared) {
      fail(`${rel} 没有 import 共享版面 —— 它要么在自算版面，要么根本没接线`);
      continue;
    }
    if (/interface CardExportDrawOp/u.test(source)) {
      fail(`${rel} 自己定义了 CardExportDrawOp（第二套版面形状）`);
      continue;
    }
    pass(`${rel}：import 共享版面，且未重定义绘制指令形状`);
  }
}
say('');

// ── A4 ──────────────────────────────────────────────────────────────
say('【A4】零网络：导出这一路上一个网络调用都没有（扫源码 + 阳性对照）');
say('');
{
  // 只匹配**调用形状**：文档里写"不 fetch 外链字体"是说明，不是调用。
  const network = /\bfetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|\.sendBeacon\s*\(|import\s*\(/u;
  const hitsOf = (source) => [...source.matchAll(new RegExp(network.source, 'gu'))].map((m) => m[0] ?? '');

  // 先自证尺子有牙：已知命中的样本必须数得出非零。
  const control = hitsOf("a = fetch('/x'); new XMLHttpRequest(); navigator.sendBeacon('/y', b);");
  if (control.length !== 3) {
    fail(`尺子自检失败：已知应有 3 条命中，实测 ${String(control.length)} —— 下面那些"零"都不算证据`);
  } else {
    pass(`尺子自检：同一条正则喂已知命中的样本数得出 ${String(control.length)} 条`);
  }

  for (const rel of EXPORT_PATH) {
    let source;
    try {
      source = codeOf(rel).source;
    } catch {
      fail(`${rel} 读不到 —— 清单里点名的文件不见了`);
      continue;
    }
    const hits = hitsOf(source);
    if (hits.length > 0) {
      fail(`${rel} 里出现了网络/动态加载调用：${JSON.stringify(hits)}`);
    }
  }
  say(`   ℹ️  逐个点名扫了 ${String(EXPORT_PATH.length)} 个文件（三端 + 共享 + 两侧原生）。`);
}
say('');

say('──────────────────────────────────────────────────────────────────────────────');
if (failed > 0) {
  say(`   判定：${String(failed)} 条红`);
  say('──────────────────────────────────────────────────────────────────────────────');
  say('');
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(1);
}
say('   ✅ 通过');
say('──────────────────────────────────────────────────────────────────────────────');
say('');
process.stdout.write(`${lines.join('\n')}\n`);
