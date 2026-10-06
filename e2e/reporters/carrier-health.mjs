/**
 * 载体健康报告器：把"传输层没走到被测应用"和"产品不对"分开。
 *
 * 为什么需要它（2026-10-06 实测，`check:ai-e2e` 一整轮）：
 * vite dev server 在第 6 条用例之后死了，Playwright **不会**因此停下，于是剩下
 * 一百多条用例逐条 `page.goto` 得到 `net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4318/`，
 * 每条 ~130 ms 红一次 —— 输出读起来像"后台、AI 助手、拆解、捕获、估时、优先级全坏了"，
 * 而真相只有一句：**载体不在了**。
 *
 * 🔴 已有的 `check-ai-e2e-preflight.mjs` 挡的是**起跑那一刻**端口上是谁的进程；
 * 它对"跑到一半载体没了"完全没有覆盖。这条补的就是那一格。
 *
 * 为什么不写进 `test.beforeEach`：那要改每一份 spec（190 多条），而签名判定与
 * "哪条用例"无关 —— 它属于报告层。
 *
 * 退出码 160：刻意不用 1，让日志里一眼看出"这是载体判定，不是套件判定"。
 */

import { carrierFailureReason } from './carrier-signature.mjs';

const EXIT_CARRIER_DOWN = 160;

/** 把 result 上所有可能的错误文本收成一条字符串（Playwright 不同版本挂点不同）。 */
function errorTextOf(result) {
  const parts = [];
  if (result.error?.message) parts.push(String(result.error.message));
  for (const e of result.errors ?? []) {
    if (e?.message) parts.push(String(e.message));
  }
  return parts.join('\n');
}

export default class CarrierHealthReporter {
  onTestEnd(test, result) {
    const text = errorTextOf(result);
    const verdict = carrierFailureReason(text);
    if (!verdict) return;

    const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? text;
    console.error(
      [
        '',
        '🔴 载体判定：这一轮 e2e **作废**，立刻停止（不是产品失败）。',
        `   签名：${verdict.reason}`,
        `   首例：${test.titlePath().join(' › ')}`,
        `   原文：${firstLine.trim()}`,
        '',
        '   ⇒ 这些红回答的是"载体在不在"，不回答"界面对不对"。先确认 dev server',
        '     （4318）与假端点（4319）还在，再重跑整轮。',
        '   ⇒ 不要为了让它跑完去放宽判据，也不要把这一轮的条数当读数记进台账。',
        '',
      ].join('\n'),
    );
    process.exit(EXIT_CARRIER_DOWN);
  }
}
