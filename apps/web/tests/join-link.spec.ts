/**
 * 判据：分享链接的生产端与消费端是**同一份 URL 约定**（W6 链接落点）
 * ==========================================================================
 *
 * 生产端：`@heyta/ui#buildShareJoinLink` —— `{应用地址}?shareToken=…`。
 * 消费端：本目录 `join-link.ts` 的 `extractShareToken` / `searchWithoutShareToken`
 * （`ProjectsPanel` 的 mount effect 调它们）。
 *
 * 两端各在各的包里测试都会漏同一件事：**约定本身漂了没人知道** ——
 * 生产端改成 `#token=`、消费端还读 `shareToken`，两边的单测各自全绿，
 * 死的症状是"链接点了没反应"。所以这里必须做 **round-trip**：
 * 生产端产出的链接，消费端要能原样取回 token。
 *
 * 末尾还有一条**源码级棘轮**：`ProjectsPanel` 不许自带第二套解析。
 * 提取物的收尾是"旧的那份删掉"，不是"写一个更好的新版本"
 * （AGENTS §3.5「ids.ts 教训」：抽出来了、旧的那份还活着，等于没抽）。
 *
 * 变异臂（2026-10-10 实测）：把 `ProjectsPanel` 的 effect 改回内联
 * `new URLSearchParams` 解析（删掉 import）⇒ 「源码级棘轮」那条具名转红；
 * 还原后本文件全绿。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildShareJoinLink } from '@heyta/ui';

import { extractShareToken, searchWithoutShareToken } from '../src/features/share/join-link';

describe('join-link · 取 token（W6 链接落点）', () => {
  it('取到 shareToken；位置不影响（独占 / 在前 / 在后）', () => {
    expect(extractShareToken('?shareToken=abc123')).toBe('abc123');
    expect(extractShareToken('?shareToken=abc&foo=1')).toBe('abc');
    expect(extractShareToken('?foo=1&shareToken=abc')).toBe('abc');
  });

  it('缺失 / 空串都算没有（undefined）—— 空串不是一张可用的门票', () => {
    expect(extractShareToken('?foo=1')).toBeUndefined();
    expect(extractShareToken('')).toBeUndefined();
    expect(extractShareToken('?shareToken=')).toBeUndefined();
  });
});

describe('join-link · 摘参数', () => {
  it('摘掉 shareToken 后剩下的查询串（不带前导 ?）', () => {
    expect(searchWithoutShareToken('?shareToken=abc')).toBe('');
    expect(searchWithoutShareToken('?shareToken=abc&foo=1&bar=2')).toBe('foo=1&bar=2');
    expect(searchWithoutShareToken('?foo=1&shareToken=abc')).toBe('foo=1');
  });

  it('没有 shareToken 时原样返回 —— 消费端对"没有门票"不该动地址栏', () => {
    expect(searchWithoutShareToken('?foo=1&bar=2')).toBe('foo=1&bar=2');
    expect(searchWithoutShareToken('')).toBe('');
  });
});

describe('join-link · 生产端 ↔ 消费端同一份约定（round-trip）', () => {
  it('buildShareJoinLink 产出的链接，extractShareToken 能取回同一个 token', () => {
    // 含空格 / + / = / 中文：encodeURIComponent 编码后 URLSearchParams 解码，
    // 两端各自"做对"还不够 —— 判据是**往返相等**。
    const token = 'tok en+特殊=值/9';
    const link = buildShareJoinLink('https://app.example.com/app/', token);
    expect(link.startsWith('https://app.example.com/app/?shareToken=')).toBe(true);
    expect(extractShareToken(link.slice(link.indexOf('?')))).toBe(token);
  });

  it('链接落点是**应用地址**，不是同步服务器 —— 落服务器就是 404（W6 修的就是这个）', () => {
    const link = buildShareJoinLink('https://app.example.com/app/', 't');
    // 应用地址原样出现；shareToken 参数化（token 不裸拼）。
    expect(link).toBe('https://app.example.com/app/?shareToken=t');
  });
});

describe('join-link · 消费端唯一性（抽了 ≠ 用了）', () => {
  const panelSource = readFileSync(
    join(process.cwd(), 'src/features/projects/ProjectsPanel.tsx'),
    'utf8',
  );

  it('ProjectsPanel 的 URL 消费走 join-link 纯函数', () => {
    expect(panelSource).toContain("from '../share/join-link.js'");
  });

  it('ProjectsPanel 不许自带第二套 shareToken 解析（旧的那份必须删掉）', () => {
    expect(panelSource).not.toMatch(/params\.get\('shareToken'\)/);
    expect(panelSource).not.toMatch(/new URLSearchParams\(window\.location\.search\)/);
  });
});
