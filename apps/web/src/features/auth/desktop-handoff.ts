/**
 * 桌面壳的**反向授权回跳**（ADR-0039 §2.3）
 * ==========================================
 *
 * ## 它解决什么
 *
 * macOS / Windows 壳里**自己做不了通行密钥**（实测：WKWebView 的 `uvpaa=false`；
 * 而壳里也没有深链）。定案是**把鉴权交给系统浏览器** —— 我们的站点跑在**正常 https
 * origin** 上，通行密钥在那里好用（Chromium 里 6/6，见 `apps/web/evidence/auth-journey/`）。
 *
 * 于是链路是：
 *
 * ```
 * 壳：生成一次性 state → 打开  <站点>/app/?auth=desktop&state=<state>
 * 浏览器：用户用**应用自己的**登录 UI 登录（通行密钥 / 邮箱链接 / 粘贴令牌都行）
 * 应用：登录成功 → 回跳  heyta://auth#token=<JWT>&state=<state>
 * 壳：校验 state 与它发出去的那个一致 → 把令牌交给**页侧既有**登录路径
 * ```
 *
 * ## 为什么令牌放在 **fragment**
 *
 * `#` 之后的部分**不会**发给服务器、不进 `Referer`、也不进任何一层的访问日志。
 * 令牌放进 query 就等于把它抄送给沿途每一个中间件。
 *
 * ## 为什么要一个"看得见的兜底入口"
 *
 * 程序化跳自定义 scheme 会被浏览器**静默拒绝**（没有安装对应应用时、或某些策略下）。
 * 那时用户看到的是"点了登录，什么都没发生"。所以这里先挂一个**可点的链接**，
 * 再尝试自动跳 —— 自动跳成功的话用户根本看不到它，失败的话它就在那里。
 *
 * ⚠️ 这个兜底界面是**产品行为**，不是测试用的钩子：它同时让"回跳地址对不对"
 *    这件事**可被断言**（`a[data-testid="desktop-handoff-link"]` 的 `href`）。
 */

/** 回跳用的 scheme。⚠️ 这是壳**第一次**对外承诺一个 URL scheme —— 改动它是破坏性变更。 */
export const DESKTOP_CALLBACK_SCHEME = 'heyta';

/** 触发桌面授权模式的 query 参数。 */
export const DESKTOP_AUTH_PARAM = 'auth';
/** 壳生成的一次性随机串。壳必须校验回跳里的它**与自己发出去的那个一致**。 */
export const DESKTOP_STATE_PARAM = 'state';
/** 桌面授权模式的取值。 */
export const DESKTOP_AUTH_MODE = 'desktop';

export interface DesktopHandoff {
  readonly state: string;
}

/**
 * 读"这次是桌面壳发起的授权"。
 *
 * 🔴 **没有 `state` 就不是桌面流程** —— 不是"宽松处理"，而是安全边界：
 *    壳靠 `state` 判断"这个回调是不是我这次发起的那一个"。放行空 state
 *    等于允许任意网页把令牌塞进壳。
 */
export function readDesktopHandoff(url: URL): DesktopHandoff | null {
  if (url.searchParams.get(DESKTOP_AUTH_PARAM) !== DESKTOP_AUTH_MODE) return null;
  const state = url.searchParams.get(DESKTOP_STATE_PARAM) ?? '';
  if (state === '') return null;
  return { state };
}

/** 拼回跳地址。令牌在 fragment 里（见文件头）。 */
export function buildDesktopCallback(token: string, state: string): string {
  return (
    `${DESKTOP_CALLBACK_SCHEME}://auth` +
    `#token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`
  );
}

/** 兜底入口的 testID —— 页面与测试两侧都用它，避免各写一份字符串。 */
export const DESKTOP_HANDOFF_TESTID = 'desktop-handoff-link';

/**
 * 把令牌交回壳：挂一个**可见的**兜底链接，然后尝试自动跳转。
 *
 * @returns 回跳地址（调用方多半不用，测试与日志用得上）。
 */
export function handOffToShell(token: string, state: string, doc: Document): string {
  const url = buildDesktopCallback(token, state);

  const existing = doc.querySelector(`[data-testid="${DESKTOP_HANDOFF_TESTID}"]`);
  if (existing === null) {
    const box = doc.createElement('div');
    box.setAttribute('data-testid', 'desktop-handoff');
    // 内联样式而不是引一个样式文件：这一层要在**任何**主题/布局下都能显示，
    // 而它挂载的时刻应用可能正处于任意状态（登录成功那一瞬）。
    box.setAttribute(
      'style',
      'position:fixed;inset:auto 0 0 0;padding:12px 16px;text-align:center;' +
        'background:#111827;color:#f9fafb;font-size:14px;z-index:2147483647',
    );
    const link = doc.createElement('a');
    link.setAttribute('data-testid', DESKTOP_HANDOFF_TESTID);
    link.setAttribute('href', url);
    link.textContent = '正在返回 heyta…（如果没有自动跳转，点这里）';
    link.setAttribute('style', 'color:#93c5fd;text-decoration:underline');
    box.appendChild(link);
    doc.body.appendChild(box);
  }

  // 自动跳。⚠️ 被拒绝也不抛 —— 用户还有上面那个链接。
  try {
    doc.defaultView?.location.assign(url);
  } catch {
    /* 浏览器拒绝程序化跳自定义 scheme：兜底链接就是为这一刻准备的。 */
  }

  return url;
}

/**
 * 登录成功那一刻调这个：**这次是桌面壳发起的授权就把令牌交回它**，否则什么都不做。
 *
 * 🔴 只有这一个"要不要回跳"的判定点 —— 所有登录路径（通行密钥 / 邮箱链接 / 粘贴令牌）
 *    最终都汇聚到它，所以在它上面加分支不会漏掉某一条路。
 */
export function maybeHandOffToShell(
  token: string,
  url: URL,
  doc: Document | null,
): string | null {
  const intent = readDesktopHandoff(url);
  if (intent === null) return null;
  if (doc === null) return buildDesktopCallback(token, intent.state);
  return handOffToShell(token, intent.state, doc);
}
