/**
 * 词条表对账测试。
 *
 * 类型系统已经拦住了「少一条」和「多一条」，但那是**编译期**成果 ——
 * 测试在这里做的是另一件事：把约束**钉成可执行的断言**，
 * 这样将来有人为了图方便把 `satisfies` 改成 `Record<string, string>`
 * 或加了 `...spread`，测试会红，而不是静默失去保护。
 */
import { describe, expect, it } from 'vitest';

import { CATALOGS, DEFAULT_LOCALE, LOCALES, translate } from '../src/index.js';
import { en } from '../src/locales/en.js';
import { zhCN, type MessageKey } from '../src/locales/zh-CN.js';

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

describe('词条表完整性', () => {
  it('中英两表的 key 集合完全一致（双向）', () => {
    const zhKeys = Object.keys(zhCN).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it('中文表每一条都含汉字 —— 防止用英文占位中文', () => {
    const bad = Object.entries(zhCN)
      .filter(([, value]) => !CJK.test(value))
      .map(([key]) => key);
    /**
     * 品牌名与语言自称这类纯拉丁词是已知例外，显式列出而不是放宽整条规则。
     *
     * 🔴 站点侧那七条**不是"漏翻"、也不该被"翻译"**：它们是
     * **名称、命令与文件路径**。
     *   - `site.platforms.{web,android,ios}.name` —— 平台的名字（Web / Android / iOS）。
     *     译成"安卓"会让"照这个名字去搜安装包"这件事变难；
     *   - `site.platforms.*.evidence` —— 用户要**照着敲**的命令与路径。
     *     翻译一份命令，等于让它跑不起来；
     *   - `site.pricing.compare.row.ai` —— "AI"在这个产品里的意思就是 AI。
     *
     * 所以这一条白名单与 `common.brand` 是同一类：**它们本来就不该有汉字**。
     * 按 key 列出（而不是放宽整条规则）仍然重要 —— 放宽会让"把英文占位当中文交差"
     * 一起溜过去，而那正是这条测试存在的理由。
     */
    const allowed = new Set<string>([
      'common.brand',
      'common.lang.en',
      'site.pricing.compare.row.ai',
      'site.platforms.web.name',
      'site.platforms.android.name',
      'site.platforms.ios.name',
    ]);
    /**
     * 🔴 `.evidence` 是**按后缀**开的第二类例外，而不是逐 key 列。
     *
     * 理由：这类词条的值**只能**是命令或文件路径（`pnpm verify:…`、
     * `docs/adr/….md`），而它们**不该被翻译** —— 翻译一份命令等于让它跑不起来。
     * 逐 key 列会在每次给页面加一条验证方式时都要改这个文件，而那种来回
     * 会让下一个人倾向于"干脆放宽整条规则"（那才是真正危险的）。
     *
     * 后缀规则仍然是**窄**的：key 的名字必须明说它装的是证据（`*.evidence`），
     * 而"把英文占位当中文交差"不会恰好取这种名字。
     * 语义由 `site.evidence.label`（"验证方式"）提供，不是靠词条本身。
     */
    const evidenceSuffix = /\.evidence$/;
    expect(bad.filter((key) => !allowed.has(key) && !evidenceSuffix.test(key))).toEqual([]);
  });

  it('英文表每一条都不含汉字 —— 防止把中文复制过来当英文交差', () => {
    const bad = Object.entries(en)
      .filter(([, value]) => CJK.test(value))
      .map(([key]) => key);
    /**
     * 🔴 唯一例外：**语言自称**。
     *
     * 英文界面上的切换器必须显示「中文」—— 那正是给"看不懂英文"的用户看的入口，
     * 写成 "Chinese" 对他就没有用了。所以 `common.lang.zh` 在中英两表里
     * **刻意是同一个词**。
     *
     * 这条白名单是**按 key** 开的，不是放宽整条规则：放宽会让
     * "把中文复制过来当英文交差"也一起溜过去，而那正是这条测试存在的理由。
     */
    const endonym = new Set<string>(['common.lang.zh']);
    expect(bad.filter((key) => !endonym.has(key))).toEqual([]);
  });

  it('每一种 Locale 都有对应的词条表', () => {
    for (const locale of LOCALES) {
      expect(CATALOGS[locale]).toBeDefined();
    }
  });

  it('词条里没有空字符串', () => {
    const empty = Object.entries(zhCN)
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });
});

describe('translate()', () => {
  it('按语言返回对应文案', () => {
    expect(translate('zh-CN', 'landing.nav.capabilities')).toBe('能力');
    expect(translate('en', 'landing.nav.capabilities')).toBe('Capabilities');
  });

  it('替换 {name} 占位符', () => {
    expect(translate('zh-CN', 'landing.showcase.hint', { label: '番茄钟' })).toBe(
      '当前显示：番茄钟',
    );
    expect(translate('en', 'landing.showcase.hint', { label: 'Focus timer' })).toBe(
      'Now showing: Focus timer',
    );
  });

  it('缺变量时保留占位符本身，而不是渲染 undefined', () => {
    // 渲染成 `undefined` 会被误当成一句正常文案；保留 `{label}` 一眼看得出漏了变量。
    expect(translate('zh-CN', 'landing.showcase.hint')).toBe('当前显示：{label}');
    expect(translate('zh-CN', 'landing.showcase.hint', { other: 1 })).toBe('当前显示：{label}');
  });

  it('数字变量会被转成字符串', () => {
    expect(translate('zh-CN', 'landing.showcase.hint', { label: 3 })).toBe('当前显示：3');
  });

  it('未翻译的 key 不会在运行时静默降级（类型系统已拦住，这里验证取值路径）', () => {
    // 若将来真的传入一个不在表里的 key，translate 会取到 undefined 并抛错，
    // 而不是返回 key 本身 —— 后者会把内部 key 渲染给用户。
    const missingKey = 'landing.not.a.real.key' as MessageKey;
    expect(() => translate(DEFAULT_LOCALE, missingKey)).toThrow();
  });
});
