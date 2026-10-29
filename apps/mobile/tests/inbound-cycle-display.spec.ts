/**
 * 自动收集的周期结果在移动壳里"露出来"这一格判据
 * =============================================
 *
 * 工单 [`inbound-automation-work-brief.md`](../../../docs/plans/inbound-automation-work-brief.md)
 * §3 A3 那句「mobile 更彻底：`lifecycle.ts` 把周期结果整个丢弃，用户什么都看不到」的收口件。
 *
 * 四种失法各有一把尺（"接线"那一类按失法拆成接住 / 渲出 / 不许第二份字面量三枚 `it`）：
 *  · **映射穷尽** —— 共享层加一档终态而这张表没登记 ⇒ 红（编译也红，这里是第二把尺，
 *    因为它同时钉"不许多出一档没有句子的键"）；
 *  · **两档语言都有句子** —— 词条住在 `packages/i18n`，界面里不许有第二份字面量；
 *  · **接线在** —— 拿到返回值却不显示，和当初丢掉返回值对用户是同一件事；
 *  · **存储不外带正文标识** —— 设置面只需要终态，`eventId` 是用户内容的标识，
 *    把它带上界面等于给外部数据开第二条出口。
 *
 * 本仓的 mobile 没有 RN 组件测试栈（理由见 `habit-create-entry.spec.ts` 文件头），
 * 所以接线那一组按 `source-reading.ts` 的老办法**读源码 + 先剥注释**：
 * 注释里出现 `INBOUND_CYCLE_COPY_KEY[` 会让这条判据假绿。
 */
import { describe, expect, it } from 'vitest';
import { translate } from '@heyta/i18n';

import { read, stripComments } from './source-reading';
import { INBOUND_BOUNDARY_COPY_KEY, INBOUND_CYCLE_COPY_KEY, INBOUND_READINESS_COPY_KEY } from '../src/inbound/copy';
import {
  getInboundCycle,
  publishInboundCycle,
  publishInboundReadiness,
  subscribeInboundCycle,
  subscribeInboundReadiness,
} from '../src/inbound/status';
import { getInboundRules, publishInboundRules } from '../src/inbound/rules-store';

/** 共享层那四档终态。**新增一档而这里没补 ⇒ 前两条一起红**（这就是分母自己站在判据里的写法）。 */
const CYCLE_STATES = ['empty', 'submitted', 'needs-confirmation', 'waiting-entitlement'] as const;

const SECTION = stripComments(read('apps/mobile/src/ai/AiSettingsSection.tsx'));
const LIFECYCLE = stripComments(read('apps/mobile/src/inbound/lifecycle.ts'));
const STATUS = stripComments(read('apps/mobile/src/inbound/status.ts'));

describe('移动壳把自动收集的周期结果露出来（A3 的 mobile 半）', () => {
  it('四档终态各有一把词条键，且这张表里没有多出来的键', () => {
    expect(Object.keys(INBOUND_CYCLE_COPY_KEY).sort()).toEqual([...CYCLE_STATES].sort());
  });

  it('每一把键在中英两档都翻得出**非空且互不相同**的句子', () => {
    const zh = CYCLE_STATES.map((state) => translate('zh-CN', INBOUND_CYCLE_COPY_KEY[state]).trim());
    const en = CYCLE_STATES.map((state) => translate('en', INBOUND_CYCLE_COPY_KEY[state]).trim());
    for (const [index, state] of CYCLE_STATES.entries()) {
      expect(zh[index], `${state} 中文档翻出来是空的`).not.toBe('');
      expect(en[index], `${state} 英文档翻出来是空的`).not.toBe('');
      // 键存在但正文等于另一档（例如都回落到"处理失败"）也算没露出来。
      expect(new Set(zh).size, `中文档有重复句子：${zh.join(' / ')}`).toBe(CYCLE_STATES.length);
      expect(new Set(en).size, `英文档有重复句子：${en.join(' / ')}`).toBe(CYCLE_STATES.length);
    }
  });

  // 🔴 四档失法**各一枚 `it`**：捆成一枚时第一条断言先抛，后面那三条的牙就没被证过
  //（本轮施变臂实测：同时摘掉 publish 与换掉文案，只有 publish 那条现形）。
  it('接住：worker 的返回值进了 store，没有被丢掉', () => {
    expect(LIFECYCLE).toContain('publishInboundCycle(await host.processInboundAutomation(');
  });

  it('渲出：终态经那张表取句子，且那一行有 testID', () => {
    expect(SECTION).toContain('INBOUND_CYCLE_COPY_KEY[');
    expect(SECTION).toContain('testID="inbound-cycle-state"');
  });

  it('界面里不许有第二份句子：写死中文当字面量即红', () => {
    expect(SECTION).not.toMatch(/['"](已提交任务|当前没有待处理事件|等待权益|等待您确认)/);
  });

  it('存储只留终态与条数，不把 eventId 带上界面', () => {
    publishInboundCycle({ state: 'submitted', itemCount: 2, eventId: 'inbound-event-must-not-travel' });
    const snapshot = getInboundCycle();
    expect(snapshot).toEqual({ state: 'submitted', itemCount: 2 });
    expect(JSON.stringify(snapshot ?? {})).not.toContain('inbound-event-must-not-travel');
    expect(STATUS).not.toMatch(/\beventId\b/);
  });

  it('同一趟结果重复播报不通知（稳态是 empty，前台每 20 秒一趟会白白重渲染设置面）', () => {
    publishInboundCycle({ state: 'empty' });
    let calls = 0;
    const off = subscribeInboundCycle(() => { calls += 1; });
    publishInboundCycle({ state: 'empty' });
    expect(calls, '去重没生效：同一档终态又通知了一次').toBe(0);
    publishInboundCycle({ state: 'waiting-entitlement' });
    expect(calls, '换了终态却没通知，界面会一直停在旧句子').toBe(1);
    off();
    publishInboundCycle({ state: 'submitted', itemCount: 1 });
    expect(calls, '取消订阅之后还在通知').toBe(1);
  });
});

describe('移动壳把"这台设备还没准备好接收"说出来（A2 那两条边界的第一条）', () => {
  /** 分母自己站在判据里：从 worker 源码里读它实际会交出的那几档原因，而不是照这张表数。 */
  const publishedReasons = [...LIFECYCLE.matchAll(/publishInboundReadiness\('([a-zA-Z]+)'\)/g)].map((m) => m[1]!);

  it('分母自检：worker 确实交出了原因，而且交出的每一档都在射程内', () => {
    expect(publishedReasons.length, '一条 `publishInboundReadiness(...)` 都没扫到 ⇒ 下面几条会是空转').toBeGreaterThan(0);
    for (const reason of publishedReasons) {
      expect(['ready', 'signedOut', 'noRecipientKey'], `worker 交出了一档这张尺没登记的 ${reason}`).toContain(reason);
    }
  });

  it('每一档"跑不了"的原因在中英两档都翻得出非空句子', () => {
    const waiting = Object.keys(INBOUND_READINESS_COPY_KEY);
    expect(waiting.length, '这张表是空的 ⇒ 下面那些断言都在空转').toBeGreaterThan(0);
    const zh = waiting.map((reason) => translate('zh-CN', INBOUND_READINESS_COPY_KEY[reason as keyof typeof INBOUND_READINESS_COPY_KEY]).trim());
    const en = waiting.map((reason) => translate('en', INBOUND_READINESS_COPY_KEY[reason as keyof typeof INBOUND_READINESS_COPY_KEY]).trim());
    for (const [index, reason] of waiting.entries()) {
      expect(zh[index], `${reason} 中文档翻出来是空的`).not.toBe('');
      expect(en[index], `${reason} 英文档翻出来是空的`).not.toBe('');
    }
    // 原因句不许等于四档终态里的任何一句 —— 那两格混起来就是"没建密钥"被念成"没有待处理内容"。
    const cycleSentences = new Set(CYCLE_STATES.map((state) => translate('zh-CN', INBOUND_CYCLE_COPY_KEY[state]).trim()));
    for (const sentence of zh) expect(cycleSentences.has(sentence), `这句和某档终态撞了：${sentence}`).toBe(false);
  });

  it('worker 交出的每一档原因都有句子可接（加一档而不登记 ⇒ 红）', () => {
    const covered = new Set(['ready', ...Object.keys(INBOUND_READINESS_COPY_KEY)]);
    for (const reason of publishedReasons) expect(covered.has(reason), `${reason} 这一档没有句子可接`).toBe(true);
  });

  it('渲出：那一行有 testID，且经表取句子', () => {
    expect(SECTION).toContain('INBOUND_READINESS_COPY_KEY[');
    expect(SECTION).toContain('testID="inbound-readiness"');
  });

  it('那台设备没建密钥时不再静默 return（这是原来那条假绿的正文）', () => {
    expect(LIFECYCLE).toContain("publishInboundReadiness('noRecipientKey')");
  });

  it('ready 不当句子播：这张表里不许有 ready', () => {
    expect(Object.keys(INBOUND_READINESS_COPY_KEY)).not.toContain('ready');
  });

  it('重复播报同一档原因不通知，换档才通知', () => {
    publishInboundReadiness('ready');
    let calls = 0;
    const off = subscribeInboundReadiness(() => { calls += 1; });
    publishInboundReadiness('ready');
    expect(calls, '去重没生效：同一档原因又通知了一次').toBe(0);
    publishInboundReadiness('noRecipientKey');
    expect(calls, '换了原因却没通知，界面会一直停在旧句子').toBe(1);
    off();
    publishInboundReadiness('signedOut');
    expect(calls, '取消订阅之后还在通知').toBe(1);
    publishInboundReadiness('ready');
  });

  it('那句"哪台设备才处理"在界面上渲出来，两壳同一条、界面里不许有第二份字面量', () => {
    expect(SECTION).toContain('INBOUND_BOUNDARY_COPY_KEY');
    expect(SECTION).toContain('testID="inbound-boundary"');
    expect(translate('zh-CN', INBOUND_BOUNDARY_COPY_KEY)).not.toBe('');
    expect(translate('en', INBOUND_BOUNDARY_COPY_KEY)).not.toBe('');
    // 写死那句中文当字面量就是第二份句子（web 那端换了措辞而这里跟着抄，正是本仓反复登记的漂移源）。
    expect(SECTION).not.toMatch(/开着 heyta 时处理|常年接收/);
  });
});

describe('移动壳能看见规则本身（A9 第 4 项：以前手机上连"看规则"都做不到）', () => {
  const RULES_STORE = stripComments(read('apps/mobile/src/inbound/rules-store.ts'));

  it('拉取接在 lifecycle 上，且经只有展示四样的 store 出门', () => {
    expect(LIFECYCLE).toContain('publishInboundRules(await createInboundRulesRemote(');
    expect(RULES_STORE).toContain('export function publishInboundRules(');
  });

  it('渲出：设置面无请求，只读 store，且有 testID', () => {
    expect(SECTION).toContain('useInboundRules()');
    expect(SECTION).toContain('testID="inbound-rules-title"');
    expect(SECTION).toContain('testID={`inbound-rule-');
  });

  it('store 只留展示四样：凭据/密钥/事件标识都不许搭车', () => {
    publishInboundRules([
      {
        id: 'rule-1', version: 2, enabled: true, keyId: 'default', createdAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null, allowedFields: ['title'], targetProjectId: null, timezone: null, parseVersion: 1,
        authorizationVersion: 1, maxItems: 5, hostedExtraction: false,
        // 现实里存在但不该上界面的东西，故意用假值钉形状。
        senderSecret: 'must-not-travel', eventId: 'must-not-travel',
      } as never,
      { id: 'rule-2', version: 1, enabled: false, keyId: 'old', createdAt: '2026-01-01T00:00:00.000Z', deletedAt: '2026-02-01T00:00:00.000Z', allowedFields: ['title'], targetProjectId: null, timezone: null, parseVersion: 1, authorizationVersion: 1, maxItems: 5, hostedExtraction: true } as never,
    ]);
    const snapshot = getInboundRules();
    expect(snapshot).toEqual([{ id: 'rule-1', keyId: 'default', enabled: true, hostedExtraction: false }]);
    expect(JSON.stringify(snapshot)).not.toContain('must-not-travel');
  });
});
