import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { pageRoutes } from '../src/pages';
import { SERVER_COPY, type ServerCopyKey } from '../src/copy.generated';
import { EMAIL_COLOR } from '../src/design.generated';
import { MIN_PASSWORD_CODE_POINTS, MAX_PASSWORD_CODE_POINTS } from '../src/password/policy';

/**
 * 第四张凭据页 `/reset-password`（`server/src/pages.ts`）。
 *
 * 这一页是 W3 那三条路由唯一**面向人**的出口：重置邮件里的链接就指向它，
 * 页面不存在时整条"忘记密码"流程断在一个 404 上 —— 所以这里钉的都是
 * "用户能不能安全地走完这一步"，不是样式。
 *
 * 1. 🔴 **GET 绝不消费令牌**（ADR-0039 §2.2 同一个理由：邮件客户端的预取会在用户
 *    点之前把一次性链接烧掉）。这条只能从**结构**上钉 —— 处理器里压根不许出现
 *    消费令牌的那次调用。
 * 2. 🔴 一次性令牌要拼进 HTML 属性 ⇒ **必须过 `escapeHtml`**。这不是假想敌：
 *    令牌由攻击者可控的入口（`/forgot`）写进邮件，而链接会被第三方读到。
 * 3. 状态文案经 `data-*` 下发，页面里**不许出现服务端那句英文 API 话术**
 *    （`/verify-email` 2026-09-30 就是因为它回显内部错误被改掉）。
 * 4. 词条里那两个数字（8 / 256）与服务端策略常量**必须对账** ——
 *    改了常量不改文案，用户就会按一句假规则去设密码。
 * 5. `autocomplete="new-password"` 与"没有 `maxlength`"是这一页的两条真实坑，
 *    各自钉一次（见处理器上的注释）。
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

/**
 * 取这一页的 `<style>`，并把**注释整段去掉**。
 *
 * 🔴 这不是整理格式：样式表里的注释写着被断言的那个字面串（`width: 100%`、
 *    `[hidden]` 都出现过），不剥注释的写法会先撞上解释、把"有一句说明"
 *    当成"有一条声明"。实测：一条变异因此看起来"没有让判据变红"。
 */
const styleOf = (body: string) =>
  body.slice(body.indexOf('<style>'), body.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');

describe('GET /reset-password：没有链接就不能开始', () => {
  it('缺 token ⇒ **400** + 那句"链接不完整"（中文默认）', async () => {
    const res = await get('/reset-password');
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('链接不完整：缺少必要的令牌。');
    expect(res.body).toContain('<html lang="zh-CN">');
  });

  it('缺 token 时按 Accept-Language 出英文那一句', async () => {
    const res = await get('/reset-password', 'en-US,en;q=0.9');
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(SERVER_COPY.en['server.page.tokenRequired']);
    expect(res.body).toContain('<html lang="en">');
  });

  it('🔴 GET 不消费令牌：处理器里不许出现 `resetPasswordWithToken`', () => {
    // 为什么是源码断言而不是行为断言：这一页**本来就不碰库**，
    // 所以"没有发生写"用 mock 数是永远为 0 的判据（§7 第 33 条：不能失败的判据
    // 只是装饰）。变异复现：在处理器里加一次 `await resetPasswordWithToken(...)` ⇒ 这条转红。
    const source = readFileSync(join(__dirname, '../src/pages.ts'), 'utf8');
    expect(source).not.toContain('resetPasswordWithToken');
    expect(source).not.toContain("from './password/recovery'");
  });
});

describe('表单本身：这一页最容易做错的两件事', () => {
  it('两个密码框 + `autocomplete="new-password"`，🔴 **没有** maxlength', async () => {
    const body = (await get('/reset-password?token=abc123')).body;
    expect((body.match(/type="password"/g) ?? []).length).toBe(2);
    expect((body.match(/autocomplete="new-password"/g) ?? []).length).toBe(2);
    // `maxlength` 按 UTF-16 计数，含 emoji 的口令会被**静默截断**成另一个口令；
    // 长度的唯一裁决者是服务端策略。
    expect(body).not.toContain('maxlength');
    // 也不能退化成 `autocomplete="on"`（那会让管理器把**旧密码**填进来）。
    expect(body).not.toContain('autocomplete="on"');
    expect(body).not.toContain('autocomplete="current-password"');
  });

  it('「显示 / 隐藏」挂在两个框上（aria-controls 指 pw 与 pw2）', async () => {
    const body = (await get('/reset-password?token=abc123')).body;
    expect(body).toContain('aria-controls="pw pw2"');
    expect(body).toContain('aria-pressed="false"');
  });

  it('脚本挂在 `</main>` **之后**（放 `<head>` 那次事故的形状）', async () => {
    const body = (await get('/reset-password?token=abc123')).body;
    expect(body).toContain('<script src="/reset-password.js"></script>');
    expect(body.indexOf('/reset-password.js')).toBeGreaterThan(body.indexOf('</main>'));
    expect(body.indexOf('/reset-password.js')).toBeGreaterThan(body.indexOf('<body'));
  });
});

describe('🔴 令牌是不可信输入：拼进属性前必须转义', () => {
  const HOSTILE = 'a"><svg onload=alert(1)>';

  it('原始串一个字符都不许出现在 HTML 里', async () => {
    const body = (await get(`/reset-password?token=${encodeURIComponent(HOSTILE)}`)).body;
    expect(body).not.toContain('<svg onload=alert(1)>');
    expect(body).not.toContain('a"><svg');
    // 转义后仍在（不是被丢弃）—— 用户拿着一个奇怪但真实的令牌也得能继续。
    expect(body).toContain('&quot;&gt;&lt;svg');
  });

  it('页内脚本从 `dataset.token` 读的是**解码后**的同一个串', async () => {
    // `escapeHtml` 把 `"` 变成 `&quot;`，浏览器解属性时又变回 `"` ⇒
    // 脚本拿到的与 URL 里的一致。这里钉的是"转义只作用于 HTML 层，不改变字节"。
    const body = (await get(`/reset-password?token=${encodeURIComponent('x&y"z')}`)).body;
    expect(body).toContain('data-token="x&amp;y&quot;z"');
  });
});

describe('状态文案的通道：只有 data-*，没有服务端内部话术', () => {
  const ATTRS = [
    'data-msg-busy',
    'data-msg-success',
    'data-msg-mismatch',
    'data-msg-invalid-link',
    'data-policy-too-short',
    'data-policy-too-long',
    'data-policy-too-common',
    'data-policy-breached',
    'data-msg-locked',
    'data-msg-unavailable',
    'data-msg-unknown',
    'data-label-reveal',
    'data-label-hide',
  ];

  it('十三个属性一个不少（脚本对每个状态都说得出本地化的一句）', async () => {
    const body = (await get('/reset-password?token=abc123')).body;
    for (const attr of ATTRS) expect(body).toContain(attr);
  });

  it('🔴 中文版里不许出现 API 那几句英文话术', async () => {
    const body = (await get('/reset-password?token=abc123')).body;
    expect(body).not.toMatch(/Your password has been reset\. Sign in/i);
    expect(body).not.toMatch(/does not meet the requirements/i);
    expect(body).not.toMatch(/Invalid credentials/i);
    // 而中文那一句必须在（阳性对照：不是"整个 data-* 都没渲染"）
    expect(body).toContain(SERVER_COPY['zh-CN']['server.page.reset.success']);
  });

  it('成功后这句不许读成"你已经登录了"（ADR-0040 的措辞半边）', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      const text = SERVER_COPY[locale]['server.page.reset.success'];
      expect(text).not.toMatch(/已(经)?登录|signed in successfully|you are now logged in/i);
    }
  });
});

describe('词条里的数字与策略常量对账（改常量不改文案 = 一句假规则）', () => {
  const keys = ['server.page.reset.hint', 'server.page.reset.tooShort'] as const;

  it('两句都写着实际的 `MIN_PASSWORD_CODE_POINTS`', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      for (const key of keys) {
        expect(SERVER_COPY[locale][key]).toContain(String(MIN_PASSWORD_CODE_POINTS));
      }
    }
  });

  it('tooLong 写着实际的 `MAX_PASSWORD_CODE_POINTS`', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      expect(SERVER_COPY[locale]['server.page.reset.tooLong']).toContain(
        String(MAX_PASSWORD_CODE_POINTS),
      );
    }
  });

  it('reset.* 这一族在中英两份里**键集完全相同**（改词条必须中英同步）', () => {
    const keysOf = (locale: 'zh-CN' | 'en') =>
      Object.keys(SERVER_COPY[locale])
        .filter((k) => k.startsWith('server.page.reset.'))
        .sort();
    const zh = keysOf('zh-CN');
    expect(zh.length).toBeGreaterThan(15);
    expect(keysOf('en')).toEqual(zh);
  });

  it('四个策略码各有一句、且两两不同（合成一句用户不知道该改哪里）', () => {
    const codes = ['tooShort', 'tooLong', 'tooCommon', 'breached'] as const;
    const texts = codes.map(
      (c) => SERVER_COPY['zh-CN'][`server.page.reset.${c}` as ServerCopyKey],
    );
    expect(new Set(texts).size).toBe(4);
  });
});

describe('这一页仍然是那套蓝白（不是第二套样式系统）', () => {
  it('渲染出的 `<style>` 里每一个 6 位色值都出自 token 表', async () => {
    const style = styleOf((await get('/reset-password?token=abc123')).body);
    const hexes = style.match(/#[0-9a-fA-F]{6}/g) ?? [];
    expect(hexes.length).toBeGreaterThan(0);
    const allowed = new Set(Object.values(EMAIL_COLOR).map((v) => String(v).toLowerCase()));
    for (const hex of hexes) expect(allowed.has(hex.toLowerCase())).toBe(true);
    // 阳性对照：主蓝确实出现在这一页上（§7 第 82 条那条判据的同族）
    expect(hexes).toContain(EMAIL_COLOR['color.primary']);
  });

  it('零渐变', async () => {
    const body = (await get('/reset-password?token=abc123')).body;
    expect(body).not.toContain('gradient(');
  });

  it('输入框有可见焦点环（不是 `outline: none`）', async () => {
    const style = styleOf((await get('/reset-password?token=abc123')).body);
    const at = style.indexOf('.input:focus-visible');
    expect(at).toBeGreaterThan(-1);
    // 它和其他焦点选择器写在**同一个选择器列表**里，所以取紧跟其后的那一个声明块。
    const block = style.slice(style.indexOf('{', at), style.indexOf('}', at));
    expect(block).toMatch(/outline:\s*2px solid/);
    expect(style).not.toMatch(/outline:\s*none/);
  });

  /**
   * 这两条是**看截图**看出来的，不是读 HTML 读出来的（AGENTS §6.2 规定一）：
   * 结构断言全绿的一版里，确认框只有浏览器固有宽度（约 20 字符），
   * 和上面那个占满整行的输入框摆在一起就是一宽一窄。
   */
  it('两个输入框同宽：样式给 .input 定了宽度', async () => {
    const style = styleOf((await get('/reset-password?token=abc123')).body);
    const at = style.indexOf('.input {');
    expect(at).toBeGreaterThan(-1);
    const block = style.slice(style.indexOf('{', at), style.indexOf('}', at));
    expect(block).toMatch(/width:\s*100%/);
  });

  /**
   * 🔴 "隐藏"这一页上是一个**声明**而不是一句承诺。
   *
   * `[hidden] { display: none }` 来自 UA 样式表，作者样式里任何一条 `display`
   * 都会盖掉它 —— 而 `.btn` 正是 `display: inline-flex`。
   * 所以那个"成功后才出现的下一步按钮"在**没有守卫时会从第一帧就显示出来**，
   * 而 HTML 属性上看它仍然是 `hidden`：结构断言全绿，界面上是假的。
   */
  it('🔴 样式表里有 [hidden] 的 display 守卫（否则 .btn 的 hidden 是假的）', async () => {
    const style = styleOf((await get('/reset-password?token=abc123')).body);
    const at = style.indexOf('[hidden]');
    expect(at).toBeGreaterThan(-1);
    const block = style.slice(style.indexOf('{', at), style.indexOf('}', at));
    expect(block).toMatch(/display:\s*none\s*!important/);
  });
});

describe('成功之后：这一页不能是死路', () => {
  /**
   * 重置成功的用户手上**没有会话**（ADR-0040：持有收件箱不等于该拿到登录态），
   * 所以不能自动跳转。但"不跳"不等于"什么都不给" —— 得有一条他自己点的下一步。
   */
  it('下一步入口在表单**外面**（表单成功后整体收起，入口不能被一起收掉）', async () => {
    const body = (await get('/reset-password?token=abc123')).body;
    const at = body.indexOf('id="goLogin"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(body.indexOf('</form>'));
  });

  it('入口指向应用，且默认 `hidden`（成功前不许出现）', async () => {
    const body = (await get('/reset-password?token=abc123')).body;
    const start = body.indexOf('<a class="btn btn--primary" id="goLogin"');
    const anchor = body.slice(start, body.indexOf('>', start) + 1);
    expect(anchor).toContain('href="/app/"');
    expect(anchor).toMatch(/\shidden>$/);
    // 阳性对照：同一套"取标签"的写法用在提交按钮上必须**没有** hidden ——
    // 否则这条判据只是在描述整页都藏着，而不是在描述这一个元素。
    const btnStart = body.indexOf('<button type="submit"');
    const btn = body.slice(btnStart, body.indexOf('>', btnStart) + 1);
    expect(btn).not.toMatch(/hidden/);
  });

  it('中文与英文各有那句入口文案（中英同步）', () => {
    const zh = SERVER_COPY['zh-CN']['server.page.reset.goLogin' as ServerCopyKey];
    const en = SERVER_COPY['en']['server.page.reset.goLogin' as ServerCopyKey];
    expect(zh).toBe('去登录');
    expect(en).toBe('Sign in');
  });
});
