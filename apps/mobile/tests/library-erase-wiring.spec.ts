/**
 * 退出登录必须**先销毁本机库**（R1 / ADR-0084）
 * ==============================================
 *
 * 这条判据只能读源码：`onClearCredentials` 是「我的」屏里的闭包，跑它要么起整个
 * App（设备腿），要么把 200 行的清理编排重写一遍 —— 后者测的是副本，不是产品。
 *
 * 所以这里钉两件**会静默退化**的事：
 *   1. `purgeLocalLibrary()` 真的被调用（删掉它 ⇒ 退出登录又变成"只清凭据"）；
 *   2. 它排在 `clearMobileVaultSession()` **之前** —— 反过来的话，配置与钥匙先没了，
 *      库还在，而那条销毁路径再也不会有人走到。
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/screens/ProfileScreen.tsx', import.meta.url), 'utf8');

describe('移动端退出登录：先销毁本机库，再清钥匙', () => {
  it('调用了 purgeLocalLibrary()', () => {
    expect(source).toContain('purgeLocalLibrary(');
  });

  it('销毁排在 clearMobileVaultSession 之前', () => {
    const purgeAt = source.indexOf('await purgeLocalLibrary()');
    const vaultAt = source.indexOf('clearMobileVaultSession(scope)');
    expect(purgeAt).toBeGreaterThan(-1);
    expect(vaultAt).toBeGreaterThan(-1);
    expect(purgeAt).toBeLessThan(vaultAt);
  });

  it('销毁失败会留一条可见状态，且不当成"清过了"', () => {
    expect(source).toContain("setLibraryErasePending(purge.status === 'incomplete')");
    expect(source).toContain('retryLibraryErase');
  });
});
