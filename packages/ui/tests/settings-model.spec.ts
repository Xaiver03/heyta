/**
 * 设置共享模型的测试
 * ====================
 *
 * 这里挑的都是**不报错、只会画错**的边界：`false` 到底算不算"用户关着"、
 * 探测中的 `undefined` 该不该画、待上传的 `0` 是"全传完了"还是"还没读到"、
 * 英文单复数怎么判、行的 key 会不会在插入一行时张冠李戴。
 * 它们全都能编译、能运行，只会在屏幕上呈现成另一件事 ——
 * 而这正是本仓库反复吃亏的那一类（`AGENTS.md` M0-1 的教训）。
 *
 * ⚠️ 这个测试跑在 **node** 环境（`vitest.config.ts` 文件头有理由）：
 * `packages/ui` 不引入 DOM 测试栈，所以"有判断"的部分必须留在 `model.ts`。
 * 一旦有人在 `model.ts` 里 import 了 `react-native` / `@heyta/i18n`，
 * 这里会立刻失败。
 *
 * 🔴 有几条断言是**针对一次真实的界面撒谎**写的（`pendingUpload` 初值是 0
 * 时"一条没传"显示成"已全部上传"；安卓上把 `null` 当成 `false` 会画出一个
 * 按了没反应的开关）—— 它们不是"随手加的风格断言"。
 */

import { describe, expect, it } from 'vitest';

import {
  isSettingActionable,
  resolvePendingUploadPresentation,
  resolveSettingAvailability,
  settingsRowKey,
  shouldRenderSettingsRow,
  type SettingsRowModel,
} from '../src/settings/model.js';

describe('resolveSettingAvailability', () => {
  it('🔴 `false` 是"用户关着"，不是"不可用" —— 当成不可用会让开关在关掉的那一刻消失', () => {
    expect(resolveSettingAvailability(false)).toBe('ready');
    expect(isSettingActionable(resolveSettingAvailability(false))).toBe(true);
  });

  it('`true` 当然是可用（上面那条的反面，防止归一化把两者一起判错）', () => {
    expect(resolveSettingAvailability(true)).toBe('ready');
  });

  it('`null` 是"这台设备没有这一项"（安卓/鸿蒙没有锁屏隐私开关）', () => {
    expect(resolveSettingAvailability(null)).toBe('unsupported');
    expect(isSettingActionable('unsupported')).toBe(false);
  });

  it('`undefined` 是"还没读到/还在探测"，与 `null` 必须分开', () => {
    expect(resolveSettingAvailability(undefined)).toBe('unknown');
    expect(resolveSettingAvailability(undefined)).not.toBe('unsupported');
    expect(isSettingActionable('unknown')).toBe(false);
  });

  it('只有 ready 能干事的（穷尽三态，防新增一态被默认放行）', () => {
    expect(
      (['unknown', 'unsupported', 'ready'] as const).map((a) => isSettingActionable(a)),
    ).toEqual([false, false, true]);
  });
});

describe('resolvePendingUploadPresentation', () => {
  it('🔴 `undefined`（还没读到队列）不是 `0`（全传完了）—— 这是"已全部上传"那次撒谎的形状', () => {
    expect(resolvePendingUploadPresentation(undefined)).toEqual({ kind: 'unknown' });
    expect(resolvePendingUploadPresentation(0)).toEqual({ kind: 'none' });
  });

  it('1 条走单数（词条表没有 ICU，英文要靠兄弟词条）', () => {
    expect(resolvePendingUploadPresentation(1)).toEqual({ kind: 'count', count: 1, plural: false });
  });

  it('2 条起走复数', () => {
    expect(resolvePendingUploadPresentation(2)).toEqual({ kind: 'count', count: 2, plural: true });
    expect(resolvePendingUploadPresentation(99)).toEqual({ kind: 'count', count: 99, plural: true });
  });

  it('负数按"没有待上传"处理，不显示成"欠 -3 条"', () => {
    expect(resolvePendingUploadPresentation(-3)).toEqual({ kind: 'none' });
  });
});

describe('shouldRenderSettingsRow', () => {
  const toggle = (availability?: 'unknown' | 'unsupported' | 'ready'): SettingsRowModel => ({
    kind: 'toggle',
    label: '隐藏任务标题',
    checked: false,
    onToggle: () => undefined,
    ...(availability === undefined ? {} : { availability }),
  });

  it('🔴 不可用 / 未探测的开关**整行不渲染**（灰着的开关比没有更坏）', () => {
    expect(shouldRenderSettingsRow(toggle('unsupported'))).toBe(false);
    expect(shouldRenderSettingsRow(toggle('unknown'))).toBe(false);
  });

  it('可用的开关当然渲染', () => {
    expect(shouldRenderSettingsRow(toggle('ready'))).toBe(true);
  });

  it('没给 availability 时默认渲染（宿主自己判过了）', () => {
    expect(shouldRenderSettingsRow(toggle())).toBe(true);
  });

  it('其余四种行永远渲染 —— 这条判据只针对开关', () => {
    const rows: readonly SettingsRowModel[] = [
      { kind: 'value', label: '待上传', value: '3' },
      { kind: 'action', label: '帮助中心', href: '/help' },
      { kind: 'note', text: '这是导出，还不是还原点' },
      { kind: 'heading', text: '怎么把卡片加上去' },
    ];
    expect(rows.map(shouldRenderSettingsRow)).toEqual([true, true, true, true]);
  });
});

describe('settingsRowKey', () => {
  it('testID 优先 —— 步骤表那种常量表不该靠下标认行', () => {
    expect(
      settingsRowKey({ kind: 'note', text: '第一步', testID: 'step-1' }, 0),
    ).toBe('step-1');
  });

  it('没有 testID 时用 label / text，而不是下标', () => {
    expect(settingsRowKey({ kind: 'value', label: '上次同步', value: '—' }, 3)).toBe(
      'value:上次同步',
    );
    expect(settingsRowKey({ kind: 'heading', text: '怎么安装' }, 0)).toBe('heading:怎么安装');
  });

  it('同一个列表里两种行的 key 不会相撞（前缀区分了 kind）', () => {
    const keys = [
      settingsRowKey({ kind: 'value', label: 'x', value: '1' }, 0),
      settingsRowKey({ kind: 'toggle', label: 'x', checked: true, onToggle: () => undefined }, 1),
      settingsRowKey({ kind: 'action', label: 'x' }, 2),
      settingsRowKey({ kind: 'note', text: 'x' }, 3),
      settingsRowKey({ kind: 'heading', text: 'x' }, 4),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('空串 testID 不算数（空 testID 会让所有行共用同一个 key）', () => {
    expect(settingsRowKey({ kind: 'note', text: 'x', testID: '' }, 7)).toBe('note:x');
  });
});