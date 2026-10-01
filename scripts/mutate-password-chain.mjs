#!/usr/bin/env node
/**
 * `verify-email-password-chain` 判据的变异验证（W9）
 * ==================================================
 *
 * 用法：`node scripts/mutate-password-chain.mjs`（**串行**跑，一轮约 15 分钟）
 *
 * ## 为什么这条链特别需要它
 *
 * 真链路的判据都是"跑到底才看得见"的那种：把同意闸门删掉，终端照样得到一句错误
 * （只是那次错误**已经出门了**）；把"已验证账号提前 return"改掉，注册照样成功
 * （只是活账号的口令被覆盖了）。**没有一条会在单元测试之外自己报错** ——
 * 而这条链存在的理由恰恰是"三层假 fetch 验收都没看见半路上掉的东西"。
 *
 * ## 判"抓到"的标准比基线脚本更严
 *
 * 只要求"整条链变红"是不够的：一个改坏了注册路由的变异会让**后面每一格**都红，
 * 那不能证明某一条具体判据在挡东西。所以每条变异都写明**必须看到哪几格的 ❌**，
 * 抓错地方算漏。
 *
 *   M1 CLI 的 `--terms` 闸门变成死分支 —— 没勾也照样发请求      → ①
 *   M2 已验证账号的注册**覆盖** password_hash（A2 假成功变真覆盖）→ ⑩
 *   M3 登录不再检查邮箱验证（任何人用邮箱领走账号）              → ④
 *   M4 "这个账号没设口令"单独成一句（口令路成了枚举预言机）        → ⑦
 *
 * ⚠️ 只碰这三个文件的字节，每条变异跑完立刻按原文写回并校验 sha256。
 *    写回**之前**会再读一次：如果这期间有别的进程改过它，就停下报错，
 *    而不是拿我这一轮的副本覆盖掉别人的编辑（共享工作树）。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_AUTH = join(ROOT, 'server/src/auth.ts');
const PASSWORD_SERVICE = join(ROOT, 'server/src/password/service.ts');
const CLI_AUTH = join(ROOT, 'apps/node-host/src/cli-auth.ts');

const MUTATIONS = [
  {
    name: 'M1 `--terms` 闸门变成死分支（没勾也把请求发出去）',
    file: CLI_AUTH,
    from: "  if (sub === 'register' && !parsed.bools.has('terms')) {",
    to: "  if (false && sub === 'register' && !parsed.bools.has('terms')) {",
    expect: ['①'],
  },
  {
    name: 'M2 对已验证账号的注册覆盖 password_hash（A2 的"假成功"变成真覆盖）',
    file: SERVER_AUTH,
    from:
      '  if (existingUser?.isVerified === 1) {\n' +
      '    return { message: REGISTRATION_SUCCESS_MESSAGE };\n' +
      '  }',
    to:
      '  if (existingUser?.isVerified === 1) {\n' +
      '    await prisma.user.update({\n' +
      '      where: { id: existingUser.id },\n' +
      '      data: { passwordHash: passwordHash ?? null },\n' +
      '    });\n' +
      '    return { message: REGISTRATION_SUCCESS_MESSAGE };\n' +
      '  }',
    expect: ['⑩'],
  },
  {
    name: 'M3 登录不再要求邮箱已验证（跳过那封信就能领走账号）',
    file: PASSWORD_SERVICE,
    from: '  if (user.isVerified === 0) {',
    to: '  if (user.isVerified === 0 && false) {',
    expect: ['④'],
  },
  {
    name: 'M4 "这个账号没设口令"单独成一句（口令这条路变成枚举预言机）',
    file: PASSWORD_SERVICE,
    from:
      '  if (!user.passwordHash) {\n' +
      '    await withHashSlot(() => dummyVerify(normalized));\n' +
      '    throw invalid;\n' +
      '  }',
    to:
      '  if (!user.passwordHash) {\n' +
      "    await withHashSlot(() => dummyVerify(normalized));\n" +
      "    throw new PasswordAuthError('no_password_set', PASSWORD_INVALID_CREDENTIALS_MESSAGE);\n" +
      '  }',
    expect: ['⑦'],
  },
];

const digest = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** 跑一轮真链路：返回退出码与该轮**变红的那几格**。 */
function runChain() {
  const r = spawnSync('node', [join(ROOT, 'scripts/verify-email-password-chain.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 900_000,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const reds = [...out.matchAll(/^\s*❌\s+([⓪①②③④⑤⑥⑦⑧⑨⑩⑪])/gm)].map((m) => m[1]);
  const bailed = /^\s*❌\s+(服务端没起来|没拿到 Ethereal|⑥ 没拿到令牌|CLI 根本没起来)/m.test(out);
  return { code: r.status ?? 1, reds: [...new Set(reds)], bailed, out };
}

const files = [SERVER_AUTH, PASSWORD_SERVICE, CLI_AUTH];
const originals = new Map(files.map((p) => [p, readFileSync(p, 'utf8')]));
const hashes = new Map(files.map((p) => [p, digest(p)]));

function restore(path, text, expectedMutatedDigest) {
  const now = digest(path);
  if (now !== expectedMutatedDigest) {
    console.error(
      `❌ ${path} 在这期间被**别的进程**改过（digest 与我写进去的那份不一致）。\n` +
        '   变异脚本停在这里，不覆盖那份编辑 —— 请确认没有并发写者后重跑。',
    );
    process.exit(1);
  }
  writeFileSync(path, text);
}

console.log('· 基线（未变异）：跑整条真链路…');
const baseline = runChain();
if (baseline.code !== 0 || baseline.reds.length > 0) {
  console.log(`❌ 基线就是红的（exit=${String(baseline.code)}，红格 ${baseline.reds.join(',') || '无'}）`);
  console.log('   ⇒ 先修链路本身，变异验证在这种状态下没有意义（它只会证明"什么都红"）。');
  console.log(baseline.out.split('\n').slice(-25).join('\n'));
  process.exit(1);
}
console.log('✅ 基线全绿。\n');

let allCaught = true;
for (const mutation of MUTATIONS) {
  const src = originals.get(mutation.file);
  const hits = src.split(mutation.from).length - 1;
  if (hits !== 1) {
    console.log(`⚠️  ${mutation.name}：锚点命中 ${String(hits)} 次 —— 变异没打上`);
    allCaught = false;
    continue;
  }
  const mutated = src.replace(mutation.from, mutation.to);
  writeFileSync(mutation.file, mutated);
  const mutatedDigest = digest(mutation.file);
  console.log(`· ${mutation.name}：跑一轮…`);
  const result = runChain();
  restore(mutation.file, src, mutatedDigest);

  const missing = mutation.expect.filter((mark) => !result.reds.includes(mark));
  const caught = result.code !== 0 && missing.length === 0;
  console.log(
    caught
      ? `✅ 抓到：${mutation.name} → 变红的格 ${result.reds.join(',') || '(整条提前 bail)'}`
      : `❌ 漏了：${mutation.name}\n` +
        `   要求看到 ${mutation.expect.join('/')} 变红，实际红的格：${result.reds.join(',') || '无'}` +
        `（exit=${String(result.code)}，提前中止=${String(result.bailed)}）`,
  );
  if (!caught) allCaught = false;
}

for (const [path, expected] of hashes) {
  if (digest(path) !== expected) {
    console.log(`❌ 还原失败：${path}`);
    process.exit(1);
  }
}
console.log(`\n✅ ${String(files.length)} 个文件字节级还原。`);
console.log(allCaught ? '✅ 四条变异都被**对应那一格**抓到。' : '❌ 有变异没被对应判据抓到。');
process.exit(allCaught ? 0 : 1);
