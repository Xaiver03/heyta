/**
 * 移动端与 Web 的 AI 文案表**逐条对账**
 * =====================================
 *
 * 🔴 这条文件是三处注释早就承诺过的装置（`src/ai/copy.ts` 文件头与第 115 行、
 * `src/ai/intent-copy.ts` 文件头），此前**并不存在** —— 承诺写在注释里，
 * 没有任何一层执行它。那类"注释说有、实际没有"的装置是本仓库反复付学费的形状：
 * 它不是缺一个测试，是**让读代码的人以为这件事有人守**。
 *
 * ## 为什么值得专门对账
 *
 * 两端各写一份 `原因 → 词条 key` 的表时，漂移的表现不是报错，而是
 * **某一端的用户在说谎**：同一次出境失败，web 说"留 45 天后删除"而手机说"不保留"，
 * 或者同一个写入提案在两个入口长得不一样 —— 而那张卡是用户点"确认执行"之前
 * 唯一能看见"将要落下什么"的地方。
 *
 * ## 对账方式：两边都从**源码**取同一批 key
 *
 * 不 import 对面那份（`check:module-boundaries` 不许壳之间互相引，测试也照这条走，
 * 免得产线边界靠测试破例而被悄悄模仿）。每个前缀两端各扫一次，比较**集合**。
 *
 * 🔴 每个断言都带**阳性对照**（两边都必须读到 > 0 条）。只比"相等"的话，
 * 一条抓不到任何东西的正则会让两边都得到空集、于是永远绿 ——
 * 能不能失败只靠这种反证回答（AGENTS §8 第 3 条）。
 *
 * ## 一处**登记过的**不同，不是漂移
 *
 * `web.ai.failure.cause.networkOriginRejected`（"端点在你机器上但拒绝了你的来源"）
 * 只有 web 有：判据需要一个宿主 Origin，而 RN 没有 Origin 概念、原生 `fetch`
 * 也不发 `Origin` 头 —— 那一档在本端**到不了**，硬做等于编一条诊断。
 * 这条例外被**逐字钉住**（只许多这一条、且不许手机多任何一条），
 * 所以下一次真的漂移仍然会红。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, rel), 'utf8');

const MOBILE_COPY = '../src/ai/copy.ts';
const MOBILE_INTENT = '../src/ai/intent-copy.ts';
const WEB_DISCLOSURE = '../../../apps/web/src/features/ai/disclosure-copy.ts';
const WEB_DISCLOSURE_HOST = '../../../apps/web/src/features/ai/AiDisclosureHost.tsx';
const WEB_FAILURE = '../../../apps/web/src/features/ai/ai-failure-copy.ts';
const WEB_ROUTE = '../../../apps/web/src/features/ai/route-explanation.ts';
const WEB_TOOL_RUN = '../../../apps/web/src/features/ai/AiToolRun.tsx';
const WEB_HEALTH = '../../../apps/web/src/features/settings/health-copy.ts';
const WEB_AI_SETTINGS = '../../../apps/web/src/features/settings/AiSettings.tsx';

/**
 * 按前缀取源码里出现过的词条 key（去重、排序 —— 顺序不同不是"key 不同"）。
 *
 * ⚠️ 字符类里**必须带数字**：`e2eeLead` 这一档用 `[a-zA-Z]+` 匹配不到
 * （`e` 后面就是 `2`），于是一段真实存在的文案被读成"缺失"，
 * 症状是"两端不一致"这种**别人会去改代码**的假红。
 */
function keysWith(src: string, pattern: RegExp): string[] {
  return [...src.matchAll(pattern)].map((m) => m[1]!).sort();
}

/**
 * 比较两端某一族的 key。
 *
 * ⚠️ 传进来的是**源码内容**，不是路径（本文件第一版在这里传了路径，
 * 于是 web 那侧读出 0 条 —— 阳性对照当场把它抓住，但也暴露一件事：
 * 那条"改掉一族的 key 会红"的反证臂**因为这个 bug 而红**，
 * 一条为错误的理由通过的臂等于没有臂。所以反证还要顺便证明它红得对）。
 *
 * `webOnly` 是**登记过的例外**，默认空集 —— 也就是默认要求完全一致，
 * 任何一侧多一条都会红。例外写进来就是逐字断言：例外本身变了也会红，
 * 不会退化成"差不多就行"。
 */
function expectSameFamily(
  label: string,
  mobileSrc: string,
  webSrcs: string | readonly string[],
  pattern: RegExp,
  opts: { readonly webOnly?: readonly string[] } = {},
): void {
  const webList = typeof webSrcs === 'string' ? [webSrcs] : webSrcs;
  const mobile = keysWith(mobileSrc, pattern);
  const web = [...new Set(webList.flatMap((src) => keysWith(src, pattern)))].sort();
  // 阳性对照：任何一边读到 0 条就是探针坏了，不是"两边都干净"。
  expect(mobile.length, `探针在移动端一份都没读到（${label}）—— 前缀或文件路径变了`).toBeGreaterThan(0);
  expect(web.length, `探针在 web 一份都没读到（${label}）—— 前缀或文件路径变了`).toBeGreaterThan(0);
  const onlyWeb = web.filter((k) => !mobile.includes(k));
  const onlyMobile = mobile.filter((k) => !web.includes(k));
  expect(onlyMobile, `移动端多出这些 key（${label}）—— 手机在用一批 web 没有的说法`).toEqual([]);
  expect(onlyWeb, `web 多出这些 key（${label}）—— 除非逐字登记过，否则就是漂移`).toEqual(
    [...(opts.webOnly ?? [])].sort(),
  );
}

/** 跑一次对账，返回 null=绿，字符串=失败消息。 */
function runFamily(
  label: string,
  mobileSrc: string,
  webSrcs: readonly string[],
  pattern: RegExp,
  opts?: { readonly webOnly?: readonly string[] },
): string | null {
  try {
    expectSameFamily(label, mobileSrc, webSrcs, pattern, opts);
    return null;
  } catch (e) {
    return String(e instanceof Error ? e.message : e);
  }
}

describe('移动端 ↔ web 的 AI 文案表对账', () => {
  it('🔴 披露块（含保留策略三档）两端同一条口径 —— 隐私话术不许两端各说一句', () => {
    expectSameFamily(
      'disclosure.*',
      read(MOBILE_COPY),
      [read(WEB_DISCLOSURE_HOST), read(WEB_DISCLOSURE)],
      /'(web\.ai\.disclosure\.[a-zA-Z0-9]+)'/g,
    );
  });

  it('🔴 端点健康三档（正常/连续失败/熔断）两端同 key', () => {
    expectSameFamily(
      'health.*',
      read(MOBILE_COPY),
      read(WEB_HEALTH),
      /'(web\.ai\.health\.[a-zA-Z0-9]+)'/g,
    );
  });

  it('🔴 路由解释与"压根没配路由"两组，两端各是同一批 key', () => {
    expectSameFamily(
      'routeExplain.*',
      read(MOBILE_COPY),
      read(WEB_ROUTE),
      /'(web\.ai\.routeExplain\.[a-zA-Z0-9]+)'/g,
    );
    expectSameFamily(
      'noTarget.*',
      read(MOBILE_COPY),
      read(WEB_ROUTE),
      /'(web\.ai\.noTarget\.[a-zA-Z0-9]+)'/g,
    );
  });

  it('🔴 五个功能的界面上的名字两端同源（能力清单与设置页不许说成两件事）', () => {
    expectSameFamily(
      'feature.*',
      read(MOBILE_COPY),
      read(WEB_AI_SETTINGS),
      /'(web\.ai\.feature\.[a-zA-Z0-9]+)'/g,
    );
  });

  it('🔴 端点预设的 label 与 prerequisite 两端同源', () => {
    expectSameFamily(
      'settings.preset.*',
      read(MOBILE_COPY),
      read(WEB_AI_SETTINGS),
      /'(web\.ai\.settings\.preset\.[a-zA-Z0-9]+\.[a-zA-Z0-9]+)'/g,
    );
  });

  it('🔴 提案卡（intent.* / focusKind* / todayLabel）两端逐条同 key —— 那是确认之前唯一能看见的一张卡', () => {
    expectSameFamily(
      'tools.intent*|focusKind*|todayLabel',
      read(MOBILE_INTENT),
      read(WEB_TOOL_RUN),
      /'(web\.ai\.tools\.(?:intent|focusKind|todayLabel)[a-zA-Z0-9]*)'/g,
    );
  });

  it('🔴 出境失败原因：唯一允许的差集是"来源被拒"那一档（RN 到不了），多一条就红', () => {
    expectSameFamily(
      'failure.cause.*',
      read(MOBILE_COPY),
      read(WEB_FAILURE),
      /'(web\.ai\.failure\.cause\.[a-zA-Z0-9]+)'/g,
      { webOnly: ['web.ai.failure.cause.networkOriginRejected'] },
    );
  });

  it('🔴 四组失败原因表（捕获/拆解/排序/估时）两端同 key', () => {
    for (const feature of ['capture', 'breakdown', 'prioritize', 'duration'] as const) {
      expectSameFamily(
        `failure.${feature}.*`,
        read(MOBILE_COPY),
        read(WEB_FAILURE),
        new RegExp(`'(web\\.ai\\.failure\\.${feature}\\.[a-zA-Z0-9]+)'`, 'g'),
      );
    }
  });

  it('🔴 助手多步与工具调用的失败原因两端同 key（多步那一档只有助手面有）', () => {
    expectSameFamily(
      'assistant.failure.*',
      read(MOBILE_COPY),
      read(WEB_FAILURE),
      /'(web\.ai\.assistant\.failure\.[a-zA-Z0-9]+)'/g,
    );
    expectSameFamily(
      'tools.failure.*',
      read(MOBILE_COPY),
      read(WEB_FAILURE),
      /'(web\.ai\.tools\.failure\.[a-zA-Z0-9]+)'/g,
    );
  });

  it('🔴 反证：手机单方面改掉一族的 key ⇒ 红，而且红得是"漂移"这条理由', () => {
    const web = [read(WEB_DISCLOSURE_HOST), read(WEB_DISCLOSURE)];
    // 先证明喂进去的东西真的是源码内容（本文件第一版在这里喂了路径，
    // 于是"红"来自读不到而不是来自漂移 —— 那种臂等于没有臂）。
    expect(keysWith(web[0]!, /'(web\.ai\.disclosure\.[a-zA-Z0-9]+)'/g).length).toBeGreaterThan(0);
    const tampered = read(MOBILE_COPY).replace(
      "'web.ai.disclosure.retentionThirdParty'",
      "'web.ai.disclosure.retentionRenamed'",
    );
    expect(tampered, '变异没落到预期那一行，这臂等于没测').not.toBe(read(MOBILE_COPY));
    const msg = runFamily('disclosure.*', tampered, web, /'(web\.ai\.disclosure\.[a-zA-Z0-9]+)'/g);
    expect(msg, '改掉一族的 key 而这条对账没红 ⇒ 它挡不住任何漂移').not.toBeNull();
    expect(msg).toContain('移动端多出这些 key');
    expect(msg).not.toContain('一份都没读到');
  });

  it('🔴 反证：web 多出第二条（超出登记的那条例外）⇒ 红', () => {
    // 把 mobile 那份当 web 喂一遍，再额外"造"出一条 web-only 的 key：
    // 登记过的例外只剩 networkOriginRejected 一条，多一条就该响。
    const mobileSrc = read(MOBILE_COPY);
    const webTampered = `${read(WEB_FAILURE)}\nconst fake = t('web.ai.failure.cause.brandNewThing');`;
    const msg = runFamily('failure.cause.*', mobileSrc, [webTampered], /'(web\.ai\.failure\.cause\.[a-zA-Z0-9]+)'/g, {
      webOnly: ['web.ai.failure.cause.networkOriginRejected'],
    });
    expect(msg, 'web 多出一条而差集断言没红 ⇒ 例外清单成了免死金牌').not.toBeNull();
    expect(msg).toContain('web 多出这些 key');
  });

  it('🔴 反证：探针读到 0 条时响亮地红，而不是"两边都空 = 绿"', () => {
    // 两种"读不到"都要红：前缀写错，以及把路径当内容喂进去。
    const msgPrefix = runFamily('bogus 前缀', read(MOBILE_COPY), [read(WEB_DISCLOSURE)], /'(web\.ai\.noSuchFamily\.[a-zA-Z0-9]+)'/g);
    expect(msgPrefix, '读到 0 条却当合规 —— 这条门禁不能没有阳性对照').not.toBeNull();
    expect(msgPrefix).toContain('一份都没读到');
    const msgPath = runFamily('路径当内容', read(MOBILE_COPY), [WEB_DISCLOSURE_HOST], /'(web\.ai\.disclosure\.[a-zA-Z0-9]+)'/g);
    expect(msgPath, '喂进去的是路径而不是源码 —— web 侧读到 0 条必须红').not.toBeNull();
    expect(msgPath).toContain('一份都没读到');
  });

  it('🔴 反证：key 里带数字的那一档真的在射程内（e2eeLead 不许被读成"缺失"）', () => {
    // `[a-zA-Z]+` 会在 `e2eeLead` 的 `e` 后停下，把两端都存在的句子读成不存在。
    const mobile = keysWith(read(MOBILE_COPY), /'(web\.ai\.disclosure\.[a-zA-Z0-9]+)'/g);
    expect(mobile).toContain('web.ai.disclosure.e2eeLead');
    expect(mobile).toContain('web.ai.disclosure.e2eeStrong');
  });
});
