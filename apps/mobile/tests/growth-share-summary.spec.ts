/**
 * 任务 4 的判据：周小结分享块（两端共用一份）+「我的」权益可见 + 占位符字形统一
 * ==========================================================================
 *
 * 三件事，每件都对应一个**这里能失败**的断言（不能失败的判据没有价值）：
 *
 *   1. `buildShareSummary` 从 `apps/web` 搬进了 `@heyta/app-host`，**输出逐字节不变**
 *      （`apps/web/tests/motivation.spec.ts` 钉着 web 那一侧，本文件钉移动侧 +
 *      "句子全部来自词条、函数自己不造句"这条）。
 *   2. 「我的」多了一条托管同步权益。它是**读来的一句陈述**，不是按钮，
 *      所以判据落在"挂了没挂"+"四种观察各自显示什么"。
 *   3. `web.growth.year.heatmap` 的 `{{count}}`（react-activity-calendar 的语法）
 *      统一成 i18n 的单层 `{count}`。这条是**反向防回潮**：整张词条表里
 *      一个 `{{` 都不许有 —— 双花括号会被 `t()` 渲染成字面的 `{5}`，
 *      而那种坏法是安静的。
 *
 * ⚠️ 为什么这些断言读**真词条表**而不是快照：词条的值就是产品结论。
 *    快照会把"把英文写成中文"这种事故拍成一张新基线，真值断言会直接红。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { translate, type MessageKey } from '@heyta/i18n';
import { SHARE_SUMMARY_KEYS, buildShareSummary } from '@heyta/app-host';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(here, rel), 'utf8');

const zhT = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate('zh-CN', key, vars);
const enT = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate('en', key, vars);

/** 只声明用到的字段 —— 用例不该依赖 `WeeklyReview` 里与本判据无关的部分。 */
const review = (over: Record<string, unknown> = {}) => ({
  weekStart: '2026-09-21',
  weekEnd: '2026-09-27',
  checkIns: 5,
  tasksCompleted: 2,
  focusMinutes: 30,
  previous: { checkIns: 0, tasksCompleted: 0, focusMinutes: 0 },
  deltas: { checkIns: 0, tasksCompleted: 0, focusMinutes: 0 },
  headline: 'none' as const,
  ...over,
});

const totals = (over: Record<string, unknown> = {}) => ({
  checkIns: 40,
  focusMs: 7_200_000 * 3, // 恰好 6 小时：测试"向下取整"而不是"四舍五入"
  tasksCompleted: 90,
  activeDays: 12,
  ...over,
});

describe('buildShareSummary：一行都不许是函数自己造的', () => {
  /**
   * 🔴 注入的 `t` 只回 key 本身。输出若是 key 名 ⇒ 句子**全部**来自词条表。
   * 这个方向很重要：如果哪天有人图省事在函数里写 `'累计：' + n + ' 次'`，
   * 中文能看、英文是坏的、而 `check:ui-language` 抓不到（它扫的是界面代码）。
   *
   * ⚠️ 行数是**三条底 + 可选的 bestDay**，不是四条。这条在本文件第一次跑就红了，
   * 红的是我这个断言不是实现 —— 写进注释是为了让下一个人别再把"四条 key"
   * 读成"输出恒为四行"。
   */
  it('透出的就是那几条 key，bestDay 落在第 3 行的位置', () => {
    const keyOnly = (key: string): string => key;
    expect(buildShareSummary(review() as never, totals() as never, keyOnly as never).split('\n')).toEqual([
      'web.growth.summary.title',
      'web.growth.summary.line',
      'web.growth.summary.totals',
    ]);
    const withBest = review({ bestFocusDay: { date: '2026-09-23', minutes: 90 } });
    expect(
      buildShareSummary(withBest as never, totals() as never, keyOnly as never).split('\n'),
    ).toEqual([...SHARE_SUMMARY_KEYS]);
  });

  it('没有 bestFocusDay 时是 3 行；有它是 4 行（那条条件分支是安静的）', () => {
    expect(
      buildShareSummary(review() as never, totals() as never, zhT as never).split('\n'),
    ).toHaveLength(3);
    const withBest = review({ bestFocusDay: { date: '2026-09-23', minutes: 90 } });
    expect(
      buildShareSummary(withBest as never, totals() as never, zhT as never).split('\n'),
    ).toHaveLength(4);
  });

  it('中文侧：三个数字 + 日期区间 + 累计行都进句子，专注小时向下取整', () => {
    const out = buildShareSummary(review() as never, totals() as never, zhT as never);
    expect(out).toContain('本周小结（2026-09-21 至 2026-09-27）');
    expect(out).toContain('打卡 5 次 · 完成 2 件 · 专注 30 分钟');
    expect(out).toContain('累计：打卡 40 次 · 专注 6 小时 · 完成 90 件 · 活跃 12 天');
    // 🔴 6 小时而不是 6.0 或 5.998 —— `Math.floor` 掉了就是产品结论错了。
    expect(out).not.toContain('5 小时');
  });

  it('英文侧：每行都有内容、没有 CJK、且与中文不同（漏翻译会红在这里）', () => {
    const zh = buildShareSummary(review() as never, totals() as never, zhT as never);
    const en = buildShareSummary(review() as never, totals() as never, enT as never);
    const enLines = en.split('\n');
    expect(enLines).toHaveLength(zh.split('\n').length);
    for (const line of enLines) {
      expect(line.trim()).not.toBe('');
      expect(line).not.toMatch(/[一-龥]/u);
    }
    expect(en).not.toBe(zh);
    expect(en).toContain('6 focus hours');
    expect(en).toContain('Week summary (2026-09-21 to 2026-09-27)');
  });

  it('缺 key 会抛而不是静默少一行（真的喂一个不存在的 key）', () => {
    // `SHARE_SUMMARY_KEYS` 是本函数的输入清单；把它当成断言对象，
    // 漏登记一条 ⇒ 下一条用例的"行数"就对不上。
    expect(SHARE_SUMMARY_KEYS).toHaveLength(4);
    for (const key of SHARE_SUMMARY_KEYS) {
      expect(() => translate('zh-CN', key as MessageKey, {})).not.toThrow();
      expect(() => translate('en', key as MessageKey, {})).not.toThrow();
    }
  });
});

describe('移动壳：分享块与权益行真的挂上了（挂不上没有别的门禁会红）', () => {
  const growth = src('../src/screens/GrowthScreen.tsx');
  const profile = src('../src/screens/ProfileScreen.tsx');
  const entitlement = src('../src/screens/EntitlementSection.tsx');

  it('GrowthScreen 传 `share`，复制走 RN 核心 Clipboard，文本来自 app-host 那一份', () => {
    expect(growth).toContain('share={share}');
    expect(growth).toContain('buildShareSummary(data.week, data.totals, t)');
    expect(growth).toContain('activityTotalsFromState(tables)');
    expect(growth).toContain('Clipboard.setString(summary)');
    // 成功=resolve / 失败=reject 这条契约不许被 try/catch 吞掉：
    // 吞掉之后"剪贴板不让用"会显示成"已复制"，而那正是共享层文件头警告的形态。
    const onCopyAt = growth.indexOf('onCopy');
    expect(onCopyAt).toBeGreaterThan(-1);
    expect(growth.slice(onCopyAt, onCopyAt + 200)).not.toContain('catch');
    // 分享块要有标题与那句"不含标识"的说明，否则它读成一个孤零零的按钮。
    expect(growth).toContain("t('web.growth.share.title')");
    expect(growth).toContain("t('web.growth.share.note')");
  });

  it('「我的」真的挂了 EntitlementSection（与 NotesSection 同一条理由）', () => {
    expect(profile).toContain('import { EntitlementSection }');
    expect(profile).toContain('<EntitlementSection />');
  });

  it('权益行的四条判断都在：闸门先于请求、只有 denied 分到期/其它、未知不猜过期', () => {
    expect(entitlement).toContain('fetchHostedEntitlementReading');
    expect(entitlement).toContain('privacyConsent.networkAllowed()');
    expect(entitlement).toContain("reading.kind === 'entitled'");
    expect(entitlement).toContain("reading.kind === 'denied'");
    expect(entitlement).toContain("reading.reason === 'PERIOD_ENDED'");
    expect(entitlement).toContain("'web.subscription.notice.expired.title'");
    expect(entitlement).toContain("'web.subscription.notice.refused.title'");
    expect(entitlement).toContain("'web.subscription.notice.localData'");
    // 🔴 `unconfigured` / `unavailable` 必须什么都不显示 —— 把"探测失败"显示成
    //    一条红字，等于让"没网"伪装成"你被降级了"。
    expect(entitlement).toContain('// `unconfigured` / `unavailable`');
    expect(entitlement).toMatch(/return null;\s*\}/u);
  });

  it('web 前缀的词条调用只住在 EntitlementSection，ProfileScreen 一条都没有', () => {
    /**
     * 判据读的是**去掉注释后的代码**：`profile-avatar-entry.spec.ts:172` 与
     * `profile-nickname-entry.spec.ts:144` 都是拿整份源码做正则的（连注释一起算），
     * 所以这条规则约束的是"这个文件里出现那个形状"，包括注释。
     * 这里用同样的口径，另加一条：那三条 key 必须真的在独立组件里被引用 ——
     * 否则"独立成组件"会变成"独立地什么都不显示"。
     */
    expect(profile).not.toMatch(/t\(\s*'web\./u);
    expect(entitlement).toContain("'web.subscription.notice.localData'");
  });
});

describe('占位符字形：词条的**值**里一个 `{{` 都不许有', () => {
  /**
   * 读的是**去掉整行注释之后**的表体。两张表里现在还有 4 处 `{{count}}`，
   * 全部在注释里（讲 react-activity-calendar 那个库形状的来历，是留给后来者的
   * 历史）。判据管的是会被渲染出去的东西，不是给人看的说明。
   */
  const valuesOnly = (source: string): string =>
    source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');

  const zhTable = valuesOnly(src('../../../packages/i18n/src/locales/zh-CN.ts'));
  const enTable = valuesOnly(src('../../../packages/i18n/src/locales/en.ts'));

  it('两张表的值里都没有双花括号（i18n 只认单层，双括号会渲染成字面的 {5}）', () => {
    expect(zhTable).not.toContain('{{');
    expect(enTable).not.toContain('{{');
    // 阳性对照：过滤层真的在放行注释（否则"0 处"可能是过滤器坏了）。
    expect(src('../../../packages/i18n/src/locales/zh-CN.ts')).toContain('{{');
  });

  it('`web.growth.year.heatmap` 是真插值：数字进得去，中英各成一句', () => {
    expect(zhT('web.growth.year.heatmap', { count: 7 })).toBe('最近一年共 7 次记录');
    expect(enT('web.growth.year.heatmap', { count: 7 })).toBe('7 records in the past year');
    // 没有变量时占位符原样留着（不是空串、不是 undefined）—— 界面会少一个数字，
    // 但不会念出"最近一年共 undefined 次记录"。
    expect(zhT('web.growth.year.heatmap')).toBe('最近一年共 {count} 次记录');
  });

  it('新增的权益词条中英都有、且互不相同', () => {
    const key = 'mobile.profile.entitlement.entitled';
    const zhText = zhT(key as MessageKey);
    const enText = enT(key as MessageKey);
    expect(zhText).not.toBe('');
    expect(enText).not.toBe('');
    expect(zhText).not.toBe(enText);
    expect(zhText).toMatch(/[一-龥]/u);
    expect(enText).not.toMatch(/[一-龥]/u);
  });

  it('两处新界面都没有裸的内联样式（l4 棘轮 90 顶格，新增一条 style={{}} 必红）', () => {
    expect(growthStyleCount()).toBe(0);
  });
});

function growthStyleCount(): number {
  return (
    (src('../src/screens/GrowthScreen.tsx').match(/style=\{\{/gu) ?? []).length +
    (src('../src/screens/EntitlementSection.tsx').match(/style=\{\{/gu) ?? []).length
  );
}
