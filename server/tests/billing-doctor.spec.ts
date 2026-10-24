/**
 * `server/scripts/billing-doctor.ts` 的判据
 * =========================================
 *
 * 那个脚本是**给运营看的一屏读数**，而它最容易坏的方式有两种，都不会自己报错：
 *
 *   1. **闸门顺序写歪**：它按 ① → ②′ → ④ 的顺序指路。顺序一歪，读数就会说
 *      "这一档能卖"而服务端先撞 ②′ —— 运营照着它去查支付，白查一趟。
 *      这里对账 `checkout.routes.ts` 源码里的闸门编号顺序。
 *   2. **帮助文本过期**：它印出"要开这一项得设哪几枚环境变量"。名字改了而文本没改，
 *      运营会去设一堆不存在的变量，然后以为"配了还是不行"。
 *      这里逐名对账 `config.ts` 的源码。
 *
 * ⚠️ 这两条都是**源码形状**判据（与移动壳那套同族）：它们不证明脚本算得对，
 * 只证明"它引用的东西还在、名字还对得上"。判断本身仍然只能在 `checkout.routes.ts`。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ENV_NAMES, readSellability } from '../scripts/billing-doctor';

const SRC = join(__dirname, '..', 'src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

describe('收款自查脚本：逐档读数', () => {
  it('没有真实收款通道 ⇒ 连不含云端 AI 的那一档也卖不了（④）', () => {
    const readings = readSellability({ config: {}, realProviderCount: 0 });
    const hosted = readings.find((r) => r.priceId === 'hosted-monthly');
    expect(hosted?.blocker).toContain('④');
  });

  it('🔴 没配托管 AI 时，只有授予 ai 的那一档被 ②′ 挡住 —— 另一档照卖', () => {
    const readings = readSellability({ config: {}, realProviderCount: 1 });
    const byId = new Map(readings.map((r) => [r.priceId, r]));
    expect(byId.get('hosted-ai-monthly')?.blocker, '¥12 那档应被 ②′ 挡').toContain('②′');
    expect(byId.get('hosted-monthly')?.blocker, '¥5 那档不该被 ②′ 挡').toBeNull();
  });

  it('配了托管 AI 且通道就绪 ⇒ 两档都不撞闸（报价与降档仍由服务端判）', () => {
    const readings = readSellability({
      config: { managedAi: { baseUrl: 'https://x', apiKey: 'k', modelId: 'm' } },
      realProviderCount: 1,
    });
    expect(readings.every((r) => r.blocker === null)).toBe(true);
  });

  it('任一档都没漏读：读数条数与价目表的 SKU 数一致', () => {
    // 少读一档的症状是"脚本说全都行"，而那正是运营最信的一句话。
    const readings = readSellability({ config: {}, realProviderCount: 1 });
    expect(readings.map((r) => r.priceId).sort()).toEqual(
      ['hosted-ai-monthly', 'hosted-monthly'],
    );
  });
});

describe('收款自查脚本：与真源对账（名字与顺序）', () => {
  it('帮助文本里那几枚环境变量**逐名**都在 `config.ts` 里被读到', () => {
    const config = read('config.ts');
    for (const name of [...ENV_NAMES.paycenter, ...ENV_NAMES.managedAi]) {
      expect(config.includes(name), `config.ts 里已经不读 \`${name}\` 了（帮助文本过期）`).toBe(true);
    }
  });

  it('闸门顺序仍然是 ① → ②′ → ④（脚本按这个顺序指路）', () => {
    const routes = read('billing/checkout.routes.ts');
    const at = (needle: string): number => routes.indexOf(needle);
    const order = [
      at('── ① 这一档今天能不能交付'),
      at('── ②′'),
      at('── ④ 必须有真通道'),
    ];
    expect(order.every((index) => index > -1), '闸门注释标题找不到了（源码结构变了）').toBe(true);
    expect(order, `闸门顺序变了：${order.join(' < ')}`).toEqual([...order].sort((a, b) => a - b));
  });
});
