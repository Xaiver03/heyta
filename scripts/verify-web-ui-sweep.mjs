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
 * `assertions` 键数，别在这里抄数）。这一枚只做三件包装者该做的事：
 *   1. 起一棵**只服务当前源码**的 vite（端口向系统要一枚空的，不占别人的固定号）；
 *   2. 按**无头**那一档跑（AGENTS §6.2 规定二：不得抢前台）；
 *   3. 收尾**只按自己 spawn 回来的那枚 pid** 关，并回读端口确认真释放了
 *      —— 绝不按名字 kill，同一棵树上别的会话也在跑自己的 vite。
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
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = join(import.meta.dirname, '..');
const RIG = join(ROOT, 'scripts/qa/reminders-data-responsive.mjs');
const DEFAULT_EVIDENCE = join(ROOT, 'apps/web/evidence/web-ui-sweep-latest');
// 指定的落点按 ROOT 解析：从 `apps/web` 里调用这枚入口时，相对路径不该落到别处去。
const EVIDENCE = process.env.HEYTA_WEB_UI_SWEEP_EVIDENCE
  ? resolve(ROOT, process.env.HEYTA_WEB_UI_SWEEP_EVIDENCE)
  : DEFAULT_EVIDENCE;

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
process.exit(rigCode ?? 1);
