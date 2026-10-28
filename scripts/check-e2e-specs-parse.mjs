#!/usr/bin/env node
/*
 * 为什么要有这道门（不是"顺手多加一把"）：
 *   `pnpm check` 的 e2e 腿只跑 `e2e/tests`，而**线上那把尺在 `e2e/live-site/`** ——
 *   它没有任何一道常驻消费者，只有发布流程第 9 步才会跑到。于是 2026-10-27：
 *   我往 `live-credential-pages.spec.ts` 的块注释里抄了一条现量命令，那条命令里
 *   `.*` 紧跟 `//` 含一个"星号+斜杠"——**块注释的终止符**——注释被提前关掉，
 *   剩下的内容当成代码，整把线上尺编译不过，而**所有门都是绿的**。
 *   发现方式也很偶然：想复跑那把尺取现量读数时才撞见 `Total: 0 tests in 0 files`。
 *
 * 判据（精确对准那一类失效）：把 `e2e/playwright*.config.ts` 逐枚 `--list`
 *   —— 只编译与枚举，**不起浏览器、不占端口、不碰线上** ——
 *   出现 transform/parse 类错误就红。
 *   其它原因的拒跑（用例自带的 env 守卫、模块缺失）只**报数不判**，
 *   因为那一类不是"注释关掉了自己"，把它们混进红里会让这把尺第二天就被人为放宽。
 *
 * 能失败性：`--self-test` 现场造两枚夹具（一枚干净、一枚就是今天这个形状），
 *   干净那枚必须过、坏那枚必须被判成 parse 红；任何一边不符就退出非 0。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const E2E = join(ROOT, 'e2e');

const PARSEISH =
  /SyntaxError|Unexpected token|Unexpected end of input|Expected ';'|Expected ident|Transform error|error while loading|expressions are not|Missing initializer|Unterminated/iu;

function listConfigs(dir) {
  return readdirSync(dir)
    .filter((f) => /^playwright.*\.config\.[cm]?ts$/u.test(f))
    .sort();
}

function probe(dir, config) {
  const r = spawnSync('npx', ['playwright', 'test', '--config', config, '--list'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 180_000,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const zeroTests = /Total:\s*0 tests in 0 files/u.test(out);
  if (r.status === 0) return { config, verdict: 'ok', detail: '' };
  if (PARSEISH.test(out)) return { config, verdict: 'parse', detail: firstProblem(out) };
  return { config, verdict: 'other', detail: `${firstProblem(out)}${zeroTests ? '（枚举到 0 枚）' : ''}` };
}

function firstProblem(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const err = lines.findIndex((l) => /Error:/u.test(l));
  return (err >= 0 ? lines[err] : lines[0] ?? '未知').slice(0, 180);
}

function run(dir) {
  const configs = listConfigs(dir);
  const results = configs.map((c) => probe(dir, c));
  const bad = results.filter((r) => r.verdict === 'parse');
  const other = results.filter((r) => r.verdict === 'other');
  const ok = results.filter((r) => r.verdict === 'ok');
  return { configs, results, bad, other, ok };
}

/* ── 夹具：现场造，跑完即删 ───────────────────────────────────────────
 * 落点刻意选在 `e2e/test-results/` 下面，两个理由都要：
 *   ① `@playwright/test` 要能沿目录树上溯到 `e2e/node_modules` 解析得到 ——
 *      放 `/tmp` 里跑的是"从注册表现拉一枚 playwright"那种假绿；
 *   ② 根 `.gitignore` 那条 `test-results/` 不锚目录深度，夹具天生不入 git 视野，
 *      被 kill 在半路也不会留下脏工作树。 */
const FIXTURE_ROOT = join(E2E, 'test-results');

function fixtureDir(name, specBody) {
  /*
   * 🔴 夹具的父目录**不能假设它已经在那儿**：`e2e/test-results/` 是 Playwright 跑起来才建的，
   * 而它会被清理（本仓实测：跑过一次清理后 `pnpm check:e2e-specs-parse` 直接
   * `ENOENT: mkdtemp` 崩掉，`rc=1` 报的是"门禁红"，读起来像界面有毛病）。
   * 崩掉的门禁比会红的门禁更糟 —— 它把"探针自己的环境问题"伪装成产品判决。
   */
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_ROOT, `.parse-fixture-${name}-`));
  writeFileSync(
    join(dir, 'playwright.f.config.ts'),
    `import { defineConfig } from '@playwright/test';\n` +
      `export default defineConfig({ testDir: '.', testMatch: /.*\\.spec\\.ts/ });\n`,
  );
  writeFileSync(join(dir, 'a.spec.ts'), specBody);
  return dir;
}

const CLEAN_SPEC =
  `import { test, expect } from '@playwright/test';\n` +
  `/* 说明里放一条会被抄进注释的命令：安全写法是 cut -d'?' -f1 */\n` +
  `test('干净夹具', async () => { expect(1).toBe(1); });\n`;

/* 今天真实踩到的形状：注释里的 `.*` 紧跟 `//` ⇒ 星号+斜杠提前关掉块注释 */
const BROKEN_SPEC =
  `import { test, expect } from '@playwright/test';\n` +
  `/* 现量命令：grep -oE 'x' f | sed 's/?.*//' | sort -u\n` +
  `   ⇒ 这一行本该是注释，但上面那个序列已经把它关掉了 */\n` +
  `test('坏夹具', async () => { expect(1).toBe(1); });\n`;

function selfTest() {
  const arms = [
    { name: '干净夹具必须过', body: CLEAN_SPEC, expectParse: false },
    { name: '坏夹具必须被判成 parse 红', body: BROKEN_SPEC, expectParse: true },
  ];
  let mismatched = 0;
  for (const arm of arms) {
    const dir = fixtureDir(arm.name, arm.body);
    const r = probe(dir, 'playwright.f.config.ts');
    const gotParse = r.verdict === 'parse';
    const ok = gotParse === arm.expectParse;
    if (!ok) mismatched += 1;
    console.log(
      `${ok ? '  ✓' : '  ✘'} ${arm.name}：判到 verdict=${r.verdict}（期望 parse=${String(arm.expectParse)}）${r.detail === '' ? '' : `  报的是「${r.detail}」`}`,
    );
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`${arms.length} 臂，${mismatched} 臂不符`);
  process.exit(mismatched === 0 ? 0 : 1);
}

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) selfTest();

const dirIdx = argv.indexOf('--dir');
const target = dirIdx >= 0 ? resolve(argv[dirIdx + 1]) : E2E;
const { configs, bad, other, ok } = run(target);

console.log(`e2e 用例编译面：${configs.length} 枚配置（只 --list 枚举，不起浏览器）`);
for (const r of other) console.log(`  ⚠️ ${r.config} 拒跑但不是编译问题：${r.detail}`);
if (bad.length > 0) {
  console.error(`\n🔴 ${bad.length} 枚配置编译不过（块注释被内容里的"星号+斜杠"提前关掉，就是这一类）：`);
  for (const r of bad) console.error(`   ❌ ${r.config}\n        ${r.detail}`);
  console.error('\n  修法：注释里别写含 `.*` 紧跟 `//` 的命令；把问号后截断写成 cut -d 见方那枚开关，');
  console.error('        或者把命令从块注释挪进行注释（`//` 开头的行注释没有终止符可被关掉）。');
  console.error('        复量：`node scripts/check-e2e-specs-parse.mjs`');
  process.exit(1);
}
console.log(`✅ 全部配置可编译（${ok.length} 过 / ${other.length} 按设计拒跑 / 0 编译红）`);
