/**
 * 自消回执的时长钉子（`receiptTimingOf` 的语义）
 * ==============================================
 *
 * 钉的是本仓**已经错了三个月**的那一格：三处自写的撤销回执都用
 * `window.setTimeout(…, 5000)`，其中两处**没有 hover/focus 暂停**，一处把撤销失败
 * 写进了 `role="status"`（那条会飘走）。判据正文在全局 Skill
 * `overlay-feedback-patterns` → `references/dismissal-and-timing.md` §2（时长与自动消失）
 * 与 `references/destructive-actions.md` §2（撤销是产品承诺，不是 UI 决定）。
 *
 * 五条不变量，逐条都写了"读反了会长成什么样"：
 *
 *   1. **`AUTO_DISMISS_RECEIPTS` 里每一类都得有策略** —— 用例遍历整份数组，
 *      加一类而忘了定时长会红在这里，而不是让那一层静默吃到 `undefined`；
 *   2. **带撤销动作的回执，窗口下限是 `UNDO_RECEIPT_MIN_MS`** —— 5 秒读一句
 *      "撤销删除 3 个任务"再找到那枚按钮，是不成立的承诺；
 *   3. **带动作的回执必须能暂停**（hover 与 focus 各一条）—— 不然用户把手指
 *      放在按钮上准备点，计时照走，点下去那一刻它已经没了；
 *   4. **失败一律不许自消**（`failureStaysVisible` 恒真）—— Skill §8 第二条
 *      点名的病灶：失败只飘一条 toast，用户抬头时错误没了、东西还在；
 *   5. **`notice` 那类不许带动作** —— 它专指纯文本回执；带动作就是 `undo`，
 *      两类的时长下限不同，混在一起等于没有下限。
 */

import { describe, expect, it } from 'vitest';

import {
  AUTO_DISMISS_RECEIPTS,
  UNDO_RECEIPT_MIN_MS,
  receiptTimingOf,
  type ReceiptKind,
} from '../src/feedback/receipt-timing.js';

describe('自消回执的时长表', () => {
  it('登记的每一类都查得到策略（漏一格就红，不会静默吃 undefined）', () => {
    expect(AUTO_DISMISS_RECEIPTS.length).toBeGreaterThan(0);
    for (const kind of AUTO_DISMISS_RECEIPTS) {
      const timing = receiptTimingOf(kind);
      expect(timing, `${kind} 在清单里但没有策略`).toBeDefined();
      expect(Number.isFinite(timing!.durationMs), `${kind} 的时长必须是有限数`).toBe(true);
      expect(timing!.durationMs, `${kind} 不许是 0 毫秒`).toBeGreaterThan(0);
    }
  });

  it('带撤销动作的回执：窗口不低于下限，且 hover / focus 都能暂停计时', () => {
    const undo = receiptTimingOf('undo');
    expect(undo, '撤销回执这一类必须存在（它承载 P3 的全部承诺）').toBeDefined();
    expect(undo!.durationMs, `撤销窗口 ${undo!.durationMs}ms 低于下限 ${UNDO_RECEIPT_MIN_MS}ms`)
      .toBeGreaterThanOrEqual(UNDO_RECEIPT_MIN_MS);
    // 🔴 这两枚各自单独立一条：第一版只有"至少要有一个"这种或断言，
    //    结果把 focus 那条摘掉也照样绿 —— 判据写宽 = 没有判据。
    expect(undo!.pauseOnHover, '撤销回执必须在鼠标停在上面时暂停计时').toBe(true);
    expect(undo!.pauseOnFocus, '键盘用户 Tab 到撤销按钮时必须在它上面暂停计时').toBe(true);
    expect(undo!.autoDismiss, '窗口到点要自然消失：常驻的撤销条会变成第二块界面').toBe(true);
  });

  it('纯文本回执带不得动作 —— 带动作就属于 `undo` 那一类，两类的下限不同', () => {
    const notice = receiptTimingOf('notice');
    expect(notice, '纯文本回执这一类必须存在').toBeDefined();
    expect(notice!.carriesAction, 'notice 类一带动作，撤销承诺就落进了没有下限的那一档').toBe(false);
  });

  it('🔴 失败一律不许自消：每一类的 `failureStaysVisible` 都必须是 true', () => {
    for (const one of AUTO_DISMISS_RECEIPTS) {
      expect(receiptTimingOf(one)!.failureStaysVisible,
        `${one}：撤销失败后那条消息一旦飘走，屏幕上就什么都不剩`)
        .toBe(true);
    }
  });

  it('清单外的类别查不到策略（这张表的键就是它的定义域）', () => {
    expect(receiptTimingOf('no-such-receipt' as ReceiptKind)).toBeUndefined();
  });
});
