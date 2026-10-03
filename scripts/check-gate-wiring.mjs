#!/usr/bin/env node
/**
 * `check` 链自身的对账门禁：**定义过的门禁必须真的在链里跑**。
 * ==============================================================================
 *
 * ## 为什么需要它（不是顺手加的）
 *
 * `pnpm check` 是一串 `&&`。把其中一段删掉，链子照样 `exit 0` —— 掉出去的那道门禁
 * 不会失败，它只是**不再被跑**。2026-10-03 合并 `main` 时，唯一的冲突文件就是
 * `package.json`，而两侧的差异**全部是各自往链里加门禁**；当时靠一条手跑的
 * `grep -c '"<gate>"' package.json` 循环核对"六个名字都还在"。
 *
 * 🔴 那条 grep 是**弱判据**：命中 `"check:image-license"` 带引号的那个形状，只可能是
 * **定义那一行**（链里是 `pnpm check:image-license`，不带引号）。也就是说它证明的
 * 是"定义还在"，而风险形态是"定义在、链里没有"。它恰好抓不到它要抓的东西。
 *
 * 同族先例：§7 第 57 条（`check` 曾经不跑任何单元测试）、第 88 条（plumbing 静默丢内容）。
 *
 * ## 用法
 *
 * ```sh
 * pnpm check:gate-wiring              # 正常跑
 * node scripts/check-gate-wiring.mjs --pkg <path>   # 拿一份候选 package.json 试（注入验证用，不动工作树）
 * ```
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const argv = process.argv.slice(2);
let pkgPath = join(ROOT, 'package.json');
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--pkg') {
    pkgPath = resolve(argv[i + 1] ?? '');
    i += 1;
  }
}

/**
 * 链里**允许**不出现的 `check:*` 定义。每条都要写清"为什么不进链"，
 * 而且它必须仍然是一个真实存在的定义 —— 门禁拿掉了但这里还留着，同样判红。
 */
const ALLOWED_OUTSIDE_CHAIN = new Map([
  [
    'check:web-artifact:app',
    '它读的是 `--base=/app/` 那份产物，而 `pnpm build` 打的是默认根路径那份 —— 进链就是拿错的产物去验对的东西。' +
      '⚠️ 已知缺口：目前**没有任何自动载体**跑它（脚本头部写的用法是"打进服务端镜像 / rsync 上线前"手动跑）。',
  ],
]);

/** 链必须包含的锚点：掉哪一个都是"整条链不再检查一件事"级别的事故。 */
const REQUIRED_ANCHORS = [
  // §7 第 57 条：这道曾经整条不在链里，于是 apps/web 的测试红了很久都没有任何东西失败。
  'pnpm -r test',
  // packages/*/dist 是各端打包输入，不先 build 就是在验旧产物（§7 第 27 条）。
  'pnpm build',
];

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const chainRaw = pkg.scripts?.check;
if (typeof chainRaw !== 'string' || chainRaw.length === 0) {
  console.error('🔴 package.json 里没有 scripts.check —— 门禁链本身不见了');
  process.exit(1);
}

const chain = chainRaw
  .split('&&')
  .map((part) => part.trim())
  .filter((part) => part.length > 0);

/** `pnpm [--filter X] [--dir X] <脚本名>` → 脚本名；`pnpm -r test` → 整串。 */
function referencedName(cmd) {
  if (!cmd.startsWith('pnpm ')) return null;
  const tokens = cmd.slice('pnpm '.length).split(/\s+/);
  let i = 0;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    // --filter / --dir 带一个值参数，-r 之类不带
    if (tokens[i] === '--filter' || tokens[i] === '--dir') i += 2;
    else i += 1;
  }
  const name = tokens[i];
  if (!name) return null;
  return name.startsWith('-') ? cmd : name;
}

const inChain = new Set();
for (const cmd of chain) {
  const name = referencedName(cmd);
  if (name) inChain.add(name);
}

const defs = Object.keys(pkg.scripts ?? {}).filter((k) => k.startsWith('check:'));

const failures = [];

// 1) 每一道 check:* 定义：要么在链里，要么在允许表里
for (const name of defs) {
  if (inChain.has(name) || inChain.has(`check:${name}`)) continue;
  if (!ALLOWED_OUTSIDE_CHAIN.has(name)) {
    failures.push(
      `${name}: 定义还在，但**不在这次的 check 链里** —— 它不会再被跑，而链子照样绿。` +
        '要么把它加回链，要么进允许表并写明理由。',
    );
  }
}

// 2) 允许表不能比现实宽
for (const name of ALLOWED_OUTSIDE_CHAIN.keys()) {
  if (!(name in (pkg.scripts ?? {}))) {
    failures.push(`${name}: 允许表说它是一道"链外门禁"，但 package.json 里已经没有这个定义了。`);
  }
  if (inChain.has(name)) {
    failures.push(`${name}: 它已经回到链里了，允许表里那条理由该删 —— 留着就是在掩护下一道。`);
  }
}

// 3) 链里引用的脚本名必须有定义（拼错或定义被摘掉 ⇒ 后面整串都不跑）
const chainTokens = [];
for (const cmd of chain) {
  const name = referencedName(cmd);
  if (name && !name.startsWith('-')) chainTokens.push(name);
}
for (const name of chainTokens) {
  if (!(name in (pkg.scripts ?? {}))) {
    failures.push(`链里引用了 pnpm ${name}，但 package.json 里没有这个脚本定义。`);
  }
}

// 4) 锚点：`pnpm -r test` / `pnpm build` 必须逐字在链里
for (const anchor of REQUIRED_ANCHORS) {
  if (!chain.includes(anchor)) {
    failures.push(`链里少了锚点 \`${anchor}\`。`);
  }
}

const outside = defs.filter((n) => !inChain.has(n));
console.log(
  `门禁定义 ${defs.length} 道 ｜ 链里被引用 ${chainTokens.length} 段 ｜ 链外 ${outside.length} 道（允许表 ${ALLOWED_OUTSIDE_CHAIN.size} 道）`,
);

if (failures.length > 0) {
  for (const f of failures) console.error('🔴 ' + f);
  console.error(`\n共 ${failures.length} 处。`);
  process.exit(1);
}

console.log('✅ check 链与门禁定义对上了（含"链外门禁"逐条有理由、锚点在场）');
