/**
 * 线上验收：**站点对爬虫露出的那套东西 —— 状态码、head、sitemap**
 * =================================================================
 *
 * 分工（与同目录另两份不重叠）：
 *   · `apps/landing/tests/seo-head.spec.ts` —— **生成物**的头部契约（读磁盘，76 份入口逐份查）；
 *   · 本文件 —— **线上真的在答什么**。两者红了含义不同：前者是生成器/词条表坏了，
 *     后者是**部署没跟上**或 nginx 路由被人改了。
 *
 * ## 🔴 这一份的判据全部用**不执行 JS**的请求取字节
 *
 * `request.get()` 拿到的是**服务器原样发出来的那份 HTML** —— 正是不跑 JS 的爬虫
 * （百度 / 搜狗 / 各种抓取器）看到的东西。用 `page.goto` + `page.content()` 拿到的是
 * **执行完 JS 之后的 DOM**，那会把这个仓库目前最大的一个 SEO 事实掩盖掉：
 * 入口 HTML 里 `#root` 是空的，正文全靠 React 挂载（ADR-0033 §7.1 的勘误）。
 * 所以：**凡"爬虫看不看得见"这一类的判据，一律走 `request`。**
 *
 * ## 2026-10-19 这一份是被一次真实的线上改动逼出来的
 *
 * SEO 审计实测：`/no-such-page-xyz/` 这类**任意**不存在的路径回的是
 * **HTTP 200 + 落地页字节**（7022 B）—— 一片可以无限生成的软 404。
 * 修法是把 `location /` 与 `location /en/` 的 SPA 兜底（`… /index.html`）换成
 * `=404`（与 G-25b 给 `/legal/*` 做的是同一件事，只是推广到整站）。
 *
 * 🔴 **那次改动最危险的地方不是 404 本身，而是"把真页面一起 404 掉"** ——
 * 而这个仓库已经知道那种红长什么样：`try_files` 少一个 `$uri/`，
 * `/features/` 会**安静地**退化成"200 + 首页字节"（deployment §3.7 那张表）。
 * 所以下面这组判据里，**阳性对照与 sitemap 全量遍历**都不是装饰：
 * 少了它们，"整站都 404"与"修对了"在这份文件里长得一模一样。
 *
 * ## ⚠️ 有一条判据**按设计**在落地页发布之前是红的
 *
 * 见最末那条 `og:locale:alternate`。它的红**就是信号**（"仓库里的头部改动还没发出去"），
 * 不是缺陷；发布命令见 `docs/runbooks/deployment.md` §3.7「重新发布的三条命令」
 * 与 `research/tools/publish-public-sites.mjs`。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const ORIGIN = process.env['HEYTA_LIVE_ORIGIN'] ?? 'https://heyta.waytofuture.cn';

/** 404 页的**结构**标记，不是抄来的文案。 */
const NOTFOUND_ROBOTS = 'name="robots" content="noindex"';

/**
 * 取一份**服务器原样发出的**字节（不执行 JS）。
 *
 * `maxRedirects: 0`：本文件里既有"该 200"也有"该 301"的地址，跟着跳转会
 * 把"这条其实是重定向"这件事吞掉 —— 而 301 本身是判据（§3.7 那条红线：
 * 无尾斜杠的地址不能 404）。
 */
async function raw(
  request: import('@playwright/test').APIRequestContext,
  path: string,
): Promise<{ status: number; body: string; location: string | null }> {
  const response = await request.get(`${ORIGIN}${path}`, {
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  return {
    status: response.status(),
    body: response.status() === 301 || response.status() === 302 ? '' : await response.text(),
    location: response.headers()['location'] ?? null,
  };
}

test('未注册的路径答真 404；且答的不是"200 + 首页字节"（软 404 已消失）', async ({ request }) => {
  const home = await raw(request, '/');
  expect(home.status, `参照物：首页本身取不到（${home.status}），后面的对照全部无效`).toBe(200);

  for (const path of ['/no-such-page-xyz/', '/en/no-such-page-xyz/', '/docs/no-such/', '/featuresx/']) {
    const miss = await raw(request, path);
    expect(
      miss.status,
      `线上 ${path} 是 ${miss.status}，期望真 404 —— 200 就意味着"任意不存在的路径"又被答成了成功（软 404 回来了）`,
    ).toBe(404);
    // 状态码之外再判字节：把路径改成兜底目标时，状态码可能仍然是 404 而内容是首页。
    expect(miss.body, `${path} 返回 404 但字节就是首页（${home.body.length} 字节的同一份文档）`).not.toBe(
      home.body,
    );
    // 结构标记：404 页是零 JS、带 noindex、**不带** canonical 的那一张。
    expect(miss.body, `${path} 的 404 正文里没有 noindex —— 答的可能是别的页`).toContain(
      NOTFOUND_ROBOTS,
    );
    expect(
      miss.body,
      `${path} 的 404 正文里出现了 canonical —— 404 不该向搜索引擎声明自己是某个页面`,
    ).not.toContain('rel="canonical"');
  }
});

test('🔴 阳性对照：全部已注册页面**仍然**是 200，没被 404 规则牵连', async ({ request }) => {
  /**
   * 这一条不是"再验一遍 404"，它验的是那次改动的**风险面**。
   * 去掉兜底时最容易犯的错是把真页面一起干掉，而 deploy 手册 §3.7 那张表说明
   * 那种错**只看状态码是抓不到的**（它会退化成 200 + 首页）。所以这里的状态码
   * 判据必须与下面的 canonical 判据一起看。
   */
  const pages = ['/', '/en/', '/features/', '/en/features/', '/docs/', '/pricing/', '/changelog/', '/download/'];
  for (const path of pages) {
    const hit = await raw(request, path);
    expect(hit.status, `已注册页面 ${path} 取到 ${hit.status}`).toBe(200);
    // canonical 必须**指向自己这一页**（子页面指向首页是本类站点最隐蔽的一种错）。
    expect(hit.body, `${path} 的 canonical 不是自己这一页`).toContain(
      `<link rel="canonical" href="${ORIGIN}${path}" />`,
    );
  }
});

test('无尾斜杠的地址仍 301 到带尾斜杠（deployment §3.7 那条红线）', async ({ request }) => {
  // `$uri/` 被删掉的那一天，这一条会红 —— 而它红得比"页面打不开"早得多：
  // 那时 `/features/` 会变成"200 + 首页"，人眼几乎看不出来。
  for (const [path, target] of [
    ['/features', '/features/'],
    ['/legal/terms', '/legal/terms/'],
  ] as const) {
    const redirect = await raw(request, path);
    expect(redirect.status, `${path} 是 ${redirect.status}，期望 301`).toBe(301);
    expect(redirect.location, `${path} 的 Location 不对`).toBe(`${ORIGIN}${target}`);
  }
});

test('爬虫看到的那份字节里，head 契约成立（title / description / hreflang / og:url）', async ({
  request,
}) => {
  const zh = await raw(request, '/features/');
  const en = await raw(request, '/en/features/');
  for (const page of [zh, en]) expect(page.status).toBe(200);

  for (const [label, page, path, locale] of [
    ['zh', zh, '/features/', 'zh-CN'],
    ['en', en, '/en/features/', 'en'],
  ] as const) {
    const titles = page.body.match(/<title>([^<]*)<\/title>/g) ?? [];
    expect(titles.length, `${label} 入口的 <title> 不止一个或一个都没有`).toBe(1);
    expect(page.body, `${label} 缺 meta description`).toContain('<meta name="description"');
    // hreflang 三件套**都指向本页的对应语言版本**（子页面指向首页是最隐蔽的那种错）。
    for (const hreflang of ['zh-CN', 'en', 'x-default']) {
      expect(page.body, `${label} 缺 hreflang=${hreflang}`).toContain(
        `rel="alternate" hreflang="${hreflang}"`,
      );
    }
    // 🔴 三件套的落点是"**这一页的两种语言版本**"—— 中英两版声明的必须是**同一组**
    //    地址（每一版都把自己也列进去，这是 hreflang 的契约）。
    //    我第一版这里把"本页的地址"当成了"本页中文版的地址"，于是英文页会红 ——
    //    那正是这条判据**能失败**的证据：它辨得出"指向兄弟页"与"指向自己"。
    expect(page.body, `${label} 的 zh-CN 落点不是本页的中文版`).toContain(
      `hreflang="zh-CN" href="${ORIGIN}/features/"`,
    );
    expect(page.body, `${label} 的 en 落点不是本页的英文版`).toContain(
      `hreflang="en" href="${ORIGIN}/en/features/"`,
    );
    // x-default 指向中文版（主站）：语言未匹配时的兜底。
    expect(page.body, `${label} 的 x-default 落点不是中文版`).toContain(
      `hreflang="x-default" href="${ORIGIN}/features/"`,
    );
    // og:url 必须等于 canonical（同一个事实源算出来的），否则平台抓一个、搜索引擎认另一个。
    expect(page.body, `${label} 的 og:url 与 canonical 不一致`).toContain(
      `<meta property="og:url" content="${ORIGIN}${path}" />`,
    );
    // 结构化数据要在**爬虫拿到的那份字节里**就能解析（不依赖 JS）。
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page.body);
    expect(ld, `${label} 入口里没有 JSON-LD`).not.toBeNull();
    const nodes = JSON.parse(ld?.[1] ?? '[]') as { '@type'?: string; inLanguage?: string }[];
    const app = nodes.find((n) => n['@type'] === 'SoftwareApplication');
    expect(app, `${label} 的 JSON-LD 里没有 SoftwareApplication`).toBeDefined();
    expect(app?.['inLanguage'], `${label} 的 SoftwareApplication.inLanguage 与页面语言不符`).toBe(
      locale,
    );
  }

  // 中英两版必须真的不同 —— 复制过去忘了改的症状是"爬虫看到的是中文"。
  expect(zh.body, '中英两版的 title 相同：英文页顶着中文标题').not.toBe(en.body);
});

test('sitemap 里**每一条**都真的 200（改了兜底最容易在这里漏）', async ({ request }) => {
  const sitemap = await raw(request, '/sitemap.xml');
  expect(sitemap.status).toBe(200);
  const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? '');
  expect(locs.length, 'sitemap 里一条 URL 都没有').toBeGreaterThan(0);

  // 全都在 canonical 主机上（换域名时漏改的那几条会在这里露出来）。
  for (const loc of locs) {
    expect(loc.startsWith(`${ORIGIN}/`), `sitemap 里的 ${loc} 不在 ${ORIGIN} 主机上`).toBe(true);
  }

  // 🔴 逐条真取一遍，**分批**避免一次打 76 个并发：
  //    这一条正是 `try_files` 改动的兜底网 —— 哪个页面其实没有真目录（靠 `$uri/`
  //    的邻居兜着），在这里会变成一个 404，而别处看不出来。
  const BATCH = 12;
  const bad: string[] = [];
  for (let i = 0; i < locs.length; i += BATCH) {
    const slice = locs.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(async (loc) => ({ loc, status: (await request.get(loc, { failOnStatusCode: false })).status() })),
    );
    for (const r of results) if (r.status !== 200) bad.push(`${r.status} ${r.loc}`);
  }
  expect(bad, `sitemap 里列了但线上不是 200 的地址：\n${bad.join('\n')}`).toEqual([]);
});

/**
 * IndexNow 的键文件：站点根那个 `<key>.txt` 必须**线上真能取到**。
 *
 * 这条不是"再验一遍 404 规则"，它验的是两件只有线上才能判的事：
 *   · 那个文件**真的发出去了**（生成物在仓库里 ≠ 它在服务器上）；
 *   · 它**没被任何路由规则吃掉**（本站刚把整站兜底改成 `=404`，而这类
 *     "站点根下的单个文件"正是最容易被顺手 404 掉的东西）。
 *
 * 🔴 key 从**本机生成物**里取名字，不在这里抄一遍：抄件会在轮换 key 那天静默失配，
 * 而失配的表现是"这条判据测的是上一个 key"。
 * ⚠️ 路径用 `fileURLToPath` 而不是 `new URL(...).pathname` —— 本仓库根目录名里
 *    有空格，`.pathname` 会把它变成 `%20`（skill 的 `upload_file_in_tab` 那条注释
 *    记的就是这个坑）。
 */
test('IndexNow 键文件线上可取，且内容逐字等于本机那一份', async ({ request }) => {
  const publicDir = fileURLToPath(new URL('../../apps/landing/public/', import.meta.url));
  /**
   * 🔴 挑出键文件**用它自己的协议性质**，不靠"排除 robots.txt"这类白名单：
   * IndexNow 的键文件按定义就是「一个 `.txt`，其内容等于它自己去掉后缀的文件名」。
   *
   * ⚠️ 我第一版写的是 `filter(f => f.endsWith('.txt'))` —— 于是 `robots.txt`
   * 也被收了进来，判据因为**自己的探针**变红，而站点其实是好的
   * （同一时刻 `curl` 那枚键文件回 200 / 32 字节 / 内容逐字一致）。
   * 这类"红的不是被测对象"的假红，正是本仓库元规则 1 的那一格。
   */
  const keyFiles = readdirSync(publicDir)
    .filter((f) => f.endsWith('.txt'))
    .filter((f) => readFileSync(`${publicDir}${f}`, 'utf8').trim() === f.replace(/\.txt$/, ''));
  expect(
    keyFiles.length,
    `apps/landing/public/ 下"内容等于自己文件名"的 .txt 应当恰好一枚（那就是 IndexNow 键文件），实际：[${keyFiles.join(', ')}]`,
  ).toBe(1);
  const name = keyFiles[0] ?? '';
  const localContent = readFileSync(`${publicDir}${name}`, 'utf8');

  const response = await request.get(`${ORIGIN}/${name}`, { maxRedirects: 0, failOnStatusCode: false });
  expect(
    response.status(),
    `线上 /${name} 是 ${response.status()} —— 它必须是一个真文件：404 意味着没发出去或被路由规则吃掉了`,
  ).toBe(200);
  // 校验方普遍 trim()，所以比对用 trim：既容得下"两边都带换行"，也抓得住"内容被换了"。
  expect((await response.text()).trim()).toBe(localContent.trim());
});

/**
 * 平台给的**验证文件**必须线上可取，且**逐字**等于本机那一份。
 *
 * 🔴 这一类文件与仓库其他生成物**形状相反**：它们的**事实源是平台**，不是仓库里的常量。
 * ⇒ 不许加注释头、不许补结尾换行、不许"顺手格式化"；也**不进** `gen-entries.mjs` 的生成集，
 * 因此**没有** `check:entries` 的逐字节对账保护。代价就是每加一枚都要配一条判据 —— 这就是那条。
 *
 * 目前这一条覆盖 `BingSiteAuth.xml`（Bing 站长平台的 XML 文件验证）。
 * 将来百度的 `baidu_verify_*.html` 同一形状，照抄这段即可。
 */
test('平台验证文件线上可取且逐字一致（BingSiteAuth.xml / google*.html）', async ({ request }) => {
  const publicDir = fileURLToPath(new URL('../../apps/landing/public/', import.meta.url));
  /**
   * 遍历**所有**平台验证文件（而不是写死一个名字）：这样将来多一枚就自动被覆盖，
   * 不会出现"加了文件但判据还在测上一个"。断言 >= 2 是钉住"Bing 与 GSC 两枚都在"。
   */
  const names = readdirSync(publicDir).filter(
    (f) => f === 'BingSiteAuth.xml' || /^google[0-9a-f]+\.html$/.test(f),
  );
  expect(
    names.length,
    `平台验证文件至少要有 Bing 与 GSC 两枚，实际只找到：[${names.join(', ')}]`,
  ).toBeGreaterThanOrEqual(2);

  for (const name of names) {
    const local = readFileSync(`${publicDir}${name}`, 'utf8');
    const response = await request.get(`${ORIGIN}/${name}`, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect(
      response.status(),
      `线上 /${name} 是 ${response.status()} —— 它必须是一个真文件（404 = 没发出去，或被路由规则吃掉了）`,
    ).toBe(200);
    // 校验方普遍 trim()，所以比对用 trim：既容得下"两边都带换行"，也抓得住"内容被换了"。
    expect((await response.text()).trim(), `/${name} 的线上内容与本机不一致`).toBe(local.trim());
  }
});

test('robots.txt 指路正确，且 /app/ 被挡住', async ({ request }) => {
  const robots = await raw(request, '/robots.txt');
  expect(robots.status).toBe(200);
  expect(robots.body).toContain('User-agent: *');
  expect(robots.body).toContain('Allow: /');
  // 应用本体是私有 SPA：没有账号的人打开只有登录页，抓它只会浪费抓取预算。
  expect(robots.body).toContain('Disallow: /app/');
  // Sitemap 必须是**绝对地址**（相对地址爬虫解析不了）。
  expect(robots.body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
});

/**
 * ⚠️ **这一条在落地页发布之前是红的，而且那是设计好的信号。**
 *
 * `og:locale:alternate` 与 hreflang 说的是同一件事（这一页还有另一种语言），
 * 但出口不同：hreflang 给搜索引擎，这一条给**分享卡片的抓取器**
 * （Facebook / Slack / 微信读 OG，不读 hreflang）。
 *
 * 它在 2026-10-19 加进 `entry-template.html`，**要重新发布落地页才会到线上**。
 * 所以这条红可能的两个原因，处置方式完全不同：
 *   · 落地页还没发布（最常见）→ 按 deployment §3.7 重新发布；
 *   · 发布了但仍是红的 → 生成器没接上那个替换位，去 `gen-entries.mjs` 的
 *     `ogLocaleAlternateFor()` 查（`apps/landing/tests/seo-head.spec.ts` 里
 *     有一条同名的**离线**判据，它会先红）。
 */
test('og:locale:alternate 声明了另一种语言（发布落地页之后才会绿）', async ({ request }) => {
  const zh = await raw(request, '/features/');
  const en = await raw(request, '/en/features/');
  for (const [label, page, expected] of [
    ['中文页', zh, 'en_US'],
    ['英文页', en, 'zh_CN'],
  ] as const) {
    expect(
      page.body,
      `${label} 没有 og:locale:alternate —— 若刚改过 entry-template.html，先确认落地页发布了没有（deployment §3.7）`,
    ).toContain(`<meta property="og:locale:alternate" content="${expected}" />`);
  }
});
