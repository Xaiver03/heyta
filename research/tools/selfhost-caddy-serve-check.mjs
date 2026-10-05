#!/usr/bin/env node
/**
 * G-68：compose 里那枚 `caddy` 服务 + 仓库这份 `server/Caddyfile`，**从来没被真跑过**。
 *
 * 外人照 runbook 走的第一步就是 `docker compose up -d`，而那条命令的服务图里**有** caddy：
 * 它占 :80/:443、`cap_drop: ALL`、健康检查打 admin `127.0.0.1:2019`、Caddyfile 头三行注释
 * 明写"改 admin 绑定就会 restart-loop"。而 `verify-selfhost-stack.sh` 是**故意**不起它的
 * （它直连 :1900 验应用），所以这些承诺一句都没有读数。
 *
 * ## 形状从 compose 推导，不在这里抄一份
 * `caddy:2.11-alpine`、`ports` 的容器侧端口、healthcheck 的 `test`/`interval`/`timeout`/
 * `retries`/`start_period`、`cap_drop`/`cap_add`、`mem_limit`、Caddyfile 的挂载路径 ——
 * 全部现读 `server/docker-compose.yml` 的 caddy 块。**任一字段读不到就红**：
 * "推导不出来"和"跑绿了"是两件事，后者不该顺手把形状漂移吸收掉。
 *
 * ## 与出货形状的四条差异（判据只覆盖到差异之外）
 * 1. 用 `docker run` 起单容器，不是 `compose up`（不动那三条 -f 叠出来的服务图）；
 * 2. `DOMAIN` 取 `:<容器侧端口>` 而不是真实 https 域名 ⇒ **不覆盖签证书那一条**；
 * 3. 宿主侧把该端口发布到 `127.0.0.1:<高端口>`，不占主机 :80/:443；
 * 4. `/data`、`/config` 用一次性命名卷，不碰项目的 `caddy-data`/`caddy-config`。
 *
 * ## 判据与变异臂
 * healthy（= compose 那条探针在真 Caddyfile 下不打空）· 经代理取 /app/ 与直连同字节且
 * 数得出 tokens.css 的主蓝 · 经代理取 /health 与直连同形 · 安全头只在代理那侧出现
 * （证 caddy 真在链上）· 带 ?token= 的请求不把明文留在日志 · 仓库那份在 `caddy fmt` 下是 no-op。
 * 三条变异臂各打一条：`admin off` ⇒ 那条健康检查命令必须失败；摘掉日志 filter ⇒
 * 令牌必须被这双眼睛抓到；把注释块与全局块之间的空行塞回去 ⇒ fmt 那条必须判出不一致，
 * 而同一份副本 validate 照旧通过（否则 F 只是 validate 的影子）。臂数由本脚本自己打印，文档里不许抄。
 *
 * ## G-70（2026-10-05 并入本装置）：实时同步那条 WS 升级**穿过这枚 caddy** 了吗
 *
 * `verify-realtime-push.mjs` 早就验过"服务端推、监听端收得到"，但它连的是 **`:1900` 直连**；
 * 而外人照 runbook 起的那套里，界面的实时通道走的是 `wss://域名/api/sync/ws`，
 * **中间隔着这份 Caddyfile 的 `reverse_proxy` + `encode gzip zstd` + 那条日志 filter**。
 * 这一段先前零读数 —— 而它坏了的症状不是报错，是"界面全绿、只是永远等不到推送"。
 *
 * 为什么不另起一台装置：起 caddy 容器的形状（compose 现读、一次性卷、不占 :80/:443、
 * 停容器做归因）在本文件里**已经有一份且只有一个所有者**；另写一份就是本仓反复登记过的
 * "第二套实现一定会漂移"那一族。所以 WS 的腿接在第 2 步之后、复用同一枚 LIVE 容器。
 *
 * 六条腿各自的失效方向（逐条有臂，不许用一条的红代抓另一条）：
 * · 经代理的 WS 能建立，且收到服务端那条 `connected` 握手 ⇒ 帧真的双向过；
 * · **坏令牌**那条连接必须拿不到 `connected` 且以 4003 关闭 ⇒ 证明回话的是服务端的鉴权，
 *   不是代理自己 Fabricate 的一个 101（没有这条，"连上了"可能只是探针打错了对象）；
 * · 上传前那段静默里不许有 `new_ops`（与 verify-realtime-push 同一条反例纪律）；
 * · 另一台设备**经代理**上传一条真 op ⇒ 监听端收到 `new_ops` 且 `latestSeq > 0`；
 * · WS 那次请求在 caddy 日志里必须是 `?REDACTED`，且两个真令牌一个都不许出现 ——
 *   这条比 HTTP 那条更要紧：WS 只能靠 query 带凭据（浏览器不能给升级请求设头），
 *   而那颗令牌 365 天有效、无轮换（Caddyfile 的注释写的就是它）；
 * · 停掉这枚 caddy 之后 WS 连不上、直连那侧照旧 ⇒ 把上面五条的归因钉在 caddy 上。
 * 变异臂也接 G-68 那枚 no-filter 容器：**WS 这条路径**同样必须把泄漏抓出来
 * （HTTP 那条抓不到不代表 WS 也抓不到 —— 两条是不同的代码形状）。
 *
 * ⚠️ 射程边界：上传方用 `apps/node-host` 的真 CLI（真建号、真上传），但**监听端不是浏览器**；
 *   "浏览器里的实时接线真会连"归 `verify:selfhost-stack` 的浏览器腿与 `store.ts` 的闸，不在这里。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import WebSocket from 'ws';

/**
 * 🔴 端点不许在本文件里手拼：引客户端自己的 `buildRealtimeUrl`（与
 * `scripts/verify-realtime-push.mjs` 同一条纪律，理由也抄过来 —— 手拼的话这里测的是
 * "我写的那个字符串对不对"，而真实端点曾经是 `/ws` 还是 `/api/sync/ws` 恰好错过一次）。
 */
import { buildRealtimeUrl } from '../../packages/sync-client/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const COMPOSE_PATH = join(REPO, 'server', 'docker-compose.yml');
const CADDYFILE_HOST = join(REPO, 'server', 'Caddyfile');
const DIRECT_PORT = Number(process.env.HEYTA_G68_DIRECT_PORT ?? 1900);
const DIRECT = `http://127.0.0.1:${DIRECT_PORT}`;
const HOST_PORT = Number(process.env.HEYTA_G68_HOST_PORT ?? 18080);
const PROXY = `http://127.0.0.1:${HOST_PORT}`;
const SEC_HEADERS = ['x-content-type-options', 'x-frame-options', 'referrer-policy'];

const readings = [];
const arms = [];
const mine = { containers: [], volumes: [], dbDir: null };
const claim = (name, expect, got) => arms.push({ name, expect, got, pass: expect === got });
const die = (code, msg) => {
  if (readings.length) console.error(`   已量到的读数：\n${readings.map((r) => `     · ${r}`).join('\n')}`);
  console.error(`❌ ${msg}`);
  process.exit(code);
};

function teardown() {
  for (const name of mine.containers) dockerAllow('rm', '-f', name);
  for (const name of mine.volumes) dockerAllow('volume', 'rm', name);
  if (mine.dbDir) rmSync(mine.dbDir, { recursive: true, force: true });
}
process.on('exit', teardown);
process.on('uncaughtException', (e) => { console.error(`❌ 未捕获异常（不是任何一道判据的拒绝）：${e?.stack ?? e}`); teardown(); process.exit(7); });
process.on('unhandledRejection', (e) => { console.error(`❌ 未接住的 Promise 拒绝：${e?.stack ?? e}`); teardown(); process.exit(7); });

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' });
function dockerAllow(...args) {
  try { return { rc: 0, out: docker(...args) }; }
  catch (e) { return { rc: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, opts) {
  try {
    const res = await fetch(url, opts);
    return { status: res.status, headers: Object.fromEntries(res.headers), body: new Uint8Array(await res.arrayBuffer()) };
  } catch (e) {
    return { status: 0, headers: {}, body: new Uint8Array(), error: String(e) };
  }
}
const text = (b) => new TextDecoder().decode(b);
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 12);

// ── 第 0 步：形状从 compose 的 caddy 块现读（读不到就红，不降级） ─────────────
if (!existsSync(COMPOSE_PATH)) die(2, `读不到 ${COMPOSE_PATH}`);
const composeLines = readFileSync(COMPOSE_PATH, 'utf8').split('\n');
const start = composeLines.findIndex((l) => /^  caddy:$/.test(l));
if (start < 0) die(2, 'compose 里没有 `caddy:` 服务 —— G-68 的落点变了，先查是谁搬的，别把这条读成"已经不需要验了"');
let end = start + 1;
while (end < composeLines.length && !/^ {0,2}\S/.test(composeLines[end])) end += 1;
const block = composeLines.slice(start, end).join('\n');

const grab = (re, what) => {
  const m = block.match(re);
  if (!m) die(2, `compose 的 caddy 块里读不到 ${what} —— 推导前提不成立（形状被改了还是被删了？）。停下，不要改判据。`);
  return m;
};
const IMAGE = grab(/image:\s*\$\{CADDY_IMAGE:-([^}]+)\}/, 'CADDY_IMAGE 的默认值')[1];
const CONTAINER_PORT = grab(/^\s*-\s*'(\d+):(\d+)'/m, 'ports 的第一条 主机:容器')[2];
const HC_CMD = grab(/test:\s*\[(.+)\]/, 'healthcheck 的 test 数组')[1]
  .split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter((s) => s && s !== 'CMD' && s !== 'CMD-SHELL');
const hcSeconds = (key, unit) => Number(grab(new RegExp(`${key}:\\s*(\\d+)${unit}`), `healthcheck 的 ${key}`)[1]);
const capsOf = (key) => [...block.matchAll(new RegExp(`${key}:\\s*\\n((?:\\s*-\\s*\\S+\\n?)+)`, 'g'))]
  .flatMap((m) => m[1].split('\n').map((l) => l.trim().replace(/^-\s*/, '')).filter(Boolean));
const CAP_DROP = capsOf('cap_drop');
const CAP_ADD = capsOf('cap_add');
const MEM = grab(/mem_limit:\s*(\d+)m/, 'mem_limit')[1];
const CADDYFILE_GUEST = grab(/-\s*\.\/Caddyfile:(\/\S+):ro/, 'Caddyfile 的只读挂载目标路径')[1];
if (!existsSync(CADDYFILE_HOST)) die(2, `compose 挂载的 ${CADDYFILE_HOST} 不存在`);
if (CAP_DROP.join() !== 'ALL') die(2, `compose 的 caddy cap_drop 不再是 [ALL]（现读 [${CAP_DROP}]）—— 本脚本按"全降 + 显式 cap_add 起容器"写，先看清是谁放的`);
if (!CAP_ADD.includes('NET_BIND_SERVICE')) die(2, `cap_add 里没有 NET_BIND_SERVICE（现读 [${CAP_ADD}]）⇒ 容器内绑 :${CONTAINER_PORT} 这件事已不是原形状要证的那件事`);
readings.push(`compose 形状现读：image=${IMAGE} 容器侧 :${CONTAINER_PORT} 挂载 ${CADDYFILE_GUEST}:ro 探针=[${HC_CMD.join(' ')}]（间隔 ${hcSeconds('interval', 's')}s、超时 ${hcSeconds('timeout', 's')}s、重试 ${hcSeconds('retries', '')} 次、宽限 ${hcSeconds('start_period', 's')}s）cap_drop=[${CAP_DROP}] cap_add=[${CAP_ADD}] mem=${MEM}m`);

function stackNetwork() {
  const named = dockerAllow('network', 'inspect', 'super-sync-server_internal', '--format', '{{.Name}}');
  if (named.rc === 0) return named.out.trim();
  const viaServer = dockerAllow('inspect', 'supersync-server', '--format', '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}');
  if (viaServer.rc === 0 && viaServer.out.trim()) return viaServer.out.trim().split(/\s+/)[0];
  die(3, '找不到栈的 internal 网络 —— 这一跑必须挂在真栈上；自建一个空网会把"解析不到 supersync"读成产品失败');
}
const NETWORK = stackNetwork();

function runCaddy(name, caddyfile, bindPort = CONTAINER_PORT) {
  const args = ['run', '-d', '--name', name, '--network', NETWORK,
    '-v', `${caddyfile}:${CADDYFILE_GUEST}:ro`,
    '-v', `${name}-data:/data`, '-v', `${name}-config:/config`,
    '--cap-drop=ALL', '--health-cmd', HC_CMD.join(' '),
    '--health-interval', `${hcSeconds('interval', 's')}s`, '--health-timeout', `${hcSeconds('timeout', 's')}s`,
    '--health-retries', String(hcSeconds('retries', '')), '--health-start-period', `${hcSeconds('start_period', 's')}s`,
    '-e', `DOMAIN=:${bindPort}`, '-p', `127.0.0.1:${HOST_PORT}:${bindPort}`];
  for (const c of CAP_ADD) args.push('--cap-add', c);
  args.push('--memory', `${MEM}m`, IMAGE);
  mine.containers.push(name);
  mine.volumes.push(`${name}-data`, `${name}-config`);
  const id = docker(...args).trim();
  if (!id) die(4, `docker run 没回容器 id：${name}`);
  return id;
}
const healthStatus = (name) => dockerAllow('inspect', name, '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}').out.trim() || 'gone';
async function waitHealthy(name, budgetMs) {
  const t0 = Date.now();
  let last = 'none';
  while (Date.now() - t0 < budgetMs) {
    last = healthStatus(name);
    if (last === 'healthy' || last === 'unhealthy') break;
    await sleep(1500);
  }
  if (last !== 'healthy') {
    die(5, `${name} 没到 healthy（终态 ${last}，${Date.now() - t0}ms）。健康检查日志：${dockerAllow('inspect', name, '--format', '{{json .State.Health}}').out}\n容器日志：\n${dockerAllow('logs', '--tail', '20', name).out}`);
  }
  return last;
}
async function waitServed(budgetMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    const r = await get(`${PROXY}/health`);
    if (r.status === 200) return r;
    await sleep(1500);
  }
  return { status: 0 };
}

// ── 第 1 步：前提：直连那侧的应用真活着（否则代理的失败会冒充产品的失败） ──────
const directHealth = await get(`${DIRECT}/health`);
if (directHealth.status !== 200) die(3, `直连 ${DIRECT}/health = ${directHealth.status} —— 栈没在跑就先起（scripts/verify-selfhost-stack.sh --keep）`);
readings.push(`直连前提：${DIRECT}/health = 200（${directHealth.body.length} 字节）`);

// ── 第 2 步：主判据 ──────────────────────────────────────────────────────────
const validate = spawnSync('docker', ['run', '--rm', '-v', `${CADDYFILE_HOST}:${CADDYFILE_GUEST}:ro`,
  '-e', `DOMAIN=:${CONTAINER_PORT}`, IMAGE, 'caddy', 'validate', '--config', CADDYFILE_GUEST, '--adapter', 'caddyfile'],
  { encoding: 'utf8' });
if (validate.status !== 0) die(4, `仓库那份 Caddyfile 连 caddy validate 都过不了：\n${validate.stdout}${validate.stderr}`);
readings.push(`地板：caddy validate（仓库原文件，未改一字）→ Valid configuration`);

// F（G-69）：caddy 自己的格式化器对仓库那份必须是 no-op。
// 这一条以前只是**打印**：`not formatted; run 'caddy fmt --overwrite'` 在每个 G-68 跑次里
// 都响过，而打印不构成判据 —— 一条永远不会红的读数，和"已经排过格式"在输出上长得一模一样。
// ⚠️ validate/fmt 都必须带 `-e DOMAIN=…`：`{$DOMAIN}` 不设值时展开成空串，那份文件**本来**
//    就报 "server block without any key …"，两版同红 ⇒ 拿它做 A/B 前要先确认探针自己能绿。
const fmtOf = (hostPath) => {
  const r = spawnSync('docker', ['run', '--rm', '-v', `${hostPath}:${CADDYFILE_GUEST}:ro`,
    IMAGE, 'caddy', 'fmt', CADDYFILE_GUEST], { encoding: 'utf8' });
  // ⚠️ `caddy fmt` 对**未排版**的文件是 rc≠0 + 那句警告（不是 rc=0 打印一份不一样的东西）。
  //    所以 rc 与"输出==原文件"两半都要量；更不能把非零当成装置故障 die 掉 ——
  //    非零正是这条判据要抓的那个状态本身（第一版就是这么写的，臂 unformatted 当场把它打回）。
  return { rc: r.status ?? 1, same: r.stdout === readFileSync(hostPath, 'utf8'), out: r.stdout, file: readFileSync(hostPath, 'utf8') };
};
const floor = fmtOf(CADDYFILE_HOST);
const fmtClean = floor.rc === 0 && floor.same;
readings.push(`F caddy fmt：rc=${floor.rc}、输出 ${Buffer.byteLength(floor.out)} B vs 文件 ${Buffer.byteLength(floor.file)} B（逐字一致=${floor.same}）⇒ 判据 ${fmtClean}`);

const LIVE = 'heyta-g68-live';
runCaddy(LIVE, CADDYFILE_HOST);
const healthy = await waitHealthy(LIVE, 90_000);

const probe = dockerAllow('exec', LIVE, ...HC_CMD);
readings.push(`A 出货那条健康检查命令现跑：[${HC_CMD.join(' ')}] → rc=${probe.rc}`);

const proxyApp = await get(`${PROXY}/app/`, { headers: { 'Accept-Encoding': 'identity' } });
const directApp = await get(`${DIRECT}/app/`, { headers: { 'Accept-Encoding': 'identity' } });
const sameBytes = proxyApp.status === directApp.status && sha(proxyApp.body) === sha(directApp.body);
readings.push(`B /app/：代理 ${proxyApp.status} vs 直连 ${directApp.status}；正文 sha256[:12] ${sha(proxyApp.body)} vs ${sha(directApp.body)}`);

const assetPaths = [...new Set([...text(proxyApp.body).matchAll(/(?:src|href)="([^"?#]+)"/g)].map((m) => m[1])
  .filter((p) => !/^(https?:|data:|mailto:)/.test(p))
  .map((p) => { try { return new URL(p, `${PROXY}/app/`).pathname; } catch { return null; } })
  .filter((p) => p && p.startsWith('/')))];
const assets = [];
for (const p of assetPaths) assets.push({ p, ...(await get(PROXY + p, { headers: { 'Accept-Encoding': 'identity' } })) });
const assetFails = assets.filter((a) => a.status !== 200);

const primaryHex = (() => {
  const tokens = readFileSync(join(REPO, 'packages', 'design-system', 'src', 'tokens.css'), 'utf8');
  const first = (name) => tokens.match(new RegExp(`${name}:\\s*([^;\\s]+);`))?.[1].trim();
  let v = first('--ht-color-primary');
  const ind = v?.match(/^var\((--[\w-]+)\)$/);
  if (ind) v = first(ind[1]);
  if (!/^#[0-9a-f]{6}$/i.test(v ?? '')) die(6, `从 tokens.css 解不出主蓝十六进制（现读 ${v}）—— 不许把这条改成写死的色值`);
  return v.toLowerCase();
})();
const blueHits = assets.filter((a) => a.status === 200 && text(a.body).toLowerCase().includes(primaryHex)).map((a) => a.p);
readings.push(`B 资产：HTML 引到 ${assetPaths.length} 个同源资源，经代理非 200 的 ${assetFails.length} 个${assetFails.length ? `（${assetFails.map((a) => `${a.p}:${a.status}`).join(', ')}）` : ''}；含主蓝 ${primaryHex} 的 ${blueHits.length} 个（${blueHits.slice(0, 2).join(', ') || '无'}）`);

const proxyHealth = await get(`${PROXY}/health`);
const sameHealth = proxyHealth.status === directHealth.status && text(proxyHealth.body) === text(directHealth.body);
readings.push(`C /health：代理 ${proxyHealth.status} vs 直连 ${directHealth.status}`);

// D：代理腿与直连腿**必须**在 caddy 那两条指令上不同形 —— 这既证 header/encode 块生效，
//    也排除"回话的其实是别人"。（上一版把"直连也带安全头"当成了反证，实测是错的：
//    应用自己发 SAMEORIGIN，caddy 那条 DENY 是覆盖，差别在**取值**不在有无。）
const proxyGz = await get(`${PROXY}/app/`, { headers: { 'Accept-Encoding': 'gzip' } });
const directGz = await get(`${DIRECT}/app/`, { headers: { 'Accept-Encoding': 'gzip' } });
readings.push(`D X-Frame-Options：代理=${proxyApp.headers['x-frame-options'] ?? '缺席'} vs 直连=${directApp.headers['x-frame-options'] ?? '缺席'}；三条安全头 代理 ${SEC_HEADERS.filter((h) => proxyApp.headers[h]).length}/3、直连 ${SEC_HEADERS.filter((h) => directApp.headers[h]).length}/3；Server 头 代理=${proxyApp.headers['server'] ?? '缺席'} 直连=${directApp.headers['server'] ?? '缺席'}`);
readings.push(`D 编码：代理带 content-encoding=${proxyGz.headers['content-encoding'] ?? '无'}，直连=${directGz.headers['content-encoding'] ?? '无'}`);

const nonce = `synthetic-${randomUUID()}`;
await get(`${PROXY}/health?token=${nonce}`);
await sleep(2500);
const liveLogs = dockerAllow('logs', '--tail', '30', LIVE).out;
const leaked = liveLogs.includes(nonce);
const sawRedacted = /\?REDACTED/.test(liveLogs);
readings.push(`E 日志：合成令牌出现=${leaked}；带 ?REDACTED 的访问日志行在=${sawRedacted}`);

// ── 第 2.5 步：G-70 —— 实时通道那条 WS 升级**穿过这枚 caddy**了吗 ────────────
// 建号与上传都走真客户端（`apps/node-host` 的 CLI），不在这里手写协议；
// 端点用 `buildRealtimeUrl`（文件头写了为什么不许手拼）。口令只从 stdin 进，
// 令牌只用来连，读数里一个都不出现。
const NODE_HOST = join(REPO, 'apps', 'node-host', 'dist', 'cli.js');
if (!existsSync(NODE_HOST)) die(2, `读不到 ${NODE_HOST} ⇒ 上传方就没法用真客户端（先 pnpm --filter @heyta/node-host build），也不许改成手写请求`);

function nodeHost(args, stdin = '') {
  const r = spawnSync(process.execPath, [NODE_HOST, ...args], { cwd: REPO, encoding: 'utf8', input: stdin, maxBuffer: 32 << 20 });
  const line = String(r.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '';
  let json = null;
  try { json = JSON.parse(line); } catch { /* 原样留在 raw 里，判据按 rc 与 json===null 红 */ }
  return { rc: r.status ?? 1, json, raw: line.slice(0, 160), stderr: String(r.stderr ?? '').slice(0, 200) };
}

const wait = (pred, budgetMs, every = 150) => new Promise((res) => {
  const t0 = Date.now();
  const tick = () => (pred() ? res(true) : Date.now() - t0 > budgetMs ? res(false) : setTimeout(tick, every));
  tick();
});

function openProbe(url) {
  const s = { opened: false, frames: [], closeCode: null, error: null };
  const sock = new WebSocket(url);
  sock.on('open', () => { s.opened = true; });
  sock.on('message', (d) => { try { s.frames.push(JSON.parse(String(d))); } catch { s.frames.push({ type: '<非 JSON>' }); } });
  sock.on('close', (c) => { s.closeCode = c; });
  sock.on('error', (e) => { s.error = String(e?.message ?? e).slice(0, 90); });
  return { s, sock };
}

const EMAIL = `g70-${randomUUID().slice(0, 8)}@heyta-selfhost.test`;
const LOGIN_PW = `G70!${randomUUID()}aA9`;
const E2EE_PW = `g70-e2ee-${randomUUID()}`;
const DB_DIR = mkdtempSync(join(tmpdir(), 'heyta-g70-db-'));
mine.dbDir = DB_DIR;
const DB_UPLOADER = join(DB_DIR, 'uploader.sqlite');

const reg = nodeHost(['auth', 'register', '--server', PROXY, '--email', EMAIL, '--terms', '--json'], LOGIN_PW);
const loginUploader = nodeHost(['auth', 'login', '--server', PROXY, '--email', EMAIL, '--json'], LOGIN_PW);
const loginListener = nodeHost(['auth', 'login', '--server', PROXY, '--email', EMAIL, '--json'], LOGIN_PW);
const TOK_UP = loginUploader.json?.token ?? '';
const TOK_LIS = loginListener.json?.token ?? '';
if (!reg.json?.ok || !TOK_UP || !TOK_LIS) {
  die(6, `经代理建号/登录没成（register rc=${reg.rc} ok=${reg.json?.ok}；登录两条 rc=${loginUploader.rc}/${loginListener.rc}）：${reg.raw || reg.stderr || loginUploader.raw}`);
}
readings.push(`W0 经代理建号 + 两次登录：register rc=${reg.rc}、令牌两把都在（长度 ${TOK_UP.length}/${TOK_LIS.length}，值不进读数）`);

const LISTENER_ID = `g70-probe-${randomUUID().slice(0, 8)}`;
const lis = openProbe(buildRealtimeUrl(PROXY, TOK_LIS, LISTENER_ID));
const sawConnected = await wait(() => lis.s.frames.some((m) => m.type === 'connected'), 15_000);
await sleep(3000);
const spuriousBefore = lis.s.frames.filter((m) => m.type === 'new_ops').length;

const bad = openProbe(buildRealtimeUrl(PROXY, 'eyJhbGciOiJub3QtYS10b2tlbiJ9.0.0', `${LISTENER_ID}-bad`));
const badConnected = await wait(() => bad.s.frames.some((m) => m.type === 'connected'), 6000);
await wait(() => bad.s.closeCode !== null, 6000);
bad.sock.close();

const title = `g70-through-caddy-${Date.now().toString(36)}`;
// 🔴 上传方**显式**给一条与监听端不同的 clientId：服务端的广播排除上传者自己，
//    两边同 id 时"没收到"会被读成产品坏了，而真相是探针自己把自己排除了。
const UPLOADER_ID = `g70-uploader-${randomUUID().slice(0, 8)}`;
const globalArgs = ['--db', DB_UPLOADER, '--server', PROXY, '--token', TOK_UP, '--password', E2EE_PW, '--client-id', UPLOADER_ID, '--json'];
const added = nodeHost([...globalArgs, 'add', title]);
const synced = nodeHost([...globalArgs, 'sync']);
const gotPush = await wait(() => lis.s.frames.some((m) => m.type === 'new_ops'), 20_000);
const push = lis.s.frames.find((m) => m.type === 'new_ops');
readings.push(`W1 监听端经代理：open=${lis.s.opened}、收到 connected=${sawConnected}；上传前 new_ops 条数=${spuriousBefore}（应为 0）`);
readings.push(`W2 坏令牌：open=${bad.s.opened}、拿到 connected=${badConnected}、关闭码=${String(bad.s.closeCode)}（期望 4003）`);
readings.push(`W3 上传方经代理 add rc=${added.rc} ok=${String(added.json?.ok)}，sync rc=${synced.rc} ok=${String(synced.json?.ok)}${synced.json?.ok ? '' : `｜原文 ${synced.raw || synced.stderr}`} ⇒ 监听端 new_ops=${gotPush}${push ? `（latestSeq=${String(push.latestSeq)}）` : ''}`);

lis.sock.close();
await sleep(3000);
const wsLogs = dockerAllow('logs', '--tail', '200', LIVE).out;
const wsLogLines = wsLogs.split('\n').filter((l) => l.includes('/api/sync/ws'));
const wsRedacted = wsLogLines.filter((l) => l.includes('?REDACTED')).length;
const wsTokenLeak = wsLogLines.some((l) => l.includes(TOK_LIS) || l.includes(TOK_UP));
readings.push(`W4 caddy 访问日志里 /api/sync/ws 行 ${wsLogLines.length} 条，其中带 ?REDACTED 的 ${wsRedacted} 条；两把令牌出现在这些行里=${wsTokenLeak}`);

claim('控制腿：按 compose 现读形状起容器', 'healthy', healthy);
claim('A 出货那条健康检查命令 rc=0', 0, probe.rc);
claim('B /app/ 经代理与直连同字节', true, sameBytes);
claim('B HTML 引到的同源资源经代理全部可取', 0, assetFails.length);
claim('B 取回的产物里数得出 tokens.css 的主蓝', true, blueHits.length > 0);
claim('C /health 经代理与直连同形', true, sameHealth);
claim('D caddy 的 header 块把 X-Frame-Options 覆盖成 DENY', true, (proxyApp.headers['x-frame-options'] ?? '').toLowerCase() === 'deny');
claim('D 直连那侧不是 DENY（⇒ 代理腿确实经过了它）', true, (directApp.headers['x-frame-options'] ?? '').toLowerCase() !== 'deny');
claim('D encode 指令生效：经代理拿到 gzip', true, (proxyGz.headers['content-encoding'] ?? '').includes('gzip'));
claim('D 直连不带压缩（那一条差异只可能来自 caddy）', undefined, directGz.headers['content-encoding']);
claim('D -Server 生效（代理侧无 Server 头）', undefined, proxyApp.headers['server']);
claim('E 令牌没被写进日志', false, leaked);
claim('E ?REDACTED 那行的确在（不然"没泄漏"是探针没看见）', true, sawRedacted);
claim('F 仓库那份 Caddyfile 在 caddy fmt 下是 no-op', true, fmtClean);
claim('W1 经代理的 WS 升级建立并收到服务端的 connected', true, lis.s.opened && sawConnected);
claim('W1 上传之前不许有 new_ops（反例：推送不是无条件发的）', 0, spuriousBefore);
claim('W2 坏令牌拿不到 connected（那条 101 不是代理自己给的）', false, badConnected);
claim('W2 坏令牌被服务端以 4003 关掉（鉴权真在链上）', 4003, bad.s.closeCode);
claim('W3 上传方经代理 add 成功', true, added.json?.ok === true);
claim('W3 上传方经代理 sync 成功', true, synced.json?.ok === true);
claim('W3 监听端经代理收到 new_ops', true, gotPush);
claim('W3 那条 new_ops 带真实 latestSeq', true, typeof push?.latestSeq === 'number' && push.latestSeq > 0);
claim('W4 WS 那一次的日志行都做了 ?REDACTED', true, wsLogLines.length > 0 && wsRedacted === wsLogLines.length);
claim('W4 两把真令牌都不在 WS 日志行里', false, wsTokenLeak);

dockerAllow('stop', LIVE);
const afterStopProxy = await get(`${PROXY}/app/`);
const afterStopDirect = await get(`${DIRECT}/app/`);
readings.push(`D 停掉这枚 caddy 之后：代理腿=${afterStopProxy.status}（${afterStopProxy.error ?? '无异常'}），直连腿=${afterStopDirect.status} ⇒ 代理腿的回话者是它，而不是 18080 上恰好坐着的别的东西`);
claim('D 停容器后代理腿连不上', true, afterStopProxy.status !== 200);
claim('D 停容器后直连腿照旧（把归因钉在 caddy 上）', 200, afterStopDirect.status);
const afterStopWs = openProbe(buildRealtimeUrl(PROXY, TOK_LIS, `${LISTENER_ID}-after`));
const afterStopConnected = await wait(() => afterStopWs.s.frames.some((m) => m.type === 'connected'), 8000);
afterStopWs.sock.close();
const directWs = openProbe(buildRealtimeUrl(DIRECT, TOK_LIS, `${LISTENER_ID}-direct`));
const directConnected = await wait(() => directWs.s.frames.some((m) => m.type === 'connected'), 10000);
directWs.sock.close();
readings.push(`W5 停掉 caddy 后：经代理 WS connected=${afterStopConnected}（应 false）、直连 WS connected=${directConnected}（应 true）⇒ W1–W4 那四条确实过的是这枚代理`);
claim('W5 停容器后经代理的 WS 连不上', false, afterStopConnected);
claim('W5 停容器后直连的 WS 照旧（归因钉在 caddy 上）', true, directConnected);
dockerAllow('rm', '-f', LIVE);
mine.containers = mine.containers.filter((n) => n !== LIVE);
await sleep(1500);

// ── 第 3 步：两条变异臂，各打一条判据（派生 Caddyfile 每轮现生成，不落库） ─────
const TMP = mkdtempSync(join(tmpdir(), 'heyta-g68-'));
const src = readFileSync(CADDYFILE_HOST, 'utf8');

if (!/\n\{\n/.test(src)) die(6, 'Caddyfile 的全局块形状变了（找不到裸 `{` 那行），admin-off 这条臂没法注入');
const ADMIN = 'heyta-g68-adminoff';
const ADMIN_PATH = join(TMP, 'Caddyfile.adminoff');
writeFileSync(ADMIN_PATH, src.replace('\n{\n', '\n{\n    admin off\n'));
runCaddy(ADMIN, ADMIN_PATH);
const adminOffServed = await waitServed(60_000);
const adminOffProbe = dockerAllow('exec', ADMIN, ...HC_CMD);
readings.push(`臂 admin-off：[${HC_CMD.join(' ')}] rc=${adminOffProbe.rc}；容器状态=${healthStatus(ADMIN)}；代理 /health=${adminOffServed.status}（服务活着 ⇒ 红的是 admin 绑定那一格，不是崩容器）`);
// 上一版这里写的是 `expect 1, got (rc === 0 ? 1 : 0)` —— 把读数预先取反了一次，
// 于是"变异真的让探针失败（rc=1）"被这条臂读成红。臂的 got 必须是**原读数**。
claim('变异 admin-off：那条健康检查命令必须失败（否则 A 没牙）', true, adminOffProbe.rc !== 0);
claim('变异 admin-off：反代照旧活着（把归因钉在 admin 上）', 200, adminOffServed.status);
dockerAllow('rm', '-f', ADMIN);
mine.containers = mine.containers.filter((n) => n !== ADMIN);
await sleep(1500);

// 上一版按"那一行的字面内容"匹配摘它，结果**一条都没摘到**（模式打空、脚本却往下走，
// 差点把"没泄漏"记成判据绿）。现在按整行摘，并当场数摘了几条、剩下还有没有 REDACTED。
// ⚠️ 缩进必须写成 `[ \t]*` 而不是 `[ ]*`：`caddy fmt` 会把行首空格改成制表符（G-69 那一笔
//    就是这么把这条臂打空的 —— 它当场 die(6) 报了"现读 0"，没有假装摘成功）。
const FILTER_RE = /^[ \t]*request>uri[^\n]*\n/gm;
const FILTER_LINES = [...src.matchAll(FILTER_RE)];
if (FILTER_LINES.length !== 2) die(6, `Caddyfile 里的 request>uri filter 不再是 2 条（现读 ${FILTER_LINES.length}）—— 先去看清那两行被改成了什么，再决定这条臂怎么打`);
const LEAK = 'heyta-g68-leak';
const LEAK_PATH = join(TMP, 'Caddyfile.nofilter');
const stripped = src.replace(FILTER_RE, '');
if (/REDACTED/.test(stripped)) die(6, '摘完两处 filter 之后 Caddyfile 里仍留着 REDACTED ⇒ 注入没打全，这条臂不构成对 E 的反证');
writeFileSync(LEAK_PATH, stripped);
runCaddy(LEAK, LEAK_PATH);
await waitHealthy(LEAK, 90_000);
const nonce2 = `synthetic-${randomUUID()}`;
await get(`${PROXY}/health?token=${nonce2}`);
await sleep(2500);
const leakLogs = dockerAllow('logs', '--tail', '30', LEAK).out;
const leakCaught = leakLogs.includes(nonce2);
readings.push(`臂 no-filter：摘掉 filter 后令牌出现在日志=${leakCaught}（应为 true，否则 E 那句"没泄漏"本来就抓不到东西）`);
claim('变异 no-filter：必须抓到泄漏（否则 E 没牙）', true, leakCaught);

// 同一枚容器上再打一次 **WS 那条路径**：HTTP 那条抓不到泄漏不代表 WS 也抓不到 ——
// 升级请求的 query 是它唯一的凭据通道（浏览器不能给升级请求设头），代码形状与那条 GET 不同。
const wsLeakProbe = openProbe(buildRealtimeUrl(PROXY, TOK_LIS, `${LISTENER_ID}-nofilter`));
const wsLeakConnected = await wait(() => wsLeakProbe.s.frames.some((m) => m.type === 'connected'), 12_000);
wsLeakProbe.sock.close();
await sleep(3000);
const leakWsLogs = dockerAllow('logs', '--tail', '200', LEAK).out.split('\n').filter((l) => l.includes('/api/sync/ws'));
const leakWsCaught = leakWsLogs.some((l) => l.includes(TOK_LIS));
readings.push(`臂 no-filter 的 WS 腿：连接建立=${wsLeakConnected}；/api/sync/ws 日志行 ${leakWsLogs.length} 条，其中明文令牌出现=${leakWsCaught}（应为 true，否则 W4 那句"WS 也没泄漏"本来就抓不到东西）`);
claim('变异 no-filter：WS 那条路径也必须抓到泄漏（否则 W4 没牙）', true, leakWsCaught);
claim('变异 no-filter：WS 在摘掉 filter 的容器上仍能建立（把归因钉在日志上，不是连接上）', true, wsLeakConnected);
dockerAllow('rm', '-f', LEAK);
mine.containers = mine.containers.filter((n) => n !== LEAK);

// 臂 unformatted（G-69）：F 有没有牙，只看一件事 —— 把**那一个空行**塞回注释块与全局块之间
// （就是这轮之前仓库那份的形状，也是过去每个跑次都打印过的那条警告的来源），同一条判据必须转红。
// 还要它 validate 照旧通过：否则 F 只是 validate 的影子，量不到任何 validate 量不到的东西。
if (/\n\n\{\n/.test(src)) die(6, '仓库那份又带回了注释块与全局块之间的空行 ⇒ F 本身已经红了，先修文件再谈这条臂');
const unfIdx = src.indexOf('\n{\n');
if (unfIdx < 0) die(6, 'Caddyfile 里找不到裸 `{` 那行 ⇒ unformatted 这条臂没法注入（和 admin-off 同一个前提）');
const UNFMT_PATH = join(TMP, 'Caddyfile.unfmt');
writeFileSync(UNFMT_PATH, `${src.slice(0, unfIdx + 1)}\n${src.slice(unfIdx + 1)}`);
const unf = fmtOf(UNFMT_PATH);
const unfClean = unf.rc === 0 && unf.same;
const unfValidate = spawnSync('docker', ['run', '--rm', '-e', `DOMAIN=:${CONTAINER_PORT}`,
  '-v', `${UNFMT_PATH}:${CADDYFILE_GUEST}:ro`, IMAGE, 'caddy', 'validate', '--config', CADDYFILE_GUEST, '--adapter', 'caddyfile'],
  { encoding: 'utf8' });
readings.push(`臂 unformatted：塞回那个空行之后 fmt 判据=${unfClean}（rc=${unf.rc}、逐字一致=${unf.same}，应为 false）；同副本 caddy validate rc=${unfValidate.status}（应为 0，⇒ F 抓的是 validate 抓不到的那一格）`);
claim('变异 unformatted：同一条 fmt 判据必须判出不一致（否则 F 没牙）', false, unfClean);
claim('变异 unformatted：它仍然 validate 通过（⇒ F 不是 validate 的影子）', 0, unfValidate.status);
rmSync(TMP, { recursive: true, force: true });

// ── 收口 ────────────────────────────────────────────────────────────────────
console.log('   ── 这一趟量到的读数 ──');
for (const r of readings) console.log(`   · ${r}`);
const failed = arms.filter((a) => !a.pass);
/* 🔴 掉臂检查按**组名**判，不按条数写死：写死数字就是把当时的形状当判据（本仓为这件事红过几次），
 *    而这里真正会发生的失效是"某一整段被人删掉或提前 return"—— 那种情况下"红 0"最危险。 */
const GROUPS = ['控制腿', 'A ', 'B ', 'C ', 'D ', 'E ', 'F ', 'W1', 'W2', 'W3', 'W4', 'W5', '变异 admin-off', '变异 no-filter', '变异 unformatted'];
const missingGroups = GROUPS.filter((g) => !arms.some((a) => a.name.startsWith(g)));
if (missingGroups.length) die(9, `装置掉臂：这些组一条都不在（${missingGroups.join(' / ')}）—— "红 0"不能读成"全绿"`);
console.log(`   ── 臂 ${arms.length} 条：红 ${failed.length} 条（组 ${GROUPS.length} 个都在）──`);
for (const a of arms) console.log(`   ${a.pass ? '✅' : '❌'} ${a.name}｜期望 ${JSON.stringify(a.expect)}｜实得 ${JSON.stringify(a.got)}`);
console.log(`   与出货形状的四条差异：docker run 而非 compose up｜DOMAIN=:${CONTAINER_PORT} 而非真实 https 域名（⇒ 不覆盖签证书）｜宿主侧发布到 127.0.0.1:${HOST_PORT}（不占主机 :80/:443）｜/data、/config 用一次性卷`);
console.log(`   G-70 的射程边界：上传方是真 CLI（node-host）经代理建号+上传，但**监听端不是浏览器** —— 浏览器里的实时接线归 verify:selfhost-stack 的界面腿；ws:// 明文（差异 2），TLS 那一条不在这里证`);
if (failed.length) die(8, `G-68/G-70 判据红 ${failed.length} 条 —— 逐臂见上`);
console.log(`✅ G-68：仓库原文件 Caddyfile 与 compose 现读出的那枚 caddy 服务，在真栈上跑通了"外人第一步"的三格（healthy／经代理取 /app/ 同字节且数得出主蓝／经代理取 /health 同形），另有三条判据各被变异臂打过一次（健康检查 / 日志 filter / fmt no-op）。签证书那一条不在射程内（差异 2）。`);
console.log(`✅ G-70：实时通道那条 WS 升级经这枚 caddy 建立、双向帧都过（connected + 另一台设备上传后的 new_ops），坏令牌被服务端以 4003 拒掉、那一次升级的日志行做了 ?REDACTED，停容器后代理腿连不上而直连腿照旧；no-filter 那枚变异容器上 WS 路径的泄漏确实会被抓到。`);
