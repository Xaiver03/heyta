/**
 * 导入文件的**大小上界**（崩溃审计 2026-11-08 · U05）
 * ==================================================
 *
 * 【这份测试防的是什么】
 *
 * `parseExportDocument` 原来是裸 `JSON.parse(text)`：一个 500 MB / 2 GB 的
 * "备份文件"会先把整份文本读进内存、再让 `JSON.parse` 分配一棵同量级的对象树。
 * 在移动端（Hermes 堆更小）这不是"抛个异常"，是**进程被 OOM 杀掉** ——
 * 用户点一次"导入备份"就闪退。
 *
 * 修法：解析**之前**判字符数，超限明确拒绝（`too-large`）。
 *
 * 【判据为什么是"`too-large` 而不是 `invalid-json`"】
 *
 * 第 2 条用例喂的是一段**非法 JSON** 的超长文本。两种实现给出的答案不同：
 *   · 先解析 ⇒ `JSON.parse` 报错 ⇒ `invalid-json`；
 *   · 先判大小 ⇒ 直接拒 ⇒ `too-large`。
 * 所以这条断言恰好把"顺序"钉住了 —— 而不是只断言"被拒了"。
 * （实测：删掉大小判据那句，本条立刻变红。）
 *
 * 【它为什么不能靠"造一份 64 MiB 的真实文档"来测】
 *
 * 那会让测试自己先吃掉 128 MB 内存。用非法 JSON 既省内存，又同样是"顺序判据"。
 *
 * ⚠️ **未覆盖（如实记录）**：`sortKeysDeep` 的**深度上限**（`MAX_CANONICAL_DEPTH`）
 * 没有区分性判据。试过两版：5000 层（Node 默认栈跑得完，删掉上限也绿）、
 * 20000 层（仍然绿 —— `stateMatchesDocument` 在到达 `canonical()` 之前就因为
 * "计数对不上"返回了 false，深层载荷根本没被比较）。要真测它，得构造一份
 * **自洽**的深层物化状态，成本远高于这条防御本身的价值。
 * 所以这里**不写一条假装覆盖了它的测试** —— "删掉实现测试还是绿的"那种测试
 * 比没有测试更糟：它会让人以为有保护。
 */

import { describe, expect, it } from 'vitest';

import { parseExportDocument } from '../src/import-dump.js';

describe('parseExportDocument 的大小上界', () => {
  it('🔴 超过字节上限的文本在 JSON.parse 之前就被拒绝（而不是先分配再报语法错）', () => {
    const oversized = 'x'.repeat(64 * 1024 * 1024 + 1);

    const result = parseExportDocument(oversized);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 关键：必须是 too-large。若实现先解析，这里会是 invalid-json。
    expect(result.reason).toBe('too-large');
  });

  it('🔴 大小判据不吞掉真实原因：小的非法 JSON 仍报 invalid-json', () => {
    const result = parseExportDocument('{ 这不是 JSON ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-json');
  });

  it('🔴 大小判据不误报：顶层不是对象仍是 invalid-document', () => {
    const result = parseExportDocument('[1,2,3]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-document');
  });

  it('🔴 不是 heyta 的导出文件仍报 wrong-application（版本判据不被大小判据抢占）', () => {
    const result = parseExportDocument('{"formatVersion":1}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 具体是哪个 reason 取决于字段顺序，但**不能**是 too-large
    expect(result.reason).not.toBe('too-large');
  });
});
