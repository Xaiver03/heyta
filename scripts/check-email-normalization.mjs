#!/usr/bin/env node
/**
 * 邮箱归一化**只许有一处实现**（常驻门禁，纯读盘，不占设备）。
 *
 * ## 为什么要有这条
 *
 * `server/src/account/email-normalize.ts` 的文件头把这件事写成了它自己成立的条件：
 * "本文件的存在**只有在上面那 6 处都被改成调用它之后**才成立"。这句话原本没有主人 ——
 * 而"抽取了共享实现、旧的那份还活着"正是 AGENTS §3.5 记了四次的失误形状
 * （`ids.ts`、任务 op 构造、`SyncClientOptions`、以及这里）。
 *
 * 这不是整洁问题。`users.email` 是 `@unique`，`email_change_requests.pending_email` 也是，
 * 两张唯一约束比的是**落库的那一串**；而 `account_tombstones.email_hash` 比的是
 * `SHA-256(那个口径)`。每个入口自己决定要不要 `trim()`，等于"同一个邮箱"有三种判法：
 *
 * - 注册不 trim、登录 trim ⇒ 带空格的账号**登不进去**；
 * - 注销用 `trim().toLowerCase()` 算哈希、注册用 `toLowerCase()` 存地址 ⇒
 *   恢复备份时那道"不许复活已注销账号"的闸门**认出的是另一个人**；
 * - 换绑比较两边各归一各的 ⇒ "换绑到一个已经属于自己的地址"能真的写进去。
 *
 * ## 判据（四条，逐条可失败）
 *
 *  ① 除唯一实现那枚文件外，`server/src/**` 里不许出现**自己拼一份归一化**的形状
 *     （对名字里带 email 的量直接 `.toLowerCase()` 或 `.trim().toLowerCase()`）。
 *  ② 不许有**第二份 `normalizeEmail` 的定义**（本地私有的一份最容易长回来）。
 *  ③ **口径本身钉住**：唯一实现的函数体必须是 `trim().toLowerCase()`。
 *     这一条是对外承诺的一部分（ADR-0055 §2.2 把它与一条 `CHECK (email_hash ~ '^[0-9a-f]{64}$')`
 *     绑在一起，而那个口径已经写进隐私政策）—— 换它要走法务，不许顺手改。
 *  ④ **阳性对照**：必须读到唯一实现那枚文件、且 `server/src` 里有 `.ts`；
 *     读不到就 `exit 2` 报探针，而不是报"全部合规"。
 *
 * `--self-test` 用夹具逐臂证明每条真会红、假缺陷真不红（臂数由它自己打印，文档里不许抄）。
 */
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stripTsComments, listTsFiles } from './lib/strip-ts-comments.mjs';

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag >= 0 && process.argv[rootFlag + 1] ? resolve(process.argv[rootFlag + 1]) : process.cwd();

const SOT = 'server/src/account/email-normalize.ts';
const SELF = 'scripts/check-email-normalization.mjs';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', 'Pods', 'DerivedData', 'vendor']);

/**
 * ⚠️ 两种形状要在**同一条**正则里抓住：`email.toLowerCase()` 与
 * `email.trim().toLowerCase()` —— 后者中间隔着一次调用，写成两条容易漏一条。
 *
 * 🔴 变量名必须**以 email 结尾**（结尾那个 `(?![\w$])` 是承重的），不是"名字里含 email"：
 * 本门禁第一次落地时把 `process.env.REQUIRE_EMAIL_VERIFICATION.trim().toLowerCase()`
 * 判成了违规 —— 那是一枚环境变量，不是邮箱。按"含 email"扫会把一堆合法的小写化判红，
 * 而一条太容易失败的门禁，最后的下场是被关掉 —— 那比没有门禁更糟（AGENTS §7 元规则 2 的另一侧）。
 */
const CALL_SHAPE =
  /((?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*)\s*\.\s*(?:trim\s*\(\s*\)\s*\.\s*)?toLowerCase\s*\(/g;

/**
 * 🔴 判"这个量是不是邮箱"看的是**名字里带 email**，但必须按**最后一段**判，
 * 而且不能把全大写的常量算进去。两条边界各挡一种错法：
 *
 *  - 按"整个点号表达式里出现过 email"判 ⇒ 名字里带 email 的**邮箱量**与 `a.email` 这类字段
 *    都能抓，但 `process.env.REQUIRE_EMAIL_VERIFICATION.trim().toLowerCase()` 也被抓成违规
 *    （本门禁第一次落地时就是这样，那是一枚环境变量）。
 *  - 只按"以 email 结尾"判 ⇒ 上面那枚确实不红了，可 `email.toLowerCase()` 这个**最常见的写法**
 *    也跟着漏了（自测的臂 A / 臂 B 就是这么照出来的：正则要求标识符至少还多一个字符）。
 *    漏判的方向是假绿，比假红严重得多。
 *
 * ⇒ 取两者：**末段含 email（不分大小写）且不是 SCREAMING_SNAKE 常量**。
 * `email` / `userEmail` / `pendingEmail` / `user.email` 都算，
 * `REQUIRE_EMAIL_VERIFICATION` 这类全大写环境变量名不算。
 */
const EMAIL_SEGMENT = /email/i;
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;

function scanEmailViolations(stripped) {
  const hits = [];
  for (const m of stripped.matchAll(CALL_SHAPE)) {
    const expr = m[1];
    const segment = expr.slice(expr.lastIndexOf('.') + 1);
    if (!EMAIL_SEGMENT.test(segment)) continue;
    if (CONSTANT_NAME.test(segment)) continue;
    hits.push({ text: m[0], why: '对邮箱量自己拼了一份归一化' });
  }
  // 局部又写了一份 normalizeEmail
  if (/(?:^|\n)\s*(?:export\s+)?(?:const|let|function)\s+normalizeEmail\b/.test(stripped)) {
    hits.push({ text: 'normalizeEmail 的第二份定义', why: '本地私有的一份实现' });
  }
  return hits;
}

function scan() {
  const srcDir = join(ROOT, 'server', 'src');
  if (!existsSync(srcDir)) return { probeError: `读不到 server/src（判据没有射程）：${ROOT}` };
  const files = listTsFiles(ROOT, 'server/src', SKIP_DIRS);
  if (files.length === 0) return { probeError: 'server/src 里一枚 .ts 都没读到' };
  const sotEntry = files.find((f) => f.rel === SOT);
  if (!sotEntry) return { probeError: `读不到唯一实现 ${SOT}（它被移动或改名 ⇒ 这一族门禁的射程也一起没了）` };

  const violations = [];
  let scanned = 0;
  for (const { abs, rel } of files) {
    if (rel === SOT || rel === SELF) continue;
    scanned += 1;
    const stripped = stripTsComments(readFileSync(abs, 'utf8'));
    for (const hit of scanEmailViolations(stripped)) {
      violations.push({ rel, ...hit });
    }
  }
  if (scanned === 0) return { probeError: '射程内一枚文件都没扫到' };

  // ③ 口径钉死在唯一实现里
  const sotSource = stripTsComments(readFileSync(sotEntry.abs, 'utf8'));
  const body = /function\s+normalizeEmail\s*\([^)]*\)\s*:[^{]*\{([\s\S]*?)\}/.exec(sotSource);
  const errors = [];
  if (!body) {
    errors.push(`${SOT} 里找不到 normalizeEmail 的函数体`);
  } else if (!/return\s+email\.trim\(\)\.toLowerCase\(\);/.test(body[1])) {
    errors.push(
      'normalizeEmail 的口径不再是 trim().toLowerCase() —— 这是**对外承诺的一部分**（ADR-0055 §2.2 + 隐私政策里的 email_hash 口径），要改先走法务与迁移',
    );
  }

  for (const v of violations) {
    errors.push(`${v.rel}：${v.why} ⇒ ${v.text.trim()}`);
  }

  return { fileCount: files.length, scanned, violationCount: violations.length, errors };
}

function main() {
  const r = scan();
  if (r.probeError) {
    console.error(`❔ 探针：${r.probeError}`);
    return 2;
  }
  if (r.errors.length > 0) {
    console.error('🔴 邮箱归一化不再只有一处实现 ——');
    for (const e of r.errors) console.error(`  · ${e}`);
    console.error(`SUMMARY 文件=${r.fileCount} 扫描=${r.scanned} 违规=${r.violationCount}（要求 0）`);
    return 1;
  }
  console.log(
    `✅ 邮箱归一化只有一处实现，口径是 trim().toLowerCase()；文件=${r.fileCount} 扫描=${r.scanned} 违规=0`,
  );
  return 0;
}

if (process.argv.includes('--self-test')) {
  const dir = join(process.cwd(), 'tmp/email-normalization-selftest');
  const SOT_OK =
    'export function normalizeEmail(email: string): string {\n  return email.trim().toLowerCase();\n}\n';
  const CLEAN =
    "import { normalizeEmail } from './email-normalize';\nexport const lookup = (email: string) => normalizeEmail(email);\n";

  const fixtures = [
    {
      name: '臂 A 对邮箱量自己 toLowerCase ⇒ 红，理由是"自己拼了一份归一化"',
      files: {
        [SOT]: SOT_OK,
        'server/src/leak.ts': "export const find = (email: string) => email.toLowerCase();\n",
      },
      wantRed: true,
      want: '自己拼了一份归一化',
    },
    {
      name: '臂 B trim().toLowerCase() 那种写法也抓 ⇒ 红（中间隔着一次调用）',
      files: {
        [SOT]: SOT_OK,
        'server/src/leak.ts': "export const hashInput = (email: string) => email.trim().toLowerCase();\n",
      },
      wantRed: true,
      want: '自己拼了一份归一化',
    },
    {
      name: '臂 C 局部又写一份 normalizeEmail ⇒ 红，理由是"第二份定义"',
      files: {
        [SOT]: SOT_OK,
        'server/src/otp.ts': "const normalizeEmail = (email: string): string => email.trim().toLowerCase();\nexport const n = normalizeEmail;\n",
      },
      wantRed: true,
      want: '第二份定义',
    },
    {
      name: '臂 D 全部走唯一实现 ⇒ 绿，且 SUMMARY 必须写 违规=0',
      files: { [SOT]: SOT_OK, 'server/src/clean.ts': CLEAN },
      wantRed: false,
      want: '违规=0',
    },
    {
      // 这一臂钉的是③：口径换了不会有任何一层报错，只有这条会。
      name: '臂 E 唯一实现的口径被换掉（少了 trim）⇒ 红，理由是"对外承诺"',
      files: {
        [SOT]: 'export function normalizeEmail(email: string): string {\n  return email.toLowerCase();\n}\n',
        'server/src/clean.ts': CLEAN,
      },
      wantRed: true,
      want: '对外承诺',
    },
    {
      name: '臂 F 注释里写着 email.toLowerCase() 不算违规 ⇒ 绿',
      files: {
        [SOT]: SOT_OK,
        'server/src/notes.ts':
          "// 这里原来是 email.toLowerCase()（不 trim），已收口到 normalizeEmail。\nexport const z = 1;\n",
      },
      wantRed: false,
      want: '违规=0',
    },
    {
      name: '臂 G 唯一实现那枚文件不在射程里 ⇒ 退 2 报探针，不是"全部合规"',
      files: { 'server/src/clean.ts': CLEAN },
      wantRed: true,
      want: '探针',
    },
    {
      // 这一臂钉的是**假缺陷那一侧**，而且是本门禁实测踩到过的一次：
      // `REQUIRE_EMAIL_VERIFICATION` 里含 "EMAIL"，但不是邮箱。
      // 没有这一臂，正则放宽成"名字里含 email"照样 7/7 全过 —— 判据就只剩"能红"一半。
      name: '臂 H 环境变量的名字里含 EMAIL 不算违规 ⇒ 绿',
      files: {
        [SOT]: SOT_OK,
        'server/src/config.ts':
          "const flag = process.env.REQUIRE_EMAIL_VERIFICATION.trim().toLowerCase();\nexport const f = flag === 'true';\n",
      },
      wantRed: false,
      want: '违规=0',
    },
  ];

  let fail = 0;
  for (const fx of fixtures) {
    rmSync(dir, { recursive: true, force: true });
    for (const [rel, content] of Object.entries(fx.files)) {
      const abs = join(dir, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content);
    }
    const kid = spawnSync(
      process.execPath,
      [join(process.cwd(), 'scripts/check-email-normalization.mjs'), '--root', dir],
      { encoding: 'utf8', cwd: process.cwd() },
    );
    const out = `${kid.stdout ?? ''}${kid.stderr ?? ''}`;
    const red = kid.status !== 0;
    const hasReason = fx.want === null || out.includes(fx.want);
    const ok = red === fx.wantRed && hasReason;
    console.log(`${fx.name}：${ok ? 'OK' : 'FAIL'}（red=${String(red)} want=${String(fx.wantRed)} 理由在场=${String(hasReason)}）`);
    if (!ok) console.log(out.split('\n').slice(0, 6).join('\n'));
    fail += ok ? 0 : 1;
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`ARMS=${String(fixtures.length)} FAIL=${String(fail)}`);
  process.exit(fail === 0 ? 0 : 1);
}

process.exit(main());
