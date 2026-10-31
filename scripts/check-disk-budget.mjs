#!/usr/bin/env node
/**
 * `check:disk-budget` —— 构建产物**超预算就红**的门禁（先清旧的，再建新的）
 * ============================================================================
 *
 * ## 它判什么
 *
 * 调用 `scripts/clean-artifacts.sh --json` 拿「现在有多少可回收构建产物」，
 * 与预算比。超了 ⇒ `exit 1`，并直接给出清理命令。这样"产物攒到 6 GB 才被偶然发现"
 * 变成"下一次跑门禁就红"。
 *
 * 读数与清理**共用同一份名单**：本文件不自己数目录，只解析清理器的 JSON。
 * 两套名单一定会漂，而漂的那一套正好是门禁读的那一套。
 *
 * ## 预算从哪来（不是拍的）
 *
 * 2026-10-31 实测（本机同一棵树）：
 *   · 一次全仓 `pnpm -r build` 的产物：约 55 MB；
 *   · 再加 macOS SwiftPM `.build/`：约 450 MB；
 *   · 一次 iOS 构建的 `apps/mobile/ios/build`：约 5.3 GB；
 *   · Android NDK 的 `app/.cxx`：约 350 MB。
 *
 * 默认预算 **2048 MB**：正常一轮构建有 4 倍以上余量，而 iOS 构建残留一出现就红。
 * 这是**策略旋钮**，不是物理上限 —— 用 `HEYTA_ARTIFACT_BUDGET_MB` 覆盖。
 *
 * ## 判据
 *
 * 1. 测不到 ⇒ 红（脚本读不到 / JSON 解析不了 / 根目录不合法），且**明说"测不到"**，
 *    不许把一次探针失败报成"预算内"；
 * 2. 可回收 > 预算 ⇒ 红，打印最大几项与清理命令；
 * 3. 可回收 ≤ 预算 ⇒ 绿。
 *
 * `--self-test` 在临时树里跑四臂：超预算必红 / 预算内必绿 / 干净树预算 0 仍绿 /
 * 根不存在必红（证明它不是一条永远绿的判据）。
 *
 * ## 用法
 *
 *   pnpm check:disk-budget
 *   node scripts/check-disk-budget.mjs --self-test
 *   node scripts/check-disk-budget.mjs --budget-mb 4096
 *   node scripts/check-disk-budget.mjs --root /tmp/fixture --budget-mb 1   # 注入验证
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '..');
const CLEAN = join(ROOT, 'scripts', 'clean-artifacts.sh');

const argv = process.argv.slice(2);
let selfTest = false;
let rootArg = '';
let budgetMbArg = '';
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--self-test') selfTest = true;
  else if (a === '--root') rootArg = argv[(i += 1)] ?? '';
  else if (a === '--budget-mb') budgetMbArg = argv[(i += 1)] ?? '';
  else if (a === '-h' || a === '--help') {
    console.log('用法：node scripts/check-disk-budget.mjs [--self-test] [--root <dir>] [--budget-mb <n>]');
    process.exit(0);
  } else {
    console.error(`🔴 不认识的参数：${a}`);
    process.exit(2);
  }
}

function parseBudget() {
  const raw = budgetMbArg || process.env.HEYTA_ARTIFACT_BUDGET_MB || '2048';
  if (!/^[0-9]+$/.test(raw)) {
    console.error(`🔴 预算必须是非负整数 MB（读到：${raw}）`);
    process.exit(2);
  }
  return Number(raw);
}

function human(kb) {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(2)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

/** 跑一次清理器的干跑，返回读数或"测不到"的原因。 */
function measure(root) {
  const args = [CLEAN, '--json'];
  if (root) args.push('--root', root);
  const r = spawnSync('bash', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) return { ok: false, why: `无法启动清理器：${r.error.message}` };
  if (r.status !== 0) {
    const tail = (r.stderr || '').trim().split('\n').slice(-3).join(' / ');
    return { ok: false, why: `清理器退出码 ${String(r.status)}（${tail || '无 stderr'}）` };
  }
  let data;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    return { ok: false, why: '清理器的输出不是 JSON（stdout 里混进了人读行？）' };
  }
  if (typeof data.reclaimableKb !== 'number' || Number.isNaN(data.reclaimableKb)) {
    return { ok: false, why: 'JSON 里没有可用的 reclaimableKb' };
  }
  return { ok: true, data };
}

function report({ data, budgetMb, root }) {
  const kb = data.reclaimableKb;
  const budgetKb = budgetMb * 1024;
  const head = `构建产物预算：可回收 ${human(kb)} / 预算 ${budgetMb} MB`;
  if (kb <= budgetKb) {
    console.log(`✅ ${head}`);
    console.log(`   根目录 ${data.rootReal || root || ROOT}（${(data.items || []).length} 项）`);
    return 0;
  }
  console.log(`🔴 ${head} —— 超了 ${human(kb - budgetKb)}`);
  console.log('   先把旧的、可回收的产物清掉，再创建新的：');
  console.log('     bash scripts/clean-artifacts.sh --apply');
  const top = [...(data.items || [])].sort((a, b) => b.kb - a.kb).slice(0, 5);
  if (top.length > 0) {
    console.log('   最大几项：');
    for (const it of top) console.log(`     ${human(it.kb).padStart(9)}  ${it.path}`);
  }
  return 1;
}

function runSelfTest() {
  const sandboxes = [];
  const mk = () => {
    const d = mkdtempSync(join(tmpdir(), 'heyta-disk-budget-'));
    sandboxes.push(d);
    return d;
  };
  const makeFixture = (withArtifact) => {
    const d = mk();
    writeFileSync(join(d, 'package.json'), '{"name":"fixture"}\n');
    if (withArtifact) {
      mkdirSync(join(d, 'packages', 'demo', 'dist'), { recursive: true });
      writeFileSync(join(d, 'packages', 'demo', 'dist', 'index.js'), 'x'.repeat(2 * 1024 * 1024));
    }
    return d;
  };
  const run = (args) =>
    spawnSync(process.execPath, [SELF, ...args], { cwd: ROOT, encoding: 'utf8' });

  const arms = [];
  const dirty = makeFixture(true);
  const clean = makeFixture(false);
  const missing = join(mk(), 'does-not-exist');

  arms.push(['超预算必红', run(['--root', dirty, '--budget-mb', '1']).status === 1]);
  arms.push(['预算内必绿', run(['--root', dirty, '--budget-mb', '10']).status === 0]);
  arms.push(['干净树预算 0 仍绿', run(['--root', clean, '--budget-mb', '0']).status === 0]);
  const blind = run(['--root', missing, '--budget-mb', '10']);
  arms.push([
    '根不存在必红（且自报测不到）',
    blind.status === 1 &&
      /测不到|清理器退出码/.test(`${blind.stdout || ''}${blind.stderr || ''}`),
  ]);

  let bad = 0;
  for (const [name, pass] of arms) {
    if (!pass) bad += 1;
    console.log(`${pass ? '✓' : '✗'} ${name}`);
  }
  console.log(`self-test: ${arms.length} 臂，${bad} 处不符`);
  for (const d of sandboxes) rmSync(d, { recursive: true, force: true });
  return bad === 0 ? 0 : 1;
}

if (selfTest) process.exit(runSelfTest());

const budgetMb = parseBudget();
const got = measure(rootArg);
if (!got.ok) {
  console.error(`🔴 测不到构建产物：${got.why}`);
  console.error('   这条判据拒绝把"探针失败"读成"预算内"。');
  process.exit(1);
}
process.exit(report({ data: got.data, budgetMb, root: rootArg }));
