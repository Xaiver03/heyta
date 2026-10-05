#!/usr/bin/env node
// 第 6 / 第 7 步（原 §3c / §3f 那两枚"要人"）的拒绝臂 —— 证明**前提一漂移就拒绝改**。
//
// 为什么这两枚特别需要臂：它们不是机械拼接，是**按下来的产品裁决**（工单 §8.117：
// 页头不许被压窄 / 同一格先按视图分派再按宽窄分派）。裁决写死在脚本的 EXPECT 常量里，
// 那意味着两种失败模式都可能悄悄发生：① 某一侧的取值变了，脚本却"照旧合成"产出一个
// 谁都没批准过的形态；② 前提早就没了，脚本安静地跳过，读数看上去像"已经处置过"。
// 这两臂就是分别把这两种形状造出来：D1 改一个被钉住的 CSS 取值、D2 摘掉被钉住的 `ref`。
// 还有一趟 D3 对照：**未变异**时必须六条改法、零拒绝。
//
// 🔴 变异只发生在 `git archive` 铺出来的临时产物里，仓库工作树零改动；
//    执行器不带 `--apply`（它自己就只预测不写盘），所以候选树也不会被改。
//    每臂跑完按 sha256 复原并把复原证明打进输出。
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CSS = 'apps/web/src/styles/app/main-area.css';
const APP = 'apps/web/src/App.tsx';
const sha = (s) => createHash('sha256').update(s).digest('hex');

// 🔴 `merge-tree --write-tree` 在**有冲突时非零退出**（这里就有），所以 execFileSync 会抛 ——
// 树 oid 在 stdout 里，必须从异常对象里捞（执行器自己就是这么处理的；照抄它的形状，不另发明一套）。
let tree = '';
try {
  tree = execFileSync('git', ['merge-tree', '--write-tree', '--name-only', 'main', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\n')[0]
    .trim();
} catch (e) {
  tree = String(e.stdout || '').split('\n')[0].trim();
}
if (!/^[0-9a-f]{40}$/.test(tree)) {
  console.log('RIG_RESULT=PROBE_BROKEN —— 拿不到候选树');
  process.exit(2);
}
const base = mkdtempSync(join(tmpdir(), 'heyta-rig-decided-'));
execFileSync('sh', ['-c', `git archive '${tree}' | tar -x -C '${base}'`], { cwd: ROOT, stdio: 'inherit' });

const runExecutor = (dir) => {
  const r = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts/resolve-detail-pane-merge-mechanical.mjs'), '--product', dir],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 },
  );
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const refused = [...out.matchAll(/^🔴 (apps\/web\/src\/[^\s：]+)：(.*)$/gm)].map((m) => ({ file: m[1], why: m[2] }));
  const predicted = [...out.matchAll(/^·  第 ([67]) 步 (\S+)：/gm)].map((m) => `第${m[1]}步 ${m[2]}`);
  return { rc: r.status ?? -1, refused, predicted, out };
};

const checks = [];
const MUT = {
  D1: { rel: CSS, from: '  flex-shrink: 0;', to: '  flex-shrink: 1;', wantFile: CSS, wantNeedle: 'flex-shrink' },
  D2: { rel: APP, from: '        ref={detailRef}\n', to: '', wantFile: APP, wantNeedle: 'ref={detailRef}' },
};

for (const [id, m] of Object.entries(MUT)) {
  const p = join(base, m.rel);
  const orig = readFileSync(p, 'utf8');
  const origSha = sha(orig);
  if (orig.split(m.from).length - 1 !== 1) {
    console.log(`🔴 ${id} 的 needle 在候选树里命中不是 1 次（${orig.split(m.from).length - 1}）—— 臂失效，整趟作废`);
    checks.push({ id, ok: false, note: 'needle 命中数不为 1（变异根本没施上去）' });
    continue;
  }
  writeFileSync(p, orig.replace(m.from, m.to));
  const s = runExecutor(base);
  writeFileSync(p, orig);
  const restored = sha(readFileSync(p, 'utf8')) === origSha;
  const hit = s.refused.filter((x) => x.file === m.wantFile);
  const named = hit.some((x) => x.why.includes(m.wantNeedle));
  const otherStepStillPredicts =
    id === 'D1' ? s.predicted.some((x) => x.startsWith('第7步')) : s.predicted.some((x) => x.startsWith('第6步'));
  checks.push({
    id,
    ok: s.rc === 1 && hit.length === 1 && named && otherStepStillPredicts && restored,
    note: `rc=${s.rc} 拒绝=${hit.length} 点名${m.wantNeedle}=${named} 另一步仍预测=${otherStepStillPredicts} sha 复原=${restored}`,
  });
  if (!restored) {
    console.log('🔴 复原失败 —— 立刻停，后面的读数不可信');
    rmSync(base, { recursive: true, force: true });
    process.exit(2);
  }
}

{
  const s = runExecutor(base);
  checks.push({
    id: 'D3',
    ok: s.rc === 0 && s.refused.length === 0 && s.predicted.length === 2,
    note: `rc=${s.rc} 拒绝=${s.refused.length} 第6/7步预测=${s.predicted.join(' / ')}`,
  });
}

for (const c of checks) console.log(`[${c.id}] ${c.ok ? '✅' : '🔴'} ${c.note}`);
const bad = checks.filter((c) => !c.ok).map((c) => c.id);
console.log('BAD=' + (bad.join(',') || '无'));
console.log(`TREE=${tree}`);
rmSync(base, { recursive: true, force: true });
console.log(`RIG_RESULT=${bad.length ? 'FAIL' : `${checks.length}/${checks.length}`}`);
process.exit(bad.length ? 1 : 0);
