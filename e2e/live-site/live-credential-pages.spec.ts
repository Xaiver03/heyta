/**
 * 邮件里的每一枚目的地（凭据页 / 页内脚本 / 应用地址）在**真线上**都要打得开
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
 *  - ⑥：把 `token` 换成一枚有效值也只会换掉 `code`，退码仍非 404；它真正的能红形状是
 *    "部署的那份镜像里没有这条路由"，那种时候 Fastify 答 404 且是 HTML —— 三条断言一起红。
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
 *  ⑤ 邮件里的**应用**目的地（`/app/` 与 `/app/?signin=1`）：200 且正文引 `/app/assets/`。
 *     这一枚必须比"状态码不是 404"更严 —— `/app/` 走的是文件服务不是代理，
 *     被落地页顶掉时状态码同样是 200，而那正是本域名踩过五次的那个形状。
 *  ⑥ 脚本自己发请求的那些 `/api/...` 端点在线上要"答得像服务端"：非 404、JSON、
 *     且带一枚机器可读的 `code`。这一枚补的是"页与脚本都在、镜像里少那条路由"的形状 ——
 *     按钮活着、转一下、报一句用户看不懂的话。本轮实测五枚端点全在
 *     （`invalid_reset_link` / `invalid_change_link` / `invalid_or_expired_link` /
 *     `invalid_recovery_token` / `validation_failed`）。
 *  ④ **阳性对照**：一枚未注册路径必须仍是 404。
 *  ⑦ 每张页**服务的是不是它自己那张页**：它线上引的凭据脚本必须落在 `pages.ts` 给它声明的
 *     那一组里（缺自己的 ⇒ 红；引到别人独占的 ⇒ 红），并且五张页的正文两两不许逐字相同。
 *     ② 只判"不等于落地页"，**两张凭据页互换**（边缘把 `/reset-password` 接到 `/change-email`
 *     那张页上）在 ② 下是绿的，而用户看到的是"点重置密码，打开是换邮箱"。
 *     标记不抄清单：`pageScripts` 由 `check-credential-page-routes.mjs --json` 从 `pages.ts`
 *     现读，与上面几枚出自同一次读盘。
 *     🔴 为什么"正文两两不同"这一半不可省：`/verify-email` 与 `/magic-login` 在 `pages.ts` 里
 *     **共用** `/magic-login-confirm.js`，那两张页互换时前半条判据看不出来。
 *     它的能红性有一枚现成的负对照：同一把尺若打在 `/app/` 与 `/app/?signin=1` 上**会红**
 *     （2026-10-27 实测：两枚都是 5919B、FNV 哈希**同为** 3082806998 —— 它们本该相同，
 *     是同一个应用的两枚深链），所以这条只施于五张凭据页。
 *     五张凭据页这一趟的读数互不相同：4580/4307/4494/5391/4353 B。
 *     这不是"设计出来大概能红"，是量过的。
 *     ⚠️ 哈希**只用来判等**，所以它必须是真 FNV-1a：第一版写成 `h * 16777619`，
 *        乘积超出 2^53 会丢精度（照样确定性，但均匀性变差、更容易撞）。已改 `Math.imul`。
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
  servesApp: boolean;
  fetchTargets: string[];
  scriptRefs: string[];
  hash: number;
}

const routes = JSON.parse(
  execFileSync(process.execPath, ['scripts/check-credential-page-routes.mjs', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }),
) as { pages: string[]; scripts: string[]; emailPaths: string[]; pageScripts: Record<string, string[]> };

/** 在**页面内**发请求：`--host-resolver-rules` 与 `--no-proxy-server` 只作用于浏览器网络栈，
 *  node 侧的 fetch 会走系统解析（本机是代理的 fake-ip），那就变成"验代理"而不是"验服务器"。 */
async function probe(page: import('@playwright/test').Page, path: string, landing: string): Promise<Reading> {
  const raw = await page.evaluate(async ({ origin, p, home }) => {
    const r = await fetch(`${origin}${p}`);
    const body = await r.text();
    return {
      status: r.status,
      ct: r.headers.get('content-type') ?? '',
      len: body.length,
      same: body === home,
      app: body.includes('/app/assets/'),
      // 脚本**自己**在往哪些端点发请求 —— 从线上那份脚本文本里读，不从本地文件读：
      // 要防的是"跑着的那份脚本发向一个跑着的服务器没有的路由"。
      targets: [...new Set([...body.matchAll(/fetch\(\s*['"`](\/api\/[^'"`?]+)/g)].map((x) => x[1]))],
      // 这张页引了哪些脚本（⑦ 用它判"服务的是不是它自己那张页"）
      refs: [...new Set([...body.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map((x) => x[1]))],
      // FNV-1a：只用来判"两张页的正文彼此不同"，不当校验和用。
      hash: [...body].reduce((h, c) => (Math.imul(h, 16777619) ^ c.charCodeAt(0)) >>> 0, 2166136261),
    };
  }, { origin: ORIGIN, p: path, home: landing });
  return {
    path,
    ...raw,
    isLandingByteForByte: raw.same,
    servesApp: raw.app,
    fetchTargets: raw.targets,
    scriptRefs: raw.refs,
    hash: raw.hash,
  };
}

test('邮件里的每一枚目的地在线上都可达，且服务的是它自己那张页', async ({ page }) => {
  test.skip(routes.pages.length === 0, '分母为空：判据没被判，先修探针再谈结论');

  // 必须先落在**本站页面**上：about:blank 里发出的 fetch 是跨域的，会被 CORS 拦掉 ——
  // 那验到的是浏览器策略，不是服务端形状。
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  const landing = await page.evaluate(async (origin: string) => (await (await fetch(`${origin}/`)).text()), ORIGIN);

  const pages: Reading[] = [];
  for (const p of routes.pages) pages.push(await probe(page, `${p}?token=definitely-invalid-token`, landing));
  const scripts: Reading[] = [];
  for (const s of routes.scripts) scripts.push(await probe(page, s, landing));
  // 🔴 邮件里**不只有凭据页**：改密成功、换绑完成、新增验证器那几封信发的是 `/app/`，
  //    登录验证码那两封发的是 `/app/?signin=1`（分母同样从 `email.ts` 取，不抄清单）。
  //    它们落的是边缘的**文件服务**那一条，不是代理，所以判据也不同：必须服务出
  //    **应用那份产物**（正文引 `/app/assets/…`），而不是被落地页顶掉 —— 后者状态码一样是 200。
  const appPaths = routes.emailPaths.filter((p) => !routes.pages.includes(p));
  const apps: Reading[] = [];
  for (const p of appPaths) {
    apps.push(await probe(page, `${p}?signin=1`, landing));
    apps.push(await probe(page, p, landing));
  }
  const control = await probe(page, '/this-route-does-not-exist-anywhere', landing);

  const CRED_SCRIPTS = new Set(routes.scripts);
  const refPathsOf = (r: Reading) =>
    r.scriptRefs.map((s) => { try { return new URL(s, ORIGIN).pathname; } catch { return s; } })
      .filter((p) => CRED_SCRIPTS.has(p));

  console.log(`分母来自 pages.ts + email.ts：页 ${String(routes.pages.length)} 张 / 脚本 ${String(routes.scripts.length)} 个 / 邮件目的地 ${String(routes.emailPaths.length)} 枚`);
  for (const r of [...pages, ...scripts, ...apps, control]) {
    console.log(`  ${r.path.padEnd(48)} ${String(r.status).padEnd(4)} ${r.ct.padEnd(42)} ${String(r.len)}B 正文哈希=${String(r.hash).padStart(10)} 逐字等于落地页=${r.isLandingByteForByte ? 'YES' : 'no'} 应用产物=${r.servesApp ? 'YES' : 'no'}`);
  }
  // ⑦ 的读数单独打一行：页 → 它线上实际引的凭据脚本。
  for (const r of pages) {
    console.log(`  ⑦ ${r.path.split('?')[0].padEnd(20)} 线上引 ${refPathsOf(r).join(',') || '(无)'} ｜ pages.ts 声明 ${(routes.pageScripts[r.path.split('?')[0]] ?? []).join(',') || '(无)'}`);
  }

  const failures: string[] = [];
  for (const r of pages) {
    if (r.status === 404) failures.push(`① ${r.path} 在线上 404 ⇒ 发到用户邮箱里的这枚链接点开是"页面未找到"`);
    if (r.isLandingByteForByte) failures.push(`② ${r.path} 的正文与落地页逐字相同 ⇒ "HTTP 200 但内容是另一张页"那一族又回来了`);
  }
  /*
    ⑦ **这张页服务的是不是它自己那张页**。② 只判"正文不等于落地页"——
    两张凭据页**互换**（边缘把 `/reset-password` 指到 `/change-email` 那张页上）
    在 ② 下是绿的，而用户看到的就是"点重置密码，打开是换邮箱"。
    标记从 `pages.ts` 的 `scripts: [...]` 现读（经门禁的 `--json`，与上面同一份分母）：
      · 一张页**必须**引到自己声明的那几支凭据脚本之一；
      · 它**不许**引到别的页独占的凭据脚本；
      · 五张页的正文两两**不许逐字相同**（`/verify-email` 与 `/magic-login` 共用一支脚本，
        单靠前两条分不开，这一条分得开）。
  */
  if (pages.length > 0 && pages.every((r) => r.scriptRefs.length === 0)) {
    failures.push('⑦ 探针不成立：五张线上页面里一枚 `<script src>` 都没读到 ⇒ 下面那三条等于没判');
  }
  for (const r of pages) {
    const path = r.path.split('?')[0];
    const own = new Set(routes.pageScripts[path] ?? []);
    const refs = refPathsOf(r);
    if (own.size === 0) {
      if (refs.length > 0) {
        failures.push(`⑦ ${path} 在 pages.ts 里没声明脚本，线上却引了 ${refs.join(',')} ⇒ 服务的大概率是别人的页`);
      }
      continue;
    }
    if (!refs.some((p) => own.has(p))) {
      failures.push(
        `⑦ ${path} 线上引的是 ${refs.join(',') || '（一枚凭据脚本都没有）'}，` +
          `而 pages.ts 给它声明的是 ${[...own].join(',')} ⇒ 这张页不是它自己那张`,
      );
    }
    const foreign = refs.filter((p) => !own.has(p));
    if (foreign.length > 0) {
      failures.push(`⑦ ${path} 引了不属于它的凭据脚本 ${foreign.join(',')} ⇒ 边缘把两张页接串了`);
    }
  }
  for (let i = 0; i < pages.length; i += 1) {
    for (let j = i + 1; j < pages.length; j += 1) {
      if (pages[i].hash === pages[j].hash && pages[i].len === pages[j].len) {
        failures.push(`⑦ ${pages[i].path} 与 ${pages[j].path} 的正文逐字相同 ⇒ 其中至少一张不是它自己那张页`);
      }
    }
  }
  for (const r of scripts) {
    if (r.status !== 200) failures.push(`③ 脚本 ${r.path} 不是 200（读到 ${String(r.status)}）⇒ 页面画得出来、按钮是死的`);
    else if (!r.ct.includes('javascript')) failures.push(`③ 脚本 ${r.path} 的 content-type 是「${r.ct}」而不是 javascript ⇒ 浏览器会报 Unexpected token '<'`);
  }
  for (const r of apps) {
    if (r.status !== 200) failures.push(`⑤ 邮件里的应用地址 ${r.path} 读到 ${String(r.status)} ⇒ 那封信的按钮点不开`);
    else if (!r.servesApp) failures.push(`⑤ 邮件里的应用地址 ${r.path} 是 200，但正文不引 /app/assets/ ⇒ 服务的是落地页，不是应用`);
  }
  /*
    ⑥ 脚本发请求的那些 `/api/...` 端点，在线上必须是"服务端在答"，不是 404。
    只代页不代脚本会让按钮死掉（本仓库为此写过一整条注释），而**镜像里少一条路由**
    会让按钮活着、转一下、然后报一个用户看不懂的错 —— 同一族的下一种形状。
    打的是**故意无效的令牌**：解析不出账号，所以不改任何数据、不发任何信。
    判"不是 404"而不是判某个具体码：具体码随策略顺序变（本轮实测先撞口令策略再撞令牌），
    钉死它会造出与缺陷无关的红。
  */
  const endpoints = [...new Set(scripts.flatMap((r) => r.fetchTargets))].sort();
  const api: { path: string; status: number; ct: string; code: string }[] = [];
  for (const e of endpoints) {
    api.push(await page.evaluate(async ({ origin, p }) => {
      const r = await fetch(`${origin}${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'definitely-invalid', password: 'Q7#mVm2mB!sP9dLxR4tYw6x3' }),
      });
      const text = await r.text();
      return {
        path: p,
        status: r.status,
        ct: r.headers.get('content-type') ?? '',
        // 服务端错误形状是全仓统一的（`pnpm check:server-error-shape` 钉着），
        // 所以"带一枚机器可读的 code"就是"打到 API 面了"的证据 —— 比只看 content-type 强。
        code: /"code":"([^"]+)"/.exec(text)?.[1] ?? '',
      };
    }, { origin: ORIGIN, p: e }));
  }
  for (const a of api) console.log(`  POST ${a.path.padEnd(44)} ${String(a.status).padEnd(4)} code=${a.code || '(无)'}`);
  for (const a of api) {
    if (a.status === 404) failures.push(`⑥ 脚本要发的 ${a.path} 在线上 404 ⇒ 页面画得出来、按钮点了没结果`);
    else if (!a.ct.includes('json')) failures.push(`⑥ ${a.path} 答的不是 JSON（${a.ct}）⇒ 那一发多半没打到 API 面`);
    else if (a.code === '') failures.push(`⑥ ${a.path} 是 JSON 但没有机器可读的 code ⇒ 不是服务端那条错误形状，读不出它到底答了谁`);
  }
  if (endpoints.length === 0) failures.push('⑥ 探针不成立：五份线上脚本里一枚 /api/ 端点都没读到，这一条等于没判');
  if (control.status !== 404) {
    failures.push(`④ 阳性对照失效：未注册的 ${control.path} 读到 ${String(control.status)} 而不是 404 ⇒ 上面那批"不是 404"是恒真的，零信息`);
  }

  expect(failures, failures.join('\n')).toEqual([]);
});
