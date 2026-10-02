#!/usr/bin/env node
/**
 * `check:script-snapshot` —— 长跑验收脚本的**自快照 bootstrap**必须在位（traps #110/#113）。
 *
 * ## 它钉的是哪件事
 *
 * bash 对脚本是**按字节偏移增量读取**的：一份正在运行的长脚本被编辑
 * （哪怕只是加几行注释），后半段就从错位字节开始解析，炸出**假语法错误**
 * —— 2026-10-02 实测：verify-mobile-ios 跑到一半被加了逻辑，随后报
 * `syntax error near line 1610`，而那一行根本没有语法问题。
 *
 * 修法不是"下次别这么做"（纪律已在 traps #110），而是让这类事故
 * **结构上不可能**：脚本入口先把整份自己拷成同目录隐藏快照
 * （`.原名.snap.PID`）再 `exec` 副本 —— 之后对源文件的任何编辑
 * 都影响不到本次运行。
 *
 * ## 为什么是显式清单而不是 glob
 *
 * `scripts/verify-*.sh` 里有**并行会话在途**的文件（本轮：`verify-mobile-account.sh`
 * 未跟踪、`verify-mobile-reminder-ring.sh` 已暂存未提交）—— 它们不属于本门禁的
 * 所有者，等它们落地后再加进来。`.mjs` 的验证脚本不受此坑影响（Node 在执行前
 * 整份解析），刻意不在清单里。**新增长跑 .sh 验收脚本时要加进 MANIFEST** ——
 * 这道成本是刻意的，逼人想清楚"这个脚本会不会跑很久"。
 *
 * ## 判据（缺一即红）
 *
 * 1. 文件里有 bootstrap 标记与三处结构（case 守卫 / `exec bash "$_snap"` / trap 清理）；
 * 2. 🔴 标记出现在**前 15 行** —— 把整块挪到文件尾部可以让标记还在、却永远不执行；
 * 3. `.gitignore` 覆盖快照文件名，否则每轮验收都会往 `git status` 里丢未跟踪文件。
 *
 * 变异验证（2026-10-02，两者都实测会红）：
 * - 从任一清单文件里删掉 bootstrap 块 ⇒ 报缺失；
 * - 把块挪到文件末尾 ⇒ 报"不在文件头部"。
 */
import { readFileSync, existsSync } from 'node:fs';

const MANIFEST = [
  'scripts/reinstall-all.sh',
  'scripts/verify-harmony-rnoh-js.sh',
  'scripts/verify-harmony-rnoh.sh',
  'scripts/verify-harmony-toolchain.sh',
  'scripts/verify-ios-lan-http.sh',
  'scripts/verify-mobile-auth.sh',
  'scripts/verify-mobile-autosync.sh',
  'scripts/verify-mobile-calendar.sh',
  'scripts/verify-mobile-capture.sh',
  'scripts/verify-mobile-conflict.sh',
  'scripts/verify-mobile-focus.sh',
  'scripts/verify-mobile-inbox.sh',
  'scripts/verify-mobile-ios.sh',
  'scripts/verify-mobile-lists.sh',
  'scripts/verify-mobile-quadrant-fill.sh',
  'scripts/verify-mobile-restore.sh',
  'scripts/verify-mobile-repeat-custom.sh',
  'scripts/verify-mobile-repeat.sh',
  'scripts/verify-mobile-schedule.sh',
  'scripts/verify-mobile-sort-sheet.sh',
  'scripts/verify-mobile-tags.sh',
  'scripts/verify-mobile-task-edit.sh',
  'scripts/verify-mobile-task-row.sh',
  'scripts/verify-mobile-ticktick-import.sh',
  'scripts/verify-mobile-timeline.sh',
  'scripts/verify-multi-end-sync.sh',
  'scripts/verify-sync-rejection-recovery.sh',
  'scripts/verify-universal-slice.sh',
];

const MARKER = 'HEYTA-SNAPSHOT-BOOTSTRAP';
const MAX_HEADER_LINES = 15;

const failures = [];

for (const file of MANIFEST) {
  if (!existsSync(file)) {
    failures.push(`${file}: 清单里的文件不存在 —— 清单与现实漂移了`);
    continue;
  }
  const lines = readFileSync(file, 'utf8').split('\n');
  const markerLine = lines.findIndex((l) => l.includes(MARKER));
  if (markerLine === -1) {
    failures.push(`${file}: 缺自快照 bootstrap（${MARKER}）—— 见 traps #110/#113`);
    continue;
  }
  if (markerLine >= MAX_HEADER_LINES) {
    failures.push(
      `${file}: bootstrap 标记在第 ${markerLine + 1} 行（> ${MAX_HEADER_LINES}）—— ` +
        `它必须在文件头部才会被执行，挪到别处等于没有`,
    );
  }
  const body = lines.slice(0, MAX_HEADER_LINES + 20).join('\n');
  if (!body.includes('.*.snap.*')) {
    failures.push(`${file}: 缺快照名 case 守卫（.*.snap.*）—— 没有它，快照会再次自快照`);
  }
  if (!body.includes('exec bash "$_snap"')) {
    failures.push(`${file}: 缺 exec bash "$_snap" —— 只拷贝不 exec 等于没保护`);
  }
  if (!body.includes("trap 'rm -f -- \"$0\"' EXIT")) {
    failures.push(`${file}: 缺 trap 清理 —— 快照文件会一直堆在 scripts/ 里`);
  }
}

const gitignore = readFileSync('.gitignore', 'utf8');
if (!/^scripts\/\.\*\.snap\.\*$/m.test(gitignore)) {
  failures.push('.gitignore: 缺 scripts/.*.snap.* —— 运行中产生的快照会污染 git status');
}

if (failures.length > 0) {
  console.error(`❌ 长跑脚本自快照 bootstrap 不完整（${failures.length} 处）：`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`✅ 自快照 bootstrap 全部在位（${MANIFEST.length} 个脚本 + .gitignore）`);
