#!/usr/bin/env node
/**
 * 变异验证 @heyta/legal 的结构闸门：每一条判据都要在**故意做错**时变红。
 * 只改测试用的临时副本，跑完立刻还原（脚本自己有 finally，中途中断也会还原）。
 *
 * 用法：node packages/legal/tests/mutate-gate.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(PKG, 'src', 'documents');

/** 一次变异：文件、把什么换成什么、期望哪条测试变红。 */
const MUTATIONS = [
  {
    name: '删掉英文版一个段落（中英漂移）',
    file: join(DOCS, 'permissions.ts'),
    from: `      {
        kind: 'p',
        text: 'heyta does not request location, contacts, call log, SMS, photos, microphone, camera, health, or calendar write access, and does not read other apps\\' storage.',
      },
`,
    to: '',
    expectFail: '两版结构逐一对应',
  },
  {
    name: '把英文版一张表少写一行（结构对但范围缩水）',
    file: join(DOCS, 'permissions.ts'),
    from: `          [
            'Desktop shells (Windows / macOS / Linux)',
            '(none)',
            'Not applicable',
            '🔴 They run as ordinary desktop programs and do not use a store permission model',
            'Not applicable',
          ],
`,
    to: '',
    expectFail: '两版结构逐一对应',
  },
  {
    name: 'docRef 指向一份不存在的文件',
    file: join(DOCS, 'data-rights.ts'),
    from: `docId: 'personal-info-list'`,
    to: `docId: 'personal-info-ist'`,
    expectFail: 'docRef 指向的文件必须真的存在',
  },
  {
    name: '正文里的备案号换成一个别的号（漂移）',
    file: join(DOCS, 'privacy.ts'),
    from: '浙ICP备2026081423号',
    to: '浙ICP备2026999999号',
    expectFail: '每一个 ICP 编号都必须就是 OPERATOR 那一个',
  },
  {
    name: '落单反引号（渲染器会留下字面符号）',
    file: join(DOCS, 'permissions.ts'),
    from: `        text: 'heyta does not request location`,
    to: `        text: 'heyta \u0060 does not request location`,
    expectFail: '标记成对、无 HTML、无裸链接、无占位符',
  },
  {
    name: 'draft 文本被写了生效日期（宣布未生效文本已生效）',
    file: join(DOCS, 'permissions.ts'),
    from: `  status: 'draft',`,
    to: `  status: 'draft',
  effectiveDate: '2026-11-01',`,
    expectFail: '版本、日期、状态三者自洽',
  },
  {
    name: '正文里出现别人的名字（上游 AGB 的服务提供者）',
    file: join(DOCS, 'permissions.ts'),
    from: `        text: 'A "permission" is a gate`,
    to: `        text: 'Super Productivity. A "permission" is a gate`,
    expectFail: '正文里不出现 Super Productivity',
  },
];

function run() {
  try {
    const out = execFileSync('npx', ['vitest', 'run', '--reporter=verbose'], {
      cwd: PKG,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    return { failed: false, out };
  } catch (error) {
    return { failed: true, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

const baseline = run();
console.log(`基线：${baseline.failed ? '🔴 红（测试本来就没过，先修它）' : '✅ 全绿'}`);
if (baseline.failed) {
  console.log(baseline.out.slice(-3000));
  process.exit(1);
}

let bad = 0;
for (const mutation of MUTATIONS) {
  const original = readFileSync(mutation.file, 'utf8');
  if (!original.includes(mutation.from)) {
    console.log(`⚠️ 变异未生效（锚点没找到）：${mutation.name}`);
    bad += 1;
    continue;
  }
  try {
    writeFileSync(mutation.file, original.replace(mutation.from, mutation.to), 'utf8');
    const { failed, out } = run();
    const caught = failed && out.includes(mutation.expectFail);
    if (!caught) bad += 1;
    console.log(
      `${caught ? '✅ 抓到' : '🔴 没抓到'}：${mutation.name} → 期望「${mutation.expectFail}」红；实际 ${
        failed ? '有测试失败' : '全绿（这条变异逃过了闸门）'
      }`,
    );
  } finally {
    writeFileSync(mutation.file, original, 'utf8');
  }
}

const restored = run();
console.log(
  `还原后：${restored.failed ? '🔴 没还原干净（文件仍是改过的）' : '✅ 全绿，文件已还原'}`,
);
console.log(`\n结论：${bad === 0 ? `${MUTATIONS.length} 条变异全部被抓到` : `${bad}/${MUTATIONS.length} 条逃逸或未生效`}`);
process.exit(bad === 0 && !restored.failed ? 0 : 1);
