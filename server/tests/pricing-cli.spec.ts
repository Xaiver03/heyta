/**
 * `server/scripts/pricing.ts` 的**参数解析**。
 *
 * 🔴 这是那个 CLI 唯一被自动化覆盖的部分，而且是刻意的：写库那一段走的是
 * `pricing-store.ts` 的写入口（已有 PGlite + 真库两层覆盖），而这个解析器
 * 是运营者与那些入口之间**唯一**的自定义逻辑。
 *
 * 它值得一个 spec，因为它的失败模式是**收错钱**：
 *   - 把 `¥99` 当成 99 分（差 100 倍）；
 *   - 把不认识的 `--amout-minor`（拼错）静默忽略，于是用了默认价；
 *   - 把 `--currency cny` 原样塞进去，于是查询命中不了任何版本。
 * 所以下面每条"拒绝"都是一个**必须红**的用例，不只是"顺手也测一下"。
 */
import { describe, expect, it } from 'vitest';

import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  PRICING_COPY_SITES,
  PricingCliUsageError,
  describeCopyFootprint,
  parsePricingCommand,
} from '../scripts/pricing';

const NOW = 1_760_000_000_000; // 固定时钟 —— 断言里不该出现 Date.now()

/** 跑一次解析，断言它**抛**用法错误，并返回那句话（给需要看措辞的用例用）。 */
const expectUsageError = (argv: readonly string[]): string => {
  try {
    parsePricingCommand(argv, NOW);
  } catch (error) {
    expect(error).toBeInstanceOf(PricingCliUsageError);
    return (error as Error).message;
  }
  throw new Error(`期望用法错误，但它通过了：${argv.join(' ')}`);
};

/** 替换某个选项的值（而不是追加一个同名选项 —— 那会变成"重复选项"错误）。 */
const withFlag = (argv: readonly string[], flag: string, value: string): string[] => {
  const out = [...argv];
  const index = out.indexOf(flag);
  if (index === -1) throw new Error(`测试自己写错了：${flag} 不在参数里`);
  out[index + 1] = value;
  return out;
};

describe('pricing CLI · 参数解析', () => {
  describe('help', () => {
    it('空参数给出用法', () => {
      expect(parsePricingCommand([], NOW)).toEqual({ kind: 'help' });
    });

    it.each([['help'], ['--help'], ['-h']])('%s 也给出用法', (token) => {
      expect(parsePricingCommand([token], NOW)).toEqual({ kind: 'help' });
    });
  });

  describe('show', () => {
    it('不带选项时解析成 show', () => {
      expect(parsePricingCommand(['show'], NOW)).toEqual({ kind: 'show' });
    });

    it('show 后面跟选项就报错（不静默忽略）', () => {
      expect(expectUsageError(['show', '--actor', 'ops'])).toContain('show 不接受任何选项');
    });
  });

  describe('set-price', () => {
    /** 一组完整、合法的 set-price 选项。每个用例只改一处，好让失败指向那一处。 */
    const SET_PRICE_FLAGS: Readonly<Record<string, string>> = {
      '--price-id': 'annual',
      '--currency': 'CNY',
      '--amount-minor': '9900',
      '--actor': 'ops@heyta',
      '--note': '调价',
    };

    const argvOf = (flags: Readonly<Record<string, string>>): string[] => {
      const argv = ['set-price'];
      for (const [flag, value] of Object.entries(flags)) argv.push(flag, value);
      return argv;
    };
    const base = argvOf(SET_PRICE_FLAGS);

    it('完整参数解析出金额、币种、actor、note', () => {
      expect(parsePricingCommand(base, NOW)).toEqual({
        kind: 'set-price',
        priceId: 'annual',
        currency: 'CNY',
        amountMinor: 9_900,
        effectiveFrom: NOW,
        actor: 'ops@heyta',
        note: '调价',
      });
    });

    it('🔴 金额按**最小单位整数**读：9900 是 ¥99，不是 ¥9900', () => {
      const command = parsePricingCommand(base, NOW);
      expect(command).toMatchObject({ amountMinor: 9_900 });
    });

    it('🔴 拒绝小数金额（写成 99.00 就是在用元当单位，收的钱会差 100 倍）', () => {
      expect(expectUsageError(withFlag(base, '--amount-minor', '99.00'))).toContain('最小单位的整数');
    });

    it('🔴 拒绝 0 元价格（不可支付的价格不是价格）', () => {
      expect(expectUsageError(withFlag(base, '--amount-minor', '0'))).toContain('≥ 1 的整数');
    });

    it('🔴 拒绝负数金额', () => {
      expect(expectUsageError(withFlag(base, '--amount-minor', '-9900'))).toContain('最小单位的整数');
    });

    it('币种大小写不敏感，归一化成大写', () => {
      expect(parsePricingCommand(withFlag(base, '--currency', 'cny'), NOW)).toMatchObject({ currency: 'CNY' });
    });

    it('🔴 拒绝不存在的币种（否则查询命中不了任何版本，价格悄悄不生效）', () => {
      expect(expectUsageError(withFlag(base, '--currency', 'JPY'))).toContain('CNY 或 USD');
    });

    it('--effective-from 接受 epoch 毫秒', () => {
      expect(parsePricingCommand([...base, '--effective-from', '1767225600000'], NOW)).toMatchObject({
        effectiveFrom: 1_767_225_600_000,
      });
    });

    it('--effective-from 接受 ISO-8601', () => {
      expect(parsePricingCommand([...base, '--effective-from', '2026-01-01T00:00:00Z'], NOW)).toMatchObject({
        effectiveFrom: Date.parse('2026-01-01T00:00:00Z'),
      });
    });

    it('缺省 --effective-from 就是"现在"，不是 0', () => {
      expect(parsePricingCommand(base, NOW)).toMatchObject({ effectiveFrom: NOW });
    });

    it('🔴 拒绝无法解析的 --effective-from（不退回"现在"——那会立刻改价）', () => {
      expect(expectUsageError([...base, '--effective-from', '下周一'])).toContain('既不是 epoch 毫秒');
    });

    it.each(['--price-id', '--currency', '--amount-minor', '--actor', '--note'])(
      '缺少 %s 时报错',
      (flag) => {
        const { [flag]: _omitted, ...rest } = SET_PRICE_FLAGS;
        expect(expectUsageError(argvOf(rest))).toContain(flag);
      },
    );

    it('空的 --note 也算缺失（审计里"为什么改"是必填）', () => {
      expect(expectUsageError(withFlag(base, '--note', '   '))).toContain('--note');
    });
  });

  describe('coupon-upsert / coupon-disable', () => {
    it('coupon-upsert 解析出文件路径', () => {
      expect(parsePricingCommand(['coupon-upsert', '--file', './coupon.json', '--actor', 'ops', '--note', '发券'], NOW)).toEqual({
        kind: 'coupon-upsert',
        file: './coupon.json',
        actor: 'ops',
        note: '发券',
      });
    });

    it('coupon-disable 解析出券 id', () => {
      expect(parsePricingCommand(['coupon-disable', '--coupon-id', 'launch-2026', '--actor', 'ops', '--note', '结束'], NOW)).toEqual({
        kind: 'coupon-disable',
        couponId: 'launch-2026',
        actor: 'ops',
        note: '结束',
      });
    });

    it('coupon-disable 缺 --coupon-id 报错', () => {
      expect(expectUsageError(['coupon-disable', '--actor', 'ops', '--note', '结束'])).toContain('--coupon-id');
    });
  });

  describe('严格性（这张表就是"收错钱"的入口）', () => {
    it('🔴 拼错的选项必须报错，不能静默忽略（否则用了默认价还以为改了）', () => {
      expect(expectUsageError(['set-price', '--amout-minor', '9900', '--actor', 'ops', '--note', 'x'])).toContain('不认识的选项');
    });

    it('🔴 同一个选项出现两次报错（不猜他想用哪一个）', () => {
      expect(expectUsageError(['set-price', '--actor', 'a', '--actor', 'b', '--note', 'x'])).toContain('出现了两次');
    });

    it('选项后面缺值时报错', () => {
      expect(expectUsageError(['coupon-disable', '--coupon-id', '--actor', 'ops', '--note', 'x'])).toContain('缺一个值');
    });

    it('不认识子命令时报错', () => {
      expect(expectUsageError(['refund-everything', '--actor', 'ops'])).toContain('不认识命令');
    });
  });
});

/**
 * 改价之后"还有哪些地方在撒谎"。
 *
 * 这一组钉的是这个仓库里**唯一**能被自动断言的一致性缺口：`pnpm check:pricing`
 * 只校验代码基线 / 中英词条 / 法务 / `pricing-ssot` 这四处**代码侧**文件是否自洽，
 * 它**不读数据库**（CI 没有 PostgreSQL）。于是"库里的价改了、文案没改"这件事
 * 没有任何门禁能发现 —— 只能由 CLI 在改价那一刻说出来。
 *
 * 所以下面分别钉：**说**（两个数字都要在，只讲"不一致"等于没讲）、
 * **说全**（每一个落点都要点名）、**清单本身不许过期**
 * （点名的文件必须真的存在 —— 本仓库踩过"注释点名了一个不存在的脚本"的坑）。
 */
describe('pricing CLI · 改价后的文案足迹', () => {
  const BASE = { priceId: 'hosted-ai-monthly', currency: 'CNY' } as const;

  it('库里与代码基线一致 → 什么都不报', () => {
    expect(describeCopyFootprint({ ...BASE, baselineMinor: 1_200, effectiveMinor: 1_200 })).toBeNull();
  });

  it('🔴 库里改了、基线没改 → 两个数字都报出来', () => {
    const msg = describeCopyFootprint({ ...BASE, baselineMinor: 1_200, effectiveMinor: 1_500 });
    expect(msg).not.toBeNull();
    expect(msg).toContain('¥15.00'); // 收银台会收的
    expect(msg).toContain('¥12.00'); // 页面会印的
    expect(msg).toContain('hosted-ai-monthly/CNY');
  });

  it('🔴 报出**每一个**落点（漏一个，就有一处文案会撒谎）', () => {
    const msg = describeCopyFootprint({ ...BASE, baselineMinor: 1_200, effectiveMinor: 1_500 });
    for (const site of PRICING_COPY_SITES) expect(msg).toContain(site.path);
  });

  it('🔴 清单里的文件必须**真的存在**（否则清单自己就在撒谎）', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    for (const site of PRICING_COPY_SITES) {
      expect(
        existsSync(path.join(repoRoot, site.path)),
        `文案清单里的 ${site.path} 不存在 —— 清单已漂移`,
      ).toBe(true);
    }
  });

  it('改低也要报（降价同样会让文案撒谎）', () => {
    expect(describeCopyFootprint({ ...BASE, baselineMinor: 1_500, effectiveMinor: 1_200 })).not.toBeNull();
  });
});
