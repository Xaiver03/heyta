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
 * （证 caddy 真在链上）· 带 ?token= 的请求不把明文留在日志。
 * 两条变异臂各打一条：`admin off` ⇒ 那条健康检查命令必须失败；摘掉日志 filter ⇒
 * 令牌必须被这双眼睛抓到。臂数由本脚本自己打印，文档里不许抄。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const mine = { containers: [], volumes: [] };
const claim = (name, expect, got) => arms.push({ name, expect, got, pass: expect === got });
const die = (code, msg) => {
  if (readings.length) console.error(`   已量到的读数：\n${readings.map((r) => `     · ${r}`).join('\n')}`);
  console.error(`❌ ${msg}`);
  process.exit(code);
};

function teardown() {
  for (const name of mine.containers) dockerAllow('rm', '-f', name);
  for (const name of mine.volumes) dockerAllow('volume', 'rm', name);
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
const fmtWarn = /not formatted[^\n]*/.exec(`${validate.stderr}${validate.stdout}`)?.[0] ?? '';
readings.push(`地板：caddy validate（仓库原文件，未改一字）→ Valid configuration；${fmtWarn ? `fmt 警告在：${fmtWarn.slice(0, 90)}` : '无 fmt 警告'}`);

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

dockerAllow('stop', LIVE);
const afterStopProxy = await get(`${PROXY}/app/`);
const afterStopDirect = await get(`${DIRECT}/app/`);
readings.push(`D 停掉这枚 caddy 之后：代理腿=${afterStopProxy.status}（${afterStopProxy.error ?? '无异常'}），直连腿=${afterStopDirect.status} ⇒ 代理腿的回话者是它，而不是 18080 上恰好坐着的别的东西`);
claim('D 停容器后代理腿连不上', true, afterStopProxy.status !== 200);
claim('D 停容器后直连腿照旧（把归因钉在 caddy 上）', 200, afterStopDirect.status);
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
const FILTER_LINES = [...src.matchAll(/^[ ]*request>uri[^\n]*\n/gm)];
if (FILTER_LINES.length !== 2) die(6, `Caddyfile 里的 request>uri filter 不再是 2 条（现读 ${FILTER_LINES.length}）—— 先去看清那两行被改成了什么，再决定这条臂怎么打`);
const LEAK = 'heyta-g68-leak';
const LEAK_PATH = join(TMP, 'Caddyfile.nofilter');
const stripped = src.replace(/^[ ]*request>uri[^\n]*\n/gm, '');
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
dockerAllow('rm', '-f', LEAK);
mine.containers = mine.containers.filter((n) => n !== LEAK);
rmSync(TMP, { recursive: true, force: true });

// ── 收口 ────────────────────────────────────────────────────────────────────
console.log('   ── 这一趟量到的读数 ──');
for (const r of readings) console.log(`   · ${r}`);
const failed = arms.filter((a) => !a.pass);
console.log(`   ── 臂 ${arms.length} 条：红 ${failed.length} 条 ──`);
for (const a of arms) console.log(`   ${a.pass ? '✅' : '❌'} ${a.name}｜期望 ${JSON.stringify(a.expect)}｜实得 ${JSON.stringify(a.got)}`);
console.log(`   与出货形状的四条差异：docker run 而非 compose up｜DOMAIN=:${CONTAINER_PORT} 而非真实 https 域名（⇒ 不覆盖签证书）｜宿主侧发布到 127.0.0.1:${HOST_PORT}（不占主机 :80/:443）｜/data、/config 用一次性卷`);
if (failed.length) die(8, `G-68 判据红 ${failed.length} 条 —— 逐臂见上`);
console.log(`✅ G-68：仓库原文件 Caddyfile 与 compose 现读出的那枚 caddy 服务，在真栈上跑通了"外人第一步"的三格（healthy／经代理取 /app/ 同字节且数得出主蓝／经代理取 /health 同形），另有两条判据各被变异臂打过一次。签证书那一条不在射程内（差异 2）。`);
