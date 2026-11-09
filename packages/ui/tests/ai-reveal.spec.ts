/**
 * 流式揭示引擎的判据
 * ==================
 *
 * 🔴 本文件**不渲染任何组件、不等待任何真实时间**：全部用假时钟推进。
 * 理由见 `reveal.ts` 文件头 —— 引擎被写成"注入时钟"，就是为了让
 * "积压 300 字时 200ms 内排空"这种事能在 1 毫秒内测穿。
 *
 * ⚠️ 每条判据都必须**能失败**（`AGENTS.md` §6 第 2 条）。写完先故意改坏引擎
 * 对应的一行、确认它变红，再改回来 —— 下面是每条的"怎么让它红"。
 */

import { describe, expect, it } from 'vitest';

import {
  advanceReveal,
  createReveal,
  REVEAL_DEFAULTS,
  type RevealClock,
} from '../src/ai/reveal.js';

/**
 * 手动推进的假时钟。
 *
 * `advance(ms)` 把时间往前拨 **并**执行当前排着的那一帧 —— 与真实
 * `requestAnimationFrame` 的语义一致（时间到了才回调）。
 */
function fakeClock(): RevealClock & {
  advance(ms: number): void;
  /** 当前排着几帧。0 = 引擎停了、不再要求推进。 */
  pending(): number;
} {
  let current = 0;
  const queue: (() => void)[] = [];

  return {
    now: () => current,
    schedule(frame) {
      queue.push(frame);
      return () => {
        const index = queue.indexOf(frame);
        if (index >= 0) queue.splice(index, 1);
      };
    },
    advance(ms) {
      current += ms;
      // 只跑**这一拍**排着的那一帧：新排进来的留给下一次 advance。
      // 否则一个 while 循环就能把整段动画跑完，"逐帧"就没被真的测到。
      const frame = queue.shift();
      if (frame !== undefined) frame();
    },
    pending: () => queue.length,
  };
}

describe('advanceReveal：自适应追赶（引擎的心脏）', () => {
  it('积压越多，每帧吐出的字越多（同样经过 16ms）', () => {
    // 小积压：还剩 4 个字 → baseTimePerChar = min(5, 200/4=50) = 5ms ⇒ 16ms 吐 3 个
    const small = advanceReveal(0, '四个字啊', 16);
    // 大积压：还剩 400 个字 → baseTimePerChar = min(5, 200/400=0.5) = 0.5ms ⇒ 16ms 吐 32 个
    const big = advanceReveal(0, '字'.repeat(400), 16);

    expect(small.added).toBe(3);
    expect(big.added).toBe(32);
    // 🔴 这一条是"自适应"三个字的全部意义：积压大时单帧产出必须**显著**更多。
    expect(big.added).toBeGreaterThan(small.added * 5);
  });

  it('🔴 排空时间被 drainMs 夹住：无论积压多少，总时长都在同一量级', () => {
    // 让假时钟一直按 16ms 推进，数到追上为止要几帧。
    const framesToDrain = (target: string, drainMs: number): number => {
      let revealed = 0;
      let frames = 0;
      for (let guard = 0; guard < 10_000; guard += 1) {
        const step = advanceReveal(revealed, target, 16, { drainMs });
        revealed += step.added;
        frames += 1;
        if (step.done) return frames;
      }
      throw new Error('没能在 10000 帧内排空 —— 引擎没有收敛');
    };

    const shortFrames = framesToDrain('短'.repeat(50), 200);
    const longFrames = framesToDrain('长'.repeat(5000), 200);

    // 积压差 100 倍，但排空帧数应当同阶（受 maxCharIntervalMs 封顶影响，
    // 小积压的最小耗时是 remaining × 5ms，所以这里只断言"没有随积压线性爆炸"）。
    const ratio = longFrames / shortFrames;
    expect(ratio, `短=${shortFrames} 帧、长=${longFrames} 帧`).toBeLessThan(20);
  });

  it('每字最慢间隔 maxCharIntervalMs 封顶（积压少时不会瞬移）', () => {
    // 只剩 1 个字：baseTimePerChar = min(5, 200/1=200) = 5 ⇒ 只过 3ms 时一个字都不该吐
    const step = advanceReveal(3, '四个字啊', 3);
    expect(step.added).toBe(0);
    expect(step.done).toBe(false);
  });

  it('maxCharsPerFrame 真的封顶（一帧给再多时间也不越过上限）', () => {
    const target = '字'.repeat(1000);
    // 限制每帧 10 个。过 500ms（远超一次能给的时间）也只该吐 10 个。
    const first = advanceReveal(0, target, 500, { maxCharsPerFrame: 10 });
    expect(first.added).toBe(10);

    // 再过 0ms 不该吐 —— 但这**不是因为**"截断帧不结转时间"：
    // 本函数是纯的，`elapsedMs` 每次覆盖局部变量，结构上就结转不了。
    // 这条断言真正钉住的是"时间没到就不推进"。
    const second = advanceReveal(10, target, 0, { maxCharsPerFrame: 10 });
    expect(second.added).toBe(0);

    // 🔴 而这一条才是"上限就是上限"的真判据：连续两帧各给满时间，
    // 每次都必须**恰好**停在上限，不能累积爆发。
    let revealed = 0;
    for (let i = 0; i < 5; i += 1) {
      const step = advanceReveal(revealed, target, 500, { maxCharsPerFrame: 10 });
      expect(step.added, `第 ${i + 1} 帧越过了上限`).toBe(10);
      revealed += step.added;
    }
    expect(revealed).toBe(50);
  });

  it('永远只揭示前缀（这条要是破了，屏上会出现"从未存在过的文本"）', () => {
    const target = '你有一条任务。';
    for (let ms = 0; ms <= 200; ms += 7) {
      const step = advanceReveal(0, target, ms);
      expect(target.startsWith(step.revealed)).toBe(true);
    }
  });

  it('中文与 emoji 按字符切，不被切坏', () => {
    // slice 按 UTF-16 code unit 走；这里验证不出现"半个代理对"之外的破坏
    // （emoji 会被切成半个代理对，这是 JS 字符串的固有行为，
    //  但**必须**在最终 done 时完整 —— 那才是用户能看见的时刻）。
    const target = '好👍';
    const final = advanceReveal(0, target, 1000);
    expect(final.revealed).toBe(target);
    expect(final.done).toBe(true);
  });

  it('已追上时 added=0、done=true，不消耗时间', () => {
    const step = advanceReveal(5, '五个字啊啊', 999);
    expect(step).toMatchObject({ added: 0, done: true, revealed: '五个字啊啊' });
  });

  it('负的 elapsed 当成 0（时钟回拨不该让动画卡死）', () => {
    // 怎么让它红：把 `elapsedMs > 0 ? elapsedMs : 0` 改成直接用 elapsedMs，
    // 于是 while 一次都不进，added 永远是 0。
    const step = advanceReveal(0, '你有一条任务。', -50);
    expect(step.added).toBe(0);

    // 但下一条**正常**的帧必须还能推进 —— 这证明"负 elapsed 只是这一帧无效"，
    // 不是"引擎被毒死"。
    const next = advanceReveal(0, '你有一条任务。', 16);
    expect(next.added).toBeGreaterThan(0);
  });
});

describe('createReveal：接到时钟上的状态机', () => {
  it('start 之后按帧推进，追上就自动停表（不再排帧）', () => {
    const clock = fakeClock();
    const reveal = createReveal(clock);
    const seen: string[] = [];

    reveal.setTarget('你有一条任务。');
    reveal.start((text) => seen.push(text));

    // 第一帧：start 只是排了帧，还没跑
    expect(clock.pending()).toBe(1);
    for (let i = 0; i < 200 && clock.pending() > 0; i += 1) clock.advance(16);

    expect(reveal.current()).toBe('你有一条任务。');
    expect(clock.pending()).toBe(0);
    // 中途必须真的分多帧（不是一次给完）
    expect(seen.length).toBeGreaterThan(1);
  });

  it('🔴 只在文本真的变了时才回调（否则每帧重渲染）', () => {
    const clock = fakeClock();
    const reveal = createReveal(clock);
    const seen: string[] = [];

    reveal.setTarget('你有一条任务。');
    reveal.start((text) => seen.push(text));

    // 逐帧推进，统计"排了帧但一个都没吐"的比例。
    // 若 onReveal 每帧都调，seen 长度会等于总帧数。
    let frames = 0;
    for (let i = 0; i < 500 && clock.pending() > 0; i += 1) {
      clock.advance(1); // 1ms < maxCharIntervalMs(5)，大部分帧吐 0 个
      frames += 1;
    }

    expect(seen.length).toBeLessThan(frames);
    // 且回调里的文本必须严格递增（不能重复、不能倒退）
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!.length).toBeGreaterThan(seen[i - 1]!.length);
    }
  });

  it('🔴 目标不再是前缀时重置（换内容不能拼出幻觉文本）', () => {
    // 怎么让它红：删掉 setTarget 里那个 `startsWith` 分支。
    const clock = fakeClock();
    const reveal = createReveal(clock);

    reveal.setTarget('第一段内容在这里');
    reveal.start(() => undefined);
    clock.advance(16);
    const partial = reveal.current();
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan('第一段内容在这里'.length);

    // 换成一段**完全不同**的内容
    reveal.setTarget('完全不同的另一句');

    // 🔴 重置之后，已显示必须是**新内容的**前缀，不能带着旧内容。
    const after = reveal.current();
    expect('完全不同的另一句'.startsWith(after)).toBe(true);
    expect(after.includes('第一段')).toBe(false);
  });

  it('目标是旧内容的超集时**续写**而不是重来（流式的主场景）', () => {
    const clock = fakeClock();
    const reveal = createReveal(clock);

    reveal.setTarget('你');
    reveal.finish();
    expect(reveal.current()).toBe('你');

    // 下一片到达：'你有' —— 以已显示内容开头
    reveal.setTarget('你有');
    expect(reveal.current()).toBe('你'); // 不重置，保留已显示的前缀
  });

  it('finish() 立即补齐并停表（降级与卸载走这条）', () => {
    const clock = fakeClock();
    const reveal = createReveal(clock);

    reveal.setTarget('你有一条任务。');
    reveal.start(() => undefined);
    clock.advance(16);
    expect(reveal.current()).not.toBe('你有一条任务。');

    reveal.finish();
    expect(reveal.current()).toBe('你有一条任务。');
    expect(clock.pending()).toBe(0);
  });

  it('stop() 之后不再推进', () => {
    const clock = fakeClock();
    const reveal = createReveal(clock);
    reveal.setTarget('你有一条任务。');
    reveal.start(() => undefined);

    reveal.stop();
    expect(clock.pending()).toBe(0);

    const frozen = reveal.current();
    for (let i = 0; i < 10; i += 1) clock.advance(100);
    expect(reveal.current()).toBe(frozen);
  });

  it('重复 start 不会排出第二条帧链（否则速度翻倍）', () => {
    const clock = fakeClock();
    const reveal = createReveal(clock);
    reveal.setTarget('你有一条任务。');

    reveal.start(() => undefined);
    reveal.start(() => undefined);
    reveal.start(() => undefined);

    expect(clock.pending()).toBe(1);
  });

  it('默认值就是导出常量（测试不该抄一遍数字）', () => {
    // 1000 字积压、过满 drainMs 时间 → 应该全吐完
    const step = advanceReveal(0, '字'.repeat(1000), REVEAL_DEFAULTS.drainMs);
    expect(step.done).toBe(true);
  });
});
