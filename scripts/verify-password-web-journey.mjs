#!/usr/bin/env node
/**
 * 门禁：**邮箱 + 口令这条旅程在真浏览器里是否完整**（ADR-0040 / 计划 §8 J8·J15）
 * ============================================================================
 *
 * 这个文件只是**驱动**（起库、起服务端、起同源反代、跑 Playwright）。
 * 断言住在 `e2e/password-web/password-journey.spec.ts`。
 *
 * 分成两个文件不是风格：那套件的每一步都要用 `e2e/auth-journey/helpers.ts` 里的
 * 共享步骤（`openAuthPanel` / `toRegisterMode` / `acceptTerms` / `freshEmail`）。
 * 把断言写进根目录的 .mjs 就等于**手抄一份**那些步骤 —— 而本仓已经反复付过
 * "同一条规则两个实现，然后漂移"的学费（AGENTS §3.5 那两条实测教训）。
 *
 * ## 它补的是哪一腿
 *
 * `verify:password-chain`（CLI 层）结构上判不了这些：那条链的真假分布是
 * "真服务端 + 真库 + 真邮件，但**收发的两端都是脚本自己**"。于是——
 *
 *   · 界面上那个"注册"按钮点下去，用户看到的到底是哪句话；
 *   · 邮件里那条链接在**真实导航**下能不能把会话交回应用
 *     （`/app/#sessionToken=…` 那一跳靠的是浏览器的 fragment 语义，CLI 里没有"页面"）；
 *   · 表单的无障碍契约（`autocomplete` / `aria-pressed` / `aria-live`）——
 *     J15 的全部内容，而 jsdom 里连布局都没有。
 *
 * 逐条判据、每条点明是哪一层在判，写在 spec 文件头。
 *
 * ## 拓扑（与 `verify-email-web-chain.mjs` 同一张图，理由在那边已经写透）
 *
 * ```
 *   浏览器 ──► 127.0.0.1:4401（本脚本起的同源反代）
 *                 ├── /api/*、/verify-email…  ──► API 服务端 :3233（TEST_MODE **关**）
 *                 └── 其余（含 /app/）         ──► apps/web/dist（每次从源码重打）
 * ```
 *
 * 同源是**必需的**，不是整洁偏好：邮件里的链接指向 `PUBLIC_URL`，确认页成功后跳
 * `/app/` —— 服务端自己**不**服务 `/app/`（生产上那一格是反代给的）。不复刻就会
 * 得到"点完确认页 404"，而那条判据测的是反代，不是产品。
 *
 * 🔴 **TEST_MODE 必须是关的**：那个模式下 `sendEmail` 根本不碰网络（直接返回成功），
 *    于是"那封信真的存在"这一整腿会变成**等一个永远不会出现的 preview**。
 *    `scripts/lib/auth-journey-server.mjs` 的 `startServer()` 原来固定注入 TEST_MODE，
 *    现在它是可选参数（默认仍为 `true`，另外两个调用方行为逐字不变）。
 *
 * ## 跨进程的仪器
 *
 * Playwright 用例跑在**另一个进程**里，读不到这里内存中的服务端日志。所以：
 *
 * - `HEYTA_PASSWORD_WEB_API_LOG`：服务端 stdout+stderr 的落盘副本。spec 从里面
 *   抓 Ethereal 的 `Preview URL:`，再从渲染后的正文里取 `/verify-email?token=…`。
 *   **每次运行先截断** —— 不截断的话，上一轮留下的 preview 会让这一轮"什么信都没发"
 *   也判成通过（那是本脚本能给出的最坏的一种绿）。
 * - `HEYTA_PASSWORD_WEB_PSQL`：已经剥掉 Prisma 专有查询参数的 libpq URL。
 *   spec 用它读 `users` 那一行的三个形状位（未验证→已验证 / 有口令哈希 / 令牌已清）。
 *
 * ## 用法与前置
 *
 * `pnpm verify:password-web`
 *
 * 本机 Postgres（与 `verify:p1` 同一套约定）、`cd e2e && pnpm install` 且 chromium 已装。
 * **不需要**任何环境变量 —— 库、端口、两份构建全部自管。无头 chromium，不开任何窗口
 * （AGENTS §6.2 规定二）。
 */

import { spawn, spawnSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  databaseUrlFor,
  ensureDatabase,
  ensureServerBuilt,
  installCleanup,
  resolveNode,
  startServer,
  toLibpqUrl,
} from './lib/auth-journey-server.mjs';

// ⚠️ 必须用 fileURLToPath：`new URL(...).pathname` 会把空格转义成 %20，
//    而 heyta 的检出路径里**真的有空格**（"All in one Data"）。
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const API_PORT = '3233';
// 与 `e2e/playwright.password-web.config.ts` 里的常量保持一致。撞上别人的端口会让
// 反代把**别人的应用**当被测对象（症状：全绿，测的是另一个网站）。
const WEB_PORT = '4401';
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const DB_NAME = process.env['HEYTA_VERIFY_DB_NAME'] ?? 'heyta_password_web_journey';

const DIST = join(ROOT, 'apps/web/dist');
const RESULTS = join(ROOT, 'e2e/password-web-results');
const API_LOG = join(RESULTS, 'api.log');

const dbUrl = databaseUrlFor(DB_NAME);

console.log('\n=== 邮箱 + 口令：真浏览器旅程（真服务端 + 真邮件 + 真导航）===\n');
console.log(`· 库：${DB_NAME}`);
console.log(`· 同源反代：${WEB}   API：${API}（TEST_MODE 关）`);

ensureDatabase({ root: ROOT, dbUrl, dbName: DB_NAME });
ensureServerBuilt({ root: ROOT, dbUrl });

// ── 前端产物：**每次都从当前源码重打**（AGENTS §7 第 82 条）─────────────
// "存在即跳过"在这棵树上骗过人不止一次：装了旧产物而判据全绿。
//
// 🔴 `@heyta/web...` 末尾那三个点是**必需的**，不是排版：浏览器加载的是
// `packages/ui/dist`（`@heyta/ui` 的 `exports` 只指向 dist），而 J15 判的
// **就是那个包里的 `src/auth/AuthForm.tsx`**。只 build web 会把上一轮的
// `dist/index.js` 原样打进去 —— 于是"改了共享表单但真浏览器判据没变"，
// 与 §7 第 27 条（APK 里是旧 JS bundle）是同一个失效形态。
console.log('· 构建 apps/web 及其全部 workspace 依赖（反代服务的是真产物，不是 dev server）…');
{
  const built = spawnSync('pnpm', ['--filter', '@heyta/web...', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if ((built.status ?? 1) !== 0) fail('apps/web 构建失败');
}
if (!existsSync(join(DIST, 'index.html'))) fail('apps/web/dist/index.html 不存在（构建没产出？）');

mkdirSync(RESULTS, { recursive: true });
// 🔴 先截断再启动：见文件头"跨进程的仪器"。
writeFileSync(API_LOG, '');

const server = await startServer({
  root: ROOT,
  node: resolveNode(),
  port: API_PORT,
  dbUrl,
  testMode: false,
  logFile: API_LOG,
  // 🔴 邮件里的链接指向**反代那个 origin**（页面在那儿），否则点开是 404。
  publicUrl: WEB,
  corsOrigins: [WEB],
});
// 清理表在下面反代建好之后**一次**注册（两个 handle 一起）—— 分两次注册的话，
// 中间任何一次抛出都会把 :4401 留在监听状态，下一轮直接绑不上端口。
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  // 🔴 `application/wasm` 不是装饰：缺了它，浏览器会拒绝流式编译并**回落**到
  // ArrayBuffer 实例化 —— 上一轮的真浏览器日志里就是这么写的
  // （`wasm streaming compile failed: … Expected 'application/wasm'`）。
  // 产品没坏，但**探针给它的字节与服务端给它的字节不一样**，而这条错误会一直
  // 混在控制台里，把真正的错误挤下去（§6.2 规定一第 3 条要读的就是那个控制台）。
  '.wasm': 'application/wasm',
};

/** 服务端自己的面（API、凭据页与其脚本）走上游；其余是应用产物。 */
const toApi = (p) =>
  p.startsWith('/api/') ||
  p.startsWith('/health') ||
  p === '/verify-email' ||
  p === '/magic-login' ||
  p === '/magic-login-confirm.js' ||
  p.startsWith('/reset-password') ||
  p.startsWith('/recover-passkey');

const web = createServer((req, res) => {
  const url = new URL(req.url ?? '/', WEB);
  if (toApi(url.pathname)) {
    const proxied = httpRequest(
      {
        host: '127.0.0.1',
        port: API_PORT,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, { ...upstream.headers });
        upstream.pipe(res);
      },
    );
    proxied.on('error', () => res.writeHead(502).end('proxy error'));
    req.pipe(proxied);
    return;
  }
  // `/app/...` 与 `/` 都由 dist 提供（生产上反代就是这么配的）。
  const rel = url.pathname.startsWith('/app/') ? url.pathname.slice('/app'.length) : url.pathname;
  const file = join(DIST, rel === '/' ? 'index.html' : rel);
  // 🔴 `DIST + '/'` 是**路径穿越栅栏**：`rel` 来自请求行，`../../` 拼进来就会把
  //    仓库里的任意文件当静态资源发出去。这个反代只监听回环，但栅栏不因此多余 ——
  //    探针自己不许是漏洞。带分隔符而不是只比 `DIST`，否则同名兄弟目录
  //    （`dist-evil`）会被当成"在 dist 里面"放行。
  let isFile = false;
  try {
    isFile = (file === DIST || file.startsWith(`${DIST}/`)) && statSync(file).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

installCleanup([server, { stop: () => web.close() }]);

await new Promise((r) => web.listen(Number(WEB_PORT), '127.0.0.1', r));
console.log('· 反代就绪\n');

const test = spawn(
  'pnpm',
  ['--dir', 'e2e', 'exec', 'playwright', 'test', '--config=playwright.password-web.config.ts'],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      // 复用 auth-journey 那套共享步骤里已有的变量名 —— 同一个服务端地址的语义，
      // 只是这里给的是**同源反代**而不是裸 API 端口。
      HEYTA_AUTH_JOURNEY_SERVER: WEB,
      HEYTA_PASSWORD_WEB_API_LOG: API_LOG,
      HEYTA_PASSWORD_WEB_PSQL: toLibpqUrl(dbUrl),
    },
    stdio: 'inherit',
  },
);

const code = await new Promise((resolve) => test.on('exit', resolve));

web.close();
server.stop();

if (code === 0) {
  console.log('\n✅ 邮箱 + 口令的真浏览器旅程通过（注册 → 邮件 → 确认 → 口令登录 → 暗色）\n');
} else {
  console.log('\n❌ 未通过。截图在 apps/web/evidence/password-web-journey/，服务端日志：', API_LOG);
  console.log('   （逐条判据的名字印在 spec 的输出里；不要只看这个退出码就下结论）\n');
}
process.exit(code ?? 1);

// ── 小工具 ──────────────────────────────────────────────────────────────
function fail(why) {
  console.error(`\n❌ ${why}`);
  console.log('RESULT=FAIL');
  process.exit(1);
}
