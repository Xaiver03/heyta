/**
 * 移动端流式传输的纯逻辑判据
 *
 * 🔴 本文件**不碰 XHR、不发请求**：只测"累积文本 → 增量"这条最容易错的逻辑。
 * 它是移动端能流式的前提，而它的失败症状（回答内容成倍重复）在真机上
 * 看起来像"模型疯了"，很难回溯到这里 —— 所以它值得单独的判据。
 */

import { describe, expect, it } from 'vitest';

import {
  createIncrementalBuffer,
  diffAccumulated,
} from '../src/ai/streaming-fetch.js';

describe('diffAccumulated：累积文本 → 增量', () => {
  it('第一次收到内容时，增量就是全部', () => {
    expect(diffAccumulated('', '你有')).toBe('你有');
  });

  it('🔴 第二次只给新增的那一段（这条挡的是"回答内容成倍重复"）', () => {
    // 怎么让它红：改成 `return current;`，于是每次都把全文再喂一遍。
    expect(diffAccumulated('你有', '你有一条')).toBe('一条');
  });

  it('内容没变时给空串（不是 null —— 那是"正常但无新增"）', () => {
    expect(diffAccumulated('你有', '你有')).toBe('');
  });

  it('🔴 拿到的不是旧文本的超集 ⇒ 返回 null（放弃增量，不硬拼）', () => {
    // 典型来源：网关压缩/改写、或这个响应根本不是文本流。
    // 硬拼会让用户看到一段**从未存在过的回答**，比"没有逐字"危险得多。
    expect(diffAccumulated('你有一条', '完全不同的内容')).toBeNull();
  });

  it('旧文本为空但新文本非空：算增量（不是 null）', () => {
    expect(diffAccumulated('', 'x')).toBe('x');
  });

  it('新文本比旧文本短（内容被截断）⇒ null', () => {
    expect(diffAccumulated('你有一条任务', '你有')).toBeNull();
  });
});

describe('createIncrementalBuffer：分片队列状态机', () => {
  it('按顺序吐出各次增量', async () => {
    const buffer = createIncrementalBuffer();
    buffer.push('你');
    buffer.push('你有');
    buffer.push('你有一条');

    const decode = (v?: Uint8Array): string => (v === undefined ? '' : new TextDecoder().decode(v));
    /**
     * ⚠️ 三次 push 产生**三个**分片，不是一个 —— 每次 push 的都是"新增的那一段"：
     *   push('你')      → 分片 '你'   （之前是空串）
     *   push('你有')    → 分片 '有'
     *   push('你有一条') → 分片 '一条'
     * 所以下面要读三次。我最初只读两次并断言第二片是 '一条'，那是我写错了测试。
     */
    expect(decode((await buffer.next()).value)).toBe('你');
    expect(decode((await buffer.next()).value)).toBe('有');
    expect(decode((await buffer.next()).value)).toBe('一条');

    buffer.finish();
    await expect(buffer.next()).resolves.toEqual({ done: true });
  });

  it('没有数据时 next() 挂住，直到 push 唤醒（不是空转）', async () => {
    const buffer = createIncrementalBuffer();
    let resolved = false;
    const pending = buffer.next().then((r) => {
      resolved = true;
      return r;
    });

    // 给微任务一个机会：此刻不该已经 resolve。
    await Promise.resolve();
    expect(resolved).toBe(false);

    buffer.push('来了');
    const result = await pending;
    expect(new TextDecoder().decode(result.value)).toBe('来了');
  });

  it('finish() 之后 next() 立刻报 done（不会永挂）', async () => {
    const buffer = createIncrementalBuffer();
    buffer.push('abc');
    await buffer.next();
    buffer.finish();

    await expect(buffer.next()).resolves.toEqual({ done: true });
  });

  it('🔴 挂住时出错 ⇒ next() 抛，而不是永远等下去', async () => {
    // 怎么让它红：删掉 next() 里的 `if (failure !== null) throw failure;`，
    // 于是网络断了之后读流会永久挂起 —— 症状是"AI 一直在转圈"。
    const buffer = createIncrementalBuffer();
    const waiting = buffer.next();
    buffer.fail(new Error('网络请求失败'));

    await expect(waiting).rejects.toThrow('网络请求失败');
  });

  it('放弃增量后不再吐任何东西（避免吐出拼接错的内容）', async () => {
    const buffer = createIncrementalBuffer();
    buffer.push('abc');
    await buffer.next();

    // 不是超集 ⇒ 放弃
    expect(buffer.push('完全不同的内容')).toBe(false);
    expect(buffer.abandoned()).toBe(true);

    buffer.finish();
    await expect(buffer.next()).resolves.toEqual({ done: true });
  });

  it('空增量不产生分片（不喂空串给解析器）', async () => {
    const buffer = createIncrementalBuffer();
    buffer.push('abc');
    buffer.push('abc'); // 没变
    buffer.finish();

    const first = await buffer.next();
    expect(new TextDecoder().decode(first.value)).toBe('abc');
    // 第二次就该是 done，而不是又给一个空分片
    await expect(buffer.next()).resolves.toEqual({ done: true });
  });
});
