#!/usr/bin/env node
/**
 * AI 自备端点 · 真实供给链路验收
 * ================================
 *
 * 这个脚本回答一个**只有连真端点才能回答**的问题：
 *
 *   「`packages/ai` 的出境闸门与 provider 端口，在**真的模型**上到底通不通？」
 *
 * 为什么必须有它：`packages/ai` 的 47 条单元测试全部用 `fetchImpl` 打桩，
 * 它们证明的是**闸门自洽**，不是**真能调通**。
 * 对照本仓库 §7 #27/#28/#31 的老毛病：**"测试全绿"推不出"真能跑"**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 它**不是**门禁的一部分，也**不该**进 `pnpm check`
 *
 * 因为它需要一个真实的 API key。把它挂进门禁会造成两种坏结果之一：
 *   ① CI 上没有 key → 要么红（假失败），要么静默跳过（等于没测）；
 *   ② 有人为了让它绿而把 key 塞进仓库。
 * 所以它是**按需运行的手工验收**，没有配置时**明确地说"跳过"并退出 0**。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 用法
 *
 * ```bash
 * # 配置来源优先级：环境变量 > 默认路径
 * HEYTA_AI_LIVE_CONFIG=/path/to/provider.json pnpm verify:ai-live
 * ```
 *
 * 配置文件形状（**绝不入库**，默认路径在仓库外的 /tmp）：
 * ```json
 * { "endpoint": "https://.../v1", "apiKey": "sk-...", "model": "..." }
 * ```
 *
 * ## 它断言什么
 *
 * 1. **目的地推导正确** —— 远端端点必须被判成 `user-endpoint`（需要授权），
 *    而回环端点必须被判成 `none`（不需要授权）。这两条是镜像关系，缺一不可。
 * 2. **闸门在真实调用之前** —— 未授权时**必须**返回 `egress-not-authorized`，
 *    且**一次网络请求都不发**（用包装过的 fetch 计数，不靠"结果看起来对"）。
 * 3. **授权后真的能拿到内容** —— 真实 HTTP、真实模型、非空正文。
 * 4. **失败的形状是对的** —— 用一个不存在的模型名触发真实 4xx，
 *    确认被分类成 `http-error` **且带回状态码**，而不是被吞成 `network`。
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

import { createProvider, classifyDestination } from '../packages/ai/dist/index.js';

const DEFAULT_CONFIG_PATH = '/tmp/heyta-ai-live/provider.json';

/** 极简断言：失败即抛，由 main 统一报。 */
function check(label, condition, detail) {
  if (!condition) {
    throw new Error(`断言失败：${label}${detail === undefined ? '' : ` —— ${detail}`}`);
  }
  console.log(`  ✅ ${label}${detail === undefined ? '' : `  ${detail}`}`);
}

function loadConfig() {
  const path = process.env['HEYTA_AI_LIVE_CONFIG'] ?? DEFAULT_CONFIG_PATH;
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`配置文件不是合法 JSON：${path} —— ${error.message}`);
  }
  for (const field of ['endpoint', 'apiKey', 'model']) {
    if (typeof parsed[field] !== 'string' || parsed[field] === '') {
      throw new Error(`配置文件缺少字段 ${field}：${path}`);
    }
  }
  return { path, ...parsed };
}

/**
 * 包装 fetch 以**计数**。
 *
 * 🔴 这是本脚本的核心手法：不靠"结果看起来对"来证明"没发请求"，
 * 而是**数出来**。一个返回 `egress-not-authorized` 却在后台发了请求的实现，
 * 单看返回值是看不出来的。
 */
function countingFetch() {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    return globalThis.fetch(url, init);
  };
  return { impl, calls };
}

async function main() {
  const config = loadConfig();

  if (config === undefined) {
    console.log('⚠️  未找到真实端点配置，跳过（这不是失败）。');
    console.log(`   期望路径：${process.env['HEYTA_AI_LIVE_CONFIG'] ?? DEFAULT_CONFIG_PATH}`);
    console.log('   要跑真实链路：HEYTA_AI_LIVE_CONFIG=<path> pnpm verify:ai-live');
    return 0;
  }

  console.log('AI 自备端点 · 真实供给链路验收');
  console.log(`配置：${config.path}`);
  console.log(`端点：${config.endpoint}`);
  console.log(`模型：${config.model}`);
  console.log(`凭据：${config.apiKey.length} 字符（不打印内容）`);
  console.log('');

  // ── 1. 目的地推导（远端）：必须要求授权 ────────────────────────────────
  console.log('1) 远端端点的目的地推导');
  const remote = classifyDestination({ mode: 'own', endpoint: config.endpoint });
  check('远端端点判成 user-endpoint', remote === 'user-endpoint', `实际 ${remote}`);

  // ── 2. 目的地推导（回环）：必须不要求授权 ──────────────────────────────
  // 这是镜像断言。只测一边会漏掉"把一切都当成远端"这种过度保守的实现。
  console.log('2) 回环端点的目的地推导（镜像断言）');
  for (const loop of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:8080/v1']) {
    const d = classifyDestination({ mode: 'own', endpoint: loop });
    check(`${loop} 判成 none`, d === 'none', `实际 ${d}`);
  }
  const lan = classifyDestination({ mode: 'own', endpoint: 'http://my-nas.lan:11434/v1' });
  check('局域网主机名仍判成 user-endpoint（mDNS 可指向任意主机）', lan === 'user-endpoint');

  // ── 3. 未授权时：必须拒绝，且一次请求都不发 ────────────────────────────
  console.log('3) 出境闸门在真实调用之前');
  {
    const { impl, calls } = countingFetch();
    const provider = createProvider(
      { mode: 'own', endpoint: config.endpoint, apiKey: config.apiKey, model: config.model },
      { fetchImpl: impl },
    );
    const result = await provider.invoke(
      { feature: 'capture', system: 's', user: 'u', fields: ['title'] },
      [], // 无授权
    );
    check('未授权被拒', result.ok === false && result.reason === 'egress-not-authorized',
      result.ok ? '竟然成功了' : `reason=${result.reason}`);
    check('未授权时网络请求数 = 0', calls.length === 0, `实际 ${calls.length} 次`);
    check('拒绝信息带上了披露字段', !result.ok && result.message.includes('title'));
  }

  // ── 4. 有授权时：真实调用，必须拿到非空内容 ────────────────────────────
  console.log('4) 授权后的真实调用');
  const consents = [
    { feature: 'capture', destination: 'user-endpoint', grantedAt: Date.now() },
  ];
  let suggestionText = '';
  {
    const { impl, calls } = countingFetch();
    const provider = createProvider(
      { mode: 'own', endpoint: config.endpoint, apiKey: config.apiKey, model: config.model },
      { fetchImpl: impl, timeoutMs: 90_000 },
    );
    const started = Date.now();
    const result = await provider.invoke(
      {
        feature: 'capture',
        system: '你是任务解析器。只输出 JSON，不要解释。',
        user: '明天下午三点开周会，高优先级',
        fields: ['title'],
      },
      consents,
    );
    const elapsed = Date.now() - started;

    check('真实调用成功', result.ok === true, result.ok ? '' : `reason=${result.reason} msg=${result.message}`);
    check('恰好发出 1 次请求', calls.length === 1, `实际 ${calls.length} 次`);
    check('打到了 /chat/completions', String(calls[0]?.url).endsWith('/chat/completions'), String(calls[0]?.url));

    if (result.ok) {
      suggestionText = result.suggestion.text;
      check('正文非空', suggestionText.trim() !== '', `${suggestionText.length} 字符`);
      check('目的地如实标注为 user-endpoint', result.suggestion.destination === 'user-endpoint');
      check('功能标签正确', result.suggestion.feature === 'capture');
      console.log(`     用时 ${elapsed} ms`);
      console.log(`     正文前 160 字：${suggestionText.slice(0, 160).replace(/\s+/g, ' ')}`);
    }

    // ── 5. 请求体里不许有披露之外的东西 ──────────────────────────────────
    console.log('5) 请求体的数据面');
    const body = JSON.parse(String(calls[0]?.body));
    check('请求体只有 model + messages', JSON.stringify(Object.keys(body).sort()) === '["messages","model"]',
      Object.keys(body).join(','));
    check('模型名就是配置的那个', body.model === config.model);
  }

  // ── 6. 真实失败：不存在的模型必须被分类成 http-error 且带状态码 ────────
  console.log('6) 真实失败的分类');
  {
    const provider = createProvider(
      { mode: 'own', endpoint: config.endpoint, apiKey: config.apiKey, model: '__heyta_no_such_model__' },
      { fetchImpl: countingFetch().impl, timeoutMs: 60_000 },
    );
    const result = await provider.invoke(
      { feature: 'capture', system: 's', user: 'u', fields: ['title'] },
      consents,
    );
    check('不存在模型时失败', result.ok === false, result.ok ? '竟然成功了' : '');
    if (!result.ok) {
      check('分类为 http-error', result.reason === 'http-error', `实际 ${result.reason}`);
      check('带回了 HTTP 状态码', typeof result.status === 'number', `status=${result.status}`);
    }
  }

  console.log('');
  console.log('✅ 真实供给链路全部通过 —— 闸门、目的地推导、请求体数据面、失败分类都成立。');
  return 0;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (error) => {
    console.error('');
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
