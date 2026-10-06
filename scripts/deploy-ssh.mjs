#!/usr/bin/env node
/**
 * `deploy:ssh` —— 把 heyta 服务端发布改成"SSH 送源码 + 远端建镜像 + 沙箱先验"
 * ============================================================================
 *
 * 与旧路（`docs/runbooks/deployment.md` §3.8）的差别**只有一处是本质的**：
 * 每一步都写清"这一趟不许碰代理"，并且带一条会红的判据。
 *
 *   | 环节 | 旧路 | 这条路 |
 *   |---|---|---|
 *   | 源码送达 | `git archive HEAD` + `scp`（本来就是 SSH） | 同一动作，但打包清单**从 `server/image-inputs.txt` 读**并与 Dockerfile 的 COPY 对账 |
 *   | 依赖 | `NPM_REGISTRY=npmmirror`（这台直连实测 9.4 MB/s） | 同上，且 proxy build-arg 显式置空 |
 *   | 基础镜像 | dockerd 配了 mihomo ⇒ **拉取即代理字节** | 🔴 只允许用**机器上已有**的 tag；不在就拒绝继续，不偷偷拉 |
 *   | 迁移 | 一次性容器里 `scripts/migrate-deploy.sh` | 同一脚本；**绝不** `prisma migrate deploy`（AGENTS §4：CONCURRENTLY 与事务块） |
 *   | 换容器 | `deploy.sh` 会拉起整个 compose 栈（含必然起不来的 caddy） | 只碰我建的那几枚容器，名字带 run id |
 *   | 验证 | 装完人看一眼 | 先打**沙箱**：一次性 Postgres + 一次性 app，迁移从空库跑通 + `/health` + **镜像里印的 revision == 我送出去的那个 commit** |
 *
 * 🔴 为什么"内容对账"是承重的（AGENTS §7 第 82 条）
 * ------------------------------------------------
 * `reinstall:all` 的 Windows 段曾经**判据全绿而装的是三天前的旧树**。
 * 那一族的共同点是"流程里缺了同步/对账这一步，而缺了它的表现与一切正常完全一样"。
 * 这里每条传输都带 sha256，且**对不上就拒绝继续**，不是警告。
 *
 * 🔴 生产路径默认**不执行**
 * -----------------------
 * 默认是 `--sandbox`：只在临时容器里验证，不碰线上任何服务。
 * 真要换线上容器需要 `--apply --yes-production` 两个旗标同时给 ——
 * 因为它会：load 覆盖在用的 tag、跑迁移（写生产库）、重启 `supersync-server`。
 * 这三件事的**影响与回退**必须是人拍的，不是脚本顺手做的。
 *
 * 用法：
 *   node scripts/deploy-ssh.mjs                          # 沙箱验 HEAD（默认，安全）
 *   node scripts/deploy-ssh.mjs --ref <sha>              # 沙箱验指定提交
 *   node scripts/deploy-ssh.mjs --dry-run                # 只打印计划，一个字节都不写
 *   node scripts/deploy-ssh.mjs --apply --yes-production # 真发生产（要人明确授权）
 *   node scripts/deploy-ssh.mjs --rollback <tag>         # 把生产指回上一个 tag
 *
 * 环境变量：
 *   HEYTA_DEPLOY_HOST   默认 `ubuntu-jcli`（= finlaw）
 *   HEYTA_DEPLOY_DIR    生产目录，默认 `~/heyta`（脚本从不动它，除非 --apply）
 *   HEYTA_DEPLOY_SANDBOX_DIR 沙箱根，默认 `~/heyta-deploy-sandbox`
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d) => (A.includes(f) ? A[A.indexOf(f) + 1] : d);
const DRY = has('--dry-run');
const APPLY = has('--apply');
const SANDBOX = !APPLY;
const HOST = process.env.HEYTA_DEPLOY_HOST || 'ubuntu-jcli';
const PROD_DIR = process.env.HEYTA_DEPLOY_DIR || '~/heyta';
const SBX = process.env.HEYTA_DEPLOY_SANDBOX_DIR || '~/heyta-deploy-sandbox';
const APK = process.env.APK_MIRROR || 'mirrors.aliyun.com';
const NPM = process.env.NPM_REGISTRY || 'https://registry.npmmirror.com/';
const NODE_IMAGE = process.env.NODE_IMAGE || 'node:24-alpine';
const PG_IMAGE = process.env.POSTGRES_IMAGE || 'postgres:16-alpine';

const run = (bin, a, o = {}) => {
  if (DRY && !o.always) {
    console.log(`   [dry-run] ${bin} ${a.join(' ')}`.slice(0, 220));
    return { status: o.fakeStatus ?? 0, stdout: o.fakeStdout ?? '', stderr: '' };
  }
  const r = spawnSync(bin, a, { encoding: 'utf8', cwd: REPO, maxBuffer: 64 * 1024 * 1024, ...o });
  return { status: r.status ?? 127, stdout: r.stdout || '', stderr: r.stderr || '' };
};
const ssh = (c, o = {}) => run('ssh', ['-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes', HOST, c], o);
const die = (step, detail, extra = '') => {
  console.log(`\n🔴 ${step}\n   ${detail}`);
  if (extra) console.log(extra);
  console.log('\n   拒绝继续。');
  process.exit(1);
};
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

if (APPLY && !has('--yes-production')) {
  die(
    '授权闸门',
    '--apply 会覆盖在用的镜像 tag、写生产库、重启 supersync-server。三个都不可逆或影响可用性。',
    '   要真做，请 `--apply --yes-production` 两个旗标同时给（由人拍，不由脚本顺手做）。'
  );
}

/* ── 步骤 1：打包清单从 server/image-inputs.txt 读，并与 Dockerfile 的 COPY 对账 ── */
// 🔴 两份清单曾经差一次提交就是"跑旧镜像配新迁移"那类事故（image-inputs.txt 文件头原话）。
//    现在不在这里抄第三份 —— 读那两份、逐字比、不等就停。
const inputsRaw = readFileSync(join(REPO, 'server/image-inputs.txt'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.trim().startsWith('#'));
// 清单里的路径**相对 server/**，且用 `../` 上跳。归一到仓库根相对：
const inputs = inputsRaw.map((p) => posix.normalize(posix.join('server', p.trim()))).filter((p) => p !== '.' && !p.startsWith('..'));
if (inputs.length === 0) die('步骤 1（清单）', 'server/image-inputs.txt 读空 —— 没有这份清单，revision 核对与脏树检查都是空的。');
const missing = inputs.filter((p) => !existsSync(join(REPO, p)));
if (missing.length) die('步骤 1（清单）', `清单里有 ${missing.length} 项在仓库里不存在：\n   - ${missing.join('\n   - ')}`, '   ⚠️ 不存在的 pathspec **不会报错，是被静默忽略**（那份清单自己的告诫）—— 所以这里必须响亮失败。');

// Dockerfile 真正 COPY 的源路径（runbook §3.8 那条 awk 就是唯一写法）
const dockerfile = readFileSync(join(REPO, 'server/Dockerfile'), 'utf8');
const dockerCopy = [
  ...dockerfile.matchAll(/^COPY\s+(?:--from=\S+\s+)?((?:[^\s]+\s+)+)(?:\/[\w./-]+)?\s*$/gm),
]
  .flatMap((m) => m[1].trim().split(/\s+/))
  .filter((t) => !t.startsWith('--') && !t.startsWith('/') && !t.includes('$'))
  .map((t) => posix.normalize(t.replace(/\/$/, '')))
  .filter((t) => t !== '.' && !t.startsWith('apps/') === false || !t.startsWith('apps/'));
const copySet = new Set(dockerCopy.filter((t) => !t.startsWith('/') && !t.includes('$')));
// 两边集合对账（只比 Dockerfile COPY 的顶层路径；image-inputs 里的 `.` 代表 server/ 自身）
const inputsSet = new Set(inputs.map((p) => (p === 'server' || p.startsWith('server/') ? 'server' : p)));
const onlyInDocker = [...copySet].filter((p) => !inputsSet.has(p) && !inputsSet.has(posix.dirname(p)));
const onlyInInputs = [...inputsSet].filter((p) => p !== 'server' && !copySet.has(p) && !copySet.has(posix.dirname(p)));
if (onlyInDocker.length || onlyInInputs.length) {
  die(
    '步骤 1（两份清单对账）',
    `Dockerfile COPY 的源与 image-inputs.txt 不同集合：\n   只在 Dockerfile：${onlyInDocker.join(', ') || '—'}\n   只在 image-inputs：${onlyInInputs.join(', ') || '—'}`,
    '   后果写在 image-inputs.txt 文件头：revision 标签会算出一个"看起来最新"的 commit，而镜像里其实是旧的前端。'
  );
}
console.log(`步骤 1：打包清单 = server/image-inputs.txt（${inputs.length} 项）；与 Dockerfile 的 COPY 集合对过 ✅`);

/* ── 步骤 2：归档 + .env 硬判据 ── */
const ref = val('--ref', '');
const headSha = run('git', ['rev-parse', ref || 'HEAD'], { always: true }).stdout.trim();
if (!headSha) die('步骤 2', '解析不到 ref');
const short = headSha.slice(0, 12);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
const runId = `${stamp}-${short}`;
const tar = `/tmp/heyta-deploy-${runId}.tar.gz`;
const pack = run('sh', ['-c', `git archive --format=tar.gz -o ${tar} ${ref || 'HEAD'} ${inputs.map((p) => JSON.stringify(p)).join(' ')}`]);
if (!DRY && (pack.status !== 0 || !existsSync(tar))) die('步骤 2（git archive）', pack.stderr.slice(0, 400) || '没产出归档');
if (!DRY) {
  const n = Number(run('sh', ['-c', `tar tzf ${tar} | grep -Ec '(^|/)\\.env$' || true`], { always: true }).stdout.trim() || '0');
  // 🔴 这条判据的代价是实测过的：`server/.env` 一旦被带上服务器并就地覆盖，
  //    JWT_SECRET 被换掉 ⇒ 全部已签发令牌与在途验证链接失效，且重启前一声不响。
  if (n > 0) die('步骤 2（.env 自检）', `归档里有 ${n} 枚 .env —— 会覆盖生产配置，停。`);
  console.log(`步骤 2：归档 size=${(statSync(tar).size / 1048576).toFixed(1)} MiB  .env 枚数=${n}（必须 0）✅`);
}
const localSha = DRY ? '<dry-run>' : sha256(tar);

/* ── 步骤 3：SSH 送达 + 🔴 逐字对账 ── */
const DIR = SANDBOX ? `${SBX}/runs/${runId}` : `${PROD_DIR}`;
console.log(`步骤 3：送达 ${HOST}:${DIR}（SSH 22 端口）`);
ssh(`mkdir -p ${DIR}/src`);
const sc = run('scp', ['-q', '-o', 'ConnectTimeout=20', tar, `${HOST}:${DIR}/src.tar.gz`]);
if (!DRY && sc.status !== 0) die('步骤 3（scp）', `rc=${sc.status}`, sc.stderr.slice(0, 300));
const rr = ssh(`cd ${DIR} && sha256sum src.tar.gz | cut -d" " -f1`);
const remoteSha = (rr.stdout || '').trim();
if (!DRY && remoteSha !== localSha) {
  die('步骤 3（内容对账）', `本地 sha256 ≠ 远端：\n      local =${localSha.slice(0, 16)}…\n      remote=${remoteSha.slice(0, 16)}…`);
}
if (!DRY) {
  const un = ssh(`cd ${DIR} && tar xzf src.tar.gz -C src && echo UNPACK=OK`);
  if (!/UNPACK=OK/.test(un.stdout)) die('步骤 3（解包）', un.stderr.slice(0, 300));
  console.log(`   ✅ 对账成立 sha256=${localSha.slice(0, 16)}…（两端逐字相同）`);
} else console.log('   [dry-run] 未传输 ⇒ 对账这一步**没有被验证**');

/* ── 步骤 4：基础镜像必须在机器上（不在就停，不许悄悄 pull） ── */
console.log(`步骤 4：确认基础镜像已在机器上（${NODE_IMAGE}${SANDBOX ? ' / ' + PG_IMAGE : ''}）`);
const needPull = SANDBOX ? [NODE_IMAGE, PG_IMAGE] : [NODE_IMAGE];
const baseChk = needPull.map((i) => `docker image inspect ${i} >/dev/null 2>&1 && echo "HAVE ${i}" || echo "MISSING ${i}"`).join('; ');
const bc = ssh(baseChk);
const absent = (bc.stdout || '').split('\n').filter((l) => /MISSING/.test(l));
if (absent.length) {
  die(
    '步骤 4（基础镜像）',
    `${absent.join(' / ')} 不在这台机器上。`,
    '   🔴 这台机器的 dockerd 配了走 mihomo 的 proxy ⇒ 在这里 pull 一次就是**代理字节**。\n' +
      '      要补的话请离线 load（`docker save | ssh | docker load`），别在这里 pull。'
  );
}

/* ── 步骤 5：建镜像（proxy build-arg 显式置空 + 国内直连源） ── */
const IMAGE = SANDBOX ? `supersync:canary-${short}` : 'supersync:local';
console.log(`步骤 5：构建镜像 → ${IMAGE}（VCS_REF=${short}）`);
const proxyArgs = ['http_proxy=', 'https_proxy=', 'HTTP_PROXY=', 'HTTPS_PROXY=', 'all_proxy=', 'ALL_PROXY=']
  .map((a) => `--build-arg ${a}`)
  .join(' ');
const build = ssh(
  `cd ${DIR}/src && docker build --network=host ${proxyArgs} \\
     --build-arg NODE_IMAGE=${NODE_IMAGE} --build-arg APK_MIRROR=${APK} \\
     --build-arg NPM_REGISTRY=${NPM} \\
     --build-arg VCS_REF=${headSha} -f server/Dockerfile -t ${IMAGE} . 2>&1 | tail -12; \\
   docker image inspect ${IMAGE} >/dev/null 2>&1 && echo BUILD=OK || echo BUILD=FAIL`
);
console.log((build.stdout || '').trim().split('\n').slice(-6).map((l) => '   ' + l).join('\n'));
if (!DRY && !/BUILD=OK/.test(build.stdout)) die('步骤 5（构建）', '镜像没建出来。读法：这一条**曾经两次**是"本地全绿但镜像建不出来"（AGENTS §7 第 75 条）。');
if (!DRY) {
  const lbl = ssh(`docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' ${IMAGE}`);
  if ((lbl.stdout || '').trim() !== headSha) {
    die('步骤 5（产物身份）', `镜像里印的 revision ≠ 我送出去的 commit：\n      image=${(lbl.stdout || '').trim()}\n      sent =${headSha}`);
  }
  console.log(`   ✅ 镜像里的 OCI revision 标签 == 送出去的 commit（${short}）`);
}

/* ── 步骤 6：沙箱跑通（一次性 Postgres + 一次性 app），或生产换容器 ── */
if (SANDBOX) {
  const net = `ht-deploy-${runId}`;
  const db = `ht-deploy-${runId}-db`;
  const app = `ht-deploy-${runId}-app`;
  console.log(`步骤 6：沙箱 —— 网络 ${net} / 库 ${db} / 应用 ${app}（都是本脚本创建的，只删这三枚）`);
  const setup = ssh(`
set -e
docker network create ${net} >/dev/null 2>&1 || true
docker run -d --name ${db} --network ${net} \\
  -e POSTGRES_USER=htsandbox -e POSTGRES_PASSWORD=htsandbox -e POSTGRES_DB=htsandbox \\
  --health-cmd='pg_isready -U htsandbox' --health-interval=2s ${PG_IMAGE} >/dev/null
for i in $(seq 1 40); do docker exec ${db} pg_isready -U htsandbox >/dev/null 2>&1 && { echo DB=READY; exit 0; }; sleep 2; done
echo DB=NOT_READY; exit 6`);
  console.log('   ' + (setup.stdout || setup.stderr).trim());
  if (!DRY && setup.status !== 0) die('步骤 6（沙箱库）', '一次性 Postgres 没起来 —— 记环境无效，不记产品失败。');

  // DATABASE_URL 里**没有**任何生产秘密；沙箱口令是固定的占位值，可以出现在日志里。
  const DBURL = 'postgresql://htsandbox:htsandbox@db/htsandbox';
  const mig = ssh(
    `docker run --rm --network ${net} -e DATABASE_URL=${DBURL} --entrypoint sh ${IMAGE} \\
       -ec 'echo MIGRATE=started; sh scripts/migrate-deploy.sh 2>&1 | tail -12; echo MIGRATE_RC=${'$'}?'`
  );
  console.log((mig.stdout || '').trim().split('\n').slice(-8).map((l) => '   ' + l).join('\n'));
  if (!DRY && !/MIGRATE_RC=0/.test(mig.stdout)) {
    die('步骤 6（迁移）', 'migrate-deploy.sh 在**空库**上没跑通。这一条与生产无关，是镜像自身的迁移链坏了。');
  }

  const start = ssh(
    `docker run -d --name ${app} --network ${net} \\
       -e DATABASE_URL=${DBURL} -e JWT_SECRET=htsandboxjwt -e PASSWORD_PEPPER=htsandboxpepper \\
       -e PUBLIC_URL=http://127.0.0.1:15400 -e PORT=3000 \\
       -e http_proxy= -e https_proxy= -e HTTP_PROXY= -e HTTPS_PROXY= \\
       -p 127.0.0.1:15400:3000 ${IMAGE} >/dev/null && echo APP=STARTED`
  );
  console.log('   ' + (start.stdout || start.stderr).trim());
  const health = ssh(
    `for i in $(seq 1 30); do c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:15400/health); [ "$c" = "200" ] && { echo HEALTH=200; exit 0; }; sleep 2; done; echo "HEALTH=$c"; docker logs --tail=15 ${app} 2>&1; exit 7`
  );
  console.log('   ' + (health.stdout || '').trim().split('\n').slice(0, 6).map((l) => '   ' + l).join('\n'));
  const cleanup = ssh(`docker rm -f ${app} ${db} >/dev/null 2>&1; docker network rm ${net} >/dev/null 2>&1; echo CLEANUP=OK`);
  console.log('   ' + cleanup.stdout.trim());
  if (!DRY && !/HEALTH=200/.test(health.stdout)) {
    die('步骤 6（健康判据）', '/health 不是 200。命令退出码 0 **不算**这条判据 —— 只有这个读数是。');
  }
  console.log(`\n结论：沙箱 ✅ 镜像可建、迁移可在空库跑通、容器可健康、产物身份可对账。`);
  console.log(`     这一趟**没有**碰生产：${PROD_DIR} 未写、supersync:local 未覆盖、生产容器未重启。`);
  console.log(`     要真发生产：--apply --yes-production（会先留回滚 tag）。`);
  process.exit(0);
}

/* ── 生产路径：先留回滚点 → 同步源码 → 迁移 → 只换 supersync → 线上判据 ── */
console.log('步骤 6（生产）：留回滚 tag → 跑迁移 → 只换 supersync 容器');
const prod = `
set -e
cd ${PROD_DIR}/server
CUR=$(docker inspect -f '{{.Image}}' supersync-server 2>/dev/null || echo none)
echo "ROLLBACK_TARGET=${'$'}{CUR:0:19}"
docker tag supersync:local "supersync:rollback-${stamp}" && echo ROLLBACK_TAG=supersync:rollback-${stamp}
# 🔴 迁移在**旧容器还在服务**的时候跑，用的还是**新镜像自带**的那份 migrate-deploy.sh
MIGRATE_RC=0
docker run --rm --network supersync_default --env-file .env \\
  --entrypoint sh supersync:local -ec 'sh scripts/migrate-deploy.sh' || MIGRATE_RC=$?
echo "MIGRATE_RC=$MIGRATE_RC"
[ "$MIGRATE_RC" = "0" ] || { echo "拒绝换容器（迁移未成功，旧容器继续服务）"; exit 8; }
docker compose -f docker-compose.yml up -d --wait --wait-timeout 120 supersync && echo SWAPPED
for i in $(seq 1 20); do c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://$(grep -E '^DOMAIN=' .env | cut -d= -f2 | tr -d '"' | tr -d " ")/health); [ "$c" = "200" ] && { echo HEALTH=$c; exit 0; }; sleep 3; done
echo HEALTH=$c; exit 9`;
const pr = ssh(prod);
console.log((pr.stdout || '').trim().split('\n').map((l) => '   ' + l).join('\n'));
if (!DRY && pr.status !== 0) die('步骤 6（生产）', `rc=${pr.status} —— 回滚：在服务器上执行 docker tag supersync:rollback-${stamp} supersync:local 再 up -d`);
console.log(`\n线上判据请随后单独取（deployment.md §3.8.1 那五条）；本脚本只证 /health=200 与产物身份。`);
