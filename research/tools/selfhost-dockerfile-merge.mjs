#!/usr/bin/env node
/**
 * `research/tools/selfhost-dockerfile-merge.mjs` —— 载体**第九族**（`server/Dockerfile`）的解法与判据。
 *
 * 这一族 2026-10-04 23:0x 现量出现：main 与本批**在同一个 RUN 块里各修了同一个缺陷**
 * （`b3397cda` 往 `server/package.json` 的 devDependencies 里放了三枚只存在于本机 pnpm 工作区的
 * `@heyta/*` ⇒ npm 在 `--omit=dev` 下照样**解析**它们 ⇒ registry 404 ⇒ 镜像那层建不出来），
 * 但两侧写法不同：
 *   · main：`RUN node -e '…delete p.devDependencies…' && \`
 *   · 本批：`RUN npm pkg delete devDependencies && \`
 *
 * 🔴 取舍**不是偏好**：`PRUNE_DEV_DEPS_RE`（`image-install-shape.mjs:113`，契约门禁第 5 步与
 * 快照指纹的**唯一**判定形状）只认 `npm pkg delete devDependencies`。取 main 侧会连红两处：
 *   ① `check:image-install-contract` 第 5 步 `生产阶段没有在第一条 install 之前删掉 devDependencies`；
 *   ② `prunesDevDependencies=false` 会把 `devDependencies` 从 `INERT` 挪回被哈希的集合
 *      ⇒ `serverInstallInputSha256` 变 ⇒ 快照新鲜度那一腿也红。
 * 所以取**本分支的命令形状**。
 *
 * ## 但"取 theirs 整文件"在这一族是**错的**，而且错得静默
 *
 * main 对这一文件改了 17 行、本批改了 52 行，其中**只有一块**冲突，其余几块是自动并好的。
 * `git checkout --theirs -- server/Dockerfile` 拿到的是**本分支的整文件** ⇒
 * main 那些**没冲突的改动会一行不留**，而归属检查（`diff(main,载体) ⊆ 写集`）抓不到它：
 * 这一路径本来就在写集里，产出看着完全合法。这正是本文件头部第 1 族那条"摘掉的那段会被当成
 * 另一边没有而静默消失"的同一件事，只是换了个文件。
 * ⇒ 所以解法只**改写冲突块本身**，块外一个字节都不动（让 git 的自动并负责其余那些块）。
 *
 * ## 冲突块内的规则（三条，逐条可失败）
 *
 *  1. 块里必须**只有注释行**是 main 独有的 ⇒ 逐字保留，插到本分支块里第一条 `ARG|RUN` 之前。
 *     main 那段独有的注释带的是**它自己的证据**（"剪掉是安全的：这三枚只有测试与 `scripts/*.ts`
 *     用，`recover-user.ts` 里那处是注释、值用字面量，由 `server/tests/recover-artifact-envelope.spec.ts`
 *     钉住"）—— 那是别人写下的取代理由，删它等于删他们的论证，即使结论相同也不行。
 *  2. main 独有的**非注释行**只允许一种形状：`node -e` 那句替代剪枝写法 ⇒ 丢弃（它要被本批那句替代，
 *     这正是这一族的取舍），丢弃了什么逐条打在读数里，不静默。
 *  3. 除上面两类之外的任何 main 独有行 ⇒ 退让（verdict），交人判。main 若真在这里加了**别的**行为，
 *     自动决定就是在替它做产品决定。
 *
 * 外加一条**产出自检**（不靠信念）：解完之后
 *   · 无冲突标记；
 *   · `prunesDevDependencies === true`；
 *   · 解出来的**安装形状**与"纯本分支侧"逐字节相同 ⇒ 保留注释这件事**没有**改变镜像装出来的东西，
 *     也就没有让载体上那份快照（第五族取的本分支侧）变得对不上。
 *
 * `--selftest` 拿合成输入跑（不碰 git、不碰载体）：control 十条 + **七条拒绝臂**。
 * 每条拒绝臂**按拒绝理由认领**（比对 verdict 里的 needle），不是只比对"拒了没有"——
 * 因为这里有多道守卫会拒同一件事，只断言"拒了"的臂对"某道守卫失效"是盲的（变异实测过）。
 */
import { readFileSync } from 'node:fs';
import { PRUNE_DEV_DEPS_RE, readImageInstallShapeFromText } from './image-install-shape.mjs';

export const DOCKERFILE_PATH = 'server/Dockerfile';

const RE_START = /^<{7}/;
const RE_SEP = /^={7}$/;
const RE_END = /^>{7}/;

/** main 侧那种"另一种剪枝写法"：内联 node -e 改 package.json 删 devDependencies。 */
const ALT_PRUNE = (line) => /\bnode\s+-e\b/.test(line) && /devDependencies/.test(line);

/**
 * @param {string} text 载体工作树里**带冲突标记**的 `server/Dockerfile` 全文
 * @param {{block?: {ours: string[], theirs: string[]}, head?: string[], tail?: string[]}} [synthetic]
 *        自检用的合成块（跳过标记解析）；真载体不传。
 * @returns {{text: string|null, verdict: string|null, reading: object}}
 *          `verdict` 非空 ⇒ **不许写盘**，交人判（调用方按退 2 处理）。
 */
export function resolveDockerfileConflict(text, synthetic = {}) {
  let head; let tail; let ours; let theirs;
  if (synthetic.block) {
    head = synthetic.head ?? [];
    tail = synthetic.tail ?? [];
    ours = synthetic.block.ours;
    theirs = synthetic.block.theirs;
  } else {
    const lines = String(text ?? '').split('\n');
    const starts = lines.map((l, i) => (RE_START.test(l) ? i : -1)).filter((i) => i >= 0);
    const ends = lines.map((l, i) => (RE_END.test(l) ? i : -1)).filter((i) => i >= 0);
    if (starts.length === 0) {
      return { text: null, verdict: '这一文件里没有冲突块 ⇒ 第九族不该被调用（要么它没冲突，要么标记被上一环吃掉了）', reading: {} };
    }
    if (starts.length > 1) {
      return { text: null, verdict: `有 ${starts.length} 块冲突（行 ${starts.join(',')}）⇒ 逐块规则只在单块时成立，多块交人判`, reading: {} };
    }
    if (ends.length !== 1) {
      return { text: null, verdict: `冲突标记不成对（起 ${starts.length} / 止 ${ends.length}）⇒ 文件形状读不出 ours/theirs`, reading: {} };
    }
    const s = starts[0];
    const e = ends[0];
    const seps = [];
    for (let i = s + 1; i < e; i += 1) if (RE_SEP.test(lines[i])) seps.push(i);
    if (seps.length !== 1) {
      return { text: null, verdict: `块里找到 ${seps.length} 个 ======= 分隔线（需要恰好 1 个）⇒ 交人判`, reading: {} };
    }
    head = lines.slice(0, s);
    tail = lines.slice(e + 1);
    ours = lines.slice(s + 1, seps[0]);
    theirs = lines.slice(seps[0] + 1, e);
  }

  const reading = { ours: ours.length, theirs: theirs.length };

  // 前提：本分支侧那块里真的有那句被门禁认帐的剪枝命令。
  if (!theirs.some((l) => PRUNE_DEV_DEPS_RE.test(l))) {
    return {
      text: null,
      verdict: `本分支侧那一块里没有 \`${PRUNE_DEV_DEPS_RE.source}\` 那句剪枝 ⇒ 这一族"取本分支命令形状"的前提不成立，交人判`,
      reading,
    };
  }

  // 规则 1/2/3：main 独有行只许是注释，或那一句替代剪枝写法。
  const keep = [];
  const droppedAlt = [];
  const forbidden = [];
  for (const line of ours) {
    if (theirs.includes(line)) continue; // 两侧都有的行由 theirs 提供，不重复插
    if (/^#/.test(line)) {
      if (!keep.includes(line)) keep.push(line);
      continue;
    }
    if (ALT_PRUNE(line)) {
      droppedAlt.push(line.trim().slice(0, 48));
      continue;
    }
    forbidden.push(line.trim().slice(0, 72));
  }
  if (forbidden.length) {
    return {
      text: null,
      verdict: `main 在这一块里有 ${forbidden.length} 行**既不是注释、也不是替代剪枝写法**的内容：\n` +
        forbidden.map((l) => `        · ${l}`).join('\n') +
        `\n     ⇒ 那是它自己加的行为，自动决定等于替它做产品决定。交人判。`,
      reading,
    };
  }

  // 插入锚点：theirs 里第一条命令行（注释之后的 ARG/RUN）。
  const anchor = theirs.findIndex((l) => /^(ARG|RUN)\b/.test(l));
  if (anchor < 0) {
    return { text: null, verdict: '本分支侧那一块里没有 `ARG`/`RUN` 行 ⇒ 保留的注释没有可插入的位置，交人判', reading };
  }
  const block = [...theirs.slice(0, anchor), ...keep, ...theirs.slice(anchor)];
  const out = [...head, ...block, ...tail].join('\n');

  // ── 产出自检（三条，全部落在**算出来的那个对象**上）─────────────────
  const problems = [];
  const outLines = out.split('\n');
  const leftover = outLines.filter((l) => /^(<{7}|={7}$|>{7})/.test(l));
  if (leftover.length) problems.push(`产出仍含 ${leftover.length} 行冲突标记`);
  let shapeMerged = null;
  let shapeBranch = null;
  try {
    shapeMerged = readImageInstallShapeFromText(out);
    shapeBranch = readImageInstallShapeFromText([...head, ...theirs, ...tail].join('\n'));
  } catch (e) {
    problems.push(`产出读不出安装形状：${e.message}`);
  }
  if (shapeMerged && !shapeMerged.prunesDevDependencies) {
    problems.push('产出里 `prunesDevDependencies=false` ⇒ 解完仍然装不出镜像，这一族的取舍没生效');
  }
  if (shapeMerged && shapeBranch && shapeMerged.normalizedShape !== shapeBranch.normalizedShape) {
    problems.push('保留 main 的注释**改变了安装形状**（与本分支侧不逐字节相同）⇒ 载体上那份快照会因此对不上');
  }
  for (const line of keep) {
    const n = out.split('\n').filter((l) => l === line).length;
    if (n !== 1) problems.push(`保留的注释行在产出里出现 ${n} 次（应为 1）：${line.slice(0, 40)}`);
  }

  if (problems.length) return { text: null, verdict: problems.join('；'), reading };
  return {
    text: out,
    verdict: null,
    reading: {
      ...reading,
      kept: keep.length,
      droppedAlt,
      installShapeIdentical: shapeMerged.normalizedShape === shapeBranch.normalizedShape,
      prunes: shapeMerged.prunesDevDependencies,
      installs: shapeMerged.installs.length,
    },
  };
}

/** 一行读数，进载体的 notes 与提交说明。 */
export function dockerfileReading(r) {
  return `server/Dockerfile 第九族：取本分支的剪枝命令形状，保留 main 独有注释 ${r.kept} 行` +
    `（main 那句替代写法 node -e 已丢弃：${r.droppedAlt.join(' | ') || '（无）'}）` +
    ` · 剪枝在第一条 install 之前=${r.prunes} · install ${r.installs} 条` +
    ` · 安装形状与本分支侧逐字节相同=${r.installShapeIdentical}（⇒ 保留注释**没有**改变镜像装出来的东西）`;
}

/* ═══════════════════════════════════════════════════════════════════
 * --selftest：六臂 + 一条正向对照，全部合成输入（不碰 git、不碰载体）
 * ═══════════════════════════════════════════════════════════════════ */
const HEAD_SYN = ['# keep me', 'FROM x AS production', 'WORKDIR /app'];
const TAIL_SYN = ['    npm cache clean --force', 'USER supersync'];
const MAIN_BLOCK = [
  '# main 独有的理由（它的证据）',
  '#   第二行',
  'ARG NPM_REGISTRY=https://registry.npmjs.org/',
  `RUN node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));delete p.devDependencies;fs.writeFileSync("package.json",JSON.stringify(p))' && \\`,
];
const BRANCH_BLOCK = [
  '# 两侧共有的注释',
  '#   第二行',
  'ARG NPM_REGISTRY=https://registry.npmjs.org/',
  'RUN npm pkg delete devDependencies && \\',
];

function synth(ours, theirs) {
  const text = [
    ...HEAD_SYN,
    '<<<<<<< HEAD',
    ...ours,
    '=======',
    ...theirs,
    '>>>>>>> feat/x',
    ...TAIL_SYN,
  ].join('\n');
  return text;
}

/* 拒绝类判据一律**按理由认领**（比对 verdict 里的 needle），不是只比对"它拒了没有"。
 * 为什么（本轮变异实测出来的）：A1 那输入在"前置守卫"被摘掉后**仍然**会被产出自检兜住 ⇒
 * 只断言"拒了"的臂对守卫失效是**盲的**（M2 变异 rc=0、一条红臂都没有）。认领理由之后，
 * 守卫被摘 ⇒ verdict 换了出处 ⇒ 那一条臂立刻红。每个守卫各自有一名专属臂。 */
const R_NO_PRUNE = '本分支侧那一块里没有';
const R_FORBIDDEN = '既不是注释、也不是替代剪枝写法';
const R_NO_BLOCK = '没有冲突块';
const R_MULTI_BLOCK = '块冲突';
const R_NO_ANCHOR = '没有可插入的位置';
const R_UNPAIRED = '冲突标记不成对';
const R_PRUNE_AFTER = 'prunesDevDependencies=false';

export function selftestArms() {
  const arms = [];
  const push = (name, expect, fn) => arms.push({ name, expect, got: fn() });
  /** 断言"拒了，且理由就是这一条守卫"。 */
  const refuses = (text, needle) => {
    const r = resolveDockerfileConflict(text);
    return r.verdict !== null && r.verdict.includes(needle);
  };

  // control
  const ctrl = resolveDockerfileConflict(synth(MAIN_BLOCK, BRANCH_BLOCK));
  push('control 必须解出来（verdict 为空）', true, () => ctrl.verdict === null);
  push('control 保留 main 独有注释 1 行（共有那行不重复插）', 1, () => ctrl.reading.kept);
  push('control 丢弃了 main 的 node -e 替代写法', 1, () => ctrl.reading.droppedAlt.length);
  push('control 产出含 npm pkg delete 那句', true, () => ctrl.text.includes('RUN npm pkg delete devDependencies'));
  push('control 产出**不含** main 那句 node -e', false, () => /node -e .*delete p\.devDependencies/.test(ctrl.text));
  push('control 剪枝在第一条 install 之前', true, () => ctrl.reading.prunes);
  push('control 安装形状与本分支侧逐字节相同', true, () => ctrl.reading.installShapeIdentical);
  push('control main 独有的证据行**在**产出里', true, () => ctrl.text.includes('# main 独有的理由（它的证据）'));
  push('control 共有注释只出现一次（插入没有造出重复）', 1, () => ctrl.text.split('\n').filter((l) => l === '#   第二行').length);
  push('control 块外的行逐字未动', true, () => {
    const l = ctrl.text.split('\n');
    return l[0] === '# keep me' && l[1] === 'FROM x AS production' && l[l.length - 1] === 'USER supersync';
  });

  // 七臂：每一臂都**必须**由它那一守卫拒绝（理由逐条认领），否则解法就没有牙。
  push(`A1 本分支侧没有剪枝句 ⇒ ${R_NO_PRUNE}`, true,
    () => refuses(synth(MAIN_BLOCK, BRANCH_BLOCK.filter((l) => !PRUNE_DEV_DEPS_RE.test(l))), R_NO_PRUNE));
  push(`A2 main 侧有非注释、非替代写法的行为行 ⇒ ${R_FORBIDDEN}`, true,
    () => refuses(synth([...MAIN_BLOCK, 'RUN npm install left-pad --omit=dev'], BRANCH_BLOCK), R_FORBIDDEN));
  push(`A3 没有冲突块 ⇒ ${R_NO_BLOCK}`, true,
    () => refuses(['FROM x AS production', 'RUN npm pkg delete devDependencies'].join('\n'), R_NO_BLOCK));
  push(`A4 两块冲突 ⇒ ${R_MULTI_BLOCK}`, true,
    () => refuses(`${synth(MAIN_BLOCK, BRANCH_BLOCK)}\n${synth(MAIN_BLOCK, BRANCH_BLOCK)}`, R_MULTI_BLOCK));
  // ⚠️ 这两臂的夹具是**改过第二遍**的：第一版让它们走到了**另一道**守卫（R_FORBIDDEN）上 ——
  // main 侧那句 `ARG NPM_REGISTRY=…` 与本臂的 theirs 不相等，于是被当成"main 独有的非注释行"先拒了。
  // 正是"按理由认领"把这件事照出来的（只断言"拒了"的话，两臂会一直"绿"着测错东西）。
  push(`A5 theirs 里没有 ARG/RUN 锚点 ⇒ ${R_NO_ANCHOR}`, true,
    () => refuses(synth(['# main 独有的理由（它的证据）'], ['# 只有注释', 'npm pkg delete devDependencies']), R_NO_ANCHOR));
  push(`A6 标记不成对（缺 >>>>>>>）⇒ ${R_UNPAIRED}`, true,
    () => refuses([...HEAD_SYN, '<<<<<<< HEAD', ...MAIN_BLOCK, '=======', ...BRANCH_BLOCK].join('\n'), R_UNPAIRED));
  // A7 走的是**另一条**守卫：前置检查放行了（theirs 里确有那句剪枝），错在剪枝排在 install 之后，
  // 只有产出侧的形状自检会抓到它。这一臂是"产出自检不是装饰"的证据。
  push(`A7 剪枝排在第一条 install 之后 ⇒ ${R_PRUNE_AFTER}`, true,
    () => refuses(synth(MAIN_BLOCK, ['ARG NPM_REGISTRY=https://registry.npmjs.org/', 'RUN npm install ./a.tgz --omit=dev && npm pkg delete devDependencies']), R_PRUNE_AFTER));

  return arms;
}

if (process.argv[2] === '--selftest') {
  const arms = selftestArms();
  let bad = 0;
  for (const a of arms) {
    const ok = a.got === a.expect;
    if (!ok) bad += 1;
    console.log(`${ok ? '  ok' : 'RED '} ${a.name}（期望 ${JSON.stringify(a.expect)}，实得 ${JSON.stringify(a.got)}）`);
  }
  const refused = arms.filter((a) => a.name.startsWith('A')).length;
  console.log(`\n臂数 ${arms.length}（拒绝类 ${refused}，每条**按理由认领**）· 红 ${bad}`);
  if (bad) {
    console.error('❌ 第九族的解法自检不过 ⇒ 不用它解冲突');
    process.exit(1);
  }
  console.log('✅ 第九族判据自检：control 十条 + 七臂各由自己的那道守卫拒绝（含"前置守卫"与"产出自检"两条不同的路）');
  process.exit(0);
}

// 被 import 时不自动跑；单独执行且没带 --selftest 时给一句提示。
if (process.argv[1] && process.argv[1].endsWith('selfhost-dockerfile-merge.mjs')) {
  console.log('用法：node research/tools/selfhost-dockerfile-merge.mjs --selftest');
  console.log('（真载体的解法由 selfhost-merge-carrier.mjs 的第九族调用本文件的 resolveDockerfileConflict）');
}
