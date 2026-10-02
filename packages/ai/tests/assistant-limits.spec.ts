/**
 * 助手三个硬上界的自检
 * =======================
 *
 * 这三个数字是 ADR-0045 §2.3 的对策，不是性能调优：**没有上界的多步循环，
 * 出境量由模型决定**。所以本文件要证的不是"函数返回值对不对"，
 * 而是三件只有测试能证的事：
 *
 *   1. **单位是字节**。中文一条 3 字节，按字符算会把出境量低估三倍 ——
 *      本仓库对"阈值要钉死计数单位"有账，这条就是那个账的执行点。
 *   2. **边界在常量的那一侧**：正好等于上界放行、超出一个字节就拦。
 *      判据写成 `>=` 还是 `>` 只在真实数据上才现形。
 *   3. **给用户看的那句"我为什么停了"里的数字是从常量推导的**。
 *      手抄一个 `6` 进措辞，改常量时不会有任何东西变红。
 *
 * 另外钉住上界之间的**关系**（不是具体取值）：消息上界必须容得下步数上界
 * 所产生的 `assistant` + `tool` 成对消息 —— 否则"步数还没到、消息先爆"，
 * 用户看到的停止原因就是错的。
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_ASSISTANT_EGRESS_BYTES,
  MAX_ASSISTANT_MESSAGES,
  MAX_ASSISTANT_TOOL_STEPS,
  assistantLimitLabel,
  egressBytesFor,
  exceedsEgressBudget,
  utf8ByteLength,
  type AssistantLimit,
  type AiInvocation,
} from '../src/index.js';

describe('单位：字节，不是字符', () => {
  it('🔴 一个汉字的 `.length` 是 1，字节数是 3 —— 上界吃的是后者', () => {
    expect('中'.length).toBe(1);
    expect(utf8ByteLength('中')).toBe(3);
    // 4 字节的是增补平面（emoji）。按 UTF-16 码元数它会算成 2，按字节是 4。
    expect('😀'.length).toBe(2);
    expect(utf8ByteLength('😀')).toBe(4);
  });

  it('中文的可用预算因此是字节上界的三分之一', () => {
    // 这条**不是**另一个阈值，是把单位换算显式写出来，免得下一个人以为
    // `MAX_ASSISTANT_EGRESS_BYTES` 是"20 万个字"。
    const chars = Math.floor(MAX_ASSISTANT_EGRESS_BYTES / 3);
    expect(utf8ByteLength('中'.repeat(chars))).toBe(chars * 3);
    // 再多一个字就越过上界 —— 而按字符数判断它看起来"远没到"。
    expect(exceedsEgressBudget('中'.repeat(chars + 1))).toBe(true);
  });
});

describe('边界：判据在上界的哪一侧', () => {
  it('正好等于上界 ⇒ 不超（`>` 不是 `>=`）', () => {
    expect(exceedsEgressBudget('a'.repeat(MAX_ASSISTANT_EGRESS_BYTES))).toBe(false);
  });

  it('多一个字节 ⇒ 超', () => {
    expect(exceedsEgressBudget('a'.repeat(MAX_ASSISTANT_EGRESS_BYTES + 1))).toBe(true);
  });

  it('空串 ⇒ 不超', () => {
    expect(exceedsEgressBudget('')).toBe(false);
  });

  it('🔴 判据吃的是真实序列化结果，不是估算', () => {
    // 同一个"字符数"的中文串，序列化后必须按字节判定。
    // 把 `exceedsEgressBudget` 改成 `serializedBody.length > …` ⇒ 这条红，
    // 因为中文按长度算只有三分之一。
    const cjk = '任'.repeat(Math.ceil(MAX_ASSISTANT_EGRESS_BYTES / 3) + 1);
    expect(cjk.length).toBeLessThanOrEqual(MAX_ASSISTANT_EGRESS_BYTES);
    expect(exceedsEgressBudget(cjk)).toBe(true);
  });
});

describe('触顶原因：码与数字同源', () => {
  const LIMITS: readonly AssistantLimit[] = ['tool-steps', 'messages', 'egress-bytes'];

  it('每个上界都有独立的标签，且标签里的数字**就是从常量来的**', () => {
    const labels = LIMITS.map(assistantLimitLabel);
    expect(new Set(labels).size).toBe(LIMITS.length);
    expect(labels).toContain(`tool-steps:${String(MAX_ASSISTANT_TOOL_STEPS)}`);
    expect(labels).toContain(`messages:${String(MAX_ASSISTANT_MESSAGES)}`);
    expect(labels).toContain(`egress-bytes:${String(MAX_ASSISTANT_EGRESS_BYTES)}`);
  });

  it('三个上界都是正整数（0 会让循环一步都走不了，负数是笔误）', () => {
    for (const value of [MAX_ASSISTANT_TOOL_STEPS, MAX_ASSISTANT_MESSAGES, MAX_ASSISTANT_EGRESS_BYTES]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it('🔴 消息上界容得下步数上界产生的消息，否则停止原因会说谎', () => {
    // 一步至少产生两条（`assistant` 的工具调用 + `tool` 的结果），
    // 再加上系统提示与用户那句，所以关系是硬约束而不是偏好：
    // 若 `MAX_ASSISTANT_MESSAGES <= 2 * MAX_ASSISTANT_TOOL_STEPS`，
    // 用户会在**步数还没到**时被告知"会话太长" —— 那是个错误归因。
    expect(MAX_ASSISTANT_MESSAGES).toBeGreaterThan(2 * MAX_ASSISTANT_TOOL_STEPS + 2);
  });
});

describe('测量函数：它只给字节数，不给请求体', () => {
  const INVOCATION: Pick<AiInvocation, 'system' | 'user'> = {
    system: '你是 heyta 任务管理器的工具选择器。',
    user: '今天有什么任务？',
  };

  it('中文比同字符数的英文**量出来更大**', () => {
    const cjk = '今天有什么任务？'; // 8 个字符
    const latin = 'abcdefgh'; // 同样 8 个字符，1 字节一个
    const base: Pick<AiInvocation, 'system' | 'user'> = { system: '', user: '' };
    expect(egressBytesFor('m', { ...base, user: cjk })).toBeGreaterThan(
      egressBytesFor('m', { ...base, user: latin }),
    );
  });

  it('模型名计入体积（判上界时要按最坏的那个算）', () => {
    const short = egressBytesFor('m', INVOCATION);
    const long = egressBytesFor('a-very-long-model-name-for-testing', INVOCATION);
    expect(long).toBeGreaterThan(short);
    expect(long - short).toBe(
      utf8ByteLength('a-very-long-model-name-for-testing') - utf8ByteLength('m'),
    );
  });

  it('🔴 给了 `messages` 就以它为准：历史逐条计入，而 `system`/`user` 不再重复计', () => {
    // `buildChatRequestBody` 的形状是"`messages ?? [system, user]`" —— 两者**互斥**。
    // 测量必须跟着这个形状走：
    // 如果它把 `system`/`user` 也一并算进去，多轮的字节判断会**虚高**
    // （同一个系统提示被数两遍），后果是循环提前停、用户看到"会话太长"这个假原因。
    const longSystem = '系'.repeat(200);
    const withoutMessages = egressBytesFor('m', { system: longSystem, user: '今天有什么任务？' });
    const withMessages = egressBytesFor('m', {
      system: longSystem,
      user: '今天有什么任务？',
      messages: [{ role: 'user', content: '短' }],
    });
    expect(withMessages).toBeLessThan(withoutMessages);

    // 而历史变长 ⇒ 测量值随之变大（这才是循环真正要拦的东西）。
    const shortHistory = egressBytesFor('m', {
      system: longSystem,
      user: 'x',
      messages: [{ role: 'user', content: '第一句' }],
    });
    const longHistory = egressBytesFor('m', {
      system: longSystem,
      user: 'x',
      messages: [{ role: 'user', content: '第一句' }, { role: 'assistant', content: '长'.repeat(500) }],
    });
    // 增量至少等于正文增量 —— 多出来的是这一条的 JSON 结构（键名、引号、逗号）。
    expect(longHistory - shortHistory).toBeGreaterThanOrEqual(utf8ByteLength('长'.repeat(500)));
    // 结构开销要**有界**：加一条空消息只该多几十字节。若这里量出上千，
    // 说明测量把整份历史重算了一遍（那是另一份事实源）。
    const emptyExtra = egressBytesFor('m', {
      system: longSystem,
      user: 'x',
      messages: [{ role: 'user', content: '第一句' }, { role: 'assistant', content: '' }],
    });
    expect(emptyExtra - shortHistory).toBeLessThan(100);
  });

  it('🔴 返回的是数字，不是请求体 —— 测量本身不得成为第二条出境通道', () => {
    expect(typeof egressBytesFor('m', INVOCATION)).toBe('number');
  });
});
