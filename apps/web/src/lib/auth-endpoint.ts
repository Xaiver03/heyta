/**
 * 「这次认证要发给哪台服务端」的唯一判据
 * =======================================
 *
 * ## 它修的是什么（产品负责人原话）
 *
 * > 「绝对不允许什么用自己正在用的域名才能够注册，不可能是这样子的。」
 *
 * 在这之前，一个刚打开应用的访客点顶栏「登录 / 注册」，看到的是**第一个必填项
 * 就是服务端地址**（`AuthPanel.tsx` 里 `baseUrl === ''` 那个分支）。也就是说
 * **产品把"你知道自己的同步服务端域名吗"当成了注册的前置条件** —— 而 99% 的用户
 * 是来用官方托管的，他不需要知道任何域名。
 *
 * ## 为什么默认值可以是"应用自己所在的这个来源"
 *
 * 不是猜，是一个已部署的事实：`docs/runbooks/deployment.md` §3.3.1 定下的是
 * **唯一域名**形态 —— 站点在根 `/`、应用在 `/app/`、同步 API 在 `/api/`，
 * **三者同一个 origin**。所以"这个页面是从哪台服务端来的"就回答了"该把凭据发给谁"。
 *
 * 这与 `apps/web/src/lib/site-url.ts` 的 `siteRoot()` 是同一条推理、同一个形状：
 * **构建期变量优先，没配就取自身来源**。
 *
 * `VITE_SYNC_URL` 是给别的形态留的口子（应用与同步服务端分域部署的自建场景）。
 *
 * ## 🔴 这条默认值**只**用在这里，不许蔓延
 *
 * 它回答的是「**此刻没有已知地址**时该发给谁」，不是「任何令牌都该向哪台服务端校验」。
 * 两个地方**明确不能**换成它：
 *
 *   - `pending-login.ts` 消费回跳会话时用的 `loginBaseUrl` —— 那是**签发这枚令牌的那台
 *     服务端**自己报的地址。应用可能与它不同域（反代、自建、`VITE_SYNC_URL` 覆盖），
 *     拿来源顶替会把令牌发到错的地方（那边的注释写着同一条理由）。
 *   - 同步配置里"用户是否已配置服务端"这件事（见下一节）。
 *
 * ## ⚠️ 预填 ≠ 已配置
 *
 * 空的 `baseUrl` 在 `packages/app-host/src/host.ts` 里是**纯本地模式**（§3.5 那条
 * "本地优先"的落点），不是错误状态。所以这个默认值**不能**写进 `useSyncStore.baseUrl`：
 * 那会让一个从未碰过同步的用户被当成"已配置服务端"，同步栏从此开始报错。
 * 它只在**用户主动发起一次认证动作**的那一刻生效 —— 而那次动作成功之后，
 * `applyAuthSession` 才会真的把地址写进同步配置（那才是"用户选择了云端"的时刻）。
 */

/**
 * 读到并校验构建期的 `VITE_SYNC_URL`。
 *
 * 每次调用都重新读 `import.meta.env`（不在模块顶层读一次）：顶层读会把它固化下来，
 * 测试就覆盖不到"配了 / 没配"两种状态，而这两种都是真实部署形态。
 *
 * @returns 去掉末尾斜杠的绝对地址；未配置、为空串、协议不是 http/https 时 `null`。
 */
function configuredSyncUrl(): string | null {
  const raw: unknown = import.meta.env.VITE_SYNC_URL;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === '') return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  } catch {
    return null;
  }
  return trimmed;
}

/**
 * 认证动作的目标服务端地址（**不带尾斜杠**）。
 *
 * 优先级：`VITE_SYNC_URL` → 已保存的同步地址 → 当前来源。
 *
 * @param configuredBaseUrl `useSyncStore.baseUrl`（用户已配置的那台）。空串表示没配过。
 */
export function authBaseUrl(configuredBaseUrl = ''): string {
  const configured = configuredBaseUrl.trim().replace(/\/+$/, '');
  if (configured !== '') return configured;
  return configuredSyncUrl() ?? window.location.origin;
}

/**
 * `baseUrl` 是不是"没配"的状态（用于判断要不要显示「这台服务端」那句说明）。
 *
 * 单独一个函数是为了让面板里不出现 `baseUrl === ''` 这种**裸比较** ——
 * 它曾经同时承担"未配置"和"应该显示地址输入框"两个意思，而后者正是那道墙。
 */
export function isUnconfigured(baseUrl: string): boolean {
  return baseUrl.trim() === '';
}
