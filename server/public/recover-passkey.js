// 通行密钥恢复：读 body 上的 data-* 属性，走 WebAuthn 注册流程。
//
// 🔴 文案一律来自 `document.body.dataset`（由 `server/src/pages.ts` 按用户语言渲染）。
//    脚本里**不写任何一句用户可见的话** —— 静态资源取不到词条表，
//    一旦写死，切换语言时这一页就会出现"半中半英"。
//
// ⚠️ 取不到文案时**保留元素原有内容**（那是服务端已经渲染好的本地化文案），
//    而不是退回到某句英文。降级的正确方向是"什么都不改"，不是"换个语言"。
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
    var recoverBtn = document.getElementById('recoverBtn');
    var errorEl = document.getElementById('error');
    var successEl = document.getElementById('success');
    var infoEl = document.getElementById('info');
    var token = body.dataset.token;

    if (!recoverBtn || !errorEl || !successEl || !infoEl || !token) {
      return;
    }

    // 记住服务端渲染的按钮文案：失败时要回到它，而不是写死某一句。
    var initialLabel = recoverBtn.textContent;

    var msg = {
      busy: body.dataset.msgBusy,
      waiting: body.dataset.msgWaiting,
      verifying: body.dataset.msgVerifying,
      success: body.dataset.msgSuccess,
      error: body.dataset.msgError,
    };

    /** 只在拿到文案时改字；拿不到就保持服务端渲染的那一句。 */
    function say(element, text) {
      if (text) element.textContent = text;
    }

    function show(element) {
      element.hidden = false;
    }

    function hide(element) {
      element.hidden = true;
    }

    recoverBtn.addEventListener('click', function () {
      hide(errorEl);
      hide(successEl);
      hide(infoEl);
      recoverBtn.disabled = true;
      say(recoverBtn, msg.busy);

      // 第 1 步：向服务端要注册选项
      fetch('/api/recover/passkey/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token }),
      })
        .then(function (optionsRes) {
          if (!optionsRes.ok) {
            throw new Error('options-request-failed');
          }
          return optionsRes.json();
        })
        .then(function (data) {
          // 第 2 步：调浏览器 API 创建通行密钥
          say(infoEl, msg.waiting);
          show(infoEl);
          say(recoverBtn, msg.waiting);

          return SimpleWebAuthnBrowser.startRegistration({
            optionsJSON: data.options,
          });
        })
        .then(function (credential) {
          // 第 3 步：把凭据交给服务端验证
          say(recoverBtn, msg.verifying);
          hide(infoEl);

          return fetch('/api/recover/passkey/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token, credential: credential }),
          }).then(function (completeRes) {
            if (!completeRes.ok) {
              throw new Error('complete-request-failed');
            }
            say(successEl, msg.success);
            show(successEl);
            recoverBtn.hidden = true;
          });
        })
        .catch(function (err) {
          // 🔴 不把 `err.message` 显示给用户：那是**服务端的英文**（或一个内部标识），
          //    而这一页是本地化的。调试信息留在控制台。
          console.error('Passkey recovery error:', err);
          say(errorEl, msg.error);
          show(errorEl);
          recoverBtn.disabled = false;
          recoverBtn.textContent = initialLabel;
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
