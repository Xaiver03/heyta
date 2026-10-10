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

import { resolveDeviceLocale, resolveNativeLocale } from '../src/i18n/locale';

describe('resolveDeviceLocale', () => {
  it('🔴 在没有 react-native 的环境里不抛异常，回落到默认语言', () => {
    // 本套件跑在 node 里，`require('react-native')` 不可用（或加载失败）——
    // `resolveDeviceLocale` 必须把"读不到系统语言"当成正常情况，
    // 否则 `App.tsx` 的初始化会直接崩在启动路径上。
    expect(() => resolveDeviceLocale()).not.toThrow();
    expect(resolveDeviceLocale()).toBe(DEFAULT_LOCALE);
  });
});

describe('独立设备语言与系统组件一致', () => {
  it('中文偏好覆盖英文系统；英文偏好覆盖中文系统', () => {
    expect(resolveNativeLocale({ HeytaWidget: { preferredLocale: 'zh-CN', deviceLocale: 'en-US' } })).toBe('zh-CN');
    expect(resolveNativeLocale({ HeytaWidget: { preferredLocale: 'en', deviceLocale: 'zh-Hans-CN' } })).toBe('en');
  });

  it('没有偏好时由原生设备语言补足现代 RN 缺失的 localeIdentifier', () => {
    expect(resolveNativeLocale({ HeytaWidget: { deviceLocale: 'en-US' }, I18nManager: {} })).toBe('en');
    expect(resolveNativeLocale({ HeytaWidget: { deviceLocale: 'zh-Hans-CN' } })).toBe('zh-CN');
  });

  it('坏偏好回落设备语言，旧桥继续使用已有系统模块', () => {
    expect(resolveNativeLocale({ HeytaWidget: { preferredLocale: 'invalid', deviceLocale: 'en-US' } })).toBe('en');
    expect(resolveNativeLocale({ SettingsManager: { settings: { AppleLanguages: ['en-US'] } } })).toBe('en');
    expect(resolveNativeLocale({ I18nManager: { localeIdentifier: 'zh_CN' } })).toBe('zh-CN');
  });

  it('原生 getter 失败不会阻断启动', () => {
    const modules = { get HeytaWidget(): unknown { throw new Error('native unavailable'); } };
    expect(resolveNativeLocale(modules)).toBe(DEFAULT_LOCALE);
  });
});
