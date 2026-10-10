#!/usr/bin/env node
/**
 * verify:web-ui-sweep —— 五条 Web 界面腿的整族取证 + 深浅两层主题对账的**入口**。
 * ==================================================================
 *
 * 回答的问题：设置面那五条旅程（提醒五态 / 数据管理 / 分组走查四组 / 关于与帮助长标题 /
 * 同步与隐私三决定态）在**真浏览器 + 当前源码**里画出来的是不是它们各自声称的样子，
 * 且暗档那两层（CSS 层与共享层）都真的跟着档位走。
 *
 * 🔴 判据**不在这个文件里**，一条都不写。全部住在
 * `scripts/qa/reminders-data-responsive.mjs`（条数现量：跑完后读 `report.json` 的
 * `assertions` 键数，别在这里抄数）。这一枚只做四件包装者该做的事：
 *   1. 起一棵**只服务当前源码**的 vite（端口向系统要一枚空的，不占别人的固定号）；
 *   2. 按**无头**那一档跑（AGENTS §6.2 规定二：不得抢前台）；
 *   3. 收尾**只按自己 spawn 回来的那枚 pid** 关，并回读端口确认真释放了
 *      —— 绝不按名字 kill，同一棵树上别的会话也在跑自己的 vite。
 *   4. 跑完后对账一次**读数与图同批**（`reportBatchProblems`）—— 它不判界面，判的是
 *      "这份被提交的报告指着的图是不是这一趟的"，因为默认落点每轮被这枚入口自己 `rm` 掉。
 *
 * 用法：
 *   pnpm verify:web-ui-sweep                      # 整族五条腿
 *   HEYTA_RESPONSIVE_LEGS=groups,help …           # 选腿旋钮直接透传（装置自己的旋钮）
 *   HEYTA_WEB_UI_SWEEP_EVIDENCE=<目录>            # 换落点（默认见下）
 *
 * 落点默认 `apps/web/evidence/web-ui-sweep-latest/`：这枚目录**每轮由本脚本自己清掉重建**，
 * 且已写进 `.gitignore` —— 它是一次运行的产物，不是入库证据。要入库的读数请显式指一个
 * 带趟号的落点（本账的惯例：`apps/web/evidence/sync-privacy-leg-<日期>-rNN-<用途>/report.json`），
 * 因为装置对"会就地改写已跟踪证据"是**起跑前响亮拒绝**的（那一步写在装置里）。
 * ⚠️ **指定的落点本脚本一律不删** —— 那道拒绝是承重的，入口先 `rm` 就等于替它绕过去（删证据）。
 *
 * 退出码：来自**被测那一条命令**（装置），不是包装者。AGENTS §7 那条"管道/包装 rc ≠ 被测 rc"
 * 在这里的形状就是"vite 关掉了、脚本却退 0"或反过来，所以 `rigCode` 一路直传到最终 `process.exit`。
 *
 * 刻意**不进** `pnpm check`：它要起浏览器与自己那棵 vite（一趟按当前装置约数分钟），
 * 与 `verify:web-auth` / `verify:multi-end` / `verify:legal-links` 同一条理由。
 * 但它是 `scripts/check-journey-coverage.mjs` 里 web 端的一条**已登记入口** ——
 * 入口被删/改名会红，这条才是它进门禁的方式（执行与否由负责人/跑的人决定）。
 *
 * 变异臂（证明这条入口自己有牙，而不是只会打印 OK）：
 *   HEYTA_RESPONSIVE_LEGS=nosuchleg pnpm verify:web-ui-sweep
 *   ⇒ 装置在选腿校验那一步抛错 ⇒ 本脚本必须**非 0** 退出，且回读端口为空
 *     （= 被测命令红了以后，包装者没有把 vite 漏在后台）。
 *   2026-10-10 实测读数记在计划台账里那一格，不写在这里（写在这里就会漂）。
 *
 * `node scripts/verify-web-ui-sweep.mjs --self-test` —— **只**验第 4 件（读数与图同批那条对账）
 * 能不能红：在系统临时目录造报告、逐臂断言问题编号，不起浏览器、不碰仓内证据、跑完自己清掉。
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = join(import.meta.dirname, '..');
const RIG = join(ROOT, 'scripts/qa/reminders-data-responsive.mjs');
const DEFAULT_EVIDENCE = join(ROOT, 'apps/web/evidence/web-ui-sweep-latest');
// 指定的落点按 ROOT 解析：从 `apps/web` 里调用这枚入口时，相对路径不该落到别处去。
const EVIDENCE = process.env.HEYTA_WEB_UI_SWEEP_EVIDENCE
  ? resolve(ROOT, process.env.HEYTA_WEB_UI_SWEEP_EVIDENCE)
  : DEFAULT_EVIDENCE;

/**
 * 装置给锚点加的落点前缀与这枚入口刚建的那枚目录必须指同一处，所以比较前先按**装置自己的规则**
 * 归一（仓内→仓内相对、仓外→绝对），否则仓外落点（例行复跑那条出路）会被下面的对账误报成指错批。
 */
function evidenceLabel() {
  const rel = relative(ROOT, EVIDENCE).split(sep).join('/');
  return !rel || rel.startsWith('..') ? EVIDENCE : rel;
}

/**
 * 「图与读数同批」这一格从手承诺换成这条入口自己判（10-10 02:5x 现量立起来的）。
 * 起因是在册那份 r49 的 `report.json`：54 枚锚点**全部**指向共用的 `web-ui-sweep-latest/`，
 * 而它自己那批目录里一张图都没有 —— 报告是跑完被人搬到趟号目录的，而默认那趟开头就把 latest
 * 整个 `rm` 掉（见上面 `DEFAULT_EVIDENCE` 那两段）⇒ "人看过的那张图"会跟着别人下一趟换掉，
 * 而文件里没有任何一行说出这件事。判两件事，缺一即红：
 * ① 报告自报的批次身份 `carrier.evidenceDir` 必须等于本趟落点；
 * ② 报告里每一枚落在本批目录的锚点必须真的存在，**且一枚都不许没有** ——
 *   空集合会让 ② 对任何坏形状都判真（同账里 `.every` 对空集合判真那条教训的镜像）。
 * 只在装置退 0 时才判：产品红的那趟可能确实没截到图，那种红不该被读成"入口坏了"。
 */
async function reportBatchProblems(reportPath, label) {
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const problems = [];
  const declared = report?.carrier?.evidenceDir;
  if (declared !== label) {
    problems.push(`报告自报落点=${String(declared)}，本趟落点=${label}（①）`);
  }
  const prefixes = [`${label}/`, `machine-only:${label}/`];
  const anchors = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const value of node) walk(value);
      return;
    }
    if (node && typeof node === 'object') {
      for (const value of Object.values(node)) walk(value);
      return;
    }
    if (typeof node === 'string' && prefixes.some((p) => node.startsWith(p))) anchors.push(node);
  };
  walk(report);
  const missing = anchors.filter((a) => {
    const bare = a.replace(/^machine-only:/, '');
    return !existsSync(bare.startsWith('/') ? bare : join(ROOT, bare));
  });
  if (anchors.length === 0) {
    problems.push(`报告里没有一枚指向本批目录（${label}）的锚点 ⇒ 这条对账无事可判（②）`);
  } else if (missing.length > 0) {
    problems.push(`${missing.length}/${anchors.length} 枚锚点指不到文件，首枚=${missing[0]}（②）`);
  }
  return problems;
}

/**
 * `--self-test`：不起浏览器、不碰仓内证据，只在系统临时目录里造报告，逐臂问上面那条对账
 * **能不能红**。断言的是问题的**编号**（①/②）不是措辞；臂数由它自己打印，别抄进文档。
 * 这条入口刻意不进 `pnpm check`（它要起浏览器），所以"能红"这件事只能由这一档自己证明。
 */
async function runSelfTest() {
  const dir = await mkdtemp(join(tmpdir(), 'heyta-batch-identity-'));
  const label = dir;
  // 仓内真存在的两枚文件：让"锚点存在"这一半有真输入，而不是靠空集合蒙过。
  const realAnchor = join(dir, 'leg-a-1.png');
  await writeFile(realAnchor, 'png-placeholder');
  const machineOnlyAnchor = join(dir, 'leg-b-1.png');
  await writeFile(machineOnlyAnchor, 'png-placeholder');

  const arms = [
    {
      name: 'control（自报落点一致 + 一枚真存在的锚点）',
      report: { carrier: { evidenceDir: label }, legs: { a: [realAnchor] } },
      expect: [],
    },
    {
      name: '① 报告自报的是别那一批的落点',
      report: { carrier: { evidenceDir: 'apps/web/evidence/some-other-run' }, legs: { a: [realAnchor] } },
      expect: ['（①）'],
    },
    {
      name: '② 落点对但锚点指不到文件',
      report: { carrier: { evidenceDir: label }, legs: { a: [join(dir, 'never-captured.png')] } },
      expect: ['（②）'],
    },
    {
      name: '② 一枚本批锚点都没有（空集合不许判真）',
      report: { carrier: { evidenceDir: label }, legs: { a: ['machine-only:/somewhere/else/x.png'] } },
      expect: ['（②）'],
    },
    {
      name: 'machine-only: 前缀那枚真存在的锚点不许被误报',
      report: { carrier: { evidenceDir: label }, legs: { a: [`machine-only:${machineOnlyAnchor}`] } },
      expect: [],
    },
    {
      name: '① 旧那批报告根本没有 carrier 这枚字段（新字段是承重的）',
      report: { legs: { a: [realAnchor] } },
      expect: ['（①）'],
    },
  ];

  let failures = 0;
  for (const arm of arms) {
    const reportPath = join(dir, `report-${arm.name.charCodeAt(0)}.json`);
    await writeFile(reportPath, JSON.stringify(arm.report));
    let problems;
    try {
      problems = await reportBatchProblems(reportPath, label);
    } catch (error) {
      console.error(`SELFTEST ARM=throw ${arm.name} —— ${error.message}`);
      failures += 1;
      continue;
    }
    const wanted = arm.expect.length;
    const hitMarkers = arm.expect.filter((marker) => problems.some((p) => p.includes(marker)));
    const ok = problems.length === wanted && hitMarkers.length === wanted;
    if (!ok) failures += 1;
    console.log(
      `${ok ? '✅' : '🔴'} SELFTEST ${arm.name} ⇒ 问题数=${problems.length}（期望 ${wanted}）` +
        (problems.length ? `：${problems.join(' ｜ ')}` : ''),
    );
  }
  console.log(`SELFTEST ARMS=${arms.length} FAILED=${failures}`);
  await rm(dir, { recursive: true, force: true });
  return failures === 0 ? 0 : 1;
}

if (process.argv.includes('--self-test')) {
  process.exit(await runSelfTest());
}

/** 向系统要一枚空端口；拿到就关掉监听，只借用那个号（不猜固定号，避免撞别人的 vite）。 */
function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;

// 🔴 只清**自己那枚默认落点**。调用方指定的落点一律不删：装置对"会就地改写已跟踪证据"是
// 起跑前响亮拒绝的，入口要是先 `rm -rf`，就等于替它把那道门绕过去 —— 那是删证据，不是清缓存。
if (EVIDENCE === DEFAULT_EVIDENCE && existsSync(EVIDENCE)) await rm(EVIDENCE, { recursive: true, force: true });
await mkdir(EVIDENCE, { recursive: true });

const vite = spawn(join(ROOT, 'apps/web/node_modules/.bin/vite'),
  ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: join(ROOT, 'apps/web'), stdio: ['ignore', 'pipe', 'pipe'], detached: false });
let viteOut = '';
vite.stdout.on('data', (b) => { viteOut += b.toString(); });
vite.stderr.on('data', (b) => { viteOut += b.toString(); });
vite.on('exit', (code) => console.error(`[入口] vite 退出 code=${code}（若在装置之后，属正常收尾）`));

// 有界等待那一行 ready；等不到就**响亮失败**，不降级成"没服务也照样跑"。
let ready = false;
for (let i = 0; i < 90 && !ready; i += 1) {
  if (/ready in/i.test(viteOut)) ready = true;
  else await sleep(1000);
}
if (!ready) {
  console.error('RESULT=VITE_NOT_READY —— 这棵树的 vite 起不来，下面的读数一条都不存在');
  console.error(viteOut.slice(0, 400));
  vite.kill('SIGTERM');
  process.exit(1);
}

const rig = spawn(process.execPath, [RIG], {
  stdio: 'inherit',
  env: {
    ...process.env,
    HEYTA_RESPONSIVE_HEADED: '0',
    HEYTA_RESPONSIVE_ORIGIN: origin,
    HEYTA_RESPONSIVE_EVIDENCE: EVIDENCE,
  },
});
const rigCode = await new Promise((res) => rig.on('exit', (code) => res(code)));

// 收尾：只关自己 spawn 的那枚 pid。回读端口，确认它真的没了（漏在后台是这条入口自己的缺陷）。
vite.kill('SIGTERM');
let released = false;
for (let i = 0; i < 20 && !released; i += 1) {
  await sleep(500);
  released = await new Promise((res) => {
    const probe = createServer();
    probe.once('error', () => res(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => res(true)));
  });
}
if (!released) {
  console.error(`RESULT=VITE_PORT_STILL_HELD ${port} —— 端口没释放，这一趟的收尾不算完成`);
  process.exit(1);
}

const leftovers = await readdir(EVIDENCE).catch(() => []);
console.log(`RESULT=${rigCode === 0 ? 'OK' : 'FAIL'} rig_rc=${rigCode} origin=${origin} port_released=yes evidence=${leftovers.length} 枚`);
if (rigCode === 0 && !leftovers.includes('report.json')) {
  // 装置退 0 却没交 report.json：那是"判据一条都没跑完"的形状，不许读成通过。
  console.error('RESULT=NO_REPORT_WITH_RC0 —— 退出码与读数不自洽');
  process.exit(1);
}

if (rigCode === 0 && leftovers.includes('report.json')) {
  const problems = await reportBatchProblems(join(EVIDENCE, 'report.json'), evidenceLabel());
  if (problems.length > 0) {
    console.error(`RESULT=REPORT_NOT_SAME_BATCH_AS_IMAGES —— 装置退 0，但这份读数指不到自己那批的图：${problems.join(' ｜ ')}`);
    process.exit(1);
  }
}
process.exit(rigCode ?? 1);
