import { FastifyInstance } from 'fastify';
import { Logger } from './logger';
import { escapeHtml, renderPage, resolveLocale, t } from './design-html.js';

// Error response helper
const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'Unknown error';

interface VerifyEmailQuery {
  token?: string;
  lang?: string;
}

interface RecoverPasskeyQuery {
  token?: string;
  lang?: string;
}

interface MagicLoginQuery {
  token?: string;
  lang?: string;
}

interface ResetPasswordQuery {
  token?: string;
  lang?: string;
}

/**
 * 成功的小对勾。
 *
 * 🔴 内联 SVG 而不是 `✓` 字符或 emoji：AGENTS §5 明确禁止 emoji 当图标
 * （跨平台渲染不一致、不受 token 控制），而字符对勾的字形在不同字体里差别也很大。
 */
const OK_ICON =
  '<svg class="ok-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
  'aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

export async function pageRoutes(fastify: FastifyInstance) {
  /**
   * 🔴 三张页面都从**同一个**地方取语言：URL 里的 `?lang=` 优先，
   * 其次 `Accept-Language`，都没有就**中文**（`resolveLocale` 的兜底）。
   *
   * 邮件在发信时就把 `lang` 写进了链接，所以点进来的人看到的
   * 就是收信那一刻该看到的语言（见 `email.ts` 的 `withLocale`）。
   */
  const localeOf = (req: { query: { lang?: string }; headers: Record<string, unknown> }) =>
    resolveLocale(req.query.lang, typeof req.headers['accept-language'] === 'string'
      ? req.headers['accept-language']
      : null);

  fastify.get<{ Querystring: VerifyEmailQuery }>(
    '/verify-email',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const locale = localeOf(req);

      try {
        const { token } = req.query;
        if (!token) {
          return reply.status(400).type('text/html').send(
            renderPage(locale, {
              title: t(locale, 'server.page.verify.failedTitle'),
              heading: t(locale, 'server.page.verify.failedTitle'),
              body: t(locale, 'server.page.tokenRequired'),
            }),
          );
        }

        /**
         * 🔴 **GET 绝不消费令牌**（2026-09-30 改，ADR-0039 §2.2 / §3.2）。
         *
         * 原实现是 `await verifyEmail(token)` —— 于是在**用户点之前**，
         * 邮件客户端的链接预取（Outlook SafeLinks、Gmail 预览）就能替他把令牌烧掉，
         * 用户点进来只看到"链接已失效"。`/magic-login` 从一开始就是两步式
         * （GET 渲染、POST 消费），它的脚本头注释里就写着这条理由 ——
         * 而 `/verify-email` 一直没有对齐。
         *
         * 现在两个页面：**同一个确认脚本、同一个校验端点**（`/api/auth/email/verify`），
         * 于是"注册那封邮件点一下也直接进去"（ADR-0039 §2.2）。
         *
         * ⚠️ 文案暂复用 `verify.*` / `login.*`（贴切度一般：注册链接会说"完成这次登录"）。
         *    它**不是**漏掉，是明确记在 ADR-0039 §3 的跟进项里 —— 专用 key 属文案改动。
         */
        const bodyAttrs = [
          `data-token="${escapeHtml(token)}"`,
          `data-msg-busy="${escapeHtml(t(locale, 'server.page.login.busy'))}"`,
          `data-msg-success="${escapeHtml(t(locale, 'server.page.login.success'))}"`,
          `data-msg-error="${escapeHtml(t(locale, 'server.page.login.error'))}"`,
          // 🔴 通行密钥注册那条链接**不发会话** —— 它的话术必须与"登录成功"分开，
          //    否则界面会对用户说一件没发生的事（ADR-0039 §2.1 的 verified-only）。
          `data-msg-verified-only="${escapeHtml(t(locale, 'server.page.confirm.verifiedOnly'))}"`,
          `data-msg-unknown="${escapeHtml(t(locale, 'server.page.error.unknown'))}"`,
        ].join(' ');

        const page = renderPage(locale, {
          // ⚠️ 用 `confirm.*` 而**不是** `verify.*`：这一页出现在**点击之前**，
          //    写"邮箱验证成功"是说假话（2026-09-30 实测被测试抓到）。
          title: t(locale, 'server.page.confirm.title'),
          heading: t(locale, 'server.page.confirm.heading'),
          body: t(locale, 'server.page.confirm.body'),
          actions: [
            {
              label: t(locale, 'server.page.confirm.button'),
              id: 'login-btn',
              primary: true,
            },
          ],
          extraHtml:
            '<p class="status status--err" id="error" hidden></p>' +
            '<p class="status status--ok" id="success" hidden></p>',
          scripts: ['/magic-login-confirm.js'],
        });

        return reply
          .type('text/html')
          .send(page.replace('<body>', `<body ${bodyAttrs}>`));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Verify email page error: ${errMsg}`);
        return reply.status(400).type('text/html').send(
          renderPage(locale, {
            title: t(locale, 'server.page.verify.failedTitle'),
            heading: t(locale, 'server.page.verify.failedTitle'),
            body: t(locale, 'server.page.verify.failedBody'),
          }),
        );
      }
    },
  );

  // Passkey recovery page - allows user to register a new passkey
  fastify.get<{ Querystring: RecoverPasskeyQuery }>(
    '/recover-passkey',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const locale = localeOf(req);
      const { token } = req.query;
      if (!token) {
        return reply.status(400).type('text/html').send(
          renderPage(locale, {
            title: t(locale, 'server.page.recover.title'),
            heading: t(locale, 'server.page.recover.heading'),
            body: t(locale, 'server.page.tokenRequired'),
          }),
        );
      }

      // 页内脚本（`public/recover-passkey.js`）需要知道 token 与几种状态文案。
      // 🔴 文案**经 `data-*` 传**给脚本，而不是在脚本里再写一份：
      //    脚本是静态资源，取不到词条表；若它自己写死中文，
      //    英文用户在看这一页时会突然读到中文（或者反过来，就是这次的问题）。
      const bodyAttrs = [
        `data-token="${escapeHtml(token)}"`,
        `data-msg-busy="${escapeHtml(t(locale, 'server.page.recover.busy'))}"`,
        `data-msg-waiting="${escapeHtml(t(locale, 'server.page.recover.waiting'))}"`,
        `data-msg-verifying="${escapeHtml(t(locale, 'server.page.recover.verifying'))}"`,
        `data-msg-success="${escapeHtml(t(locale, 'server.page.recover.success'))}"`,
        `data-msg-error="${escapeHtml(t(locale, 'server.page.recover.error'))}"`,
        `data-msg-unknown="${escapeHtml(t(locale, 'server.page.error.unknown'))}"`,
      ].join(' ');

      const page = renderPage(locale, {
        title: t(locale, 'server.page.recover.title'),
        heading: t(locale, 'server.page.recover.heading'),
        body: t(locale, 'server.page.recover.body'),
        actions: [{ label: t(locale, 'server.page.recover.button'), id: 'recoverBtn', primary: true }],
        extraHtml:
          '<p class="status status--err" id="error" hidden></p>' +
          '<p class="status status--ok" id="success" hidden></p>' +
          '<p class="hint" id="info" hidden></p>',
        scripts: ['/simplewebauthn-browser.min.js', '/recover-passkey.js'],
      });

      // 脚本靠 `document.body.dataset` 取上面那些属性 ⇒ 必须挂在 `<body>` 上。
      return reply
        .type('text/html')
        .send(page.replace('<body>', `<body ${bodyAttrs}>`));
    },
  );

  // Magic link login page - renders a confirmation page with a "Log In" button.
  // The GET request does NOT consume the single-use token. Instead, the button
  // triggers a POST to /api/login/magic-link/verify which verifies the token.
  // This two-step flow prevents email client link prefetchers (Outlook SafeLinks,
  // Gmail link preview, etc.) from consuming the token before the user clicks.
  fastify.get<{ Querystring: MagicLoginQuery }>(
    '/magic-login',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const locale = localeOf(req);
      const { token } = req.query;
      if (!token) {
        return reply.status(400).type('text/html').send(
          renderPage(locale, {
            title: t(locale, 'server.page.login.title'),
            heading: t(locale, 'server.page.login.heading'),
            body: t(locale, 'server.page.tokenRequired'),
          }),
        );
      }

      const bodyAttrs = [
        `data-token="${escapeHtml(token)}"`,
        `data-msg-busy="${escapeHtml(t(locale, 'server.page.login.busy'))}"`,
        `data-msg-success="${escapeHtml(t(locale, 'server.page.login.success'))}"`,
        `data-msg-error="${escapeHtml(t(locale, 'server.page.login.error'))}"`,
        `data-msg-unknown="${escapeHtml(t(locale, 'server.page.error.unknown'))}"`,
      ].join(' ');

      const page = renderPage(locale, {
        title: t(locale, 'server.page.login.title'),
        heading: t(locale, 'server.page.login.heading'),
        body: t(locale, 'server.page.login.body'),
        actions: [{ label: t(locale, 'server.page.login.button'), id: 'login-btn', primary: true }],
        extraHtml:
          '<p class="status status--err" id="error" hidden></p>' +
          '<p class="status status--ok" id="success" hidden></p>',
        scripts: ['/magic-login-confirm.js'],
      });

      return reply
        .type('text/html')
        .send(page.replace('<body>', `<body ${bodyAttrs}>`));
    },
  );

  /**
   * 第四张凭据页：**用重置链接设一个新密码**。
   *
   * 🔴 GET **不消费令牌** —— 与另外三张同一条纪律（`/verify-email` 那次改的就是它）：
   * 邮件客户端的链接预取会在用户点之前就把一枚一次性令牌烧掉。令牌什么时候被烧，
   * 只由页内脚本那一次 `POST /api/password/reset` 决定。
   *
   * 🔴 成功后**不发登录态**（ADR-0040）。这一页的终点是登录页，不是自动进场：
   * 能走完重置流程只证明他持有收件箱，而收件箱是可以被旁观的。
   *
   * 为什么这一页必须在**服务端**渲染而不是应用里的一个路由：
   * 忘记密码的人手上什么会话都没有，`/app/` 那条门要先登录才进得去 ——
   * 把重置表单放在需要登录的地方才真的是死循环。
   */
  fastify.get<{ Querystring: ResetPasswordQuery }>(
    '/reset-password',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const locale = localeOf(req);
      const { token } = req.query;
      if (!token) {
        return reply.status(400).type('text/html').send(
          renderPage(locale, {
            title: t(locale, 'server.page.reset.title'),
            heading: t(locale, 'server.page.reset.heading'),
            body: t(locale, 'server.page.tokenRequired'),
          }),
        );
      }

      // 🔴 状态文案经 `data-*` 下发（与另外三张同一理由：静态脚本取不到词条表，
      //    自己写一份中文就等于让英文用户突然读到中文）。
      const bodyAttrs = [
        `data-token="${escapeHtml(token)}"`,
        `data-msg-busy="${escapeHtml(t(locale, 'server.page.reset.busy'))}"`,
        `data-msg-success="${escapeHtml(t(locale, 'server.page.reset.success'))}"`,
        `data-msg-mismatch="${escapeHtml(t(locale, 'server.page.reset.mismatch'))}"`,
        `data-msg-invalid-link="${escapeHtml(t(locale, 'server.page.reset.invalidLink'))}"`,
        // 策略那四个码各自一句 —— "太短"和"已在泄露库里"是两件不同的事，
        // 合成一句用户就不知道该改哪里。
        `data-policy-too-short="${escapeHtml(t(locale, 'server.page.reset.tooShort'))}"`,
        `data-policy-too-long="${escapeHtml(t(locale, 'server.page.reset.tooLong'))}"`,
        `data-policy-too-common="${escapeHtml(t(locale, 'server.page.reset.tooCommon'))}"`,
        `data-policy-breached="${escapeHtml(t(locale, 'server.page.reset.breached'))}"`,
        `data-msg-locked="${escapeHtml(t(locale, 'server.page.reset.locked'))}"`,
        `data-msg-unavailable="${escapeHtml(t(locale, 'server.page.reset.unavailable'))}"`,
        `data-msg-unknown="${escapeHtml(t(locale, 'server.page.error.unknown'))}"`,
        `data-label-reveal="${escapeHtml(t(locale, 'server.page.reset.reveal'))}"`,
        `data-label-hide="${escapeHtml(t(locale, 'server.page.reset.hide'))}"`,
      ].join(' ');

      // 🔴 `autocomplete="new-password"`（两个框都是）**不能省，也不能写成 `on`**：
      //    它告诉密码管理器"这里是**生成**一个新口令的地方"，于是它建议一个强口令
      //    并把同一份填进两个框。写成 `on` 或留着不管，管理器会把**旧密码**填进来 ——
      //    用户刚点的"忘记密码"当场变成"把泄露的那个密码再设一遍"。
      //    这是这一页最常见的真实坑，值得比样式更多的字数。
      // 🔴 **不加 `novalidate`**：空着提交由浏览器自己拦 —— 那句提示是浏览器给的、
      //    跟着系统语言，不需要我们再造一个词条。脚本只管"两次输入不一致"这种
      //    必须用我方文案的情形。
      const formHtml = [
        '<form id="reset-form">',
        '<div class="field">',
        `<label for="pw">${escapeHtml(t(locale, 'server.page.reset.newLabel'))}</label>`,
        '<div class="input-row">',
        // 长度上限**不在这里设**（没有 `maxlength`）：那是浏览器里的第二条规则，
        // 而它按 UTF-16 计数 —— 含 emoji 的口令会被**静默截断**成另一个口令。
        // 长度的唯一裁决者是服务端的策略（`too_long` 那句会照实显示）。
        '<input class="input" id="pw" name="password" type="password" ' +
          'autocomplete="new-password" required>',
        `<button type="button" class="btn btn--ghost" id="reveal" aria-controls="pw pw2" aria-pressed="false">` +
          `${escapeHtml(t(locale, 'server.page.reset.reveal'))}</button>`,
        '</div>',
        '</div>',
        '<div class="field">',
        `<label for="pw2">${escapeHtml(t(locale, 'server.page.reset.confirmLabel'))}</label>`,
        '<input class="input" id="pw2" name="password_confirm" type="password" ' +
          'autocomplete="new-password" required>',
        '</div>',
        '<p class="hint">' + escapeHtml(t(locale, 'server.page.reset.hint')) + '</p>',
        '<button type="submit" class="btn btn--primary" id="resetBtn">' +
          `${escapeHtml(t(locale, 'server.page.reset.button'))}</button>`,
        '</form>',
        // 错误与成功各占一行，脚本只改文本与 `hidden`（不重排 DOM，焦点不乱）。
        '<p class="status status--err" id="error" role="alert" hidden></p>',
        '<p class="status status--ok" id="success" role="status" hidden></p>',
        // 🔴 成功后这一页不能是**死路**。脚本不自动跳转（ADR-0040：持有收件箱不等于
        //    该拿到会话），但"下一步去哪儿"得由我们说清楚 —— 一个用户自己点的入口。
        //    `/app/` 与 `magic-login-confirm.js` 跳的是同一个地址（同一个部署假设，
        //    两处必须一起对，别在这里另造一套）。
        '<a class="btn btn--primary" id="goLogin" href="/app/" hidden>' +
          `${escapeHtml(t(locale, 'server.page.reset.goLogin'))}</a>`,
      ].join('\n    ');

      const page = renderPage(locale, {
        title: t(locale, 'server.page.reset.title'),
        heading: t(locale, 'server.page.reset.heading'),
        body: t(locale, 'server.page.reset.body'),
        formHtml,
        scripts: ['/reset-password.js'],
      });

      return reply
        .type('text/html')
        .send(page.replace('<body>', `<body ${bodyAttrs}>`));
    },
  );
}
