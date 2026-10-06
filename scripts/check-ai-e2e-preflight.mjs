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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

/** 本仓根：本文件住在 `<root>/scripts/`。用于"这条进程是不是我们的"。 */
const REPO_ROOT = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * 与 `e2e/ports.ts` 那一族 webServer 端口保持一致（默认值逐字不变）。
 *
 * 🔴 为什么这里也要认这两个环境变量：清场判的是**端口**，而端口现在是**槽**。
 * 只让配置读 env、清场读死值 ⇒ 换槽之后清的是**没人听的端口**，而真正占着的那枚没人判归属 ——
 * 症状恰好是它该挡的那件事（跑到一半端口换人，后半程连的是别人那棵树，traps #358）。
 */
function portFromEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error(`${name}=${String(raw)} 不是一个合法端口（要 1024–65535 的整数）`);
  }
  return value;
}

function defaultPortsFromEnv(env) {
  return [
    portFromEnv(env, 'HEYTA_E2E_APP_PORT', 4318),
    portFromEnv(env, 'HEYTA_E2E_STUB_PORT', 4319),
  ];
}

const DEFAULT_PORTS = defaultPortsFromEnv(process.env);

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
 *
 * 🔴 **路径要按"路径"比，不能按子串比**（2026-10-06 实测修掉的缺陷）：
 * 这一支原先写的是 `args.includes(REPO_ROOT)`，而本机上有的是
 * `…/01_PROJECTS/heyta` 与 `…/01_PROJECTS/heyta-wt-merge` 这种**兄弟目录名互为前缀**的检出。
 * 于是主检出的清场把**别的工作树**的 vite 当成"本仓残留"SIGKILL 掉 ——
 * 症状不是"它没清场"，而是**别人那一整轮 e2e 在第 7 条用例上变成 `ERR_CONNECTION_REFUSED`**，
 * 两次实测都停在同一处（`admin-console.spec.ts:806`）。
 * 文件头第 29 行那句"同一台机器上的多个检出/工作树互不误伤"写的正是这条**没被兑现**的承诺。
 * `cwd` 那一支本来就带了分隔符（`REPO_ROOT + '/'`），漏的只有 args 这一支。
 */
function belongsToThisRepo(pid) {
  return ownsProcess({ args: argsOf(pid), cwd: cwdOf(pid) }, REPO_ROOT);
}

/** 目录名里可能出现的字符；命中根路径后紧跟这些字符 ⇒ 那是**另一个**目录名，不是本仓。 */
const PATH_NAME_CHAR = /[A-Za-z0-9._+~%-]/;

/** `text` 里是否出现 `path` 这一次**完整路径**（后面必须接分隔符、结束符或非路径字符）。 */
function mentionsPath(text, path) {
  for (let at = text.indexOf(path); at !== -1; at = text.indexOf(path, at + 1)) {
    const after = text[at + path.length];
    if (after === undefined || !PATH_NAME_CHAR.test(after)) return true;
  }
  return false;
}

/**
 * 纯判定（不查进程），自检直接喂样本：
 * args 命中本仓根 / cwd 等于本仓根 / cwd 在本仓根之下 —— 任一即算本仓。
 */
function ownsProcess({ args, cwd }, root) {
  if (typeof args === 'string' && mentionsPath(args, root)) return true;
  if (typeof cwd !== 'string' || cwd.length === 0) return false;
  return cwd === root || cwd.startsWith(`${root}/`);
}


/** 清场主体（只有**直接运行**时才执行 —— 自检与别的脚本 import 本文件不许杀进程）。 */
function main() {
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
}

/**
 * 自检：归属判定的每一臂都是**喂样本**，不碰真实进程。
 * 臂数由这里自己打印，不许抄进文档。
 */
function selfTest() {
  const ROOT = '/Users/x/01_PROJECTS/heyta';
  const arms = [];
  const arm = (name, ok) => arms.push([name, !!ok]);

  // 臂 1：今天真被误杀的那一枚 —— 兄弟工作树的 vite（args 里含 `…/heyta-wt-merge/…`）。
  arm(
    '兄弟工作树的 vite 不判本仓（2026-10-06 实测被误杀的形状）',
    !ownsProcess(
      {
        args:
          'node /Users/x/01_PROJECTS/heyta-wt-merge/node_modules/.pnpm/vite@7/bin/vite.js --host 127.0.0.1 --port 4318 --strictPort',
        cwd: '/Users/x/01_PROJECTS/heyta-wt-merge/apps/web',
      },
      ROOT,
    ),
  );

  // 臂 2：阳性对照 —— 真本仓的 vite 必须判本仓（否则这把尺恒 false，清场永远"不敢杀"）。
  arm(
    '本仓的 vite 判本仓（不是恒 false）',
    ownsProcess(
      {
        args:
          'node /Users/x/01_PROJECTS/heyta/node_modules/.pnpm/vite@7/bin/vite.js --port 4318 --strictPort',
        cwd: '/Users/x/01_PROJECTS/heyta/apps/web',
      },
      ROOT,
    ),
  );

  // 臂 3：根路径出现在**末尾**（后面没有字符）也是本仓。
  arm('args 里根路径到串尾仍判本仓', ownsProcess({ args: `node ${ROOT}`, cwd: '' }, ROOT));

  // 臂 4：cwd 等于根 / 在根之下，两条都算本仓。
  arm(
    'cwd 等于根、或落在根之下，都判本仓',
    ownsProcess({ args: '', cwd: ROOT }, ROOT) &&
      ownsProcess({ args: '', cwd: `${ROOT}/e2e` }, ROOT),
  );

  // 臂 5：只有 cwd 是兄弟目录（args 取不到）⇒ 不算本仓。
  arm('args 取不到而 cwd 是兄弟目录 ⇒ 不判本仓', !ownsProcess({ args: '', cwd: `${ROOT}-wt-merge/e2e` }, ROOT));

  // 臂 6：只有端口/进程名的进程一律不算本仓（挡"按名字杀"这条被明令禁止的手法回来）。
  arm('只凭端口号与进程名不判本仓', !ownsProcess({ args: 'node ./node_modules/.bin/vite --port 4318', cwd: '/tmp/other' }, ROOT));

  // 臂 7：反证 —— 旧写法（裸 `includes`）在臂 1 那个样本上会判 true，
  // 说明臂 1 的红确实来自"路径边界"这一维，而不是样本写错。
  const legacy = (a, r) => a.includes(r) || a === r;
  arm(
    '旧写法在臂 1 样本上会误判（证明臂 1 有牙）',
    legacy('/Users/x/01_PROJECTS/heyta-wt-merge/node_modules/.pnpm/vite@7/bin/vite.js --port 4318', ROOT),
  );

  // 臂 8：端口是**槽**不是常量 —— env 设了就必须跟着走（配置读 env 而清场读死值 ⇒ 清的是没人听的端口）。
  arm(
    'env 设了槽位时默认端口跟着走',
    JSON.stringify(defaultPortsFromEnv({ HEYTA_E2E_APP_PORT: '4418', HEYTA_E2E_STUB_PORT: '4419' })) ===
      '[4418,4419]',
  );

  // 臂 9：非法的槽值必须响亮拒绝，不能退成默认端口（那等于"清场清了别人那枚"）。
  arm(
    '非法端口值拒绝而不是退回默认',
    ['80', '0', 'abc', '4318.5', ''].every((bad) => {
      if (bad === '') {
        // 空串按"未设"处理是刻意的（`FOO= pnpm …` 是本机常见的设空写法）。
        return JSON.stringify(defaultPortsFromEnv({ HEYTA_E2E_APP_PORT: '' })) === '[4318,4319]';
      }
      try {
        defaultPortsFromEnv({ HEYTA_E2E_APP_PORT: bad });
        return false;
      } catch {
        return true;
      }
    }),
  );

  let bad = 0;
  arms.forEach(([name, ok], idx) => {
    if (!ok) bad += 1;
    process.stdout.write(`  ${ok ? '✅' : '❌'} 臂 ${idx + 1} ${name}\n`);
  });
  process.stdout.write(`\n自检 ${arms.length} 臂 ｜ 失败 ${bad} 臂\n`);
  process.exit(bad ? 1 : 0);
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (process.argv.includes('--self-test')) selfTest();
else if (invokedDirectly) main();
