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
import { INBOUND_CYCLE_COPY_KEY } from '../src/inbound/copy';
import { getInboundCycle, publishInboundCycle, subscribeInboundCycle } from '../src/inbound/status';

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
