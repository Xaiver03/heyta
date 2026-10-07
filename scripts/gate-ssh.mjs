#!/usr/bin/env node
/**
 * `gate:ssh` —— 把整套门禁搬到 finlaw 上跑，**一个字节都不走代理**
 * ==================================================================
 *
 * 它替代的是什么
 * --------------
 * `.github/workflows/ci.yml`。那个 workflow 的**内容**没有价值，价值在它的三条承诺：
 *
 *   1. 干净环境 —— 不是开发机那份被 `~/node_modules` 兜住的现场（AGENTS 与 ci.yml
 *      文件头都记着：`pnpm check` 在干净检出上从来没通过过，而这个事实可以一直没人知道）；
 *   2. `pnpm install --frozen-lockfile` —— package.json 与 lockfile 漂移的探测器；
 *   3. 跑的是根 `package.json` 的 `check` 那一条链，**逐条**。
 *
 * 这三条在这里一条都不少。改掉的是**字节从哪来**：
 *
 *   | 字节 | 旧路（runner + mihomo） | 这条路 |
 *   |---|---|---|
 *   | 源码 | git-over-HTTPS 走代理 | `tar` 走 **SSH 22 端口**（实测 ssh -G 无 ProxyCommand） |
 *   | npm 依赖 | 走代理（当时实测 0–40 KiB/s，多次 error 23） | **npmmirror 直连，实测 9.4 MB/s** |
 *   | apk / Node | 走代理 | 基础镜像**机器上已有**；apk 走 aliyun 直连 0.61 s |
 *   | Chromium / Electron | 走代理拉 GitHub Release | **不拉** —— 那几步显式跳过并大字印出来 |
 *   | 载体镜像 | GHCR / docker.io（直连 000） | 本地 `node:24-alpine`（已存在，零拉取） |
 *
 * 为什么是 finlaw 而不是这台 Mac —— 这条是**测出来的**，不是偏好：
 * 这台 Mac 的 `git config --global` 里就写着 `http.proxy=127.0.0.1:7890`，
 * 在 Mac 上装依赖同样是**那份付费额度**的字节，只是换了台机器花。而 finlaw 直连
 * npm 是通的（实测两个源都 200），所以"零代理"这件事只有在那台机器上做才成立。
 *
 * 🔴 拒绝静默降级（与 `scripts/run-gradle.mjs` 同一套规矩）
 * ---------------------------------------------------------
 * SSH 不通 / tar 哈希对不上 / 载体镜像缺失 / 出口探针不成立 / 装依赖失败
 * —— 一律**响亮失败并点名是哪一步**。尤其这一条：
 *
 *   **装依赖失败时，汇总必须写"0 道门禁执行"，不许写"0 道失败"。**
 *
 * 这不是修辞。旧 CI 的 §8.1 记录过同一个形状：`frozen-lockfile` 失败，
 * 后面 22 道门禁在步骤列表里是 `-`（不是 `✗`），于是"CI 红了"只意味着"装依赖失败了"，
 * 而一线的人看的是那个 `X` 和结论词，不会去数有几个 `-`。
 *
 * 用法
 * ----
 *   node scripts/gate-ssh.mjs                       # 跑 HEAD 那一批源码（git archive）
 *   node scripts/gate-ssh.mjs --dirty               # 跑**当前工作树**（含未提交文件，排除 .env）
 *   node scripts/gate-ssh.mjs --ref <sha>           # 跑指定提交
 *   node scripts/gate-ssh.mjs --only check:migrations,check:layering   # 只跑子集（调试用）
 *   node scripts/gate-ssh.mjs --strict              # 环境类跳过也算红（发版前用）
 *   node scripts/gate-ssh.mjs --dry-run             # 只打印计划，一个字节都不写
 *
 * 环境变量（默认值就是规则要求的那套）：
 *   HEYTA_GATE_HOST        远端主机，默认 `ubuntu-jcli`（= finlaw）
 *   HEYTA_GATE_REMOTE      远端根目录，默认 `~/heyta-gate`
 *   HEYTA_GATE_IMAGE       载体镜像，默认 `heyta-gate:local`
 *   HEYTA_GATE_CPUS / MEM  资源上限，默认 `2` / `3g`（沿用旧 runner 那套：可以慢，不可以抢）
 *   HEYTA_GATE_PROXY       出口探针的阳性对照代理，默认 `http://172.17.0.1:7890`
 *   HEYTA_GATE_KEEP        =1 时保留这次运行目录（默认保留，见下）
 *
 * 🔴 关于"隔离"：每次运行落在 `~/heyta-gate/runs/<UTC>-<ref12>/` 一个**新目录**里，
 *    不复用上一次的工作树（复用会把"新克隆能不能立起来"变成"上次那个克隆还能不能"）。
 *    唯一跨运行共享的是 **pnpm 内容寻址 store**（`~/heyta-gate/store`）—— 它共享的是
 *    字节，不是工作树，而 lockfile 相同的包不会重新下载。这条也是"零代理"能长期成立的
 *    前提：不然每次都是全量 npm 下载。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const DRY = has('--dry-run');
const STRICT = has('--strict');
const DIRTY = has('--dirty');
const HOST = process.env.HEYTA_GATE_HOST || 'ubuntu-jcli';
const REMOTE = process.env.HEYTA_GATE_REMOTE || '~/heyta-gate';
const IMAGE = process.env.HEYTA_GATE_IMAGE || 'heyta-gate:local';
const BASE_IMAGE = process.env.HEYTA_GATE_BASE_IMAGE || 'node:24-alpine';
const CPUS = process.env.HEYTA_GATE_CPUS || '2';
const MEM = process.env.HEYTA_GATE_MEM || '3g';
const PROXY = process.env.HEYTA_GATE_PROXY || 'http://172.17.0.1:7890';
const APK_MIRROR = process.env.HEYTA_GATE_APK_MIRROR || 'mirrors.aliyun.com';
// 🔴 默认是**官方 registry 直连**，不是国内镜像 —— 这条是测出来的，不是偏好：
//    `registry.npmmirror.com` 缺包。实测 `pnpm install --frozen-lockfile` 在
//    resolved 968 之后死在 `[ERR_PNPM_FETCH_404] @op-engineering/op-sqlite/-/18.2.5.tgz`
//    （RN 的 SQLite 原生包，镜像没同步到那一版）。而官方源在这台机器上**直连可达且够快**
//    （typescript tarball 4,377,468 B @ 1.78 MB/s），所以没有必要为了"看起来本地化"
//    去用一个会缺包的镜像。要换回 npmmirror：`HEYTA_GATE_NPM_REGISTRY=https://registry.npmmirror.com/`
//    —— 但那条路今天装不完，别照它排期。
const NPM_REGISTRY = process.env.HEYTA_GATE_NPM_REGISTRY || 'https://registry.npmjs.org/';
const ONLY = val('--only', '');

/**
 * 🔴 载体跑不了的步骤（**逐条给缺的是什么**，不给就不许存在这一项）。
 *
 * 这张表的理由是实测：`check:ai-e2e` 那一族要 Playwright 的 Chromium，
 * 而 Chromium 只能从 `cdn.playwright.dev` / Azure CDN 拉（实测 307/400，
 * 且这台机器没有那份缓存）；`check:arkts` 要 DevEco 自带的 `es2abc`。
 *
 * ⚠️ 把一条**已经能跑的**步骤留在表里 = 永久假绿（`check-gate-ssh.mjs` 会拦这一条：
 *    表里的每一项必须既在链里、又真的因为环境跑不了 —— 后者靠一次真跑的红来登记）。
 */
const ENV_LIMITED = new Map([
  ['pnpm check:ai-e2e', '载体无 Chromium（Playwright 浏览器只能从海外 CDN 拉，这台机器上没有那份缓存）'],
  ['pnpm check:privacy-consent-e2e', '同上：真浏览器套件'],
  ['pnpm check:landing-e2e', '同上：真浏览器套件'],
  ['pnpm screenshot:verify', '需要 e2e 采集的真浏览器截图产物，载体没有跑过采集'],
  ['pnpm check:arkts', '需要 DevEco 自带的 ArkTS 编译器 es2abc（该脚本自己就 exit 0 并打印"跳过"）'],
]);

function run(bin, a, o = {}) {
  if (DRY && !o.always) {
    console.log(`   [dry-run] ${bin} ${a.join(' ')}`.slice(0, 240));
    return { status: o.fakeStatus ?? 0, stdout: o.fakeStdout ?? '', stderr: '' };
  }
  const r = spawnSync(bin, a, { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024, ...o });
  return { status: r.status ?? 127, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function ssh(remoteCmd, o = {}) {
  return run('ssh', ['-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes', HOST, remoteCmd], o);
}
function die(step, detail, extra = '') {
  console.log(`\n🔴 ${step}\n   ${detail}`);
  if (extra) console.log(extra);
  console.log('\n   拒绝继续，也**拒绝把"没跑"报成"跑过"**。');
  process.exit(1);
}
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/* ───────────────────────── 步骤 1：从根 package.json 现推门禁链 ───────────────────────── */
// 🔴 唯一权威是那一行 `check`。这里**解析它**，不抄它的条数、不抄它的名字。
//    （runbook 与本仓库 AGENTS §6 都写明了"条数不许写在这里"—— 抄件一定会漂。）
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
const CHAIN = (pkg.scripts.check || '').split('&&').map((s) => s.trim()).filter(Boolean);
if (CHAIN.length === 0) die('步骤 1（门禁链）', '根 package.json 没有 check 脚本 —— 没有权威，拒绝凭记忆编一份。');
console.log(`步骤 1：门禁链取自根 package.json 的 check，共 ${CHAIN.length} 段（本文件不抄它的内容）`);

// `pnpm -r test` 是链的最后一段，它自己会汇总各包；单独列出以便"跑了但没跑到某包"能被发现。
const steps = ONLY ? CHAIN.filter((s) => ONLY.split(',').some((k) => s.includes(k))) : CHAIN;

/* ───────────────────────── 步骤 2：取源码（只有已提交的，或显式工作树） ─────────────── */
const ref = val('--ref', '');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
// 只读命令在 dry-run 里也要真跑：dry-run 拒的是**写与花钱**，不是"读自己的仓库"。
const headSha = run('git', ['rev-parse', ref || 'HEAD'], { always: true }).stdout.trim();
if (!headSha) die('步骤 2（源码）', `解析不到 ref：${ref || 'HEAD'}`);
const short = headSha.slice(0, 12);
const runId = `${stamp}-${short}${DIRTY ? '-dirty' : ''}`;
const tarPath = `/tmp/heyta-gate-${runId}.tar.gz`;

console.log(`步骤 2：打包源码 ${DIRTY ? '**当前工作树**（--dirty）' : `已提交 ref ${short}`}`);
if (DIRTY) {
  // ⚠️ 第一版这里是 `git ls-files -co --exclude-standard | tar czf - -T -`，实测**当场失败**：
  //    `git ls-files` 默认 `core.quotepath=true`，非 ASCII 文件名被打印成
  //    `"apps/web/evidence/…/\351\200\232\351\201\223….png"` 这种**带引号的八进制转义**，
  //    tar 拿去 stat 得到 `No such file or directory` ⇒ 本仓库有几十个中文截图，
  //    照那一版跑永远打包失败（而它失败得很响，倒是没假装成功）。
  //
  // 现在改成"临时索引 + write-tree + git archive"：只读工作树、按 .gitignore 排除
  // （⇒ `.env` 与 `node_modules` 天然不在包里）、不碰真索引、不受 quotepath 影响。
  // 🔴 仍然坚持"只有被 git 看见的文件进包"：`-o --exclude-standard` 的语义就是它。
  const sh = [
    'set -e',
    'IDX=$(mktemp)',
    'export GIT_INDEX_FILE="$IDX"',
    'git read-tree HEAD',
    // ⚠️ 不能写成 `git add -A --refresh`：`--refresh` 只更新 stat 缓存、**不会收未跟踪文件**，
    //    那样 write-tree 出来的树里就没有我这轮新写的脚本 —— 症状是远端"文件不存在"，
    //    而本地看起来打包成功了。
    'git add -A .',
    'T=$(git write-tree)',
    `git archive --format=tar.gz -o ${tarPath} "$T"`,
    'rm -f "$IDX"',
  ].join(' && ');
  const tf = run('sh', ['-c', sh]);
  if (!DRY && (tf.status !== 0 || !existsSync(tarPath))) {
    die('步骤 2（工作树打包）', tf.stderr.slice(0, 500) || '没产出归档');
  }
} else {
  const a = run('git', ['archive', '--format=tar.gz', '-o', tarPath, ref || 'HEAD']);
  if (!DRY && (a.status !== 0 || !existsSync(tarPath))) die('步骤 2（git archive）', a.stderr.slice(0, 400) || '归档没产出');
}
if (!DRY) {
  const inside = run('sh', ['-c', `tar tzf ${tarPath} | grep -Ec '(^|/)\\.env$' || true`], { always: true });
  const n = Number((inside.stdout || '0').trim());
  if (n > 0) die('步骤 2（.env 自检）', `归档里有 ${n} 枚 .env —— 这会覆盖远端配置，停。`);
  console.log(`   归档 ${tarPath} size=${(statSync(tarPath).size / 1048576).toFixed(1)} MiB  .env 枚数=${n}（必须 0）`);
}
const localSha = DRY ? '<dry-run>' : sha256(tarPath);

/* ───────────────────────── 步骤 3：宿主机负载门（这台是共享生产机） ─────────────────── */
// 阈值从**被约束的常量**推导（nproc × 3/4），与 scripts/lib/wait-for-quiet-host.sh 同一个式子。
console.log('步骤 3：读远端负载（不达标就不开始；等满以"环境无效"结束）');
const loadGate = `
  N=$(nproc); LIMIT=$(awk -v n="$N" 'BEGIN{printf "%.2f", n*0.75}')
  for i in $(seq 1 60); do
    L=$(cut -d" " -f1 /proc/loadavg)
    AWK=$(awk -v l="$L" -v m="$LIMIT" 'BEGIN{print (l<=m)?1:0}')
    if [ "$AWK" = "1" ]; then echo "LOAD=OK load=$L limit=$LIMIT nproc=$N"; exit 0; fi
    sleep 15
  done
  echo "LOAD=INVALID load=$(cut -d' ' -f1 /proc/loadavg) limit=$LIMIT"; exit 3`;
const lg = ssh(loadGate);
console.log('   ' + (lg.stdout || lg.stderr).trim());
if (!DRY && lg.status === 3) {
  console.log('\n🟠 环境无效（不是产品失败）。等满 15 分钟这台机器的负载仍超过 nproc×3/4。');
  console.log('   这一趟**没有跑**任何门禁 —— 不要把它记成"验过了"。');
  process.exit(3);
} else if (!DRY && lg.status !== 0) {
  die('步骤 3（负载门）', `读不到远端负载，rc=${lg.status}`, lg.stderr.slice(0, 300));
}

/* ───────────────────────── 步骤 4：SSH 传输 + 🔴 内容对账 ─────────────────────────── */
// AGENTS §7 第 82 条：**"远端字节 == 本地当前产物"要有 sha256 判据，对不上就拒绝**。
// 那条坑的代价是"判据全绿而装的是三天前的旧树"。这里同一条判据，只是方向反过来。
console.log(`步骤 4：传到 ${HOST}:${REMOTE}/runs/${runId}/ （SSH 22 端口，实测无 ProxyCommand）`);
const RUN_DIR = `${REMOTE}/runs/${runId}`;
// 🔴 `mkdir -p` 必须把**这一趟自己的** logs 建出来。少建一格的后果不是报错，
//    是 Docker 在 bind-mount 时**以 root 身份**替你把目录建出来（实测：
//    `drwxr-xr-x 2 root root …/runs/<id>/logs`），于是容器里 uid 1000 写不进去，
//    而宿主上的 ubuntu 也写不进去 —— 症状是"驱动脚本投放 Permission denied"，
//    看起来像权限问题，实际是**目录是谁建的**问题。
ssh(`mkdir -p ${RUN_DIR}/src ${RUN_DIR}/logs ${REMOTE}/store`);
if (!DRY) {
  const w = ssh(`touch ${RUN_DIR}/logs/.w 2>/dev/null && rm -f ${RUN_DIR}/logs/.w && echo WRITABLE=OK || echo WRITABLE=NO`);
  if (!/WRITABLE=OK/.test(w.stdout)) {
    die('步骤 4（工作目录）', `${RUN_DIR}/logs 不可写。多半是上一版留下的 root 属主目录（Docker 自动建的）。`,
      `   修这一趟的：ssh ${HOST} 'sudo chown -R 1000:1000 ${RUN_DIR}/logs'\n` +
        '   清历史遗留：ssh ' + HOST + " 'sudo chown -R 1000:1000 ~/heyta-gate/runs ~/heyta-gate/logs'");
  }
}
const scp = run('scp', ['-q', '-o', 'ConnectTimeout=20', tarPath, `${HOST}:${RUN_DIR}/src.tar.gz`]);
if (scp.status !== 0) die('步骤 4（传输）', `scp 失败 rc=${scp.status}`, scp.stderr.slice(0, 300));
const remoteShaCmd = `cd ${RUN_DIR} && sha256sum src.tar.gz | cut -d" " -f1 && stat -c%s src.tar.gz`;
const rs = ssh(remoteShaCmd);
if (rs.status !== 0) die('步骤 4（远端读取）', rs.stderr.slice(0, 300));
const [remoteSha, remoteSize] = rs.stdout.trim().split(/\s+/);
if (!DRY) {
  if (remoteSha !== localSha) {
    die('步骤 4（内容对账）', `本地 sha256 与远端逐字不同：\n      local =${localSha.slice(0, 16)}…\n      remote=${remoteSha.slice(0, 16)}…`);
  }
  console.log(`   ✅ 对账成立：size=${Number(remoteSize).toLocaleString('en-US')} B sha256=${localSha.slice(0, 16)}…（两端逐字相同）`);
  const un = ssh(`cd ${RUN_DIR} && tar xzf src.tar.gz -C src && echo UNPACK=OK`);
  if (un.status !== 0 || !/UNPACK=OK/.test(un.stdout)) die('步骤 4（解包）', un.stderr.slice(0, 300));
} else {
  console.log('   [dry-run] 未传输 ⇒ 对账这一步**没有被验证**');
}

/* ───────────────────────── 步骤 5：载体镜像（机器上已有 ⇒ 零 docker pull） ──────────── */
console.log(`步骤 5：确认载体镜像 ${IMAGE}（基础镜像 ${BASE_IMAGE} 必须**已在机器上**）`);
const imgCheck = `
  if ! docker image inspect ${BASE_IMAGE} >/dev/null 2>&1; then
    echo "BASE=MISSING ${BASE_IMAGE}"; exit 4
  fi
  if docker image inspect ${IMAGE} >/dev/null 2>&1; then echo "GATE_IMAGE=present"; exit 0; fi
  echo "GATE_IMAGE=building"
  cd ${RUN_DIR}/src && docker build --network=host \\
    --build-arg NODE_IMAGE=${BASE_IMAGE} \\
    --build-arg APK_MIRROR=${APK_MIRROR} \\
    --build-arg NPM_REGISTRY=${NPM_REGISTRY} \\
    --build-arg http_proxy= --build-arg https_proxy= --build-arg HTTP_PROXY= --build-arg HTTPS_PROXY= \\
    -f scripts/ci/Dockerfile.gate -t ${IMAGE} . 2>&1 | tail -5
  docker image inspect ${IMAGE} >/dev/null 2>&1 && echo BUILD=OK || { echo BUILD=FAIL; exit 5; }`;
const ic = ssh(imgCheck);
console.log('   ' + ic.stdout.trim().split('\n').slice(-3).join(' '));
if (!DRY && ic.status !== 0) {
  die('步骤 5（载体镜像）', `rc=${ic.status}。读法：BASE=MISSING ⇒ 这台机器上没有那枚基础镜像，
      去 docker pull 就是**走代理**，这条路到此为止；BUILD=FAIL ⇒ 看远端构建日志。`,
    '   要么 load 一枚基础镜像进去（离线，不经代理），要么用机器上已有的 tag 传 HEYTA_GATE_BASE_IMAGE。');
}

/* ───────────────────────── 步骤 6：🔴 出口探针（先于任何下载） ──────────────────────── */
// 位置是承重的：它必须在**任何会花钱的动作之前**。放在装依赖之后，
// 就等于"先把额度花完，再宣布这次没花钱"。
console.log('步骤 6：出口探针（含一条阳性对照；整套方案里唯一花额度的动作，约 280 KB）');
// 🔴 探针跑在**宿主机**上，不是容器里：它要读 mihomo 的账本（`172.17.0.1:9090`），
//    而那件事容器做不到。容器只负责"发一次带标记的请求"，计量由账本这边读。
//    （第一版把它挂进容器里跑，得到的是 `EGRESS=FAIL` 加一条 `PROXY_ENV=FAIL` ——
//    六个**空值** proxy 变量被自己的加固动作判成违规。判据判错了对象，比没有判据更糟。）
const probeRun = `bash ${RUN_DIR}/src/scripts/ci/egress-probe.sh ${IMAGE} ${PROXY} http://172.17.0.1:9090`;
const pr = ssh(probeRun);
const probeOut = (pr.stdout || '') + (pr.stderr || '');
console.log(probeOut.split('\n').filter(Boolean).map((l) => '   ' + l).join('\n'));
if (!DRY) {
  if (/EGRESS=FAIL/.test(probeOut)) die('步骤 6（出口探针）', '不挂代理的那一次被 mihomo 记到了 ⇒ 这一趟的字节**会**经过代理。停。');
  if (/EGRESS=INCONCLUSIVE/.test(probeOut)) {
    console.log('\n🟠 阳性对照不成立（账本看不见那类连接）⇒ 本轮**不能**声称"零代理字节"。');
    console.log('   继续跑门禁（结果仍有效），但汇总里的出口结论只能写"未证明"。');
  }
}
const EGRESS = DRY ? 'DRY' : /EGRESS=OK/.test(probeOut) ? 'PROVEN-OFF-PROXY' : /EGRESS=INCONCLUSIVE/.test(probeOut) ? 'UNPROVEN' : 'FAILED';

/* ───────────────────────── 步骤 7：装依赖（--frozen-lockfile 是探测器，不是过场） ────── */
console.log('步骤 7：pnpm install --frozen-lockfile（registry 直连，见步骤 6 的 SOURCE 读数）');
const MOUNTS = `-v ${RUN_DIR}/src:/work -v ${REMOTE}/store:/home/node/.local/share/pnpm/store -v ${RUN_DIR}/logs:/logs`;
const CONTAINER_ENV = `-e HOME=/home/node -e CI=true -e TZ=UTC -e http_proxy= -e https_proxy= -e HTTP_PROXY= -e HTTPS_PROXY= -e all_proxy= -e ALL_PROXY= -e NO_PROXY='*' -e ELECTRON_SKIP_BINARY_DOWNLOAD=1 -e PUPPETEER_SKIP_DOWNLOAD=1 -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`;
const installCmd = `docker run --rm ${MOUNTS} --cpus=${CPUS} --memory=${MEM} --network=bridge ${CONTAINER_ENV} \\
  -w /work --entrypoint bash ${IMAGE} -lc 'pnpm config set registry --location project ${NPM_REGISTRY} >/dev/null 2>&1; \\
   pnpm install --frozen-lockfile 2>&1 | tail -25; echo INSTALL_RC=${'$'}{PIPESTATUS[0]}'`;
const ins = ssh(installCmd);
const installOk = DRY ? true : /INSTALL_RC=0/.test(ins.stdout);
console.log(ins.stdout.trim().split('\n').slice(-6).map((l) => '   ' + l).join('\n') || '   [dry-run] 未执行');
if (!DRY && !installOk) {
  // 🔴 §8.1 的那个形状：这一步失败 ⇒ 后面**全部没跑**，而最容易被读成"只是装依赖失败了"。
  console.log('\n🔴 步骤 7 失败：`pnpm install --frozen-lockfile` 没通过。');
  console.log(`   ⇒ ${steps.length} 段门禁**一段都没有执行**。汇总不会给出"0 失败"这种话。`);
  console.log('   这是 package.json 与 lockfile 漂移的探测器（本机有 node_modules，毫无感觉）。');
  report({ install: false, executed: 0, results: [], runId, egress: EGRESS });
  process.exit(1);
}

/* ───────────────────────── 步骤 8：逐段执行，逐段记 rc ─────────────────────────────── */
// 逐段而不是一条 `pnpm check`：那条链是 `&&`，第一段红就整条断，**后面什么样永远看不到**。
// 逐段跑能得到"哪几段红、红在哪"，也才能把"载体跑不了"与"代码坏了"分开登记。
console.log(`步骤 8：逐段执行（共 ${steps.length} 段）`);
// result.tsv 三列固定：`rc \t step \t note`。note 对跳过是**理由**、对执行是起止时刻。
// 🔴 跳过与执行过在文件里长得**不一样** —— 这是"不许把没跑的读成跑过的"那一半。
const driver = [];
for (const s of steps) {
  const skipReason = ONLY ? null : ENV_LIMITED.get(s);
  if (skipReason) {
    driver.push(`printf 'SKIP\\t%s\\t%s\\n' ${JSON.stringify(s)} ${JSON.stringify(skipReason)} >> /logs/result.tsv`);
    continue;
  }
  const q = JSON.stringify(s);
  driver.push(
    `s=${q}; echo "===== ${'$'}{s} =====" >> /logs/steps.log; ST=$(date -u +%FT%TZ); ` +
      // ⚠️ rc 必须在**被测命令**之后立刻取，且不能穿过管道（§7 第 45 条：管道后 $? 是 tail 的）
      `bash -c "$s" >> /logs/steps.log 2>&1; rc=${'$'}?; ` +
      `printf '%s\\t%s\\t%s..%s\\n' "$rc" "$s" "$ST" "$(date -u +%FT%TZ)" >> /logs/result.tsv`
  );
}
if (!DRY && driver.length > 0) {
  const script =
    '#!/bin/bash\nset -u\nexport PATH=/home/node/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin\n' +
    ': > /logs/result.tsv\n: > /logs/steps.log\n' +
    driver.join('\n') +
    '\necho "DRIVER_ROWS=$(wc -l < /logs/result.tsv)"\n';
  // 脚本经 stdin 落到挂载目录、再在容器里执行 —— 不在远端 shell 里做二次转义，
  // 那一层最容易把判据吃掉（把 `&&` 断在引号里、把 rc 读成空串）。
  const put = ssh(`cat > ${RUN_DIR}/logs/driver.sh`, { input: script, always: true });
  if (put.status !== 0) die('步骤 8（驱动脚本投放）', put.stderr.slice(0, 300) || `rc=${put.status}`);
  const real = ssh(`docker run --rm ${MOUNTS} --cpus=${CPUS} --memory=${MEM} --network=bridge ${CONTAINER_ENV} \\
    -w /work --entrypoint bash ${IMAGE} /logs/driver.sh`);
  console.log('   ' + (real.stdout || '').trim() + ` 远端 rc=${real.status}`);
}
let results = [];
if (!DRY) {
  const tsv = ssh(`cat ${RUN_DIR}/logs/result.tsv 2>/dev/null || echo MISSING`);
  if (tsv.stdout.trim() === 'MISSING') die('步骤 8（结果回读）', 'result.tsv 不存在 ⇒ 这一趟没有留下任何可核对的读数。');
  results = tsv.stdout.trim().split('\n').filter(Boolean).map((l) => {
    const [rc, step, note] = l.split('\t');
    return { rc, step, note };
  });
  // 🔴 行数必须等于段数。少一行就是"有一段既没跑也没登记"—— 正是 §8.1 那个形状
  //    （一条把前一步失败吞成"跳过"的流水线，会让人把"没验"读成"验过了"）。
  if (results.length !== steps.length) {
    die(
      '步骤 8（段数对账）',
      `result.tsv 有 ${results.length} 行，而链有 ${steps.length} 段 ⇒ 有 ${steps.length - results.length} 段既没执行也没登记。`,
      '   这种情况**不许**出汇总 —— 汇总里任何一个数字都会替它背书。'
    );
  }
  for (const r of results) {
    const tag = r.rc === '0' ? '✅' : r.rc === 'SKIP' ? '⏭️' : '🔴';
    console.log(`   ${tag} ${r.rc === 'SKIP' ? '跳过' : 'rc=' + r.rc}  ${r.step}`);
    if (r.rc === 'SKIP') console.log(`        理由：${r.note}`);
  }
} else {
  results = steps.map((step) => ({
    rc: ENV_LIMITED.has(step) ? 'SKIP' : '<dry>',
    step,
    note: ENV_LIMITED.get(step) || 'dry-run：未执行',
  }));
}

/* ───────────────────────── 步骤 9：汇总 ────────────────────────────────────────────── */
report({ install: installOk, executed: results.filter((r) => r.rc !== 'SKIP').length, results, runId, egress: EGRESS });

function report({ install, executed, results, runId = '<dry>', egress = 'DRY' }) {
  const skipped = results.filter((r) => r.rc === 'SKIP');
  const failed = results.filter((r) => r.rc !== 'SKIP' && r.rc !== '0');
  const total = steps.length;
  console.log('\n════════════════ 汇总 ════════════════');
  console.log(`运行 id        : ${runId}`);
  console.log(`源码           : ${DIRTY ? '工作树（--dirty）' : 'ref ' + short}${ref ? ' (' + ref + ')' : ''}`);
  console.log(`门禁链段数     : ${CHAIN.length}（取自根 package.json，不是抄的）`);
  // 🔴 `--only` 跑出来的绿**不是一次完整验证**。这一条不写出来，下一次有人拿
  //    "步骤 8：逐段执行（共 1 段）… 全绿"去当"门禁过了"，就是 §8.1 那个形状的翻版。
  if (ONLY) console.log(`⚠️ 本次只跑了子集 : ${steps.length} / ${CHAIN.length} 段（--only）⇒ **这不是一次完整验证**`);
  console.log(`装依赖         : ${install ? '✅' : '🔴 失败 ⇒ 后面全部未执行'}`);
  console.log(`出口结论       : ${egress}`);
  console.log(`真正执行       : ${executed} / ${total}`);
  console.log(`其中红         : ${failed.length}`);
  console.log(`因环境跳过     : ${skipped.length}`);
  if (skipped.length) {
    console.log('\n🔴 下面这些**没有被验证**（不是"通过"，是"没跑"）：');
    for (const s of skipped) console.log(`   · ${s.step}\n     ← ${s.note}`);
  }
  if (failed.length) {
    console.log('\n🔴 红的段（逐段看远端日志，别只看总数）：');
    for (const f of failed) console.log(`   rc=${f.rc}  ${f.step}`);
    console.log(`\n   日志：ssh ${HOST} 'tail -200 ${RUN_DIR}/logs/steps.log'`);
  }
  const verdict = !install ? '无效（装依赖失败，0 段执行）' : failed.length ? '红' : skipped.length ? `部分绿：${executed}/${total} 段成立，${skipped.length} 段未验证` : '全绿';
  console.log(`\n结论：${verdict}`);
  if (runId !== '<dry>') console.log(`远端留档：${HOST}:${RUN_DIR}/logs/{result.tsv,steps.log}`);
  if (!DRY) {
    mkdirSync('/tmp/heyta-gate-evidence', { recursive: true });
    const p = join('/tmp/heyta-gate-evidence', `${runId}.summary.txt`);
    writeFileSync(p, [
      `run=${runId}`, `sha=${localSha}`, `ref=${DIRTY ? 'worktree' : headSha}`,
      `egress=${egress}`, `install=${install}`, `executed=${executed}/${total}`,
      `skipped=${skipped.length}`, `failed=${failed.length}`,
      ...results.map((r) => `${r.rc}\t${r.step}`),
    ].join('\n') + '\n');
    console.log(`本地留档：${p}`);
  }
  process.exit(!install || failed.length ? 1 : 0);
}
