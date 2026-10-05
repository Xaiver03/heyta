#!/usr/bin/env node
/**
 * `selfhost-chain-targets.mjs` —— **`pnpm check` 链里每一条点名的脚本，都必须真的在那棵树里**。
 *
 * ## 它防的那一件事
 *
 * 合并载体对根 `package.json` 取的是**两侧链的并集**（第一族；`check:gate-wiring` 判"谁的门禁被摘了"）。
 * 并集有个并集特有的洞：**链的条目来自 A 侧，脚本文件被 B 侧删了** ——
 * 于是链里留着 `check:xxx`，树里没有 `scripts/xxx.mjs`，`pnpm check` 走到那一步以
 * `Cannot find module` 收尾。那种红：
 *
 * - **归不了属** —— main 自己的链不跑这一道，配对树复跑照不出它，会被读成"本批带进来的"；
 * - 烧掉的是一整枚**窗口**（阻塞集 0 + 负载 + 端口 + 载体空闲 + main 连静 15 分钟，
 *   现量 main 每 2–3 分钟走一笔，窗口是稀缺资源）。
 *
 * 2026-10-05 01:3x 在载体那枚提交上实测过一遍：**链步 85、校验到的脚本目标全部在位**，
 * 也就是这条洞**此刻没有开** —— 本判据是防它开的，不是补已发生的事故。
 *
 * ## 为什么不看磁盘而看提交
 *
 * `--ref` 模式用 `git ls-tree -r --name-only <ref>` 当"树里有什么"，
 * 于是可以审**将要落地的那枚提交**，而不必把进程 cwd 落进哨兵那枚热载体
 * （载体空闲判据的 argv+cwd 两腿会被一次试跑踩掉，等于自己把窗口关掉）。
 *
 * ## 判据与它的射程边界
 *
 * 逐条链步：`pnpm X` → `scripts[X]`（一层嵌套，带环守卫），再从 body 里取"看起来是仓库内脚本"的
 * token —— 以 `.mjs/.cjs/.js/.ts/.sh` 结尾、不以 `-` 开头、不含 `node_modules/`。
 * `cd <dir> &&` 前缀会把相对路径挪到那个子目录里去判。
 *
 * 🔴 三条**分类**都要打出来，不许静默跳过（"桩必须能回答不"同一件事）：
 *  - `checked`：取到了脚本目标并已判在位；
 *  - `no-target`：body 里没有仓库内脚本 token（`pnpm -r test`、纯 shell 一行流）—— 列名字；
 *  - `unresolved`：链点的名字在 `scripts` 里根本没有，或 body 解析不出（**这一条自己就是红**）。
 * 已知敞口两条（都**点名打印**，不是静默）：
 *  ① 脚本被改名成扩展名集合外（`.mts` 等）会掉进 `no-target` 而不会被判红 —— 由 F 臂钉住
 *    （它断言的是**当前真实行为**，修好了那条臂会自己报"敞口已闭"）；
 *  ② `pnpm --filter <pkg> <script>` 那几条落在子包自己的 `scripts` 里，本尺子只做根链，
 *    解它要先把包名映射回目录（读 `pnpm-workspace.yaml`）—— 已量：根链 85 步里这类只有 5 步，
 *    运行时按名字打全，不做"读不出就当通过"。
 *
 * 退出码：0 = 没有悬空；1 = 有悬空或有 unresolved；2 = 探针自己读不到（`git ls-tree` 失败等）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const SCRIPT_EXT = /\.(?:mjs|cjs|js|ts|sh)$/;

/**
 * 把一条链步解析成 `scripts` 里的命令体，展开一层 `pnpm <name>` 嵌套。
 * 返回 `{ body, unresolved, why }`。
 * 🔴 `unresolved` **只**给"链点了这个名字，但 `scripts` 里没有"这一档 —— 那是真的坏（pnpm 自己也会报）。
 * 其余取不到目标的形态（`-r` 递归、`--filter` 子包、非 pnpm 步骤）一律算"不在射程"，
 * 由调用方归进 `no-target` 并**逐条点名打印** —— 把"读不出"和"坏了"混成同一档，
 * 判据就会在正常的树上恒红（那等于没有判据）。
 */
export function resolveStep(name, scripts, seen = new Set()) {
  if (name.startsWith('pnpm --filter ')) {
    return { body: null, unresolved: false, why: `--filter 子包步骤（射程外）：${name}` };
  }
  if (!name.startsWith('pnpm ')) {
    return { body: null, unresolved: false, why: `非 pnpm 步骤（射程外）：${name}` };
  }
  const key = name.slice(5).trim();
  if (key.startsWith('-')) {
    return { body: null, unresolved: false, why: `递归/旗标步骤（射程外）：${name}` };
  }
  const body = scripts[key];
  if (body === undefined) {
    return { body: null, unresolved: true, why: `链里点了 ${key}，scripts 里没有这个名字` };
  }
  if (seen.has(key)) return { body, unresolved: false, why: '' };
  seen.add(key);
  // 一层嵌套：body 自己可能还是 `pnpm xxx`（`build` → `pnpm -r build` 这类）
  if (body.trim().startsWith('pnpm ') && !body.includes('&&')) {
    return resolveStep(body.trim(), scripts, seen);
  }
  return { body, unresolved: false, why: '' };
}

/** 从命令体里取出"仓库内脚本路径"候选，并处理 `cd <dir> &&` 换基目录。 */
export function scriptTargets(body) {
  const out = [];
  let base = '';
  for (const seg of body.split('&&')) {
    const cd = seg.trim().match(/^cd\s+([^ ]+)/);
    if (cd) {
      base = cd[1].replace(/\/$/, '');
      continue;
    }
    for (const raw of seg.trim().split(/\s+/)) {
      const tok = raw.replace(/^["'(]+|["'),;)]+$/g, '');
      if (!tok || tok.startsWith('-')) continue;
      if (!SCRIPT_EXT.test(tok)) continue;
      if (tok.includes('node_modules/')) continue;
      out.push(base ? `${base}/${tok.replace(/^\.\//, '')}` : tok.replace(/^\.\//, ''));
    }
  }
  return out;
}

/**
 * 审一棵树。**不碰磁盘**：`has(relPath)` 由调用方注入（disk 模式给 existsSync，
 * ref 模式给 `git ls-tree` 集合），这样同一个函数既能在本地跑，也能在落地前审提交。
 */
export function auditChain({ pkgText, has }) {
  const pkg = JSON.parse(pkgText);
  const scripts = pkg.scripts ?? {};
  const steps = (scripts.check ?? '').split('&&').map((s) => s.trim()).filter(Boolean);
  const rows = [];
  for (const step of steps) {
    const r = resolveStep(step, scripts);
    if (r.body === null) {
      rows.push({ step, kind: r.unresolved ? 'unresolved' : 'no-target', why: r.why });
      continue;
    }
    const files = scriptTargets(r.body);
    if (files.length === 0) {
      rows.push({ step, kind: 'no-target', why: '命令体里没有仓库内脚本 token' });
      continue;
    }
    const missing = files.filter((f) => !has(f));
    rows.push({
      step,
      kind: missing.length ? 'dangling' : 'checked',
      files,
      missing,
      why: missing.length ? `不在树里：${missing.join(', ')}` : '',
    });
  }
  return rows;
}

export function summarize(rows) {
  const count = (k) => rows.filter((r) => r.kind === k).length;
  return {
    steps: rows.length,
    checked: count('checked'),
    noTarget: count('no-target'),
    unresolved: count('unresolved'),
    dangling: count('dangling'),
    targets: rows.reduce((n, r) => n + (r.files?.length ?? 0), 0),
  };
}

/* ── 自检：臂数由 arms.length 现量，全部打在注入的 `has` 上，不碰磁盘、不碰 git ── */
function runSelftest() {
  const mkPkg = (chain, scripts) => JSON.stringify({ scripts: { check: chain, ...scripts } });
  const arms = [];
  const push = (name, expect, got) => arms.push({ name, expect: String(expect), got: String(got) });

  const files = new Set(['scripts/a.mjs', 'server/scripts/b.mjs', 'research/tools/c.sh']);
  const has = (p) => files.has(p);

  // 对照：全部在位
  const ok = auditChain({ pkgText: mkPkg('pnpm one && pnpm two && pnpm three', {
    one: 'node scripts/a.mjs',
    two: 'cd server && ./node_modules/.bin/ts-node --transpile-only scripts/b.mjs',
    three: 'bash research/tools/c.sh',
  }), has });
  const s0 = summarize(ok);
  push('对照 三条链步都取到目标且都在位 ⇒ 0 悬空 0 unresolved', '3/3/0/0',
    `${s0.steps}/${s0.checked}/${s0.dangling}/${s0.unresolved}`);

  // A 悬空：B 侧把脚本删了，链条目留着（本判据存在的理由本身）
  const a = summarize(auditChain({ pkgText: mkPkg('pnpm gone', { gone: 'node scripts/gone.mjs' }), has }));
  push('A 链点着的脚本不在树里 ⇒ 恰好 1 条 dangling', 1, a.dangling);

  // B `cd server &&` 换基目录：挪错就报悬空
  const b = summarize(auditChain({ pkgText: mkPkg('pnpm srv', { srv: 'cd server && node scripts/b.mjs' }), has }));
  push('B cd 前缀后的相对路径按 server/ 判 ⇒ 不报悬空', '0|1', `${b.dangling}|${b.checked}`);

  // C 没有 cd 前缀却写子目录路径（另一形态：路径本身带目录）
  const c = summarize(auditChain({ pkgText: mkPkg('pnpm deep', { deep: 'node server/scripts/b.mjs' }), has }));
  push('C 直接写全路径也判在位（证明基目录没被无脑前缀）', '0|1', `${c.dangling}|${c.checked}`);

  // D node_modules 里的可执行文件不算目标（`ts-node --transpile-only` 那类假阳性的根）
  const d = summarize(auditChain({ pkgText: mkPkg('pnpm bin', { bin: './node_modules/.bin/x.mjs --flag y.mjs' }), has }));
  push('D node_modules 里的 token 被摘掉 ⇒ 只剩 y.mjs 一条目标且判悬空', '1|1',
    `${d.dangling}|${(auditChain({ pkgText: mkPkg('pnpm bin', { bin: './node_modules/.bin/x.mjs --flag y.mjs' }), has })[0].files ?? []).length}`);

  // E unresolved 必须是**红**而不是"跳过"
  const e = summarize(auditChain({ pkgText: mkPkg('pnpm ghost', { notGhost: 'node scripts/a.mjs' }), has }));
  push('E 链点的名字在 scripts 里没有 ⇒ 1 条 unresolved（不静默）', '0|1', `${e.checked}|${e.unresolved}`);

  // F 已知敞口：扩展名集合外的脚本掉进 no-target，**不会**报红
  const f = auditChain({ pkgText: mkPkg('pnpm mts', { mts: 'node scripts/renamed.mts' }), has });
  push('F[敞口] 改名成 .mts 的脚本掉进 no-target（当前真实行为；修好了这臂会响）', 'no-target|0',
    `${f[0].kind}|${summarize(f).dangling}`);

  // G 一层嵌套：build → pnpm -r build 不该被当成"取不到脚本"就红
  const g = summarize(auditChain({ pkgText: mkPkg('pnpm build', { build: 'pnpm -r build' }), has }));
  push('G body 是 pnpm 递归步骤 ⇒ 归 no-target 而不是 dangling', '0|1', `${g.dangling}|${g.noTarget}`);

  // H 环守卫：a → pnpm b → pnpm a 不许栈溢出
  let hOut = '';
  try {
    hOut = String(summarize(auditChain({
      pkgText: mkPkg('pnpm a', { a: 'pnpm b', b: 'pnpm a' }),
      has,
    })).steps);
  } catch {
    hOut = 'throw';
  }
  push('H 自指链不炸（环守卫存在）', '1', hOut);

  // I 真实链的两档形态混在一起：`-r` 与 `--filter` 都不许把整把判成红（恒红＝没有判据）
  const i = summarize(auditChain({ pkgText: mkPkg(
    'pnpm --filter @heyta/landing check:entries && pnpm -r test && pnpm one',
    { one: 'node scripts/a.mjs' },
  ), has }));
  push('I --filter 与 -r 归 no-target、不产生 unresolved/dangling', '0|0|2|1',
    `${i.unresolved}|${i.dangling}|${i.noTarget}|${i.checked}`);

  // J unresolved 与"射程外"必须是两档：只有"点了名字但 scripts 里没有"才算红（E 臂已量正向，这条量反向）
  const j = auditChain({ pkgText: mkPkg('pnpm -r test', {}), has });
  push('J 纯递归步骤 ⇒ no-target 并带原因，绝不读成 unresolved', 'no-target', j[0].kind);

  const bad = arms.filter((x) => x.expect !== x.got);
  const fArms = arms.filter((x) => x.name.startsWith('F['));
  console.log(`臂数 ${arms.length} · 不符 ${bad.length} · 其中敞口臂 ${fArms.length} 条（F 臂断言的是当前行为，不是期望行为）`);
  for (const x of arms) console.log(`${x.expect === x.got ? 'ok  ' : 'BAD '} ${x.name}  期望=${x.expect} 实量=${x.got}`);
  for (const x of bad) console.log(`   ^ 这条是自检里真正的不符：${x.name}`);
  if (arms.length < 11 || bad.length > 0) {
    console.error('❌ 自检不过 ⇒ 不许拿这个尺子去判合并载体');
    process.exitCode = 1;
    return;
  }
  console.log(`✅ 自检过（${arms.length} 臂，其中 ${fArms.length} 臂是登记过的敞口）`);
}

/* ── CLI ───────────────────────────────────────────────────────────
 * 🔴 入口判断比的是**两边都 realpath 之后的路径**。`/tmp` 是 `/private/tmp` 的软链，
 * 比字符串会让"被 import"和"被直接跑"在输出上长得一模一样；而 CLI 段一旦在 import 时也跑，
 * 调用方注入的 `has` 就被静默丢掉 —— 读出来是"全绿"，量的却是另一棵树。
 * 同族见 traps `#193` 与本仓 `research/tools/selfhost-text-merge.mjs` 的那处修法。 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 三种跑法（`--selftest` / `--ref` / 磁盘）都在这一支里；被 import 时一行都不执行。 */
function runCli(argv) {

if (argv.includes('--selftest')) {
  runSelftest();
  process.exit(process.exitCode ?? 0);
}

const refAt = argv.indexOf('--ref');
const pkgAt = argv.indexOf('--pkg');
const treeAt = argv.indexOf('--tree');
if (refAt >= 0 && (pkgAt >= 0 || treeAt >= 0)) {
  console.error('退 2：--ref 是"同一枚提交同时当 package.json 与文件清单"的捷径，不与 --pkg/--tree 混用');
  process.exit(2);
}
if ((pkgAt >= 0) !== (treeAt >= 0)) {
  console.error('退 2：跨树比较必须**两边都给** —— --pkg <文件> 给链条目那一侧，--tree <引用> 给文件清单那一侧');
  process.exit(2);
}
let pkgText = '';
let has = null;
const gitOpts = (cwd) => ({ cwd, encoding: 'utf8', maxBuffer: 1 << 26 });

if (pkgAt >= 0) {
  // 🔴 跨树比较：链条目来自一棵树（通常是别人**还没提交**的那份工作树），
  // 文件清单来自另一棵树（通常是那棵树已提交的那一侧）。两个根都必须打出来，
  // 否则"两边相等"可能是把同一棵树量了两次。
  const pkgFile = argv[pkgAt + 1];
  const treeRef = argv[treeAt + 1];
  if (!pkgFile || !treeRef) {
    console.error('退 2：--pkg / --tree 后面各要跟一个参数');
    process.exit(2);
  }
  const pkgDir = dirname(resolve(pkgFile));
  try {
    pkgText = readFileSync(resolve(pkgFile), 'utf8');
    const listing = execFileSync('git', ['ls-tree', '-r', '--name-only', treeRef], gitOpts(pkgDir));
    const set = new Set(listing.split('\n').filter(Boolean));
    has = (p) => set.has(p);
    const top = execFileSync('git', ['rev-parse', `${treeRef}^{tree}`], gitOpts(pkgDir)).trim();
    console.log(`链条目来自文件 ${resolve(pkgFile)} · 文件清单来自 ${pkgDir} 里的引用 ${treeRef}（tree ${top.slice(0, 12)}，${set.size} 条）`);
  } catch (e) {
    console.error(`退 2：跨树取数失败 —— ${String(e.message).split('\n')[0]}（探针坏，不是产品红）`);
    process.exit(2);
  }
} else if (refAt >= 0) {
  const ref = argv[refAt + 1];
  if (!ref) {
    console.error('退 2：--ref 后面没给引用');
    process.exit(2);
  }
  try {
    pkgText = execFileSync('git', ['show', `${ref}:package.json`], gitOpts(ROOT));
    const listing = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], gitOpts(ROOT));
    const set = new Set(listing.split('\n').filter(Boolean));
    has = (p) => set.has(p);
    console.log(`裁判对象 = ${ROOT} 这个仓里的提交 ${ref}（tree 条目 ${set.size} 条 · 没读磁盘，也没进任何工作树）`);
  } catch (e) {
    console.error(`退 2：读 ${ref} 失败 —— ${String(e.message).split('\n')[0]}（探针坏，不是产品红）`);
    process.exit(2);
  }
} else {
  pkgText = readFileSync(resolve(ROOT, 'package.json'), 'utf8');
  has = (p) => existsSync(resolve(ROOT, p));
  console.log(`裁判对象 = 工作树 ${ROOT}`);
}

const rows = auditChain({ pkgText, has });
const s = summarize(rows);
for (const r of rows) {
  if (r.kind === 'dangling' || r.kind === 'unresolved') console.log(`悬空/判不了  ${r.step}  ${r.why}`);
}
const noTargets = rows.filter((r) => r.kind === 'no-target').map((r) => r.step);
console.log(`链步 ${s.steps} · 取到脚本目标 ${s.targets} 枚并逐枚判在位 · checked ${s.checked} · no-target ${s.noTarget} · unresolved ${s.unresolved} · 悬空 ${s.dangling}`);
console.log(`不在射程（点名，不静默）：${noTargets.join(', ') || '（无）'}`);
const rc = s.dangling + s.unresolved > 0 ? 1 : 0;
console.log(rc === 0
  ? '✅ 链里每一条点名的脚本都在这棵树里（no-target 那几条形成本身已由 F 臂登记为已知敞口）'
  : '❌ 有悬空或读不到的链步 ⇒ pnpm check 走到那里会以 Cannot find module 收尾');
process.exit(rc);
}

const isEntry = process.argv[1]
  ? realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
  : false;
if (isEntry) runCli(process.argv.slice(2));
