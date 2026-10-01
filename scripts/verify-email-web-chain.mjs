#!/usr/bin/env node
/**
 * 门禁：**web 的邮箱全链路**（ADR-0039 §2.2）—— 真浏览器 + 真邮件
 * =================================================================
 *
 * 它补的是**最大的那个判据缺口**：`verify:email-auth` 只验到服务端，
 * 而"确认页 → 应用"这一腿**从来没有测试盯着** —— 于是它坏了很久没人发现
 * （确认页存的是**会话 JWT**，而应用把它当**一次性链接令牌**去换 ⇒ 必然 401，
 *  失败又被 `consumePendingLogin` 吞掉 ⇒ "点了邮件里的链接，回来还是未登录"）。
 *
 * 这条门禁走**生产同源拓扑**（本地复刻）：
 *
 * ```
 *   浏览器 ──► 127.0.0.1:4400（本脚本起的反代）
 *                 ├── /api/*、/verify-email、/magic-login…  ──► API 服务端 :3231
 *                 └── 其余                                    ──► apps/web/dist（真产物）
 * ```
 *
 * 于是"确认页跳到 `/app/`"这条真实路径能被验到（服务端**不**服务 `/app/`，
 * 生产上那一格是反代给的；本地必须复刻，否则跳过去是 404 而不是应用）。
 *
 * ## 它断言什么
 *
 * 1. UI 注册 → 服务端**真发一封**（本地无 `SMTP_*` ⇒ Ethereal 兜底）；
 * 2. 脚本把 **preview URL 抓回来**、从渲染后的邮件正文里取出 `/verify-email?token=…`
 *    （**整条查询串**），并核对链接里的 `lang=` 等于提交那一刻的**界面语言**；
 * 3. 打开那个链接 ⇒ 是**确认页**（不是"已失效"）；
 * 4. 点确认 ⇒ 跳到 `/app/` ⇒ **应用真的登录了**（身份菜单出现"退出登录"、有邮箱）；
 * 5. 截图留证（人看）。
 *
 * ## 明确**不**验
 *
 * - 不验真实 SMTP（本机走 Ethereal）、不验桌面壳（那是 `heyta://` 回调那条，单独验）、
 * - 不验手机号（预留）。
 */

import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect } from '@playwright/test';

import {
  databaseUrlFor,
  ensureDatabase,
  ensureServerBuilt,
  resolveNode,
} from './lib/auth-journey-server.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API_PORT = '3231';
const WEB_PORT = '4400';
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const DB_NAME = 'heyta_email_web_chain';
const DIST = join(ROOT, 'apps/web/dist');
const EVIDENCE = join(ROOT, 'apps/web/evidence/email-chain');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
/**
 * 🔴 **两类判据，必须分开点名**（2026-09-30 加）。
 *
 * `outcome`：**用户能不能用** —— 点了邮件里的链接，应用是不是真的登录了。
 * `structure`：**这份实现靠什么成立** —— 会话是不是走的那条不依赖响应头配置的通道。
 *
 * 为什么要分：`HEYTA_WEB_CHAIN_LEGACY_STORAGE=1 HEYTA_WEB_CHAIN_STRIP_COOP=1`
 * 那一轮里**用户结果是好的**（会话经 sessionStorage 到了），但"不依赖头配置"这条
 * 已经不成立 ⇒ 整轮红。那时若总结只说一句"全链路未通过"，读的人会以为产品坏了 ——
 * 而真正坏的是**保证**。把两类分开点名，红才有信息量。
 */
const failures = { outcome: [], structure: [] };

function check(ok, what, kind = 'outcome') {
  console.log(`  ${ok ? '✅' : '❌'} ${what}`);
  if (!ok) {
    failed = true;
    failures[kind].push(what);
  }
}
function bail(why, extra = '') {
  console.error(`\n❌ ${why}`);
  if (extra) console.error(extra.split('\n').slice(-15).join('\n'));
  process.exit(1);
}

if (!existsSync(join(DIST, 'index.html'))) {
  bail('apps/web/dist 不存在 —— 先 `pnpm --filter @heyta/web build`（本门禁刻意用**真产物**）');
}

const node = resolveNode();
const dbUrl = databaseUrlFor(DB_NAME);
console.log(`· 库：${DB_NAME}`);
ensureDatabase({ root: ROOT, dbUrl, dbName: DB_NAME });
await ensureServerBuilt({ root: ROOT, dbUrl });

// ── API 服务端（**不开 TEST_MODE**：要走真的发信那条路）──────────────────
console.log('· 启动 API 服务端（无 TEST_MODE）…');
const api = spawn(node, ['dist/src/index.js'], {
  cwd: join(ROOT, 'server'),
  env: {
    ...process.env,
    DATABASE_URL: dbUrl,
    NODE_ENV: 'test',
    PORT: API_PORT,
    HOST: '127.0.0.1',
    // 🔴 邮件里的链接必须指向**反代那个 origin**（页面在那儿），否则点开是 404。
    PUBLIC_URL: WEB,
    CORS_ORIGINS: WEB,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let apiLog = '';
api.stdout.on('data', (d) => (apiLog += d.toString()));
api.stderr.on('data', (d) => (apiLog += d.toString()));

// ── 反代：页面/接口 → API，其余 → dist（复刻生产同源拓扑）──────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};
const toApi = (path) =>
  path.startsWith('/api/') ||
  path === '/health' ||
  path.startsWith('/verify-email') ||
  path.startsWith('/magic-login') ||
  path.startsWith('/recover-passkey') ||
  path === '/magic-login-confirm.js';

/**
 * 🔴 **注入开关：把控制"文档所属 agent cluster"的两个头从 API 响应里摘掉。**
 *
 * 判据红在这一格，那就必须能**因注入转绿** —— 否则我证不出"红是因为它"。
 * `Cross-Origin-Opener-Policy: same-origin` + `Origin-Agent-Cluster: ?1` 都来自
 * `@fastify/helmet` 的默认值，只在 API 渲染的页面上出现；应用（dist）那边没有。
 */
const STRIP_COOP = process.env.HEYTA_WEB_CHAIN_STRIP_COOP === '1';

/**
 * 🔴 **第二个注入：把确认页的 fragment 投递摘掉**（`location.replace('/app/#…')` → `'/app/'`）。
 *
 * 它证明的是"那两格判据**是活的**"：判据绿了之后，必须还能因**撤销修复**而转红 ——
 * 否则我证不出它守的是这个修复，只能证明它今天恰好是绿的。
 *
 * 这一次改的是**服务端真正发出去的那份脚本**（在反代里改响应体），
 * 所以走的还是"确认页 → 应用"那条真实路径，不是判据里的假设。
 */
const DROP_FRAGMENT = process.env.HEYTA_WEB_CHAIN_DROP_FRAGMENT === '1';

/**
 * 🔴 **第三个注入：把服务端脚本还原成修复前的 `sessionStorage` 投递。**
 *
 * 它让"根因"变成一份**可复现的证据**，而不是一段转述：
 *
 * ```
 *                                       带 COOP/OAC      摘掉 COOP/OAC
 *   sessionStorage 投递（修复前）         RED  ← 原来的 bug     GREEN
 *   fragment 投递（修复后）               GREEN              GREEN
 * ```
 *
 * 左上那格红、右上那格绿 ⇒ **"丢"是那两个头造成的**（因果），
 * 左下那格绿 ⇒ **修法本身成立**，右下那格绿 ⇒ 修法不依赖那两个头的存在。
 *
 * 不做这一格的话，半年后有人"顺手把它简化回 sessionStorage"，
 * 只会看到端到端红了，却再也看不到**为什么** —— 而那个原因非常反直觉。
 */
const LEGACY_STORAGE = process.env.HEYTA_WEB_CHAIN_LEGACY_STORAGE === '1';

/**
 * 反代里对**真正发出去的那份确认页脚本**做的改写。
 *
 * 🔴 在反代改而不是改仓库里的文件：注入必须能"撤销修复"却**不许污染工作区** ——
 * 否则跑完注入就留下一个改坏了的源文件，而那种残留极难被发现。
 */
function rewriteConfirmScript(src) {
  let out = src;
  const apply = (needle, replacement, label) => {
    if (!out.includes(needle)) {
      /**
       * 🔴 **静默失配是这里最危险的失败模式**：改写没匹配上 ⇒ 注入其实没生效
       * ⇒ 这一轮仍然全绿 ⇒ 而我却会把它当成"注入证明了判据是活的"。
       * 那是一条**假证据**。所以失配必须当场炸，不能往下跑。
       */
      throw new Error(`注入 ${label} 没匹配上 —— 服务端脚本变了，注入需要同步更新`);
    }
    out = out.replace(needle, replacement);
  };

  if (DROP_FRAGMENT) {
    apply("'/app/#' + params.toString()", "'/app/'", 'DROP_FRAGMENT');
  }
  if (LEGACY_STORAGE) {
    apply(
      "window.location.replace('/app/#' + params.toString());",
      [
        "sessionStorage.setItem('sessionToken', params.get('sessionToken'));",
        "sessionStorage.setItem('loginEmail', params.get('loginEmail'));",
        "sessionStorage.setItem('loginBaseUrl', params.get('loginBaseUrl'));",
        "window.location.href = '/app/';",
      ].join('\n          '),
      'LEGACY_STORAGE',
    );
  }
  return out;
}

const web = createServer((req, res) => {
  const url = new URL(req.url ?? '/', WEB);
  if (toApi(url.pathname)) {
    const proxied = httpRequest(
      { host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers },
      (upstream) => {
        const headers = { ...upstream.headers };
        if (STRIP_COOP) {
          delete headers['cross-origin-opener-policy'];
          delete headers['origin-agent-cluster'];
        }
        if ((DROP_FRAGMENT || LEGACY_STORAGE) && url.pathname === '/magic-login-confirm.js') {
          const chunks = [];
          upstream.on('data', (c) => chunks.push(c));
          upstream.on('end', () => {
            const patched = rewriteConfirmScript(Buffer.concat(chunks).toString('utf8'));
            headers['content-length'] = String(Buffer.byteLength(patched));
            res.writeHead(upstream.statusCode ?? 502, headers);
            res.end(patched);
          });
          return;
        }
        res.writeHead(upstream.statusCode ?? 502, headers);
        upstream.pipe(res);
      },
    );
    proxied.on('error', () => {
      res.writeHead(502).end('proxy error');
    });
    req.pipe(proxied);
    return;
  }
  // `/app/...` 与 `/` 都由 dist 提供（生产上反代就是这么配的）。
  const rel = url.pathname.startsWith('/app/')
    ? url.pathname.slice('/app'.length)
    : url.pathname;
  const file = join(DIST, rel === '/' ? 'index.html' : rel);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

await new Promise((r) => web.listen(Number(WEB_PORT), '127.0.0.1', r));
console.log(`· 同源反代就绪 ${WEB}（API 在 ${API}）`);

let up = false;
for (let i = 0; i < 60 && !up; i += 1) {
  await sleep(500);
  try {
    up = (await fetch(`${API}/health`)).ok;
  } catch {
    /* 还没起来 */
  }
}
if (!up) bail('API 服务端没起来', apiLog);
console.log('· API 就绪\n');

const stop = () => {
  api.kill();
  web.close();
};
process.on('exit', stop);

// ── 浏览器：真 UI 注册 ─────────────────────────────────────────────────
const browser = await chromium.launch();
const page = await browser.newPage();
/**
 * 🔴 **把浏览器的控制台与页面错误接住**。
 * 没有它，应用里"登录没成"就只剩下一个 `signed-out` —— 而原因全在控制台里。
 */
const consoleLines = [];
/**
 * 🔴 **在应用之前装好错误收集**：`main.tsx` 是 `void consumePendingLogin()`，
 * 所以它内部一旦抛，就变成**未处理的拒绝** —— 而那个默认是**看不见**的。
 * 这一格不装，症状就只剩"没登上"。
 */
await page.addInitScript(() => {
  /**
   * 🔴 **记录"每个文档启动那一刻"的存储快照**。
   *
   * `addInitScript` 在**每个文档的最开始**执行 —— 于是应用自己还没跑的时候，
   * 我们就能看见它**将会看到什么**。这正是"确认页写了没写"与"应用读到没有"
   * 之间那一跳的仪器：没有它，两边都只能靠猜。
   */
  try {
    window.__boot = {
      href: location.href,
      sessionKeys: Object.keys(sessionStorage),
      sessionToken: sessionStorage.getItem('sessionToken') === null ? null : 'present',
      loginBaseUrl: sessionStorage.getItem('loginBaseUrl'),
    };
  } catch (e) {
    window.__boot = { href: location.href, threw: String(e) };
  }
  /**
   * 🔴 **每次 `sessionStorage.setItem` 的时间线**，落在 `localStorage` 里。
   *
   * 为什么非要这一格：`sessionStorage` **随文档走**，脚本切到 `/app/` 之后
   * 就再也看不见确认页那个文档里的值了。而"写了没有"正是要判的那一跳 ——
   * 启动快照只能说明"应用没看见"，说明不了"没人写"。
   *
   * `localStorage` **跨文档存活**且同源共享，所以把写入追加进去，
   * 就得到一条跨越两次导航、**无法被事后篡改**的时间线：
   * 谁写的、写了哪个键、值多长、什么时候。
   */
  try {
    const proto = Object.getPrototypeOf(window.sessionStorage);
    const origSet = proto.setItem;
    const origRemove = proto.removeItem;
    const origClear = proto.clear;
    const log = (kind, key, val) => {
      try {
        const all = JSON.parse(window.localStorage.getItem('__ssw') || '[]');
        all.push({ at: location.href, kind, key: String(key), len: String(val).length });
        window.localStorage.setItem('__ssw', JSON.stringify(all));
      } catch (e) {
        /* 记录失败不能影响被测代码 */
      }
    };
    proto.setItem = function (k, v) {
      if (this === window.sessionStorage) log('set', k, v);
      return origSet.call(this, k, v);
    };
    proto.removeItem = function (k) {
      if (this === window.sessionStorage) log('remove', k, '');
      return origRemove.call(this, k);
    };
    proto.clear = function () {
      if (this === window.sessionStorage) log('clear', '', '');
      return origClear.call(this);
    };
  } catch (e) {
    /* 装不上仪器就静默跳过：判据不能因为观测失败而变红 */
  }
  /**
   * 🔴 **确认页"最后一刻"的快照**（`pagehide`），写进 `localStorage`。
   *
   * 时间线证明了"写了"，启动快照证明了"应用没看见"。中间只剩**导航本身**。
   * `pagehide` 是旧文档**还活着**的最后一个时点 —— 它的快照把
   * "写没写进去"和"跳过去还在不在"彻底劈成两半。
   */
  window.addEventListener('pagehide', () => {
    try {
      const list = JSON.parse(window.localStorage.getItem('__prehides') || '[]');
      list.push({
        href: location.href,
        sessionKeys: Object.keys(window.sessionStorage),
        sessionToken:
          window.sessionStorage.getItem('sessionToken') === null ? null : 'present',
      });
      window.localStorage.setItem('__prehides', JSON.stringify(list));
    } catch (e) {
      /* 记录失败不能影响被测代码 */
    }
  });
  window.__errs = [];
  window.addEventListener('unhandledrejection', (e) => {
    window.__errs.push('rejection: ' + String(e && e.reason && (e.reason.stack || e.reason)));
  });
  window.addEventListener('error', (e) => {
    window.__errs.push('error: ' + String((e && (e.message || e.error)) || e));
  });
});
/**
 * 🔴 **每次文档导航的响应头** —— 两个"存储命名空间"的唯一可见差别只可能在头里。
 * 尤其盯：CSP `sandbox`、`Cross-Origin-Opener-Policy`、`Clear-Site-Data`、
 * `Content-Type`（非 `text/html` 会让文档变成下载/插件文档）。
 */
page.on('response', (r) => {
  if (r.request().resourceType() !== 'document') return;
  const h = r.headers();
  const keep = {};
  for (const [k, v] of Object.entries(h)) {
    if (/^(content-type|content-security-policy|cross-origin|clear-site-data|set-cookie|x-frame|origin-agent)/i.test(k)) {
      keep[k] = v;
    }
  }
  console.log(`  · 文档头 ${r.status()} ${r.url().slice(-34)} ${JSON.stringify(keep)}`);
});
page.on('console', (m) => {
  const line = `[${m.type()}] ${m.text()}`;
  consoleLines.push(line);
  // 实时打出来：失败之后再 dump 会漏掉先出现又被清掉的那类信号。
  if (m.type() === 'error' || m.type() === 'warning') console.log(`  · ${line.slice(0, 160)}`);
});
page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));
/** 记下关键接口的响应体 —— "确认页那一跳到底拿到了什么"必须看得见。 */
const apiResponses = [];
page.on('response', (res) => {
  if (res.url().includes('/api/auth/email/verify')) {
    // 🔴 **同步记状态码**：确认页成功后会立刻 `location.href` 跳走，而那次导航会让
    //    "读响应体"失败 —— 第一版写成 `.text()` + catch，于是证据里只剩"(没抓到)"，
    //    看起来像"根本没发请求"。**状态码不会丢。**
    apiResponses.push(String(res.status()));
  }
});
const email = `email-web-${String(Date.now())}@example.com`;
/**
 * 注册用的登录口令。**只存在于本进程**，且必须是 8 个码点以上 ——
 * 服务端策略（`packages/shared-schema` 的口令策略）会在界面把不足的那几条
 * 逐条说出来，那种红会被误读成"链路坏了"。
 * ⚠️ 它**不是**端到端加密口令（那是另一个秘密，登录后才问，且从不落盘）。
 */
const PASSWORD = 'email-web-chain-pass';

/**
 * 首屏锚点用 **testid 而不是 placeholder 文案**。
 *
 * 理由不是偏好，是实测：这台机器上 Playwright 起的是 `en-US` 浏览器，而应用现在
 * **认浏览器语言**（`docs/plans/i18n-*`）⇒ 界面渲染成英文，旧的
 * `input[placeholder^="添加任务"]` 直接超时，而应用其实**是好的**（真产物手验过：
 * `#root` 18277 字符、`data-testid="capture-input"` 在）。用文案当锚点等于把
 * "界面文案改了/语言换了"读成"应用没打开" —— 这正是 §7 第 46 条那类假红。
 */
const appOpen = () => page.getByTestId('capture-input').waitFor({ timeout: 60_000 });

try {
  await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
  await appOpen();
  check(true, '① 应用在**同源反代**下打开（真产物）');

  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('sync-signin-entry').click();
  const dialog = page.locator('[role="dialog"]');

  /**
   * 🔴 **一个地址都不填** —— 这条是这段脚本最重要的改动，也是判据而不是省事。
   *
   * 旧版在这里 `fill(WEB)`：注册的前置条件是"先把你连哪台服务端敲出来"。
   * 那面墙拆掉之后（`AuthPanel.tsx` 文件头 + `auth-endpoint.ts`），未配置时地址
   * **预填成应用自己的来源**，而且它现在是表格里**最后一栏**（曾经过「高级」`<details>`
   * 里折叠着，2026-10-01 的两步式重构成了一屏一件事）。可见了就可以直接读 `inputValue()`，
   * 不再需要绕到 DOM 里摸 `value`。
   *
   * 读它而不是跳过它：**"不用填"和"默认值是对的"是两件事**。只看注册成功，
   * 可能成功地把请求发去了别处（比如构建期烙进去的旧域名）。
   */
  const serverField = dialog.getByTestId('auth-form-server-url');
  await expect(serverField, '未配置服务端时地址栏必须在（它是最后一栏，且预填好）').toBeVisible();
  const prefilled = await serverField.inputValue();
  check(
    prefilled === WEB,
    `① 地址栏**预填成同源地址**而没人碰过它（实测 value="${prefilled}"）`,
    'structure',
  );

  /**
   * ── 注册现在要走两步 + 一档 ──────────────────────────────────────────
   *
   * 第一屏**只要邮箱**（这就是"地址不是前置条件"那条硬约束的形状）；
   * 点「继续」进第二屏，那里默认是**登录档**，而同意项、邀请码、
   * 以及"注册"这个动作都在**注册档**。所以是四步，不是一步。
   * ⚠️ 这四步每一步都是真实用户步骤 —— 少任何一步的报错长得像服务端坏了：
   *   · 没点继续 ⇒ 找不到那个按钮（它还没进 DOM）；
   *   · 没切注册档 ⇒ 没有同意项，服务端因缺 `termsAccepted` 回 400；
   *   · 没填口令 ⇒ 表单**在本地**就拦住提交（`firstAuthErrorField`），
   *     一个请求都不发 —— 那种红最容易被读成"邮件没发出去"。
   */
  await dialog.getByTestId('auth-form-email').fill(email);
  await dialog.getByTestId('auth-form-continue').click();
  const registerToggle = dialog.getByTestId('auth-form-switch-mode');
  const terms = dialog.getByTestId('auth-form-terms');
  await expect(registerToggle, '第二屏必须有"切到注册"那一步').toBeVisible();
  await registerToggle.click();
  await expect(terms, '注册档才渲染同意项').toBeVisible();
  await dialog.getByTestId('auth-form-password').fill(PASSWORD);
  await terms.click();
  // 同意项是 `div[role=checkbox][aria-checked]`（共享表单没有原生 input），
  // 所以断言 aria-checked 而不是"点过了"—— 点到了但状态没变是最典型的空真。
  await expect(terms).toHaveAttribute('aria-checked', 'true');
  /**
   * 提交**之前**取界面语言。`document.documentElement.lang` 是应用自己写的
   * （`apps/web/src/lib/locale.ts:92`），所以它就是"用户此刻看着哪种语言"的
   * 唯一事实源 —— 不用去猜 `navigator.language`，也不拿文案当锚点。
   */
  const uiLang = await page.evaluate(() => document.documentElement.lang);
  await dialog.getByRole('button', { name: /注册新账号|Create account/ }).click();
  check(true, `① UI 注册已提交（${email}，界面语言 ${uiLang}）`);


  // ── 把那封信读回来 ──────────────────────────────────────────────────
  let preview = '';
  for (let i = 0; i < 40 && preview === ''; i += 1) {
    await sleep(500);
    preview = /Preview URL: (\S+)/.exec(apiLog)?.[1] ?? '';
  }
  if (preview === '') bail('没拿到 Ethereal preview URL（没网？还是发信失败？）', apiLog);
  console.log(`  · 那封信：${preview}`);
  const raw = await (await fetch(preview)).text();
  // Ethereal 预览页是外壳页：斜杠 `\u002f`、`&amp;` 都要归一化，否则取不出链接。
  const html = raw.replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  /**
   * 🔴 取**整条查询串**，不只是 token。
   *
   * 旧正则停在 `[0-9a-f]+`，于是 `&lang=en` 被丢掉 —— 后果不是"少打印一段"，
   * 而是**这一腿从来没验过语言**：浏览器（Playwright 无头 Chromium 实测**不发**
   * `Accept-Language`）拿不到语言线索，服务端落到 `zh-CN` 兜底，
   * 于是截图里那张页面对着一个都没选过中文的英文界面**是中文的**。
   * 症状长得像"产品本地化坏了"，实际是探针把链接截断了（§7 元规则 1）。
   *
   * ⚠️ 字符类里那个 `\\` 不是装饰：预览页把链接放在转义过的 `href=\"…\"` 里，
   * 只排 `"'` 和空白会把结尾那个反斜杠**当成链接的一部分**抓回来
   * （实测 `lang=en\` ⇒ 新加的那条判据当场红）。判据是对的，抓的是探针。
   */
  const link = /(https?:\/\/[^"'\s\\]*\/verify-email\?token=[0-9a-f]+(?:&[^\s"'\\]*)?)/.exec(html)?.[1] ?? '';
  if (link === '') bail('信里取不出 /verify-email 链接', html.slice(0, 400));
  check(link.startsWith(WEB), `② 链接指向**反代那个 origin**（${link.slice(0, 46)}…）`);
  /**
   * 语言**随链接走**（`server/src/email.ts` 的 `withLocale`）：收件人点开的语言
   * 应当等于**发信那一刻他界面用的语言**，而不是"他恰好用什么浏览器"。
   * 这条串起了三层：客户端 `body.locale` → 服务端解析 → 写进链接。
   */
  const linkLang = new URL(link).searchParams.get('lang') ?? '';
  check(
    linkLang === uiLang,
    `② 链接带 \`lang=${linkLang || '(没有)'}\`，与提交时的界面语言（${uiLang}）一致`,
    'structure',
  );

  // ── 打开链接 → 确认页 → 点击 ────────────────────────────────────────
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  const confirmVisible = await page.locator('#login-btn').isVisible().catch(() => false);
  check(confirmVisible, '③ 打开链接渲染的是**确认页**（有确认按钮），不是"已失效"页');
  await page.screenshot({ path: '/tmp/email-web-1-confirm.png' });

  await page.locator('#login-btn').click();
  // 确认页成功后会跳 `/app/` —— 等应用挂载。
  await appOpen();
  check(true, '④ 点击后跳到了 `/app/` 且应用挂载');

  // 落到 /app/ 之后先把**存储与凭据**看一眼：这一格坏了要知道坏在哪。
  const afterLanding = await page.evaluate(() => ({
    sessionKeys: Object.keys(sessionStorage),
    localKeys: Object.keys(localStorage),
    errs: (window.__errs ?? []).slice(0, 3),
  }));
  console.log(`  · 落到 /app/ 之后的存储：${JSON.stringify(afterLanding)}`);
  // 应用**启动那一刻**看到什么 —— 这一格才是那一跳的判据。
  const boot = await page.evaluate(() => window.__boot ?? null);
  console.log(`  · 应用启动那一刻：${JSON.stringify(boot)}`);

  /**
   * ── 判据：会话是**经 fragment 投递**的，而且**已经被抹掉** ────────────
   *
   * 🔴 两格必须成对，缺一格都会变成一个**平凡为真**的判据：
   *   · 只判"抹掉了" —— 如果投递根本没来（比如退回 sessionStorage），
   *     地址栏从来就没有 fragment，这一格照样绿。
   *   · 只判"来了" —— 那正是历史那一版：令牌留在地址栏与历史里。
   *
   * 而它守的是一个**实测过的**机制：确认页由同步服务端渲染（带 helmet 默认的
   * `Cross-Origin-Opener-Policy: same-origin` + `Origin-Agent-Cluster: ?1`），
   * 应用是静态产物（两个头都没有）⇒ 跳过去会切 browsing instance，
   * 那边写进 `sessionStorage` 的会话**不会跟过来**（确认页 `pagehide` 时还在、
   * 应用启动时已空，且没有任何 `removeItem`）。注入摘掉那两个头即转绿 —— 因果钉死。
   */
  const bootHref = String(boot?.href ?? '');
  check(
    bootHref.includes('/app/#') && bootHref.includes('sessionToken='),
    '④ 会话经 **URL fragment** 投递到应用（sessionStorage 跨不过 agent cluster）',
    'structure',
  );
  // 应用是 `void consumePendingLogin()`，异步跑 —— 同样要等一个稳定态。
  let hashCleared = false;
  for (let i = 0; i < 20 && !hashCleared; i += 1) {
    await sleep(250);
    hashCleared = new URL(page.url()).hash === '';
  }
  check(
    hashCleared,
    '④ 地址栏里的会话 fragment 已被抹掉（一次性凭据不许留在历史里）',
    'structure',
  );
  console.log(`  · /api/auth/email/verify 的响应：${apiResponses.join(' | ') || '(没抓到)'}`);
  const timeline = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('__ssw') || '[]');
    } catch {
      return ['<unparsable>'];
    }
  });
  console.log(`  · sessionStorage 写入时间线：${JSON.stringify(timeline)}`);
  console.log(`  · 浏览器里的页面数：${page.context().pages().length}`);
  const prehides = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('__prehides') || '[]');
    } catch {
      return '<unparsable>';
    }
  });
  console.log(`  · 确认页 last instant（pagehide）：${JSON.stringify(prehides[prehides.length - 1])}`);

  /**
   * ── 判据：**应用真的登录了**（不是"界面说成功"）────────────────────
   *
   * 🔴 **必须轮询，不能落地就查**：`main.tsx` 是 `void consumePendingLogin()`
   * —— 它在首屏渲染之后**异步**跑。第一版这里立刻断言，于是判据与它**赛跑**，
   * 结果是"应用明明是好的、判据却红"（2026-09-30 实测：同一段代码用隔离探针
   * 多等 2.5 秒就全绿）。**判据自己要等一个"稳定态"，而不是等一个时刻。**
   */
  let stored = false;
  for (let i = 0; i < 40 && !stored; i += 1) {
    await sleep(500);
    stored = await page.evaluate(
      () => window.localStorage.getItem('heyta.sync.credentials') !== null,
    );
  }
  check(stored, '⑤ 落盘凭据出现（刷新之后仍是登录态）');

  // 末尾再取一次：这时时间线与 pagehide 序列才**覆盖了全部导航**。
  const finalState = await page.evaluate(() => ({
    timeline: (() => {
      try {
        return JSON.parse(localStorage.getItem('__ssw') || '[]');
      } catch {
        return '<unparsable>';
      }
    })(),
    prehides: (() => {
      try {
        return JSON.parse(localStorage.getItem('__prehides') || '[]');
      } catch {
        return '<unparsable>';
      }
    })(),
    now: Object.keys(sessionStorage),
  }));
  /**
   * 🔴 **冗长诊断只在红的时候打**（2026-09-30 改）。
   *
   * 它们是当初把那个静默失效拆开的那套仪器（写入时间线 + 每次 `pagehide` 的存储快照），
   * 一组要占十几行。绿的时候没人看，还会把"到底判了什么"淹掉；
   * 红的时候它们是第一手证据 —— 所以整体挪进**失败分支**，一格都不删。
   */
  if (failed) {
    console.log(`  · 末尾存储：${JSON.stringify(finalState.now)}`);
    for (const h of finalState.prehides) {
      console.log(`  · pagehide@${h.href.slice(-40)} → ${JSON.stringify(h.sessionKeys)}`);
    }
    for (const t of finalState.timeline) {
      console.log(`  · 写入@${t.at.slice(-40)} ${t.kind} ${t.key}`);
    }
  }

  await page.getByTestId('account-menu-avatar').click();
  const signedIn = (await page.getByTestId('account-menu-signout').count()) > 0;
  check(signedIn, '⑤ 身份菜单出现"退出登录" ⇒ **应用真的登录了**（这一格正是以前坏掉的）');
  await page.screenshot({ path: '/tmp/email-web-2-signed-in.png' });

  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(
    join(EVIDENCE, 'web-chain-run.txt'),
    [
      `# web 邮箱全链路（真浏览器 + 真邮件）· ${new Date().toISOString()}`,
      `EMAIL=${email}`,
      `PREVIEW=${preview}`,
      `LINK=${link}`,
      `SIGNED_IN=${String(signedIn)}`,
      `RESULT=${failed ? 'FAIL' : 'PASS'}`,
      '',
    ].join('\n'),
  );
} catch (err) {
  /**
   * 🔴 **失败时也要有图**（AGENTS §6.2 规定一第 1 条）。
   *
   * `locator.waitFor()` 超时抛在这里，**不走 `check()`** —— 上一次它留下的证据只有
   * 一行 `TimeoutError`，谁也不知道界面长什么样（而"界面其实是好的、锚点过期了"与
   * "应用真没起来"在日志上**一模一样**）。现在先落图再报错，并把控制台一起打出来：
   * 白屏的根因几乎只在控制台里现形。
   */
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, 'web-chain-FAIL.png') }).catch(() => {});
  console.error(`\n❌ 旅程中途抛错：${err}`);
  if (consoleLines.length > 0) {
    console.error('— 浏览器控制台（最后 20 条）—');
    for (const line of consoleLines.slice(-20)) console.error(`  ${line}`);
  }
  failed = true;
  failures.outcome.push(`中途抛错：${String(err).split('\n')[0]}`);
} finally {
  await browser.close();
  stop();
}

console.log('');
if (failed) {
  console.error('❌ web 邮箱全链路**未通过**');
  if (failures.outcome.length > 0) {
    console.error('\n— 结果类（用户能不能用）—');
    for (const what of failures.outcome) console.error(`  · ${what}`);
  }
  if (failures.structure.length > 0) {
    console.error('\n— 结构类（这份实现靠什么成立）—');
    for (const what of failures.structure) console.error(`  · ${what}`);
    if (failures.outcome.length === 0) {
      console.error(
        '  ⚠️ 结果类全绿：**这一轮用户其实能用**，红的是"保证"而不是"功能" —— 见 README 的 2×2 表。',
      );
    }
  }
  if (consoleLines.length > 0) {
    console.error('\n— 浏览器控制台 —');
    for (const line of consoleLines.slice(-20)) console.error(`  ${line}`);
  }
  process.exit(1);
}
console.log('✅ web 邮箱全链路通过：UI 注册 → 真发一封 → 链接 → 确认页 → **应用真的登录了**。');
process.exit(0);
