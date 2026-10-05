#!/usr/bin/env node
/**
 * 详情面这一族的收尾电池：门禁 + 逐包类型检查 + 逐包单元测试 + web 生产构建 + e2e 整族。
 *
 * 它存在的理由不是"方便"，是**这一族的验收从来不是一个命令**：`pnpm check` 只跑门禁与单测，
 * 不跑平台构建、不跑 e2e；而工单 §6.1.1 那句"测试全绿 ≠ 这是当前产物"要求 e2e 之前必须先重打
 * `apps/web`。把这套顺序写成散文，下一轮就会有人只做前一半。
 *
 * 三条纪律（都是实测换来的，删任何一条都会造出一个假绿）：
 *
 * 1. **不许用 `&&` 串步骤**。第一段失败会被第二段掩盖，得到的只是最后那一条的读数
 *    （工单 §8.7 第 4 条）。每一步单独打印自己的 RC。
 * 2. **二进制一律走各包自己的 `node_modules/.bin`**。linked worktree 里根 `node_modules` 是指向
 *    主检出的软链且没有 `.bin`；PATH 上也没有。找不到就打印 `RC=127 NO_BIN_AT=…` 并计入红 ——
 *    "没跑成"被读成"跑过了"是本项目最贵的一类错。
 * 3. **类型检查的命令从各包 `package.json` 里读回来，不在这里抄字面量**。上一轮这一族五个包
 *    被写成 `-p tsconfig.json`，而真源是 `-p tsconfig.spec.json`（含 `tests/`）⇒ 那五步是**恒绿的
 *    虚检查**，新测试里的 TS2345 靠手动跑才现形。抄就会漂，所以取真源；而单测那六条是
 *    `vitest run` 的二进制路径注入版，于是**预检要问它和真源是否还一致**，不一致就响亮报红。
 *
 * ⚠️ e2e 那一族的载体是 `vite preview --outDir dist`（见 `e2e/playwright.detail-pane.config.ts`），
 *    所以它前面必须有两步 `build web`。跳过那两步 ⇒ 量的是上一轮的产物。
 *
 * 不挂进 `pnpm check`：它要跑真浏览器、要重打产物，而且是**这一族**的收尾，不是仓库级门禁。
 * 跑法见 `docs/plans/detail-pane-alignment.md` §8.110。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');

const PACKAGES = [
  'packages/domain',
  'packages/app-host',
  'packages/i18n',
  'packages/ui',
  'apps/web',
  'apps/mobile',
];

function pkgScript(pkg, key) {
  const file = path.join(ROOT, pkg, 'package.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return json.scripts?.[key];
}

// 只重建"本族的 src 会变、又被 `apps/web` 的产物静态吃进去"的四枚库包（顺序=依赖序）。
// `packages/storage|op-log|sync-*|shared-schema` 不在本族射程里 —— 它们的 dist 由 `pnpm -r build` 管，
// 这一族不碰它们；哪天碰了，这里要一起加，否则第 27 条那个形状会原地复发。
const BUILD_PKGS = ['packages/domain', 'packages/i18n', 'packages/ui', 'packages/app-host'];

// 证据图守卫的快照落在带 pid 的一次性路径上：两个并行电池不会互相覆盖，
// 而"读不到快照"必须是 exit 2（PROBE_BROKEN），不能读成"这趟没改写任何图"。
const EVG = path.join(os.tmpdir(), `dp-evidence-${process.pid}.json`);

const STEPS = [
  // 门禁：本单直接相关的两条在前（分层 + 选中态单一来源），再带上会串行触发的三道样式门。
  ['gate layering', '.', 'node scripts/check-layering.mjs'],  ['gate selection-single-source', '.', 'node scripts/check-selection-single-source.mjs'],
  ['gate l4', '.', 'node scripts/check-l4-no-style.mjs'],
  ['gate row-single-source', '.', 'node scripts/check-row-single-source.mjs'],
  // 棘轮的**另一半**（不许把基线本身抬高）：上面两步守"实测 ≤ 基线"，这一步守"基线 ≤ 锚点"。
  // 不进电池的话，它就是一道"有脚本、没消费者"的门禁（工单 §8.72 那本账数过这一档）。
  ['gate ratchet-ceilings', '.', 'node scripts/check-ratchet-ceilings.mjs'],
  ['gate design', '.', 'node design-system/heyta/check-hardcoded.mjs'],
  ['gate ui-language', '.', 'node scripts/check-ui-language.mjs'],
  ['gate migrations', '.', 'node scripts/check-migrations.mjs'],
  ['build token-gen', 'packages/design-system', './node_modules/.bin/tsup --config tsup.generate.config.ts'],
  ['gate tokens', 'packages/design-system', 'node dist/generate-cli.js --check'],
  // 🔴 这四步补的是一个洞：`build web vite` 打进产物的是 **`packages/*/dist`**，不是 `src`。
  //   这一族改了 `packages/domain` 与 `packages/app-host` 而电池只重打 web ⇒ 后面的 typecheck、
  //   单测与 e2e 量的是旧 bundle，正是 AGENTS §7 第 27 条（"测试全绿 ≠ 这是当前产物"）
  //   在我自己的电池里复发。顺序按依赖：domain → i18n → ui → app-host（后三者的 dts 要读前者 dist）。
  //   命令从各包 `package.json` 的 `build` 真源读回来对账（纪律 3），不一致就响亮报红。
  ...BUILD_PKGS.map((p) => [`build ${p.split('/')[1]}`, p, './node_modules/.bin/tsup']),
  ...PACKAGES.map((p) => [`typecheck ${p}`, p, `./node_modules/.bin/${pkgScript(p, 'typecheck')}`]),
  ...PACKAGES.map((p) => [`test ${p.split('/')[1]}`, p, './node_modules/.bin/vitest run']),
  ['build web tsc -b', 'apps/web', './node_modules/.bin/tsc -b'],
  ['build web vite', 'apps/web', './node_modules/.bin/vite build'],
  // e2e 这一族的类型检查：Playwright 走 esbuild 只转译不查类型，以前这一族没有类型载体。
  ['typecheck e2e family', 'e2e', '../apps/web/node_modules/.bin/tsc --noEmit -p tsconfig.detail-pane.json'],
  // 证据图守卫包在 e2e 那一族**两侧**：跑之前记下每一枚的字节与"当时是不是已经脏着"，
  // 跑之后只还原"这一趟改写的"那几枚（跑前就脏的一格不动）。工单 #40，判据臂台
  // `research/tools/mutation-rigs/mutate-evidence-guard.mjs` 四臂 + 收尾零残留。
  ['evidence snapshot', '.', `node scripts/verify-detail-pane-evidence-guard.mjs --snapshot ${EVG}`],
  ['e2e detail-pane family', 'e2e', './node_modules/.bin/playwright test --config playwright.detail-pane.config.ts'],
  ['evidence reconcile', '.', `node scripts/verify-detail-pane-evidence-guard.mjs --reconcile ${EVG}`],
];

const bad = [];

// 预检一：那六条 test 步骤假设各包的 `test` 脚本就是 `vitest run`。谁改成别的（加 --coverage、
// 换 tsx），这里就报出来，而不是让六条继续跑一份没人声明的命令。
for (const p of PACKAGES) {
  const declared = pkgScript(p, 'test');
  if (declared !== 'vitest run') {
    console.log(`PREFLIGHT=${p} test_script=${JSON.stringify(declared)} != 'vitest run'`);
    bad.push(`preflight:${p}`);
  }
  console.log(`PREFLIGHT=${p} typecheck=${pkgScript(p, 'typecheck')}`);
}

// 预检二：步骤表自检。生成器产出 0 条时电池不会红，只会**静默少跑六条类型检查**——
// 和上一轮那五条虚检查同一个形状。期望值必须是**从 PACKAGES 推导的不变量**，不是写死的数字：
// 加第 25 步之后写死的 `expect=6` 立刻变成一条自己会红的假判据。
const names = new Set(STEPS.map((s) => s[0]));
const missingTc = PACKAGES.filter((p) => !names.has(`typecheck ${p}`));
if (missingTc.length) {
  console.log(`SELF_CHECK missing_typecheck_steps=${missingTc.join(',')}`);
  bad.push('self-check:missing-typecheck');
} else {
  const extra = STEPS.filter((s) => s[0].startsWith('typecheck ')).length - PACKAGES.length;
  console.log(`SELF_CHECK typecheck_steps=${PACKAGES.length} 包全覆盖，额外 ${extra} 条`);
}
const missingTest = PACKAGES.filter((p) => !names.has(`test ${p.split('/')[1]}`));
if (missingTest.length) {
  console.log(`SELF_CHECK missing_test_steps=${missingTest.join(',')}`);
  bad.push('self-check:missing-test');
} else {
  console.log(`SELF_CHECK test_steps=${PACKAGES.length} 包全覆盖`);
}

// 预检一之三：证据图守卫必须**包在** e2e 那一族两侧。顺序错了不会报错，只会静默失效 ——
// 快照在 e2e 之后取 ⇒ 每一枚都"跑前就干净、之后没变"，还原集合恒空，那这条守卫就只是装饰。
{
  const idx = (n) => STEPS.findIndex((s) => s[0] === n);
  const [iSnap, iE2e, iRec] = [idx('evidence snapshot'), idx('e2e detail-pane family'), idx('evidence reconcile')];
  const ordered = iSnap >= 0 && iRec >= 0 && iE2e >= 0 && iSnap < iE2e && iE2e < iRec;
  if (!ordered) {
    console.log(`SELF_CHECK 证据守卫顺序不成立 snapshot=${iSnap} e2e=${iE2e} reconcile=${iRec}`);
    bad.push('self-check:evidence-guard-order');
  } else {
    console.log(`SELF_CHECK 证据守卫包在 e2e 两侧（${iSnap} < ${iE2e} < ${iRec}）`);
  }
}

// 预检一之二：那四条 build 步骤假设各库包的 `build` 脚本就是 `tsup`（纪律 3：命令从真源读回来对账）。
// 谁把它改成 `tsup && node x.mjs`，这里就报出来，而不是让那四步继续跑一份没人声明的命令。
const buildDrift = BUILD_PKGS.filter((p) => pkgScript(p, 'build') !== 'tsup');
if (buildDrift.length) {
  for (const p of buildDrift) {
    console.log(`PREFLIGHT=${p} build_script=${JSON.stringify(pkgScript(p, 'build'))} != 'tsup'`);
  }
  console.log('SELF_CHECK=FAIL 那四条 build 步骤的命令与真源不一致 ⇒ 它们量的是没人声明的东西');
  process.exit(1);
}
console.log(`SELF_CHECK build_steps=${BUILD_PKGS.length} 包 build 脚本逐一对上真源（tsup）`);

// 预检三：日志文件名撞车会把前一步的读数盖掉（步骤名里带 `/`，直接拼就是往不存在的目录写）。
const slugs = STEPS.map((s) => s[0].replace(/[^A-Za-z0-9_.-]/g, '_'));
const dupes = [...new Set(slugs.filter((s, i) => slugs.indexOf(s) !== i))];
console.log(`SELF_CHECK steps=${STEPS.length} log_names=${slugs.length} unique=${new Set(slugs).size} dupes=${dupes.join(',') || 'none'}`);
if (dupes.length) bad.push('self-check:log-name-collision');

// 🔴 `--list`：只报名册就退出，不跑任何一步。理由不是省事：文档里"这条命令是 N 步"是一句
// 需要现量的抄件（工单 §8.109 规则 1），而取这个数的**唯一旧办法**是跑完整趟 —— 它要几分钟，
// 还会原地重写 `apps/web/evidence/` 里那批"人看过"的截图。拿一个步数要付这个代价，
// 结果就是没人去拿，散文里的数字开始漂。
if (process.argv.includes('--list')) {
  console.log(`ROOT=${ROOT}`);
  console.log(`LIST_ONLY steps=${STEPS.length}`);
  for (const [name, cwd, cmd] of STEPS) console.log(`  ${name} :: cd ${cwd} :: ${cmd}`);
  if (bad.length) console.log('BATTERY_RESULT=' + `RED:${bad.join(',')}`);
  process.exit(bad.length ? 1 : 0);
}

const LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'heyta-detail-pane-battery-'));
console.log(`ROOT=${ROOT}`);
console.log(`LOG_DIR=${LOG_DIR}`);

for (const [name, cwd, cmd] of STEPS) {
  const log = path.join(LOG_DIR, `${name.replace(/[^A-Za-z0-9_.-]/g, '_')}.log`);
  const first = cmd.split(' ')[0];
  if (first.startsWith('./') && !fs.existsSync(path.join(ROOT, cwd, first))) {
    console.log(`STEP=${name} RC=127 NO_BIN_AT=${cwd}/${first}`);
    bad.push(name);
    continue;
  }
  const fd = fs.openSync(log, 'w');
  const rc = spawnSync(cmd, {
    cwd: path.join(ROOT, cwd),
    shell: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, NO_COLOR: '1' },
  }).status;
  fs.closeSync(fd);
  const lines = fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.trim());
  let extra = '';
  // 棘轮那两道光看"绿"不够，要现量打印它此刻是多少。
  if (name === 'gate l4' || name === 'gate row-single-source') {
    extra =
      ' || ' +
      lines
        .filter((l) => l.includes('/') && /\d/.test(l))
        .slice(-3)
        .map((l) => l.trim().slice(0, 90))
        .join(' / ');
  }
  // 🔴 棘轮上限这一道要现量报**三个基线此刻各是多少 vs 锚点多少**：只报 `RC=0` 回答不了
  //    "这一趟到底有没有人动过常数"，而那正是它管的事（§8.82 的 A/B：绿灯和"基线被抬高了"
  //    在原读数上长得一模一样）。
  if (name === 'gate ratchet-ceilings') {
    extra = ' || ' + lines.filter((l) => l.includes('基线')).map((l) => l.trim().replace(/\s+/g, ' ').slice(0, 58)).join(' / ');
  }
  // 🔴 单测那六条不能打印"最后一行"：vitest 的末行是 `learn more: https://…`，
  // 它既不含条数也不含失败数 —— 打印它等于把这一族的判据条数从读数里丢掉。
  // 判绿本来就只认退出码，但这一行要能回答"跑了几条"。
  if (name.startsWith('test ') || name.startsWith('e2e ')) {
    const sum = lines.filter((l) => /\b\d+ (passed|failed|skipped)\b/.test(l)).at(-1);
    if (sum) extra = ' || ' + sum.trim().slice(0, 110);
  }
  console.log(`STEP=${name} RC=${rc} ${(lines.at(-1) ?? '').slice(0, 110)}${extra}`);
  if (rc !== 0) bad.push(name);
}

// 🔴 副作用要响亮报：e2e 那一族的用例会把 `apps/web/evidence/` 下的截图**原地重写**。
// 那些图是"人看过"的那一趟的载体，一次电池重跑不构成重新出证据 ⇒ 报数，由跑的人决定
// 留哪一版（不留就 `git restore`）。不报数的话，下一轮会看见 11 枚 `M` 而不知道是谁写的。
const dirtyEvidence = spawnSync('git', ['status', '--porcelain', '--', 'apps/web/evidence'], {
  cwd: ROOT,
  encoding: 'utf8',
}).stdout.trim().split('\n').filter(Boolean).length;
console.log(
  `EVIDENCE_DIRTY=${dirtyEvidence}（守卫已把这一趟改写的还原回提交态；这里还剩 N>0 枚说明它们**不是**这一趟写的 —— 是别人的在途证据，不许顺手还原）`,
);

console.log('BATTERY_RESULT=' + (bad.length ? `RED:${bad.join(',')}` : 'ALL_GREEN'));
process.exit(bad.length ? 1 : 0);
