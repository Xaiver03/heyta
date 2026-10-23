/**
 * 协作验收的逐 op 签名两件（ADR-0069 / 计划 M4）
 * ==============================================
 *
 * ## 为什么住 `scripts/lib` 而不是各脚本自己抄一份
 *
 * `verify-collab-{sync,revoke,conflict}.mjs` 三套都要以**真成员**的身份上传 op：服务端上传边界
 * 自 M4 起拒无签（裁决六），所以"手搓一条原始 op 就能上行"这条验收通道**已经不存在了**。
 * 一份装配抄三处 ⇒ 三处迟早漂一点，而漂一点的症状是"某一套验收把一枚合法签名读成失败"——
 * 与真 bug 长得一模一样，这正是本仓一直防的那一形。
 *
 * 🔴 **这里不重新实现签名**。`signShareOpWire` 取自 `@heyta/sync-core` 的构建产物，
 * 与生产写侧（`packages/app-host/src/share-client.ts` 里那一次调用）是同一个函数、同一个域定义。
 * 验收脚本换掉的只有"私钥握在谁手里"（脚本自己派生一枚，代替设备保险库），
 * 不是"哪些字节进签名域"。
 *
 * ⚠️ 因此这三套脚本量的是**服务端上传边界 + 线协议**那一半；写侧"宿主拿不到签名件就零请求"
 * 那一半由 `packages/app-host` 的判据与 `verify:collab-journey`（真浏览器 + 真保险库）量。
 */

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

/**
 * 成员**自证**发布签名公钥（`PUT /shares/:id/members/:memberId/signing-key`，ADR-0069 裁决二）。
 *
 * 走这一条而不是在 `POST /invitations/accept` 的载荷里带，是因为 owner 那一行不是"接受邀请"进来的
 * —— 它是建共享时服务端自己造的成员行，而**服务端不许代填公钥**（那等于把"这条 op 是谁写的"
 * 的判定权交给被对抗的那一方）。所以 owner 用的是界面上"补发"那同一条腿。
 */
export const publishSigningKey = async (api, { shareId, memberId, token, ed25519PublicKey }) =>
  api('PUT', `/api/shares/${shareId}/members/${memberId}/signing-key`, token, {
    signingPublicKey: toBase64(ed25519PublicKey),
  });

/**
 * 给一条**将要上传**的线 op 补上签名，返回新对象（不改入参）。
 *
 * 🔴 `clientTimestamp` 这一枚改名在这里做，不在各调用点做：线 op 上叫 `timestamp`、
 * 库里叫 `client_timestamp`、下载回来又叫 `clientTimestamp`（`ShareOpWireForSignature` 按域里
 * 那个名字声明）。三处调用点各写一次映射，就多出三次填错名字的机会 —— 错的那一份**照样能上传**
 * （服务端只比对字节），症状是每台非签名者的设备把这枚合法签名读成失败。
 */
export const signWireOp = (core, { shareId, memberId, ed25519SecretKey, op }) => ({
  ...op,
  signature: core.signShareOpWire(ed25519SecretKey, {
    shareId,
    signerMemberId: memberId,
    wire: { ...op, clientTimestamp: op.timestamp },
  }),
});

/**
 * 成员表响应 ⇒ 读侧验签名单（`{成员行 id: 签名公钥 base64}`）。
 *
 * 与 `apps/web/src/features/share/comment-actions.ts` 的 `verifiersFor` 同一份推导：
 * 键必须是**成员行 id**（服务端把 `signer_member_id` 存的就是它），不是用户 id ——
 * 拿错那一列的形态与"有人在改数据"在界面上分不开。
 */
export const rosterFromMembers = (membersJson) => {
  const roster = {};
  for (const m of membersJson?.members ?? []) {
    if (typeof m.memberId === 'string') roster[m.memberId] = m.signingPublicKey ?? null;
  }
  return roster;
};
