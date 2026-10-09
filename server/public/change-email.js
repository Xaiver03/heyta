// 换绑邮箱页（`/change-email`）的页内脚本。
//
// 🔴 文案一律来自 `document.body.dataset`（由 `server/src/pages.ts` 按语言渲染）。
//    脚本里**不写任何一句用户可见的话**，也不回显服务端响应里的 `error` 字段 ——
//    那句是英文的、面向客户端的内部话术（同 `reset-password.js` 的第一条纪律）。
//
// 🔴 成功后**不写任何登录态**（ADR-0063 §2.2）：能点开这封信只证明他持有那个收件箱，
//    而收件箱是可以被旁观的。这一页的终点是"用新地址重新登录"。
//
// 🔴 「这一边确认了」与「整个换绑生效了」必须分开说，而且分开得**由服务端裁决**：
//    响应里的 `applied` 才是那个判据。把 `ok` 当"改好了"会让只点了一边的人以为已经改成，
//    于是另一边永远不会去点 —— 那张请求最后在库里静静过期。
//
// ⚠️ 取不到文案时保留元素原有内容，而不是退回某句英文。
(function () {
  // 与 `recover-passkey.js` 同一个理由：脚本位置不该是承重结构。
  function boot() {
    var body = document.body;
    var form = document.getElementById('change-email-form');
    var submitBtn = document.getElementById('confirmBtn');
    var errorEl = document.getElementById('error');
    var successEl = document.getElementById('success');
    var goLogin = document.getElementById('goLogin');
    var token = body.dataset.token;

    if (!form || !submitBtn || !errorEl || !successEl || !token) {
      return;
    }

    var initialLabel = submitBtn.textContent;

    // `code`（不是状态码）决定说哪句：这里的 400 同时是"链接坏了"和"body 畸形"两种情况，
    // 而对点链接的人来说处置完全一样 —— 所以服务端刻意让它们同码同句。
    // 🔴 这里**没有**"地址已被占用"这一句：那条路由不要认证，说出口就是账号存在性枚举通道。
    // 那句实话由应用里重新发起的那一次（在 Bearer 之后）来说。
    var codeMessages = {
      invalid_change_link: body.dataset.msgInvalidLink,
    };

    function showMessage(el, text) {
      if (typeof text === 'string' && text !== '') {
        el.textContent = text;
      }
      el.hidden = false;
    }

    function setBusy(busy) {
      submitBtn.disabled = busy;
      submitBtn.textContent = busy && body.dataset.msgBusy ? body.dataset.msgBusy : initialLabel;
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      errorEl.hidden = true;
      successEl.hidden = true;
      setBusy(true);

      fetch('/api/account/email/change/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 令牌原样带回去；这一页 GET 时**没有**消费它（预取会替用户烧掉一边）。
        body: JSON.stringify({ token: token }),
      })
        .then(function (res) {
          return res.json().catch(function () {
            return {};
          }).then(function (payload) {
            if (!res.ok) {
              var code = typeof payload.code === 'string' ? payload.code : '';
              showMessage(errorEl, codeMessages[code] || body.dataset.msgUnknown);
              // 链接坏了 ⇒ 再点也没用，但按钮留着：同一个坏链接点第二次仍然是这句，
              // 而"回应用重新发起"那一步在应用里，这一页替不了他做。
              return;
            }
            form.hidden = true;
            if (payload.applied === true) {
              // 只有整个换绑生效才给"去登录"这一格。
              if (goLogin) goLogin.hidden = false;
              showMessage(successEl, body.dataset.msgApplied);
              return;
            }
            showMessage(successEl, body.dataset.msgAwaitingOther);
          });
        })
        .catch(function () {
          // 网络层失败（断网 / 请求被拦）—— 这句必须出现，否则按钮转一下就复原，
          // 用户不知道发生了什么。
          showMessage(errorEl, body.dataset.msgUnknown);
        })
        .then(function () {
          setBusy(false);
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
