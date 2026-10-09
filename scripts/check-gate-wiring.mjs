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
 * node scripts/check-gate-wiring.mjs --pkg <path>              # 拿一份候选 package.json 试（注入验证用，不动工作树）
 * node scripts/check-gate-wiring.mjs --root <dir>              # 把"链外门禁的消费方"指到临时树（同上，只用于注入验证）
 * ```
 *
 * ## 2026-10-03 加的那一条：允许表**原本是装饰**
 *
 * `check:web-artifact:app` 在允许表里登记的是一条自我承认的缺口 ——
 * 「⚠️ 已知缺口：目前**没有任何自动载体**跑它」。而这条门禁绿。
 * 也就是说：一道链外门禁可以既不进链、也没人跑、还把"没人跑"写在理由里长期存在，
 * 三道判据一条都不会红。**不能失败的判据没有价值**（AGENTS §7 元规则 2），
 * 而这一条尤其坏：那句"已知缺口"读起来像是在管理风险，实际是在**给漏洞上户口**。
 *
 * 现实同时有一半是**否证的**：`server/Dockerfile` 的 web 构建阶段就在跑
 * `node scripts/check-web-artifact.mjs --dist apps/web/dist --mount /app/`（`:191`），
 * 所以"零自动消费者"讲的是那个 npm 别名，不是这条判据本身。
 * 真正没人守的是**人工 rsync 那一趟** —— 生产 `/app/` 到今天为止走的正是那条路
 * （§3.7 的发布命令），而它的三条抄件里 build 与 rsync 之间什么都没有。
 * ⇒ 这次两头都收了：runbook 的发布序列里插入对账（并修掉那三条里 `cd apps/web` 之后
 * rsync 源路径根本不存在那个断点），以及本文件把"链外必须有可验消费方"变成判据。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const argv = process.argv.slice(2);
let pkgPath = join(ROOT, 'package.json');
/**
 * 消费方文件的解析根。默认就是仓库根；`--root` 只为**注入验证**存在 ——
 * 把一份改坏的 `docs/runbooks/deployment.md` 放进临时目录指过来，就能证明这条判据会红，
 * 而不用去动工作树（工作树里有别的会话在飞）。
 */
let consumersRoot = ROOT;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--pkg') {
    pkgPath = resolve(argv[i + 1] ?? '');
    i += 1;
    continue;
  }
  if (argv[i] === '--root') {
    consumersRoot = resolve(argv[i + 1] ?? '');
    i += 1;
  }
}

/**
 * 链里**允许**不出现的 `check:*` 定义。每条都要写清"为什么不进链"，
 * 而且它必须仍然是一个真实存在的定义 —— 门禁拿掉了但这里还留着，同样判红。
 *
 * ## 🔴 而且必须**点名消费方**，并且那个消费方真的在跑它
 *
 * 原先进允许表只需要一句理由。理由不是判据 —— 2026-10-03 实测：`check:web-artifact:app`
 * 的条目里自己就写着「⚠️ 已知缺口：目前**没有任何自动载体**跑它」，而这条门禁照样绿。
 * 也就是说这道表当时的作用是**掩护**，不是**记账**：一道谁都不跑的门禁被写成"有意放在链外"，
 * 与"忘了加进链"在输出上长得一模一样，而前者还会挡住后来人去查。
 *
 * 现在的形状：每条 = 不进链的理由 + `consumers[]`，每个 consumer = 一个**会跑这条判据的载体文件**
 * 加一段它在该文件里必须逐字出现的 `needle`。
 *
 * ⚠️ **needle 是手写的字面量，并且按行首匹配**：派生匹配（"看文件名里有没有这个 gate 名"）会命中
 * 注释、命中别的门禁、命中"提到但没跑"的那一行；连 `includes` 都不够 —— 见下面判据 `2b` 的注释。
 * 这里要的判据是**这一行会执行它**，所以 needle 取真实命令形状，且指令前缀要一起写进去
 * （Dockerfile 写成 `RUN node scripts/… --mount /app/`，markdown 代码块里就写 `pnpm check:…`）。
 * 判"有没有人跑它"一旦靠模糊匹配，就又是一条永远绿的空判据（AGENTS §7 元规则 2）。
 */
const ALLOWED_OUTSIDE_CHAIN = new Map([
  [
    'check:web-artifact:app',
    {
      reason:
        '它读的是 `HEYTA_WEB_BASE=/app/` 那份产物，而 `pnpm build` 打的是默认根路径那份 —— ' +
        '进链就是拿错的产物去验对的东西（`apps/web/dist` 是**一个目录、两种载体**，谁最后构建谁覆盖谁）。' +
        '⇒ 判它的载体是"发布那一趟"和"建镜像那一趟"，不是"每次提交那一趟"。',
      consumers: [
        {
          file: 'docs/runbooks/deployment.md',
          needle: 'pnpm check:web-artifact:app',
          role: '人工发布 rsync **之前**那一步（§3.7「重新发布的三条命令」；干净 HEAD 那一组同样带着它）',
        },
        {
          file: 'server/Dockerfile',
          needle: 'RUN node scripts/check-web-artifact.mjs --dist apps/web/dist --mount /app/',
          role: '镜像构建阶段自动跑 —— 这是**同一条判据**的自动载体（跑的是脚本本身，不是 npm 别名）',
        },
      ],
    },
  ],
  [
    'check:android-build-host',
    {
      reason:
        'Android 构建主机规则的**第二枚**门禁（模拟器侧 / 文档侧 / runbook 死链 / 载体对账）。' +
        '同批的另一枚 `check:android-gradle-remote` 已经在链里，这一枚**本批刻意不进链**：' +
        '`check` 那条 `&&` 串的分母正被并行会话计数（现量方式写在手册 §七 那条里），' +
        '此时并进去会把别人的读数改成谁都对不上。⇒ 判它的载体现在是"照着手册跑远程构建那一趟"，' +
        '不是"每次提交那一趟"。' +
        '🔴 摘除条件：并行那批不再引用链段数之后把它并进链，并**同时删掉本条登记** ——' +
        '登记留着而它已进链，本文件第 2 条判据会红（"留着就是在掩护下一道"）。',
      consumers: [
        {
          file: 'docs/runbooks/android-build-on-windows.md',
          needle: 'pnpm check:android-build-host',
          role: '手册 §八 的代码块 —— 第一次真远程构建之前要跑的那条（也是本批唯一的载体）',
        },
      ],
    },
  ],
  [
    'check:adr-numbering',
    {
      reason:
        'ADR 编号唯一 + 正文里裸写的 `ADR-NNNN` 必须只指向一枚文件。' +
        '它拦的是 2026-10-05 那次**两条并行会话同一天各占 0053**：文件名不同 ⇒ git 不报冲突，' +
        '每条链接各指各的 ⇒ 死链检查也不报，只有正文里的裸引用从此有两种读法，而挑错那种不会让任何东西红。' +
        '🔴 **本批刻意不进链的唯一原因是提交面上的**：`package.json` 里 `check` 那一行此刻正被并行会话' +
        '的未提交改动占着（同一行加 `check:backup-retention`），同一行无法按 hunk 拆开暂存 ⇒ ' +
        '此刻并进去就等于替别人提交他那半。' +
        '摘除条件：并行那半进 main 之后，把 `pnpm check:adr-numbering` 并进链（建议紧跟 `check:doc-citations`），' +
        '并**同时删掉本条登记** —— 登记留着而它已进链，本文件第 2 条判据会红（"留着就是在掩护下一道"）。',
      consumers: [
        {
          file: 'docs/adr/README.md',
          needle: 'pnpm check:adr-numbering',
          role: '「规则」第 2 条：定新 ADR 号之前要跑的那一趟（本批唯一的载体）',
        },
      ],
    },
  ],
]);

/**
 * 树上存在、但**没有任何 package.json 定义引用**的 `scripts/check-*.mjs`。
 *
 * ## 为什么需要这一张表（2026-10-06 加）
 *
 * 上面 1/3/3b 三条判据的分母都来自 `pkg.scripts` 的键，所以"一枚从没写进 package.json 的
 * 实现文件"落在三条之外：它不是"定义了没接链"（没有定义），也不是"链上引用了不存在的文件"
 * （链上没有它）。于是它 0 次执行，而门禁绿得像"全都对上了"。
 * 第一例是 `scripts/check-e2e-helper-exports.mjs`（17.7 KB / 自带 8 臂自检 / rc=0 /
 * 射程 121 份文件、对账 414 个导入名），它文件头那句"由 pnpm check 调用"在接链之前
 * **没有一行代码兑现** —— 与 10-04 那次"sync-client 里那句没有代码兑现的谎话"同一族。
 *
 * ⚠️ 这张表**不是**"允许表"的第二份，判据形状与第 2 条完全一样：理由 + 可验消费方
 * （行首锚定的 needle，"提到"不算）。填不满这条的，正确出路是**给它加定义并接进链**，
 * 不是往这里写一行。
 */
const ALLOWED_UNREFERENCED_IMPL = new Map([
  [
    'check-module-boundaries.mjs',
    {
      reason:
        '三个 AI 模块的**写入租约**门禁：它判的是"这一笔改动有没有越到别人的模块里"，' +
        '输入是**分支/修订号**（`--module 2 --rev <fork>`），不是工作树 —— ' +
        '放进 `pnpm check` 那条无参数的链里它没有可判的对象。⇒ 判它的载体是"照着并行开工手册跑那一趟"。',
      consumers: [
        {
          file: 'docs/plans/ai-remediation-parallel-runbook.md',
          needle: 'node scripts/check-module-boundaries.mjs --module 2 --rev ai-remediation-fork',
          role: '手册里"开工前 / 合流前"各跑一次的那条命令（§开工门 与 §合流门 两处代码块）',
        },
      ],
    },
  ],
  [
    'check-ratchet-ceilings.mjs',
    {
      reason:
        '棘轮的**另一半**（"不许把基线本身抬高"）。它需要 `git merge-base main HEAD` 那个锚点，' +
        '而在打包机/CI 的 detached 或浅检出上锚点不可靠 ⇒ 现在由**变异台架**跑它，' +
        '不在每次提交的链里。',
      consumers: [
        {
          file: 'research/tools/mutation-rigs/mutate-ratchet-ceilings.mjs',
          needle: "const GATE = join(ROOT, 'scripts', 'check-ratchet-ceilings.mjs');",
          role: '它的拒绝臂：这台架每次跑都真的 spawn 这道门禁（GATE 常量就是被 spawn 的那一枚）',
        },
      ],
    },
  ],
  [
    'check-imports-resolve.mjs',
    {
      reason:
        '它判的是**某一枚 ref 自不自洽**（引用在册、实现不在册 ⇒ 干净检出打不出包），' +
        '输入是修订号而不是工作树，所以放进 `pnpm check` 那条无参数的链里它只会反复判 HEAD 同一枚对象。' +
        '而 2026-10-09 这一轮它现量到 HEAD 上还有 9 条构建输入红，全是别的线**正在写**的实现文件' +
        '（`packages/ui` 七枚组件、`packages/app-host` 的 task-batch-actions、`apps/web` 的 native-widgets）' +
        '⇒ 现在就接进链 = 把别人的红挂到本线提交上，且本线无法替他们变绿。' +
        '那九条清完（`--sources-only` 报 0）就是它转正的时刻，判据口径一个字不动。',
      consumers: [
        {
          file: 'docs/plans/account-standard-suite.md',
          needle: 'node scripts/check-imports-resolve.mjs --sources-only',
          role:
            '§6.38 那张用法表（取证与转正判据都写在那里）；§6.39 用它校验设备腿叠加载体的自洽性 ' +
            '（`--tree <叠加提交> --sources-only` 必须报绿才敢起跑）',
        },
      ],
    },
  ],
]);

/** 链必须包含的锚点：掉哪一个都是"整条链不再检查一件事"级别的事故。 */
const REQUIRED_ANCHORS = [
  // §7 第 57 条：这道曾经整条不在链里，于是 apps/web 的测试红了很久都没有任何东西失败。
  'pnpm -r test',
  // packages/*/dist 是各端打包输入，不先 build 就是在验旧产物（§7 第 27 条）。
  'pnpm build',
  // 🔴 判据 1 抓的是"定义在、链里没有"。而**整文件覆盖**会同时抹掉定义与链段 ——
  // 那种形状下判据 1 看不到任何东西（2026-10-04 现量：把两者一起摘掉 ⇒ rc=0）。
  // 这是自托管批次往链里加的唯一一段（载体 77 段 = main 76 + 它），
  // 落地后谁拿自己那份 stale base 提交 `package.json`，它就会静默消失。
  'pnpm check:image-build-args',
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

// 2) 允许表不能比现实宽，也不许**空着**（每条链外门禁都要有可验的消费方）
const consumerReadings = [];
for (const [name, entry] of ALLOWED_OUTSIDE_CHAIN) {
  if (!(name in (pkg.scripts ?? {}))) {
    failures.push(`${name}: 允许表说它是一道"链外门禁"，但 package.json 里已经没有这个定义了。`);
  }
  if (inChain.has(name)) {
    failures.push(`${name}: 它已经回到链里了，允许表里那条理由该删 —— 留着就是在掩护下一道。`);
  }
  if (typeof entry?.reason !== 'string' || entry.reason.trim().length === 0) {
    failures.push(`${name}: 允许表条目没有"为什么不进链"的理由。没理由的豁免与没有豁免是同一种东西。`);
  }

  // 2a) 非空哨兵：`consumers` 为空 ⇒ 这道门禁**没有任何载体在跑**。
  //     这不允许写成一条注释。原先那条评论就写着"没有任何自动载体跑它"，而门禁绿。
  const consumers = Array.isArray(entry?.consumers) ? entry.consumers : [];
  if (consumers.length === 0) {
    failures.push(
      `${name}: 在允许表里但**没有 consumers** ⇒ 没人跑它。` +
        '它不是"手动跑的那一条"，它是"没有人跑的那一条" —— 链外门禁必须有名字可点的载体，' +
        '否则"有意放在链外"就成了"忘了加进链"的掩护。',
    );
    continue;
  }

  // 2b) 逐个消费方：文件要在，needle 要逐字出现。
  for (const consumer of consumers) {
    const abs = join(consumersRoot, consumer.file);
    if (!existsSync(abs)) {
      failures.push(
        `${name} 的消费方 \`${consumer.file}\` 不存在 —— 载体被改名/删掉/挪走了，` +
          '而这里还登记着它。链外门禁的载体一旦消失，这道门禁就静默变成 0 次执行。',
      );
      continue;
    }
    if (typeof consumer.needle !== 'string' || consumer.needle.length === 0) {
      failures.push(`${name} 的消费方 \`${consumer.file}\` 没有 needle —— "它在那里被提到了"不算消费。`);
      continue;
    }
    const lines = readFileSync(abs, 'utf8').split('\n');
    // 🔴 **行首锚定**，不是 `includes`：写这条判据的当天，runbook 里就多了一句散文式的"这里少了
    // `pnpm check:web-artifact:app`"—— 它不是消费方，但它会让 includes 数到一次命中，
    // 于是两条真正的命令块都被删掉时门禁仍然绿。模糊匹配把"提到"当成"跑过"，
    // 正是这条门禁要防的形状（AGENTS §7 元规则 2）。
    // ⇒ needle 要连指令前缀一起写（Dockerfile 是 `RUN …`、markdown 代码块里就是命令本身）。
    const hits = lines.reduce((n, l) => (l.trimStart().startsWith(consumer.needle) ? n + 1 : n), 0);
    if (hits === 0) {
      failures.push(
        `${name} 的消费方 \`${consumer.file}\` 里没有任何一行**以这条命令开头**：\n      ${consumer.needle}\n` +
          `      （\`${consumer.role}\`）—— 那一趟不再跑这条判据了，而链外门禁**只有**那一趟会跑它。\n` +
          '      ⚠️ 行首锚定：散文里"提到"它不算消费（needle 要包含 `RUN ` 这类指令前缀）。',
      );
      continue;
    }
    consumerReadings.push(`${name} ← ${consumer.file}（${String(hits)} 处）`);
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

// 3b) 链里每道门禁的**实现文件**必须在这棵树上存在 —— 判的是"接缝上的红"。
//
// 上面第 1/3 条核对的是**定义与链的对齐**，它看不到"定义与链都对、实现文件不在树上"这一种：
// `package.json` 与 `scripts/*.mjs` 由不同的人分别提交时，链可以先被推进而实现还捏在别人手里没进 git。
// 后果不是"少跑一段"，是那一整段以 `MODULE_NOT_FOUND` 红，**且排在它后面的链根本不跑**。
// 2026-10-04 14:4x 现场就是那个形状：主检出的链里多了 5 道门，其中 3 道的实现文件**未跟踪**
// （审计 §8.85 记了逐枚状态），而 `pnpm check` 当时照样全绿 —— 因为它跑的是工作树，文件在盘上。
//
// ⚠️ 只判"定义里认得出 `node|bash|sh <仓库内路径>`"的那些；带 `cd` 的（相对哪个目录不确定）、
// `pnpm --filter X <script>`（实现住在各包自己的 package.json 里）都不判。
// 🔴 判了几段、跳了几段**必须打出来**：一个静默的 0 会把"探针没接上"读成"全都对上了"（§7 元规则 2）。
const implOk = [];
const implSkipped = [];
for (const name of chainTokens) {
  const def = pkg.scripts[name];
  if (typeof def !== 'string' || /\bcd\s+\S+&&/.test(def.replace(/\s+/g, ' '))) {
    implSkipped.push(name);
    continue;
  }
  const paths = [...def.matchAll(/(?:^|[\s;&(])(?:node|bash|sh)\s+([\w./-]+\.(?:mjs|cjs|js|ts|sh))(?=$|[\s;&)])/g)]
    .map((m) => m[1].replace(/^\.\//, ''))
    .filter((p) => !p.split('/').includes('node_modules'));
  if (paths.length === 0) {
    implSkipped.push(name);
    continue;
  }
  for (const rel of paths) {
    implOk.push(name);
    if (!existsSync(join(ROOT, rel))) {
      failures.push(
        `${name}: 链里有它、定义也在，但它指的 \`${rel}\` **不在这棵树上** —— ` +
          '要么实现文件没跟着 `package.json` 一起提交，要么被挪走而这里还指着旧路径。' +
          '链是文本级的，这种断点 `merge-tree` 与第 1/3 条都看不见。',
      );
    }
  }
}

// 5) 🔴 反方向：树上每一枚 `scripts/check-*.mjs` 都必须被**某条定义**引用，否则它一次都不会被跑。
//
// 上面 1/3/3b 三条的分母都来自 `pkg.scripts` 的键，所以"一枚从没写进 package.json 的实现文件"
// 落在三条之外：它不是"定义了没接链"（没有定义），也不是"链上引用了不存在的文件"（链上没有它）。
// 2026-10-06 的第一例是 `scripts/check-e2e-helper-exports.mjs`（17.7 KB / 自带 8 臂自检 / rc=0 /
// 射程 121 份文件、对账 414 个导入名），它文件头那句"由 pnpm check 调用"在接链之前
// **没有一行代码兑现** —— 与 10-04 那次"sync-client 里那句没有代码兑现的谎话"同一族。
const implOnDisk = readdirSync(join(ROOT, 'scripts'))
  .filter((f) => /^check-.*\.mjs$/.test(f))
  .sort();
const defText = Object.values(pkg.scripts ?? {})
  .filter((v) => typeof v === 'string')
  .join('\n');
const orphanImpl = implOnDisk.filter((f) => !defText.includes(f));
const orphanReadings = [];
for (const f of orphanImpl) {
  const entry = ALLOWED_UNREFERENCED_IMPL.get(f);
  if (!entry) {
    failures.push(
      `scripts/${f}: 这枚门禁实现**没有任何 package.json 定义引用它** ⇒ 0 次执行，而链照样绿。` +
        '要么给它加定义并接进链（正确出路），要么进 `ALLOWED_UNREFERENCED_IMPL` 并点名**可验的**消费方。',
    );
    continue;
  }
  if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0) {
    failures.push(`scripts/${f}: 登记在"无定义"表里没有理由。没理由的豁免与没有豁免是同一种东西。`);
  }
  const consumers = Array.isArray(entry.consumers) ? entry.consumers : [];
  if (consumers.length === 0) {
    failures.push(
      `scripts/${f}: 登记了但没有 consumers ⇒ 没人跑它。` +
        '"手动跑的那一条"必须能指出**哪一趟**跑它，否则这张表就是"忘了加定义"的掩护。',
    );
    continue;
  }
  for (const consumer of consumers) {
    const abs = join(consumersRoot, consumer.file);
    if (!existsSync(abs)) {
      failures.push(
        `scripts/${f} 的消费方 \`${consumer.file}\` 不存在 —— 载体被改名/删掉/挪走了，而这里还登记着它。`,
      );
      continue;
    }
    if (typeof consumer.needle !== 'string' || consumer.needle.length === 0) {
      failures.push(`scripts/${f} 的消费方 \`${consumer.file}\` 没有 needle —— "被提到了"不算消费。`);
      continue;
    }
    // 行首锚定，与第 2b 条同一口径：散文里提到一次就能把豁免坐实，那这条判据就是装饰。
    const hits = readFileSync(abs, 'utf8')
      .split('\n')
      .reduce((n, l) => (l.trimStart().startsWith(consumer.needle) ? n + 1 : n), 0);
    if (hits === 0) {
      failures.push(
        `scripts/${f} 的消费方 \`${consumer.file}\` 里没有任何一行**以这条命令开头**：\n      ${consumer.needle}\n` +
          `      （\`${consumer.role}\`）—— 那一趟不再跑它了。⚠️ 行首锚定：散文里"提到"不算。`,
      );
      continue;
    }
    orphanReadings.push(`${f} ← ${consumer.file}（${String(hits)} 处）`);
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
console.log(
  `   · 实现文件判了 ${implOk.length} 段、跳过 ${implSkipped.length} 段（带 cd / --filter / 非 node|bash|sh 的形状）`,
);
for (const r of consumerReadings) console.log(`   · 链外门禁的消费方：${r}`);
console.log(
  `   · 树上 check-*.mjs ${implOnDisk.length} 枚 ｜ 没有任何定义引用的 ${orphanImpl.length} 枚` +
    `（登记 ${ALLOWED_UNREFERENCED_IMPL.size} 条，每条都要有可验消费方）`,
);
for (const r of orphanReadings) console.log(`   · 无定义实现的消费方：${r}`);

if (failures.length > 0) {
  for (const f of failures) console.error('🔴 ' + f);
  console.error(`\n共 ${failures.length} 处。`);
  process.exit(1);
}

console.log(
  '✅ check 链与门禁定义对上了（链外逐条有理由+可验消费方、锚点在场、树上没有"写了没人引用"的门禁实现）',
);
