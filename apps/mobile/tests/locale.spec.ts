/**
 * 设备语言读取测试
 * ==================
 *
 * 🔴 这个文件存在的理由：**语言认错，用户会看到自己读不懂的界面** ——
 * 症状不是崩溃，而是整个界面变成另一种语言，且没有任何一层报错。
 *
 * **标签怎么归一的用例不在这里**：2026-10-01 起 mobile 的判定改用
 * `@heyta/i18n` 的 `matchLocale`（web 的 `navigator.language` 首启层同一个
 * 函数），那批用例整体迁去了 `packages/i18n/tests/match.spec.ts` ——
 * 同一逻辑只有一份实现，测试也只留一份。
 *
 * 这里只钉**移动端独有的那一半**：问哪个原生模块、以及
 * "读不到系统语言"绝不能让启动路径崩掉。
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE } from '@heyta/i18n';

import { resolveDeviceLocale } from '../src/i18n/locale';

describe('resolveDeviceLocale', () => {
  it('🔴 在没有 react-native 的环境里不抛异常，回落到默认语言', () => {
    // 本套件跑在 node 里，`require('react-native')` 不可用（或加载失败）——
    // `resolveDeviceLocale` 必须把"读不到系统语言"当成正常情况，
    // 否则 `App.tsx` 的初始化会直接崩在启动路径上。
    expect(() => resolveDeviceLocale()).not.toThrow();
    expect(resolveDeviceLocale()).toBe(DEFAULT_LOCALE);
  });
});
