/**
 * 启动路径判定（`main.tsx` 的四条渲染出口）。
 *
 * 这一枚纯函数存在的唯一理由，是让"`/admin` 走 `console` 而不是 `app`"
 * 可以**在入口之外被喂形状**——`main.tsx` 不可测（import 它就真去建 root）。
 * 而 `console` 与 `app` 的差别不只是画哪个壳：`console` 不初始化本地 op-log
 * （ADR-0078），把那条分支挪到 `app` 之后，后台页会重新被 OPFS 的排他锁挡住。
 */
import { describe, expect, it } from 'vitest';

import { startupMode } from '../src/lib/startup-mode.js';

describe('启动路径判定：顺序即契约', () => {
  it.each([
    ['', '/', 'app'],
    ['', '/app/', 'app'],
    ['?tab=all', '/app/', 'app'],
    ['', '/admin', 'console'],
    ['', '/admin/', 'console'],
    ['', '/admin//', 'console'],
    ['', '/app/admin', 'console'],
    ['?signin', '/admin', 'console'],
  ] as const)('search=%s pathname=%s ⇒ %s', (search, pathname, expected) => {
    expect(startupMode(search, pathname)).toBe(expected);
  });

  it.each([
    // 验证入口排在后台之前：`?shell=` 是原生壳打包后加载的入口，谁都不能抢。
    ['?shell=1', '/admin', 'shell'],
    ['?slice=1', '/admin', 'slice'],
    ['?shell=1&slice=1', '/', 'shell'],
    ['?slice=1', '/', 'slice'],
  ] as const)('验证入口优先：search=%s pathname=%s ⇒ %s', (search, pathname, expected) => {
    expect(startupMode(search, pathname)).toBe(expected);
  });

  it('只认整段相等：自托管用户自己的 …/admin 不切进后台壳', () => {
    expect(startupMode('', '/my/admin/page')).toBe('app');
    expect(startupMode('', '/administrator')).toBe('app');
  });
});
