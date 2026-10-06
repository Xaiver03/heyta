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
 * 所以这里在跑之前把**给它的端口**（默认 4318 / 4319）腾出来。
 *
 * 🔴 为什么敢 kill（2026-10-05 起这条**收窄了**）
 * ---------------
 * 原来这里写着"4318 / 4319 是为这个套件选的端口，所以敢杀"，实测**不成立**：
 * 别的会话（甚至别的项目）会把别的服务器开到这两个端口上，而本文件那时会
 * 无条件 `SIGKILL` —— 2026-10-04 22:48 就发生过一次，记在
 * [`docs/reference/environment-traps.md`](../docs/reference/environment-traps.md)：
 * 我的 `check:ai-e2e` 杀掉了另一条会话的 vite，两轮的取证同时作废。
 * **一道门禁没有权利杀掉它没有归属证据的进程**，不管端口"本该"归谁。
 *
 * 现在的规则：**只杀得起证据，杀不起就响亮地失败**。
 * 归属证据（两条任一即可）：
 *   · 进程的命令行里出现**本仓根的绝对路径**（同一台机器上的多个检出/工作树互不误伤），或
 *   · 进程的工作目录在本仓根之下。
 * 都不成立 ⇒ 退 2 并打印该进程的 pid / 进程名 / 命令行 / cwd，
 * 让跑的人自己决定（换端口是本文件下面那个参数存在的理由）。
 *
 * ⚠️ 两条会话在**同一个检出**里同时跑 e2e 时，这两条证据分不出彼此 ——
 * 那种并发由本机的测试闸门（`~/.tfa-shield` 的锁）串行化，不靠这里加锁。
 *
 * 🔴 端口现在是**参数**（`node 这个文件.mjs 4320`），不写死就是这里的原因：
 * 每个真浏览器套件都要一个自己的端口，而残留监听报出来的错
 * （`already used` / 整轮 `ECONNREFUSED`）长得像门禁坏了。
 * 默认值仍是主套件的两个端口，所以 `check:ai-e2e` 的调用不用改。
 */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** 本仓根：本文件住在 `<root>/scripts/`。用于"这条进程是不是我们的"。 */
const REPO_ROOT = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))));

/** 与 `e2e/playwright.config.ts` 里的两个 webServer 端口保持一致。 */
const DEFAULT_PORTS = [4318, 4319];

const ARGS = process.argv
  .slice(2)
  .map((arg) => Number(arg))
  .filter((port) => Number.isInteger(port) && port > 0);

const PORTS = ARGS.length > 0 ? ARGS : DEFAULT_PORTS;

/** 这些端口归本套件所有，不该有别人长期监听。 */
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

/** 完整命令行 —— 归属证据之一（本仓根路径会出现在自己的 vite 参数里）。 */
function argsOf(pid) {
  try {
    return execFileSync('ps', ['-o', 'args=', '-p', pid], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** 进程的工作目录 —— 归属证据之二（`lsof -a -p <pid> -d cwd -Fn` 的 `n` 行）。 */
function cwdOf(pid) {
  try {
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = out.split('\n').find((l) => l.startsWith('n'));
    return line ? line.slice(1).trim() : '';
  } catch {
    return '';
  }
}

/**
 * 归属判定：只认**绝对路径**级别的证据，不认进程名。
 * `node` / `vite` 这种名字在本机上一抓一把，按名字杀是本仓明写过的手法禁令。
 */
function belongsToThisRepo(pid) {
  const args = argsOf(pid);
  const cwd = cwdOf(pid);
  return args.includes(REPO_ROOT) || cwd === REPO_ROOT || cwd.startsWith(REPO_ROOT + '/');
}

let cleaned = 0;
const foreign = [];

for (const port of PORTS) {
  for (const pid of pidsOn(port)) {
    const name = describe(pid);
    if (!belongsToThisRepo(pid)) {
      foreign.push({ port, pid, name, args: argsOf(pid), cwd: cwdOf(pid) });
      continue;
    }
    process.stdout.write(`  ⚠️  端口 ${port} 是本仓残留：pid ${pid}（${name}）—— 清掉\n`);
    try {
      process.kill(Number(pid), 'SIGKILL');
      cleaned += 1;
    } catch (error) {
      process.stdout.write(`  🔴 杀不掉 pid ${pid}：${String(error)}\n`);
      foreign.push({ port, pid, name, args: argsOf(pid), cwd: cwdOf(pid) });
    }
  }
}

if (foreign.length > 0) {
  process.stderr.write(
    `🔴 端口被**拿不到归属证据**的进程占着，本门禁不杀它（2026-10-05 之前这里会无条件 SIGKILL，\n` +
      `   实测杀掉过另一条会话的 vite，两轮的取证同时作废）。\n\n` +
      foreign
        .map(
          (f) =>
            `   · 端口 ${f.port}  pid ${f.pid}（${f.name}）\n` +
            `     args: ${f.args || '（取不到）'}\n` +
            `     cwd : ${f.cwd || '（取不到）'}\n` +
            `     本仓根作为证据：${REPO_ROOT}`,
        )
        .join('\n') +
      `\n\n   ⇒ 处置：本套件的端口是参数（\`node scripts/check-ai-e2e-preflight.mjs <端口…>\`，\n` +
      `      配套的 webServer 端口也要一起换），或者由**进程自己**的会话结束它。\n` +
      `       不要在这里加 ` +
      `--force：那等于把这条判断又关掉。\n`,
  );
  process.exit(2);
}

if (cleaned === 0) {
  process.stdout.write(`  ✅ ${PORTS.join(' / ')} 都是空的\n`);
}
