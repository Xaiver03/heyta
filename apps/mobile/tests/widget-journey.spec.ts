/**
 * 应用内小组件旅程的纯逻辑测试。
 *
 * 这里测的都是**在开发机上看不出错、在真机上会出错**的分支：
 * 平台名的大小写、鸿蒙的未知平台、以及"原生桥不在时该不该画整段旅程"。
 */

import { describe, expect, it } from 'vitest';

import {
  WIDGET_CARD_KEYS,
  resolveWidgetPlatform,
  shouldShowWidgetJourney,
  widgetAddSteps,
} from '../src/widgets/widget-journey';

describe('resolveWidgetPlatform', () => {
  it('认得出 iOS 与 Android', () => {
    expect(resolveWidgetPlatform('ios')).toBe('ios');
    expect(resolveWidgetPlatform('android')).toBe('android');
  });

  it('🔴 大小写与空白都要容错', () => {
    // ⚠️ 这个值来自运行时而非常量。`'iOS'` 落到 `other` 的话，
    //    用户会拿到鸿蒙版的两步说明，而这段说明在 iOS 上走不通。
    expect(resolveWidgetPlatform('iOS')).toBe('ios');
    expect(resolveWidgetPlatform(' IOS ')).toBe('ios');
    expect(resolveWidgetPlatform('Android')).toBe('android');
    expect(resolveWidgetPlatform('\tandroid\n')).toBe('android');
  });

  it('🔴 鸿蒙这类未知平台落到 other，**不是落到 ios**', () => {
    // 把 other 当成"兜底的 iOS"会给鸿蒙用户一条走不通的路径。
    for (const os of ['harmony', 'harmonyos', 'ohos', 'windows', 'web', '', null, undefined]) {
      expect(resolveWidgetPlatform(os)).toBe('other');
    }
  });

  it('非字符串输入不炸（运行时值可能是任何东西）', () => {
    expect(resolveWidgetPlatform(undefined)).toBe('other');
    expect(resolveWidgetPlatform(null)).toBe('other');
    // @ts-expect-error 故意传错类型，验证运行时不会抛
    expect(resolveWidgetPlatform(42)).toBe('other');
  });
});

describe('widgetAddSteps', () => {
  it('iOS 四步', () => {
    expect(widgetAddSteps('ios')).toEqual([
      'mobile.widgetJourney.ios.step1',
      'mobile.widgetJourney.ios.step2',
      'mobile.widgetJourney.ios.step3',
      'mobile.widgetJourney.ios.step4',
    ]);
  });

  it('Android 三步', () => {
    expect(widgetAddSteps('android')).toHaveLength(3);
    expect(widgetAddSteps('android')[0]).toBe('mobile.widgetJourney.android.step1');
  });

  it('other 两步（通用且诚实，不套用 iOS 的步骤）', () => {
    const steps = widgetAddSteps('other');
    expect(steps).toHaveLength(2);
    // 🔴 关键：绝不能出现 iOS 的词条 —— 那对鸿蒙用户是错的。
    expect(steps.some((k) => k.includes('.ios.'))).toBe(false);
  });

  it('每一步都是非空字符串，且平台之间不串味', () => {
    for (const platform of ['ios', 'android', 'other'] as const) {
      const steps = widgetAddSteps(platform);
      expect(steps.length).toBeGreaterThan(0);
      for (const key of steps) {
        expect(typeof key).toBe('string');
        expect(key.length).toBeGreaterThan(0);
        if (platform !== 'ios') expect(key.includes('.ios.')).toBe(false);
        if (platform !== 'android') expect(key.includes('.android.')).toBe(false);
      }
    }
  });
});

describe('shouldShowWidgetJourney', () => {
  it('原生桥在 → 画', () => {
    expect(shouldShowWidgetJourney(true)).toBe(true);
  });

  it('🔴 原生桥不在 → 不画', () => {
    // 画了的话，用户照做会在桌面得到一张**永远显示占位**的卡片。
    // 与"一个点了没反应的开关比没有更糟"是同一条纪律。
    expect(shouldShowWidgetJourney(false)).toBe(false);
  });
});

describe('WIDGET_CARD_KEYS', () => {
  it('四张卡片，顺序以 today 开头（决策 D2）', () => {
    expect(WIDGET_CARD_KEYS).toHaveLength(4);
    expect(WIDGET_CARD_KEYS[0]).toBe('mobile.widgetJourney.card.today');
  });

  it('无重复', () => {
    expect(new Set(WIDGET_CARD_KEYS).size).toBe(WIDGET_CARD_KEYS.length);
  });
});
