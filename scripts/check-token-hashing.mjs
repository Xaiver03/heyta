#!/usr/bin/env node
/**
 * 签名令牌的**落库形态**门禁。
 *
 * ## 为什么需要它
 *
 * `server/prisma/schema.prisma` 里那四列（`verificationToken` / `resetPasswordToken` /
 * `passkeyRecoveryToken` / `loginToken`）以及 `PendingPasskeyRegistration.verificationToken`
 * 从 20261005000000 起存的是**令牌的 SHA-256**，不是发进邮件的那句话
 * （理由与"为什么不是 Argon2"见 `server/src/auth-tokens.ts`）。
 *
 * 这件事的坏法**不是报错**：写进去明文、按哈希查 ⇒ 注册和验证都还能跑通
 * （只要两边忘了的程度一致），而库里躺着一批**拿到就能用**的登录凭证。
 * 数据库比应用容易泄露得多（备份、只读副本、误提交的导出），所以那是一批
 * 还在有效期内的链接，不是一个抽象风险。
 *
 * 类型系统对此**完全无能为力** —— 明文和哈希都是 `string`。
 * 所以这条只能靠形状检查。
 *
 * ## 规则
 *
 * 1. 给这些列赋值时，值必须是 `hashToken(…)`、`null`，或一个**名字以 `Hash` 结尾**的变量
 *    （见规则 3：为什么允许变量）。
 * 2. 不许用对象简写（`{ verificationToken, }`）—— 简写只能是原始值，正是这一刀要拦的形状。
 * 3. 走规则 1 变量豁免的名字，必须在**同一个文件里**存在
 *    `const <名字> = … hashToken(…)`。豁免只对**确实被赋成哈希**的变量生效。
 *    ⚠️ 这条刻意只在"被用作令牌列的值"的变量上核对，**不是**全局命名规则 ——
 *    `…Hash` 这个后缀在口令那一侧早就被占用了（`passwordHash`、`msPerHash`），
 *    全局规则会让这条门禁一上线就是一片假红，而假红的门禁的下场是被关掉。
 *
 * ⚠️ 为什么拦不住的东西也要说清楚：**形态检查区分不了明文和哈希** ——
 * `randomBytes(32).toString('hex')` 与 SHA-256 的 hex 都是 64 个 `[0-9a-f]`。
 * 所以这里查的是**写法**，"存进去的确实是那个令牌的哈希"由
 * `server/tests/magic-link-registration.spec.ts` 与 `server/tests/passkey.spec.ts`
 * 里那两条"两个出口对照"的断言负责。两者缺一，这一刀就只落了一半。
 *
 * 用法：node scripts/check-token-hashing.mjs [--verbose]
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIR = join(ROOT, 'server', 'src');
const verbose = process.argv.includes('--verbose');

/** 这些列存 SHA-256，不存原文。 */
const TOKEN_COLUMNS = [
  'verificationToken',
  'resetPasswordToken',
  'passkeyRecoveryToken',
  'loginToken',
];

if (!existsSync(SCAN_DIR)) {
  console.error(`找不到扫描目录：${relative(ROOT, SCAN_DIR)}`);
  process.exit(1);
}

const tsFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    // 生成物不参与（它们不含令牌列，但万一含也不该由这条去管）。
    if (entry.endsWith('.generated.ts')) continue;
    if (entry.endsWith('.ts')) tsFiles.push(full);
  }
};
walk(SCAN_DIR);

const violations = [];
let hits = 0;

/**
 * 规则 1 放行的**变量写法**收集在这里，等整个文件读完再核对（规则 3）。
 * 形如 `file -> Set<变量名>`。
 */
const variableValues = new Map();

for (const file of tsFiles) {
  const rel = relative(ROOT, file);
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  variableValues.set(rel, new Set());

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // 注释里出现列名是常态（schema 说明、错误消息），只检查代码。
    // 注意：这里按**整行**粗判，所以一条违规写在多行注释里会被放过 ——
    // 可接受，因为代码那一侧是全覆盖的。
    const isComment =
      trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
    if (isComment) return;

    for (const column of TOKEN_COLUMNS) {
      // 规则 2：对象简写
      if (new RegExp(`^${column},?$`).test(trimmed)) {
        hits++;
        violations.push({
          at: `${rel}:${index + 1}`,
          msg:
            `令牌列 \`${column}\` 用**对象简写**直接落库 —— 简写只能是原始值。\n` +
            `         写 ${column}: hashToken(${column}) 才对。`,
        });
        continue;
      }

      // 规则 1：`column: <值>`（`verificationTokenExpiresAt:` 不会命中，因为要求紧跟冒号）
      const assign = new RegExp(`\\b${column}:\\s*([^,;)}\\]]+)`, 'g');
      for (const match of line.matchAll(assign)) {
        hits++;
        const value = match[1].trim();
        if (value === 'null' || value.startsWith('hashToken(')) continue;
        const variable = value.match(/^([A-Za-z_$][\w$]*Hash)$/);
        if (variable) {
          // 变量写法**暂记**，由规则 3 在这个文件里核对它真的来自 hashToken()。
          variableValues.get(rel).add(variable[1]);
          continue;
        }
        violations.push({
          at: `${rel}:${index + 1}`,
          msg:
            `令牌列 \`${column}\` 被赋成**非哈希**的值：\`${value}\`\n` +
            `         允许写法只有 hashToken(…) / null / 名字以 Hash 结尾且确实来自 hashToken() 的变量。`,
        });
      }
    }
  });

  // 规则 3：以 `Hash` 结尾的变量豁免**必须**能被核对上。
  // 为什么不做成全局的"任何 xxxHash 变量都要来自 hashToken("：那个命名在口令那一侧
  // 早就被占用了（`passwordHash`、`msPerHash`），全局规则会把这条门禁变成一片假红，
  // 而假红的门禁的下场是被关掉 —— 那比没有门禁更糟。
  for (const name of variableValues.get(rel)) {
    hits++;
    const declared = new RegExp(`\\b(?:const|let)\\s+${name}\\s*=\\s*[^;]*hashToken\\(`);
    if (!declared.test(source)) {
      violations.push({
        at: rel,
        msg:
          `\`${name}\` 被当成令牌列的值，但这个文件里没有任何 \`const ${name} = …hashToken(…)\`。\n` +
          `         变量豁免只对**确实是哈希**的变量生效，否则它就是一个开后门的洞。`,
      });
    }
  }
}

// 汇总输出必须带**总数**：只打印违规、不打印"扫了多少处、多少个文件"，
// 就没法区分"检查通过"和"检查没看到任何代码"（AGENTS §7 第 90 条同族）。
console.log(
  `扫描 ${tsFiles.length} 个文件，命中 ${hits} 处令牌列读写（${TOKEN_COLUMNS.join(' / ')}）。`,
);

if (violations.length > 0) {
  console.error(`\n❌ ${violations.length} 处签名令牌没有按 SHA-256 落库：\n`);
  for (const v of violations) {
    console.error(`  ${v.at}\n         ${v.msg}\n`);
  }
  process.exit(1);
}

if (verbose) console.log('✅ 全部令牌列读写都过 hashToken()。');
console.log('✅ 签名令牌落库形态检查通过。');
