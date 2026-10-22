/**
 * 转让所有权失败时「这一发该给用户看哪句」的判定（B-10 的宿主侧收口）。
 *
 * 为什么住 `app-host` 而不是外壳：这条判断决定的是**服务端那个具名错误在业务上意味着什么**
 * （AGENTS §3.5 —— 外壳里不许有决定业务取向的行）。外壳只把结论翻成一句文案。
 *
 * 为什么按 `{status, code}` 这两个原始值比，而不是接 `ShareApiError` 本体：
 * `@heyta/sync-client` 是传输层，让 app-host 依赖它会为了一枚字符串常量拉进整条链。
 * 码值本身是线上契约，写死在这里的是一份**抄件**，所以把它和 sync-client 的常量
 * 用一条测试钉在一起（见 `tests/share-transfer-error.spec.ts` 的"两头对账"那一臂）。
 */
export type ShareTransferFailure = 'target-unsealed' | 'other';

/** 服务端 B-10 门的具名错误码（`packages/sync-client` 的 `SHARE_ERROR_CODES.TRANSFER_TARGET_UNSEALED`）。 */
export const SHARE_TRANSFER_TARGET_UNSEALED_CODE = 'SHARE_TRANSFER_TARGET_UNSEALED';

export function shareTransferFailure(input: {
  status?: number;
  code?: string;
}): ShareTransferFailure {
  return input.status === 409 && input.code === SHARE_TRANSFER_TARGET_UNSEALED_CODE
    ? 'target-unsealed'
    : 'other';
}
