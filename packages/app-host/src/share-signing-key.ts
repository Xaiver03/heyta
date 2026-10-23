/**
 * 把自己那枚 Ed25519 **签名**公钥送上成员行（ADR-0069 裁决二）。
 * ================================================================
 *
 * 为什么这一格要单独存在（而不是"顺手在 accept 里带一下就完了"）：
 *
 * - `accept` 那条腿只对**新入群**的人有效。已经在册的成员 —— 包括 owner，他的成员行
 *   甚至是 `identityPublicKey` 都没有的空行 —— 需要一个能反复走的通道，否则升级完
 *   服务端开始验签（M4-3）之后，这些人的每一条共享 op 都会被拒，而且**没有任何一格
 *   能自己修**（B-10 那一格就是这么踩出来的）。
 * - 补发只做一件事：把公钥写进去。**不动信封、不换密钥世代、不产生 op** ——
 *   那三件事各有自己的入口，混在一起就会让"我只是补了个公钥"变成一次全员重封。
 *
 * 🔴 三条纪律，都由本文件的三态出口钉住：
 *
 * 1. **同值不重发**（`unchanged`）：面板每 3 秒对一次账，每次都发就成了每 3 秒一次写。
 * 2. **异值不覆盖**（`conflict`）：签名公钥代表"这把私钥的主人是谁"。静默换钥会把
 *    这个人此前的所有 op 在读侧翻成"验不过"，而协议上没有任何地方能说出"他换过钥"。
 *    真要换钥的那天得先给读侧一个可判定的世代（翻案条件见 ADR-0069 §六），
 *    所以这里**不发请求**，把冲突如实交回调用方，由界面说清楚。
 * 3. **网络失败不吞**：让它抛出去。这一格抛出的代价是"这台设备暂时发不出共享 op"，
 *    吞掉的代价是"用户以为在册、服务端那边根本没有"。
 */

/** 补发端口的最小形状：`ShareApiClient.putMemberSigningKey` 结构上就满足它。 */
export interface ShareSigningKeyPublishPort {
  putMemberSigningKey(shareId: string, memberId: string, signingPublicKey: string): Promise<unknown>;
}

/**
 * 三态是**封闭词表**：调用方拿到的一律是这三个字面量之一，
 * 于是"没发布"这件事不可能被读成"发布成功了"。
 */
export type ShareSigningKeyPublishOutcome = 'published' | 'unchanged' | 'conflict';

export async function publishShareSigningKey(args: {
  api: ShareSigningKeyPublishPort;
  shareId: string;
  memberId: string;
  /** 本机自证出来的公钥（编码与服务端 `identityPublicKey` 同一套：base64，32 字节）。 */
  signingPublicKey: string;
  /** 服务端成员行上当前那枚；缺省/`null` 都表示"还没在册"。 */
  registeredPublicKey?: string | null;
}): Promise<ShareSigningKeyPublishOutcome> {
  const registered = args.registeredPublicKey ?? null;
  if (registered === null) {
    await args.api.putMemberSigningKey(args.shareId, args.memberId, args.signingPublicKey);
    return 'published';
  }
  if (registered === args.signingPublicKey) return 'unchanged';
  return 'conflict';
}
