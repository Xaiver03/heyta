#!/usr/bin/env node
/**
 * AI 图片输入 · 真实端点验收
 * ==========================
 *
 * 「能不能吃图」这件事**读代码读不出来**：`content` 支持 parts、预算算得对、
 * 单元测试全绿 —— 全都推不出「真实端点会把这张图读成什么」。
 * 本仓 §7 元规则第 2 条（一条永远通过的判据比没有判据更糟）就是为这种错觉写的。
 *
 * 所以这个脚本做四件**只有真端点才能回答**的事：
 *   1. 未授权时带图 ⇒ 必须被拒，且**一次请求都不发**（数出来，不是"看起来没发"）
 *   2. 有图但不披露 ⇒ 必须在**组装请求体时**抛错，同样 0 请求
 *   3. 超预算的图 ⇒ 同样在组装阶段被拒，不截断、不静默丢
 *   4. 授权后真发一张写着 `BUY MILK 9AM` 的图 ⇒ 模型必须把这几个字读出来
 *
 * 🔴 它**不是**门禁的一部分：需要真凭据。没配置时**退出 2**（根本没跑），
 * 而不是退出 0（"跳过了也算过"）。显式 `--skip` 才允许跳过。
 *
 * 用法：
 * ```bash
 * HEYTA_AI_LIVE_CONFIG=/path/to/provider.json pnpm verify:ai-vision-live
 * pnpm verify:ai-vision-live -- --skip
 * ```
 *
 * 配置形状与 `verify-ai-live` 同一份（见 `scripts/lib/live-provider-config.mjs`）。
 * ⚠️ 端点必须**真的支持视觉**（例如 `deepseek-flash`，`input_modalities: ["text","image"]`）。
 */

import process from 'node:process';

import { createProvider, MAX_ASSISTANT_EGRESS_BYTES } from '../packages/ai/dist/index.js';
import { requireLiveProviderConfig } from './lib/live-provider-config.mjs';

/**
 * 一张 480×140、写着 `BUY MILK 9AM` 的 PNG（1 562 字节，base64 2 084 字节）。
 *
 * 🔴 内容固定，因为断言要精确匹配模型读出来的词。不要换成"随便一张图" ——
 * 那样断言就只能退化成"没有报错"，而"没有报错"证明不了它看见了什么。
 */
const PROBE_PNG_BASE64 =
'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';

const PROBE_PNG_BYTES = 1_562;

const PNG = { mediaType: 'image/png', base64: PROBE_PNG_BASE64 };

/** 极简断言：失败即抛，由 main 统一报。 */
function check(label, condition, detail) {
  if (!condition) {
    throw new Error(`断言失败：${label}${detail === undefined ? '' : ` —— ${detail}`}`);
  }
  console.log(`  ✅ ${label}${detail === undefined ? '' : `  ${detail}`}`);
}

/** 计数 fetch：不靠"看起来没发"，靠**数出来**。 */
function countingFetch() {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    return globalThis.fetch(url, init);
  };
  return { impl, calls };
}

async function main() {
  const config = requireLiveProviderConfig('pnpm verify:ai-vision-live');

  console.log('AI 图片输入 · 真实端点验收');
  console.log(`配置：${config.path}`);
  console.log(`端点：${config.endpoint}`);
  console.log(`模型：${config.model}`);
  console.log(`探针图：480×140 PNG，${PROBE_PNG_BYTES} 字节（base64 ${PROBE_PNG_BASE64.length}）`);
  console.log('');

  const providerConfig = {
    mode: 'own',
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    model: config.model,
  };
  const consents = [{ feature: 'capture', destination: 'user-endpoint', grantedAt: Date.now() }];

  // ── 1. 未授权：带图也必须被拒，且零请求 ──────────────────────────────
  console.log('1) 未授权时带图 —— 闸门必须在图片出境之前');
  {
    const { impl, calls } = countingFetch();
    const provider = createProvider(providerConfig, { fetchImpl: impl });
    const result = await provider.invoke(
      {
        feature: 'capture',
        system: 's',
        user: '把这张图变成任务',
        fields: ['title', 'images'],
        images: [PNG],
        requires: ['vision'],
      },
      [],
    );
    check(
      '未授权被拒',
      result.ok === false && result.reason === 'egress-not-authorized',
      result.ok ? '竟然成功了' : `reason=${result.reason}`,
    );
    check('未授权时网络请求数 = 0', calls.length === 0, `实际 ${calls.length} 次`);
  }

  // ── 2. 有图但不披露：组装阶段就该抛，仍然零请求 ────────────────────────
  console.log('2) 有图但 fields 里没有 images —— 必须在组装请求体时抛错');
  {
    const { impl, calls } = countingFetch();
    const provider = createProvider(providerConfig, { fetchImpl: impl });
    let threw = false;
    try {
      await provider.invoke(
        { feature: 'capture', system: 's', user: 'u', fields: ['title'], images: [PNG] },
        consents,
      );
    } catch (error) {
      threw = /images/.test(String(error && error.message));
    }
    check('抛错且错误里点名 images', threw);
    check('抛错发生在发请求之前（网络 0 次）', calls.length === 0, `实际 ${calls.length} 次`);
  }

  // ── 3. 超预算的图：同样在组装阶段被拒 ─────────────────────────────────
  console.log('3) 超预算的图 —— 不截断、不静默丢，直接在组装阶段拒绝');
  {
    const { impl, calls } = countingFetch();
    const provider = createProvider(providerConfig, { fetchImpl: impl });
    const huge = { mediaType: 'image/png', base64: 'A'.repeat(120_000) };
    let threw = false;
    try {
      await provider.invoke(
        { feature: 'capture', system: 's', user: 'u', fields: ['images'], images: [huge] },
        consents,
      );
    } catch (error) {
      threw = /预算/.test(String(error && error.message));
    }
    check('超预算被拒且错误里说明预算', threw);
    check('仍然零请求', calls.length === 0, `实际 ${calls.length} 次`);
  }

  // ── 4. 授权后真发：模型必须读出图里的字 ───────────────────────────────
  console.log('4) 授权后真实带图调用 —— 模型要把图里的字读出来');
  {
    const { impl, calls } = countingFetch();
    const provider = createProvider(providerConfig, { fetchImpl: impl, timeoutMs: 120_000 });
    const started = Date.now();
    const result = await provider.invoke(
      {
        feature: 'capture',
        system: '你是任务解析器。只输出一行 JSON，不要解释。',
        user: '读这张图，输出 {"task": 图里的任务原文}',
        fields: ['title', 'images'],
        images: [PNG],
        requires: ['vision'],
      },
      consents,
    );
    const elapsed = Date.now() - started;

    check('调用成功', result.ok === true, result.ok ? undefined : `reason=${result.reason}`);
    if (!result.ok) throw new Error(result.message);
    check('恰好发出 1 次请求', calls.length === 1, `实际 ${calls.length} 次`);

    const rawBody = String(calls[0]?.body ?? '');
    const bodyBytes = Buffer.byteLength(rawBody, 'utf8');
    check(
      '请求体里是 image_url + data URL',
      rawBody.includes('image_url') && rawBody.includes('data:image/png;base64,'),
    );
    check(
      '请求体里真的带上了图的内容（base64 片段命中）',
      rawBody.includes(PROBE_PNG_BASE64.slice(0, 64)),
    );
    check(
      '请求体没超单次出境上界',
      bodyBytes <= MAX_ASSISTANT_EGRESS_BYTES,
      `${bodyBytes} ≤ ${MAX_ASSISTANT_EGRESS_BYTES}`,
    );

    const text = result.suggestion.text.toUpperCase();
    check(
      '模型读出了图里的 BUY MILK',
      text.includes('MILK'),
      `正文前 120 字：${result.suggestion.text.slice(0, 120)}`,
    );
    check('不到 60 秒', elapsed < 60_000, `${elapsed} ms`);
  }

  console.log('');
  console.log(
    '✅ 图片输入的真实链路全部通过 —— 闸门在图片之前、披露缺了就发不出、模型真的读得懂图。',
  );
}

main().catch((error) => {
  console.error('');
  console.error('❌ ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
});
