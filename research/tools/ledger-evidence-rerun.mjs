#!/usr/bin/env node
/**
 * 把对账件里**引用的每一条命令**重跑一遍，报 rc + 耗时。
 * =================================================================
 *
 * ## 为什么需要它
 *
 * `docs/plans/launch-blockers.md` 的每一行都引了命令/判据，但**没有任何东西保证那些读数今天仍然成立** ——
 * 2026-10-16 实测过一次真的漂移：§1/§3 的 ¥12 那几行写着"客户端面不存在"，
 * 而第 10–20 轮**早就把它做出来了**（见 B24）。那次是**靠人读出来的**。
 *
 * ⇒ 本工具把它变成机械动作：**抽出全件引用的命令 → 去重 → 逐条跑 → 报 rc 与耗时**。
 *
 * ## ⚠️ 它是**读数**，不是门禁
 *
 * 它**不判断**"这个 rc 对不对"：对账件里有些命令**本来就该红**
 * （`check:reachability`、`check:payment-entry` —— 它们是**待拍板的红**，
 * 见 §7.1；红了才是对的）。所以它只把 rc 摆出来，让人对着行里的读数看。
 *
 * ## 用法
 *
 *   node research/tools/ledger-evidence-rerun.mjs            # 全部跑一遍
 *   node research/tools/ledger-evidence-rerun.mjs --list      # 只列出抽到的命令，不跑
 *   node research/tools/ledger-evidence-rerun.mjs --blocks    # 改跑 §5 那种**围栏代码块**（先做改状态黑名单扫描）
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const LEDGER = join(ROOT, 'docs/plans/launch-blockers.md');

/** 从整份文档里抽出"可以被跑"的命令。去重、保序。 */
/**
 * 每条命令的**上限**。2026-10-16 从 900 秒收到 120 秒：起因见对账件 **B26** ——
 * `verify:artifact-facts` 的 `hdiutil detach` **没有任何超时**，会把调用它的东西一起堵死
 * （当天实测堆了 ~30 个进程、每个卡 6–7 分钟）。
 */
export const COMMAND_TIMEOUT_MS = 120_000;

/**
 * 跑一条命令，**超时要能被认出来**。
 * ⚠️ 返回 `timedOut` 而不是只给一个 rc：rc≠0 既可能是"红"、也可能是"挂了"，
 * 这两件事要分开看（静默混在一起就会把"没测到"读成"有问题"）。
 */
export function runCommand(script, timeoutMs) {
  let output = '';
  let timedOut = false;
  try {
    output = execFileSync('/bin/sh', ['-c', script], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: timeoutMs,
    });
  } catch (error) {
    if (error?.code === 'ETIMEDOUT' || error?.signal === 'SIGTERM') timedOut = true;
    output = String(error?.stdout ?? '');
  }
  return { output, timedOut };
}

let selfSkipped = 0;

export function extractCommands(markdown) {
  const found = [];
  for (const m of markdown.matchAll(/`([^`\n]+)`/g)) {
    const raw = m[1].trim();
    // 只认"整条就是一个命令"的写法；不做 shell 解析。
    // 🔴 **跳过占位符**（2026-10-17）：对账件里有「`pnpm --filter X test`」这种**描述模式**的写法，
    //    `X` 不是包名 ⇒ 真跑必然红 ⇒ 一个永远红的条目会让人以为「这里有问题」。
    if (/[X…<]/.test(raw)) continue;
    if (/^pnpm (check|verify):[a-z0-9:-]+$/.test(raw)) found.push(raw);
    else if (/^pnpm --filter \S+ test$/.test(raw)) found.push(raw);
    else if (/^node (scripts|apps\/landing\/scripts|research\/tools)\/[a-z0-9./-]+\.mjs( --self-test)?$/.test(raw))
      found.push(raw);
  }
  // 🔴 **必须排掉自己**（2026-10-16 实测踩过）：对账件的 §8.8 与 §9.1 **引用了我这个工具本身**
  //    （"用这条命令去复核那一格"），而本工具的职责就是"跑对账件引用的命令" ⇒
  //    **它会调用自己、无限递归**：当日看到 PID 一直变、耗时一直重置，
  //    几十秒内堆出一串进程，而且**永远不会结束**。
  //    ⚠️ 与 `check:selfhost-entry-command` 的 R8 完全同族：**判据文件自己带着那个形状**。
  //    ⇒ 排除它，并**响亮说明**（静默排除会让人以为"那一格也复核过了"）。
  const SELF = 'research/tools/ledger-evidence-rerun.mjs';
  const kept = [...new Set(found)].filter((c) => !c.includes(SELF));
  selfSkipped = found.filter((c) => c.includes(SELF)).length;
  return kept;
}


/**
 * 从**围栏代码块**里抽命令（`--blocks`）。
 *
 * ⚠️ **安全前提**：对账件是**活的文档**，将来可能有人往代码块里写会改状态的命令。
 * 所以这里先对**每一行**做一次黑名单扫描，**命中就整块跳过并响亮说明** ——
 * 静默跳过会让"跑了 N 块"读成"全都验过了"。
 */
const MUTATING = [
  /-X\s*(POST|PUT|PATCH|DELETE)/i,
  /--data\b/,
  /\brm\s+-/,
  /\bmv\s+/,
  /\bgit\s+(add|commit|push|checkout|reset)\b/,
  /\bsudo\b/,
  // ⚠️ 要求**命令位**：第一版写的是 `/\bdocker\b/`，于是 `server/docker-compose.yml`
  //    这个**文件名**把它自己送进了黑名单 ⇒ 又误跳一整块。
  /(^|[|;&]\s*)(docker|systemctl|launchctl)\s/,
  /(^|\s)>\s*(?!\/tmp\/)/,
  /\bsh\s+scripts\/(migrate|deploy)/,
];

/** 返回 `{ blocks: string[], skipped: {index:number, why:string}[] }`。 */
export function extractBlocks(markdown) {
  const blocks = [];
  const skipped = [];
  const placeholders = [];
  const raw = [...markdown.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  raw.forEach((body, index) => {
    const hit = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'))
      // 🔴 **必须剥掉行尾注释再扫**：第一版没剥，于是 §5 判据 ② 那句
      //    `… | grep -c download   # 期望 >0，实测 0` 里的 `>0` 被当成"输出重定向"
      //    ⇒ **整块被跳过**。误跳与漏跳一样坏：它让"跑了 N 块"看起来像"都验过了"。
      .map((l) => l.replace(/\s+#.*$/, ''))
      .filter((l) => l !== '')
      .find((l) => MUTATING.some((re) => re.test(l)));
    if (hit !== undefined) {
      skipped.push({ index, why: hit.slice(0, 60) });
      return;
    }
    // 🔴 **占位符行必须丢掉**：§5 的第一行是 `cd <repo>` —— 那是对**人**说的说明，
    //    而 `<` 在 shell 里是重定向 ⇒ `sh -c` 当场语法错、**整块的命令一条都不跑**
    //    （2026-10-16 实测：rc=2、0.0 秒，差点被读成"这一块读数是红的"）。
    const kept = body
      .split('\n')
      .filter((l) => !/<[a-z][a-z-]*>/i.test(l));
    const dropped = body.split('\n').length - kept.length;
    if (dropped > 0) placeholders.push({ index, dropped });
    blocks.push(kept.join('\n'));
  });
  return { blocks, skipped, placeholders };
}



/** 逐条跑一遍本工具的臂。返回失败的臂数。 */
function selfTest() {
  const arms = [];
  const arm = (name, ok, detail) => arms.push({ name, ok, detail });

  // 臂：**"没跑的命令"要能被摆出来**（2026-10-16 量出 71/96 不跑）
  const covMd = '像命令的：`pnpm check:docs`、`git add docs/`、`node research/tools/x.mjs --all`。';
  const unc = uncoveredCommands(covMd);
  arm('没跑的命令能被摆出来', unc.length === 2, `摆出 ${unc.length} 条（应 2 条：git add 与 --all 那条）`);
  const cls = classifyUncovered(unc);
  arm('能粗分"会改状态"的那类', cls.mutating.length === 1, `改状态 ${cls.mutating.length} 条（应 1）`);
  arm('能粗分"我们自己的参数"那类', cls.looksLikeOurs.length === 1, `自有参数 ${cls.looksLikeOurs.length} 条（应 1）`);

  // 臂 1：**自指会被排掉**（B27 那个"调用自己 ⇒ 永不结束"）
  // ⚠️ **必须用行内反引号**：`extractCommands` 扫的是**行内代码片段**，
  //    围栏代码块归 `--blocks` 管（第一版我用了围栏块 ⇒ 抽到 0 条、臂假红）。
  const md = [
    '`node research/tools/ledger-evidence-rerun.mjs`',
    '`pnpm check:docs`',
    '`pnpm check:md-tables`',
  ].join('\n');
  const cmds = extractCommands(md);
  arm(
    '自指被排掉（否则会递归调用自己）',
    !cmds.some((c) => c.includes('ledger-evidence-rerun.mjs')) && cmds.includes('pnpm check:docs'),
    `抽到 ${cmds.length} 条：${cmds.join(' / ')}`,
  );
  arm('自指条数被记录（好响亮报出）', selfSkipped === 1, `selfSkipped=${selfSkipped}`);

  // 臂 1b：**围栏块里的命令不由 extractCommands 抽**（那是 `--blocks` 的活）——
  //    把这条钉死，免得以后有人以为"抽到的命令 = 对账件里所有命令"。
  const fenced = extractCommands('```bash\npnpm check:docs\n```');
  arm('围栏块里的命令不由本函数抽（归 --blocks）', fenced.length === 0, `抽到 ${fenced.length} 条`);

  // 臂 2：**正面对照** —— 正常的命令必须留下
  arm(
    '正面对照：正常的命令不能被误排',
    cmds.includes('pnpm check:docs') && cmds.includes('pnpm check:md-tables'),
    cmds.join(' / '),
  );

  // 臂 3：**改状态黑名单**必须命中（对账件将来可能被人写进会改状态的命令）
  const bad = extractBlocks('```bash\nrm -rf /tmp/x\n```');
  arm('改状态命令被黑名单拦下', bad.skipped.length === 1 && bad.blocks.length === 0,
    `跳过 ${bad.skipped.length} 块、跑了 ${bad.blocks.length} 块`);
  const good = extractBlocks('```bash\ncat /etc/hosts\n```');
  arm('只读命令不被误拦（正面对照）', good.skipped.length === 0 && good.blocks.length === 1,
    `跳过 ${good.skipped.length} 块`);

  // 臂 4：**占位符行必须被丢掉**（否则 `cd <repo>` 会让整块语法错、一条都不跑）
  const ph = extractBlocks('```bash\ncd <repo>\npnpm check:docs\n```');
  arm('占位符行被丢掉', ph.blocks[0].trim() === 'pnpm check:docs', JSON.stringify(ph.blocks[0]));

  // 臂 5：**超时必须被报出来**，不能静默当成空输出（B26 那一族）
  const slow = runCommand('sleep 3', 500);
  arm('超时被报出（不是静默）', slow.timedOut === true, JSON.stringify(slow).slice(0, 80));

  let failed = 0;
  for (const a of arms) {
    if (!a.ok) failed += 1;
    console.log(`  ${a.ok ? '✅' : '🔴'} ${a.name} —— ${a.detail}`);
  }
  console.log(`\n臂数 ${arms.length}（由本脚本自己打印），失败 ${failed}`);
  return failed;
}

function main() {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  const markdown = readFileSync(LEDGER, 'utf8');
  if (process.argv.includes('--coverage')) {
    const unc = uncoveredCommands(readFileSync(join(ROOT, 'docs/plans/launch-blockers.md'), 'utf8'));
    const { mutating, readOnlyElsewhere, looksLikeOurs } = classifyUncovered(unc);
    console.log(`共 **${unc.length}** 条"像命令"的字符串**不会被跑**：`);
    console.log('');
    console.log(`· **按设计不跑（会改状态）**：${mutating.length} 条 —— ${mutating.slice(0, 4).join(' · ') || '（无）'}`);
    console.log(`· **只读、但不由本工具代跑**：${readOnlyElsewhere.length} 条`);
    console.log(`· 🔴 **本该跑却漏了（我们自己的参数）**：${looksLikeOurs.length} 条 —— ${looksLikeOurs.slice(0, 6).join(' · ') || '（无）'}`);
    console.log('');
    console.log('');
    console.log('📌 **这两类缺口都`不是`缺陷，当日核过**：');
    console.log('   · **`grep` 类（占只读那档的多数）**：`grep` 的退出码是**"没匹配 = 1"**，而很多读数**本来就期望 0 匹配**');
    console.log('     （"零调用点""零消费者"）⇒ **代跑它的 rc 没有意义**，只会把"期望的 1"当成红。');
    console.log('   · **我们自己的参数（`--all` / `--stale` …）**：**不能由本工具代跑** —— `--all` 里再跑 `--all` 会**递归**（`B27` 那族），');
    console.log('     而 `--stale` 读的是**当天日期**，代跑只会把"今天"写进一份**明天就过期**的输出。');
    console.log('   ⇒ 所以本模式**只报缺口、不假装能补**：真正能自动更新的，是 `--brief` 里"判据"那一档。');

    console.log(
      '⚠️ 这个函数的用途**不是再跑一遍**，而是把"没跑的"摆出来 —— ' +
        '免得"跑了 N 条"被读成"**全部命令都验过了**"（本仓那条：**静默跳过 = 假装验过**）。',
    );
    process.exit(0);
  }

  if (process.argv.includes('--blocks')) {
    const { blocks, skipped, placeholders } = extractBlocks(markdown);
    console.log(`抽到 ${blocks.length} 个代码块；**跳过 ${skipped.length} 个**（含改状态命令）：`);
    for (const s2 of skipped) console.log(`   ⏭️ 第 ${s2.index + 1} 块 —— 命中黑名单：${s2.why}`);
    for (const p2 of placeholders)
      console.log(`   📌 第 ${p2.index + 1} 块丢了 ${p2.dropped} 行**占位符**（如 \`cd <repo>\`）—— 那是对人说的说明，不是命令`);
    const out = [];
    for (const [i, body] of blocks.entries()) {
      // 🔴 **逐行取 rc，但整块一次跑**：`sh -c` 只给最后一条的 rc，
      //    于是"块 rc=0"会被读成"这一块每条都对" —— 而 §5 判据 ③ 本来就该红。
      //    这里在**每一行后面插一个 `echo RC<n>=$?`**：顺序与变量都保住（`U=…` 仍对后面的行可见），
      //    而每一行的读数各自可见。
      const lines = body
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('#'))
        // 🔴 ① **剥行尾注释**：块 2/4 的行写作 `node … # 说明` ⇒ 不剥的话我插的
        //    `; echo "RC…"` 会被 `#` 注释掉、一个 rc 都读不到（实测：报 "0 行"）。
        .map((l) => l.replace(/\s+#.*$/, ''))
        .filter((l) => l !== '')
        // 🔴 ② **剥掉作者自己写的 rc 打印**：有些行以 `; echo "rc=$?"` 结尾（作者故意打印它），
        //    不剥的话我插的探针测到的是那个 `echo` 的 rc ⇒ **恒为 0** ——
        //    实测它把**已知该红**的判据 ③（`gen-downloads --check`）显示成了 ✅。
        .map((l) => l.replace(/;\s*echo\s+["']rc=\$\?["'].*$/, ''))
        .filter((l) => l !== '');
      const instrumented = lines.map((l, k) => `${l}; echo "RC${k + 1}=$?"`).join('\n');
      const t0 = Date.now();
      const run = runCommand(instrumented, COMMAND_TIMEOUT_MS);
      const output = run.output;
      if (run.timedOut)
        console.log(`   🔴 第 ${i + 1} 块**超时**（${COMMAND_TIMEOUT_MS / 1000}s 上限）—— 那不等于"红"，是"没测到"`);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const rcs = [...output.matchAll(/RC(\d+)=(\d+)/g)].map((m) => ({
        line: Number(m[1]),
        rc: Number(m[2]),
        text: lines[Number(m[1]) - 1]?.slice(0, 58) ?? '',
      }));
      out.push({ i: i + 1, rcs, secs });
      const red = rcs.filter((r) => r.rc !== 0);
      console.log(`\n第 ${i + 1} 块（${secs}s）—— ${rcs.length} 行，红 ${red.length} 行：`);
      for (const r of rcs) {
        console.log(`   ${r.rc === 0 ? '✅' : '🔴'} rc=${r.rc}  ${r.text}`);
      }
    }
    console.log('\n===== 代码块汇总（逐行 rc）=====');
    const allRed = out.flatMap((b) => b.rcs.filter((r) => r.rc !== 0).map((r) => ({ block: b.i, ...r })));
    console.log(`跑了 ${out.length} 块；红的行 ${allRed.length} 条：`);
    for (const r of allRed) console.log(`   第 ${r.block} 块 · rc=${r.rc}  ${r.text}`);
    console.log(
      '⚠️ **红的行要对着块上方的注释读**：对账件里有些命令**本来就该红**（§5 判据 ① 的 curl **该 403**、' +
        '③ 的 `gen-downloads --check` **该 rc=1**）。本模式**不判断** rc 对不对。',
    );
    return;
  }

  const commands = extractCommands(markdown);
  if (commands.length === 0) {
    console.error('🔴 一条命令都没抽到 —— 对账件换了写法，本工具正在空转。');
    process.exit(1);
  }
  console.log(`抽到 ${commands.length} 条**去重后的**命令。`);
  if (selfSkipped > 0)
    console.log(
      `   ⏭️ **排掉了 ${selfSkipped} 条指向本工具自己的引用**（否则它会调用自己 ⇒ 无限递归；` +
        '见文件里那段注释）。⚠️ 那些引用在**对账件**里仍然有效 —— 它们是给人照着敲的。',
    );
  if (process.argv.includes('--list')) {
    for (const c of commands) console.log(`  ${c}`);
    return;
  }
  const results = [];
  for (const command of commands) {
    const [bin, ...args] = command.split(' ');
    const t0 = Date.now();
    let rc;
    const t = spawnSync(bin, args, { cwd: ROOT, stdio: 'ignore', timeout: COMMAND_TIMEOUT_MS });
    if (t.error?.code === 'ETIMEDOUT') rc = 'TIMEOUT';
    else rc = t.status ?? 'err';
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    results.push({ command, rc, secs });
    console.log(`${rc === 0 ? '✅' : '🔴'} ${command.padEnd(46)} rc=${rc} ${secs}s`);
  }
  const red = results.filter((r) => r.rc !== 0);
  console.log('\n===== 汇总 =====');
  console.log(`共 ${results.length} 条：绿 ${results.length - red.length} · 红 ${red.length}`);
  console.log(`🔴 红的那些（**逐条回行里核对它的读数是不是本来就该红**）：`);
  for (const r of red) console.log(`   ${r.command}  rc=${r.rc}`);
  console.log(
    '⏱ **每条命令 120 秒上限**（2026-10-16 改：原来 900 秒）。起因见对账件 B26 —— ' +
      '`verify:artifact-facts` 的 `hdiutil detach` 会**永久阻塞**，而旧上限让我的重跑' +
      '**堆了 30 个进程**、每个卡 6–7 分钟。⚠️ 超时在这里只表现为一个 rc≠0 的条目，' +
      '**不区分"红"与"挂了"** —— 要区分就去看它卡在哪条。',
  );
  console.log(
    '⚠️ 本工具**不判断** rc 对不对：对账件里 `check:reachability` / `check:payment-entry` 等' +
      '**本来就该红**（它们是待拍板的红，见 §7.1）。',
  );
}

// 🔴 **只在被直接跑的时候才执行**（2026-10-16 修）：
//    第一版写的是裸 `main();` —— 于是 `ledger-health.mjs` 只是想 import 一个
//    `extractCommands`，却把**整轮 13 条命令**又跑了一遍（实测：它先打出了一整屏汇总）。
//    与 `blocker-evidence-audit.mjs` 的写法对齐（那边一开始就有这道门）。
if (process.argv[1]?.endsWith('ledger-evidence-rerun.mjs')) main();

/**
 * **像命令、但抽取器不跑的那些**（`--coverage`）。
 *
 * 🔴 为什么要有：2026-10-16 量了一次 —— 对账件里有 **94** 条"看起来要执行的命令"（反引号里，以
 * `pnpm`/`node`/`git`/`grep`/`curl`/`dpkg`/… 开头），而 `extractCommands()` **只认 25 条**。
 * ⇒ 剩下 **69 条不会被跑**，其中三类各不相同：
 *
 *   ① **按设计不跑**：`git add` / `git mv` / `git checkout --` 这类**会改状态**的；
 *   ② **安全边界外的只读命令**：`grep` / `git ls-files` / `curl -sI` —— 它们**只读**，但不该由这个工具代跑
 *      （跑什么、在哪个目录跑，取决于是谁在读这段文档）；
 *   ③ 🔴 **本该跑却漏了的**：`--all`、`--bullet-structure` 这些**我自己的工具参数**，
 *      以及 `node -e "…"`（2026-10-16 那条 A6 自检就是这种形状，而它当时**跑不起来**）。
 *
 * ⇒ 所以这个函数的用途不是"再跑一遍"，而是**把"没跑的"摆出来** ——
 *    免得"跑了 25 条"被读成"**全部命令都验过了**"。
 */
export function uncoveredCommands(markdown) {
  const covered = new Set(extractCommands(markdown));
  const all = [...markdown.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());
  const looks = [...new Set(all)].filter((s) =>
    /^(pnpm|node|npx|git|grep|lsof|curl|hdiutil|aapt2|dpkg|sh|bash)\s/.test(s),
  );
  return looks.filter((s) => !covered.has(s));
}

/** 把"没跑的"粗分三类 —— **只是粗分**，别当成精确判据。 */
export function classifyUncovered(list) {
  const mutating = [];
  const readOnlyElsewhere = [];
  const looksLikeOurs = [];
  for (const s of list) {
    if (/^git (add|mv|rm|checkout|commit|restore|reset)/.test(s)) mutating.push(s);
    else if (/^node (research\/tools|scripts)\/.*\.mjs --/.test(s)) looksLikeOurs.push(s);
    else readOnlyElsewhere.push(s);
  }
  return { mutating, readOnlyElsewhere, looksLikeOurs };
}
