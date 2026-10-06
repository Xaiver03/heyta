/**
 * 裸「N 号」规则的变异验证 —— 逐层摘掉守卫，看**哪一层挡点**转红。
 *
 * 存在理由：这条规则的判据不是"能不能解析出日期"，而是"三层挡点各挡各的"。
 * 只有把某一层单独摘掉、确认**恰好那一层的反例**转红，才知道判据没有互相兜底。
 * 实测记录写在 `docs/plans/ai-assistant-closure.md` §7.2（含 M1 那一条：
 * 范围 1..31 摘掉后 0 红 ⇒ 它不承重，注释已按实测改成"早退"）。
 *
 * 用法（任意目录）：`node packages/domain/tests/mutate-capture-day-rule.mjs`
 * 只改 `capture.ts`，每步用完立刻还原并逐字节校验；跑挂也会还原（finally）。
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, '../src/capture.ts');

const MUTATIONS = [
  {
    name: 'M1 范围 1..31 整段摘掉',
    from: `      const day = Number(m[1]);
      if (!Number.isInteger(day) || day < DAY_OF_MONTH_MIN || day > DAY_OF_MONTH_MAX) {
        return undefined;
      }
`,
    to: `      const day = Number(m[1]);
`,
    expectRed: false,
    note: '预期 0 红 —— 这一层不承重（日期存在性由 makeLocalDate 判）。',
  },
  {
    name: 'M2 后缀黑名单摘掉（号X ⇒ 号楼/号电池/会议室）',
    from: 'if (DAY_NUMBER_LABEL_BEFORE.has(before) || DAY_NUMBER_LABEL_AFTER.has(after)) {',
    to: 'if (DAY_NUMBER_LABEL_BEFORE.has(before)) {',
    expectRed: true,
  },
  {
    name: 'M3 前缀黑名单摘掉（X号 ⇒ 房间 8 号/单元 8 号/第 5 号）',
    from: 'if (DAY_NUMBER_LABEL_BEFORE.has(before) || DAY_NUMBER_LABEL_AFTER.has(after)) {',
    to: 'if (DAY_NUMBER_LABEL_AFTER.has(after)) {',
    expectRed: true,
  },
  {
    name: 'M4 双侧非数字边界摘掉',
    from: '      if (isDigit(before) || isDigit(after)) return undefined;\n',
    to: '',
    expectRed: true,
  },
  {
    name: 'M5 「不早于今天」改成「严格晚于今天」',
    from: 'if (candidate !== undefined && candidate >= ctx.today) {',
    to: 'if (candidate !== undefined && candidate > ctx.today) {',
    expectRed: true,
  },
  {
    name: 'M6 往后找改成只看本月',
    from: 'for (let step = 0; step < 12; step += 1) {',
    to: 'for (let step = 0; step < 1; step += 1) {',
    expectRed: true,
  },
];

const backup = mkdtempSync('mutate-capture-');
const BAK = join(backup, 'capture.ts');
copyFileSync(FILE, BAK);
const ORIGINAL = readFileSync(FILE, 'utf8');

let violations = 0;
try {
  for (const mut of MUTATIONS) {
    const hits = ORIGINAL.split(mut.from).length - 1;
    if (hits !== 1) {
      console.log(`${mut.name}\n  锚点命中 ${hits}（必须是 1）⇒ 本条读数无效，先修脚本`);
      violations += 1;
      continue;
    }
    writeFileSync(FILE, ORIGINAL.replace(mut.from, mut.to));
    let out = '';
    let code = 0;
    try {
      out = execFileSync('npx', ['vitest', 'run', 'tests/capture.spec.ts'], {
        cwd: resolve(HERE, '..'),
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      out = `${String(e.stdout ?? '')}${String(e.stderr ?? '')}${String(e.message ?? '')}`;
      code = typeof e.status === 'number' ? e.status : 1;
    }
    copyFileSync(BAK, FILE);
    if (readFileSync(FILE, 'utf8') !== ORIGINAL) throw new Error('还原失败：capture.ts 与原文不一致');

    const failed = [...new Set([...out.matchAll(/^\s*FAIL\s+\S+\s+>\s+(.+)$/gm)].map((x) => x[1].trim()))];
    const red = code !== 0 || failed.length > 0;
    const ok = red === mut.expectRed;
    if (!ok) violations += 1;
    console.log(
      `${ok ? '✅' : '❌'} ${mut.name}\n   rc=${code} 失败用例=${failed.length} 预期${mut.expectRed ? '红' : '绿'}` +
        (mut.note ? `\n   ${mut.note}` : '') +
        (failed.length ? `\n   ${failed.join('\n   ')}` : ''),
    );
  }
} finally {
  copyFileSync(BAK, FILE);
  rmSync(backup, { recursive: true, force: true });
}

const restored = readFileSync(FILE, 'utf8') === ORIGINAL;
console.log(`\n还原=${restored ? 'OK（逐字节一致）' : 'FAILED'} 变异门不符预期=${violations}`);
process.exit(restored && violations === 0 ? 0 : 1);
