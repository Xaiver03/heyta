import { request } from 'node:https';
import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { Logger } from '../../src/logger';

/**
 * 🔴 账号语言 → 英文邮件的**真外发**端到端（`docs/plans/i18n-multilingual.md` §7.14 边界④）
 *
 * 这条不在默认套件里（`vitest.config.ts` 把 `tests/integration` 下的
 * `*.integration.spec.ts` 整目录排除），必须显式跑 —— 它会真的往外发一封信：
 *
 * ```bash
 * pnpm --filter @heyta/server test:integration:email-live
 * ```
 *
 * ## 为什么默认套件不跑它，而它仍值得存在
 *
 * 默认套件里的 `tests/email-locale-wire.spec.ts` 已经把"落件的字节是英文"钉住了
 * （真 SMTP 协议、本机回环收件器、三条变异）。它挡得住"路由查了账号语言但不用"
 * "渲染时丢了 locale""链接没写 `?lang=`"。
 *
 * 它挡不住的是**出站这一段**：真实 SMTP 服务是否收下、正文经不经得起一遍外部投递。
 * 这一段只能在有外发通道的机器上验，所以单独一条命令，跑完在输出里留下两个
 * 可点开的收件箱链接。
 *
 * ## 收件人是这台机器刚建的测试账号自己
 *
 * 用的是 `nodemailer` 的开发态兜底服务 Ethereal（也是 `server/src/email.ts` 在没配
 * SMTP 时**自己就会走**的那条路）：先建账号，再把信发给**那个账号自己的地址**。
 * 没有任何真人收件，正文里也不带用户数据（token 是常量假值、域名是 `heyta.test`）。
 *
 * ## 一处写错过、值得留下的事实
 *
 * API 宿主是 **`api.nodemailer.com`**（`nodemailer/lib/nodemailer.js:15` 的默认值），
 * **不是** `api.ethereal.email` —— 后者只是收件地址的域，TLS 握不上
 * （第一次探针因此拿到 `ECONNRESET`，读起来像"这台机器读不回来"，实际是探针指错了地址）。
 * 而消息的读取也没有列举端点：只能拿 `deliver()` 打出来的**预览 URL** 去取，
 * 页面里就是渲染好的正文。
 */

const CJK = /[㐀-䶿一-鿿豈-﫿]/g;

function httpsGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { 'user-agent': 'heyta-email-live-verify' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** 从 `deliver()` 的日志里接住预览 URL（它就是这封信的取件凭据）。 */
function capturePreviewUrls(): { urls: string[]; restore: () => void } {
  const urls: string[] = [];
  const real = Logger.info.bind(Logger);
  Logger.info = ((message: string, ...args: unknown[]) => {
    const hit = /Preview URL:\s*(\S+)/.exec(message);
    if (hit) urls.push(hit[1]);
    return real(message, ...args);
  }) as typeof Logger.info;
  return { urls, restore: () => (Logger.info = real) };
}

describe('账号语言 → 邮件语言：真外发并把两封都读回来', () => {
  it('发英文信 + 中文信 → 外发服务收下 → 读回来的正文语言各自正确', async () => {
    const account = await nodemailer.createTestAccount();
    console.log(`[live] 测试收件箱：${account.user}`);

    process.env.SMTP_HOST = account.smtp.host;
    process.env.SMTP_PORT = String(account.smtp.port);
    process.env.SMTP_SECURE = String(account.smtp.secure);
    process.env.SMTP_USER = account.user;
    process.env.SMTP_PASS = account.pass; // 只进环境变量，不打印
    process.env.SMTP_FROM = `"heyta" <${account.user}>`;
    process.env.PUBLIC_URL = 'https://heyta.test';

    const { __resetMailTransporterForTests, sendLoginMagicLinkEmail } = await import('../../src/email');
    __resetMailTransporterForTests();

    const capture = capturePreviewUrls();
    try {
      // 两封都走**产品自己的发信函数**，只有 locale 不同。
      expect(await sendLoginMagicLinkEmail(account.user, 'tok-live-en', 'en')).toBe(true);
      expect(await sendLoginMagicLinkEmail(account.user, 'tok-live-zh', 'zh-CN')).toBe(true);
    } finally {
      capture.restore();
    }

    expect(capture.urls, '外发服务没给回预览 URL ⇒ 这封信没被收下').toHaveLength(2);

    const read = [];
    for (const url of capture.urls) {
      const page = await httpsGet(url);
      expect(page.status, `预览页取不回来：${url}`).toBe(200);
      read.push({
        url,
        cjk: (page.body.match(CJK) ?? []).length,
        langEn: page.body.includes('lang=en'),
        langZh: page.body.includes('lang=zh-CN'),
        brand: (page.body.match(/heyta/g) ?? []).length,
      });
    }
    console.log('[live] 读回来：', JSON.stringify(read, null, 2));

    const en = read.filter((r) => r.cjk === 0 && r.langEn && !r.langZh);
    const zh = read.filter((r) => r.cjk > 0 && r.langZh);

    // 两向都钉：只钉"英文那封是英文"的话，一封"永远发中文"的实现照样绿。
    expect(en, '没有一封是纯拉丁正文 + lang=en').toHaveLength(1);
    expect(zh, '没有一封含中文正文 + lang=zh-CN').toHaveLength(1);
    for (const r of read) expect(r.brand, '正文里没有产品名（品牌串丢了）').toBeGreaterThan(0);
  }, 120_000);
});
