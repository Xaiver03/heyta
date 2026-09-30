#!/usr/bin/env node
/**
 * 门禁：**邮箱链接全链路**（ADR-0039 §2.1/§2.2）
 * ==============================================
 *
 * 它验的是一条**真的走过邮件**的链，而不是"端点返回 200"：
 *
 *   ① 注册（`POST /api/register/magic-link`）
 *   ② **真的发出一封信** —— 本地没有 SMTP 时走 `email.ts` 的 Ethereal 兜底，
 *      它会把 **preview URL** 打进日志；脚本去把那封信**读回来**
 *   ③ 从信里取出 `/verify-email?token=…` 链接
 *   ④ **GET 那个链接**：必须渲染**确认页**，且**不消费**令牌
 *      （🔴 这一步是本 ADR 的核心修复：原实现 GET 就 `await verifyEmail(token)`，
 *        于是邮件客户端的**链接预取**会替用户把令牌烧掉）
 *   ⑤ `POST /api/auth/email/verify`：必须拿到 **会话**（`kind:'session'` + JWT）
 *      —— 这就是"注册也是一次点击就进去"（ADR-0039 §2.2）
 *   ⑥ 令牌**一次性**：再 POST 一次必须 401
 *   ⑦ 库里 `is_verified=1` 且 `verification_token` 已清
 *
 * ## 用法
 *
 *   node scripts/verify-email-auth-chain.mjs
 *
 * 前置：本机 Postgres（与其它验收同一套约定）。**不需要** SMTP 配置，
 * 也**不需要** TEST_MODE —— 走了 TEST_MODE 就等于绕开了"真的发一封信"这一格。
 *
 * ## 它明确**不**验什么
 *
 * - 不验 UI 点击（那是浏览器套件的事，见 `e2e/auth-journey/`）；
 * - 不验真实短信（手机号那条是**预留**，见 ADR-0039 §2.4）；
 * - 不验桌面壳的回调（`heyta://auth`，那是反向授权那一步，单独验）。
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  databaseUrlFor,
  ensureDatabase,
  ensureServerBuilt,
  resolveNode,
  toLibpqUrl,
} from './lib/auth-journey-server.mjs';

// ⚠️ `new URL('..')` 会**保留尾斜杠**，而 `path.join()` 不会 ——
//    这个区别在 `scripts/lib/auth-journey-server.mjs` 里曾经是承重的
//    （它到处是 `${root}server` 这样的拼接）。库现在已归一化，
//    但这里仍跟着既有调用方的写法，少一个变量。
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = '3221';
const BASE = `http://127.0.0.1:${PORT}`;
const DB_NAME = 'heyta_email_chain';
const EVIDENCE = join(ROOT, 'apps/web/evidence/email-chain');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
function check(ok, what) {
  console.log(`  ${ok ? '✅' : '❌'} ${what}`);
  if (!ok) failed = true;
}
function bail(why, log) {
  console.error(`\n❌ ${why}`);
  if (log) console.error(log.split('\n').slice(-15).join('\n'));
  process.exit(1);
}

const node = resolveNode();
const dbUrl = databaseUrlFor(DB_NAME);
console.log(`· 库：${DB_NAME}`);
ensureDatabase({ root: ROOT, dbUrl, dbName: DB_NAME });
await ensureServerBuilt({ root: ROOT, dbUrl });

console.log(`· 启动服务端（**不开 TEST_MODE** —— 要走真的发信那条路）…`);
const server = spawn(node, ['dist/src/index.js'], {
  cwd: join(ROOT, 'server'),
  env: {
    ...process.env,
    DATABASE_URL: dbUrl,
    NODE_ENV: 'test',
    PORT,
    HOST: '127.0.0.1',
    // 🔴 必须显式指到 127.0.0.1：默认是 `http://localhost:<port>`，
    //    而 macOS 上 `localhost` 常先解析到 `::1`，服务端只绑 IPv4 ⇒ 链接打不开
    //    （本仓在 vite 上记过同一条）。
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

// ── ① 注册（请求一封验证邮件）───────────────────────────────────────────
const email = `email-chain-${String(Date.now())}@example.com`;
const reg = await fetch(`${BASE}/api/register/magic-link`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email }),
});
check(reg.status === 201 || reg.ok, `① 注册被受理（HTTP ${String(reg.status)}）`);

// ── ② 把那封信**读回来** ───────────────────────────────────────────────
let preview = '';
for (let i = 0; i < 40 && preview === ''; i += 1) {
  await sleep(500);
  preview = /Preview URL: (\S+)/.exec(log)?.[1] ?? '';
}
if (preview === '') bail('没拿到 Ethereal preview URL（是没网，还是发信失败了？）', log);
console.log(`  · 那封信：${preview}`);
/**
 * 🔴 Ethereal 的预览页是**外壳页**，它把邮件正文内嵌时做了两层转义：
 *    斜杠变成 `\u002f`（JSON 转义）、`&` 变成 `&amp;`（HTML 实体）。
 *    不归一化就取不出链接 —— 而症状是"信里明明有 token，脚本说取不到"。
 */
const rawMessage = await (await fetch(preview)).text();
const message = rawMessage
  .replace(/\\u002f/gi, '/')
  .replace(/\\\//g, '/')
  .replace(/&amp;/g, '&');
check(/verify-email\?token=/.test(message), '② 信里**确实**带着 /verify-email?token= 链接');

const link = /(https?:\/\/[^"'\s]*\/verify-email\?token=[0-9a-f]+)/.exec(message)?.[1] ?? '';
if (link === '') bail('信里取不出链接', message.slice(0, 500));
check(link.startsWith(BASE), `② 链接指向**本次**的服务端（${link.slice(0, 40)}…）`);
const token = /token=([0-9a-f]+)/.exec(link)?.[1] ?? '';

// ── ③ GET 链接：渲染确认页，且**不消费**令牌 ───────────────────────────
const pageRes = await fetch(link);
const pageHtml = await pageRes.text();
check(pageRes.ok, `③ GET 链接可打开（HTTP ${String(pageRes.status)}）`);
check(
  pageHtml.includes('/magic-login-confirm.js') && pageHtml.includes('data-token='),
  '③ 它渲染的是**确认页**（带确认脚本与令牌），不是"已失效"页',
);

// ── ④ POST 换会话（若 ③ 消费了令牌，这里必然失败）──────────────────────
const verify = await fetch(`${BASE}/api/auth/email/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token }),
});
const verified = await verify.json();
check(
  verify.ok && verified.kind === 'session' && typeof verified.token === 'string',
  `④ 换到**会话**（kind=${String(verified.kind)}，HTTP ${String(verify.status)}）—— 注册一次点击就进去`,
);
check(
  verified.user?.email === email,
  `④ 会话属于刚注册的那个邮箱（${String(verified.user?.email)}）`,
);

// ── ⑤ 令牌一次性 ──────────────────────────────────────────────────────
const again = await fetch(`${BASE}/api/auth/email/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token }),
});
check(again.status === 401, `⑤ 同一个令牌再用一次被拒（HTTP ${String(again.status)}）`);

// ── ⑥ 库里的落地状态 ──────────────────────────────────────────────────
const sql = `select is_verified, verification_token is null as cleared from users where email='${email}'`;
// ⚠️ 必须剥掉 Prisma 专有查询参数（`?schema=` 等）—— `psql` 只认 libpq URL。
//    不剥的症状是 psql 直接失败、stdout 为空，而判据只会说"读到空"。
const psql = spawnSync('psql', [toLibpqUrl(dbUrl), '-tAc', sql], { encoding: 'utf8' });
check(
  psql.stdout.trim() === '1|t',
  `⑥ 库里 is_verified=1 且 verification_token 已清（读到 ${psql.stdout.trim() || '空'}）`,
);

// ── ⑦ 注入：坏令牌不许换到会话 ────────────────────────────────────────
const bogus = await fetch(`${BASE}/api/auth/email/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: 'deadbeef'.repeat(8) }),
});
check(bogus.status === 401, `⑦ 注入：伪造令牌被拒（HTTP ${String(bogus.status)}）`);

// ── 证据落盘 ──────────────────────────────────────────────────────────
mkdirSync(EVIDENCE, { recursive: true });
writeFileSync(
  join(EVIDENCE, 'email-chain-run.txt'),
  [
    `# 邮箱链接全链路（ADR-0039 §2.1/§2.2）· ${new Date().toISOString()}`,
    `EMAIL=${email}`,
    `PREVIEW=${preview}`,
    `LINK=${link}`,
    `VERIFY_KIND=${String(verified.kind)}`,
    `REUSE_STATUS=${String(again.status)}`,
    `DB=${psql.stdout.trim()}`,
    `BOGUS_STATUS=${String(bogus.status)}`,
    `RESULT=${failed ? 'FAIL' : 'PASS'}`,
    '',
  ].join('\n'),
);

console.log('');
server.kill();
if (failed) {
  console.error('❌ 邮箱全链路**未通过**（证据在 apps/web/evidence/email-chain/）');
  process.exit(1);
}
console.log('✅ 邮箱全链路通过：真发出一封信 → 点开确认页 → 一次点击换到会话 → 令牌一次性。');
process.exit(0);
