import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMAIL_COLOR } from '../src/design.generated.js';
import { renderEmail, renderEmailText, renderPage, resolveLocale } from '../src/design-html.js';
import { SERVER_COPY } from '../src/copy.generated.js';

/**
 * 服务端面向用户的产物（邮件 / 凭据页）的**三条硬要求**。
 *
 * 这三条都是产品要求，不是风格偏好：
 *
 *   1. **默认中文**，并按收件人语言切换中英文；
 *   2. **用设计系统** —— 颜色/间距/字体一律来自 token，产物里**没有裸色值**；
 *   3. **严禁任何渐变**。
 *
 * 下面对每一条都给出**能因变异而转红**的判据，而不是"读过觉得对"。
 */

vi.mock('../src/auth', () => ({
  verifyEmail: vi.fn().mockResolvedValue(undefined),
}));

const EMAIL_ARGS = {
  title: 'T',
  heading: 'H',
  body: 'B',
  buttonLabel: 'Go',
  url: 'https://example.test/x',
};

describe('🔴 一、默认中文，按 locale 切换', () => {
  it('renderEmail 的中文版含中文文案、不含英文那一句', () => {
    const zh = renderEmail('zh-CN', {
      ...EMAIL_ARGS,
      heading: SERVER_COPY['zh-CN']['server.email.verify.title'],
      body: SERVER_COPY['zh-CN']['server.email.verify.body'],
    });
    const en = renderEmail('en', {
      ...EMAIL_ARGS,
      heading: SERVER_COPY['en']['server.email.verify.title'],
      body: SERVER_COPY['en']['server.email.verify.body'],
    });

    expect(zh).toContain(SERVER_COPY['zh-CN']['server.email.verify.title']);
    expect(zh).not.toContain(SERVER_COPY['en']['server.email.verify.title']);
    expect(en).toContain(SERVER_COPY['en']['server.email.verify.title']);
    expect(en).not.toContain(SERVER_COPY['zh-CN']['server.email.verify.title']);
  });

  it('`<html lang>` 跟着 locale 走（读屏与搜索引擎靠它）', () => {
    expect(renderEmail('zh-CN', EMAIL_ARGS)).toContain('<html lang="zh-CN">');
    expect(renderEmail('en', EMAIL_ARGS)).toContain('<html lang="en">');
    expect(renderPage('en', { title: 't', heading: 'h', body: 'b' })).toContain('<html lang="en">');
  });

  it('纯文本版也是本地化的（不是"只有 HTML 翻了"）', () => {
    const zh = renderEmailText('zh-CN', EMAIL_ARGS);
    const en = renderEmailText('en', EMAIL_ARGS);
    expect(zh).toContain(SERVER_COPY['zh-CN']['server.email.common.autoNote']);
    expect(en).toContain(SERVER_COPY['en']['server.email.common.autoNote']);
    // 纯文本里不该出现 HTML 标签
    expect(zh).not.toContain('<');
  });

  it('🔴 resolveLocale 只认显式选择：没有 `?lang=` 一律中文（Accept-Language 已摘掉）', () => {
    // 显式：邮件链接里的 `lang=` 是**发信那一刻**用户语言的快照（`email.ts` 的 `withLocale`）。
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('zh-CN')).toBe('zh-CN');
    // 🔴 2026-10-03 产品负责人拍板：「默认应该是中文，除非用户登录之后改成了英文、
    //   或者一开始就选了英文」。浏览器语言不是选择。
    //   变异：把 `acceptLanguage` 参数与那条前缀匹配分支加回来 ⇒ 下面两条红。
    expect(resolveLocale(null)).toBe('zh-CN');
    expect(resolveLocale(undefined)).toBe('zh-CN');
    // 集合外的值退回默认，而不是崩掉
    expect(resolveLocale('fr')).toBe('zh-CN');
    expect(resolveLocale('')).toBe('zh-CN');
  });
});

describe('🔴 二、用设计系统：产物里没有裸色值', () => {
  /** 抽产物里出现的全部 `#rrggbb` / `#rrggbbaa`。 */
  const hexesIn = (html: string): string[] =>
    [...html.matchAll(/#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?/g)].map((m) => m[0].toLowerCase());

  const TOKEN_HEXES = new Set(
    Object.values(EMAIL_COLOR).map((v) => v.toLowerCase()),
  );

  it('邮件里的每一个色值都来自 token', () => {
    const html = renderEmail('zh-CN', EMAIL_ARGS);
    const hexes = hexesIn(html);
    expect(hexes.length, '邮件里一个色值都没有？那多半是模板坏了').toBeGreaterThan(0);

    const strays = [...new Set(hexes)].filter((h) => !TOKEN_HEXES.has(h));
    expect(
      strays,
      `邮件里出现了**不是设计 token** 的色值：${strays.join(', ')}\n` +
        '   ⇒ 模板里写裸 hex 了。取值必须来自 design.generated.ts。',
    ).toEqual([]);
  });

  it('凭据页里的每一个色值都来自 token', () => {
    const html = renderPage('zh-CN', { title: 't', heading: 'h', body: 'b' });
    const hexes = hexesIn(html);
    expect(hexes.length).toBeGreaterThan(0);

    const strays = [...new Set(hexes)].filter((h) => !TOKEN_HEXES.has(h));
    expect(strays, `凭据页里出现了非 token 色值：${strays.join(', ')}`).toEqual([]);
  });

  it('用的是设计系统的字体栈（含中文字体回退）', () => {
    const html = renderEmail('zh-CN', EMAIL_ARGS);
    // 中文环境下必须能落到中文字体，否则中文会用系统兜底字体渲染
    expect(html).toContain('PingFang SC');
    expect(html).toContain('Microsoft YaHei');
  });
});

describe('🔴 三、严禁任何渐变', () => {
  it('邮件里没有 gradient', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      expect(renderEmail(locale, EMAIL_ARGS).toLowerCase()).not.toContain('gradient');
    }
  });

  it('凭据页里没有 gradient', () => {
    expect(
      renderPage('zh-CN', { title: 't', heading: 'h', body: 'b' }).toLowerCase(),
    ).not.toContain('gradient');
  });

  it('设计 token 快照里也没有 gradient（生成脚本会在这一层断言）', () => {
    const values = Object.values(EMAIL_COLOR).join(' ').toLowerCase();
    expect(values).not.toContain('gradient');
  });
});

describe('凭据页：本地化 + 语言随链接走', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const build = async (): Promise<FastifyInstance> => {
    const { pageRoutes } = await import('../src/pages.js');
    const instance = Fastify();
    await instance.register(pageRoutes, { prefix: '/' });
    await instance.ready();
    return instance;
  };

  it('缺令牌 ⇒ 400 + 中文页面（默认语言）', async () => {
    app = await build();
    const response = await app.inject({ method: 'GET', url: '/magic-login' });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain(SERVER_COPY['zh-CN']['server.page.tokenRequired']);
  });

  it('`?lang=en` ⇒ 同一张页面变英文', async () => {
    app = await build();
    const response = await app.inject({ method: 'GET', url: '/magic-login?lang=en' });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(SERVER_COPY['en']['server.page.tokenRequired']);
    expect(response.body).toContain('<html lang="en">');
  });

  it('🔴 `Accept-Language: en` **不再切换** —— 没有显式 `?lang=` 就是中文', async () => {
    // 原句（2026-10-01 起）：「`Accept-Language: en` 也能切（没带 ?lang= 时的兜底）」。
    // 2026-10-03 产品负责人改判：「默认应该是中文，除非用户登录之后改成英文、
    // 或者一开始就选了英文」—— 浏览器语言不是选择。这条断言因此**反向**。
    // 变异：把 `resolveLocale` 的 acceptLanguage 分支加回来 ⇒ 这条红。
    app = await build();
    const response = await app.inject({
      method: 'GET',
      url: '/magic-login',
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });

    expect(response.body).toContain(SERVER_COPY['zh-CN']['server.page.tokenRequired']);
    expect(response.body).toContain('<html lang="zh-CN">');
    expect(response.body).not.toContain(SERVER_COPY['en']['server.page.tokenRequired']);
  });

  it('🔴 页内脚本的文案经 data-* 下发，脚本里不写死任何一句', async () => {
    app = await build();
    const response = await app.inject({ method: 'GET', url: '/magic-login?token=abc' });

    expect(response.statusCode).toBe(200);
    // 静态 JS 取不到词条表 ⇒ 文案必须由页面下发，否则切语言时这一页会半中半英。
    expect(response.body).toContain('data-msg-busy=');
    expect(response.body).toContain('data-msg-error=');
    expect(response.body).toContain('data-token="abc"');
    expect(response.body).toContain(SERVER_COPY['zh-CN']['server.page.login.busy']);
  });

  it('恢复通行密钥页把状态文案也下发（它是四条状态的那一页）', async () => {
    app = await build();
    const response = await app.inject({ method: 'GET', url: '/recover-passkey?token=abc' });

    expect(response.statusCode).toBe(200);
    for (const key of [
      'server.page.recover.busy',
      'server.page.recover.waiting',
      'server.page.recover.verifying',
      'server.page.recover.success',
      'server.page.recover.error',
    ] as const) {
      expect(response.body).toContain(SERVER_COPY['zh-CN'][key]);
    }
  });
});

describe('🔴 页内脚本的加载位置（2026-09-30 用户实测报障的回归判据）', () => {
  /**
   * 这条判据来自一次**真实报障**：用户点了邮件里的登录链接，
   * 页面出来了、按钮却**点了完全没反应**，控制台报
   *
   * ```
   * magic-login-confirm.js:15 Uncaught TypeError:
   *   Cannot read properties of null (reading 'dataset')
   * ```
   *
   * 根因：`renderPage` 把 `<script>` 渲染在了 **`<head>`** 里，而且没有 `defer`。
   * 没有 `defer` 的脚本在 `<head>` 里是**同步执行**的 —— 那一刻 `<body>` 还没被解析，
   * `document.body` 是 `null`，脚本第一行的 `document.body.dataset.token` 直接抛错。
   *
   * 判据就一句：**脚本必须在 `<body>` 之内、且在 `</body>` 之前**。
   * 这一条能把"放回 head"这种回退当场抓住。
   */
  const scriptPosition = (html: string): { bodyStart: number; script: number; bodyEnd: number } => ({
    bodyStart: html.indexOf('<body'),
    script: html.indexOf('<script'),
    bodyEnd: html.indexOf('</body>'),
  });

  it('renderPage：脚本在 <body> 之内且在 </body> 之前', () => {
    const html = renderPage('zh-CN', {
      title: 't',
      heading: 'h',
      body: 'b',
      scripts: ['/some-script.js'],
    });
    const pos = scriptPosition(html);

    expect(pos.bodyStart, '页面里没有 <body>？').toBeGreaterThan(-1);
    expect(pos.script, '页面里没有 <script> —— 这条判据就失去了对象').toBeGreaterThan(-1);
    expect(
      pos.script,
      '脚本出现在 <body> 之前 ⇒ 它会在 <head> 里同步执行，此时 document.body 是 null，\n' +
        '   页内脚本第一行就会抛 TypeError，用户看到的是"按钮点了没反应"。',
    ).toBeGreaterThan(pos.bodyStart);
    expect(pos.script, '脚本出现在 </body> 之后 —— 浏览器会忽略它').toBeLessThan(pos.bodyEnd);
  });

  it('实际路由（/magic-login）出来的页面同样满足', async () => {
    const { pageRoutes } = await import('../src/pages.js');
    const instance = Fastify();
    await instance.register(pageRoutes, { prefix: '/' });
    await instance.ready();

    const response = await instance.inject({ method: 'GET', url: '/magic-login?token=abc' });
    const pos = scriptPosition(response.body);

    expect(pos.script).toBeGreaterThan(pos.bodyStart);
    expect(pos.script).toBeLessThan(pos.bodyEnd);
    // 顺带钉住"属性注入没把 body 标签搞坏"
    expect(response.body).toContain('data-token="abc"');

    await instance.close();
  });
});
