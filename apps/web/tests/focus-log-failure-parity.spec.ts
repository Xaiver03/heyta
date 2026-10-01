/**
 * 专注写入失败的原因码 → 词条 key → 两份词条表，必须一环不缺
 * ==========================================================
 *
 * ## 这条断言为什么存在
 *
 * `apps/web/tests/ai-failure-parity.spec.tsx` 的文件头记着同一个形状的事故：
 * 四个入口改好了、**第 5 个没人管，而没有任何测试会红**。这里是第 5 个入口的
 * 风险面 ——「包出码、壳拼句」这条链有**四段**，每段各在一个包里：
 *
 *   1. `packages/app-host` 的 `FOCUS_LOG_FAILURE_CODES`（码的封闭集合）
 *   2. `packages/ui` 的 `focusLogFailureMessageKey`（码 → 词条 key）
 *   3. `packages/i18n` 的 `zh-CN.ts` / `en.ts`（key → 中英两句）
 *   4. 两个壳（`FocusTimer` / `FocusScreen`）真的用它选 key
 *
 * 第 2 段与第 1 段**不可能在编译期钉住**：`packages/ui` 不依赖 `@heyta/app-host`
 * （它只依赖 `@heyta/i18n` 的类型都不想要 —— 见那个文件的头），所以那张映射表的
 * 键类型只能写 `string`。`apps/web/src/features/settings/WidgetPushPanel.tsx` 的
 * `Record<PushFailureReason, MessageKey>` 能做穷尽检查，是因为推送的原因码
 * **就定义在 web 壳里**。这里做不到，于是只能靠运行时把四段串起来。
 *
 * ## 为什么它在 `apps/web` 而不是 `packages/ui`
 *
 * 只有 `apps/web` 同时依赖 app-host、ui、i18n 三个包 —— 它是唯一能看见整条链的测试环境。
 *
 * ## 断的是"每条形态"，不是"渲染结果"
 *
 * `translateIn` 对**未知 key 抛异常**、对**多余的 vars 直接忽略**，所以
 * `t(codeKey, { reason })` 在两句里都能跑通；正因如此，光渲染不会暴露漏翻。
 * 下面这几条把"漏了一段"各自钉死：
 *
 *   - 漏了第 2 段 → `focusLogFailureMessageKey(code)` 回 `undefined` → 界面静默退化成
 *     兜底句（把 `unknown-kind: nap` 这种内部诊断串直接给用户看）。
 *   - 漏了第 3 段中文 → `translate` 抛异常，测试红。
 *   - 中文里混进英文-only、英文里混进汉字 → 那两条专门的断言红。
 *   - 代码-specific 句子里塞了 `{reason}` → 「句子必须自足」那条红。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FOCUS_LOG_FAILURE_CODES } from '@heyta/app-host';
import { translate } from '@heyta/i18n';
import { focusLogFailureMessageKey } from '@heyta/ui';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_FOCUS_SOURCE = readFileSync(join(HERE, '../src/features/focus/FocusTimer.tsx'), 'utf8');
const MOBILE_FOCUS_SOURCE = readFileSync(
  resolve(HERE, '../../mobile/src/screens/FocusScreen.tsx'),
  'utf8',
);

const zh = (key: Parameters<typeof translate>[1]): string => translate('zh-CN', key);
const en = (key: Parameters<typeof translate>[1]): string => translate('en', key);

describe('专注失败原因码 → 词条 → 中英两句，一环不缺', () => {
  it('每个原因码都有对应的词条 key（漏一段就退化成把诊断串甩给用户）', () => {
    for (const code of FOCUS_LOG_FAILURE_CODES) {
      expect(focusLogFailureMessageKey(code), `原因码 ${code} 没有映射`).toBeDefined();
    }
  });

  it('每个 key 在两份表里都有非空句子', () => {
    for (const code of FOCUS_LOG_FAILURE_CODES) {
      const key = focusLogFailureMessageKey(code)!;
      expect(zh(key).trim(), `中文缺 ${key}`).not.toBe('');
      expect(en(key).trim(), `英文缺 ${key}`).not.toBe('');
    }
  });

  it('🔴 中文含汉字、英文一个汉字都不许有', () => {
    for (const code of FOCUS_LOG_FAILURE_CODES) {
      const key = focusLogFailureMessageKey(code)!;
      expect(zh(key), `这句没有中文：${zh(key)}`).toMatch(/[\u3400-\u9fff]/u);
      expect(en(key), `这句会露出中文：${en(key)}`).not.toMatch(/[\u3400-\u9fff]/u);
    }
  });

  it('🔴 按码选出的句子必须自足 —— 不许带占位符', () => {
    // 带 `{reason}` 就意味着这句要靠**包里的原文**补全，而那是诊断串
    // （`unknown-kind: nap`）。界面上出现它，等于把内部实现给用户看。
    for (const code of FOCUS_LOG_FAILURE_CODES) {
      const key = focusLogFailureMessageKey(code)!;
      expect(zh(key), `${key} 的中文句还在等参数`).not.toContain('{');
      expect(en(key), `${key} 的英文句还在等参数`).not.toContain('{');
    }
  });

  it('认不出来的异常仍然走兜底句，而兜底句必须留一个参数位', () => {
    expect(focusLogFailureMessageKey(undefined)).toBeUndefined();
    for (const key of ['web.focus.error.saveFailed', 'mobile.focus.error.saveFailed'] as const) {
      expect(zh(key), `${key} 兜底句没有 {reason}，外来异常就没线索了`).toContain('{reason}');
      expect(en(key), `${key} 兜底句没有 {reason}`).toContain('{reason}');
      expect(en(key)).not.toMatch(/[\u3400-\u9fff]/u);
    }
  });

  it('两个壳都真的用 `focusLogFailureMessageKey` 选句子（第 3 个壳不许另拼一句）', () => {
    expect(WEB_FOCUS_SOURCE).toMatch(/focusLogFailureMessageKey\(focus\.error\?\.code\)/u);
    expect(MOBILE_FOCUS_SOURCE).toMatch(/focusLogFailureMessageKey\(timer\.error\?\.code\)/u);
  });
});
