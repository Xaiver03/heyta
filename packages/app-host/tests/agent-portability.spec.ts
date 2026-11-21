/**
 * Agent Harness「四端可移植性」门禁。
 *
 * 目的：把"原生引擎能在手机(Hermes)/平板/Web/桌面跑"从**断言**变成**可转红的机械判据**。
 *
 * 判据：本地 Agent 管道（循环 / 云端工具 / 路由模型 / 整机函数）的**源码**里
 *   · 不得出现 Node 内置依赖（`node:*` / `require(` / `Buffer` / `process.` / `__dirname`）；
 *   · 云端工具传输不得依赖 `response.body.getReader()` / `ReadableStream`
 *     （RN 的 fetch 没有 `body` 流；必须用 `response.json()` 这种 RN 支持的形状）。
 *
 * 违反任一 → 红。这样"以后有人在引擎里顺手 import 一个 node:fs"会被当场拦住，
 * 而不是等到"手机上跑不了"才发现。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const FILES = [
  '../src/agent-harness.ts',
  '../src/ai-cloud-tools.ts',
  '../src/ai-routed-model.ts',
  '../src/ai-cloud-assistant.ts',
  '../src/ai-local-tools.ts',
] as const;

function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('Agent Harness 四端可移植性门禁', () => {
  it('引擎/工具/路由源码不含 Node 内置依赖（Hermes/浏览器可跑）', () => {
    const forbidden: RegExp[] = [
      /from\s+['"]node:/,
      /from\s+['"](fs|path|os|child_process|crypto|http|https|net|tls|stream|util|worker_threads|readline|zlib)(['"]|\/)/,
      /\brequire\(/,
      /\bprocess\./,
      /\bBuffer\b/,
      /\b__dirname\b/,
    ];
    for (const rel of FILES) {
      const src = source(rel);
      for (const re of forbidden) {
        expect(re.test(src), `${rel} 命中禁止项 ${re}（会破坏 Hermes/浏览器可移植性）`).toBe(false);
      }
    }
  });

  it('云端工具传输不依赖 response.body.getReader()/ReadableStream（RN fetch 无 body 流）', () => {
    const src = source('../src/ai-cloud-tools.ts');
    expect(src.includes('getReader')).toBe(false);
    expect(src.includes('ReadableStream')).toBe(false);
    // 必须用 RN 支持的 response.json()
    expect(src.includes('.json()')).toBe(true);
  });

  it('循环不自己发网络请求（callModel/transport 全部注入）', () => {
    const src = source('../src/agent-harness.ts');
    expect(/\bfetch\(/.test(src), 'runCloudAgentTurn 不应直接 fetch').toBe(false);
  });
});
