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
      // Copyable configuration path and CLI command; translation would break them.
      'web.ai.settings.localApi.source.file',
      'web.ai.settings.localApi.source.command',
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

/**
 * 英文复数安全（先只管 `web.habits.*`）
 * ======================================
 *
 * 🔴 **词条表没有 ICU** —— 没有 `plural(one, other)`，所以"`{count} days`"这种形状
 * 在 `count === 1` 时会渲染出 `1 days`。中文没有单复数，所以这条规则**只对英文成立**，
 * 症状也只出现在英文界面：新建一个只打过一次卡的习惯，读屏念的是
 * `"喝水": 1 check-ins in the last 90 days`。
 *
 * 两种合规形状，这里都接受：
 *   1. **有 `…One` 兄弟词条**，调用方按 `count === 1` 分支（`web.habits.streak.*` 三对）；
 *   2. **句子本身对 1 和 N 都成立** —— 把单位做成连字符复合词（`{count}-day streak`）
 *      或让数字出现在名词**之后**（`Days saved by a freeze in this streak: {count}`）。
 *
 * ⚠️ 为什么先只扫 `web.habits.*`：全表扫会当场报出成长/提醒/AI 那批
 * （`{minutes} minutes` 等 50 余条），那是另一批面的改写工作，
 * 混进来会让这批红挡掉这轮的交付。**这是划界，不是"其他面没有这个问题"** ——
 * 那些 key 同样中招，扩展到它们时应当一次改一面。
 *
 * 📌 这一组是 **2026-10-01** 那次的产物：`web.habits.row.aria` 写成
 * `longest {longest} days, {total} check-ins`，直到移动端清单把这整句拿去当
 * `aria-label` 才被读出来。当时只有"改那一条"，没有"让这一类不能再写进来"。
 *
 * ✅ **变异验证**（2026-10-01，基线 22 passed → 注入 → 按字节恢复 → 22 passed）：
 *
 * | 注入 | 红的用例（恰好这些，无多余） |
 * |---|---|
 * | `web.habits.freeze` 改回 `'Of this streak, {count} days…'` | 扫那条 ⇒ `web.habits.freeze → Of this streak, 1 days were saved by a freeze`（1 红） |
 * | 判据前缀改成不存在的命名空间（候选集变空） | 候选集非空 ⇒ `expected 0 to be >= 20`（1 红） |
 * | `web.habits.row.aria` 改回裸复数名词 | 扫那条 + 连字符形状那条（2 红） |
 *
 * ⚠️ **跑这个验证的第一轮报的是"三条变异都不红"，那是假话** —— 探针按位置
 * 解析 vitest 的汇总行（`Tests N passed | M failed`），而 vitest **不保证顺序**：
 * 有失败时它先印 failed。取不到数就被当成"零失败"。
 * 一般规律：**探针读不到数字时必须响亮地失败**，"没读到"和"读到了 0"是两回事
 * —— 前者会被误播成后者，而后者正是这批判据最想指控的罪名。
 */
describe('英文习惯文案在 count=1 时必须仍然成立', () => {
  // ⚠️ **两个正则不能合成一个**：带 `g` 的 `.test()` 会推进 `lastIndex`，
  // 于是同一个对象在循环里会**隔条漏检** —— 判据看起来在跑，其实只查了一半。
  const FILL = /\{[A-Za-z]+\}/g;
  const HAS_PLACEHOLDER = /\{[A-Za-z]+\}/;
  const HAZARD =
    /\b1 (days|weeks|months|years|hours|minutes|check-ins|checks|tasks|items|times|streaks|runs|notes|lists|tags|subtasks|comments|entries)\b/;

  const withOne = (value: string): string => value.replace(FILL, '1');
  const hasOneSibling = (key: string): boolean => `${key}One` in en;

  const candidates = Object.entries(en).filter(
    ([key, value]) => key.startsWith('web.habits.') && HAS_PLACEHOLDER.test(value) && !hasOneSibling(key),
  );

  it('候选集非空（否则这条规则会因为"没东西可查"而永远绿）', () => {
    expect(candidates.length).toBeGreaterThanOrEqual(20);
  });

  it('逐条把占位符填成 1 后，不出现 `1 <复数名词>`', () => {
    const bad = candidates
      .filter(([, value]) => HAZARD.test(withOne(value)))
      .map(([key, value]) => `${key} → ${withOne(value)}`);
    expect(bad).toEqual([]);
  });

  it('有 `…One` 兄弟的那几条：复数条本身确实危险，单数条才是 1 该走的', () => {
    // 🔴 这条钉的是"排除规则不是漏洞"。删掉 `.currentOne` 或让调用方不再分支，
    // 上面那条候选集会把它算进去并变红 —— 这里先把前提本身证一遍。
    const branched = Object.keys(en).filter(
      (key) => key.startsWith('web.habits.') && hasOneSibling(key) && HAZARD.test(withOne(en[key as MessageKey])),
    );
    expect(branched).toEqual([
      'web.habits.streak.current',
      'web.habits.streak.longest',
      'web.habits.streak.total',
      // 工单 H5 的摘要条（2026-10-06 补）：`everyNDays === 1` 由**共享层**分给 `…intervalOne`
      // （`packages/ui/src/habits/model.ts#habitFrequencySummaryKey`）。写入口本来会把 1 归一成
      // `daily`，所以这一档平时走不到 —— 但这条判据管的是**词表**，不是可达性：
      // 上一轮它就是因为"Every {n} days" 裸着被填成 1 而红，红的是文案，不是路径。
      'web.habits.freq.summary.interval',
    ]);
    for (const key of branched) {
      expect(HAZARD.test(withOne(en[`${key}One` as MessageKey]))).toBe(false);
    }
  });

  it('清单那一整句（`row.aria`）是连字符形状，不是裸复数名词', () => {
    // 这条 key 同时被 web 的 DOM 清单和共享 RN 清单当 `aria-label` 用，
    // 两端各渲染一次 —— 形状写坏就是两个端一起说坏句子。
    expect(en['web.habits.row.aria']).toContain('-day');
    expect(withOne(en['web.habits.row.aria'])).not.toMatch(HAZARD);
  });
});
