#!/usr/bin/env node
// 本分支**有没有弄坏别的门禁** —— 把根 `check` 组合里的门禁逐条跑一遍并分类。
// 工单 §8.13 那趟（载体 `/tmp/dp_gates_sweep.py`，本轮已被本件取代）第一次量出"这一族只验过 9/N 道"；
// §8.109 规则 1 要求：合流当时还要用的读数，它的件必须在仓里。合流当时要问的正是这句话，所以这枚入仓。
// 收尾电池（`verify-detail-pane-closeout-battery.mjs`）**不覆盖这里** —— 它跑的是本线那 9 道 +
// 六包 typecheck/测试 + e2e 那一族；全 `check` 组合的分母只有本脚本现取。
//
// 与 /tmp 那版的三处区别（每一处都是缺陷修复，不是风格）：
//  1. 路径自锚 —— 旧版把 worktree 绝对路径写死，换载体就在错的树上跑；本版打印 ROOT=。
//  2. `pnpm --filter X <script>` **由读各包 package.json 现解**，不再抄一张硬编码展开表 ——
//     抄件会漂，且抄错时静默少跑一道（§8.110 那条"命令字面量抄成恒绿虚检查"同族）。
//     解不出来一律 UNRESOLVED 并让整体红，**不降级成 SKIP**。
//  3. 旧版无条件 `sys.exit(0)` —— "扫出 7 道红"和"全绿"在退出码上长得一样。本版 RED/UNRESOLVED>0 退 1。
//
// 刻意跳过（不是偷懒，是这些会踩共享资源或要产物/设备）：起 Playwright/真浏览器（§7 第 87 条：
// 它会 SIGKILL 别人的 dev 服务）、要设备/壳/远端（adb/simctl/xcodebuild/gradle/ssh/docker）、
// 以及要全量构建的（本检出是 linked worktree，根 node_modules 是指向主检出的软链）。
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DANGER = /playwright|e2e|appium|adb |simctl|xcodebuild|gradle|ssh |docker|pnpm -r build|reinstall/;
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const rootPkg = read(join(ROOT, 'package.json'));

// 包名 → 目录：候选集合 = packages/* 与 apps/* 各自一层 + server 与 e2e 本身。
// 不硬编码包清单（新增包自动进集合）；写死清单就是又一枚会漂的抄件。
const NAME_TO_DIR = new Map();
const candidates = [];
for (const top of ['packages', 'apps']) {
  const dir = join(ROOT, top);
  if (!existsSync(dir)) continue;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    if (e.isDirectory()) candidates.push(join(dir, e.name));
  }
}
for (const top of ['server', 'e2e']) if (existsSync(join(ROOT, top))) candidates.push(join(ROOT, top));
for (const abs of candidates) {
  const pj = join(abs, 'package.json');
  if (!existsSync(pj)) continue;
  try {
    const p = read(pj);
    if (p.name) NAME_TO_DIR.set(p.name, abs);
  } catch {}
}

// 只认「一条 filter + 一个脚本名」这个形状；带 && 或额外实参的一律 UNRESOLVED（不猜）。
const FILTER_RE = /^pnpm\s+--filter\s+(\S+)\s+(?:run\s+)?([a-z0-9:_-]+)$/;
let composed = [...new Set((rootPkg.scripts.check.match(/check:[a-z0-9-]+/g) || []))].sort();
// `--only a,b`：**变异臂专用**的收窄（臂要验的是"注入的那道会不会落进 RED / UNRESOLVED"，
// 不是全组合）。收窄后的分母自检仍然生效，但输出必须打上 FILTERED ——
// 一趟收窄的跑**不构成**"这一族没弄坏别的门禁"的证据。
const onlyArgIdx = process.argv.indexOf('--only');
const ONLY = onlyArgIdx === -1 ? null : (process.argv[onlyArgIdx + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (ONLY) {
  if (!ONLY.length) {
    console.log('🔴 --only 传了空集合：收窄成一趟"什么都不跑"的读数没有意义，拒绝执行');
    console.log('SWEEP_RESULT=PROBE_BROKEN');
    process.exit(2);
  }
  const missing = ONLY.filter((n) => !composed.includes(n));
  if (missing.length) {
    console.log(`🔴 --only 里有 ${missing.length} 道不在根 check 组合里：${missing.join(',')} —— 注入没进分母，整趟不作数`);
    console.log('SWEEP_RESULT=PROBE_BROKEN');
    process.exit(2);
  }
  composed = composed.filter((n) => ONLY.includes(n));
}

function resolveCmd(name) {
  const cmd = rootPkg.scripts[name];
  if (cmd === undefined) return { verdict: 'MISSING_SCRIPT', note: `根 package.json 没有 ${name}` };
  const m = FILTER_RE.exec(cmd.trim());
  if (!m) {
    if (/^pnpm\b/.test(cmd.trim()))
      return { verdict: 'UNRESOLVED', note: `pnpm 形状不是「一条 filter + 一个脚本」，不猜：${cmd.slice(0, 70)}` };
    return { cmd, cwd: ROOT, form: /^(node |cd \S+ && )/.test(cmd) ? 'node' : 'other' };
  }
  const [, pkgName, sub] = m;
  const dir = NAME_TO_DIR.get(pkgName);
  if (dir === undefined) return { verdict: 'UNRESOLVED', note: `workspace 里找不到包 ${pkgName}` };
  const inner = read(join(dir, 'package.json')).scripts?.[sub];
  if (inner === undefined)
    return { verdict: 'UNRESOLVED', note: `${pkgName} 没有脚本 ${sub}（解不出不降级成 SKIP）` };
  return { cmd: inner, cwd: dir, form: 'filter-expanded' };
}

const logDir = join(tmpdir(), `dp-gate-sweep-${process.pid}`);
mkdirSync(logDir, { recursive: true });
const env = { ...process.env, NO_COLOR: '1' };
delete env.FORCE_COLOR;

const rows = [];
for (const name of composed) {
  const raw = rootPkg.scripts[name];
  if (raw === undefined) {
    rows.push({ name, verdict: 'MISSING_SCRIPT', note: `根 package.json 没有 ${name}`, form: '-' });
    continue;
  }
  // 危险形状先在**原文**上判：展开只可能让命令变短，所以原文命中就足够判跳（否则
  // `pnpm --filter X build && …e2e…` 这种复合形状会被"解不开"误判成 UNRESOLVED，
  // 而它本来就在跳过名单里 —— 那种假红会让人学会忽略 UNRESOLVED，判据就废了）。
  if (DANGER.test(raw)) {
    rows.push({ name, verdict: 'SKIP', note: '起浏览器/设备/远端/全量构建类（文件头理由，原文形状命中）', form: 'raw' });
    continue;
  }
  const r = resolveCmd(name);
  if (r.verdict) {
    rows.push({ name, verdict: r.verdict, note: r.note, form: '-' });
    continue;
  }
  if (DANGER.test(r.cmd)) {
    rows.push({ name, verdict: 'SKIP', note: '展开后的命令命中危险形状', form: r.form });
    continue;
  }
  const res = spawnSync(r.cmd, {
    cwd: r.cwd,
    shell: '/bin/sh',
    // 🔴 PATH 必须带上「这道门禁自己的 cwd 的 node_modules/.bin」+ 根的：`pnpm` 跑脚本时会把这两条
    // 注进 PATH，而我这里是直接 `/bin/sh`，不注就等于用一套更严的环境跑别人的门禁。
    // 实测代价：首趟 `check:tokens` 与 `check:server-copy` 双双 rc=127（`tsup: command not found`），
    // 读起来像"这两道门禁坏了"，实际是**探针少了一层 PATH**。少跑的 gate 不是红，是未判。
    env: {
      ...env,
      PATH: [join(r.cwd, 'node_modules/.bin'), join(ROOT, 'node_modules/.bin'), env.PATH].filter(Boolean).join(':'),
    },
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const log = join(logDir, `${name.replace(/:/g, '_')}.log`);
  writeFileSync(log, out);
  const rc = res.status ?? -1;
  const lines = out.split('\n').filter((l) => l.trim());
  const tail = (lines.at(-1) ?? '').slice(0, 110);
  const binMissing = /No such file|not found|command not found/.test(lines.slice(-4).join('\n'));
  rows.push({
    name,
    verdict: rc === 0 ? 'OK' : binMissing ? 'MISSING_BIN' : 'RED',
    note: `rc=${rc} ${tail}`,
    form: r.form,
  });
}

for (const r of rows) {
  console.log(`GATE ${r.name.padEnd(32)} ${r.verdict.padEnd(14)} ${r.form.padEnd(16)} ${r.note}`);
}

// 分母自检：组合里每一道都必须出现一次且只一次，否则是探针错，不是门禁红。
const names = rows.map((r) => r.name);
const dup = names.filter((n, i) => names.indexOf(n) !== i);
const lost = composed.filter((n) => !names.includes(n));
const count = (v) => rows.filter((r) => r.verdict === v).length;
console.log(
  `\nSUMMARY total=${rows.length} ok=${count('OK')} red=${count('RED')} skip=${count('SKIP')} ` +
    `missing_bin=${count('MISSING_BIN')} missing_script=${count('MISSING_SCRIPT')} unresolved=${count('UNRESOLVED')}`,
);
console.log('RED=' + rows.filter((r) => r.verdict === 'RED').map((r) => r.name).join(','));
console.log('UNRESOLVED=' + rows.filter((r) => r.verdict === 'UNRESOLVED').map((r) => r.name).join(','));
console.log('SKIP=' + rows.filter((r) => r.verdict === 'SKIP').map((r) => r.name).join(','));
// 🔴 未判 ≠ 通过：MISSING_BIN / MISSING_SCRIPT 是"这道门禁今天在这台载体上没跑成"，
// 把它算进绿就等于宣称"全组合扫过"。JUDGED 那一行是给读者的分母，不是装饰。
const notJudged = rows.filter((r) => r.verdict === 'MISSING_BIN' || r.verdict === 'MISSING_SCRIPT');
console.log('NOT_JUDGED=' + notJudged.map((r) => r.name).join(','));
console.log(`ROOT=${ROOT}`);
// 🔴 载体先报出来：本检出是 linked worktree，根 `node_modules` 是指向主检出的**软链**。
// 这个事实会让四类门禁红得和产品无关（2026-10-05 00:3x 逐条读过日志）：
//  · `check:journey-coverage` 内部调 pnpm ⇒ pnpm 认定 modules 目录"不是它的"，要 purge，
//    无 TTY 时以 `[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY]` 失败（**这正是"绝不用 CI=true"
//    那条纪律的实测理由** —— 带上它它就会真的去删主检出那份共享 node_modules）；
//  · `check:mobile-bundle` 的 metro 从软链根往上找依赖 ⇒ `Unable to resolve module`；
//  · `check:web-storage` / `check:web-migration` 自起 vite，realpath 落在 `server.fs.allow`
//    之外 ⇒ wasm 请求被拒 ⇒ `waitForFunction` 超时。
// 没这行输出，下一轮就会有人把这四道读成"主干坏了"并去改产品代码。
const nmIsSymlink = (() => {
  try {
    return lstatSync(join(ROOT, 'node_modules')).isSymbolicLink();
  } catch {
    return false;
  }
})();
console.log(`CARRIER=${nmIsSymlink ? 'linked-worktree（根 node_modules 是软链；上面点名的四类形状的红按载体读，不按产品读）' : 'own-tree'}`);
console.log(`LOGS=${logDir}`);
if (dup.length || lost.length) {
  console.log(`🔴 分母自检失败 dup=${dup.join(',')} lost=${lost.join(',')} —— 探针错，整趟不作数`);
  console.log('SWEEP_RESULT=PROBE_BROKEN');
  process.exit(2);
}
const bad = count('RED') + count('UNRESOLVED') + count('MISSING_SCRIPT') > 0;
console.log(
  `COMPOSED=${composed.length} JUDGED=${composed.length - notJudged.length - count('SKIP')}/${composed.length} ` +
    `SWEEP_RESULT=${bad ? 'RED' : 'ALL_GREEN'}${ONLY ? ` FILTERED=${ONLY.length}（收窄趟，不是"全组合扫过"的证据）` : ''}`,
);
process.exit(bad ? 1 : 0);
