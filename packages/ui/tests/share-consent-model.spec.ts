import { describe, expect, it } from 'vitest';

import { applyShareConsent, shouldShowConsent } from '../src/sync/share-consent-model';

describe('PIPL 23 单独同意（方案 a：首次模态 + 不再提示勾选）', () => {
  it('🔴 fail-closed：没有任何记录 ⇒ 必须弹（宁可多问，不可不问就共享）', () => {
    expect(shouldShowConsent({})).toEqual({ show: true, reason: 'first-time' });
  });

  it('🔴 半条记录（只有 dontAskAgain、没有确认）⇒ 仍必须弹（fail-closed）', () => {
    expect(shouldShowConsent({ dontAskAgain: true })).toEqual({ show: true, reason: 'first-time' });
  });

  it('🔴 确认过但没勾「不再提示」⇒ 下一次共享**还会弹**（repeat）——复选框的价值所在', () => {
    expect(shouldShowConsent({ consentAcceptedAt: 1_000 }))
      .toEqual({ show: true, reason: 'repeat' });
  });

  it('确认过 + 勾了「不再提示」⇒ 永不再弹（唯一免弹组合）', () => {
    expect(shouldShowConsent({ consentAcceptedAt: 1_000, dontAskAgain: true }))
      .toEqual({ show: false, reason: 'opted-out' });
  });

  it('取消：不 proceed、**不留确认记录**（取消不是同意）', () => {
    const result = applyShareConsent({}, { accepted: false, dontAskAgain: true, now: 1_000 });
    expect(result.proceed).toBe(false);
    expect(result.store).toEqual({});
    expect(shouldShowConsent(result.store)).toEqual({ show: true, reason: 'first-time' });
  });

  it('确认：记录时刻；「不再提示」按勾选落盘', () => {
    const accepted = applyShareConsent({}, { accepted: true, dontAskAgain: true, now: 5_000 });
    expect(accepted.proceed).toBe(true);
    expect(accepted.store).toEqual({ consentAcceptedAt: 5_000, dontAskAgain: true });
    expect(shouldShowConsent(accepted.store).show).toBe(false);
  });
});
