/**
 * `wipeCredentialsAndWidgets` 的承重测试。
 * ==========================================
 *
 * 🔴 这个文件要钉住的是一条**产品级**的性质，不是实现细节：
 *
 * > **用户点了「清除凭据」之后，屏幕上不能再有他的任务。**
 *
 * 而这条性质有一个特别坏的性质 —— **它错了没有任何症状**：
 * 应用里一切正常、没有报错、设置页显示凭据已清空，只有主屏和锁屏上
 * 还挂着上一个账号的任务，而且看起来完全正常。
 *
 * 所以这里每一条都对应一个具体的、真实的失败形态。
 */

import { describe, expect, it, vi } from 'vitest';

import { wipeCredentialsAndWidgets } from '../src/widgets/credential-wipe';

function deps(over: Partial<Parameters<typeof wipeCredentialsAndWidgets>[0]> = {}) {
  return {
    clearCredentials: vi.fn(),
    clearWidgets: vi.fn(async () => {}),
    ...over,
  };
}

describe('wipeCredentialsAndWidgets', () => {
  it('正常路径：两件都做了，且结果如实汇报', async () => {
    const d = deps();
    const result = await wipeCredentialsAndWidgets(d);

    expect(result).toEqual({ credentialsCleared: true, widgetsCleared: true });
    expect(d.clearCredentials).toHaveBeenCalledTimes(1);
    expect(d.clearWidgets).toHaveBeenCalledTimes(1);
  });

  /**
   * 🔴 **顺序**：先清凭据。
   *
   * 反过来会有一个真实的空档 —— 清凭据可能触发一次状态变化、进而触发一次
   * publish，于是**组件又被填上一份新快照**，而这一步之后没有任何清理。
   * 用户以为清干净了，屏幕上还挂着任务。
   *
   * ⚠️ 这条断言看起来像"实现细节"，但它挡的是一个**可观测的**后果。
   *    所以这里比较的是**调用顺序**，不是"调用了两次"。
   */
  it('🔴 必须先清凭据、后清组件 —— 反过来会给组件重新填一份快照的机会', async () => {
    const order: string[] = [];
    await wipeCredentialsAndWidgets({
      clearCredentials: () => {
        order.push('credentials');
      },
      clearWidgets: async () => {
        order.push('widgets');
      },
    });
    expect(order).toEqual(['credentials', 'widgets']);
  });

  /**
   * 🔴 **凭据清理抛异常时，组件仍然必须被清掉。**
   *
   * 方向是"宁可多清一次"：组件清空了最多是用户要重新打开应用；
   * 没清空是**数据留在屏幕上**。两者严重程度差一个数量级。
   */
  it('🔴 凭据清理抛异常时，组件仍然必须清掉', async () => {
    const onCredentialError = vi.fn();
    const d = deps({
      clearCredentials: () => {
        throw new Error('凭据存储损坏');
      },
      onCredentialError,
    });

    const result = await wipeCredentialsAndWidgets(d);

    expect(result.credentialsCleared).toBe(false);
    expect(
      result.widgetsCleared,
      '🔴 凭据那边失败**不能**让组件跳过清理 —— 那正是"数据留在屏幕上"的成因',
    ).toBe(true);
    expect(d.clearWidgets).toHaveBeenCalledTimes(1);
    expect(onCredentialError).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ 组件清理失败**不能**抛出去（它挂在设置页的按钮上，
   * 为一个附属功能让按钮炸掉是荒唐的），但**必须**有出口 ——
   * 否则"没清干净"会退化成一个没人知道的 `false`。
   */
  it('组件清理失败时不抛，但如实汇报 + 走通知出口', async () => {
    const onWidgetError = vi.fn();
    const d = deps({
      clearWidgets: async () => {
        throw new Error('原生模块不可用');
      },
      onWidgetError,
    });

    const result = await wipeCredentialsAndWidgets(d);

    expect(result).toEqual({ credentialsCleared: true, widgetsCleared: false });
    expect(onWidgetError).toHaveBeenCalledTimes(1);
  });

  it('两个都失败时也不抛', async () => {
    await expect(
      wipeCredentialsAndWidgets({
        clearCredentials: () => {
          throw new Error('a');
        },
        clearWidgets: async () => {
          throw new Error('b');
        },
      }),
    ).resolves.toEqual({ credentialsCleared: false, widgetsCleared: false });
  });

  /**
   * ⚠️ 这条钉的是"**没有通知出口时也不能抛**"。
   *
   * `onCredentialError` / `onWidgetError` 都是可选的；如果实现里写成
   * `deps.onWidgetError!(e)`，那么不传回调的调用方会拿到一个
   * `TypeError: deps.onWidgetError is not a function` —— 而这会
   * **抛到设置页的按钮上**，正好是上面那条要避免的事。
   */
  it('没传通知出口时同样不抛', async () => {
    await expect(
      wipeCredentialsAndWidgets({
        clearCredentials: () => {
          throw new Error('a');
        },
        clearWidgets: async () => {
          throw new Error('b');
        },
      }),
    ).resolves.toBeDefined();
  });
});
