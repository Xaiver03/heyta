#!/usr/bin/env node
/**
 * 门禁：**邮箱 + 口令的整条真链路**（计划 `docs/plans/email-password-auth.md` W9）
 * ==============================================================================
 *
 * 它补的是**唯一那一格**：注册/登录这两条路在 2026-10-02 之前有三层验收 ——
 * 服务端路由（`server/tests/password-auth-routes.spec.ts`）、宿主端口（`app-host`）、
 * node-host 的 CLI 逻辑层（假 fetch）。**三层都是"对着一个假的东西说真话"**：
 * 没有任何一条判据走过**真的 Postgres、真的 Argon2id、真发出去的那一封信、
 * 真的把令牌喂给同步并让另一台设备读到**。
 *
 * 而这一条链偏偏是**最容易在半路上掉东西**的那种：注册不发令牌（A1）、
 * 口令对了但邮箱没验证（403 而不是 401）、假成功不覆盖已有凭据（A2）、
 * 登录口令**不是**加密口令（两个秘密）—— 每一条都只在"跑到底"时才暴露。
 *
 * ## 走法（被测入口是**产品自己的命令**，不是重打一遍 HTTP）
 *
 * ```
 *   printf '%s' "$登录口令" | node apps/node-host/dist/cli.js auth register …
 *   printf '%s' "$登录口令" | node apps/node-host/dist/cli.js auth login   …  → 令牌
 *   node …cli.js --db 设备1.sqlite --token <那枚> --password <另一个秘密> add/sync
 *   设备2（空库）auth login → sync → 读到同一条任务
 * ```
 *
 * ## 前置
 *
 * 本机 Postgres（与其它验收同一套约定）。**不开 TEST_MODE** —— 走了 TEST_MODE
 * 就等于把"真发一封信、真点一次验证"这两格跳掉，而它们正是这条链的第一半。
 * 本机没有 `SMTP_*` ⇒ 走 `email.ts` 的 Ethereal 兜底，脚本从日志里把
 * preview URL **抓回来读**（这比"断言邮件服务被调用过"硬得多）。
 *
 * ## 明确**不**验
 *
 * - 不验 UI 点击（那是 `e2e/` 与 `verify:email-web` 的事）；
 * - 不验通行密钥（WebAuthn 需要真 origin，见 §9c 那条 Chromium 限制）；
 * - 不验找回/改密那两条（各自有服务端判据）。
 *
 * ## 判据一览（证据文件指着这一节，所以列在这里）
 *
 * ```
 *   ⓪ 太短口令的拒绝来自**真服务端**，且终端那句的阈值等于共享常量
 *   ① 没勾 `--terms` ⇒ CLI 红 **并且**库里一行都没多（"一个请求都不发"是事实不是文案）
 *   ② 注册被受理，但**不产出令牌**（A1），而哈希已经落库
 *   ③ 那封信**真的存在**：从 Ethereal preview 里取出指向本次服务端的链接
 *   ④ 验证前打口令登录 ⇒ 403 `email_not_verified`（口令**已经验对了**才允许说这句）
 *   ⑤ GET 只渲染确认页、**不消费**令牌；POST 才换到会话
 *      （令牌一次性不在这里判 —— `verify:email-auth` 的 ⑤ 已经钉过同一条）
 *   ⑥ CLI 登录产出 JWT，并明说"同步还要另一个口令"（两个秘密）
 *   ⑦ 反枚举：口令错 / 账号没设口令 / 根本没有这个邮箱 ⇒ **逐字节同一句**
 *   ⑧ 设备1 写入 → 同步 → 服务端**数得出**那一行（只存密文，所以数条数不判内容）
 *   ⑨ 新设备（真空库）登录 → 同步 → 读到同一条；反证：加密口令错 ⇒ 结构化失败、
 *      本地零条、换回正确口令后**这台设备**仍能拉下来（不是永久卡死）
 *   ⑩ A2 假成功：对已验证邮箱再注册 ⇒ 仍是中性受理，而 `password_hash` 逐字节没变
 *   ⑪ 第 6 次失败 ⇒ `account_locked` + **真的** `Retry-After`，终端给具体秒数与换路出口
 * ```
 *
 * 🔴 这些判据**能不能失败**由 `scripts/mutate-password-chain.mjs` 回答：
 *    四条变异（CLI 同意闸门 / 覆盖活账号口令 / 跳过邮箱验证 / 口令路变成枚举预言机），
 *    每条要求**对应那一格**变红 —— 整条链变红不算，那只能证明"某一格坏了"。
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AUTH_PASSWORD_MIN_CODE_POINTS } from '@heyta/shared-schema';

import {
  databaseUrlFor,
  ensureDatabase,
  ensureServerBuilt,
  resolveNode,
  toLibpqUrl,
} from './lib/auth-journey-server.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = '3232';
const BASE = `http://127.0.0.1:${PORT}`;
const DB_NAME = 'heyta_pw_chain';
const EVIDENCE = join(ROOT, 'apps/web/evidence/password-chain');
const WORK = join(ROOT, 'tmp/password-chain');
const CLI = join(ROOT, 'apps/node-host/dist/cli.js');

/**
 * 登录口令与**端到端加密口令**是两个不同的秘密 —— 这条链要把它们用成两个。
 *
 * ⚠️ 别把这两条串改成 `server/src/password/hash.ts` 的 `PASSWORD_KAT` 那几个串：
 *    那是**已知答案测试**的夹具，改它的期望值会让服务端启动自检红，
 *    而症状会被读成"这条链坏了"。所以这里用与夹具无关的短语。
 */
const LOGIN_PASSWORD = 'lantern otter ledger 27';
const E2EE_PASSWORD = 'an entirely different secret 7';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
function check(ok, what) {
  console.log(`  ${ok ? '✅' : '❌'} ${what}`);
  if (!ok) failed = true;
  return ok;
}
function bail(why, detail) {
  console.error(`\n❌ ${why}`);
  if (detail !== undefined) console.error(String(detail).split('\n').slice(-20).join('\n'));
  process.exit(1);
}

const node = resolveNode();
const dbUrl = databaseUrlFor(DB_NAME);
console.log(`· 库：${DB_NAME}`);
ensureDatabase({ root: ROOT, dbUrl, dbName: DB_NAME });
await ensureServerBuilt({ root: ROOT, dbUrl });

// 🔴 CLI 本身就是被测入口之一 —— 产物比源码旧会把"上一轮的 CLI"验成这一轮
//    （AGENTS §7 第 27 条那个形状的失效）。所以按需重打，而不是假设已经 build 过。
function ensureCliBuilt() {
  const srcDir = join(ROOT, 'apps/node-host/src');
  const newer = spawnSync(
    'sh',
    ['-c', `find ${JSON.stringify(srcDir)} -newer ${JSON.stringify(CLI)} -name '*.ts' | head -1`],
    { encoding: 'utf8' },
  );
  if (newer.stdout.trim() !== '' || !requireExists(CLI)) {
    console.log('· apps/node-host/dist 比源码旧（或不存在），重新构建…');
    const built = spawnSync('pnpm', ['--filter', '@heyta/node-host', 'build'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (built.status !== 0) bail('node-host 构建失败', `${built.stdout}\n${built.stderr}`);
  }
}
// `existsSync` 的极小本地版（避免再引一个 import 行）；语义就是"在不在"。
function requireExists(p) {
  return spawnSync('test', ['-e', p]).status === 0;
}
ensureCliBuilt();

console.log('· 启动服务端（**不开 TEST_MODE** —— 要走真发信 + 真点验证）…');
// ⚠️ 刻意**不**复用 `startServer()`：那个助手固定带 TEST_MODE（会自动验证、不发真信），
//    而这条链的第一半就是"那一封信真的存在"。与 `verify-email-auth-chain.mjs` 同一份理由。
const server = spawn(node, ['dist/src/index.js'], {
  cwd: join(ROOT, 'server'),
  env: {
    ...process.env,
    DATABASE_URL: dbUrl,
    NODE_ENV: 'test',
    PORT,
    HOST: '127.0.0.1',
    // 🔴 必须显式指到 127.0.0.1：默认 `localhost` 在 macOS 上常先解析到 `::1`，
    //    而服务端只绑 IPv4 ⇒ 症状是"信里的链接打不开"。
    PUBLIC_URL: BASE,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => (log += d.toString()));
server.stderr.on('data', (d) => (log += d.toString()));
process.on('SIGINT', () => server.kill());
process.on('exit', () => server.kill());

let up = false;
for (let i = 0; i < 60 && !up; i += 1) {
  await sleep(500);
  try {
    up = (await fetch(`${BASE}/health`)).ok;
  } catch {
    /* 还没起来 */
  }
}
if (!up) bail('服务端没起来', log);
console.log(`· 服务端就绪 ${BASE}\n`);

/**
 * 跑一条 CLI 命令。**口令永远走 stdin**，所以这里用 `input` 喂子进程的 stdin，
 * 绝不拼进 args —— 那正是这条链要证明的规矩，探针自己先得守。
 */
function cli(args, { input = '', env = {} } = {}) {
  const r = spawnSync(node, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    env: { ...process.env, ...env },
    timeout: 120_000,
  });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  if (r.error) bail(`CLI 根本没起来：${r.error.message}`, args.join(' '));
  let json = null;
  try {
    json = JSON.parse(stdout);
  } catch {
    /* 人读模式（或失败得连 JSON 都没有）—— 由调用方按 code 判断 */
  }
  return { code: r.status ?? 1, stdout, stderr, out: `${stdout}${stderr}`, json };
}

const psql = (sql) => {
  const r = spawnSync('psql', [toLibpqUrl(dbUrl), '-tAc', sql], { encoding: 'utf8' });
  return r.stdout.trim();
};
const userRow = (email) =>
  psql(`select id, is_verified, coalesce(length(password_hash),0), verification_token is null ` +
    `from users where email='${email}'`);

const stamp = String(Date.now());
const EMAIL = `pw-chain-${stamp}@example.com`;
const LOCK_EMAIL = `pw-chain-lock-${stamp}@example.com`;

// ── ⓪ 策略的拒绝是真服务端给的，不是假 fetch 演的 ─────────────────────────
{
  const r = cli(['auth', 'register', '--server', BASE, '--email', `short-${stamp}@example.com`, '--terms', '--json'], {
    input: '123',
  });
  check(
    r.code !== 0 && r.json?.ok === false && r.json?.policyCode === 'too_short',
    `⓪ 太短的口令被**真服务端**按 policyCode 拒掉（policyCode=${String(r.json?.policyCode)}）`,
  );
  // 🔴 人读模式**单开一次**：机器模式按设计只吐字段，那句话只在终端那条路上存在。
  //    原来这里拿 `--json` 的输出去找「至少」，判据**永远不可能绿** ——
  //    而它红的时候看起来像"文案坏了"，其实是探针用错了模式（本轮实测）。
  const human = cli(['auth', 'register', '--server', BASE, '--email', `short-${stamp}@example.com`, '--terms'], {
    input: '123',
  });
  // 阈值**从共享常量推**，不是正则里手打一个 8：手打的那个数会跟着产品一起过期，
  // 而判据会在一个正确的实现上报绿（`scripts/mutate-node-host-auth.mjs` 的 M9 同源）。
  const stated = /至少[^\d]{0,3}(\d{1,3})\s*个字符/.exec(human.out)?.[1];
  check(
    stated === String(AUTH_PASSWORD_MIN_CODE_POINTS) && !/NaN|undefined/.test(human.out),
    `⓪ 那句话给的是可执行的动作，且阈值**等于共享常量** ${String(AUTH_PASSWORD_MIN_CODE_POINTS)}（终端说的是"${stated ?? human.out.replace(/\s+/g, ' ').slice(0, 70)}"）`,
  );
}

// ── ① 同意闸门：**服务端压根没被碰过**（用库里的行数证明，而不是信它自己说的话）──
const before = psql(`select count(*) from users where email='${EMAIL}'`);
{
  const r = cli(['auth', 'register', '--server', BASE, '--email', EMAIL, '--json'], {
    input: LOGIN_PASSWORD,
  });
  const after = psql(`select count(*) from users where email='${EMAIL}'`);
  check(
    r.code !== 0 && before === '0' && after === '0',
    `① 没给 --terms ⇒ CLI 红、而库里该邮箱仍是 ${after} 行（"一个请求都不发"是**事实**，不是文案）`,
  );
}

// ── ② 真注册（走 CLI）：受理，但**不产出令牌**（A1）──────────────────────
{
  const r = cli(['auth', 'register', '--server', BASE, '--email', EMAIL, '--terms', '--json'], {
    input: LOGIN_PASSWORD,
  });
  check(r.code === 0 && r.json?.ok === true, `② CLI 注册被受理（HTTP 侧 exit=${String(r.code)}）`);
  check(
    r.json?.tokenIssued === false && r.json?.token === undefined,
    '② 注册那一步**没有**令牌（A1：登录是唯一发令牌的落点）',
  );
  const row = userRow(EMAIL);
  check(
    /^(\d+)\|0\|\d+\|f$/.test(row),
    `② 库里已有一行且未验证、口令已存（id|verified|hash长度|token已清 = ${row || '无'}）`,
  );
}

// ── ③ 那封信**真的存在**：从服务端日志抓 preview，再从信里取链接 ─────────
let preview = '';
for (let i = 0; i < 40 && preview === ''; i += 1) {
  await sleep(500);
  preview = /Preview URL: (\S+)/.exec(log)?.[1] ?? '';
}
if (preview === '') bail('没拿到 Ethereal preview URL（没网？还是发信本身失败了？）', log);
/**
 * 🔴 Ethereal 预览页把正文内嵌时做了两层转义（`\u002f` 与 `&amp;`）。
 *    不归一化就取不出链接 —— 症状是"信里明明有 token，脚本说没有"。
 */
const raw = await (await fetch(preview)).text();
const message = raw.replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
const link = /(https?:\/\/[^"'\s]*\/verify-email\?token=[0-9a-f]+)/.exec(message)?.[1] ?? '';
check(link !== '' && link.startsWith(BASE), `③ 信里带着指向**本次**服务端的验证链接`);
const verifyToken = /token=([0-9a-f]+)/.exec(link)?.[1] ?? '';

// ── ④ 验证**之前**打口令登录：必须是 403 那条，而且要说清"口令是对的" ──────
{
  const r = cli(['auth', 'login', '--server', BASE, '--email', EMAIL, '--json'], {
    input: LOGIN_PASSWORD,
  });
  check(
    r.code !== 0 && r.json?.code === 'email_not_verified',
    `④ 未验证邮箱 ⇒ 真服务端回的是 code=email_not_verified（不是 401）—— 口令**已经验对了**`,
  );
}
{
  // 人读模式：那句话必须给动作（去收件箱），而且不许把人推回去"再试一次口令"。
  const r = cli(['auth', 'login', '--server', BASE, '--email', EMAIL], {
    input: LOGIN_PASSWORD,
  });
  check(
    /验证/.test(r.out) && !/口令不对|账号不存在/.test(r.out),
    `④ 终端上那句话指向"去收那封邮件"，而不是"口令打错了"`,
  );
}

// ── ⑤ GET 那个链接渲染的是确认页，且**不消费**令牌 ────────────────────────
{
  const page = await fetch(link);
  const html = await page.text();
  check(page.ok, `⑤ GET 验证链接可打开（HTTP ${String(page.status)}）`);
  check(
    html.includes('data-token=') || html.includes('/magic-login-confirm.js'),
    '⑤ 它是**确认页**（带确认脚本/令牌），不是"已失效"页 ⇒ GET 没把令牌烧掉',
  );
  const verified = await fetch(`${BASE}/api/auth/email/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: verifyToken }),
  });
  const body = await verified.json();
  check(
    verified.ok && body.kind === 'session' && typeof body.token === 'string',
    `⑤ 令牌换到了会话（kind=${String(body.kind)}）—— 验证这一步本身不需要口令`,
  );
  check(/^(\d+)\|1\|\d+\|t$/.test(userRow(EMAIL)), `⑤ 库里 is_verified=1 且令牌已清`);
}

// ── ⑥ 口令登录（CLI）产出令牌，并且说出"这是两个秘密" ─────────────────────
let loginToken = '';
{
  const j = cli(['auth', 'login', '--server', BASE, '--email', EMAIL, '--json'], {
    input: LOGIN_PASSWORD,
  });
  check(
    j.code === 0 && typeof j.json?.token === 'string' && j.json.token.split('.').length === 3,
    `⑥ CLI 登录拿到一枚 **JWT**（三段）—— 这一枚就是同步要用的那个令牌`,
  );
  loginToken = j.json?.token ?? '';
  const human = cli(['auth', 'login', '--server', BASE, '--email', EMAIL], {
    input: LOGIN_PASSWORD,
  });
  check(
    /端到端加密|另一个|不是同一个/.test(human.out),
    '⑥ 成功那句**明说**同步还要另一个口令（症状"能登录、同步却解不开自己的数据"没人认得）',
  );
}
if (loginToken === '') bail('⑥ 没拿到令牌，后面的同步一格都跑不了');

// ── ⑦ 错口令：真服务端的 401，而且三种情况**同一句**（反枚举）─────────────
{
  const r = cli(['auth', 'login', '--server', BASE, '--email', EMAIL, '--json'], {
    input: 'definitely the wrong one 3',
  });
  check(
    r.code !== 0 && r.json?.reason === 'invalid-credentials' && r.json?.status === 401,
    `⑦ 错口令 ⇒ reason=invalid-credentials / status=${String(r.json?.status)}`,
  );

  // 🔴 **不**用"文案里有没有某个词"来判反枚举。CLI 那句话本来就**解释**了
  //    "三种情况在服务端是同一句"，里面赫然写着「账号不存在」——
  //    关键词黑名单于是把自己判红（本轮实测）。真正的判据是**比对输出**：
  //    三种账号状态，打在终端上的句子必须**逐字节相同**。
  //    这样"服务端哪天开始区分"立刻转红，而"文案将来怎么改写"都不会误红。
  const noPasswordEmail = `no-password-${stamp}@example.com`;
  const nobodyEmail = `nobody-${stamp}@example.com`;
  // 造一个**没有口令认证器**的账号：魔法链接注册不带口令，而 `loginWithEmailPassword`
  // 里 `!user.passwordHash` 那条分支在 `is_verified` 检查**之前**，所以连验证都不需要。
  const mk = await fetch(`${BASE}/api/register/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: noPasswordEmail }),
  });
  check(mk.status === 201, `⑦ 反枚举要三个状态：造一个"有账号但没口令"的（HTTP ${String(mk.status)}）`);

  const said = (email) => {
    const run = cli(['auth', 'login', '--server', BASE, '--email', email], {
      input: 'definitely the wrong one 3',
    });
    // node 的 SQLite 实验警告带 **PID**，每个子进程都不一样 ⇒ 先剥掉，
    // 否则比的是"两次启动的 PID 相同吗"。
    return run.out
      .split('\n')
      .filter((line) => !/^\(node:\d+\)/.test(line) && !/^\(Use `node --trace-warnings/.test(line))
      .join('\n')
      .trim();
  };
  const texts = [said(EMAIL), said(noPasswordEmail), said(nobodyEmail)];
  check(
    texts[0] !== '' && new Set(texts).size === 1,
    `⑦ 三种账号状态（口令错 / 没设口令 / 无此邮箱）⇒ **同一句**：${texts[0].replace(/\s+/g, ' ').slice(0, 46)}…`,
  );
  check(/邮箱或口令/.test(texts[0]), '⑦ 那句话是中性的一句"邮箱或口令不对"');
}

// ── ⑧ 上行：设备 1 建一条任务 → sync → **服务端数得出那一条** ─────────────
const TASK_TITLE = `真链路 ${stamp}`;
mkdirSync(WORK, { recursive: true });
const DEV1 = join(WORK, 'dev1.sqlite');
const DEV2 = join(WORK, 'dev2.sqlite');
const DEV3 = join(WORK, 'dev3.sqlite');
/**
 * 🔴 每一轮都从**真的空库**开始。这三个文件名是固定的，而上一轮的库会留在原地：
 *    第二次跑的时候 ⑨"新设备空库"读到的其实是**上一轮那条任务**，
 *    本轮新建的这条反而拉不下来（游标属于上一个用户的那条流），判据当场红 ——
 *    症状长得像"同步坏了"，实际是探针复用了自己上一次的产物（本轮实测）。
 *    `-wal` / `-shm` 是 SQLite 的伴生文件，漏删任何一个都等于没清库。
 */
for (const base of [DEV1, DEV2, DEV3]) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${base}${suffix}`, { force: true });
}
const globalFlags = (db, token) => ['--db', db, '--server', BASE, '--token', token];
{
  const added = cli([...globalFlags(DEV1, loginToken), '--json', 'add', TASK_TITLE]);
  check(added.code === 0 && typeof added.json?.id === 'string', `⑧ 设备1 建了任务（id=${String(added.json?.id)}）`);
  const synced = cli([...globalFlags(DEV1, loginToken), '--json', '--password', E2EE_PASSWORD, 'sync']);
  check(synced.code === 0 && synced.json?.ok === true, `⑧ 设备1 同步成功（用**另一个**口令）`);
  const userId = psql(`select id from users where email='${EMAIL}'`);
  const ops = psql(`select count(*) from operations where user_id=${userId}`);
  check(Number(ops) >= 1, `⑧ 服务端**数得出**上行（operations ${ops} 条；只存密文，所以数条数不判内容）`);
}

// ── ⑨ 新设备：第二次口令登录（同口令）→ 空库 sync → 读到那条任务 ──────────
{
  const again = cli(['auth', 'login', '--server', BASE, '--email', EMAIL, '--json'], {
    input: LOGIN_PASSWORD,
  });
  const token2 = again.json?.token ?? '';
  // ⚠️ 这里**不断言** `token2 !== loginToken`。`issueSession` 的载荷只有
  //    `{userId,email,tokenVersion}` + `iat`（秒级）⇒ 同一秒内两次登录签出的 JWT
  //    **逐字节相同**，判"另一枚"会把一条真链路误读成红灯。
  //    要证的是"第二次登录拿到的令牌**真的能用**"—— 那由下面设备2 的同步裁决。
  check(
    again.code === 0 && token2.split('.').length === 3,
    '⑨ 同口令能再次登录，拿到的仍是一枚可用的 JWT（下一格就用它同步）',
  );
  const synced = cli([...globalFlags(DEV2, token2), '--json', '--password', E2EE_PASSWORD, 'sync']);
  check(synced.code === 0, '⑨ 设备2（空库）同步成功');
  const listed = cli([...globalFlags(DEV2, token2), '--json', 'list']);
  const titles = (listed.json?.tasks ?? []).map((t) => t.title);
  check(
    titles.includes(TASK_TITLE),
    `⑨ 设备2 读到那条任务（同一 E2EE 口令才解得开）：${JSON.stringify(titles)}`,
  );
  // 🔴 反证：口令对了、但**加密口令**换一个。这里原来判的是"同步 exit=0"，
  //    本轮实测**那句是错的**：客户端回的是结构化的 `undecryptable-page`
  //    （`retryable: false`）并以失败退出 —— 而这**才是对的产物**：
  //    "能登录、同步却解不开自己的数据"必须让人看见，静默成功等于把数据藏起来。
  //    所以要判的是三件事：① 失败是**结构化**的且点名 undecryptable-page（不是"网络问题"）；
  //    ② 本地库**一条都没有**（解不开就整条跳过，不落半个明文）；
  //    ③ 换回正确口令后**同一台设备**拉得下来 —— 那一次失败没把同步永久卡死（ADR-0016 §6）。
  const wrong = cli([...globalFlags(DEV3, token2), '--json', '--password', 'yet another secret 1', 'sync']);
  check(
    wrong.code !== 0 && wrong.json?.status?.reason === 'undecryptable-page',
    `⑨ 反证：加密口令不对 ⇒ **结构化**失败（reason=${String(wrong.json?.status?.reason)}），不是炸死也不是"网络问题"`,
  );
  const wrongList = cli([...globalFlags(DEV3, token2), '--json', 'list']);
  check(
    (wrongList.json?.tasks ?? []).length === 0,
    `⑨ 而本地库里确实一条都没有（读到的条数 = ${String((wrongList.json?.tasks ?? []).length)}）`,
  );
  const recovered = cli([...globalFlags(DEV3, token2), '--json', '--password', E2EE_PASSWORD, 'sync']);
  const recoveredList = cli([...globalFlags(DEV3, token2), '--json', 'list']);
  check(
    recovered.code === 0 &&
      (recoveredList.json?.tasks ?? []).map((t) => t.title).includes(TASK_TITLE),
    '⑨ 换回正确口令后**这台设备**能拉到那条（失败没有留下卡死的游标 —— ADR-0016 §6）',
  );
}

// ── ⑩ A2 假成功：对**已验证**的邮箱再注册一次，不许覆盖已有凭据 ────────────
{
  const hashBefore = psql(`select md5(coalesce(password_hash,'')) from users where email='${EMAIL}'`);
  const r = cli(['auth', 'register', '--server', BASE, '--email', EMAIL, '--terms', '--json'], {
    input: 'a completely different new one 5',
  });
  check(
    r.code === 0 && r.json?.ok === true,
    '⑩ 已注册邮箱再注册 ⇒ 仍是那句**中性**的受理（不是"这个邮箱已被占用"）',
  );
  const hashAfter = psql(`select md5(coalesce(password_hash,'')) from users where email='${EMAIL}'`);
  check(hashAfter === hashBefore, '⑩ 而 password_hash **逐字节没变**（假成功不写凭据）');
  const stillOld = cli(['auth', 'login', '--server', BASE, '--email', EMAIL, '--json'], {
    input: LOGIN_PASSWORD,
  });
  check(stillOld.code === 0, '⑩ 旧口令仍能登录（被覆盖的话这里就是 401）');
}

// ── ⑪ 锁：5 次失败之后必须换成"等 N 秒"，且 N 是真数（独立账号，不牵连上面）──
{
  const reg = cli(['auth', 'register', '--server', BASE, '--email', LOCK_EMAIL, '--terms', '--json'], {
    input: LOGIN_PASSWORD,
  });
  check(reg.code === 0, '⑪ 为锁这条路单开一个账号（不牵连上面那个身份）');
  let last = null;
  for (let i = 0; i < 5; i += 1) {
    last = cli(['auth', 'login', '--server', BASE, '--email', LOCK_EMAIL, '--json'], {
      input: 'wrong attempt number ' + String(i) + ' 9',
    });
  }
  // 🔴 两层判别都要：**服务端机器码**是蛇形的 `invalid_credentials`，
  //    app-host 归一化后的 `reason` 是连字符的 `invalid-credentials`。
  //    只判其中一个，另一层漂移（比如码表映射被拿掉）就抓不到。
  check(
    last?.json?.code === 'invalid_credentials' &&
      last?.json?.reason === 'invalid-credentials',
    `⑪ 第 5 次失败仍是 401（code=${String(last?.json?.code)} / reason=${String(last?.json?.reason)}，锁是**下一次**才生效）`,
  );
  const locked = cli(['auth', 'login', '--server', BASE, '--email', LOCK_EMAIL, '--json'], {
    input: 'wrong attempt number 6 9',
  });
  check(
    locked.json?.code === 'account_locked' && Number(locked.json?.retryAfterSeconds) > 0,
    `⑪ 第 6 次 ⇒ account_locked + 真的 retryAfterSeconds=${String(locked.json?.retryAfterSeconds)}`,
  );
  const human = cli(['auth', 'login', '--server', BASE, '--email', LOCK_EMAIL], {
    input: 'wrong attempt number 7 9',
  });
  check(
    /等\s*\d+\s*秒/.test(human.out) && !/等 0 秒|等 undefined|等 NaN/.test(human.out),
    `⑪ 终端上说的是**具体秒数**，不是一个没算出来的数`,
  );
  check(/链接|通行密钥|别的/.test(human.out), '⑪ 并且给出**换路**出口（锁的是口令这个认证器，不是账号）');
}

// ── 证据落盘 ──────────────────────────────────────────────────────────────
mkdirSync(EVIDENCE, { recursive: true });
writeFileSync(
  join(EVIDENCE, 'password-chain-run.txt'),
  [
    `# 邮箱+口令真链路（W9）· ${new Date().toISOString()}`,
    `SERVER=http://127.0.0.1:${PORT} (TEST_MODE off, real email via Ethereal)`,
    `EMAIL=${EMAIL}`,
    `LOCK_EMAIL=${LOCK_EMAIL}`,
    `PREVIEW=${preview}`,
    `DB_ROW_FINAL=${userRow(EMAIL)}`,
    `OPERATIONS=${psql(`select count(*) from operations where user_id=(select id from users where email='${EMAIL}')`)}`,
    // 这份证据是**要提交进仓库**的，所以只写相对路径 —— 绝对路径会把开发机的主目录名带进公开仓库。
    `EVIDENCE_FILES=${[DEV1, DEV2, DEV3].map((p) => relative(ROOT, p)).join(',')}`,
    `RESULT=${failed ? 'FAIL' : 'PASS'}`,
    '',
    '# 判据 ⓪-⑪ 的语义写在 scripts/verify-email-password-chain.mjs 文件头。',
    '',
  ].join('\n'),
);

console.log('');
server.kill();
if (failed) {
  console.error('❌ 邮箱+口令真链路**未通过**（证据在 apps/web/evidence/password-chain/）');
  process.exit(1);
}
console.log(
  '✅ 真链路通过：CLI 注册（不产令牌）→ 真发一封信 → 未验证时 403 → 验证 → CLI 登录拿令牌 →\n' +
    '   上行被服务端数出 → 新设备读到同一条（错的加密口令则结构化失败并可恢复）→\n' +
    '   三种账号状态同一句 → 假成功不覆盖凭据 → 第 6 次失败给的是具体秒数。',
);
process.exit(0);
