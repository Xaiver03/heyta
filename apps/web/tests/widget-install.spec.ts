/**
 * Web/Windows 小组件引导的纯逻辑测试。
 *
 * 这里测的都是**开发机上看不出错、到用户机器上会出错**的分支：
 * 平台名的大小写、非 Windows 平台**不能套用 Windows 的三步**、以及
 * "已经装成应用时第一段就不该再教人怎么装"。
 */

import { describe, expect, it } from 'vitest';

import {
  installSteps,
  isRunningStandalone,
  resolveInstallPlatform,
  resolveWidgetJourneyHost,
  shouldShowInstallGuide,
} from '../src/pwa/widget-install';

describe('resolveInstallPlatform', () => {
  it('认得出 Windows 与 macOS', () => {
    expect(resolveInstallPlatform('Windows')).toBe('windows');
    expect(resolveInstallPlatform('Win32')).toBe('windows');
    expect(resolveInstallPlatform('macOS')).toBe('macos');
    expect(resolveInstallPlatform('MacIntel')).toBe('macos');
  });

  it('大小写与空白容错', () => {
    expect(resolveInstallPlatform('WINDOWS')).toBe('windows');
    expect(resolveInstallPlatform('  win  ')).toBe('windows');
    expect(resolveInstallPlatform('mac')).toBe('macos');
  });

  it('🔴 未知平台落到 other，**不是落到 windows**', () => {
    // 把 other 当成"兜底的 Windows"会给 Linux/Android 用户一条走不通的路径。
    for (const p of ['Linux x86_64', 'Android', 'iOS', '', null, undefined]) {
      expect(resolveInstallPlatform(p)).toBe('other');
    }
  });

  it('非字符串输入不炸', () => {
    // @ts-expect-error 故意传错类型，验证运行时不会抛
    expect(resolveInstallPlatform(42)).toBe('other');
  });
});

describe('installSteps', () => {
  it('Windows 三步，末步必须告诉用户"卡片这时才出现"', () => {
    const steps = installSteps('windows');
    expect(steps).toHaveLength(3);
    // 🔴 第三条不是操作而是**验收**：不说它，用户装完不知道成没成功。
    expect(steps[2]).toBe('web.widgetJourney.windows.step3');
  });

  it('macOS 两步', () => {
    expect(installSteps('macos')).toEqual([
      'web.widgetJourney.macos.step1',
      'web.widgetJourney.macos.step2',
    ]);
  });

  it('🔴 other 不套用 Windows 的三步（那是走不通的路径）', () => {
    const steps = installSteps('other');
    expect(steps).toHaveLength(2);
    expect(steps.some((k) => k.includes('.windows.'))).toBe(false);
  });

  it('各平台之间不串味', () => {
    for (const p of ['windows', 'macos', 'other'] as const) {
      for (const key of installSteps(p)) {
        if (p !== 'windows') expect(key.includes('.windows.')).toBe(false);
        if (p !== 'macos') expect(key.includes('.macos.')).toBe(false);
      }
    }
  });
});

describe('isRunningStandalone', () => {
  it('standalone 命中', () => {
    expect(isRunningStandalone((q) => q.includes('standalone'))).toBe(true);
  });

  it('window-controls-overlay 也算（桌面 PWA 常见）', () => {
    expect(isRunningStandalone((q) => q.includes('window-controls-overlay'))).toBe(true);
  });

  it('浏览器标签页里不算', () => {
    expect(isRunningStandalone(() => false)).toBe(false);
  });

  it('🔴 matchMedia 抛异常时返回 false，不把设置页带崩', () => {
    expect(
      isRunningStandalone(() => {
        throw new Error('matchMedia 在无 DOM 环境下没有');
      }),
    ).toBe(false);
  });
});

describe('shouldShowInstallGuide', () => {
  it('没装成应用 → 要教', () => {
    expect(shouldShowInstallGuide(false)).toBe(true);
  });

  it('🔴 已经装成应用 → 不再教怎么装', () => {
    expect(shouldShowInstallGuide(true)).toBe(false);
  });
});

describe('resolveWidgetJourneyHost', () => {
  it('原生桌面壳是已安装宿主，但不冒充系统小组件提供方', () => {
    expect(resolveWidgetJourneyHost('Windows', false, true)).toEqual({
      platform: 'windows',
      host: 'native-shell',
      provider: 'none',
      standalone: true,
      showInstallGuide: false,
    });
    expect(resolveWidgetJourneyHost('MacIntel', true, true).provider).toBe('none');
  });

  it('非 Windows 的独立窗口仍显示为已安装宿主，但不宣称有系统小组件', () => {
    expect(resolveWidgetJourneyHost('MacIntel', true, false)).toEqual({
      platform: 'macos',
      host: 'standalone',
      provider: 'none',
      standalone: true,
      showInstallGuide: false,
    });
  });

  it('Windows PWA 才是当前桌面小组件提供方', () => {
    expect(resolveWidgetJourneyHost('Win32', true, false)).toEqual({
      platform: 'windows',
      host: 'windows-pwa',
      provider: 'windows-pwa',
      standalone: true,
      showInstallGuide: false,
    });
  });

  it('Windows 浏览器标签页显示安装路径，非 Windows 不显示走不通的步骤', () => {
    expect(resolveWidgetJourneyHost('Windows', false, false)).toMatchObject({
      host: 'browser',
      provider: 'windows-pwa-candidate',
      showInstallGuide: true,
    });
    expect(resolveWidgetJourneyHost('MacIntel', false, false)).toMatchObject({
      host: 'browser',
      provider: 'none',
      showInstallGuide: false,
    });
    expect(resolveWidgetJourneyHost('Linux x86_64', false, false)).toMatchObject({
      host: 'browser',
      provider: 'none',
      showInstallGuide: false,
    });
  });
});
