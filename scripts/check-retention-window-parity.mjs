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
 * ## 第三判据（2026-10-27 补，开工单 §3 A6）：自动收集正文那句"7 天"也有尺
 *
 * 上面那条只管**两个同数值的常量**。自动收集是**另一种形状**：一个代码常量
 * （`server/src/automation/inbound.routes.ts` 的 `RETENTION_MS`）与**它自己那篇协议文档里
 * 的一句承诺**（`docs/reference/inbound-automation-protocol.md`：输入/冻结结果密文 N 天）。
 * 这一族此前**一个字都没被对账** —— "7 天"这句只由代码常量维持，改常量不动文档、
 * 或改文档不动常量，两头都不会响。
 *
 * 判据是**取值相等 + 两个锚点都在**：锚点读不到同样判红，因为"这条尺正在空转"
 * 与"数字对不上"是同一类失真（拿一份没人核对的承诺对外说话）。
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

/** 自动收集那一族：代码常量 ↔ 它自己那篇协议文档里的那句承诺。 */
export const INBOUND_RETENTION = {
  code: {
    file: 'server/src/automation/inbound.routes.ts',
    find: /^const RETENTION_MS = (\d+) \* 24 \* 60 \* 60 \* 1000;/m,
    label: 'RETENTION_MS（落库时写进 expires_at 的那枚）',
  },
  doc: {
    file: 'docs/reference/inbound-automation-protocol.md',
    find: /输入\/冻结结果密文\s*(\d+)\s*天/,
    label: '协议文档里那句「输入/冻结结果密文 N 天」',
  },
};

/**
 * 纯判据：自动收集那一族。锚点缺失与取值不等**分开报**，
 * 因为修法不同（前者是尺在空转，后者是承诺失真）。
 */
export function inboundRetentionProblems(sources) {
  const problems = [];
  const found = {};
  for (const [side, anchor] of Object.entries(INBOUND_RETENTION)) {
    const text = sources[anchor.file];
    if (text === undefined) {
      problems.push(`自动收集保留期：读不到 ${anchor.file}（${anchor.label}）—— 这条判据对它是空转的`);
      continue;
    }
    const m = anchor.find.exec(text);
    if (m === null) {
      problems.push(
        `自动收集保留期：在 ${anchor.file} 里找不到 ${anchor.label} 的锚点 —— 文件或措辞改过形状，请更新本脚本，别删断言`,
      );
      continue;
    }
    found[side] = Number(m[1]);
  }
  if (found.code !== undefined && found.doc !== undefined && found.code !== found.doc) {
    problems.push(
      `自动收集保留期**不相等**：代码 RETENTION_MS=${found.code} 天 vs 协议文档写的 ${found.doc} 天。\n` +
        '       对外那句"7 天"是承诺，代码那枚是实际执行者 ⇒ 只改一头就是拿一份没人核对的文本对外说话。\n' +
        '       改哪一头要先过负责人：保留期本身是产品决定（协议文档第 217 行那句写明"未确认数值前禁止发布"）。',
    );
  }
  return { problems, values: found };
}

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

  // 第三判据：自动收集那一族（代码常量 ↔ 协议文档那句"输入/冻结结果密文 N 天"）
  problems.push(...inboundRetentionProblems(sources).problems);

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
  for (const anchor of Object.values(INBOUND_RETENTION)) {
    try {
      sources[anchor.file] = readFileSync(join(ROOT, anchor.file), 'utf8');
    } catch {
      /* 交给纯判据报"读不到" */
    }
  }

  const { problems, values } = retentionParityProblems(sources);
  const inbound = inboundRetentionProblems(sources).values;
  if (problems.length > 0) {
    console.error(`🔴 保留期对账不通过（${problems.length} 条）：`);
    for (const p of problems) console.error(`   · ${p}`);
    process.exit(1);
  }
  console.log(
    `✅ 两个保留期常量相等：${values.map((v) => `${v.name}=${v.value} 天（${v.what}）`).join(' ｜ ')}` +
      '；正文侧也有对应的"数字 + 天"承诺。',
  );
  console.log(
    `✅ 自动收集那一族也对上：代码 RETENTION_MS=${inbound.code} 天 ＝ 协议文档那句「输入/冻结结果密文 ${inbound.doc} 天」。`,
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
  const inboundCodeDays = overrides.inboundCode ?? 7;
  const inboundDocDays = overrides.inboundDoc ?? 7;
  const sources = {
    'server/src/sync/sync.types.ts': `export const RETENTION_DAYS = ${syncDays};\n`,
    'server/src/ai/metering.ts': `export const AI_USAGE_RETENTION_DAYS = ${aiDays};\n`,
    [`${DOCS_DIR}/privacy.ts`]: docs,
    [INBOUND_RETENTION.code.file]: `const RETENTION_MS = ${inboundCodeDays} * 24 * 60 * 60 * 1000;\n`,
    [INBOUND_RETENTION.doc.file]: `保留基线：输入/冻结结果密文 ${inboundDocDays} 天；\n`,
  };
  if (overrides.dropSync) delete sources['server/src/sync/sync.types.ts'];
  if (overrides.anchorBust) sources['server/src/ai/metering.ts'] = '// 什么都没有\n';
  if (overrides.dropInboundCode) delete sources[INBOUND_RETENTION.code.file];
  if (overrides.bustInboundDoc) sources[INBOUND_RETENTION.doc.file] = '保留基线：输入密文一周；\n';
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
    [
      'F 自动收集：代码 7 天、文档也 7 天 ⇒ 不报（阳性）',
      () => retentionParityProblems(fixture()),
      0,
    ],
    [
      'G 🔴 只改代码那枚（7 → 14）⇒ 报"自动收集保留期不相等"',
      () => retentionParityProblems(fixture({ inboundCode: 14 })),
      1,
    ],
    [
      'H 🔴 只改文档那句（7 → 30）⇒ 同样报（两头的失真对称）',
      () => retentionParityProblems(fixture({ inboundDoc: 30 })),
      1,
    ],
    [
      'I 读不到代码常量 / 文档措辞换成"一周" ⇒ 各报一条"锚点"，不静默通过',
      () => ({
        problems: [
          ...retentionParityProblems(fixture({ dropInboundCode: true })).problems,
          ...retentionParityProblems(fixture({ bustInboundDoc: true })).problems,
        ],
      }),
      2,
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
  // 同一条对照做到自动收集那一族（臂 G 与臂 I 报的话必须不是同一句）
  const { problems: gProblems } = retentionParityProblems(fixture({ inboundCode: 14 }));
  const gDistinct =
    gProblems.some((p) => p.includes('自动收集保留期**不相等**')) &&
    !gProblems.some((p) => p.includes('空转')) &&
    retentionParityProblems(fixture({ dropInboundCode: true })).problems.some((p) => p.includes('空转'));
  console.log(`${gDistinct ? '✅' : '❌'} 阳性对照：自动收集的"不等"与"锚点空转"分开报`);
  if (!gDistinct) failures += 1;

  console.log(`\n臂数 ${arms.length}（由本脚本自己打印）+ 阳性对照，失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
