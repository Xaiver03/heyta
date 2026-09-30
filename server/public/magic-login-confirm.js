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
           * 🔴 **存的是"链接令牌"，不是 `result.data.token`（那是会话 JWT）**。
           *
           * 应用启动时用 `verifyMagicLink()` 消费 `loginToken` —— 它期待的是
           * **一次性链接令牌**（服务端按 `loginToken` 那一列查）。
           * 以前这里存的是上面那个 POST 换回来的 **JWT**，于是应用会拿 JWT 再去
           * `/api/login/magic-link/verify` 换一次 ⇒ **必然 401**，
           * 而失败被 `consumePendingLogin` 吞掉 ⇒ 用户看到的是"登录了但还是未登录"。
           * （2026-09-30 实测挖到；web 的邮件回跳第二腿**一直是坏的**，
           *   而没有任何测试覆盖它：J1–J7 走通行密钥，`verify:email-auth` 只验服务端。）
           *
           * ⚠️ 保留上面那次 POST：它是**给用户看的**校验（链接无效/过期要当场说出来）。
           *    令牌在那一跳里已经被消费掉 —— 所以这里必须存**原始令牌**，
           *    而不是"已经变成会话"的那个值。
           */
          sessionStorage.setItem('loginToken', token);
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
