#!/usr/bin/env node
/**
 * 分层 + 增量门禁运行器
 * =====================
 *
 * 单一事实源仍是 `package.json` 的 `scripts.check`（全量 `pnpm check` 链）。本文件
 * **不新增、不删除门禁**，只把同一条链**按层 / 按受影响文件**切开，并把轻量静态门禁
 * **并发**跑（它们只读源码，互不依赖）——这是"快"的主要来源。
 *
 *   pnpm check        全量（含 e2e / 原生 / 桌面打包，慢）—— 预合并 / nightly / CI 全量
 *   check:ci          `check` 链里**除重型外**：build + typecheck + 全部静态 + `pnpm -r test`
 *   check:quick       只跑**轻量静态**（`node scripts/check-*.mjs` 源码扫描），并发、秒级；
 *                     `--base <ref>` 时按 `git diff` 受影响文件过滤
 *
 * 分类保守：拿不准的归重型（宁可夜里跑，不让日常卡）。判据自证：
 * `node scripts/check-tiers.mjs list` 打印每段分类；`check:gate-wiring` 仍盯全量
 * `scripts.check`，所以**每个门禁都还在链里**，本文件只是运行时筛选。
 */
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const CONCURRENCY = Math.max(2, Math.min(8, Math.floor((os.cpus?.().length ?? 4) / 2)));

/** 一段含这些记号 = 重型（浏览器 / 原生 / 桌面 / 网络 / 打包 / 起服务 / mutation 自检）。 */
const HEAVY_RE = new RegExp(
  [
    'e2e', 'playwright', 'screenshot:verify',
    'licenses', 'image-license', 'image-build-args',
    'macos-', 'windows-', 'linux-shell',
    'arkts', 'native-deps', 'ios-native-bridges', 'mobile-bundle',
    'apk-freshness', 'android-gradle', 'android-build', 'mobile-e2e', 'mobile-first-run', 'shell-erasure-parity',
    'reminder-permission', 'landing-e2e',
    'calendar-evidence-rigs', 'gate-ssh', 'selfhost-entry-command', 'check:downloads',
    'adaptive-cards', 'check:pwa', 'check:tokens', 'brand-assets',
    'verify:collab-keys', 'checkout-tier-gates', 'op-log-semantics', 'egress-wording',
    'ai-e2e',
    // 依赖构建产物 / 起 dev server 的：
    'web-migration', 'web-artifact', 'web-storage', 'shell-surfaces',
  ].join('|'),
  'i',
);

function classify(seg) {
  const s = seg.trim();
  if (s === 'pnpm -r test') return { tier: 'core', name: 'pnpm -r test', seg: s };
  if (s === 'pnpm typecheck') return { tier: 'core', name: 'pnpm typecheck', seg: s };
  if (s === 'pnpm build') return { tier: 'build', name: 'pnpm build', seg: s };
  const m = /pnpm\s+(check:[a-z0-9:_-]+|verify:[a-z0-9:_-]+|screenshot:verify)/i.exec(s);
  const name = m ? m[1] : s;
  if (HEAVY_RE.test(name)) return { tier: 'heavy', name, seg: s };
  return { tier: 'light', name, seg: s };
}

function chain() {
  const raw = pkg.scripts?.check;
  if (!raw) {
    console.error('🔴 package.json 没有 scripts.check —— 全量链不见了');
    process.exit(2);
  }
  return raw.split(' && ').map((seg) => ({ seg, ...classify(seg) }));
}

/** 轻量门禁的受影响作用域；null = 全局（quick 里总是跑，保守）。 */
function scopeOf(name) {
  const n = name;
  if (/(mobile|widget|android|ios-native|arkts|rn-aria|tap-target|first-run|bridge)/i.test(n)) return ['apps/mobile/'];
  if (/(server|migration|schema|session-revocation|credential-routes|safe-error|error-shape|backup-retention|server-env|token-minting|token-hashing|inbound-)/i.test(n))
    return ['server/', 'packages/shared-schema/'];
  if (/legal/.test(n)) return ['packages/legal/', 'docs/'];
  if (/(docs|md-tables|doc-|traps-index|adr-numbering)/.test(n)) return ['docs/', '*.md', 'AGENTS.md', 'CONTRIBUTING.md', 'README.md'];
  if (/(i18n|ui-language|egress-wording|copy-parity)/.test(n)) return ['packages/i18n/', 'apps/', 'packages/'];
  if (/(web|design|theme|spacing|screen-gutter|nav-chrome|title-collision|z-ladder|breakpoint|font-size|overlay|form-anatomy|focus|capture-shape|dirty-form|danger-confirm|undo-receipt|control-semantics|choice-surface|action-vs-choice|menu-keyboard|chip-typing|ux-coverage|settings|spinner|tip-adjacency|field-single-source|text-color|design-token|surface-budget|entry-table|persistence-keys|row-single-source|selection-single-source|l4|empty-state|state-tiers|detail-pane)/.test(n))
    return ['apps/web/', 'apps/landing/', 'packages/design-system/', 'packages/ui/', 'packages/app-host/'];
  return null;
}

function changedFiles(base) {
  const files = new Set();
  const run = (args) => {
    try {
      execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
        .split('\n').map((l) => l.trim()).filter(Boolean).forEach((f) => files.add(f));
    } catch { /* 无 base / 非 git → 由调用方退化 */ }
  };
  if (base) run(['diff', '--name-only', base]); else run(['diff', '--name-only', 'HEAD']);
  run(['diff', '--name-only', '--cached']);
  run(['ls-files', '--others', '--exclude-standard']);
  return [...files];
}

function affected(entry, files) {
  if (entry.tier !== 'light') return true;
  const scope = scopeOf(entry.name);
  if (scope === null) return true;
  return files.some((f) => scope.some((p) => (p.endsWith('*') ? f.endsWith(p.slice(1)) : f.startsWith(p))));
}

function runOne(e) {
  return new Promise((res) => {
    const p = spawn(e.seg, { cwd: ROOT, shell: true, env: process.env });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => res({ ...e, code: code ?? 1, out }));
  });
}

async function pool(entries) {
  const results = [];
  let idx = 0;
  const worker = async () => {
    while (idx < entries.length) {
      const e = entries[idx++];
      const r = await runOne(e);
      results.push(r);
      process.stdout.write(r.code === 0 ? '.' : 'X');
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  process.stdout.write('\n');
  return results;
}

function reportFailed(results) {
  const failed = results.filter((r) => r.code !== 0);
  if (!failed.length) return 0;
  console.error(`\n🔴 ${failed.length} 道红：`);
  for (const f of failed) {
    console.error(`\n===== ${f.name}（退出 ${f.code}）=====`);
    console.error(f.out.trim().split('\n').slice(-25).join('\n'));
  }
  return 1;
}

async function runList() {
  const items = chain();
  const by = { core: [], build: [], light: [], heavy: [] };
  items.forEach((e) => by[e.tier].push(e.name));
  console.log(`全量链 ${items.length} 段：core ${by.core.length} / build ${by.build.length} / light ${by.light.length} / heavy ${by.heavy.length}（并发 ${CONCURRENCY}）\n`);
  console.log('= 轻量（check:quick / check:ci）=');
  by.light.forEach((n) => console.log('  light  ', n));
  console.log('\n= 重型（仅 pnpm check 全量）=');
  by.heavy.forEach((n) => console.log('  heavy  ', n));
  return 0;
}

async function runQuick(argv) {
  const bi = argv.indexOf('--base');
  const base = bi >= 0 ? argv[bi + 1] : null;
  const files = changedFiles(base);
  const items = chain().filter((e) => e.tier === 'light');
  const todo = base === null && !argv.includes('--all') ? items : items.filter((e) => affected(e, files));
  console.log(`quick：${todo.length} 道轻量门禁${base ? `（受影响 ${files.length} 文件，base=${base}）` : '（无 base，跑全部轻量）'}`);
  const t0 = Date.now();
  const results = await pool(todo);
  const rc = reportFailed(results);
  console.log(`quick 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return rc;
}

async function runCi() {
  const items = chain();
  const t0 = Date.now();
  // 先串行 build（若有产物依赖检查，已在重型里；这里保证 web/dist 等就绪）
  for (const e of items.filter((x) => x.tier === 'build')) {
    process.stdout.write(`▶ ${e.seg} ... `);
    const r = await runOne(e);
    console.log(r.code === 0 ? 'ok' : 'FAILED');
    if (r.code !== 0) { console.error(r.out.slice(-1500)); return r.code; }
  }
  // 轻量静态并发跑
  const light = items.filter((x) => x.tier === 'light');
  console.log(`ci：${light.length} 道静态（并发 ${CONCURRENCY}）`);
  const results = await pool(light);
  let rc = reportFailed(results);
  // typecheck + 单测（core）串行
  for (const e of items.filter((x) => x.tier === 'core')) {
    process.stdout.write(`▶ ${e.seg} ... `);
    const r = await runOne(e);
    console.log(r.code === 0 ? 'ok' : 'FAILED');
    if (r.code !== 0 && rc === 0) { console.error(r.out.slice(-2000)); rc = r.code; }
  }
  console.log(`ci 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return rc;
}

const [, , cmd = 'list', ...rest] = process.argv;
if (cmd === 'list') process.exit(await runList());
if (cmd === 'full') { const r = spawn('pnpm', ['check'], { cwd: ROOT, stdio: 'inherit', shell: true }); r.on('close', (c) => process.exit(c ?? 1)); }
else if (cmd === 'quick') process.exit(await runQuick(rest));
else if (cmd === 'ci') process.exit(await runCi());
else { console.error(`未知层:${cmd}（ci / quick / list / full）`); process.exit(2); }
