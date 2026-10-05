#!/usr/bin/env node
/**
 * `check:shell-exit-chain` —— 会自快照的验收脚本，**最终生效的那条 EXIT handler 里必须留着快照自删**。
 *
 * ## 它钉的是哪件事
 *
 * `scripts/lib/mobile-e2e.sh` 在被 source 时装自己的 EXIT handler（还原软键盘）。bash 的 `trap` 是
 * **整条替换**语义：
 *   - rig 的 trap 排在 source **之前** ⇒ 被 lib 摘掉 ⇒ rig 自己的清理（删 `原名.snap.PID`）静默不跑；
 *   - rig 的 trap 排在 source **之后** ⇒ 反过来摘掉 lib ⇒ 同上，快照留在 `scripts/` 里。
 * 2026-10-04 实测的两个方向与 45 枚物理残留见计划 §10.87。第一方向已由 lib 的
 * `heyta_chain_exit`（串上先前那条）结构性修掉；这条门禁守的是**第二方向**，
 * 也就是"后来有人又在 source 之后补了一条裸 trap"这种回潮。
 *
 * ## 为什么不是"不许写裸 trap"
 *
 * 那是 §10.87 原话里的形状，但它**判据方向错了**：source 之前的 `trap 'rm -f -- "$0"' EXIT`
 * 是 bootstrap 自己写的、现在是对的形状。会漏快照的只有"生效的那一条不含自删"，
 * 所以谓词落在**生效 handler**上，不落在 trap 行数上。`restore_ime` 那一方向由
 * `summary()` 的运行时自检守（它只在真调过 `disable_ime` 时才有话可说），本门禁不重复。
 *
 * ## 射程（现量口径，2026-10-04）
 *
 * `scripts/` 下（不含 `lib/`、不含 `.snap.` 副本）同时满足①带 `HEYTA-SNAPSHOT-BOOTSTRAP` 标记
 * ②source 了这份 lib 的 `.sh`。按名字收会同时漏掉多收：`mutate-closeout-gates.sh` source 了
 * 但没有自快照（不该判），`verify-mobile-{aed,ios-reminder}.sh` 有快照但没 source（同理）。
 *
 * ## 判据（缺一即红）
 *
 * 1. **射程非空**：sourcing 集合为空或 in-scope 集合为空 ⇒ 红 —— lib 路径或 bootstrap 标记一旦改名，
 *    这条扫描会读到空集，而空集念出来最像"干净"；
 * 2. 每一枚 in-scope 脚本，生效 handler 含 `"$0"`（含整条链里由 lib 串上的那条）；有快照却**一条 trap 都没有**也红；
 * 3. **自带正反对照**（默认可跑，`--no-selftest` 只用于调试）：临时造一枚好样本 + 一枚坏样本 + 一枚空射程，
 *    要求好样本绿、坏样本红、空射程红；任一不如预期 ⇒ 本门禁自己判红（"不能失败的检查没有价值"）。
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 「source 了这份 lib」的取数形状：非注释行里出现 `lib/mobile-e2e.sh` 且紧跟引号。
// 🔴 不写成"必须以 `. ` / `source ` 开头"：本仓 30 枚 rig 用的都是
//    `. "$(dirname "$0")/lib/mobile-e2e.sh"`，而 `. "` 之后带空格的写法会让
//    `^\s*(source|\.)\s+\S*lib/…` 这种"调用式"正则**一枚都抓不到**（实测 0 命中），
//    射程静默变空集 ⇒ 整条门禁念成干净。两种形状都要收：调用行与 `LIB="…/mobile-e2e.sh"`
//    赋值行（后者按赋值位置定序，偏保守：它可能把"赋值与调用之间"的 trap 判成 source 之后，
//    那是**假红方向不是假绿方向**，宁可红在排查上）。
const LIB_RE = /^\s*(?!#|\/\/).*lib\/mobile-e2e\.sh['"]/;
const MARKER = 'HEYTA-SNAPSHOT-BOOTSTRAP';

function listScripts(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => n.endsWith('.sh') && !n.includes('.snap.'))
    .map((n) => join(root, n))
    .sort();
}

// bash 3.2 实测语义：source 之后的最后一条 trap 整条替换；没有则生效的是 source 之前那条（lib 会串上它）。
function effectiveTrap(text) {
  const lines = text.split('\n');
  let src = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!LIB_RE.test(lines[i])) continue;
    src = i;
    break;
  }
  if (src === -1) return { sourced: false };
  const traps = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^trap .*EXIT/.test(lines[i])) traps.push({ line: i + 1, text: lines[i] });
  }
  const after = traps.filter((t) => t.line - 1 > src);
  if (after.length > 0) {
    const t = after[after.length - 1];
    return { sourced: true, trap: t.text, where: `:${t.line}（source 之后，lib 那条被它整条替换）` };
  }
  const before = traps.filter((t) => t.line - 1 < src);
  if (before.length > 0) {
    const t = before[before.length - 1];
    return { sourced: true, trap: t.text, where: `:${t.line}（source 之前，由 lib 的 heyta_chain_exit 串上）` };
  }
  return { sourced: true, trap: null, where: '（没有任何 EXIT trap）' };
}

function sourcesLib(text) {
  return text.split('\n').some((l) => LIB_RE.test(l));
}

function scan(root) {
  const files = listScripts(root);
  const sourcing = files.filter((f) => {
    try {
      return sourcesLib(readFileSync(f, 'utf8'));
    } catch {
      return false;
    }
  });
  const inScope = sourcing.filter((f) => readFileSync(f, 'utf8').includes(MARKER));
  const reds = [];
  for (const f of inScope) {
    const r = effectiveTrap(readFileSync(f, 'utf8'));
    if (r.trap === null) {
      reds.push(`${f}${r.where} —— 有自快照却没有一条 EXIT 清理，快照必留`);
      continue;
    }
    if (!r.trap.includes('"$0"')) {
      reds.push(`${f}${r.where} —— 生效 handler 里没有 "$0"：\n      ${r.trap}`);
    }
  }
  return { sourcedCount: sourcing.length, scopeCount: inScope.length, reds };
}

function selftest() {
  const dir = join(tmpdir(), `heyta-exit-chain-selftest-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const boot = `#!/bin/bash\ncase "$0" in *.snap.*) ;; *) echo ${MARKER}; exec bash /dev/null ;; esac\n`;
  // 与真身同形：这枚 fixture 的用途就是照出"取数形状对不上真身"这一档
  const src = '. "$(dirname "$0")/lib/mobile-e2e.sh"\n';
  const write = (name, text) => writeFileSync(join(dir, name), text);
  // 1) 好：trap 在 source 之前，由 lib 串上，含 "$0"
  write('good.sh', boot + `trap 'rm -f -- "$0"' EXIT\n` + src + 'echo ok\n');
  // 2) 坏：trap 在 source 之后（整条替换掉 lib 那条），且不含 "$0" ⇒ 快照必留
  write('bad.sh', boot + src + `trap 'rm -f -- /tmp/other' EXIT\n`);
  // 3) 坏：有自快照、一条 EXIT trap 都没有
  write('notrap.sh', boot + src + 'echo ok\n');
  // 4) 好：赋值式 source（路径在赋值行里）—— 射程的兜底形状必须真的收到它
  write('assign.sh', boot + `trap 'rm -f -- "$0"' EXIT\n` + 'MOBILE_E2E="$ROOT/scripts/lib/mobile-e2e.sh"\n. "$MOBILE_E2E"\n');

  const res = scan(dir);
  const hit = (n) => res.reds.some((r) => r.includes(`/${n}`));
  const emptyDir = join(dir, 'empty');
  mkdirSync(emptyDir, { recursive: true });
  const empty = scan(emptyDir);

  rmSync(dir, { recursive: true, force: true });
  const problems = [];
  if (!hit('bad.sh')) problems.push('对照坏样本（source 之后的裸 trap）没被打中 —— 本门禁没有牙');
  if (!hit('notrap.sh')) problems.push('对照坏样本（有快照却无 trap）没被打中 —— 这条腿没建起来');
  if (hit('good.sh') || hit('assign.sh')) problems.push('对照好样本被判红 —— 谓词比现实更严，会变成假红机器');
  if (res.scopeCount !== 4) problems.push(`对照射程收到 ${res.scopeCount} 枚（期望 4）—— 射程谓词与 fixture 形状不匹配`);
  if (empty.sourcedCount !== 0 || empty.scopeCount !== 0) problems.push('空目录却读到对象，"空射程要红"这条腿不成立');
  return { problems, redCount: res.reds.length, fixtureScope: res.scopeCount };
}

const args = process.argv.slice(2);
const root = args.includes('--root') ? args[args.indexOf('--root') + 1] : join(process.cwd(), 'scripts');
const skipSelftest = args.includes('--no-selftest');

const res = scan(root);
const failures = [];

if (res.sourcedCount === 0) {
  failures.push(`射程为空：${root} 下没有一枚脚本在非注释行里引用 lib/mobile-e2e.sh —— source 的形状变了，本门禁从此什么都量不到`);
} else if (res.scopeCount === 0) {
  failures.push(`射程为空：source 了 lib 的有 ${res.sourcedCount} 枚，但没有一枚带 ${MARKER} —— 标记改名会让本门禁静默变空集`);
}
failures.push(...res.reds);

let st = null;
if (!skipSelftest) {
  st = selftest();
  failures.push(...st.problems);
}

if (failures.length > 0) {
  console.error(`❌ check:shell-exit-chain —— ${failures.length} 条红（射程：source lib ${res.sourcedCount} 枚 / 有自快照 ${res.scopeCount} 枚）`);
  for (const f of failures) console.error(`   · ${f}`);
  process.exit(1);
}

console.log(
  `✅ check:shell-exit-chain —— ${res.scopeCount} 枚自快照 rig 的生效 EXIT handler 全部带 "$0"` +
    `（source lib 的共 ${res.sourcedCount} 枚，其中无自快照 ${res.sourcedCount - res.scopeCount} 枚不判）` +
    (st ? `；正反对照：4 枚 fixture 里 2 枚被判红（reds=${st.redCount}）、射程 ${st.fixtureScope} 枚、空射程这条腿成立` : '；未跑自对照（--no-selftest）'),
);
