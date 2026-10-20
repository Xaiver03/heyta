/**
 * 商户订单号的**生成与解析**。
 *
 * 🔴 从 `wechat.adapter.ts` 搬出来，因为**它本来就不是微信的东西**：
 * 这个号是**我们自己**生成的，微信只是碰巧是第一个用它的通道。
 * 放在 adapter 里造成两个后果：别的模块（`checkout.routes`）要"借用"一个
 * 与 provider 无关的函数，而且**名字在说假话** —— 读的人会以为换通道就要换它。
 *
 * 收单收回统一支付中心之后，它仍然被 `/billing/checkout` 使用，
 * 所以它不是死代码，是**位置放错了**。
 *
 * ⚠️ 格式是对外契约（库里已有单号、中心侧也认它），搬迁**一字未改**：
 *   `hy<uid 的 36 进制>x<unix 秒的 36 进制>x<8 字节随机 hex>`
 * 长度 ~28 字符。
 */

/** 把 userId 编进订单号，是为了在回调丢字段时仍有**兜底的用户归属**。 */
export const buildOutTradeNo = (
  userId: number,
  nowMs: number,
  randomHex: string,
): string => {
  const uid = Math.trunc(userId).toString(36);
  const ts = Math.floor(nowMs / 1000).toString(36);
  return `hy${uid}x${ts}x${randomHex}`;
};

const OUT_TRADE_NO_PATTERN = /^hy([0-9a-z]+)x[0-9a-z]+x[0-9a-f]+$/;

/** 从商户订单号里取回 userId；不符合格式返回 `null`。 */
export const parseUserIdFromOutTradeNo = (outTradeNo: string): number | null => {
  const match = OUT_TRADE_NO_PATTERN.exec(outTradeNo);
  if (match === null) return null;
  const id = Number.parseInt(match[1], 36);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
