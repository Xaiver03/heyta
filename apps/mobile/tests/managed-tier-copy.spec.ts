/**
 * 托管档的用量读数 → 词条（`copy.ts` 的 `managedUsageCopy`）。
 *
 * 🔴 这一组钉的是**三种状态不许被混成一种**：
 * `ok + entitled` / `ok + !entitled` / `unavailable`。
 * 把第二、第三种渲染成「已用 0 / 300」就是**说反话** ——
 * 前者是"没有这一期"（该去买），后者是"读不到"（该稍后再看），
 * 而它们的修复动作与"这一期还没开始用"完全不同。
 *
 * ⚠️ 为什么判据落在**纯函数**上而不是组件上：移动端 `tests/` 下**零 `.tsx`**、
 * 也没有 RN 渲染设施（`react-test-renderer` / `@testing-library/react-native`
 * 都不在依赖里）。组件测不了，这条判断就得自己能被断言 —— 否则它只是一段
 * 没人验证过的三元表达式。web 侧的同名判断（`serverCodeKey`）也是这么抽的。
 */
import { describe, expect, it } from 'vitest';

import { translate } from '@heyta/i18n';

import { managedUsageCopy } from '../src/ai/copy';

describe('托管档用量读数 → 词条', () => {
  it('🔴 有权益 ⇒ 报数，并把 `used` / `limit` 插进去（法务 §5.3 承诺的那句）', () => {
    const copy = managedUsageCopy({
      kind: 'ok',
      used: 7,
      limit: 300,
      periodAnchor: 1762592000000,
      entitled: true,
    });

    expect(copy?.key).toBe('web.ai.settings.usage.used');
    expect(copy?.vars).toEqual({ used: 7, limit: 300 });
    const rendered = translate('zh-CN', copy!.key, copy!.vars);
    expect(rendered).toContain('7');
    expect(rendered).toContain('300');
  });

  it('🔴 没权益 ⇒ 说"没有这一期"，**不是**「已用 0 / 300」', () => {
    const copy = managedUsageCopy({
      kind: 'ok',
      used: 0,
      limit: 300,
      periodAnchor: null,
      entitled: false,
    });

    expect(copy?.key).toBe('web.ai.settings.usage.notEntitled');
    // 关键：它**不许**是那个报数的词条。`used` 在这里是 0，报成 0/300 就是在说反话。
    expect(copy?.key).not.toBe('web.ai.settings.usage.used');
    expect(copy?.vars).toBeUndefined();
  });

  it('🔴 读不到 ⇒ 如实说"读不到"，**不许**拿 0 顶上', () => {
    const copy = managedUsageCopy({ kind: 'unavailable', cause: 'http' });

    expect(copy?.key).toBe('web.ai.settings.usage.unavailable');
    expect(copy?.key).not.toBe('web.ai.settings.usage.used');
    expect(copy?.key).not.toBe('web.ai.settings.usage.notEntitled');
  });

  it('⚠️ `unconfigured` 与"还没拉"都**不渲染**（那句由"先去同步填地址"承担，不重复）', () => {
    expect(managedUsageCopy({ kind: 'unconfigured' })).toBeUndefined();
    expect(managedUsageCopy(undefined)).toBeUndefined();
  });

  it('三分支各自指向**不同的**词条（合成一句就等于指不出该做什么）', () => {
    const keys = [
      managedUsageCopy({ kind: 'ok', used: 1, limit: 300, periodAnchor: 1, entitled: true })!.key,
      managedUsageCopy({ kind: 'ok', used: 0, limit: 300, periodAnchor: null, entitled: false })!.key,
      managedUsageCopy({ kind: 'unavailable', cause: 'network' })!.key,
    ];
    expect(new Set(keys).size).toBe(3);
    // 而且三句都真的能在词条表里翻出来（不是登记了不存在的 key）
    for (const key of keys) expect(translate('zh-CN', key)).not.toBe('');
  });
});
