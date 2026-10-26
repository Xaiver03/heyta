/**
 * 邮件里的每一张凭据页与每一个脚本，在**真线上**都要打得开（不启本地服务，直接打公网域名）
 * ========================================================================
 *
 * ## 它补的是哪一格
 *
 * `pnpm check:credential-routes` 证的是**仓库内自洽**：`server/src/pages.ts` 注册的每张页
 * 与每个脚本，边缘那片 `00-heyta.caddy` 都有一条代理到 1900 的规则覆盖它。
 * 那条判据在**配置写对但没上线**时仍然绿 —— 而这一族的事故史恰恰是"改边缘"这件事本身会假
 * （2026-10-25 那次：`nginx-sync.sh --apply` 把配置写进一个没人读的文件，`nginx -t` 也过了，
 * 站点行为一点没变）。所以这里要一枚**从公网拿回来的读数**。
 *
 * 直接触发点：2026-10-26 用户报"重置密码邮件点开是 404"。修前实测
 * `/reset-password` 与 `/change-email` 都是 404，而同族另外三条是 400
 * （400 = 缺 `?token=`，说明那三条代理是通的）。根因是边缘那两条写死的正则里
 * 从没补进这两张后加的页。
 *
 * ## 每枚判据的能红性（不是设计出来的，是量出来的）
 *
 *  - ① 与 ③：2026-10-26 修**前**跑同一枚探针，`/reset-password` 读到 404、
 *    `/reset-password.js` 同样落进落地页 ⇒ 这两枚当时就是红的。这是真实世界的变异臂。
 *  - ④：把 `ORIGIN` 指到一台"所有路径都答 200"的服务器时它会红 —— 它存在的意义就是
 *    让 ①③ 不可能恒真。
 *  - ②：**当前没有红的读数**，它是哨兵（防的正是本域名历史上发生过五次的"200 + 落地页字节"）。
 *    如实登记：这一枚只被"它不许误报"验过（五张页与落地页逐字不同），没被"它会报"验过。
 *
 * ## 判据的形状：逐条打分，最后一起断言
 *
 * ⚠️ 不用一条接一条的 `expect`：`expect` 在第一条红处中止，后面的判据这一趟**根本没被判**，
 * 报告读起来却像"这条臂只点亮了这一枚"。所以下面先把每枚判据算完，再统一断言。
 *
 *  ① 每张页：状态码**不许是 404**。404 就是用户看到的那件事 —— 链接彻底打不开。
 *     允许 200（表单画出来了）/ 400（缺 token 或服务端拒了这枚 token）/ 409（中央鉴权模式下
 *     旧入口按设计关闭），这三种都是"服务端在答"，只有 404 是"边缘根本没送过去"。
 *  ② 每张页：正文**不许与落地页逐字相同**。只判状态码会被"200 但内容是另一张页"骗过去 ——
 *     那正是本域名已经发生过五次的形状。比逐字而不是比长度：长度相等只是巧合的尺。
 *  ③ 每个脚本：200 且 `content-type` 含 `javascript`。
 *     只代页不代脚本 = 页面画得出来、按钮是死的，而 curl 只看状态码时它是"200、很正常"。
 *  ④ **阳性对照**：一枚未注册路径必须仍是 404。
 *     没有它，① 就是恒真的 —— 边缘整站挂掉、所有路径都答 200 时，①③ 会一起变绿。
 *
 * 🔴 分母从 `scripts/check-credential-page-routes.mjs --json` 取（也就是从 `pages.ts` 取），
 *    **不在这里抄一份清单**：抄的那份会在加第 6 张页时静默漏掉，而那正是本条要防的事。
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const ORIGIN = process.env['HEYTA_LIVE_ORIGIN'] ?? 'https://heyta.waytofuture.cn';
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

interface Reading {
  path: string;
  status: number;
  ct: string;
  len: number;
  isLandingByteForByte: boolean;
}

const routes = JSON.parse(
  execFileSync(process.execPath, ['scripts/check-credential-page-routes.mjs', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }),
) as { pages: string[]; scripts: string[] };

/** 在**页面内**发请求：`--host-resolver-rules` 与 `--no-proxy-server` 只作用于浏览器网络栈，
 *  node 侧的 fetch 会走系统解析（本机是代理的 fake-ip），那就变成"验代理"而不是"验服务器"。 */
async function probe(page: import('@playwright/test').Page, path: string, landing: string): Promise<Reading> {
  const raw = await page.evaluate(async ({ origin, p, home }) => {
    const r = await fetch(`${origin}${p}`);
    const body = await r.text();
    return { status: r.status, ct: r.headers.get('content-type') ?? '', len: body.length, same: body === home };
  }, { origin: ORIGIN, p: path, home: landing });
  return { path, ...raw, isLandingByteForByte: raw.same };
}

test('每一张凭据页与每一个凭据脚本在线上都可达，且不是落地页', async ({ page }) => {
  test.skip(routes.pages.length === 0, '分母为空：判据没被判，先修探针再谈结论');

  // 必须先落在**本站页面**上：about:blank 里发出的 fetch 是跨域的，会被 CORS 拦掉 ——
  // 那验到的是浏览器策略，不是服务端形状。
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  const landing = await page.evaluate(async (origin: string) => (await (await fetch(`${origin}/`)).text()), ORIGIN);

  const pages: Reading[] = [];
  for (const p of routes.pages) pages.push(await probe(page, `${p}?token=definitely-invalid-token`, landing));
  const scripts: Reading[] = [];
  for (const s of routes.scripts) scripts.push(await probe(page, s, landing));
  const control = await probe(page, '/this-route-does-not-exist-anywhere', landing);

  console.log(`分母来自 pages.ts：页 ${String(routes.pages.length)} 张 / 脚本 ${String(routes.scripts.length)} 个`);
  for (const r of [...pages, ...scripts, control]) {
    console.log(`  ${r.path.padEnd(48)} ${String(r.status).padEnd(4)} ${r.ct.padEnd(42)} ${String(r.len)}B 逐字等于落地页=${r.isLandingByteForByte ? 'YES' : 'no'}`);
  }

  const failures: string[] = [];
  for (const r of pages) {
    if (r.status === 404) failures.push(`① ${r.path} 在线上 404 ⇒ 发到用户邮箱里的这枚链接点开是"页面未找到"`);
    if (r.isLandingByteForByte) failures.push(`② ${r.path} 的正文与落地页逐字相同 ⇒ "HTTP 200 但内容是另一张页"那一族又回来了`);
  }
  for (const r of scripts) {
    if (r.status !== 200) failures.push(`③ 脚本 ${r.path} 不是 200（读到 ${String(r.status)}）⇒ 页面画得出来、按钮是死的`);
    else if (!r.ct.includes('javascript')) failures.push(`③ 脚本 ${r.path} 的 content-type 是「${r.ct}」而不是 javascript ⇒ 浏览器会报 Unexpected token '<'`);
  }
  if (control.status !== 404) {
    failures.push(`④ 阳性对照失效：未注册的 ${control.path} 读到 ${String(control.status)} 而不是 404 ⇒ 上面那批"不是 404"是恒真的，零信息`);
  }

  expect(failures, failures.join('\n')).toEqual([]);
});
