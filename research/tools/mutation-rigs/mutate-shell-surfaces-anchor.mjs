#!/usr/bin/env node
/**
 * `scripts/check-shell-surfaces.mjs` 断言 A 那条腿的变异装置。
 *
 * 守的是 2026-10-05 的一次**修法方向纠正**：断言 A 原来把
 * `dist/windows/install-capture.txt`（打包机 scp 回来的**未跟踪产物**）当成源码锚点扫，
 * 于是任何一枚没打过 Windows 包的树（= 每一枚干净检出）都整条门禁红，
 * 而它打印的修法是"把锚点同步回本脚本"——那会把下一个人推去改锚点。
 * 现在改成两侧**名字对账**（读生产方源码，任何树上都成立），
 * "本树没取证"回到 D4 那一栏（响亮未取证，`HEYTA_REQUIRE_PACKAGED_ARTIFACT=1` 才折成红）。
 *
 * 🔴 因此本装置最值钱的一条不是 A1/A2（改名会红），而是 **A4 的两半**：
 *   产物缺席必须**不再**红（这是这次改动的全部内容），而严格模式下必须**照样**红
 *   （否则"纠正误红"就变成了"放宽判据"）。两半缺一半都不算修对。
 *
 * 每臂都断两件事：红落在我点名的那条腿上，且**别的锚点腿没跟着红**。
 *
 * 跑法（linked worktree 里别用 `pnpm run`）：
 *   node research/tools/mutation-rigs/mutate-shell-surfaces-anchor.mjs
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(join(dirname(fileURLToPath(import.meta.url)), '../../..'));

const GATE = 'scripts/check-shell-surfaces.mjs';
const PS1 = 'apps/desktop-windows/scripts/install-and-capture.ps1';
const SH = 'apps/desktop-windows/scripts/package-msix.sh';
const FACTS = 'dist/windows/install-capture.txt';
/** 一条**真源码**锚点：拿它做"锚点仍然会红"的阳性对照。 */
const SRC_ANCHOR = 'apps/web/src/features/shell/view-tabs.ts';

const results = [];
function arm(id, wantRed, note, run) {
  const { out, code } = run();
  // 🔴 "断言 A 没红"只有在**这条腿真的执行过**时才算绿 —— 门禁崩在别处、载体缺件、
  //    输出被吞，三者都会得到一个看起来很干净的 green（§7 元规则 1：先怀疑探针）。
  if (!/【断言 A】/.test(out)) {
    results.push({ id, ok: false, note: `${note} —— 输出里没有断言 A 那一段（腿没跑，判失败而不是判绿）` });
    console.log(`🔴 ${id} 输出里没有【断言 A】那一段 ⇒ 这条腿根本没执行（code=${code}）`);
    return out;
  }
  const anchorRed = /断言 A 不通过/.test(out);
  const ok = anchorRed === wantRed;
  results.push({ id, ok, note });
  console.log(`${ok ? '✅' : '🔴'} ${id} 期望断言A=${wantRed ? 'red' : 'green'} 实到=${anchorRed ? 'red' : 'green'}  ${note}`);
  return out;
}

/** 造一枚硬链接副本（本门禁只读源码与产物，`node_modules` / `.git` 不需要），每臂只重写自己点名的那一枚。 */
function freshCopy(tag) {
  const dir = mkdtempSync(join(tmpdir(), `shell-anchor-${tag}-`));
  execFileSync('rsync', ['-a', '--exclude', 'node_modules', '--exclude', '.git', '--link-dest', `${repoRoot}/`, `${repoRoot}/`, `${dir}/`], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  // 载体不成立 ⇒ 后面每一臂的"绿"都可能是"门禁根本没跑"，先在这里响亮地挡住
  if (!existsSync(join(dir, 'package.json')) || !existsSync(join(dir, PS1))) {
    throw new Error(`副本缺件（${tag}）：package.json 或 ${PS1} 不在 ⇒ 本装置不能判任何绿`);
  }
  return dir;
}
function rewrite(root, rel, fn) {
  const abs = join(root, rel);
  const next = fn(readFileSync(abs, 'utf8'));
  rmSync(abs); // 🔴 必须先摘：rsync --link-dest 是**硬链接**，就地 truncate 会写坏工作树那一份
  writeFileSync(abs, next, 'utf8');
}
function runGate(root, env = {}) {
  try {
    const out = execFileSync('node', [GATE], {
      cwd: root,
      env: { ...process.env, HEYTA_CHECK_ROOT: root, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { out, code: 0 };
  } catch (e) {
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status ?? 1 };
  }
}

console.log('== 断言 A 的锚点分类：变异臂 ==');

// A0 阳性对照：原样副本 ⇒ 断言 A 绿（这条腿在真实现场是"通过"，不是"没执行"）
{
  const root = freshCopy('a0');
  arm('A0', false, '原样副本 ⇒ 断言 A 绿', () => runGate(root));
  rmSync(root, { recursive: true, force: true });
}

// A1 生产方改名（ps1 那侧）⇒ 必须红，且点名"锚点漂移"
{
  const root = freshCopy('a1');
  rewrite(root, PS1, (s) =>
    s.replace(
      /\$factsFile(\s*=\s*Join-Path \$build 'install-capture)\.txt'/,
      (_m, p1) => `$factsFile${p1}-v2.txt'`,
    ),
  );
  const out = arm('A1', true, 'ps1 改取证文件名 ⇒ 断言 A 红（锚点漂移）', () => runGate(root));
  const named = /锚点漂移/.test(out) && out.includes(PS1);
  console.log(`   ${named ? '✅' : '🔴'} A1-点名：红字点名了生产方文件与"锚点漂移"`);
  results.push({ id: 'A1-named', ok: named });
  rmSync(root, { recursive: true, force: true });
}

// A2 生产方改名（sh 的 scp 那行）⇒ 同样红
{
  const root = freshCopy('a2');
  rewrite(root, SH, (s) => s.replace('C:/src/heyta-msix/install-capture.txt', 'C:/src/heyta-msix/install-capture-v2.txt'));
  const out = arm('A2', true, 'scp 行改名 ⇒ 断言 A 红', () => runGate(root));
  const onlyOne = (out.match(/锚点漂移/g) ?? []).length === 1;
  console.log(`   ${onlyOne ? '✅' : '🔴'} A2-单腿：只有我点名的那一腿红（不是共享解析层坏了）`);
  results.push({ id: 'A2-single', ok: onlyOne });
  rmSync(root, { recursive: true, force: true });
}

// A3 摘掉一枚**真源码**锚点 ⇒ 仍然红（这次改动没有把源码锚点那条腿一起弄丢）
{
  const root = freshCopy('a3');
  rmSync(join(root, SRC_ANCHOR));
  const out = arm('A3', true, '删掉 view-tabs.ts（真源码锚点）⇒ 断言 A 红', () => runGate(root));
  const named = out.includes('扫不到') && out.includes(SRC_ANCHOR);
  console.log(`   ${named ? '✅' : '🔴'} A3-点名：红字点名了缺的是哪一枚`);
  results.push({ id: 'A3-named', ok: named });
  rmSync(root, { recursive: true, force: true });
}

// A4 两半：产物缺席**不再**红（默认）+ 严格模式**照样**红
{
  const root = freshCopy('a4');
  if (existsSync(join(root, FACTS))) rmSync(join(root, FACTS));
  const def = arm('A4a', false, '本树没打过 Windows 包 ⇒ 断言 A 不再红（这次改动的全部内容）', () => runGate(root));
  const loud = /未取证/.test(def) && /install-capture\.txt/.test(def);
  console.log(`   ${loud ? '✅' : '🔴'} A4a-响亮：未取证仍然打印出来并点名取证文件（不是静默跳过）`);
  results.push({ id: 'A4a-loud', ok: loud });
  const strict = runGate(root, { HEYTA_REQUIRE_PACKAGED_ARTIFACT: '1' });
  const strictRed = strict.code !== 0 && /HEYTA_REQUIRE_PACKAGED_ARTIFACT=1/.test(strict.out);
  console.log(`   ${strictRed ? '✅' : '🔴'} A4b-严格：同一枚树加 HEYTA_REQUIRE_PACKAGED_ARTIFACT=1 ⇒ 整条门禁红（判据没被放宽）`);
  results.push({ id: 'A4b-strict', ok: strictRed });
  rmSync(root, { recursive: true, force: true });
}

const bad = results.filter((r) => !r.ok);
console.log(
  `\nARMS=${results.filter((r) => r.id.startsWith('A')).length} AS_EXPECTED=${results.length - bad.length}/${results.length} FAIL=${bad.length}`,
);
for (const b of bad) console.log(`🔴 不如预期：${b.id}${b.note ? ` —— ${b.note}` : ''}`);
process.exit(bad.length === 0 ? 0 : 1);
