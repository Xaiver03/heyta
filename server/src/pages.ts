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
}
