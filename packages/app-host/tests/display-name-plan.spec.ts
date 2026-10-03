import { describe, expect, it } from 'vitest';
import { ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS, displayNameCodePoints } from '@heyta/shared-schema';

import { planDisplayNameWrite } from '../src/hosted-auth.js';

/**
 * 🔴 「这一发昵称写入到底发不发、发什么」的**唯一**裁决。
 *
 * 为什么单独钉一层：web 与移动端做的是同一件事（改昵称 / 清除昵称），
 * 而 AGENTS §3.5 记过两次同一个形状的漂移 —— 各写一遍就是从两个地方各判一遍，
 * 于是"空框是清除还是发空串""超长发不发"这类问题会在两端给出不同答案。
 * 判据钉在这里（纯函数），两端的界面用例只钉"接上了这个函数"。
 *
 * ⚠️ 三条"不发"分别对应三种真实故障形状，见 `hosted-auth.ts` 里那段注释：
 * 没凭据还发 ⇒ 把 401 渲染成"保存失败"这句假话；超长还发 ⇒ 白付一次往返；
 * 没改还发 ⇒ 一次点击变成对权威数据的一次重写。
 */
describe('planDisplayNameWrite（昵称写入的唯一裁决）', () => {
  it('没有可用凭据的三种形状都**不发**（undefined / 空串 / 纯空白）', () => {
    for (const token of [undefined, '', '   ']) {
      expect(planDisplayNameWrite({ token, draft: '小鹿', saved: null })).toEqual({
        action: 'skip',
        reason: 'no-credential',
      });
    }
  });

  it('🔴 空框发的是 `null`（清除），**不是**空串', () => {
    expect(planDisplayNameWrite({ token: 't', draft: '', saved: '小鹿' })).toEqual({
      action: 'write',
      token: 't',
      value: null,
    });
  });

  it('只填空白与留空**同义**（一样发 `null`），永不发出空白串', () => {
    const plan = planDisplayNameWrite({ token: 't', draft: '   ', saved: '小鹿' });
    expect(plan.action === 'write' ? plan.value : 'not-write').toBeNull();
  });

  it('已有昵称时"清空"是一次**真实的写**，不是"没操作"', () => {
    // 反例长这样：`if (draft === '') return` —— 于是"从有到空"永远做不到。
    const plan = planDisplayNameWrite({ token: 't', draft: '', saved: '小鹿' });
    expect(plan.action).toBe('write');
  });

  it('没改内容 ⇒ 不发（原值与草稿只差首尾空白也算没改）', () => {
    expect(planDisplayNameWrite({ token: 't', draft: '小鹿', saved: '小鹿' })).toEqual({
      action: 'skip',
      reason: 'unchanged',
    });
    expect(planDisplayNameWrite({ token: 't', draft: '  小鹿  ', saved: '小鹿' })).toEqual({
      action: 'skip',
      reason: 'unchanged',
    });
  });

  it('超过上限 ⇒ 当场说清、**一个请求都不发**', () => {
    const over = '一'.repeat(ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS + 1);
    expect(planDisplayNameWrite({ token: 't', draft: over, saved: null })).toEqual({
      action: 'skip',
      reason: 'too-long',
    });
  });

  it('🔴 上限**从契约常量推导**，不是这里抄的一个数（把抄件钉死）', () => {
    const at = '一'.repeat(ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS);
    // 恰好等于上限 ⇒ 必须发（若这里写了个更小的数，这一条会先红）。
    expect(planDisplayNameWrite({ token: 't', draft: at, saved: null }).action).toBe('write');
    expect(displayNameCodePoints(at)).toBe(ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS);
  });

  it('32 个 emoji（每个两个 UTF-16 单元）**不算**超长 —— 钉住"按码点"这条口径', () => {
    const plan = planDisplayNameWrite({ token: 't', draft: '👍'.repeat(32), saved: null });
    expect(plan.action === 'write' ? plan.value : plan.action).toBe('👍'.repeat(32));
  });

  it('非空时发的是**未 trim 的原稿**（与 web 既有行为逐字一致）', () => {
    const plan = planDisplayNameWrite({ token: 't', draft: ' 小鹿 ', saved: null });
    expect(plan.action === 'write' ? plan.value : undefined).toBe(' 小鹿 ');
  });

  it('🔴 判定顺序：没有凭据排在超长前面（未登录时不该得到"太长了"这句）', () => {
    const over = '一'.repeat(ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS + 1);
    expect(planDisplayNameWrite({ token: undefined, draft: over, saved: null })).toEqual({
      action: 'skip',
      reason: 'no-credential',
    });
  });

  it('`write` 分支带出**收窄后的**令牌，宿主不需要再自己判一遍空', () => {
    const plan = planDisplayNameWrite({ token: 'tok-1', draft: '小鹿', saved: null });
    if (plan.action !== 'write') throw new Error('应当是 write 分支');
    expect(plan.token).toBe('tok-1');
    expect(plan.token.trim()).toBe(plan.token);
  });
});
