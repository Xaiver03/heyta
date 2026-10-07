#!/usr/bin/env node
/**
 * Shell 里"只在某一侧系统上存在的工具"的**债务账本对账** —— 本仓 `stat -f`（§7 第 364 条）
 * 与 `md5 -q`（§7 第 370 条）两族事故的共同形状，收成一枚会红的判据。
 *
 * ## 为什么这是一类，而不是"注意一下"
 *
 * 两族事故的症状**都不是崩溃**：
 *
 * | 工具 | 在另一侧系统上 | 后果 |
 * |---|---|---|
 * | `md5 -q`（BSD/macOS） | GNU 上 `md5: 未找到命令` ⇒ **命令替换读成空串** | "指纹前后一致"恒真 ⇒ 那几臂**没有牙**；"必须有变化"恒假 ⇒ 响亮红。同一套装置里两种相反后果 |
 * | `stat -f …`（BSD） | GNU 把 `-f` 读成"terse 格式"并打出**另一回事** | §7 第 364 条：管道里 rc=0 + 非空垃圾 ⇒ 兜底永不执行，拿磁盘空闲块数去和 mtime 比 |
 *
 * 🔴 要防的是第一类：探针静默取到空值，判据从"有牙"变成"永远通过"，而输出一字不变。
 * 这不是假想 —— 06 第四轮在那台 Ubuntu 上跑 `check:calendar-evidence-rigs`，4 臂按"必须有变化"
 * 正确地红了，**同一趟里**另一枚臂脚本按"前后一致"空转着报 `合计 pass=36 fail=0`。
 * 只修红的那几臂、不去数绿的那几臂有没有牙，就会把假绿留在册上。
 *
 * ## 判据（缺一即红）
 *
 *  ① 账本按 **文件 × 类别** 记站点数；现实里**多出**任何一处（新文件，或老文件多一处）⇒ 红，点名行号；
 *  ② 某文件的数**变小**而账本没跟着改 ⇒ 红 —— 账本只能跟着现实走，
 *     攒旧账与漏记都是假读数（与 `check-image-license-coverage.mjs` 的 `IMAGE_ONLY_PACKAGES`、
 *     `check-native-lib-registry.mjs` 的"表只能变小"同一条设计）；
 *  ③ 账本里有已经不存在的文件 / 已经不存在的类别 ⇒ 红；
 *  ④ 扫描集取不到（不在 git 仓库里、`git ls-files` 出错、一条 `.sh` 都没列到）⇒ **响亮失败**，
 *     不许"读到空集然后报通过"；
 *  ⑤ 账本被掏空成 `{}` ⇒ 响亮失败（它是承重的）。
 *
 * ## 类别是**闭合**的，只收被实测过的形状
 *
 * 只有下面三档，每一档背后都要有一处本仓真实踩过的空转或错值。**不顺手把"看起来像跨平台坑"的
 * 都加进来** —— 一条从没被证伪过的规则会把人训练成忽略它。要加新档，先找到一个它本该抓住的事故。
 *
 * ## 用法
 *
 *   node research/tools/check-shell-portability.mjs                   # 对账
 *   node research/tools/check-shell-portability.mjs --write-baseline  # 清债之后重生成账本
 *   node research/tools/check-shell-portability.mjs --self-test       # 故障注入（臂数由它自己打印）
 *
 * 消费者：`scripts/check-linux-shell.mjs` 的 ⓪ 组 —— 放那里是因为它**每个平台都要跑**：
 * 一枚只在 Linux 上执行的"Linux 可移植性"判据是自相矛盾的，而 BSD-only 的坑在 mac 上恰好看不见。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BASELINE_REL = 'research/tools/shell-portability-baseline.json';

/** 调用形状样本：自检往**已登记**的文件里加站点时用它们（必须是真调用形状 ——
 *  🔴 上一版这里追加的是正则的 `source` 文本，那玩意儿匹配不上自己，臂"通过"而它没测任何东西）。 */
const SNIPPET = {
  md5_bsd: 'x=$(md5 -q /dev/null)',
  md5sum_gnu: 'x=$(md5sum /dev/null)',
  stat_f_bsd: 'x=$(stat -f %m /dev/null)',
};

/** `re` 只收**调用形状**，所以散文与注释里的"md5 前后一致"不会被算成站点
 *  （现量：跟踪的 .sh 里 `md5 -q` 是那一大族，而 `md5 <汉字>` 全是消息文本）。 */
export const CLASSES = [
  { id: 'md5_bsd', label: '`md5 -q`（BSD/macOS 独有 ⇒ GNU 上取到空串）', re: /\bmd5[ \t]+-q\b/g },
  { id: 'md5sum_gnu', label: '`md5sum`（GNU 独有 ⇒ macOS 上没有这枚命令）', re: /\bmd5sum\b/g },
  { id: 'stat_f_bsd', label: '`stat -f`（BSD 与 GNU 用它读两件不同的事，§7 第 364 条）', re: /\bstat[ \t]+-f\b/g },
];

export const root = () =>
  process.env.HEYTA_CHECK_ROOT === undefined ? resolve(HERE, '../..') : resolve(process.env.HEYTA_CHECK_ROOT);

function abort(lines) {
  console.log('❌ shell 可移植性对账：响亮失败');
  for (const l of lines) console.log(`   ${l}`);
  throw new Error('portability-abort');
}

/** 扫描集 = **HEAD 那一批**跟踪的 `.sh`（`git ls-tree -r HEAD`），不是 `git ls-files`（索引）。
 *  🔴 这条是被载体教出来的：共享检出上索引 ⊃ HEAD —— 别的线 `git add` 过、还没提交的文件在
 *  `ls-files` 里看得见，在干净检出（CI 的唯一形态）里**不存在**。上一版按索引生成账本，
 *  那台 Ubuntu 当场报"账本还记着 server/scripts/backup.sh ⇒ 攒旧账"——它没说错，
 *  是账本的口径错了：**债务必须按提交物算**，否则这台机与那台机的读数天生对不齐。
 *  用 `git ls-tree` 而不是 `find` 的理由不变：一条命令同时排掉 `node_modules`、
 *  被 gitignore 的 `tmp/`，以及只在某人工作树里活着的脚手架。 */
export function listShellFiles(cwd) {
  let out;
  try {
    out = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--'], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    abort([
      '取不到 HEAD 的文件树 ⇒ 无法对账（这**不是**"没有站点"）。',
      `原因：${String(e.message).split('\n')[0]}`,
      '两个前提之一不成立：这不在一个有提交的 git 工作树里，或 tar 送源码时没带 `.git`' +
        '（docs/runbooks/linux-dev-box.md §4 的 ①②③）。',
    ]);
  }
  const files = out
    .toString('utf8')
    .split('\0')
    .filter((f) => f.endsWith('.sh'));
  if (files.length === 0) {
    abort([
      '扫描集是**空的**（HEAD 里一条 `.sh` 都没列到）⇒ 不报"全部合规"。',
      '"没读到东西"和"读到了但都合规"在输出上长得一样，而只有后者该绿 ⇒ 一律响亮失败。',
    ]);
  }
  return files;
}

/** 数站点 ⇒ `{ 文件: { 类别: {count, lines[]} } }`，只含有命中的。
 *
 * 🔴 **读的是 HEAD 的 blob，不是盘上的文本**（06 被两件事教出来的）：
 *   ① 账本按盘上生成 ⇒ 里面记进了别人**未提交**的一处 `stat -f`，于是干净检出（CI、那台 Ubuntu）
 *      读不到它 ⇒ 判据在那两台机上永远红，而红的是账本自己；
 *   ② 反过来若判据读盘而账本读 HEAD，别的线一处正常的在途改动就会把共享链染红。
 *   ⇒ 两边都按**提交物**算才是可复现的对账；工作树的增量另报一行提示（不改退出码），
 *      这样"提交前看得见、提交后必须登记"两头都不丢。 */
function readBody(cwd, f, fromHead) {
  if (!fromHead) return readFileSync(join(cwd, f), 'utf8');
  try {
    return execFileSync('git', ['show', `HEAD:${f}`], { cwd, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  } catch (e) {
    abort([`HEAD 的树里列到了 ${f}，但取不到它的 blob ⇒ 对账停在半路。`, `原因：${String(e.message).split('\n')[0]}`]);
  }
}

export function scan(cwd, files, { fromHead = true } = {}) {
  const found = {};
  for (const f of files) {
    const text = readBody(cwd, f, fromHead);
    const lines = text.split('\n');
    const perFile = {};
    for (const cls of CLASSES) {
      const hits = [];
      lines.forEach((line, i) => {
        cls.re.lastIndex = 0;
        if (cls.re.test(line)) hits.push(i + 1);
      });
      if (hits.length > 0) perFile[cls.id] = { count: hits.length, lines: hits };
    }
    if (Object.keys(perFile).length > 0) found[f] = perFile;
  }
  return found;
}

export function loadBaseline(cwd) {
  const p = join(cwd, BASELINE_REL);
  if (!existsSync(p)) {
    abort([`账本 ${BASELINE_REL} 取不到 ⇒ 无法对账（不是"没有债"）。`, '跑：node research/tools/check-shell-portability.mjs --write-baseline']);
  }
  let json;
  try {
    json = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    abort([`账本 ${BASELINE_REL} 不是合法 JSON ⇒ 无法对账。`, `原因：${String(e.message).split('\n')[0]}`]);
  }
  const files = json.files ?? {};
  if (Object.keys(files).length === 0) {
    abort([
      `账本 ${BASELINE_REL} 里 files 是空的 ⇒ 响亮失败。`,
      '账本是承重的：把它掏空就能让①②③永远无话可说。真要清债走 --write-baseline。',
    ]);
  }
  return files;
}

/** 真判据：账本 ⟷ 现实，双向核数。返回红条数组（空 = 绿）。 */
export function reconcile(baseline, found) {
  const reds = [];
  for (const [f, perFile] of Object.entries(found)) {
    const booked = baseline[f] ?? {};
    for (const [clsId, cur] of Object.entries(perFile)) {
      const was = booked[clsId]?.count ?? 0;
      if (cur.count > was) {
        const bookedLines = booked[clsId]?.lines ?? [];
        // 正常情况下差集就是"新写的那几行"；但账本只改过计数（没改行号）时差集会空，
        // 那时宁可将整体现量列出来 —— 一条"新增在第  行"的读数等于没读数。
        const fresh = cur.lines.filter((n) => !bookedLines.includes(n));
        const where = fresh.length > 0 ? `新增在第 ${fresh.join(', ')} 行` : `现量行号 ${cur.lines.join(', ')}`;
        reds.push(`${f} 的 ${clsId} 从 ${was} 涨到 ${cur.count} ⇒ ${where}`);
      } else if (cur.count < was) {
        reds.push(`${f} 的 ${clsId} 变少了（账本 ${was} / 现量 ${cur.count}）⇒ 债清了就 --write-baseline 把账改小`);
      }
    }
  }
  for (const [f, booked] of Object.entries(baseline)) {
    const cur = found[f];
    if (cur === undefined) {
      reds.push(`账本还记着 ${f}，现实里它不在扫描集或已全清 ⇒ 攒旧账`);
      continue;
    }
    for (const clsId of Object.keys(booked)) {
      if (cur[clsId] === undefined) reds.push(`账本还记着 ${f} 的 ${clsId}，现量 0 ⇒ 攒旧账`);
    }
  }
  return reds;
}

export const countSites = (found) =>
  Object.values(found).reduce((a, v) => a + Object.values(v).reduce((x, y) => x + y.count, 0), 0);

export function run({ writeBaseline = false } = {}) {
  const cwd = root();
  const files = listShellFiles(cwd);
  const found = scan(cwd, files);
  if (writeBaseline) {
    const json = {
      _comment:
        '本仓 shell 里"只在某一侧系统上存在的工具"的债务账本；由 --write-baseline 生成，不要手改。' +
        '判据：research/tools/check-shell-portability.mjs（只许减不许增，攒旧账也红）。',
      classes: CLASSES.map(({ id, label }) => ({ id, label })),
      files: found,
    };
    writeFileSync(join(cwd, BASELINE_REL), `${JSON.stringify(json, null, 2)}\n`);
    console.log(
      `✅ 账本已重生成：${BASELINE_REL}（文件 ${Object.keys(found).length} 枚，站点 ${countSites(found)} 处，扫描 ${files.length} 个 .sh）`,
    );
    return;
  }
  const baseline = loadBaseline(cwd);
  const reds = reconcile(baseline, found);
  // 工作树增量：只提示，不改退出码（理由见 scan 的注释）。
  const disk = scan(cwd, files, { fromHead: false });
  const pending = [];
  for (const [f, perFile] of Object.entries(disk)) {
    for (const [clsId, cur] of Object.entries(perFile)) {
      const inHead = found[f]?.[clsId]?.count ?? 0;
      if (cur.count > inHead) pending.push(`${f} 的 ${clsId} +${cur.count - inHead}（未提交）`);
    }
  }
  const tail = () => {
    if (pending.length > 0) {
      console.log(`⚠️ 另外工作树里有 ${pending.length} 处未提交的增量，不计入对账：`);
      for (const p of pending) console.log(`   ${p}`);
      console.log('   ⇒ 提交之后重跑 --write-baseline 把它们登记进去（账本记的是提交物）。');
    }
  };
  if (reds.length > 0) {
    console.log(`❌ shell 可移植性对账：${reds.length} 处不一致（按 HEAD 扫 ${files.length} 个 .sh，现量 ${countSites(found)} 站点）`);
    for (const r of reds) console.log(`   ${r}`);
    console.log('\n   🔴 为什么值得拦：这些工具在"另一侧"系统上**不报错**，而是取到空串或读到另一回事');
    console.log('      （§7 第 370 / 364 条）。取到空串时"前后一致"那类断言**恒真** ——');
    console.log('      判据从有牙变成永远通过，而它的输出一个字都不变。');
    tail();
    process.exitCode = 1;
    return;
  }
  console.log(
    `✅ shell 可移植性对账通过：按 HEAD 扫 ${files.length} 个 .sh，` +
      `${Object.keys(found).length} 枚文件共 ${countSites(found)} 处站点，逐类与账本一致`,
  );
  tail();
}

// ── 故障注入：跑在临时 git 树上，不动工作区 ────────────────────────
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' });

/** 夹具的**内容已知**（`a.sh` 两处 `md5 -q`、`b.sh` 一处 `stat -f` 加一处 `md5sum`、一枚干净文件）。
 *  🔴 为什么不用真仓的文件当夹具：上一版挑的是真实命中文件，于是 A3"清掉一处"实际清掉了
 *  **整枚文件的所有站点** ⇒ 触发的是"账本还记着这个文件"那条分支，而它要测的"变少即红"那条
 *  从来没被执行过 —— 臂通过了，可它什么都没测。内容已知才敢断言"红来自哪一条"。
 *  真树那一侧由 A7 单独覆盖（同一份扫描代码跑真实 147 枚 .sh 必须绿）。 */
const FIXTURE_FILES = {
  'scripts/a.sh': '#!/usr/bin/env bash\nx=$(md5 -q "$1")\ny=$(md5 -q "$2")\necho "$x$y"\n',
  'scripts/b.sh': '#!/usr/bin/env bash\nm=$(stat -f %m "$1")\ns=$(md5sum "$1" | cut -d" " -f1)\necho "$m$s"\n',
  'clean/ok.sh': '#!/usr/bin/env bash\necho nothing host-specific here\n',
};

/** 造一棵最小 git 树并**先**把账本落盘：所有变异都在这之后发生。
 *  🔴 顺序很要紧 —— 再早一版是"先把坏文件写进去、再按整棵树生成账本"，
 *  于是注入的站点被当成已登记，那两臂根本没生效却"通过"了。 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-portability-'));
  git(['init', '-q'], dir);
  for (const [rel, body] of Object.entries(FIXTURE_FILES)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  git(['add', '-A'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture'], dir);
  const baseline = scan(dir, listShellFiles(dir));
  mkdirSync(join(dir, dirname(BASELINE_REL)), { recursive: true });
  writeFileSync(join(dir, BASELINE_REL), `${JSON.stringify({ files: baseline }, null, 2)}\n`);
  git(['add', '-A'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'baseline'], dir);
  return { dir, baseline };
}

const judge = (dir) => {
  const files = listShellFiles(dir);
  const reds = reconcile(loadBaseline(dir), scan(dir, files));
  return { rc: reds.length === 0 ? 0 : 1, reds };
};

/** 往树上加一处**账本里没有的**站点，然后提交（模拟另一个人新写的一行）。 */
function commitNewSite(dir, rel, body) {
  mkdirSync(join(dir, dirname(rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
  git(['add', '-A'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'mutant'], dir);
}

/** 往一枚**已登记**的文件末尾追加同类的一处调用。 */
function appendSite(dir, rel, clsId) {
  writeFileSync(join(dir, rel), `${readFileSync(join(dir, rel), 'utf8')}\n${SNIPPET[clsId]}\n`);
  git(['add', '-A'], dir);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'mutant'], dir);
}

async function selfTest() {
  const arms = [];

  // A0 阳性对照：原样绿，且确实读到了站点（"读成 0 站点"那类失效就藏在这里）。
  const { dir } = fixture();
  const r0 = judge(dir);
  const sites0 = countSites(scan(dir, listShellFiles(dir)));
  arms.push(['A0 原样 ⇒ 绿，且扫描集非空、站点数 > 0（阳性对照）', r0.rc === 0 && sites0 > 0]);

  // A1 账本外多一枚新文件的 md5 -q ⇒ 红并点名。
  commitNewSite(dir, 'scripts/new-bad.sh', '#!/usr/bin/env bash\nx=$(md5 -q "$1")\n');
  const r1 = judge(dir);
  arms.push(['A1 多一处未登记的 md5 -q ⇒ 红并点名新文件', r1.rc === 1 && r1.reds.some((x) => x.includes('scripts/new-bad.sh'))]);

  // A2 已登记的文件里多加一处 ⇒ 红，且给的是"涨到"而不是"没见过"。
  appendSite(dir, 'scripts/a.sh', 'md5_bsd');
  const r2 = judge(dir);
  arms.push([
    'A2 已登记文件里多加一处 ⇒ 红并点名该文件与"涨到"',
    r2.rc === 1 && r2.reds.some((x) => x.includes('scripts/a.sh') && x.includes('涨到')),
  ]);

  // A3 清掉**一处**（不是整枚文件）而账本没跟着改 ⇒ 必须命中"变少即红"那一条分支。
  const f3 = fixture();
  commitNewSite(f3.dir, 'scripts/a.sh', '#!/usr/bin/env bash\nx=$(md5 -q "$1")\necho "$x"\n'); // 两处 → 一处
  const r3 = judge(f3.dir);
  arms.push([
    'A3 现实变少而账本没改 ⇒ 红，且红来自"变少了"那一条分支',
    r3.rc === 1 && r3.reds.length === 1 && r3.reds[0].includes('scripts/a.sh') && r3.reds[0].includes('变少了'),
  ]);

  // A4 一个提交都没有 ⇒ 响亮失败（不是"通过"）。
  const empty = mkdtempSync(join(tmpdir(), 'heyta-portability-empty-'));
  git(['init', '-q'], empty);
  let aborted4 = false;
  try {
    listShellFiles(empty);
  } catch {
    aborted4 = true;
  }
  arms.push(['A4 没有提交（取不到 HEAD）⇒ 响亮失败，不报通过', aborted4]);

  // A4b 有提交、但提交里一条 `.sh` 都没有 ⇒ 走的是另一条响亮失败（空集，不是"全部合规"）。
  const noSh = mkdtempSync(join(tmpdir(), 'heyta-portability-nosh-'));
  git(['init', '-q'], noSh);
  writeFileSync(join(noSh, 'README.md'), '# hi\n');
  git(['add', '-A'], noSh);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'only-md'], noSh);
  let aborted4b = false;
  try {
    listShellFiles(noSh);
  } catch {
    aborted4b = true;
  }
  arms.push(['A4b 有提交但 HEAD 里 0 枚 .sh ⇒ 空集也算响亮失败', aborted4b]);

  // A5 账本被掏空 ⇒ 响亮失败。
  const f5 = fixture();
  writeFileSync(join(f5.dir, BASELINE_REL), `${JSON.stringify({ files: {} }, null, 2)}\n`);
  let aborted5 = false;
  try {
    loadBaseline(f5.dir);
  } catch {
    aborted5 = true;
  }
  arms.push(['A5 账本掏空成 {} ⇒ 响亮失败（账本是承重的）', aborted5]);

  // A6 变异：摘掉"变少也算红"那一句 ⇒ A3 那棵树必须**转绿**，证明牙在那一行。
  const src = readFileSync(join(HERE, 'check-shell-portability.mjs'), 'utf8');
  const patched = src.replace('} else if (cur.count < was) {', '} else if (false && cur.count < was) {');
  if (patched === src) throw new Error('A6 的变异没生效（锚点字符串写错了）—— 修臂，不许把它记成通过');
  const mutDir = mkdtempSync(join(tmpdir(), 'heyta-portability-mut-'));
  const mutFile = join(mutDir, 'mutated.mjs');
  writeFileSync(mutFile, patched);
  const mod = await import(pathToFileURL(mutFile).href);
  const mutReds = mod.reconcile(mod.loadBaseline(f3.dir), mod.scan(f3.dir, mod.listShellFiles(f3.dir)));
  arms.push([
    'A6 摘掉"变少即红"那一句 ⇒ A3 那棵树转绿（牙就在那一行）',
    mutReds.length === 0 && r3.reds.length === 1,
  ]);

  // A7 同一份扫描代码跑**真仓**：必须绿（夹具不是自说自话，真实树也在这条口径上）。
  const realDir = resolve(HERE, '../..');
  const r7 = judge(realDir);
  arms.push(['A7 真仓当前状态 ⇒ 绿（夹具的模式与真实文件同形）', r7.rc === 0]);

  // A8 读数形状：账本只被改了**计数**（行号还是原来那批）时，红条不许打"新增在第  行"这种空话。
  // （06 手工注入时真打过一次空的 —— 空读数等于没读数。）
  const f8 = fixture();
  const b8 = JSON.parse(readFileSync(join(f8.dir, BASELINE_REL), 'utf8'));
  const k8 = Object.keys(b8.files).find((k) => b8.files[k].md5_bsd?.count > 1);
  b8.files[k8].md5_bsd.count -= 1;
  writeFileSync(join(f8.dir, BASELINE_REL), `${JSON.stringify(b8, null, 2)}\n`);
  const r8 = judge(f8.dir);
  const tail8 = (r8.reds[0] ?? '').split('⇒')[1] ?? '';
  arms.push([
    'A8 只改计数不改行号 ⇒ 红条的⇒右侧给得出行号（不许出现空的"新增在第  行"）',
    r8.rc === 1 && r8.reds.length === 1 && /\d/.test(tail8) && !/新增在第\s+行/.test(r8.reds[0]),
  ]);

  for (const [name, ok] of arms) console.log(`${ok ? '  ✅' : '  ❌'} ${name}`);
  const bad = arms.filter(([, ok]) => !ok).length;
  console.log(`\nself-test 臂 ${arms.length} 枚，不如预期 ${bad} 枚`);
  process.exitCode = bad === 0 ? 0 : 1;
}

// 只有被**直接**执行时才跑 CLI —— A6 要把这份源码改一个字符后 import 进来当库用。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--self-test') await selfTest();
  else run({ writeBaseline: process.argv[2] === '--write-baseline' });
}
