#!/usr/bin/env node
/**
 * `selfhost-watchleg-arms.mjs` —— 验 `selfhost-land-main.mjs --watch-leg` 那三臂**会**响。
 *
 * 为什么要有它：`--watch-leg` 是一条"看守有没有牙"的判据，而判据自己的牙只能靠变异回答
 * （AGENTS §7 元规则 2 / "不能失败的检查没有价值"）。三臂今天全绿只证明它们**兼容当前实现**，
 * 不证明它们认得出实现坏了。
 *
 * 全部改动发生在临时目录里的**拷贝**上，真工作树一个字节都不动；收尾那条对账不是仪式：
 * 🔴 它第一版把 git 的 cwd 写成 `…/research/tools/..`，而内核把 `x/y/..` 解析成 `x` ⇒
 *    git 在 `research/` 里跑，pathspec 变成 `research/research/tools/…` ⇒ **恒 0 条**，
 *    看着像"变异没污染真树"，其实那句根本没在看任何东西。现在锚在本文件自己的仓库根，
 *    并断言"恰好是本轮我自己改的那两枚"（少了=探针坏，多了=变异漏进真树，两种都红）。
 *
 * 用法：node research/tools/selfhost-watchleg-arms.mjs      # 约 30s，需要 /tmp/heyta-merge-carrier 在
 * 何时该重跑：改 `selfhost-kill-watchdog.mjs` 的归属判定 / `startWatch` 的定时器 /
 *            或 `--watch-leg` 三臂的任一条期望值之后。
 */
import { copyFileSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOLS = join(ROOT, 'research', 'tools');
const FILES = [
  'selfhost-land-main.mjs',
  'selfhost-kill-watchdog.mjs',
  'selfhost-kill-ports.mjs',
  'selfhost-deps-fresh.mjs',
];
const OWN_EDITS = [
  'research/tools/selfhost-kill-watchdog.mjs',
  'research/tools/selfhost-land-main.mjs',
].sort();
/** 载体目录：与 `--watch-leg` 默认同一个（判归属要用它，脚本不创建也不修改它）。 */
const CARRIER = process.env.HEYTA_CARRIER_WT ?? '/tmp/heyta-merge-carrier';

const arms = [
  {
    label: 'M1 tripReason 恒 null（看守永远不认定外来监听者）⇒ 只准 W2 红',
    file: 'selfhost-kill-watchdog.mjs',
    needle: 'export function tripReason(r, carrierDir) {',
    inject: 'export function tripReason(r, carrierDir) { return null; // MUT\n',
    expectRed: ['W2'],
  },
  {
    label: 'M2 只有起跑前那一眼、定时器没接上 ⇒ W2 与 W3 都要红',
    file: 'selfhost-kill-watchdog.mjs',
    needle: '  handle.timer = setInterval(tick, intervalMs);',
    inject: '  // MUT: 不接定时器（只留下面那次即时 tick）',
    expectRed: ['W2', 'W3'],
  },
];

let failed = 0;
for (const arm of arms) {
  const dir = mkdtempSync(join(tmpdir(), 'selfhost-watchleg-arms-'));
  try {
    for (const f of FILES) copyFileSync(join(TOOLS, f), join(dir, f));
    const p = join(dir, arm.file);
    const src = readFileSync(p, 'utf8');
    /* 🔴 needle 从源码字面抄，抄不到就响亮失败 —— 凭记忆写 needle 在这一批里已经栽过三次。 */
    if (!src.includes(arm.needle)) {
      process.stdout.write(`🔴 ${arm.label}\n   needle 没照进源码（我凭记忆写的）⇒ 这一臂无效，不算过\n`);
      failed++;
      continue;
    }
    const mutated = src.replace(arm.needle, arm.inject);
    if (mutated === src) {
      process.stdout.write(`🔴 ${arm.label}\n   替换后逐字节相同 ⇒ 臂根本没落地\n`);
      failed++;
      continue;
    }
    writeFileSync(p, mutated);
    let out = '';
    let rc = 0;
    try {
      out = execFileSync('node', [join(dir, 'selfhost-land-main.mjs'), '--watch-leg', '5'],
        { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      rc = e.status ?? -1;
    }
    const flagged = new Set();
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^- (W\d)/);
      if (m) flagged.add(m[1]);
    }
    const got = [...flagged].sort();
    const want = arm.expectRed.slice().sort();
    const ok = rc === 1 && got.join(',') === want.join(',');
    process.stdout.write(`${ok ? '✅' : '🔴'} ${arm.label}\n   rc=${rc} 点名的臂=${got.join(' · ') || '(无)'} 期望=${want.join(' · ')}\n`);
    if (!ok) {
      failed++;
      process.stdout.write(out.split('\n').filter((l) => /^W\d|不合格|✅ 三臂|臂读数/.test(l)).join('\n') + '\n');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const dirty = execFileSync('git', ['status', '--porcelain', '--',
  'research/tools/selfhost-kill-watchdog.mjs', 'research/tools/selfhost-land-main.mjs',
  'research/tools/selfhost-kill-ports.mjs', 'research/tools/selfhost-deps-fresh.mjs'],
  { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((l) => l.trim() !== '').map((l) => l.slice(3)).sort();
const clean = dirty.length === OWN_EDITS.length && dirty.every((x, i) => x === OWN_EDITS[i]);
process.stdout.write(`收尾对账：真树状态行 = ${dirty.length} 条 [${dirty.join(', ')}]\n`);
process.stdout.write(`${clean
  ? '✅ 恰好是本轮我自己改的那两枚 ⇒ 变异台没有往真树里写任何东西'
  : '🔴 对账不合格（少了=探针没在看该看的路径，多了=变异漏进真树）'}\n`);
process.exit(failed || !clean ? 1 : 0);
