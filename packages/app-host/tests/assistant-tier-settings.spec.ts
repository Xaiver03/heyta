/**
 * 助手档位持久化语义的测试（宿主无关层）
 * =====================================
 *
 * 这个文件存在的理由不是"覆盖一个函数"，而是钉住三条**改了就出问题、
 * 但没有任何一层会报错**的不变量：
 *
 *   1. 出厂默认 = 执行，但真正落库仍需逐条确认；坏值仍然回到只读。
 *   2. 顺序固定为低权限到高权限。设置界面用 `.map()` 渲染单选项，不能跨端漂移。
 *   3. 归一只认**逐字**等于开写那一档的值。"看起来像真"的读法会把一次坏 JSON、
 *      一个别家写的同名键、或一次手滑的编辑变成放开写入。
 *
 * 另外钉一条**磁盘词汇**：两个字面量的值。它们已经写进用户设备的 `localStorage`
 * 和将来原生端的表里，把常量**改名**是重构，把常量**改值**是数据不兼容。
 *
 * ⚠️ Web 那条真实通道（`apps/web/src/features/settings/aiStore.ts` 的整块 JSON）
 * 的行为由 `apps/web/tests/ai-assistant-tier.spec.tsx` 钉 —— 抽取之后它**一行没改**
 * 就仍然全绿，那正是"行为不变"的证据。这里用一份内存假端口代表
 * "下一个壳要给的东西"。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  ASSISTANT_TIER_ORDER,
  ASSISTANT_TIER_READ_AND_PROPOSE,
  ASSISTANT_TIER_READ_ONLY,
  DEFAULT_ASSISTANT_TIER,
  createAssistantTierStore,
  normalizeAssistantTier,
  type AssistantTierStorePort,
} from '../src/assistant-tier-settings.js';
// `AssistantTier` **不从 `assistant-tier-settings.js` 拿** —— 类型住在
// `ai-assistant.ts`，那里是它唯一的出处（本包再导出一份就有两个出处）。
import type { AssistantTier } from '../src/ai-assistant.js';

/** 一个内存假端口：形状就是 node-host / 原生壳要交给这里的东西。 */
function fakePort(initial: unknown = undefined): AssistantTierStorePort & {
  /** 通道里的**原始**字节，用来证明坏值没有被写回磁盘。 */
  raw(): unknown;
} {
  let value = initial;
  return {
    read: () => value,
    write: (tier: AssistantTier) => {
      value = tier;
    },
    raw: () => value,
  };
}

describe('磁盘词汇', () => {
  it('🔴 两个字面量的值不许改（改值 = 已落盘的配置全部读成只读）', () => {
    expect(ASSISTANT_TIER_READ_ONLY).toBe('read-only');
    expect(ASSISTANT_TIER_READ_AND_PROPOSE).toBe('read-and-propose');
  });

  it('出厂默认 = 执行：真正落库仍需用户确认', () => {
    expect(DEFAULT_ASSISTANT_TIER).toBe(ASSISTANT_TIER_READ_AND_PROPOSE);
  });

  it('🔴 档位顺序固定为低权限到高权限', () => {
    expect(ASSISTANT_TIER_ORDER[0]).toBe(ASSISTANT_TIER_READ_ONLY);
    expect(ASSISTANT_TIER_ORDER).toEqual([
      ASSISTANT_TIER_READ_ONLY,
      ASSISTANT_TIER_READ_AND_PROPOSE,
    ]);
    expect(ASSISTANT_TIER_ORDER.length).toBe(2);
  });
});

describe('fail-closed 归一', () => {
  it('🔴 不接受"看起来像真"：布尔 / 数字 / 对象 / 下划线 / 大小写 / 缺字段 一律只读', () => {
    for (const bogus of [
      true,
      false,
      1,
      0,
      null,
      undefined,
      {},
      [],
      'read_and_propose',
      'READ-AND-PROPOSE',
      'Read-And-Propose',
      'propose',
      '',
      ' read-and-propose',
      'read-and-propose ',
    ]) {
      expect(normalizeAssistantTier(bogus), `值 ${String(bogus)} 不该被当成开写`).toBe(
        ASSISTANT_TIER_READ_ONLY,
      );
    }
  });

  it('只有逐字等于开写那一档才算开', () => {
    expect(normalizeAssistantTier(ASSISTANT_TIER_READ_AND_PROPOSE)).toBe(
      ASSISTANT_TIER_READ_AND_PROPOSE,
    );
  });
});

describe('端口装出来的仓库（下一个壳的复用面）', () => {
  let port: ReturnType<typeof fakePort>;
  beforeEach(() => {
    port = fakePort();
  });

  it('通道是空的 ⇒ 只读，而不是 undefined 漏给调用方', () => {
    expect(createAssistantTierStore(port).get()).toBe(ASSISTANT_TIER_READ_ONLY);
  });

  it('🔴 set 传坏值时**落盘的是归一后的值** —— 坏值不许写回磁盘', () => {
    const store = createAssistantTierStore(port);
    expect(store.set(true)).toBe(ASSISTANT_TIER_READ_ONLY);
    expect(port.raw()).toBe(ASSISTANT_TIER_READ_ONLY);
  });

  it('set 开写档能存回去，get 读回来还是它', () => {
    const store = createAssistantTierStore(port);
    expect(store.set(ASSISTANT_TIER_READ_AND_PROPOSE)).toBe(ASSISTANT_TIER_READ_AND_PROPOSE);
    expect(port.raw()).toBe(ASSISTANT_TIER_READ_AND_PROPOSE);
    expect(store.get()).toBe(ASSISTANT_TIER_READ_AND_PROPOSE);
  });

  it('通道被别的东西写坏 ⇒ get 仍然只读（读侧也 fail-closed）', () => {
    port = fakePort('read_and_propose');
    expect(createAssistantTierStore(port).get()).toBe(ASSISTANT_TIER_READ_ONLY);
  });

  it('clear 回到出厂档并落盘', () => {
    const store = createAssistantTierStore(port);
    store.set(ASSISTANT_TIER_READ_AND_PROPOSE);
    expect(store.clear()).toBe(ASSISTANT_TIER_READ_AND_PROPOSE);
    expect(port.raw()).toBe(ASSISTANT_TIER_READ_AND_PROPOSE);
  });
});
