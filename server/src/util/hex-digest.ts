import { timingSafeEqual } from 'node:crypto';

/**
 * 两枚 hex 摘要的时序安全比较 —— 长度守卫必须在 `timingSafeEqual` **之前**。
 *
 * 为什么单独一枚：`login-otp.ts` 与 `registration-otp.ts` 各写过一份逐字相同的四行
 * （`node research/tools/audit-duplicate-function-bodies.mjs --scope server/src/password` 判红的那一枚）。
 * 这不是一处"难看但无害"的重复 —— 谁在重构时把 `a.length === b.length` 那半句漏掉，
 * `timingSafeEqual` 就会在长度不等时**抛异常**（而不是返回 false），而调用点把它当"码不对"处理；
 * 更糟的是长度差本身会走完全不同的异常路径，等于把摘要长度泄成一条可观测的旁路。
 */
export const sameHexDigest = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};
