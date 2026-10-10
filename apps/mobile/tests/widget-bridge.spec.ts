/**
 * 小组件桥接层测试
 * ==================
 *
 * 🔴 这个文件存在的理由：**桥接层的失败是安静的。**
 *
 * 小组件是附属功能，它的调用点都在"应用已经在正常工作了"的路径上，
 * 所以后台刷新函数的契约都是"**永不抛，回落到安全值**"。
 * 而"回落到安全值"如果写错了（比如 `await` 没放进 `try`），
 * 症状是**应用偶发崩溃在小组件刷新路径上** —— 一个附属功能拖垮主应用。
 *
 * ## 为什么不去 mock `react-native`
 *
 * 本仓库的移动端测试**刻意不 import `react-native`**（在 node 里加载它直接失败）。
 * mock 它会让测试验的是 mock 的形状，而"原生模块真的返回什么"根本验不到。
 * 所以这里测的是**抽出来的纯函数**（`callNativeSafely` / `describeWidgetError`）
 * 加上**真实降级路径**（node 里就是没有 react-native）—— 与
 * `src/i18n/locale.ts` 把可测部分抽出来是同一个手法。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  callNativeSafely,
  clearWidgetState,
  describeWidgetError,
  drainIntentQueue,
  isWidgetBridgeAvailable,
  readWidgetPrivacy,
  setWidgetPrivacy,
  syncFocusActivity,
  resetMissingModuleWarningForTests,
  setWidgetSnapshot,
} from '../src/widgets/widget-bridge';

afterEach(() => {
  vi.restoreAllMocks();
  resetMissingModuleWarningForTests();
});

describe('describeWidgetError', () => {
  it('🔴 带 code 的错误必须把 code 留在日志里', () => {
    // 原生侧用契约的拒绝原因做错误码（`E_WIDGET_INVALID_ENVELOPE` +
    // `unknown-version: …`）。丢掉 code 之后日志里只剩"写入失败"，
    // 而"写入失败"可以有十几种原因 —— 那等于没有日志。
    const error = Object.assign(new Error('unknown-version: v=99'), {
      code: 'E_WIDGET_INVALID_ENVELOPE',
    });
    expect(describeWidgetError(error)).toBe('E_WIDGET_INVALID_ENVELOPE: unknown-version: v=99');
  });

  it('没有 code 时只用 message，不出现 `undefined:`', () => {
    expect(describeWidgetError(new Error('网络断了'))).toBe('网络断了');
  });

  it('空字符串的 code 不当作有效 code', () => {
    const error = Object.assign(new Error('坏了'), { code: '' });
    expect(describeWidgetError(error)).toBe('坏了');
  });

  it('非 Error 的值也能安全描述（原生可能 reject 一个字符串或对象）', () => {
    expect(describeWidgetError('直接是个字符串')).toBe('直接是个字符串');
    expect(describeWidgetError(undefined)).toBe('undefined');
    expect(describeWidgetError({ code: 500 })).toBe('[object Object]');
  });
});

describe('callNativeSafely', () => {
  it('成功时返回真实结果，不碰 fallback', async () => {
    await expect(callNativeSafely('测试', async () => 'REAL', 'FALLBACK')).resolves.toBe('REAL');
  });

  it('🔴 Promise rejection 必须被接住（`await` 在 try 里面）', async () => {
    // 这条守着桥接层最容易写错的一处：`try { const p = call() } catch` 只能挡住
    // **同步**异常，而原生模块的失败**全部**是 Promise rejection
    //（`promise.reject(...)`）。写成那样等于没接住。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = async (): Promise<string> => {
      throw Object.assign(new Error('原生拒绝了'), { code: 'E_WIDGET_READ_FAILED' });
    };

    await expect(callNativeSafely('读取', failing, 'FALLBACK')).resolves.toBe('FALLBACK');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[1])).toContain('E_WIDGET_READ_FAILED');
  });

  it('同步抛出的调用也要接住（不是所有原生包装都返回 Promise）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const syncThrow = ((): Promise<string> => {
      throw new Error('同步就炸了');
    }) as () => Promise<string>;

    await expect(callNativeSafely('写入', syncThrow, 'FALLBACK')).resolves.toBe('FALLBACK');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('fallback 为 null 时不会被误当成"成功"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = async (): Promise<string | null> => {
      throw new Error('坏了');
    };

    await expect(callNativeSafely('读取', failing, null)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('没有 react-native 时的降级（node 里的真实情况）', () => {
  it('模块判定为不可用', () => {
    expect(isWidgetBridgeAvailable()).toBe(false);
  });

  it('🔴 三个函数都不抛，各自回落到安全值', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(setWidgetSnapshot('{"v":1}')).resolves.toBe(false);
    await expect(drainIntentQueue()).resolves.toBeNull();
    await expect(clearWidgetState()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
  });

  it('🔴 模块缺失只警告一次 —— 否则 iOS 未实现时会把日志刷满', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await setWidgetSnapshot('{"v":1}');
    await setWidgetSnapshot('{"v":1}');
    await drainIntentQueue();
    await clearWidgetState();

    // 四次调用，一次警告。理由：iOS 在 W2 之前本来就没有这个模块，
    // 每次都警告会让人**学会忽略这条日志** —— 而它恰恰是"忘了注册 WidgetPackage"
    // 的唯一线索。
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('HeytaWidget');
  });
});

// ─────────────────────────────────────────────────────────────
// W5-2 / W5-3 · 新增的两个方法在**没有原生模块**时的回落
// ─────────────────────────────────────────────────────────────

describe('W5 新增方法的降级路径', () => {
  /**
   * 🔴 `readWidgetPrivacy` 在 node 里（没有 react-native）必须给 `null`，
   * **不能**给 `false`。
   *
   * 这个区别是产品级的：`false` = "用户关着"，`null` = "这个平台没有这一项"。
   * 归一错了，应用会在安卓上渲染一个**按了没反应的开关**，
   * 而用户会以为他设上了 —— 比不显示更坏。
   */
  it('🔴 读不到原生模块时给 null，不能给 false', async () => {
    const value = await readWidgetPrivacy();
    expect(value).toBeNull();
    expect(value).not.toBe(false);
  });

  /** 写失败必须**如实**返回 `false` —— 上层据此回滚开关并提示。 */
  it('写不了时返回 false（而不是假装成功）', async () => {
    await expect(setWidgetPrivacy(true)).resolves.toBe(false);
  });

  /**
   * ⚠️ `syncFocusActivity` 必须给字符串 `'none'`，不是 `false`。
   * `'none'` = "我没能判断"，`'noop'` = "判断了、不用做" —— 两者排查方向不同。
   */
  it('推进灵动岛拿不到结局时给 none 这个字符串', async () => {
    await expect(syncFocusActivity()).resolves.toBe('none');
  });

  /**
   * 🔴 **"旧原生 + 新 JS"** 是最容易被忘掉的一种状态：JS 包里已经有这三个新方法，
   * 而装上的是一个还没升级的原生模块（安卓/鸿蒙本来就没有 `readWidgetPrivacy`）。
   *
   * 这时 `native.readWidgetPrivacy(...)` 会**同步**抛 `TypeError: not a function`
   * —— 注意是**同步**，不是 reject。`callNativeSafely` 的 `try` 必须包住
   * `call()` 的**调用本身**，而不只是 `await` 它，否则这个 TypeError
   * 会一路冒到设置页的 `useEffect` 里，变成一条红色的 React 错误。
   */
  it('🔴 原生缺这个方法时也要回落（同步 TypeError 不能让调用方拿到）', async () => {
    const nativeWithoutMethod = {} as { readWidgetPrivacy?: () => Promise<boolean | null> };
    const value = await callNativeSafely(
      '读锁屏隐私偏好',
      // 与真实代码里一模一样的写法：直接调用一个不存在的属性。
      () => (nativeWithoutMethod.readWidgetPrivacy as () => Promise<boolean | null>)(),
      null,
    );
    expect(value).toBeNull();
  });

  it('永不抛（三个都是）', async () => {
    await expect(
      Promise.all([readWidgetPrivacy(), setWidgetPrivacy(true), syncFocusActivity()]),
    ).resolves.toBeDefined();
  });
});


describe('显式清理不能将原生失败报告为成功', () => {
  it('原生拒绝和返回false都传播给清理流程', async () => {
    const error = new Error('key deletion failed');
    await expect(clearWidgetState({ clearWidgetState: async () => { throw error; } })).rejects.toBe(error);
    await expect(clearWidgetState({ clearWidgetState: async () => false })).rejects.toThrow('could not be cleared');
    await expect(clearWidgetState({ clearWidgetState: async () => true })).resolves.toBeUndefined();
  });
});
