/**
 * AI 面板失败态的词条（§7.10 通道 #5）
 * =====================================
 *
 * 🔴 这条通道的形状：四个面板整句渲染 `outcome.message`（`packages/app-host` /
 * `packages/ai` 拼好的中文）→ 英文界面在**失败时**露中文，而门禁看不见
 *（渲染的是变量 `{failure}`，不是字面量）。
 *
 * 修法不是"把 message 丢了"，而是分两层：主文案按**原因码**取词条
 *（`cause`，第 18 轮才从 `result.reason` 带出来），`message` 收进 `<details>`
 * 当技术详情 —— 与 `ErrorScreen` 同一分类。
 *
 * 本文件钉住的是**映射本身**：穷尽、双语、英文无汉字、zh 不自己另写一套。
 */
import { describe, expect, it } from 'vitest';

import { createProvider, type AiFailureReason } from '@heyta/ai';
import { translate } from '@heyta/i18n';

import { captureFailureCopy, causeKey, serverCodeKey } from '../src/features/ai/ai-failure-copy.js';

/** 有没有汉字。 */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

/**
 * 全部原因码。
 *
 * ⚠️ 写成 `Record<AiFailureReason, true>` 而不是数组：
 * `packages/ai` 新增一个失败原因时，**这里不补就是编译错误** ——
 * 数组写法只会静默漏测。
 */
const ALL_CAUSES: Record<AiFailureReason, true> = {
  'not-configured': true,
  'egress-not-authorized': true,
  'consent-not-granted': true,
  network: true,
  'http-error': true,
  'empty-response': true,
  'no-route': true,
  'fallback-needs-consent': true,
};

describe('路由层失败原因 → 词条', () => {
  it('每一个原因码都有中英词条，且英文里不含汉字', () => {
    for (const cause of Object.keys(ALL_CAUSES) as AiFailureReason[]) {
      const key = causeKey(cause);
      const zh = translate('zh-CN', key);
      const en = translate('en', key);
      expect(zh, `${cause} 的 zh 词条是空的`).not.toBe('');
      expect(CJK.test(zh), `${cause} 的 zh 词条里没有汉字（大概写成了英文）`).toBe(true);
      expect(CJK.test(en), `${cause} 的英文词条里有汉字：${en}`).toBe(false);
      expect(en, `${cause} 的英文词条与中文一模一样`).not.toBe(zh);
    }
  });

  it('🔴 设备级同意没给 ≠ 端点连不上 —— 那句红字不许把用户支去查网络', () => {
    // 实测换来的：闸门拒绝被归成 `network`，于是失败面写着「连不上端点。检查网络，
    // 以及端点地址是否可达。」，而真相是这台设备设为「只用本机」、一个字都没发。
    // 判据写成"必须点名那道开关 + 不许出现'检查网络'"，而不是只断言"有文案"。
    const key = causeKey('consent-not-granted');
    const zh = translate('zh-CN', key);
    expect(key).toBe('web.ai.failure.cause.consentNotGranted');
    expect(zh).not.toBe(translate('zh-CN', causeKey('network')));
    expect(zh).toContain('同意并联网');
    expect(zh).not.toMatch(/检查网络|端点地址是否可达/);
  });

  it('🔴 没有原因码时退回通用那句，而不是空白或崩溃', () => {
    // 模块被加载两份时 `cause` 会是 undefined —— 这条路径必须存在。
    const key = causeKey(undefined);
    expect(key).toBe('web.ai.failure.aiUnavailable');
    expect(translate('zh-CN', key)).not.toBe('');
  });

  it('🔴 zh 第一行与 packages/ai 的句子逐字一致 —— 别在这里另写一套', () => {
    // 同一句用户可见文案有两个来源就一定会漂移，而漂移的文案比没有文案更危险
    //（`describeRoutedFailure` 的注释里记着上一次漂移的代价）。
    // 所以这里直接问 `packages/ai` 要那句话，逐字比。
    // 走公开入口，而不是内部工厂 —— 顺便证明"AI 关着"这条真实路径。
    return createProvider({ mode: 'off' })
      .invoke({} as never, {} as never)
      .then((outcome) => {
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        const firstLine = outcome.message.split('\n')[0] ?? '';
        expect(translate('zh-CN', causeKey(outcome.reason))).toBe(firstLine);
      });
  });
});

/**
 * 🔴 服务端稳定码：`402 SUBSCRIPTION_REQUIRED` 与 `409 AI_QUOTA_EXCEEDED`
 * 在失败词表里**都落进 `http-error`**，而修复动作相反（去买 / 等下一周期）。
 *
 * 这一组钉的就是"**它们必须说出不同的话**"——只按 `cause` 取词条，
 * 两件事会被印成同一句"端点返回了错误"，而用户据此做的事会是错的。
 */
describe('托管档被拒：两个稳定码要说两句不同的话', () => {
  it('两个码各自登记，且**指向不同的词条**', () => {
    const subscription = serverCodeKey('SUBSCRIPTION_REQUIRED');
    const quota = serverCodeKey('AI_QUOTA_EXCEEDED');

    expect(subscription).toBeDefined();
    expect(quota).toBeDefined();
    expect(subscription).not.toBe(quota);
    // 而且两句都真的能在词条表里翻出来（不是登记了一个不存在的 key）
    expect(translate('zh-CN', subscription!)).not.toBe('');
    expect(translate('zh-CN', quota!)).not.toBe('');
    expect(translate('zh-CN', subscription!)).not.toBe(translate('zh-CN', quota!));
  });

  it('⚠️ 没登记的码（含 `undefined`）返回 `undefined` ⇒ 落回按 `cause` 取，不许硬配一句', () => {
    expect(serverCodeKey(undefined)).toBeUndefined();
    expect(serverCodeKey('AI_UPSTREAM_NOT_DOMESTIC')).toBeUndefined();
    expect(serverCodeKey('')).toBeUndefined();
  });

  it('🔴 同一次 `http-error`：带不同码时，`captureFailureCopy` 给出的主文案不同', () => {
    const ctx = (serverCode: string) => ({
      cause: 'http-error' as const,
      endpointUrl: 'https://heyta.waytofuture.cn',
      serverCode,
    });

    const a = captureFailureCopy('ai-unavailable', 'raw', ctx('SUBSCRIPTION_REQUIRED'));
    const b = captureFailureCopy('ai-unavailable', 'raw', ctx('AI_QUOTA_EXCEEDED'));
    const plain = captureFailureCopy('ai-unavailable', 'raw', {
      cause: 'http-error',
      endpointUrl: undefined,
      serverCode: undefined,
    });

    expect(a.key).not.toBe(b.key);
    // 而且**都不是**没有码时那一句泛泛的
    expect(a.key).not.toBe(plain.key);
    expect(b.key).not.toBe(plain.key);
  });
});
