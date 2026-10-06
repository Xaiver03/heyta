// #89 长期落点：扫"这一趟真会跑的 shell"里那类 `$VAR` 紧跟全角字符的写法（§7 第 64 条那一族）。
//
// 🔴 判定**不自己推**：复用常驻门 `scripts/check-shell-unicode-vars.mjs` 导出的同一个 `findOffenders`。
// 我之前自己推的那版对 7 个文件全报 0 —— 没有阳性对照就不该信那个 0。
// 所以这里先跑控制串：扫不出已知违规 ⇒ 直接判"探针坏了"并退 1，下面的 0 一概不算证据。
//
// 用法：
//   node research/tools/scan-runpath-vars.mjs                 # 扫默认分母（现量枚举出来的那批）
//   node research/tools/scan-runpath-vars.mjs <file> <file>…  # 只扫你给的（"谁下次真要跑那枚，起跑前扫它自己"）
// 退出码：0 = 干净；1 = 扫到违规**或**探针失效；2 = 分母为空（没东西可扫不等于扫过了）。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findOffenders } from '../../scripts/check-shell-unicode-vars.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CONTROL = 'ARM=x\necho "载具：$ARM）"\n';
const controlHits = findOffenders(CONTROL);
console.log(`CONTROL 已知违规串 ⇒ 扫到 ${String(controlHits.length)} 处（要 ≥1）`);
if (controlHits.length < 1) {
  console.log('PROBE=DEAD（同一套判定读不出这条已知写法 ⇒ 后面的 0 全不算数）');
  process.exit(1);
}

const args = process.argv.slice(2);
let files = args;
if (args.length === 0) {
  // 分母**现量枚举**，不写死文件名：写死的名单会在目标文件被删/改名时安静地扫不到东西（§7 第 191 条）。
  files = [
    join(ROOT, 'scripts/lib/mobile-e2e.sh'),
    ...readdirSync(join(ROOT, 'scripts'))
      .filter((f) => f.startsWith('verify-mobile-') && f.endsWith('.sh'))
      .map((f) => join(ROOT, 'scripts', f)),
  ].filter((f) => f.startsWith(ROOT));
}

if (files.length === 0) {
  console.log('DENOMINATOR=EMPTY（一条都没扫 ≠ 扫过了）');
  process.exit(2);
}

let total = 0;
for (const abs of files) {
  const rel = abs.startsWith(ROOT) ? abs.slice(ROOT.length + 1) : abs;
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    console.log(`读不到 ${rel} —— 分母里点名的文件不存在，这**不是**"这一枚干净"`);
    process.exit(2);
  }
  const offenders = findOffenders(text);
  total += offenders.length;
  console.log(`${String(offenders.length).padStart(3)} 处  ${rel}`);
  for (const x of offenders) console.log(`      :${String(x.line)}  ${x.snippet.slice(0, 100)}`);
}

console.log(`分母=${String(files.length)} 个文件  TOTAL=${String(total)}  CONTROL=${String(controlHits.length)}`);
process.exit(total === 0 ? 0 : 1);
