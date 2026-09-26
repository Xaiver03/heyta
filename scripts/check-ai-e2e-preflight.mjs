#!/usr/bin/env node
/**
 * AI 真实浏览器验收门禁的**跑前清场**。
 *
 * 为什么需要它
 * ------------
 * `e2e/playwright.config.ts` 里 `reuseExistingServer: false` 是**故意的**：
 * 如果允许复用，本机同时开着别的项目时，Playwright 可能把**别人的应用**
 * 当成被测对象 —— 而症状是"测试全绿，但测的是另一个网站"。那比红更糟。
 *
 * 代价是：上一次跑崩留下的残留进程会让下一次**直接失败**，
 * 报 `http://127.0.0.1:4319/__requests is already used`。
 * 那个报错看起来像门禁坏了，其实只是端口没释放。
 * 实测撞到过一次，特征是**整轮 `ECONNREFUSED`**。
 *
 * 所以这里在跑之前把这两个端口腾出来。
 *
 * 🔴 为什么敢 kill
 * ---------------
 * 4318 / 4319 是**为这个套件选的**：Vite 默认 5173、Next 默认 3000，
 * 而这两个值不对应任何常见开发服务器的习惯端口。
 * 即便如此，我们仍然**打印出被杀的 pid 和进程名**，不静默处理 ——
 * 万一真杀掉了谁的东西，日志里能看见，而不是变成一个查不出的怪现象。
 *
 * ⚠️ 这不解决"两个人同时跑"：并发跑仍会互抢端口。
 * 那种情况下的正确修法是让端口可配置，而不是在这里加锁。
 */

import { execFileSync } from 'node:child_process';

/** 与 `e2e/playwright.config.ts` 里的两个 webServer 端口保持一致。 */
const PORTS = [4318, 4319];

/** 这两个端口归本套件所有，不该有别人长期监听。 */
function pidsOn(port) {
  try {
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch {
    // lsof 在"没人监听"时退出码非 0 —— 这正是我们要的正常情况。
    // 机器上没有 lsof 时也走这里，不因为清场失败就挡住门禁。
    return [];
  }
}

function describe(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'comm=', '-p', pid], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim();
  } catch {
    return '（进程名取不到）';
  }
}

let cleaned = 0;

for (const port of PORTS) {
  for (const pid of pidsOn(port)) {
    const name = describe(pid);
    process.stdout.write(`  ⚠️  端口 ${port} 被占用：pid ${pid}（${name}）—— 清掉\n`);
    try {
      process.kill(Number(pid), 'SIGKILL');
      cleaned += 1;
    } catch (error) {
      process.stdout.write(`  🔴 杀不掉 pid ${pid}：${String(error)}\n`);
    }
  }
}

if (cleaned === 0) {
  process.stdout.write('  ✅ 4318 / 4319 都是空的\n');
}
