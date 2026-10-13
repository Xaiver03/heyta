#!/usr/bin/env node
/**
 * 「数据出境」措辞红线 —— 变异驱动器
 * ===================================
 *
 * 裁决：用户可见文案不许做监管定性（ADR-0054 §1）。执行点是
 * `scripts/check-ui-language.mjs` 的规则 7，本文件只回答一个问题：
 * **那条规则真的会红吗**。
 *
 * AGENTS §8 第 3 条：不能失败的检查没有价值，而"我做过变异验证"不是一种读数。
 * 所以四臂各自断言**命中的行数**，不只断言红/绿：
 *
 *   · 对照臂   不打补丁                          ⇒ 0 处（规则不许咬自己）
 *   · M1       中文词条的值写成「数据出境」        ⇒ 恰好 1 处（看得见词条的值）
 *   · M2       `packages/app-host/src` 里一条字面量 ⇒ 恰好 1 处，**且报的是那个文件**
 *              （看得见不走 `t()` 的那一类 —— §7.10 通道 #5 同族形状）
 *   · M3       拿掉 `packages/legal/src` 的豁免    ⇒ >0 处
 *              （证明那条豁免是**承重的**，不是"法务目录被全局放行"的巧合；
 *               手法与 `license-inventory` 的"把 CC-BY-4.0 登记拿掉"同一族）
 *
 * 用法：node scripts/mutate-egress-wording.mjs —— 非零退出 = 有臂存活。
 * ⚠️ 它会临时改工作树并临时往 `scripts/` 放一份门禁副本，所以**不要并行跑别的门禁**；
 *    每一臂在 `finally` 里还原，结束时再逐路径核对 sha256 **与 mtime** —— 变异运行不许留下字节，
 *    也不许留下**新的 mtime**。
 *    🔴 为什么要单独对账 mtime（2026-10-06 实测）：`writeFileSync(path, original)` 还原了字节，
 *    却把 mtime 抬到还原那一刻 —— 而 mtime 是**另一道门的输入**：
 *    `scripts/lib/apk-freshness.sh` 那道"装包之前当场判 APK 比源码新"的门就吃它。
 *    实测后果：本门禁跑完 ⇒ `packages/i18n/src/locales/zh-CN.ts` 的 mtime 晚于 APK ⇒
 *    `verify:mobile-ai` 以 rc 3 拒绝起跑，报"验的是旧 bundle"（§7 第 27 条），而那份内容逐字
 *    等于 HEAD、那一轮根本没有动过 freshness 输入集里的源码 —— 一枚假红把设备级验收整轮挡掉。
 *    **只比字节挡不住它，因为字节确实是对的。**（与 #287 同族：变异装置的还原动作必须还原
 *    "被下游消费的那个维度" —— #287 管的是被杀之后的字节，这一条管的是正常跑完的时间戳。）
 *    🔴 `finally` 只挡得住异常，挡不住信号：被 SIGTERM 打断留下的残留由**下一次启动**按归属标记
 *    收掉（见下面 MUTATED_ZH_LINE / PROBE_MARKER 那一段）。这里不挂信号处理器 —— 同步脚本里
 *    `process.on('SIGTERM')` 的回调轮不到执行，注册反而把默认可杀行为取消掉（traps #287）。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync, existsSync, statSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'scripts/check-ui-language.mjs';
const ZH = 'packages/i18n/src/locales/zh-CN.ts';
const PROBE_SRC = 'packages/app-host/src/__mutate_egress_probe.ts';
const COPY_GATE = 'scripts/__mutate_egress_probe.gate.mjs';

/** 归属标记：探针文件的第一行就声明自己是谁造的，收尸时只认带这行的字节。 */
const PROBE_MARKER = '本文件由 scripts/mutate-egress-wording.mjs 创建并删除';

/** 只认规则 7 自己那行；别人的红（硬编码、漏翻译）不参与判定。 */
const MARK = '监管定性「数据出境」';

function sha(rel) {
  try {
    return createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex');
  } catch {
    return '<absent>';
  }
}

/** 取一对时间戳（atime/mtime，毫秒）。取不到回 null（文件不存在）。 */
function stamp(rel) {
  try {
    const s = statSync(join(ROOT, rel));
    return { atimeMs: s.atimeMs, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * 把 mtime/atime 按回基线值。
 * ⚠️ 必须**在写字节之后**调用：还原本身会再次抬起 mtime，顺序反了等于没还原。
 * 容差 2ms —— APFS 存纳秒，`new Date(mtimeMs)` 只到毫秒，取回时会被截掉小数。
 */
function restoreStamp(rel, base) {
  if (base === null) return;
  const path = join(ROOT, rel);
  if (!existsSync(path)) return;
  utimesSync(path, new Date(base.atimeMs), new Date(base.mtimeMs));
  const now = stamp(rel);
  if (now === null || Math.abs(now.mtimeMs - base.mtimeMs) > 2) {
    throw new Error(
      `${rel} 的 mtime 还原后仍不等基线（基线 ${String(base.mtimeMs)} / 现量 ${String(now?.mtimeMs)}）——` +
        ` 这道门不许把 mtime 留在抬起的位置，它是 APK 新鲜度判据的输入。`,
    );
  }
}

/**
 * 跑一次真门禁，取出规则 7 那些违规**及其落点**。
 *
 * 打印器的形状是（见 `check-ui-language.mjs` 末尾）：
 *
 *   ```
 *      packages/x/src/y.ts:12        ← 三个空格开头 = 落点行
 *         文案：…
 *         问题：…监管定性「数据出境」…  ← 判定行，但它**不含路径**
 *   ```
 *
 * ⚠️ 第一版这里只 grep 判定行并断言"这一行含探针文件名"，于是 M2 **命中了却判存活** ——
 * 一个只会误报的变异臂和一条不会红的判据是同一种病（AGENTS §7 元规则 2）。
 * 所以按形状配对：落点行 + 它后面那段里的判定行。
 */
function hits(script) {
  const r = spawnSync(process.execPath, [join(ROOT, script)], { encoding: 'utf8', cwd: ROOT });
  const out = `${String(r.stdout ?? '')}${String(r.stderr ?? '')}`;
  const lines = out.split('\n');
  // 🔴 三个出口，不许合成两个：没跑到 / 跑到且红 / 跑到且绿。
  // "门禁崩了"和"一条违规都没有"在 `found.length === 0` 上逐字同形 ——
  // 实测：往副本前面插一行注释把 shebang 顶到第 2 行，`node` 报 SyntaxError，
  // M3 于是读出"命中 0 处 ⇒ 存活"，响的是臂自己坏了，不是判据没牙。
  if (!/文案合规|处不合规/.test(out)) {
    throw new Error(
      `${script} 没跑到结论行（退出码 ${String(r.status)}）—— 这不算"0 处违规"：\n${out.slice(0, 1500)}`,
    );
  }
  const found = [];
  let where = '<unknown>';
  for (const line of lines) {
    if (/^ {3}\S/.test(line) && !line.startsWith('      ')) {
      where = line.trim();
      continue;
    }
    if (line.includes(MARK)) found.push({ where, line: line.trim() });
  }
  return found;
}

/**
 * 🔴 与 `mutate-op-log-semantics.mjs` 同一族：`finally` 挡不住信号，而 `process.on('SIGTERM')`
 * 在**全程同步**的脚本里同样挡不住 —— 它从不回到事件循环，回调要等整趟跑完才有机会执行，
 * 而注册本身把默认的"可被杀"取消了（实测 2026-10-05：变异窗口里发 SIGTERM ⇒ 进程没停、
 * 9 条场景全跑完、RC=0；见 traps #287）。所以这里**不设信号处理器**，只保证一件事：
 * **下一次启动能把上一轮的尸收掉**。
 *
 * 被信号打断会留下三样之一：zh-CN.ts 的被补丁字节、
 * `packages/app-host/src/__mutate_egress_probe.ts`、`scripts/__mutate_egress_probe.gate.mjs`。
 * 归属怎么证：探针文件的第一行写着"由本脚本创建并删除"，zh 的补丁态是 M1 那串独有的字面量 ——
 * 带着这些标记才动手，不带就是别人的文件，拒绝。
 *
 * ⚠️ 收尸必须排在取基线**之前**：文末那条 sha256 对账比的是"开跑时的字节"，
 * 基线若在残留态上取，清掉残留反而会被报成"留下了字节"。
 */
const MUTATED_ZH_LINE = "'web.ai.settings.granted': '已授权数据出境',";

function sweepProbes(notes) {
  for (const rel of [PROBE_SRC, COPY_GATE]) {
    const path = join(ROOT, rel);
    if (!existsSync(path)) continue;
    // 这两条路径 M2/M3 要往里写，所以"存在但不是本脚本造的"必须**拒绝开跑**，
    // 不能只"没删它"然后下一步把别人的文件覆盖掉。
    if (!readFileSync(path, 'utf8').includes(PROBE_MARKER)) {
      throw new Error(
        `${rel} 已存在但不含归属标记 —— 那不是残留，是别人的文件，而本脚本要往这个路径写。拒绝开跑。`,
      );
    }
    rmSync(path, { force: true });
    notes.push(`已清掉 ${rel}`);
  }
}

{
  const notes = [];
  sweepProbes(notes);
  if (readFileSync(join(ROOT, ZH), 'utf8').includes(MUTATED_ZH_LINE)) {
    throw new Error(
      `${ZH} 停在上一轮 M1 的补丁态（那串字面量只有本脚本会写）—— 本轮拒绝开跑。\n` +
        `  现量：git diff -- ${ZH}\n` +
        `  还原：git checkout -- ${ZH}\n` +
        `  （探针残留已顺手收掉：${notes.join('；') || '无'}）`,
    );
  }
  if (notes.length > 0) console.log(`⚠️  ${notes.join('；')}`);
}

const baseline = new Map([GATE, ZH, PROBE_SRC, COPY_GATE].map((rel) => [rel, sha(rel)]));
// 🔴 mtime 也要基线：只比字节的对账挡不住"字节还原对了、时间戳留在还原那一刻"，
//    而那个时间戳会被 `scripts/lib/apk-freshness.sh` 当成"源码比 APK 新"来消费。
const stampBaseline = new Map([GATE, ZH, PROBE_SRC, COPY_GATE].map((rel) => [rel, stamp(rel)]));


let failed = false;
function arm(name, found, verdict) {
  const ok = verdict(found.length, found);
  rows.push(
    `   ${name} ⇒ 命中 ${String(found.length)} 处` +
      (found.length > 0 ? `（${found[0].where}）` : '') +
      `   ${ok ? '✅ 判红' : '❌ 存活 —— 判据没牙'}`,
  );
  if (!ok) failed = true;
}
const rows = [];

// ── 对照臂 ────────────────────────────────────────────────────
arm('对照（不打补丁）', hits(GATE), (n) => n === 0);

// ── M1：词条表的值 ───────────────────────────────────────────
{
  const path = join(ROOT, ZH);
  const original = readFileSync(path, 'utf8');
  const from = "'web.ai.settings.granted': '已批准内容离开本机',";
  if (!original.includes(from)) throw new Error('M1 的落点那行不在了 —— 词条变了，这条臂要跟着改');
  try {
    writeFileSync(path, original.replace(from, MUTATED_ZH_LINE));
    arm(
      'M1 中文词条的值写成「数据出境」',
      hits(GATE),
      (n, found) => n === 1 && found[0].where.includes('locales/zh-CN.ts'),
    );
  } finally {
    writeFileSync(path, original);
    restoreStamp(ZH, stampBaseline.get(ZH));
  }
}

// ── M2：不走 t() 的字符串字面量 ──────────────────────────────
{
  const path = join(ROOT, PROBE_SRC);
  try {
    writeFileSync(
      path,
      `// 变异探针（${PROBE_MARKER}）\n` +
        "export const PROBE = '该功能需要你先授权数据出境。';\n",
    );
    arm(
      'M2 packages/ 源码里一条字面量',
      hits(GATE),
      (n, found) => n === 1 && found[0].where.includes('__mutate_egress_probe.ts'),
    );
  } finally {
    rmSync(path, { force: true });
  }
}

// ── M3：豁免是承重的 ────────────────────────────────────────
{
  const src = readFileSync(join(ROOT, GATE), 'utf8');
  const patched = src.replace('const REGULATORY_EXEMPT = [', 'const REGULATORY_EXEMPT = []; const _EXEMPT_ORIGINAL = [');
  if (patched === src) throw new Error('M3 没能定位到豁免清单 —— 规则 7 的形状变了，这条臂要跟着改');
  try {
    // 归属标记必须排在 shebang **之后**：shebang 只在第 1 行才合法，
    // 把它顶到第 2 行 = 副本 SyntaxError = 这条臂读起来像"命中 0 处"（实测踩过，见 hits() 注释）。
    const firstBreak = patched.indexOf('\n');
    const body = patched.startsWith('#!')
      ? `${patched.slice(0, firstBreak + 1)}// 变异探针副本（${PROBE_MARKER}）\n${patched.slice(firstBreak + 1)}`
      : `// 变异探针副本（${PROBE_MARKER}）\n${patched}`;
    writeFileSync(join(ROOT, COPY_GATE), body);
    arm('M3 拿掉 packages/legal/src 的豁免', hits(COPY_GATE), (n) => n > 0);
  } finally {
    rmSync(join(ROOT, COPY_GATE), { force: true });
  }
}

// ── 字节对账：变异运行不许留下痕迹 ──────────────────────────
const residue = [...baseline.entries()].filter(([rel, sum]) => sha(rel) !== sum);

// ── mtime 对账：不许留下"新的时间戳" ────────────────────────
// 🔴 这一栏单独存在，不是字节对账的重复：`writeFileSync(path, original)` 之后字节相等，
//    上面那一栏必然干净，而 mtime 已经抬到还原那一刻。基线为 null（开跑时不存在 = 探针文件）
//    或现在不存在（探针已删）的都跳过 —— 那两种情况由字节对账管。
const mtimeDrift = [...stampBaseline.entries()].filter(([rel, base]) => {
  if (base === null) return false;
  const now = stamp(rel);
  if (now === null) return false;
  return Math.abs(now.mtimeMs - base.mtimeMs) > 2;
});

console.log('「数据出境」措辞红线的变异读数（规则 7 = check:ui-language）');
for (const line of rows) console.log(line);
if (residue.length > 0) {
  console.error(`🔴 变异运行留下了字节：${residue.map(([rel]) => rel).join('、')}`);
  process.exit(1);
}
if (mtimeDrift.length > 0) {
  console.error(
    `🔴 变异运行留下了**新的 mtime**：${mtimeDrift.map(([rel]) => rel).join('、')}\n` +
      `   字节是干净的，所以 sha256 那一栏抓不到它 —— 但 mtime 是 APK 新鲜度判据的输入，\n` +
      `   留在这里会让下一次真机验收以「APK 比源码旧」拒绝起跑（本次改动就是为了堵住这条路）。`,
  );
  process.exit(1);
}
console.log(
  `✅ 工作树已还原（对账 ${String(baseline.size)} 条路径的 sha256 + ${
    [...stampBaseline.values()].filter((v) => v !== null).length
  } 条路径的 mtime）`,
);
process.exit(failed ? 1 : 0);
