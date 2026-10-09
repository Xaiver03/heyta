#!/usr/bin/env node
/**
 * 换绑邮箱 + 会话撤销：**协议级**整链探针（真服务端编译产物 + 真 Postgres + 真发信）
 * ============================================================================
 *
 * 它是 `scripts/verify-mobile-account-email-sessions.sh` 的**服务端那一半**，
 * 不是它的替代品：这里证明的是"当前 dist 上这条旅程真走得通、两封信真发得出、
 * 撤销真的落到认证边界**与实时通道**"，**不证明**界面上画得出这些状态（那要设备窗口，AGENTS §6.2 规定一）。
 *
 * 为什么要有它：2026-10-09 设备窗口里 Android 模拟器在跑到第 1 步时被宿主机打死
 * （swap 已用 6.2 GB、1 分钟负载 158–540 之间起伏），而 `check:android-gradle-remote`
 * 的 H1 明确禁止为它新开本机模拟器入口（这台机器的内存告警就来自模拟器）。
 * 于是这一格分两半取：服务端半在这一趟闭合，界面半留给设备窗口。
 *
 * 前置（三条，缺一不可，脚本会当场验）：
 *   ① 当前源码编译的服务端起着并以 TEST_MODE 跑在那枚端口：
 *      pnpm --filter @heyta/sync-server build
 *      PORT=<空端口> PUBLIC_URL=http://127.0.0.1:<空端口> HEYTA_E2E_DB=<已迁移的验收库> \
 *        HEYTA_E2E_PIDFILE=/tmp/…pid HEYTA_E2E_LOGFILE=/tmp/…log bash scripts/mobile-e2e-up.sh
 *   ② 同一次 shell 里 export 同样的 `PORT` / `PUBLIC_URL` / `HEYTA_E2E_DB`；
 *   ③ 宿主机能把信发到 smtp.ethereal.email:587（没 SMTP 配置时 `email.ts` 走 Ethereal，
 *      判据靠日志里那行 `Preview URL:` 把信**读回来**，不是"发信返回 true"就算数）。
 *
 * 脱敏（AGENTS §8 第 10 条）：一次性令牌、访问令牌、Ethereal 预览地址**一律不打印**；
 * 只打 SHA-256 前 10 位。库读数只打形状位与邮箱（本轮新建的合成测试地址）。
 *
 * 用法：node research/tools/account-email-sessions-http-probe.mjs
 * 退出码：0=全部判据成立；1=有判据不成立；2=前置不成立（不拿它冒充"产品失败"）。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT ?? '';
const PUBLIC_BASE = process.env.PUBLIC_URL ?? '';
const LOG = process.env.HEYTA_E2E_LOGFILE ?? '';
const DB = process.env.HEYTA_E2E_DB ?? '';
if (PORT === '' || PUBLIC_BASE === '' || LOG === '' || DB === '') {
  console.log('❌ 前置变量不全（需要 PORT / PUBLIC_URL / HEYTA_E2E_LOGFILE / HEYTA_E2E_DB）');
  process.exit(2);
}
const BASE = `http://127.0.0.1:${PORT}`;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(6);
const OLD_EMAIL = `probe-mail-${stamp}@test.local`;
const NEW_EMAIL = `probe-mail-new-${stamp}@test.local`;
const PASS = 'ProbePass123';
/** 改密那一腿的新口令（策略要求与 `PASS` 不同，且要过 `checkNewPassword`）。 */
const PASS2 = 'ProbePass456';

let pass = 0;
let fail = 0;
const check = (ok, label, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra === '' ? '' : `  ${extra}`}`);
  if (ok) pass += 1;
  else fail += 1;
};
const fp = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 10);
const sql = (q) =>
  execFileSync('psql', ['-h', '127.0.0.1', '-p', '5432', '-U', process.env.USER, '-d', DB, '-tAc', q], {
    encoding: 'utf8',
  }).trim();
const logLinesFrom = (start) => readFileSync(LOG, 'utf8').split('\n').slice(start);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\n=== 账号面协议级整链（真服务端产物 + 真 Postgres + 真发信）===`);
console.log(`  服务端 ${BASE}   PUBLIC_URL ${PUBLIC_BASE}   库 ${DB}`);
console.log(`  账号 ${OLD_EMAIL} → ${NEW_EMAIL}\n`);

// ── 0. 前置：这台服务端上必须有本线的路由 ────────────────────────────────
{
  const a = await fetch(`${BASE}/api/account/email/change/status`);
  const b = await fetch(`${BASE}/api/auth/sessions`);
  if (a.status !== 401 || b.status !== 401) {
    console.log(`❌ 路由不在（status=${a.status} sessions=${b.status}，期望 401）—— 404 = 这台跑的不是当前源码`);
    process.exit(2);
  }
  check(true, '两条本线路由都在，未登录各回 401');
}

// ── 1. 建号 + 发起换绑（走产品那条路，不发邮件之外的捷径）─────────────────
const logStart = logLinesFrom(0).length;
const created = await (
  await fetch(`${BASE}/api/test/create-user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: OLD_EMAIL, password: PASS }),
  })
).json();
const oldToken = created.token ?? '';
check(oldToken !== '', `1. 测试账号已建（会话令牌指纹 ${fp(oldToken)}）`);

const req = await fetch(`${BASE}/api/account/email/change/request`, {
  method: 'POST',
  headers: { authorization: `Bearer ${oldToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ newEmail: NEW_EMAIL }),
});
const reqBody = await req.json();
check(req.status === 200, `2. 发起换绑 HTTP ${req.status}`, `message="${String(reqBody.message ?? '').slice(0, 20)}…"`);

// ── 3. 库里那张活请求的形状：两边都没点、存的是哈希、两侧不同 ──────────────
{
  const row = sql(
    `select old_confirmed_at is null, new_confirmed_at is null, length(old_token)>=40, old_token<>new_token, pending_email ` +
      `from email_change_requests r join users u on u.id=r.user_id where u.email='${OLD_EMAIL}'`,
  );
  check(row === `t|t|t|t|${NEW_EMAIL}`, '3. 活请求成立：两边都没点 / 令牌是哈希 / 旧新两侧不同 / 待绑是新地址', row);
}

// ── 4. 那两封信真的存在：从 Ethereal 预览各读回一条链接 ────────────────────
const previews = {};
let linkA = '';
let linkC = '';
for (let i = 0; i < 40 && (linkA === '' || linkC === ''); i += 1) {
  await sleep(1500);
  let label = '';
  for (const ln of logLinesFrom(logStart)) {
    const m = /Email change (?:authorize|confirm) email/.exec(ln);
    if (m) label = m[0];
    const p = /Preview URL: (\S+)/.exec(ln);
    if (p && label && previews[label] === undefined) previews[label] = p[1];
  }
  linkA = previews['Email change authorize email'] ?? '';
  linkC = previews['Email change confirm email'] ?? '';
}
check(linkA !== '' && linkC !== '', '4. 两封信都发出去了（旧邮箱那封 + 新邮箱那封都有 preview）');

/** 🔴 预览页把正文内嵌时做了两层转义（`\u002f` 与 `&amp;`），不归一化取不出链接。 */
const letterLink = async (preview) => {
  const raw = await (await fetch(preview)).text();
  const msg = raw.replaceAll('\\u002f', '/').replaceAll('\\/', '/').replaceAll('&amp;', '&');
  return /(https?:\/\/[^"'\s]*\/change-email\?token=([0-9a-f]{16,}))/.exec(msg);
};
const mA = await letterLink(linkA);
const mC = await letterLink(linkC);
if (mA === null || mC === null) {
  check(false, '5. 信里取不出 change-email 链接（转义没归一化？还是页面形状变了？）');
  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(1);
}
const tokenA = mA[2];
const tokenC = mC[2];
check(tokenA !== tokenC, `5. 两枚令牌不同（指纹 ${fp(tokenA)} / ${fp(tokenC)}）`);
check(mA[1].startsWith(PUBLIC_BASE) && mC[1].startsWith(PUBLIC_BASE), '6. 两条链接都指向本轮这个服务端', `前缀 ${PUBLIC_BASE}`);

// ── 7. GET 那条链接：是确认页，而且**不**烧令牌（邮件预取器的要害）────────
{
  const page = await fetch(mA[1]);
  const html = await page.text();
  check(page.ok && html.includes('data-token='), `7. GET 回的是确认页（HTTP ${page.status}，带 data-token）`);
  const still = sql(
    `select old_confirmed_at is null from email_change_requests r join users u on u.id=r.user_id where u.email='${OLD_EMAIL}'`,
  );
  check(still === 't', '8. 🔴 GET 之后旧侧仍未确认 —— 预取器烧不掉一次性令牌');
}

// ── 9. 只点旧那半：状态必须改成"等新邮箱那一边"，且**不发会话**、不生效 ────
{
  const c = await fetch(`${BASE}/api/account/email/change/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: tokenA }),
  });
  check(c.status === 200, `9. 旧侧确认 HTTP ${c.status}（**不带会话**也能点）`);
  const row = sql(
    `select old_confirmed_at is not null, new_confirmed_at is null, email from email_change_requests r join users u on u.id=r.user_id where u.email='${OLD_EMAIL}'`,
  );
  check(row === `t|t|${OLD_EMAIL}`, '10. 只点了一边 ⇒ 地址还没动（旧已点/新未点/库里仍是旧邮箱）', row);
  const st = await (
    await fetch(`${BASE}/api/account/email/change/status`, { headers: { authorization: `Bearer ${oldToken}` } })
  ).json();
  check(st.awaitingOld === false && st.awaitingNew === true, `11. status 回的是"等新邮箱那一边"（awaitingOld=${st.awaitingOld} awaitingNew=${st.awaitingNew}）`);
}

// ── 12. 点新那半：生效即删、邮箱改掉、tokenVersion++ 且旧令牌全局失效 ──────
const tokenVersionBefore = Number(
  sql(`select token_version from users where email='${OLD_EMAIL}'`),
);
{
  const c = await fetch(`${BASE}/api/account/email/change/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: tokenC }),
  });
  check(c.status === 200, `12. 新侧确认 HTTP ${c.status}`);
}
{
  const emailNow = sql(`select email from users where email in ('${OLD_EMAIL}','${NEW_EMAIL}')`);
  check(emailNow === NEW_EMAIL, '13. 库里登录邮箱已经是新地址');
  const left = sql(
    `select count(*) from email_change_requests r join users u on u.id=r.user_id where u.email in ('${OLD_EMAIL}','${NEW_EMAIL}')`,
  );
  check(left === '0', '14. 生效即删 —— 没有留下活请求');
  const tv = Number(sql(`select token_version from users where email='${NEW_EMAIL}'`));
  check(tv === tokenVersionBefore + 1, `15. tokenVersion ${tokenVersionBefore} → ${tv}（ADR-0063 §2.2：JWT 里带着邮箱）`);
  const old = await fetch(`${BASE}/api/notifications`, { headers: { authorization: `Bearer ${oldToken}` } });
  check(old.status === 401, `16. 换绑前那枚旧令牌 401（不是只从界面上藏起来）`);
}

// ── 17. 会话面：列两枚 → 逐枚撤掉另一枚 → 那一枚当场 401、手上这枚仍 200 ───
const bearer = (t) => ({ authorization: `Bearer ${t}` });
/**
 * 线协议上的 `sessionId` = **jti 的 SHA-256**（`session-contract.ts` 与 ADR-0063 §2.5）。
 * 从 JWT 里把 jti 解出来再自己算一次哈希 —— 这比"列表里有一枚标了 current"强：
 * 它把"服务端认出的那一枚"和"我手上这一枚"钉成同一个身份，而不是两个各说各的计数。
 */
const wireSessionId = (jwt) => {
  const part = String(jwt).split('.')[1] ?? '';
  const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  return payload.jti === undefined ? '' : createHash('sha256').update(String(payload.jti)).digest('hex');
};
const login = async (ua) => {
  const r = await (
    await fetch(`${BASE}/api/login/email-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': ua },
      body: JSON.stringify({ email: NEW_EMAIL, password: PASS }),
    })
  ).json();
  return r.token ?? '';
};
const tokenB = await login('probe-device-b');
const tokenSecond = await login('probe-device-c');
check(tokenB !== '' && tokenSecond !== '', '17. 另两枚会话已签出（带可辨识的 user-agent）');
{
  const list = await (await fetch(`${BASE}/api/auth/sessions`, { headers: bearer(tokenB) })).json();
  const rows = list.sessions ?? [];
  const cur = rows.filter((r) => r.current);
  check(cur.length === 1, `18. 列表里恰好一枚标 current（实测 ${cur.length} 枚，共 ${rows.length} 行）`);
  check(rows.every((r) => /^[0-9a-f]{64}$/.test(r.sessionId ?? '')), '19. 线协议上的 sessionId 是 64 位十六进制（不是裸 jti）');
  // 🔴 换绑那次 bump 之后，**只有 bump 之后签的两枚**还有效（列表按 tokenVersion 过滤），
  //    所以行数应当正好是 2 —— 旧令牌那一行不许继续挂在列表上骗人。
  check(rows.length === 2, `20. 只列出"版本号还等于账号上那个"的行：实测 ${rows.length} 行（换绑前那枚不该在）`);
  const mine = wireSessionId(tokenB);
  const theirs = wireSessionId(tokenSecond);
  check(cur[0]?.sessionId === mine, '21. 🔴 被标 current 的那一枚 = 我手上这枚 jti 的 SHA-256（服务端自己比出来的，不信客户端报的标记）');
  const other = rows.find((r) => r.sessionId === theirs);
  check(other !== undefined && other.current === false, '22. 另一枚在列表里且可撤');
  if (other !== undefined) {
    const del = await fetch(`${BASE}/api/auth/sessions/${encodeURIComponent(other.sessionId)}`, {
      method: 'DELETE',
      headers: bearer(tokenB),
    });
    check(del.status === 200, `23. 逐枚撤销 HTTP ${del.status}`);
    const after = await (await fetch(`${BASE}/api/auth/sessions`, { headers: bearer(tokenB) })).json();
    const stillThere = (after.sessions ?? []).some((r) => r.sessionId === other.sessionId);
    check(stillThere === false, `24. 列表里那一行没了（撤销=删行，"存在即有效"；剩下 ${(after.sessions ?? []).length} 行）`);
    const revoked = await fetch(`${BASE}/api/notifications`, { headers: bearer(tokenSecond) });
    check(revoked.status === 401, `25. 被撤那枚真 401（实测 ${revoked.status}）`);
    const meKept = await fetch(`${BASE}/api/notifications`, { headers: bearer(tokenB) });
    check(meKept.status === 200, `26. 手上这枚仍 200（撤的是另一台）`);
    const rowGone = sql(
      `select count(*) from access_sessions where jti_hash='${other.sessionId}'`,
    );
    check(rowGone === '0', '27. 库里那一行是**删掉**的，不是打了个 revoked 标记');
  }
}

// ── 28. 退出所有设备：包括手上这一枚 ──────────────────────────────────────
{
  const out = await fetch(`${BASE}/api/auth/sessions/revoke-all`, { method: 'POST', headers: bearer(tokenB) });
  check(out.status === 200, `28. 退出所有设备 HTTP ${out.status}`);
  const left = Number(sql(`select count(*) from access_sessions s join users u on u.id=s.user_id where u.email='${NEW_EMAIL}'`));
  check(left === 0, `29. 库里 0 枚会话（实测 ${left}）`);
  const me = await fetch(`${BASE}/api/notifications`, { headers: bearer(tokenB) });
  check(me.status === 401, `30. 发起那枚也 401（"包括这台"不是话术）`);
}

// ── 31..38. 实时通道那一半（运行时，不是代码形状）──────────────────────────
// `websocket-connection.service.ts` 的 `closeForUser` 上写着：通道只在 upgrade 时鉴权，
// 之后靠心跳维持 ⇒ 只 bump `tokenVersion` 时，旧设备**已经开着的那个页面**会无限期继续收 op。
// 上面 17..30 数的是 HTTP 与库面，那一层对一个"只写计数器"的实现照样全绿 —— 这一节才有牙。
{
  // `ws` 只装在 `server/` 那个工作区里，本文件不在其中 ⇒ 从 server 的 package.json 定位解析根。
  const serverPkg = resolve(dirname(fileURLToPath(import.meta.url)), '../../server/package.json');
  const { WebSocket } = createRequire(serverPkg)('ws');
  // 路由挂在 `/api/sync` 前缀下（`server.ts` 的 `register(wsRoutes, { prefix: '/api/sync' })`）。
  const WS_BASE = `ws://127.0.0.1:${PORT}/api/sync/ws`;
  const openSocket = (token, tag) =>
    new Promise((res, rej) => {
      const s = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}&clientId=probe-${tag}`);
      s.on('open', () => res(s));
      s.on('error', rej);
      setTimeout(() => rej(new Error(`open-timeout:${tag}`)), 4000);
    });
  /** 让 socket 自己报关闭码；`waitMs` 内没关就回 `null`。 */
  const watchClose = (s) => {
    const box = { code: null };
    s.on('close', (code) => {
      if (box.code === null) box.code = code;
    });
    return box;
  };

  const tokenD = await login('probe-device-d');
  const tokenE = await login('probe-device-e');
  check(tokenD !== '' && tokenE !== '', '31. 又签出两枚会话（d/e 各一枚，UA 可辨认）');
  const rowsBefore = Number(
    sql(
      `select count(*) from access_sessions s join users u on u.id=s.user_id where u.email='${NEW_EMAIL}'`,
    ),
  );
  check(rowsBefore >= 2, `32. 改密前库里有 ${String(rowsBefore)} 枚活会话`);

  // 🔴 通道开不起来时**退 2 报探针**，不记产品失败，也不许"跳过这一节然后报全绿"：
  // 后面的每一条都建立在"这台设备的页面此刻真的连着"之上（AGENTS §7 元规则 1）。
  const openOrDiagnose = async (token, tag) => {
    try {
      return await openSocket(token, tag);
    } catch (err) {
      console.log(
        `\n❌ 探针前置不成立：开不了实时通道（${err instanceof Error ? err.message : 'unknown'}）—— ` +
          '这一节数不了"关没关"，不记产品失败。',
      );
      process.exit(2);
    }
  };

  const sockE = await openOrDiagnose(tokenE, 'e');
  const sockEBox = watchClose(sockE);

  const changed = await fetch(`${BASE}/api/password/change`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...bearer(tokenD) },
    body: JSON.stringify({ currentPassword: PASS, newPassword: PASS2 }),
  });
  const changedBody = await changed.json();
  const tokenD2 = changedBody.token ?? '';
  check(changed.status === 200 && tokenD2 !== '', `33. 改密 HTTP ${changed.status} 并换发了一枚新令牌`);

  await sleep(2500);
  check(
    sockEBox.code === 4003,
    `34. 🔴 另一台那个**已经开着**的通道被当场关掉（实测 close=${String(sockEBox.code)}，4003=Token revoked）`,
  );
  const rowsAfter = Number(
    sql(
      `select count(*) from access_sessions s join users u on u.id=s.user_id where u.email='${NEW_EMAIL}'`,
    ),
  );
  check(rowsAfter === 1, `35. 库里只剩新铸那一枚（实测 ${String(rowsAfter)}）—— 已知死掉的行不留满 365 天`);

  // 🔴 负向对照：失败那一次**不许**替别人断线。把撤销动作写在口令校验之前会在这里红，
  // 而它的症状是"别人输错一次口令，就把我这一台踢下线" —— 那是一台设备能对全账号做的拒绝服务。
  const sockD = await openOrDiagnose(tokenD2, 'd');
  const sockDBox = watchClose(sockD);
  const rowsBeforeBad = Number(
    sql(
      `select count(*) from access_sessions s join users u on u.id=s.user_id where u.email='${NEW_EMAIL}'`,
    ),
  );
  const badChange = await fetch(`${BASE}/api/password/change`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...bearer(tokenD2) },
    body: JSON.stringify({ currentPassword: 'not-the-password', newPassword: PASS2 }),
  });
  await sleep(1500);
  // ⚠️ 这里判"不是 200"而不是"必须 401"：拒绝的形式可以是口令错、也可以是这一路的限流
  // （`/password/change` 有 rateLimit，同 IP 连跑几趟会撞上限）。会被拒是判据，
  // 被哪一种拒不是 —— 承重的那两条是下面"没关通道、没删行"。
  check(badChange.status !== 200, `36. 口令错那次**不是** 200（实测 ${badChange.status}）`);
  check(sockDBox.code === null, `37. 🔴 失败那一次谁都没被踢下线（手上这台仍开着，close=${String(sockDBox.code)}）`);
  const rowsAfterBad = Number(
    sql(
      `select count(*) from access_sessions s join users u on u.id=s.user_id where u.email='${NEW_EMAIL}'`,
    ),
  );
  // 判"没删"要拿**这一次之前**的数比，不能拿绝对值 —— 上面那次成功的改密留下几行是另一条判据（35）。
  check(
    rowsAfterBad === rowsBeforeBad,
    `38. 失败那一次一行都没删（${String(rowsBeforeBad)} → ${String(rowsAfterBad)}）`,
  );
  sockE.close();
  sockD.close();
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
console.log('⚠️ 这一趟证明的是**当前 dist 上这条协议旅程**走得通；界面上画得出这些状态要设备窗口（AGENTS §6.2 规定一）。');
process.exit(fail === 0 ? 0 : 1);
