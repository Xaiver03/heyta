// 魔法登录确认：读 body 上的 data-* 属性，POST 校验令牌，把结果交给应用完成登录。
//
// 🔴 交付通道是 **URL 的 `fragment`**（`/app/#sessionToken=…`），不是 sessionStorage。
//    原因见下面 `window.location.replace` 前那段：这一页与应用的
//    **agent cluster 不同**（服务端带了 COOP/OAC，静态产物没有），
//    sessionStorage 跨不过那次跳转 —— 实测过，不是理论。
//
// 两步流程（GET 渲染页面、POST 校验令牌）是为了防住**邮件客户端的链接预取**
// （Outlook SafeLinks、Gmail 链接预览等）—— 它们会在用户点之前就把链接抓一遍，
// 单次令牌若在 GET 时消费掉，用户点进来就只能是"链接已失效"。
//
// 🔴 令牌本身**不足以**让应用完成登录：应用还要知道该拿它去**哪个服务器**校验。
//    所以这里把服务器 origin 一起持久化。消费方是
//    `apps/web/src/features/auth/pending-login.ts` —— 两个键必须保持一致。
//
// 🔴 文案一律来自 `document.body.dataset`（由 `server/src/pages.ts` 按用户语言渲染）。
//    脚本里**不写任何一句用户可见的话**。
(function () {

  /**
   * 🔴 等 DOM 就绪再跑。
   *
   * 页内脚本现在挂在 `</body>` 之前（`design-html.ts` 的 `renderPage`），
   * 正常情况下 `document.body` 一定在。但**不能只靠这个**：
   * 2026-09-30 用户实测报障 —— 脚本一度被放在 `<head>` 且没有 `defer`，
   * 于是同步执行时 `<body>` 尚未解析，`document.body` 是 `null`，
   * 第一行的 `document.body.dataset.token` 直接抛 TypeError，
   * **按钮点了完全没反应**（用户看到的就是"点一下没反应"）。
   *
   * 这个 guard 让位置不再是承重结构：放哪儿都不会崩。
   */
  function boot() {
    var body = document.body;
    var token = body.dataset.token;
    var loginBtn = document.getElementById('login-btn');
    var errorEl = document.getElementById('error');
    var successEl = document.getElementById('success');

    if (!token || !loginBtn || !errorEl || !successEl) {
      return;
    }

    var initialLabel = loginBtn.textContent;
    var msg = {
      busy: body.dataset.msgBusy,
      success: body.dataset.msgSuccess,
      error: body.dataset.msgError,
      // 通行密钥注册那条链接：验证成功但**不发会话**，所以不能说"登录成功"。
      verifiedOnly: body.dataset.msgVerifiedOnly,
    };

    /** 只在拿到文案时改字；拿不到就保持服务端渲染的那一句。 */
    function say(element, text) {
      if (text) element.textContent = text;
    }

    loginBtn.addEventListener('click', function () {
      loginBtn.disabled = true;
      say(loginBtn, msg.busy);
      errorEl.hidden = true;

      // 🔴 **统一端点**（ADR-0039 §2.1）：登录令牌 / 邮箱注册令牌 / 通行密钥注册令牌
      //    都由它一份实现分流。老端点 `/api/login/magic-link/verify` 仍在（老邮件指向它），
      //    但它内部**委托**到同一个核心 —— 页面这边只认这一个。
      fetch('/api/auth/email/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            throw new Error('magic-link-verify-failed');
          }
          /**
           * `verified-only` = 验证成功、但那条路**不发会话**（通行密钥注册那封邮件）。
           * ⚠️ 它不是失败：把它当失败会让用户以为链接坏了，而其实是"该用你的通行密钥登录"。
           * 这里只把按钮换成"去应用"，不写 sessionStorage。
           */
          if (result.data.kind === 'verified-only') {
            say(successEl, msg.verifiedOnly || msg.success);
            successEl.hidden = false;
            loginBtn.hidden = true;
            return;
          }
          if (result.data.kind !== 'session' || !result.data.token) {
            throw new Error('magic-link-verify-failed');
          }
          say(successEl, msg.success);
          successEl.hidden = false;
          loginBtn.hidden = true;

          /**
           * 🔴 **投递方式：URL 的 `fragment`**（第四版；前三版错在哪见下）。
           *
           * 1. 最初把会话 JWT 存进 **`loginToken`**，而应用把 `loginToken` 当
           *    **一次性链接令牌**拿去再换一次 ⇒ **必然 401** ⇒
           *    用户看到"点了邮件里的链接，回来还是未登录"。
           *    （这是它坏了很久没人发现的那个 bug。）
           * 2. 改成存**原始链接令牌** —— 更糟：上面那次 POST **已经把它消费掉了**，
           *    应用拿到的是一张用过的票 ⇒ 还是 401。
           *    （`scripts/verify-email-web-chain.mjs` 第一次跑就当场判红。）
           * 3. 改成把**会话**存进 `sessionStorage`，应用直接采用。
           *    键与语义都对了，**但投递仍然会丢**：这条判据当场判红，仪器读数如下 ——
           *      确认页 `pagehide` 那一刻：`[sessionToken, loginEmail, loginBaseUrl]`（写进去了）
           *      应用启动那一刻        ：`[]`（没跟过来）且**没有任何 `removeItem`**
           *    根因：这一页由同步服务端渲染，带着 `@fastify/helmet` 的默认头
           *    `Cross-Origin-Opener-Policy: same-origin` + `Origin-Agent-Cluster: ?1`；
           *    应用（`/app/`，静态产物）两个头都没有 ⇒ 跳过去时**切了 browsing instance**，
           *    `sessionStorage` 不跟着回来。**注入摘掉那两个头，判据立刻全绿** —— 因果已钉死。
           * 4. ✅ **现在**：把会话放进 **fragment** 交给应用。fragment 不发给服务端、
           *    不进 `Referer`、不进任何访问日志，而且是 URL 的一部分 ⇒ **一定跨得过去**，
           *    不依赖服务端与反代的头配置保持一致（自建换反代不会再坏一次）。
           *    应用读完**立刻** `history.replaceState` 抹掉（见
           *    `apps/web/src/features/auth/pending-login.ts`）。
           *
           * ⚠️ 保留上面那次 POST：它是**给用户看的**校验（链接无效/过期当场说出来），
           *    而且它才是**唯一**的消费点（单次消费）。
           */
          var params = new URLSearchParams();
          params.set('sessionToken', result.data.token);
          params.set('loginEmail', (result.data.user && result.data.user.email) || '');
          // 🔴 不要把这里写死成某个域名，也不要让应用去"猜自己的 origin"：
          //    应用与同步服务端可能不在同一个 origin（反代、自建、VITE_SYNC_URL 覆盖），
          //    猜错就会把令牌发到错的地方。这里记的是**校验端点所在的那个 origin**。
          params.set('loginBaseUrl', window.location.origin);
          /**
           * 🔴 跳到**应用**（`/app/`），不是站点根：落在落地页的话，用户点了"登录"
           *    却停在落地页，还得自己再点一次"立即使用" —— 那正是这一页要消除的摩擦。
           *
           * 🔴 **`replace` 而不是 `assign`**：确认页那个 URL 里带着**一次性令牌**，
           *    让它留在历史里，用户按一次"后退"就会重新打开一个已经用掉的链接
           *    （看到"链接已失效"，像是坏了）。`replace` 把它整个换掉。
           */
          window.location.replace('/app/#' + params.toString());
        })
        .catch(function (err) {
          // 不把 `err.message` 显示给用户：那是服务端的英文或一个内部标识，
          // 而这一页是本地化的。调试信息留在控制台。
          console.error('Magic link login error:', err);
          say(errorEl, msg.error);
          errorEl.hidden = false;
          loginBtn.disabled = false;
          loginBtn.textContent = initialLabel;
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
