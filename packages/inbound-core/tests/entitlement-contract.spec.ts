/**
 * 自动收集权益的**线契约** —— 判据面
 * =====================================
 *
 * `entitlement-contract.ts` 是签发侧（官方实例）与消费侧（客户宿主）共用的一份词表
 * 与两个判定函数。它们此前**没有任何直接单测**（`envelope/parser/webhook` 三个 spec
 * 都只间接经过它）。而这两处正是"两边都自洽的错"的发源地：
 *
 *   · `automationEntitlementScopeMismatch` 是**权限边界**：作用域档与动作对不上就必须报不符。
 *     放宽一格（例如 rule 动作只给 eventId 也放行、或两者都带也放行）= 越权操作通过；
 *   · `isAutomationEntitlementWaitingDenial` 决定宿主"停并显示等待权益"还是"这是缺陷"。
 *     把缺陷码误判成等待族 = 用户对着一个真 bug 一直等；把等待码误判成缺陷 = 该停的重试无限打。
 *   · 词表/作用域表一旦漂移（少一个动作、session 混进取票通道），症状是"客户端以为有权、服务端判无权"。
 *
 * 每条断言都对着一个"删掉/写错即红"的实现点（见各 it 末尾注）。
 */
import { describe, expect, it } from 'vitest';

import {
  AUTOMATION_ENTITLEMENT_ACTIONS,
  AUTOMATION_ENTITLEMENT_SCOPES,
  AUTOMATION_ENTITLEMENT_WAITING_DENIALS,
  AUTOMATION_ACTION_TICKET_ACTIONS,
  AUTOMATION_ISSUER_DENIALS,
  automationEntitlementScopeMismatch,
  isAutomationEntitlementWaitingDenial,
} from '../src/entitlement-contract';

describe('automationEntitlementScopeMismatch —— 作用域与动作是否相符', () => {
  it('rule 档：带 ruleId、不带 eventId ⇒ 相符（undefined）', () => {
    expect(automationEntitlementScopeMismatch('rule-enable', 'r1', undefined)).toBeUndefined();
    expect(automationEntitlementScopeMismatch('sender-credential-issue', 'r1', undefined)).toBeUndefined();
  });

  it('🔴 rule 档：缺 ruleId ⇒ RULE_SCOPE_MISSING', () => {
    expect(automationEntitlementScopeMismatch('rule-enable', undefined, undefined)).toBe('RULE_SCOPE_MISSING');
  });

  it('🔴 rule 档：同时带了 eventId 也不算相符（必须 eventId === undefined；删掉这半个条件即红）', () => {
    expect(automationEntitlementScopeMismatch('rule-enable', 'r1', 'e1')).toBe('RULE_SCOPE_MISSING');
  });

  it('event 档：带 eventId、不带 ruleId ⇒ 相符', () => {
    expect(automationEntitlementScopeMismatch('ai-reserve', undefined, 'e1')).toBeUndefined();
    expect(automationEntitlementScopeMismatch('commit-permit', undefined, 'e1')).toBeUndefined();
  });

  it('🔴 event 档：缺 eventId ⇒ EVENT_SCOPE_MISSING', () => {
    expect(automationEntitlementScopeMismatch('result-publish', undefined, undefined)).toBe('EVENT_SCOPE_MISSING');
  });

  it('🔴 event 档：同时带了 ruleId 也不算相符', () => {
    expect(automationEntitlementScopeMismatch('draft-confirm', 'r1', 'e1')).toBe('EVENT_SCOPE_MISSING');
  });

  it('none 档：两者都不带 ⇒ 相符（session / worker-register / event-claim）', () => {
    expect(automationEntitlementScopeMismatch('session', undefined, undefined)).toBeUndefined();
    expect(automationEntitlementScopeMismatch('worker-register', undefined, undefined)).toBeUndefined();
    expect(automationEntitlementScopeMismatch('event-claim', undefined, undefined)).toBeUndefined();
  });

  it('🔴 none 档：只要带了任一作用域 ⇒ SCOPE_NOT_ALLOWED（把 none 误当"随便"即红）', () => {
    expect(automationEntitlementScopeMismatch('session', 'r1', undefined)).toBe('SCOPE_NOT_ALLOWED');
    expect(automationEntitlementScopeMismatch('session', undefined, 'e1')).toBe('SCOPE_NOT_ALLOWED');
    expect(automationEntitlementScopeMismatch('worker-register', 'r1', 'e1')).toBe('SCOPE_NOT_ALLOWED');
  });
});

describe('isAutomationEntitlementWaitingDenial —— 等待族 vs 缺陷码', () => {
  it('🔴 三个"此刻还没有权益"的码都判 true（删掉等待族任一成员即红）', () => {
    expect(isAutomationEntitlementWaitingDenial(AUTOMATION_ISSUER_DENIALS.LINK_NOT_BOUND)).toBe(true);
    expect(isAutomationEntitlementWaitingDenial(AUTOMATION_ISSUER_DENIALS.ISSUER_NOT_CONFIGURED)).toBe(true);
    expect(isAutomationEntitlementWaitingDenial(AUTOMATION_ISSUER_DENIALS.NOT_ON_THIS_INSTANCE)).toBe(true);
  });

  it('🔴 请求本身写错的缺陷码必须判 false（把它们误并入等待族 = 用户对着真 bug 一直等）', () => {
    expect(isAutomationEntitlementWaitingDenial(AUTOMATION_ISSUER_DENIALS.SCOPE_MISMATCH)).toBe(false);
    expect(isAutomationEntitlementWaitingDenial(AUTOMATION_ISSUER_DENIALS.ACTIVATION_INVALID)).toBe(false);
    expect(isAutomationEntitlementWaitingDenial(AUTOMATION_ISSUER_DENIALS.MANIFEST_INVALID)).toBe(false);
    expect(isAutomationEntitlementWaitingDenial(AUTOMATION_ISSUER_DENIALS.ACTION_UNKNOWN)).toBe(false);
  });

  it('未知/空串 ⇒ false（把判据写成"以 AUTOMATION_ 开头"就会误判缺陷码为等待）', () => {
    expect(isAutomationEntitlementWaitingDenial('')).toBe(false);
    expect(isAutomationEntitlementWaitingDenial('AUTOMATION_WHATEVER')).toBe(false);
  });
});

describe('词表不变量 —— 动作 / 作用域 / 取票通道', () => {
  it('🔴 每个动作都登记了作用域，且没有多余项（词表漂移即红）', () => {
    expect(Object.keys(AUTOMATION_ENTITLEMENT_SCOPES).sort()).toEqual([...AUTOMATION_ENTITLEMENT_ACTIONS].sort());
  });

  it('🔴 作用域只取封闭三档 none / rule / event', () => {
    const allowed = new Set(['none', 'rule', 'event']);
    for (const action of AUTOMATION_ENTITLEMENT_ACTIONS) {
      expect(allowed.has(AUTOMATION_ENTITLEMENT_SCOPES[action]), `动作 ${action} 的作用域越界`).toBe(true);
    }
  });

  it('🔴 session 必须是 none 档，且绝不出现在逐次取票通道（混进来 = 一次登录换一张通用通行证）', () => {
    expect(AUTOMATION_ENTITLEMENT_SCOPES.session).toBe('none');
    expect((AUTOMATION_ACTION_TICKET_ACTIONS as readonly string[]).includes('session')).toBe(false);
    // 取票通道 = 除 session 外的全部动作，一个不多一个不少。
    expect([...AUTOMATION_ACTION_TICKET_ACTIONS].sort()).toEqual(
      AUTOMATION_ENTITLEMENT_ACTIONS.filter((a) => a !== 'session').sort(),
    );
  });

  it('🔴 等待族里的每个码都必须是已登记的 issuer denial 值（打字打错一个字母即红）', () => {
    const registered = new Set<string>(Object.values(AUTOMATION_ISSUER_DENIALS));
    for (const code of AUTOMATION_ENTITLEMENT_WAITING_DENIALS) {
      expect(registered.has(code), `等待族里的「${code}」不在 AUTOMATION_ISSUER_DENIALS 里`).toBe(true);
    }
  });
});
