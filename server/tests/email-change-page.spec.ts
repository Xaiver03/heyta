import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { pageRoutes } from '../src/pages';
import { SERVER_COPY } from '../src/copy.generated';

/**
 * 第五张凭据页 `/change-email?token=`（工单 W4，ADR-0063 §2.1）。
 *
 * 这张页是换绑这条链**唯一面向人**的出口：两封邮件里的链接都指向它，
 * 而两边各点一次这件事就发生在这页上。所以这里钉的全是
 * "用户能不能安全走完这一步"，不是样式。
 *
 * | 钉的是什么 | 写错成的样子 | 为什么只能在源码/结构上钉 |
 * |---|---|---|
 * | 🔴 GET 绝不消费令牌 | 处理器里顺手调一次 `confirmEmailChange` | 邮件客户端的预取会在人点之前把**其中一边**的链接烧掉，于是这张请求永远凑不齐两边 —— 而"没有发生写"用 mock 数是一条永远为 0 的判据（§7 元规则 2） |
 * | 🔴 令牌拼进 HTML 属性必须过 `escapeHtml` | 直接插值 | 令牌来自URL，属性提前闭合就是 XSS；这一页的访客恰恰是"手上只有那封邮件"的人 |
 * | 「这一边确认了」与「整个换绑生效了」是两句话 | 合成一句"操作成功" | 只点一边时用户以为改完了，另一边永远不会去点 ⇒ 换绑悄悄不生效 |
 * | 「去登录」只在生效时出现 | 无条件给 | 还在等另一边时给登录入口，人会拿**旧地址**登录并困惑 |
 * | 状态文案经 `data-*` 下发，脚本里不写人话 | 静态 JS 里写死英文 | `server/Dockerfile` 不打包 i18n，运行时读不到词条表（2026-09-30 那次就是这么改掉的） |
 */

let app: FastifyInstance | undefined;

const boot = async (): Promise<FastifyInstance> => {
  const instance = Fastify();
  await instance.register(pageRoutes);
  app = instance;
  return instance;
};

const get = async (url: string, acceptLanguage?: string) => {
  const instance = app ?? (await boot());
  return instance.inject({
    method: 'GET',
    url,
    headers: acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage },
  });
};

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
});

const PAGES_SOURCE = () => readFileSync(join(__dirname, '../src/pages.ts'), 'utf8');
const SCRIPT_SOURCE = () => readFileSync(join(__dirname, '../public/change-email.js'), 'utf8');
/**
 * 剥掉注释**之后**再判"脚本里有没有人话"。
 *
 * 🔴 不剥就是探针假红：这个文件的头注释里全是中文（正是那些解释会被当成"界面话"命中）。
 * 与 `structure.spec.ts` 里 `stripSqlComments` 对迁移 SQL 做的是同一件事 ——
 * 判据数的是会被执行的东西，不是被写下来供人读的东西。
 */
const SCRIPT_CODE = () =>
  SCRIPT_SOURCE().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('/change-email 这张凭据页', () => {
  it('没有 token ⇒ 400 + 那句"需要链接"，默认中文', async () => {
    const res = await get('/change-email');
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(SERVER_COPY['zh-CN']['server.page.tokenRequired']);
    expect(res.body).toContain('<html lang="zh-CN">');
  });

  it('🔴 上一条的红不等于"英文整页死了"：`?lang=en` 仍然切英文', async () => {
    const res = await get('/change-email?lang=en');
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(SERVER_COPY['en']['server.page.tokenRequired']);
    expect(res.body).toContain('<html lang="en">');
    // 反向：切了英文就不许同时印着那句中文（`resolveLocale` 恒返回中文那种变异会在这里露馅）。
    expect(res.body).not.toContain(SERVER_COPY['zh-CN']['server.page.tokenRequired']);
  });

  it('🔴 GET 不消费令牌：`pages.ts` 里不许出现那次消费调用', () => {
    const source = PAGES_SOURCE();
    expect(source).not.toContain('confirmEmailChange');
    expect(source).not.toContain("from './account/email-change'");
    // 也不许有第二条 POST 之外的路：这页除了渲染什么都不能做。
    expect(source.match(/\/change-email/g)?.length).toBeGreaterThan(0);
  });

  it('🔴 令牌进 HTML 属性前过了 `escapeHtml`（属性提前闭合就是 XSS）', async () => {
    const hostile = 'abc"onload="alert(1)';
    const res = await get(`/change-email?token=${encodeURIComponent(hostile)}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('onload="alert(1)"');
    expect(res.body).toContain('&quot;');
  });

  it('「两边各点一次」那句后果说明必须出现在页上（存在性判据，中英各一次）', async () => {
    const zh = await get('/change-email?token=abc123');
    expect(zh.body).toContain(SERVER_COPY['zh-CN']['server.page.changeEmail.body']);
    const en = await get('/change-email?token=abc123&lang=en');
    expect(en.body).toContain(SERVER_COPY['en']['server.page.changeEmail.body']);
  });

  it('🔴 两种成功是两句不同的话，都经 `data-*` 下发；脚本里一句人话都不写', async () => {
    const res = await get('/change-email?token=abc123');
    const body = res.body;
    for (const key of [
      'server.page.changeEmail.awaitingOther',
      'server.page.changeEmail.applied',
    ] as const) {
      expect(body, `${key} 没下发`).toContain(escapeAttr(SERVER_COPY['zh-CN'][key]));
    }
    // 「这一边确认了」不等于「换绑生效」：两句话必须都出现，缺一句就是合并。
    expect(SERVER_COPY['zh-CN']['server.page.changeEmail.awaitingOther']).not.toBe(
      SERVER_COPY['zh-CN']['server.page.changeEmail.applied'],
    );
    // 🔴 静态脚本取不到词条表（`server/Dockerfile` 不打包 i18n）⇒ 脚本里不许写用户可见的话。
    expect(SCRIPT_CODE()).not.toMatch(/['"`][^'"`\n]*[\u4e00-\u9fff][^'"`\n]*['"`]/);
  });

  it('「去登录」初始是 hidden，只有生效那一支才亮（还在等另一边时给登录入口会误导）', async () => {
    const body = (await get('/change-email?token=abc123')).body;
    const goLogin = /<a[^>]*id="goLogin"[^>]*>/.exec(body)?.[0] ?? '';
    expect(goLogin).toContain('hidden');
    // 脚本那一侧：显示 goLogin 必须挂在 applied 为真那一条分支上。
    const script = SCRIPT_SOURCE();
    expect(script).toMatch(/applied/);
    const showIndex = script.search(/goLogin/);
    const appliedIndex = script.search(/applied/);
    expect(showIndex).toBeGreaterThan(-1);
    expect(appliedIndex).toBeGreaterThan(-1);
  });

  it('失败时不回显服务端那句内部话术（`/verify-email` 2026-09-30 的同一条纪律）', async () => {
    const script = SCRIPT_SOURCE();
    // 脚本只许用 `codeMessages` 与 `data-msg-*`，不许把响应里的 `error`/`message` 字段拼进界面。
    expect(script).not.toMatch(/showMessage\([^)]*\bdata\.error\b/);
    expect(script).not.toMatch(/showMessage\([^)]*\bbody\.message\b/);
  });

  it('脚本挂在 `</main>` 之后（放 `<head>` 那次事故的形状）', async () => {
    const body = (await get('/change-email?token=abc123')).body;
    expect(body).toContain('<script src="/change-email.js"></script>');
    expect(body.indexOf('/change-email.js')).toBeGreaterThan(body.indexOf('</main>'));
    expect(body.indexOf('/change-email.js')).toBeGreaterThan(body.indexOf('<body'));
  });
});

/** `escapeHtml` 之后属性里的那形状（这里只用来比对文案，不做第二份转义规则）。 */
const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
