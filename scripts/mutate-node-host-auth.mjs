/**
 * `node-host` 的 `auth` 判据的变异验证
 * =====================================
 *
 * 用法：`node scripts/mutate-node-host-auth.mjs`
 *
 * ## 为什么单独一份
 *
 * `apps/node-host/tests/cli-auth.spec.ts` 那 26 条里，承重的是四条**顺序**与
 * 四条**句子**：
 *
 *   · 顺序（本地闸门排在请求之前）只能靠**数出 fetch 调用次数**来证 ——
 *     而"它没被调用"这件事，把闸门删掉之后界面上照样会得到一句错误，
 *     只是那次错误**已经出门了**（对注册来说就是一次枚举尝试）；
 *   · 中性句与"两个秘密"那两句是**产品口径**，代码里没有别的结构会因为它缺失而报错。
 *
 * 这两种失效在测试里都是"改一下就好了"的形状，所以必须**逐条打变异**才知道
 * 判据是不是真的在挡东西。下面每一行都对应上面的一种错法。
 *
 *   M1 同意项闸门挪到请求之后 —— 没勾也发出去了
 *   M2 注册成功那句写成"账号已创建"（服务端的假成功与真成功同形）
 *   M3 把服务端的安全文案原样印到终端（`failure.message` 是数据，不是话）
 *   M4 没有 `Retry-After` 也照说等待时长（`undefined` 当值用）
 *   M5 对登录口令做 `trim` —— 客户端多一套归一化就是第二套规则
 *   M6 登录成功后不说"这是两个秘密"（症状：拿登录口令去填 `--password`）
 *   M7 把 `auth` 的分派整块搬到 `--db` 检查之后（注册被要求先给库路径）
 *   M8 注册成功把服务端的 `message` 印出来
 *   M9 策略句子里**手打**阈值（服务端改掉的那天，这句变成假话）
 *
 * 🔴 M7 只能靠**真的搬一次**来验证：把代码改成"死分支"是抓不到的 ——
 * 源码级顺序判据挡的是**文本顺序**，这是它的边界，写在这里而不是装作没有。
 *
 * ⚠️ 只碰这两个文件的字节，跑完按 sha256 校验还原；不碰工作树里的其他任何东西。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUTH = join(ROOT, 'apps/node-host/src/cli-auth.ts');
const CLI = join(ROOT, 'apps/node-host/src/cli.ts');
const SPEC = 'tests/cli-auth.spec.ts';
const BLOCK_END = '    return result.code;\n  }\n';

const MUTATIONS = [
  {
    name: 'M1 同意项闸门挪到请求之后（没勾也发出去）',
    file: AUTH,
    from: "  if (sub === 'register' && !parsed.bools.has('terms')) {",
    to: "  if (false && sub === 'register' && !parsed.bools.has('terms')) {",
  },
  {
    name: 'M2 注册成功那句写成"账号已创建"',
    file: AUTH,
    from: "        '已受理。这一步不产出令牌，所以还没登录：去 ' +",
    to: "        '注册成功，账号已创建。去 ' +",
  },
  {
    name: 'M3 把服务端的安全文案原样印到终端',
    file: AUTH,
    from: '  const parts = [policy ?? base];',
    to: '  const parts = [failure.message ?? policy ?? base];',
  },
  {
    name: 'M4 没有 Retry-After 也照说等待时长',
    file: AUTH,
    from: '  if (locked && failure.retryAfterSeconds !== undefined) {',
    to: '  if (locked) {',
  },
  {
    name: 'M5 对登录口令做 trim（第二套归一化规则）',
    file: AUTH,
    from: '  const result = await loginWithEmailPassword(options, { email, password });',
    to: '  const result = await loginWithEmailPassword(options, { email, password: password.trim() });',
  },
  {
    name: 'M6 登录成功后不说"这是两个秘密"',
    file: AUTH,
    from: "      '🔴 这一步只是登录。同步还要另一个秘密（端到端加密口令），它不在这里：\\n' +",
    to: "      '接下来直接 sync 就行。\\n' +",
  },
  {
    name: 'M7 把 auth 分派整块搬到 --db 检查之后',
    file: CLI,
    apply(src) {
      const start = src.indexOf('  // 🔴 `auth` **自己解析参数**');
      const blockEnd = src.indexOf(BLOCK_END);
      const anchor = src.indexOf("throw new Error('缺少 --db");
      if (start < 0 || blockEnd < 0 || anchor < 0) throw new Error('变异锚点没找到');
      const block = src.slice(start, blockEnd + BLOCK_END.length);
      const rest = src.slice(0, start) + src.slice(blockEnd + BLOCK_END.length);
      const insertAt = rest.indexOf('  }', anchor) + 4;
      return `${rest.slice(0, insertAt)}\n${block}${rest.slice(insertAt)}`;
    },
  },
  {
    name: 'M8 注册成功把服务端的 message 印出来',
    file: AUTH,
    from: "        '已受理。这一步不产出令牌，所以还没登录：去 ' +",
    to: "        result.message + ' | 这一步不产出令牌，所以还没登录：去 ' +",
  },
  {
    name: 'M9 策略句子里手打阈值（服务端改掉后变成假话）',
    file: AUTH,
    from: '      return `至少要 ${String(AUTH_PASSWORD_MIN_CODE_POINTS)} 个字符`;',
    to: "      return '至少要 15 个字符';",
  },
];

const digest = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const files = [AUTH, CLI];
const originals = new Map(files.map((p) => [p, readFileSync(p, 'utf8')]));
const hashes = new Map(files.map((p) => [p, digest(p)]));

function run() {
  try {
    return {
      red: false,
      out: execFileSync('pnpm', ['exec', 'vitest', 'run', SPEC, '--reporter=dot'], {
        encoding: 'utf8',
        cwd: join(ROOT, 'apps/node-host'),
      }),
    };
  } catch (error) {
    return { red: true, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

const baseline = run();
console.log(`基线（未变异）：${baseline.red ? '❌ 红 —— 判据本身有问题' : '✅ 全绿'}`);
if (baseline.red) {
  console.log(baseline.out);
  process.exit(1);
}

let allCaught = true;
for (const mutation of MUTATIONS) {
  const src = originals.get(mutation.file);
  let mutated;
  try {
    if (mutation.apply !== undefined) {
      mutated = mutation.apply(src);
    } else {
      const hits = src.split(mutation.from).length - 1;
      if (hits !== 1) throw new Error(`锚点命中 ${String(hits)} 次`);
      mutated = src.replace(mutation.from, mutation.to);
    }
    if (mutated === src) throw new Error('变异后与原文一致（锚点已失效）');
  } catch (error) {
    console.log(`⚠️  ${mutation.name}：${String(error)} —— 变异没打上`);
    allCaught = false;
    continue;
  }
  writeFileSync(mutation.file, mutated);
  const result = run();
  const summary = (result.out.match(/Tests[^\n]*/) ?? ['(没打印计数 —— 可能整个跑不起来)'])[0];
  console.log(
    `${result.red ? '✅ 抓到' : '❌ 漏了'}：${mutation.name}${result.red ? ` → ${summary}` : ''}`,
  );
  if (!result.red) allCaught = false;
  writeFileSync(mutation.file, src);
}

for (const [path, expected] of hashes) {
  if (digest(path) !== expected) {
    console.log(`❌ 还原失败：${path}`);
    process.exit(1);
  }
}
console.log(`✅ ${String(files.length)} 个文件字节级还原。`);
console.log(allCaught ? '✅ 每条变异都被对应判据抓到。' : '❌ 有变异没被抓到。');
process.exit(allCaught ? 0 : 1);
