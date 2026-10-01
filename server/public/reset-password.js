// 重置密码页（`/reset-password`）的页内脚本。
//
// 🔴 文案一律来自 `document.body.dataset`（由 `server/src/pages.ts` 按语言渲染）。
//    脚本里**不写任何一句用户可见的话**，也**不回显服务端响应里的 `error` 字段** ——
//    那句是英文的、面向客户端的，直接渲染出来等于让中文用户读到服务端内部话术
//    （`/verify-email` 那张页 2026-09-30 就是因为回显它被改掉过）。
//
// 🔴 成功后**不写任何登录态**，也不跳转。这一页的终点是"回去用新密码登录"（ADR-0040）。
//
// ⚠️ 取不到文案时保留元素原有内容（那是服务端已经渲染好的本地化文案），
//    而不是退回某句英文。降级的正确方向是"什么都不改"，不是"换个语言"。
(function () {
  // 与 `recover-passkey.js` 同一个理由：脚本位置不该是承重结构。
  function boot() {
    var body = document.body;
    var form = document.getElementById('reset-form');
    var submitBtn = document.getElementById('resetBtn');
    var revealBtn = document.getElementById('reveal');
    var pw = document.getElementById('pw');
    var pw2 = document.getElementById('pw2');
    var errorEl = document.getElementById('error');
    var successEl = document.getElementById('success');
    var token = body.dataset.token;

    if (!form || !submitBtn || !pw || !pw2 || !errorEl || !successEl || !token) {
      return;
    }

    var initialLabel = submitBtn.textContent;

    // 服务端的 `policyCode` → 这一句。四个码分开是因为"太短"和"在泄露库里"
    // 是两件不同的事，合成一句用户就不知道该改哪里。
    var policyMessages = {
      too_short: body.dataset.policyTooShort,
      too_long: body.dataset.policyTooLong,
      too_common: body.dataset.policyTooCommon,
      breached: body.dataset.policyBreached,
    };

    // `code`（不是状态码）决定说哪句：状态码在这里不够用 ——
    // 400 同时是"链接坏了"和"口令不合格"两种情况。
    var codeMessages = {
      invalid_reset_link: body.dataset.msgInvalidLink,
      password_policy_violation: body.dataset.msgUnknown,
      account_locked: body.dataset.msgLocked,
      password_backend_busy: body.dataset.msgUnavailable,
    };

    function showMessage(el, text) {
      if (typeof text === 'string' && text !== '') {
        el.textContent = text;
      }
      el.hidden = false;
    }

    function hideMessages() {
      errorEl.hidden = true;
      successEl.hidden = true;
    }

    function setBusy(busy) {
      submitBtn.disabled = busy;
      pw.disabled = busy;
      pw2.disabled = busy;
      if (revealBtn) revealBtn.disabled = busy;
      // busy 文案取不到就保持原标签：把按钮清空比留着一个英文标签更糟。
      submitBtn.textContent = busy && body.dataset.msgBusy ? body.dataset.msgBusy : initialLabel;
    }

    // 「显示 / 隐藏」：两个框一起切，否则"确认"那格看不见、比对毫无意义。
    if (revealBtn) {
      revealBtn.addEventListener('click', function () {
        var shown = pw.type === 'text';
        pw.type = shown ? 'password' : 'text';
        pw2.type = shown ? 'password' : 'text';
        revealBtn.setAttribute('aria-pressed', shown ? 'false' : 'true');
        var label = shown ? body.dataset.labelReveal : body.dataset.labelHide;
        if (typeof label === 'string' && label !== '') revealBtn.textContent = label;
      });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      hideMessages();

      // 浏览器已经拦下"空着提交"（表单没有 `novalidate`），走到这里两个框都有值。
      // 唯一需要先知的本地判断是"两次不一致" —— 它需要的文案是我们的，不是浏览器的。
      if (pw.value !== pw2.value) {
        showMessage(errorEl, body.dataset.msgMismatch);
        pw2.focus();
        return;
      }

      setBusy(true);

      fetch('/api/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 令牌原样带回去；这一页 GET 时**没有**消费它（预取会替用户烧掉链接）。
        body: JSON.stringify({ token: token, password: pw.value }),
      })
        .then(function (res) {
          return res.json().catch(function () {
            return {};
          }).then(function (payload) {
            if (res.ok) {
              // 🔴 成功：清掉两个框（口令不该在 DOM 里多待一秒），收掉表单，
              //    只留"用新密码登录"这一句。**不写 token、不自动跳转** ——
              //    但下一步的入口要给出来（服务端渲染好的那个链接，这里只摘掉 hidden）。
              pw.value = '';
              pw2.value = '';
              form.hidden = true;
              var goLogin = document.getElementById('goLogin');
              if (goLogin) goLogin.hidden = false;
              // 只留"用新密码登录"这一句。`role="status"` 是活区，读屏会念出来；
              // 不再额外移焦点 —— 那样会被念两遍。
              showMessage(successEl, body.dataset.msgSuccess);
              return;
            }
            var code = typeof payload.code === 'string' ? payload.code : '';
            var text =
              code === 'password_policy_violation'
                ? policyMessages[payload.policyCode] || body.dataset.msgUnknown
                : codeMessages[code] || body.dataset.msgUnknown;
            showMessage(errorEl, text);
            // 链接坏了 ⇒ 再改口令也没用，把焦点放回第一个框是唯一有意义的落点。
            pw.focus();
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
