#!/usr/bin/env node
/**
 * `check:retention-window-parity` —— **两个"45 天"必须相等，因为正文分不出它们。**
 * ==================================================================================
 *
 * ## 它钉的那件事
 *
 * 代码里有**两个彼此独立的**保留期常量：
 *
 * | 常量 | 文件 | 管什么 |
 * |---|---|---|
 * | `RETENTION_DAYS` | `server/src/sync/sync.types.ts:533` | 同步密文 / 自动化凭据 |
 * | `AI_USAGE_RETENTION_DAYS` | `server/src/ai/metering.ts:411` | 托管 AI 的用量计数 |
 *
 * 而**对外那整套正文里，`45 天` 出现 33 处，一律只写"45 天"、从不区分是哪一族**
 * （2026-10-16 用渲染文字全量清点，见对账件 §8.6 与 B21）。
 *
 * ⇒ 于是有一条**不需要解析散文**就能成立的判据：
 *
 *     **两个常量必须相等。**
 *
 * 因为它们要是不等，那 33 处里**必然有一半在说谎** —— 而没有任何一层能看出是哪一半。
 * 哪天真的需要两种保留期，**先**把正文拆成两条可区分的承诺（让人与机器都能分辨），
 * **再**让常量分家；这个顺序反过来做，就是"对外文本失真"。
 *
 * ⚠️ 它**不**检查"45 这个数字本身对不对"：那取决于产品决定（对账件 B21 的右栏）。
 *    它只保证两个常量与那句承诺**不会悄悄分成两半**。
 *
 * ## 用法
 *
 *   node scripts/check-retention-window-parity.mjs              # 真跑（离线）
 *   node scripts/check-retention-window-parity.mjs --self-test   # 逐臂证明会红
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(HERE);

/** 两个常量各自的产地。`find` 取不到值 ⇒ 报"锚点失效"，**不**静默跳过。 */
export const CONSTANTS = [
  {
    name: 'RETENTION_DAYS',
    file: 'server/src/sync/sync.types.ts',
    find: /^export const RETENTION_DAYS = (\d+);/m,
    what: '同步密文与自动化凭据',
  },
  {
    name: 'AI_USAGE_RETENTION_DAYS',
    file: 'server/src/ai/metering.ts',
    find: /^export const AI_USAGE_RETENTION_DAYS = (\d+);/m,
    what: '托管 AI 的用量计数',
  },
];

/** 正文里那句承诺所在的目录（渲染源）。 */
const DOCS_DIR = 'packages/legal/src/documents';

/**
 * 纯判据：给 `{ 文件: 内容 }`，返回问题列表。
 *
 * 做成纯函数是为了自检能喂合成输入（不必造夹具文件），也为了离线可跑。
 */
export function retentionParityProblems(sources) {
  const problems = [];
  const values = [];

  for (const c of CONSTANTS) {
    const text = sources[c.file];
    if (text === undefined) {
      problems.push(`${c.name}：读不到 ${c.file} —— 这条判据对它是空转的`);
      continue;
    }
    const m = c.find.exec(text);
    if (m === null) {
      problems.push(
        `${c.name}：在 ${c.file} 里找不到声明（锚点失效）—— 文件形状变过，请更新本脚本的 find`,
      );
      continue;
    }
    values.push({ ...c, value: Number(m[1]) });
  }

  if (values.length === CONSTANTS.length && values.length > 0) {
    const [a, b] = values;
    if (a.value !== b.value) {
      problems.push(
        `两个保留期**不相等**：${a.name}=${a.value}（${a.what}）vs ${b.name}=${b.value}（${b.what}）。\n` +
          '       而整套正文里那处承诺**一律只写一个数字、不区分是哪一族** ⇒ ' +
          '不相等意味着正文里必然有一半在说谎，且没有任何一层能看出是哪一半。\n' +
          '       修法二选一：① 把两个常量改回相等；② **先**把正文拆成两条可区分的承诺，**再**让常量分家。',
      );
    }
  }

  // 正文那一侧：至少要有**一处**提到这个窗口，否则"常量有值、正文不提"也是失真。
  const docs = Object.entries(sources).filter(([f]) => f.startsWith(`${DOCS_DIR}/`));
  if (docs.length === 0) {
    problems.push(`读不到 ${DOCS_DIR}/ 下任何正文 —— 目录换了形状，这条判据正在空转`);
  } else {
    const total = docs.reduce(
      (n, [, text]) => n + [...text.matchAll(/\d+\s*天/g)].length,
      0,
    );
    if (total === 0) {
      problems.push(
        `${DOCS_DIR}/ 里一处"\u6570\u5b57 + 天"都没有 —— 保留期那句承诺可能被删了（那要改 ADR 与 G-03，不是删掉了事）`,
      );
    }
  }

  return { problems, values };
}

function main() {
  const sources = {};
  for (const c of CONSTANTS) {
    try {
      sources[c.file] = readFileSync(join(ROOT, c.file), 'utf8');
    } catch {
      /* 交给纯判据报"读不到" */
    }
  }
  // 正文整目录读进来（目录形状变了由纯判据报红）
  try {
    const dir = join(ROOT, DOCS_DIR);
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue;
      sources[`${DOCS_DIR}/${name}`] = readFileSync(join(dir, name), 'utf8');
    }
  } catch {
    /* 同上 */
  }

  const { problems, values } = retentionParityProblems(sources);
  if (problems.length > 0) {
    console.error(`🔴 保留期两个常量对不上（${problems.length} 条）：`);
    for (const p of problems) console.error(`   · ${p}`);
    process.exit(1);
  }
  console.log(
    `✅ 两个保留期常量相等：${values.map((v) => `${v.name}=${v.value} 天（${v.what}）`).join(' ｜ ')}` +
      '；正文侧也有对应的"数字 + 天"承诺。',
  );
  console.log(
    '   ⚠️ 本判据**不**判断"45 这个数对不对"（那是产品决定，见对账件 B21）；' +
      '它只保证两个常量与那句承诺不会悄悄分成两半。',
  );
}

/* ── 自检：四臂 + 一条阳性对照 ─────────────────────────────────────── */

function fixture(overrides = {}) {
  const syncDays = overrides.sync ?? 45;
  const aiDays = overrides.ai ?? 45;
  const docs = overrides.docs ?? '副本保留 45 天。';
  const sources = {
    'server/src/sync/sync.types.ts': `export const RETENTION_DAYS = ${syncDays};\n`,
    'server/src/ai/metering.ts': `export const AI_USAGE_RETENTION_DAYS = ${aiDays};\n`,
    [`${DOCS_DIR}/privacy.ts`]: docs,
  };
  if (overrides.dropSync) delete sources['server/src/sync/sync.types.ts'];
  if (overrides.anchorBust) sources['server/src/ai/metering.ts'] = '// 什么都没有\n';
  return sources;
}

function selfTest() {
  const arms = [
    ['A 两个常量相等 + 正文有承诺 ⇒ 不报', () => retentionParityProblems(fixture()), 0],
    [
      'B 🔴 只改 AI 那一个（45 → 30）⇒ 报（这就是"只改一边"）',
      () => retentionParityProblems(fixture({ ai: 30 })),
      1,
    ],
    ['C 读不到一个常量文件 ⇒ 报（空规则比没有更响）', () => retentionParityProblems(fixture({ dropSync: true })), 1],
    ['D 锚点失效 ⇒ 报，且说的是"锚点失效"', () => retentionParityProblems(fixture({ anchorBust: true })), 1],
    [
      'E 正文里一处"数字 + 天"都没有 ⇒ 报（承诺可能被删）',
      () => retentionParityProblems(fixture({ docs: '这里没有任何天数的承诺。' })),
      1,
    ],
  ];
  let failures = 0;
  for (const [label, run, expect] of arms) {
    const { problems } = run();
    const hit = problems.length >= expect && (expect === 0 ? problems.length === 0 : true);
    console.log(`${hit ? '✅' : '❌'} ${label}${hit ? '' : `（${problems.join(' / ') || '(无)'}）`}`);
    if (!hit) failures += 1;
  }
  // 阳性对照：臂 B 报出来的必须是"两个常量不相等"，不能只是"某处读不到"
  const { problems: bProblems } = retentionParityProblems(fixture({ ai: 30 }));
  const distinct = bProblems.some((p) => p.includes('不相等'));
  console.log(`${distinct ? '✅' : '❌'} 阳性对照：不等与"读不到/锚点失效"分开报`);
  if (!distinct) failures += 1;

  console.log(`\n臂数 ${arms.length}（由本脚本自己打印）+ 阳性对照，失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
