/**
 * W0-4 spike（D2 路线）· 裁判：把**两台引擎**的报告逐条比对。
 *
 * 比对的是同一份 bundle 字节 + 同一份用例源码在两台引擎下的求值结果。
 * 只要有一条不一致，D2 就不成立（说明 bundle 的行为依赖引擎实现细节）。
 *
 * 用法：node compare.mjs <裸V8报告> <.NET报告>
 */

import { readFileSync } from 'node:fs';

const [, , BARE_PATH, CS_PATH] = process.argv;
if (!BARE_PATH || !CS_PATH) {
  throw new Error('用法：node compare.mjs <裸V8报告> <.NET报告>');
}

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const bare = load(BARE_PATH);
const cs = load(CS_PATH);

const problems = [];
const check = (label, a, b) => {
  if (a !== b) {
    problems.push(`${label} 不一致：裸 V8=${JSON.stringify(a)} / .NET=${JSON.stringify(b)}`);
  }
};
const checkEq = (label, a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    problems.push(`${label} 不一致：\n    裸 V8=${JSON.stringify(a)}\n    .NET =${JSON.stringify(b)}`);
  }
};

check('bundle 字节数', bare.bundleBytes, cs.bundleBytes);
check('导出数量', bare.exportCount, cs.exportCount);
check('用例数量', bare.caseCount, cs.caseCount);

const bareNames = Object.keys(bare.results).sort();
const csNames = Object.keys(cs.results).sort();
checkEq('用例名集合', bareNames, csNames);

for (const name of bareNames) {
  const a = bare.results[name];
  const b = cs.results[name];
  if (b === undefined) continue;
  check(`${name} · ok`, a.ok, b.ok);
  if (a.ok && b.ok) check(`${name} · 值`, a.value, b.value);
}

const okCount = bareNames.filter((n) => bare.results[n].ok && cs.results[n]?.ok).length;
const agreed = bareNames.filter(
  (n) => bare.results[n].ok && cs.results[n]?.ok && bare.results[n].value === cs.results[n].value,
).length;

console.log('╭─ W0-4 spike：两台引擎跑同一份 @heyta/domain bundle');
console.log(`│ bundle：${bare.bundleBytes} 字节（两侧读的是同一个文件）`);
console.log(`│ 导出：${bare.exportCount} 个符号`);
console.log(`│ 裸 V8：${bare.engine}`);
console.log(`│  .NET：${cs.engine}`);
console.log(`│ 用例：${bare.caseCount} 条，两侧都成功 ${okCount} 条，结果一致 ${agreed} 条`);
console.log(`│ 裸 V8 触碰宿主全局：${bare.forbiddenGlobalsTouched.length} 次`);
console.log('╰─');

if (problems.length > 0) {
  console.log(`\n🔴 不一致 ${problems.length} 处：`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exitCode = 1;
} else {
  console.log('\n✅ 两台引擎结果逐条一致 —— D2 路线在"同一份字节"这个意义上成立。');
}
