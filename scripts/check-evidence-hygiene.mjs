#!/usr/bin/env node
/**
 * 门禁：证据目录只存证据（`pnpm check:evidence-hygiene`）
 * ============================================================================
 *
 * ## 它挡的是什么（这次不是假想，是实测读数）
 *
 * 2026-10-16 现量：`~/.heyta-evidence` 长到 **9.5 GB / 148 个目录**，而里面真正的
 * "证据"（截图 png、build log、diff patch、`rc.txt`）只有 **几 MB** —— 98% 是
 * **构建产物**被一起拷了进去：
 *
 * | 内容 | 体积 |
 * |---|---|
 * | `…/leg3-1020-1101/heyta-ios-release`（一个 iOS Release 构建） | 5.3 GB |
 * | `ux-r55/rt4/heyta-ios-release` | 931 MB |
 * | `ux-r55/rt`、`ux-r49/rt` 的 iOS 构建 | 925 MB + 930 MB |
 * | 3 份 `heyta-macos-dist`（`.app` + `widget-build`） | 1.3 GB |
 *
 * 形状很清楚：验收脚本"为了留证"把 `heyta-ios-release/`、`heyta-macos-dist/`、
 * `DerivedData/` 拷进证据目录，然后**没有任何一层会删它**。
 * ⇒ **产物和证据住在同一个目录里，而且没有收尾删除**，于是它每一轮都复发一次。
 *
 * "下次记得删"不是判据（AGENTS §6 第 2 条：不能失败的检查没有价值）。这道门禁把
 * "证据目录里只有证据"变成机器能判的四条：
 *
 *   1. **按名字**：产物目录/文件出现在 evidence 根下就红 ——
 *      `.app` `.dmg` `.xcarchive` `.dSYM` `DerivedData` `node_modules` `Pods` `.build`
 *      `test-results` `heyta-ios-release` `heyta-macos-dist` `build` `xcodebuild`。
 *      🔴 `build` / `xcodebuild` 只认这两枚**明确名单**，不是"所有叫 build 的都打死"：
 *      收这条之前已 grep 过全仓 evidence 根，**0 个**合法的 `evidence/**\/build/`
 *      （真要有人往证据里放一个叫 build 的目录，改名比放宽这条更便宜）。
 *   2. **按单文件体积**：证据是截图与日志。单个文件 > `--max-file-mb`（默认 25）
 *      基本就是产物或整包 —— 这个量级上截图/日志都还有余量，`.app` 里随便一个二进制也没有。
 *   3. **按单个 root 总量**：这是**唯一**挡得住"9.5 GB"的量纲判据。
 *      逐个文件查不出来 —— 罪恶在于量，不在于某一个文件坏。
 *   4. **按环境**：显式 `--root` 指了不存在的目录 ⇒ 红（退出码 2）。
 *      "我把参数写错了/我以为它在那儿"与"这里本来就没有"是两件事，不许糊成一件事。
 *
 * ## 📌 预算按 root **所在位置**分两档（每个 root 的预算都在输出里逐条打印）
 *
 *   · **仓库内** root（`apps/*\/evidence`、`packages/*\/evidence`、`docs/**\/evidence`、
 *     `research/**\/evidence`）= **800 MB**。
 *     理由：本仓库的约定就是**截图证据入库**。现量 `apps/mobile/evidence` 410 MB /
 *     `apps/web/evidence` 261 MB，全是已跟踪的截图。拿外部那一档（300 MB）去卡它们
 *     只会得到**假红**，而假红会让这道门禁被人关掉 —— 那比没有门禁更糟
 *     （AGENTS §7 元规则 2 的另一面：一条永远红的判据和一条永远绿的判据同罪）。
 *   · **仓库外** root（`$HEYTA_EVIDENCE_ROOT`，默认 `$HOME/.heyta-evidence`）= **300 MB**。
 *     9.5 GB 那次事故就发生在这一档，这条预算要抓的正是它。
 *   · `--max-root-mb` **覆盖两档**（显式给值 = "我知道我在干什么"）。
 *
 * ## 🔴 为什么"不存在"必须打印原因，而不能安静地过
 *
 * CI 上 `$HOME/.heyta-evidence` **不存在**（它不在仓库里，CI 也从未跑过验收）。
 * 若"不存在"等于"没问题"，CI 绿就会被读成"本机证据目录干净" —— 这两件事毫无关系。
 * ⇒ 默认集合里不存在的路径一律打印跳过原因；只有**显式** `--root` 才判红。
 *
 * ## 用法
 *
 * ```sh
 * pnpm check:evidence-hygiene                        # 默认集合（仓库内 + $HEYTA_EVIDENCE_ROOT）
 * HEYTA_EVIDENCE_ROOT=$HOME/.heyta-evidence pnpm check:evidence-hygiene   # 本机显式点名
 * node scripts/check-evidence-hygiene.mjs --root apps/mobile/evidence --json
 * node scripts/check-evidence-hygiene.mjs --max-root-mb 500 --max-file-mb 10
 * node scripts/check-evidence-hygiene.mjs --self-test     # 四红一绿（臂数由它自己打印）
 * ```
 *
 * 退出码：`0` 全过 · `1` 有违规 · `2` 用法或环境错误（含 `--root` 指了不存在的目录）。
 *
 * ## 自检为什么是"注入 → 红 → 删掉 → 绿"
 *
 * 只证明"注入了会红"是不够的：一条**永远红**的判据也会通过那一关（例如把所有东西
 * 都当产物）。所以每一条内容判据都跑两遍 —— 注入时红、把那条违规删掉必须**变绿**。
 * 这一步是 AGENTS §6 第 2 条的硬规矩在本文件里的落地，不是锦上添花。
 *
 * 这个脚本**只读**，不删任何文件（`--dry-run` 不需要：它本来就不动东西）。
 */

import {
  closeSync,
  existsSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const MB = 1024 * 1024;

/** 仓库内 root 的预算。理由见文件头「预算按 root 所在位置分两档」。 */
export const REPO_ROOT_BUDGET_MB = 800;
/** 仓库外 root（`$HEYTA_EVIDENCE_ROOT`）的预算 —— 9.5 GB 那次事故的量纲判据。 */
export const EXTERNAL_ROOT_BUDGET_MB = 300;
export const DEFAULT_MAX_FILE_MB = 25;

/**
 * 产物目录/文件的**明确名单**。
 *
 * `kind` 分开写不是为了严格，是为了报错行能说清"你混进来的是一个目录还是一个文件"：
 * `.app` / `.dmg` 既可能是目录也可能是文件（`.dmg` 只能是文件，`.app` 在 macOS 上
 * 恒为目录，但被打包工具拷成单文件的情况也见过），两种都收。
 */
const ARTIFACT_RULES = [
  { rule: 'artifact-dir:*.app', kind: 'dir', re: /\.app$/ },
  { rule: 'artifact-dir:*.xcarchive', kind: 'dir', re: /\.xcarchive$/ },
  { rule: 'artifact-dir:*.dSYM', kind: 'dir', re: /\.dSYM$/ },
  { rule: 'artifact-dir:DerivedData', kind: 'dir', re: /^DerivedData$/ },
  { rule: 'artifact-dir:node_modules', kind: 'dir', re: /^node_modules$/ },
  { rule: 'artifact-dir:Pods', kind: 'dir', re: /^Pods$/ },
  { rule: 'artifact-dir:.build', kind: 'dir', re: /^\.build$/ },
  { rule: 'artifact-dir:heyta-ios-release', kind: 'dir', re: /^heyta-ios-release$/ },
  { rule: 'artifact-dir:heyta-macos-dist', kind: 'dir', re: /^heyta-macos-dist$/ },
  // 只有这两枚：`build` 与 `xcodebuild` 的**目录名**。不是"所有 build 都死"。
  { rule: 'artifact-dir:build', kind: 'dir', re: /^(?:build|xcodebuild)$/ },
  { rule: 'artifact-dir:test-results', kind: 'dir', re: /^test-results$/ },
  { rule: 'artifact-file:*.dmg', kind: 'file', re: /\.dmg$/ },
  { rule: 'artifact-file:*.app', kind: 'file', re: /\.app$/ },
];

/** 遍历上限：撞上就截止并把总量标成 `≥`。为的是"就算有人把 5.3 GB 的 .app 塞进来，门禁也别卡死"。 */
const WALK_ENTRY_CAP = 400_000;

const USAGE = `证据目录卫生门禁（只读，不删任何文件）

  pnpm check:evidence-hygiene
  node scripts/check-evidence-hygiene.mjs [选项]

扫描对象（存在才扫，不存在就打印跳过原因）：
  仓库内   apps/*/evidence  packages/*/evidence  docs/**/evidence  research/**/evidence
  仓库外   $HEYTA_EVIDENCE_ROOT（默认 $HOME/.heyta-evidence）

选项：
  --root <dir>        只扫这一个 root（可重复）。**覆盖**上面的默认集合；指了不存在的目录 ⇒ 退出码 2
  --max-root-mb <n>   单个 evidence 根的总预算，**覆盖**两档默认值
                      （仓库内 ${REPO_ROOT_BUDGET_MB} MB / 仓库外 ${EXTERNAL_ROOT_BUDGET_MB} MB，逐 root 打印用的是哪一档）
  --max-file-mb <n>   单文件体积上限，默认 ${DEFAULT_MAX_FILE_MB}
  --json              机器可读输出（只输出 JSON，不输出表格）
  --self-test         在临时目录造 fixture 自检（四红一绿，每条判据都验"删掉违规必须变绿"）
  -h, --help          本帮助

退出码：0 全过 · 1 有违规 · 2 用法或环境错误`;

/** 数字参数：必须有限且 > 0。写错了是**用法错误**（2），不是"用默认值继续"。 */
function parsePositiveNumber(raw, flag) {
  if (raw === undefined) return { error: `${flag} 后面要跟一个数字（MB）` };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { error: `${flag} 需要 > 0 的数字，收到：${String(raw)}` };
  return { value: n };
}

function parseArgs(argv) {
  const opts = { roots: [], maxRootMB: null, maxFileMB: DEFAULT_MAX_FILE_MB, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--root') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: '--root 后面要跟一个目录' };
      opts.roots.push(resolve(v));
      i += 1;
    } else if (a === '--max-root-mb') {
      const r = parsePositiveNumber(argv[i + 1], '--max-root-mb');
      if (r.error) return r;
      opts.maxRootMB = r.value;
      i += 1;
    } else if (a === '--max-file-mb') {
      const r = parsePositiveNumber(argv[i + 1], '--max-file-mb');
      if (r.error) return r;
      opts.maxFileMB = r.value;
      i += 1;
    } else if (a === '--json') {
      opts.json = true;
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    } else {
      return { error: `不认识参数：${a}` };
    }
  }
  return { opts };
}

/** 这个 root 是不是在仓库里（仓库内/仓库外两档预算的唯一依据）。 */
function isInsideRepo(absPath) {
  const rel = relative(REPO_ROOT, absPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * 某个 root 用哪一档预算。导出是给 `--self-test` 的臂 5 用的：
 * "仓库内 800 / 仓库外 300 / 显式覆盖两档"这三件事必须能被断言，否则它就是散文。
 */
export function budgetMBFor(rootAbs, overrideMB) {
  if (typeof overrideMB === 'number') return overrideMB;
  return isInsideRepo(rootAbs) ? REPO_ROOT_BUDGET_MB : EXTERNAL_ROOT_BUDGET_MB;
}

function isDir(p) {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

function artifactRuleFor(name, kind) {
  for (const r of ARTIFACT_RULES) {
    if (r.kind === kind && r.re.test(name)) return r.rule;
  }
  return null;
}

/** 递归找 `docs/**\/evidence` / `research/**\/evidence`：只收**目录名就叫 evidence** 的那些。 */
function findEvidenceDirs(base, out) {
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const p = join(base, e.name);
    if (e.name === 'evidence') {
      out.push(p);
      continue; // 证据根内部不再找"嵌套证据根"，那是同一个 root
    }
    findEvidenceDirs(p, out);
  }
}

/**
 * 默认集合 + 每条的跳过原因。
 *
 * ⚠️ 跳过必须**打印**：静默跳过在读数上和"没扫到"完全一样（这条纪律在
 * `scripts/clean-build-tmp.sh` 的凭据白名单里已经写过一次）。
 */
function defaultRoots() {
  const groups = [];
  const skipped = [];

  for (const bucket of ['apps', 'packages']) {
    const base = join(REPO_ROOT, bucket);
    const matches = [];
    if (!isDir(base)) {
      skipped.push({ path: `${bucket}/*/evidence`, reason: `仓库里没有 ${bucket}/ 这一层` });
      continue;
    }
    for (const child of readdirSync(base).sort()) {
      if (!isDir(join(base, child))) continue;
      if (isDir(join(base, child, 'evidence'))) matches.push(join(base, child, 'evidence'));
    }
    if (matches.length === 0) {
      skipped.push({ path: `${bucket}/*/evidence`, reason: `没有任何 ${bucket}/*/ 带 evidence/ 目录` });
      continue;
    }
    groups.push({ pattern: `${bucket}/*/evidence`, matches });
  }

  for (const tree of ['docs', 'research']) {
    const base = join(REPO_ROOT, tree);
    if (!isDir(base)) {
      skipped.push({ path: `${tree}/**/evidence`, reason: `仓库里没有 ${tree}/` });
      continue;
    }
    const matches = [];
    findEvidenceDirs(base, matches);
    if (matches.length === 0) {
      skipped.push({ path: `${tree}/**/evidence`, reason: `一棵 ${tree}/ 里没有名为 evidence 的目录` });
      continue;
    }
    groups.push({ pattern: `${tree}/**/evidence`, matches: matches.sort() });
  }

  const envSet = Boolean(process.env.HEYTA_EVIDENCE_ROOT);
  const external = process.env.HEYTA_EVIDENCE_ROOT
    ? resolve(process.env.HEYTA_EVIDENCE_ROOT)
    : join(homedir(), '.heyta-evidence');
  if (isDir(external)) {
    groups.push({ pattern: envSet ? '$HEYTA_EVIDENCE_ROOT' : '$HOME/.heyta-evidence', matches: [external] });
  } else {
    skipped.push({
      path: external,
      reason: envSet
        ? '$HEYTA_EVIDENCE_ROOT 指向的目录不存在'
        : '本机没有默认外部证据目录（CI 上正常：它不在仓库里）—— 🔴 所以"CI 绿"不等于"本机证据目录干净"',
    });
  }

  return { groups, skipped };
}

function formatBytes(bytes) {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

/**
 * 扫一个 root。返回累计总量、文件数、逐条违规。
 *
 * 产物目录**照样走进去累体积**（否则 root 总预算会少报，而那条正是要挡 9.5 GB 的判据），
 * 但**不再在里面逐文件报违规** —— 一个 5.3 GB 的 `.app` 里有五万个文件，
 * 报五万行等于没报。产物子树里只保留那一条目录级的红。
 */
function scanRoot(rootAbs, budgetMB, maxFileMB, rootSet) {
  const violations = [];
  const nestedRoots = [];
  let totalBytes = 0;
  let fileCount = 0;
  let capped = false;
  const maxFileBytes = maxFileMB * MB;

  const stack = [{ abs: rootAbs, inside: null }];
  while (stack.length > 0) {
    const frame = stack.pop();
    let entries;
    try {
      entries = readdirSync(frame.abs, { withFileTypes: true });
    } catch {
      continue; // 读不动的目录（权限/竞态）不判红：这不是"证据卫生"能回答的问题
    }
    for (const e of entries) {
      if (fileCount > WALK_ENTRY_CAP) {
        capped = true;
        break;
      }
      // 符号链接一律不进：跟进去会把扫描面拖到证据目录之外（甚至拖成环）。
      if (e.isSymbolicLink()) continue;
      const abs = join(frame.abs, e.name);
      if (e.isDirectory()) {
        if (abs === rootAbs) continue;
        // 嵌套证据根：它有**自己的**预算，在这里不再计入本 root，否则同一个字节被两个预算数一遍。
        if (rootSet.has(abs)) {
          nestedRoots.push(abs);
          continue;
        }
        const rule = artifactRuleFor(e.name, 'dir');
        let inside = frame.inside;
        if (rule && inside === null) {
          // 🔴 必须是**同一个对象**：体积是在往下走的时候累加到 `inside` 上的，
          // 先前这里 push 了一份副本 ⇒ 报错行永远显示 0.0 MB（自己抓到过一次：
          // 5 GB 的 `heyta-ios-release` 打出来是 0.0 MB，报错行把事故说小了）。
          inside = { rule, path: abs, bytes: 0, kind: 'dir' };
          violations.push(inside);
        }
        stack.push({ abs, inside });
        continue;
      }
      if (!e.isFile()) continue;
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      fileCount += 1;
      totalBytes += st.size;
      if (frame.inside !== null) {
        frame.inside.bytes += st.size;
        continue;
      }
      const fileRule = artifactRuleFor(e.name, 'file');
      if (fileRule) {
        violations.push({ rule: fileRule, path: abs, bytes: st.size, kind: 'file' });
        continue;
      }
      if (st.size > maxFileBytes) {
        violations.push({ rule: 'file-too-large', path: abs, bytes: st.size, kind: 'file' });
      }
    }
    if (capped) break;
  }

  if (totalBytes > budgetMB * MB) {
    violations.push({
      rule: 'root-too-large',
      path: rootAbs,
      bytes: totalBytes,
      kind: 'root',
      budgetMB,
      capped,
    });
  }

  return { totalBytes, fileCount, violations, nestedRoots, capped, budgetMB };
}

/**
 * 核心：解析参数 → 定 root 集合 → 逐个扫 → 汇总。**不打印**，供 `main` 与 `--self-test` 共用。
 * 返回 `{ code, error?, roots, violations, skipped, groups }`。
 */
export function run(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) return { code: 2, error: parsed.error };
  const { opts } = parsed;
  if (opts.help) return { code: 0, help: true, roots: [], violations: [], skipped: [], groups: [] };

  let roots;
  let skipped = [];
  let groups = [];
  if (opts.roots.length > 0) {
    // 显式 `--root` 覆盖默认集合。指了不存在的目录 ⇒ **红**（退出码 2）：
    // 那不是"没什么可扫"，那是参数或环境坏了。
    for (const r of opts.roots) {
      if (!existsSync(r)) {
        return { code: 2, error: `--root 指了一个不存在的目录：${r}\n  ⇒ 这是环境/用法错误，不是"没有可扫的东西"。请确认路径。` };
      }
      if (!isDir(r)) {
        return { code: 2, error: `--root 指的不是目录：${r}` };
      }
    }
    roots = [...new Set(opts.roots)];
    groups = [{ pattern: '--root（覆盖默认集合）', matches: roots }];
  } else {
    const defaults = defaultRoots();
    groups = defaults.groups;
    skipped = defaults.skipped;
    roots = [...new Set(groups.flatMap((g) => g.matches))];
  }

  const rootSet = new Set(roots);
  const readings = [];
  const violations = [];
  for (const root of roots) {
    const budgetMB = budgetMBFor(root, opts.maxRootMB);
    const r = scanRoot(root, budgetMB, opts.maxFileMB, rootSet);
    readings.push({
      path: root,
      kind: isInsideRepo(root) ? 'repo' : 'external',
      budgetMB,
      totalBytes: r.totalBytes,
      totalMB: Number((r.totalBytes / MB).toFixed(1)),
      files: r.fileCount,
      capped: r.capped,
      nestedRoots: r.nestedRoots,
      ok: r.violations.length === 0,
    });
    violations.push(...r.violations);
  }

  // 报告顺序：先按体积降序 —— 第一行就该是那个 5.3 GB。
  violations.sort((a, b) => b.bytes - a.bytes);

  return {
    code: violations.length > 0 ? 1 : 0,
    roots: readings,
    violations,
    skipped,
    groups,
    maxFileMB: opts.maxFileMB,
    maxRootOverride: opts.maxRootMB,
  };
}

const FIX_HINT =
  '修法：把产物挪到 `$TMPDIR`（`mktemp -d`）或本轮 RT 下，验收脚本收尾时删掉 —— ' +
  '「把它挪到 `$TMPDIR`/本轮 RT 下，或加进 .gitignore 后删掉」。' +
  '证据目录只留 png/jpg/webp、txt/log、rc.txt、diff patch、JSON 报告、md。';

const RULE_WHY = {
  'file-too-large': (r, maxFileMB) => `> ${String(maxFileMB)} MB 的单文件基本就是产物或整包，不是证据`,
  'root-too-large': (r) => `单个 evidence 根总量超预算（${String(r.budgetMB)} MB）—— 超了就是产物混进来了，不是"证据多"`,
};

function describeViolation(v, maxFileMB) {
  const why = RULE_WHY[v.rule]?.(v, maxFileMB) ?? '证据目录里没有任何理由出现这个产物';
  const size = v.kind === 'root' && v.capped ? `≥${formatBytes(v.bytes)}` : formatBytes(v.bytes);
  return `[${v.rule}] ${v.path}  ${size}  ← ${why}`;
}

function printHuman(result) {
  if (result.help) {
    console.log(USAGE);
    return;
  }
  if (result.code === 2) {
    console.error(`❌ ${result.error}`);
    console.error('   （用法：`pnpm check:evidence-hygiene --help`）');
    return;
  }
  if (result.groups.length > 0) {
    for (const g of result.groups) {
      console.log(`   · 扫描对象 ${g.pattern}：${String(g.matches.length)} 个匹配`);
    }
  }
  for (const s of result.skipped) {
    console.log(`   ⏭️  跳过 ${s.path} —— ${s.reason}`);
  }
  for (const r of result.roots) {
    const tag = r.kind === 'repo' ? '仓库内' : '仓库外';
    const size = r.capped ? `≥${formatBytes(r.totalBytes)}` : formatBytes(r.totalBytes);
    const flag = r.ok ? '✅' : '❌';
    console.log(
      `   ${flag} ${r.path}  ${size} / ${String(r.budgetMB)} MB 预算（${tag}）· ${String(r.files)} 个文件`,
    );
    for (const n of r.nestedRoots) console.log(`        ↳ 嵌套证据根按自己的预算单独算：${n}`);
  }

  if (result.code === 0) {
    console.log(
      `✅ 证据目录只存证据：扫了 ${String(result.roots.length)} 个 root、` +
        `${String(result.roots.reduce((n, r) => n + r.files, 0))} 个文件，0 处违规` +
        `（跳过的 ${String(result.skipped.length)} 项见上；单文件上限 ${String(result.maxFileMB)} MB）`,
    );
    return;
  }

  console.error(
    `❌ 证据目录里混进了产物或超预算内容 —— ${String(result.violations.length)} 处违规` +
      `（扫了 ${String(result.roots.length)} 个 root）：`,
  );
  for (const v of result.violations) console.error(`   ${describeViolation(v, result.maxFileMB)}`);
  console.error(`   ${FIX_HINT}`);
  console.error('   ⇒ 这条门禁只读、不删任何文件：清理动作由人/验收脚本自己做。');
}

export function main(argv) {
  const result = run(argv);
  if (result.help) {
    printHuman(result);
    return 0;
  }
  const json = argv.includes('--json');
  if (json) {
    const payload = {
      ok: result.code === 0,
      code: result.code,
      error: result.error ?? null,
      maxFileMB: result.maxFileMB ?? DEFAULT_MAX_FILE_MB,
      roots: result.roots ?? [],
      skipped: result.skipped ?? [],
      violations: (result.violations ?? []).map((v) => ({
        rule: v.rule,
        path: v.path,
        bytes: v.bytes,
        kind: v.kind,
        budgetMB: v.budgetMB ?? null,
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
    return result.code;
  }
  printHuman(result);
  return result.code;
}

/* ── --self-test：每条判据都必须"注入 → 红 → 删掉 → 绿"，外加一条"参数坏了要红" ── */

/** 稀疏文件：`ftruncate` 只改逻辑长度，不真占盘 —— 造 26 MB / 350×1 MB 的 fixture 是瞬时的。 */
function sparseFile(path, bytes) {
  const fd = openSync(path, 'w');
  try {
    ftruncateSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
}

function selfTest() {
  const arms = [];
  const record = (label, pass, detail = '') => {
    arms.push({ label, pass });
    console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `  （${detail}）` : ''}`);
  };
  const base = mkdtempSync(join(tmpdir(), 'heyta-evidence-hygiene-'));

  try {
    // 臂 0：干净的 evidence 根 → 绿。没有这一条，下面每条"红"都可能只是"扫什么都红"。
    const clean = join(base, 'clean');
    mkdirSync(clean, { recursive: true });
    writeFileSync(join(clean, 'shot-01.png'), 'png');
    writeFileSync(join(clean, 'rc.txt'), '0\n');
    writeFileSync(join(clean, 'run.log'), 'ok\n');
    let r = run(['--root', clean]);
    record('臂0 干净 evidence 根 → 绿', r.code === 0 && r.violations.length === 0, `code=${String(r.code)}`);

    // 臂 1：产物目录 `.app` → 红；删掉 → 绿
    const withApp = join(base, 'with-app');
    mkdirSync(join(withApp, 'Heyta.app', 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(withApp, 'Heyta.app', 'Contents', 'Info.plist'), 'plist');
    // 2 MB 的二进制放进 .app 里：报错行必须**报出这个体积**，不能是 0.0 MB
    // （第一版 push 了 inside 记录的副本 ⇒ 5 GB 的产物打出来是 0.0 MB，报错行把事故说小了）。
    sparseFile(join(withApp, 'Heyta.app', 'Contents', 'MacOS', 'Heyta'), 2 * MB);
    writeFileSync(join(withApp, 'shot-02.png'), 'png');
    r = run(['--root', withApp]);
    const appHit = r.violations.find((v) => v.rule.startsWith('artifact-dir:') && v.path.endsWith('Heyta.app'));
    record(
      '臂1 evidence 里出现 Heyta.app → 红（artifact-dir），且报出的体积不是 0',
      r.code === 1 && Boolean(appHit) && appHit.bytes >= 2 * MB,
      appHit ? formatBytes(appHit.bytes) : `code=${String(r.code)}`,
    );
    rmSync(join(withApp, 'Heyta.app'), { recursive: true, force: true });
    r = run(['--root', withApp]);
    record('臂1b 把 .app 删掉 → 绿（证明那一条红是它给的）', r.code === 0, `code=${String(r.code)}`);

    // 臂 2：单文件 > 25 MB（默认阈值）→ 红；删掉 → 绿
    const bigFile = join(base, 'big-file');
    mkdirSync(bigFile, { recursive: true });
    const huge = join(bigFile, 'reinstall-ios-build.log');
    sparseFile(huge, 26 * MB);
    r = run(['--root', bigFile]);
    record(
      '臂2 单个 26 MB 日志 → 红（file-too-large，默认 25 MB）',
      r.code === 1 && r.violations.some((v) => v.rule === 'file-too-large'),
      `阈值 ${String(DEFAULT_MAX_FILE_MB)} MB`,
    );
    rmSync(huge, { force: true });
    r = run(['--root', bigFile]);
    record('臂2b 删掉那个大文件 → 绿', r.code === 0, `code=${String(r.code)}`);

    // 臂 3：根总量超**仓库外默认预算**（300 MB）→ 红。350 个 1 MB 文件，每个都远小于 25 MB
    //       ⇒ 只有"量纲"这条判据能抓住它。这正是 9.5 GB 的真实形状（没有一个文件坏，坏在总量）。
    const overBudget = join(base, 'over-budget');
    mkdirSync(overBudget, { recursive: true });
    const total = 350;
    for (let i = 0; i < total; i += 1) sparseFile(join(overBudget, `shot-${String(i).padStart(3, '0')}.png`), MB);
    r = run(['--root', overBudget]);
    const budgetHit = r.violations.find((v) => v.rule === 'root-too-large');
    record(
      `臂3 ${String(total)} 个 1 MB 文件（共 350 MB）> 仓库外默认 ${String(EXTERNAL_ROOT_BUDGET_MB)} MB → 红（root-too-large）`,
      r.code === 1 && Boolean(budgetHit) && !r.violations.some((v) => v.rule === 'file-too-large'),
      budgetHit ? `${formatBytes(budgetHit.bytes)} / ${String(budgetHit.budgetMB)} MB` : `code=${String(r.code)}`,
    );
    for (let i = 0; i < 120; i += 1) rmSync(join(overBudget, `shot-${String(i).padStart(3, '0')}.png`), { force: true });
    r = run(['--root', overBudget]);
    record('臂3b 删到 230 MB 之后 → 绿（预算不是一条永远红的尺）', r.code === 0, `code=${String(r.code)}`);

    // 臂 4：`--root` 指不存在的目录 ⇒ 退出码 2（红），不是"没什么可扫"
    r = run(['--root', join(base, 'does-not-exist')]);
    record('臂4 --root 指了不存在的目录 → 退出码 2', r.code === 2, r.error?.split('\n')[0] ?? '');

    // 臂 5：预算分档（仓库内 800 / 仓库外 300 / 显式覆盖两档）
    record(
      '臂5a 仓库内 root 默认 800 MB',
      budgetMBFor(join(REPO_ROOT, 'apps', 'mobile', 'evidence'), null) === REPO_ROOT_BUDGET_MB,
      `${String(REPO_ROOT_BUDGET_MB)} MB`,
    );
    record(
      '臂5b 仓库外 root 默认 300 MB',
      budgetMBFor(join(homedir(), '.heyta-evidence'), null) === EXTERNAL_ROOT_BUDGET_MB,
      `${String(EXTERNAL_ROOT_BUDGET_MB)} MB`,
    );
    record(
      '臂5c --max-root-mb 覆盖两档',
      budgetMBFor(join(REPO_ROOT, 'apps', 'web', 'evidence'), 42) === 42 &&
        budgetMBFor(join(homedir(), '.heyta-evidence'), 42) === 42,
      '42 MB',
    );

    // 臂 6：嵌套证据根不重复计入 —— 父 root 扫到子 root 必须让路（子 root 有自己的预算）。
    const parent = join(base, 'parent');
    const child = join(parent, 'evidence');
    mkdirSync(child, { recursive: true });
    writeFileSync(join(parent, 'parent-shot.png'), 'png');
    writeFileSync(join(child, 'child-shot.png'), 'png');
    r = run(['--root', parent, '--root', child]);
    record(
      '臂6 嵌套证据根各自独立计预算（父不吞子）',
      r.code === 0 && r.roots.length === 2 && r.roots[0].nestedRoots.includes(child),
      `nestedRoots=${String(r.roots[0]?.nestedRoots.length ?? 0)}`,
    );

    // 臂 7：默认集合里**不存在**的 root 必须打印跳过原因（不许静默地过）。
    //      这里把 `HEYTA_EVIDENCE_ROOT` 指到一个不存在的路径来**确定性地**复现 CI 的形状，
    //      而不是依赖"这台机器的 $HOME/.heyta-evidence 在不在"—— 一条靠环境偶然性
    //      才绿的臂，换个机器就变成永远绿（AGENTS §7 元规则 2）。
    const savedEnv = process.env.HEYTA_EVIDENCE_ROOT;
    const missingExternal = join(base, 'no-such-external-root');
    process.env.HEYTA_EVIDENCE_ROOT = missingExternal;
    const real = run([]);
    if (savedEnv === undefined) delete process.env.HEYTA_EVIDENCE_ROOT;
    else process.env.HEYTA_EVIDENCE_ROOT = savedEnv;
    const skip = real.skipped.find((s) => s.path === missingExternal);
    record(
      '臂7 默认集合里不存在的 root → 打印跳过原因（CI 那一条不许静默过）',
      real.code === 0 && Boolean(skip) && skip.reason.length > 0 && real.roots.length > 0,
      `roots=${String(real.roots.length)} skipped=${String(real.skipped.length)}`,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }

  const failed = arms.filter((a) => !a.pass).length;
  console.log(`ARMS=${failed === 0 ? 'pass' : 'FAIL'} (${String(arms.length - failed)}/${String(arms.length)})`);
  return failed === 0 ? 0 : 1;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
} else {
  process.exit(main(process.argv.slice(2)));
}
