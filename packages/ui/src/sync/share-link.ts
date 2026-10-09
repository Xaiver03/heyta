/**
 * W6 分享链接的**模型骨架**（ADR-0062 决策 2：链接 = 入群凭证，不含密钥）。
 * =====================================================================
 *
 * 链接形状：`{baseUrl}/share/join?token={一次性 token}`。
 *
 * 🔴 token 是服务端 `ShareInvitation` 的一次性凭证（库里只有 sha256）；
 * **清单密钥永不进 URL**——那是「链接即密钥」被拒绝的方案（ADR-0062
 * 拒绝的方案第 3 条：泄露即永久、无法撤回）。链接的吊销/过期/单次有效
 * 全由服务端的邀请生命周期管（W2 已落地）。
 */

const JOIN_PATH = '/share/join';

/** 拼接入群链接。`baseUrl` 不带尾斜杠；`token` 由 ShareApiClient 的邀请响应给出。 */
export const buildShareJoinLink = (baseUrl: string, token: string): string => {
  if (!baseUrl) throw new Error('baseUrl is required');
  if (!token) throw new Error('token is required');
  const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${cleanBase}${JOIN_PATH}?token=${encodeURIComponent(token)}`;
};

/** 从链接或粘贴文本里解析出 token；不是入群链接 ⇒ undefined（调用方报"无效"）。 */
export const parseShareJoinLink = (input: string): string | undefined => {
  try {
    const url = new URL(input.trim());
    if (url.pathname !== JOIN_PATH) return undefined;
    const token = url.searchParams.get('token');
    return token ?? undefined;
  } catch {
    // 容忍裸 token 直接粘贴（宿主先试 URL、再试裸 token）。
    return undefined;
  }
};
