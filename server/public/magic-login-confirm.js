// 魔法登录确认：读 body 上的 data-* 属性，POST 校验令牌，把结果交给应用完成登录。
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
    };

    /** 只在拿到文案时改字；拿不到就保持服务端渲染的那一句。 */
    function say(element, text) {
      if (text) element.textContent = text;
    }

    loginBtn.addEventListener('click', function () {
      loginBtn.disabled = true;
      say(loginBtn, msg.busy);
      errorEl.hidden = true;

      fetch('/api/login/magic-link/verify', {
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
          if (!result.ok || !result.data.token) {
            throw new Error('magic-link-verify-failed');
          }
          say(successEl, msg.success);
          successEl.hidden = false;
          loginBtn.hidden = true;

          sessionStorage.setItem('loginToken', result.data.token);
          // 🔴 不要把这里写死成某个域名，也不要让应用去"猜自己的 origin"：
          //    应用与同步服务端可能不在同一个 origin（反代、自建、VITE_SYNC_URL 覆盖），
          //    猜错就会把令牌发到错的地方。这里记的是**校验端点所在的那个 origin**。
          sessionStorage.setItem('loginBaseUrl', window.location.origin);
          // 🔴 跳到**应用**（`/app/`），不是站点根。
          //    令牌放在 sessionStorage 里，只有应用启动时才会被消费；
          //    落在站点根（落地页）的话，用户点了"登录"却停在落地页，
          //    还得自己再点一次"立即使用" —— 那正是这一页要消除的摩擦。
          window.location.href = '/app/';
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
