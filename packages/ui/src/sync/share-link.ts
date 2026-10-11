/**
 * W6 分享链接的**模型骨架**（ADR-0062 决策 2：链接 = 入群凭证，不含密钥）。
 * =====================================================================
 *
 * 链接形状：`{appBaseUrl}?shareToken={一次性 token}`。
 *
 * 🔴 落点是**应用**，不是同步服务器（W6 首跑前的改法裁决）：链接是「给朋友的
 * 凭证载体」，朋友点开它该直接落进应用的加入旅程（token 预填、一键入群），
 * 而不是撞上同步服务器一个不存在的页面。`appBaseUrl` 由宿主传**应用自己的
 * 可分享地址**（web = `location.origin + import.meta.env.BASE_URL`）。
 *
 * 🔴 token 是服务端 `ShareInvitation` 的一次性凭证（库里只有 sha256）；
 * **清单密钥永不进 URL**——那是「链接即密钥」被拒绝的方案（ADR-0062
 * 拒绝的方案第 3 条：泄露即永久、无法撤回）。链接的吊销/过期/单次有效
 * 全由服务端的邀请生命周期管（W2 已落地）。
 */

/** 拼接入群链接。`appBaseUrl` 是应用的可分享地址；`token` 由 ShareApiClient 的邀请响应给出。 */
export const buildShareJoinLink = (appBaseUrl: string, token: string): string => {
  if (!appBaseUrl) throw new Error('appBaseUrl is required');
  if (!token) throw new Error('token is required');
  // 归一到恰好一个尾斜杠：`https://host` / `https://host/app/` 都能拼出稳定形状，
  // 且保留 `/app/` 的尾斜杠（去掉它会让静态托管多一次 301，查询串在跳转链上多一跳）。
  const cleanBase = appBaseUrl.endsWith('/') ? appBaseUrl : `${appBaseUrl}/`;
  return `${cleanBase}?shareToken=${encodeURIComponent(token)}`;
};

/**
 * 从链接或粘贴文本里解析出 token；不是入群链接 ⇒ undefined（调用方回落到
 * 「裸 token 直接粘贴」的分支）。判据只有**查询参数 `shareToken`**，不锁
 * pathname——应用可挂在任何路径（`/`、`/app/`、自托管子路径），把路径写死
 * 会把「同一个应用换个挂载点」错判成「不是我们的链接」。
 */
export const parseShareJoinLink = (input: string): string | undefined => {
  try {
    const url = new URL(input.trim());
    // 空值（`?shareToken=`）不是合法入群凭证 —— 返回 undefined 让调用方回落到
    // 「裸 token 直接粘贴」分支，而不是弹一个 token 栏空着的对话框。
    const token = url.searchParams.get('shareToken');
    return token || undefined;
  } catch {
    return undefined;
  }
};
