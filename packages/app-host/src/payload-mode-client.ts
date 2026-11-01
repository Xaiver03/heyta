import { SYNC_PAYLOAD_MODE_PATHS, syncPayloadModeResponseSchema } from '@heyta/shared-schema';

/**
 * 读服务端上这个账号的**载荷模式**（ADR-0080）。
 *
 * ## 为什么宿主必须自己读，而不是等界面告诉它
 *
 * 模式决定"该往线上写密文还是明文"。写错方向服务端会 400（两个方向都拒错配），
 * 于是症状是**同步全红**，而用户什么都没改。界面那个开关只是控制面；
 * 自动同步、后台同步也要拿到同一个答案，所以读取点必须在宿主里。
 *
 * ## fail-closed 到 `e2ee`
 *
 * 读不到（网络、404、坏 JSON、形状不对）一律按加密账号处理。反过来猜 `plain`
 * 等于因为一次读失败就把明文写上去 —— 那是不可逆的。
 */
export type HostPayloadMode = 'e2ee' | 'plain';

export interface PayloadModeReadOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  authTransport?: 'bearer' | 'cookie';
}

export const payloadModeUrl = (baseUrl: string): string =>
  `${baseUrl.replace(/\/+$/, '')}/api/${SYNC_PAYLOAD_MODE_PATHS.mode}`;

export async function readRemotePayloadMode(
  options: PayloadModeReadOptions,
): Promise<HostPayloadMode> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  try {
    const response = await fetchImpl(payloadModeUrl(options.baseUrl), {
      method: 'GET',
      headers: options.authTransport === 'cookie'
        ? { accept: 'application/json' }
        : { accept: 'application/json', authorization: `Bearer ${options.token}` },
      credentials: options.authTransport === 'cookie' ? 'include' : 'same-origin',
    });
    if (!response.ok) return 'e2ee';
    const parsed = syncPayloadModeResponseSchema.safeParse(await response.json());
    if (!parsed.success) return 'e2ee';
    return parsed.data.mode === 'readable' ? 'plain' : 'e2ee';
  } catch {
    return 'e2ee';
  }
}
