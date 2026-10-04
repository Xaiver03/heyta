/**
 * 线上 `/app/` 的 **PWA 资产真身**判据（G-60 的判据半边）。
 * ==================================================================
 *
 * 它回答的是"我们托管的那一套，有没有把清单当清单给出去"，
 * 而**不是**"这个 Web 应用可安装" —— 后者需要真实的安装提示读数
 * （`beforeinstallprompt` 或浏览器的安装入口），这条用例给不出，也不主张。
 *
 * ## 为什么值得单独一条
 *
 * 自托管那侧早就断言过清单的类型（`e2e/selfhost-stack/selfhost-web.spec.ts:220`，
 * `application/manifest+json`），而**线上那侧一条都没有**。2026-10-04 现量：
 *
 * ```
 * /app/manifest.webmanifest  200  application/octet-stream   2361 B
 * ```
 *
 * 根因与台账里那条 `.wasm` 是同一个（这台机器的 nginx 1.18.0 的
 * `/etc/nginx/mime.types` 既没有 `wasm` 也没有 `webmanifest`），只是后果轻一档：
 * 浏览器的安装性判据里**没有** content-type 这一条，所以它不挡安装，
 * 但会让人在"清单/控制台"面板里看见报错 —— 与 §7 那一族"不报错就不管、
 * 打开面板才看得见"同一个形状。更要紧的是：**外人自建的那套与我们这套给了两个答案**，
 * 而用户照着我们的文档排查时会撞见"我这边和官方那边不一样"。
 *
 * ## 这条判据的两腿（`expect(!负面读数)` 那种写法不算证据）
 *
 * 同一段判定代码分别喂**真清单路径**与**已知会被 SPA 兜底成 HTML 的路径**
 * （`/app/site.webmanifest` 并不存在，`location /app/` 的 `try_files` 让它答 200 + 应用 HTML）。
 * 两腿必须分别给出 `true` 与 `false` —— 否则这条判据挡不住"状态码 200 就当资产在"那一族。
 */

import { expect, test } from '@playwright/test';

const ORIGIN = process.env['HEYTA_LIVE_ORIGIN'] ?? 'https://heyta.waytofuture.cn';

/**
 * 「这条响应是不是被当成清单给出去的」—— 判据本体，两腿共用同一份代码。
 *
 * 🔴 只看状态码不够：未命中的 `/app/*` 会由 SPA 兜底答 **200 + HTML**，
 * 而浏览器拿着那份 HTML 只会报"清单语法错误"，用户看到的是"装不上"。
 */
function servedAsManifest(contentType: string, bodyText: string): boolean {
  const type = contentType.toLowerCase();
  if (!type.includes('application/manifest+json')) return false;
  // 类型对了还得真的是 JSON —— 挡"类型写对了但内容是壳"这一发。
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

test('线上 /app/manifest.webmanifest 以 manifest+json 给出，且清单字段齐（不主张可安装）', async ({
  request,
}) => {
  const res = await request.get(new URL('/app/manifest.webmanifest', ORIGIN).href);
  expect(res.ok(), `清单必须 200，实际 ${res.status()}`).toBe(true);
  const ct = res.headers()['content-type'] ?? '';
  const text = await res.text();
  expect(
    servedAsManifest(ct, text),
    `清单要由服务端以 application/manifest+json 给出（实际 content-type="${ct}"）。` +
      `这条在 2026-10-04 之前是红的：这台机器的 nginx 缺 webmanifest 那一条，答的是 octet-stream。`,
  ).toBe(true);

  const m = JSON.parse(text) as {
    name?: string;
    short_name?: string;
    start_url?: string;
    display?: string;
    prefer_related_applications?: boolean;
    icons?: { sizes?: string; type?: string; src?: string }[];
  };
  // 下面四条是浏览器（Chromium 口径）对**清单内容**的要求本身，逐条都要有名字，
  // 免得"清单能解析"被读成"清单够了"。
  expect(m.name || m.short_name, '清单要有 name 或 short_name').toBeTruthy();
  expect(m.start_url, '清单要有 start_url').toBeTruthy();
  expect(m.display, '清单要有 display').toBeTruthy();
  const sizes = (m.icons ?? []).map((i) => i.sizes ?? '');
  expect(sizes, `清单图标要含 192x192 与 512x512，实际：${sizes.join(', ')}`).toContain('192x192');
  expect(sizes).toContain('512x512');
  expect(
    m.prefer_related_applications === true,
    'prefer_related_applications 不许是 true（那是"用原生应用代替网页安装"，会让浏览器不再推网页装入口）',
  ).toBe(false);
});

test('同一枚判据的两腿：真清单为 true，被 SPA 兜底成 HTML 的路径必须为 false', async ({
  request,
}) => {
  const real = await request.get(new URL('/app/manifest.webmanifest', ORIGIN).href);
  const fallback = await request.get(new URL('/app/site.webmanifest', ORIGIN).href);

  const realLeg = servedAsManifest(real.headers()['content-type'] ?? '', await real.text());
  const fallbackLeg = servedAsManifest(
    fallback.headers()['content-type'] ?? '',
    await fallback.text(),
  );

  expect(realLeg, '正向腿：真清单路径必须判为 true').toBe(true);
  // 🔴 这一条是判据的牙：兜底路径**也是 200**，如果判据只看状态码它就恒绿。
  expect(fallback.status(), '反向腿的现场：未命中的 /app/* 确实答 200（所以才不许用状态码当判据）').toBe(
    200,
  );
  expect(
    fallbackLeg,
    '反向腿：已知会被 try_files 兜底成应用 HTML 的路径必须判为 false' +
      `（实际 content-type="${fallback.headers()['content-type'] ?? ''}"）`,
  ).toBe(false);
});

test('清单点名的每一项资产都要拿到真身（类型算判据，状态码不算）', async ({ request }) => {
  const res = await request.get(new URL('/app/manifest.webmanifest', ORIGIN).href);
  const m = (await res.json()) as { icons?: { src?: string }[] };
  // 🔴 枚举源是**清单自己**，不是我抄的一张名字表：清单加一枚图标，这条就自动多查一枚；
  //    清单少一枚，它不会替我留着一条已经不存在的断言。
  const srcs = (m.icons ?? []).map((i) => i.src ?? '').filter((s) => s.length > 0);
  expect(srcs.length, '清单要至少点名一枚图标（点名表为空时下面那条遍历会静默不执行）').toBeGreaterThan(
    0,
  );
  for (const src of srcs) {
    // 清单里的 src 是相对清单自己的（`icons/icon-192.png`），相对 `/app/` 解析。
    const asset = await request.get(new URL(src, new URL('/app/', ORIGIN).href).href);
    const ct = (asset.headers()['content-type'] ?? '').toLowerCase();
    expect(asset.ok(), `清单点名的 ${src} 必须拿得到，实际状态 ${asset.status()}`).toBe(true);
    expect(
      ct.startsWith('image/'),
      `${src} 要以图片类型给出（拿到 HTML 就说明它其实是 SPA 兜底），实际 "${ct}"`,
    ).toBe(true);
  }

  const sw = await request.get(new URL('/app/sw.js', ORIGIN).href);
  expect(
    (sw.headers()['content-type'] ?? '').toLowerCase(),
    `SW 要以 JS 给出，注册才不会当场语法报错，实际状态 ${sw.status()} 类型 "${
      sw.headers()['content-type'] ?? ''
    }"`,
  ).toMatch(/javascript/);
});
