import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_BOOK, SKU_GRANTS, grantsForSku } from '../src/billing/price-book';
import { ENTITLEMENT_CAPABILITIES } from '../src/entitlement';

/**
 * 「SKU → 能力」这张表是**两档真的可分**的基础。
 *
 * 在这里之前，一次支付只带 `periodDays`，于是 ¥5 与 ¥12 会写进同一行订阅、
 * 得到完全一样的结果 —— 用户付 ¥12 拿到 ¥5 的东西，且没有任何代码能发现。
 *
 * 这一组测试**不碰数据库**：它钉的是"表本身自洽"，而"表与另一处说法一致"
 * （法务 / 词条 / `pricing-ssot`）由 `pnpm check:pricing` 在门禁层钉。
 */
describe('SKU → 能力（两档可分的基础）', () => {
  it('两个 SKU 的能力集合**不同** —— 这就是 ¥5 与 ¥12 的全部区别', () => {
    expect(SKU_GRANTS['hosted-monthly']).toEqual(['hosting']);
    expect(SKU_GRANTS['hosted-ai-monthly']).toEqual(['hosting', 'ai', 'automation']);
    // 反向断言：这两行一旦相等，"两档"就只剩价格不同、交付完全一样。
    expect(SKU_GRANTS['hosted-monthly']).not.toEqual(SKU_GRANTS['hosted-ai-monthly']);
  });

  it('🔴 价目表里的每个 SKU 都必须在能力表里有条目', () => {
    // 这是"两处不同步"的守卫，后果很具体：`verifyWebhook` 先按金额查价目表
    // 拿到 priceId，再查能力表 —— 第二步落空会让一笔**正常付款**拿不到任何
    // 能力，而事件类型落在 `payment_amount_mismatch` 上，看起来像用户付错了钱。
    for (const entry of DEFAULT_PRICE_BOOK) {
      expect(grantsForSku(entry.priceId), `价目表有 ${entry.priceId}，能力表没有`).not.toBeNull();
    }
  });

  it('🔴 能力词表与 `ENTITLEMENT_CAPABILITIES` 同源', () => {
    // 判定层只认识那两个词。这里声明了别的词，判定会**静默**把用户判成
    // "没有这一项" —— 而用户其实付过钱了。
    const known = new Set<string>(ENTITLEMENT_CAPABILITIES);
    for (const [sku, grants] of Object.entries(SKU_GRANTS)) {
      for (const grant of grants) {
        expect(known.has(grant), `${sku} 声明了判定层不认识的能力：${grant}`).toBe(true);
      }
    }
  });

  it('🔴 未知 SKU 返回 `null`，**不是**空数组', () => {
    // 两者语义不同，混起来很危险：`[]` 是"这一档确定不授予任何能力"（合法声明），
    // `null` 是"我们不知道这个 SKU 是什么"（两张表不同步）。调用方对前者的处理是
    // "照常授予零项"，对后者必须是"不要授予，并告警"。
    expect(grantsForSku('no-such-sku')).toBeNull();
    expect(grantsForSku('')).toBeNull();
    // 而一个真实存在的 SKU 必须拿到数组（哪怕是空的）。
    expect(Array.isArray(grantsForSku('hosted-monthly'))).toBe(true);
  });

  it('能力集合里没有重复项', () => {
    // 重复不会让判定出错，但会让"包含 ai 吗"这类读法产生歧义，
    // 而且它是复制粘贴时的典型失误。
    for (const [sku, grants] of Object.entries(SKU_GRANTS)) {
      expect(new Set(grants).size, `${sku} 的能力集合有重复`).toBe(grants.length);
    }
  });
});
