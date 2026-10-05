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
 *    每一臂在 `finally` 里还原，结束时再逐路径核对 sha256 —— 变异运行不许留下字节。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'scripts/check-ui-language.mjs';
const ZH = 'packages/i18n/src/locales/zh-CN.ts';
const PROBE_SRC = 'packages/app-host/src/__mutate_egress_probe.ts';
const COPY_GATE = 'scripts/__mutate_egress_probe.gate.mjs';

/** 只认规则 7 自己那行；别人的红（硬编码、漏翻译）不参与判定。 */
const MARK = '监管定性「数据出境」';

function sha(rel) {
  try {
    return createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex');
  } catch {
    return '<absent>';
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
  const lines = `${String(r.stdout ?? '')}${String(r.stderr ?? '')}`.split('\n');
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

const baseline = new Map([GATE, ZH, PROBE_SRC, COPY_GATE].map((rel) => [rel, sha(rel)]));

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
    writeFileSync(path, original.replace(from, "'web.ai.settings.granted': '已授权数据出境',"));
    arm(
      'M1 中文词条的值写成「数据出境」',
      hits(GATE),
      (n, found) => n === 1 && found[0].where.includes('locales/zh-CN.ts'),
    );
  } finally {
    writeFileSync(path, original);
  }
}

// ── M2：不走 t() 的字符串字面量 ──────────────────────────────
{
  const path = join(ROOT, PROBE_SRC);
  try {
    writeFileSync(
      path,
      '// 变异探针（本文件由 scripts/mutate-egress-wording.mjs 创建并删除）\n' +
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
    writeFileSync(join(ROOT, COPY_GATE), patched);
    arm('M3 拿掉 packages/legal/src 的豁免', hits(COPY_GATE), (n) => n > 0);
  } finally {
    rmSync(join(ROOT, COPY_GATE), { force: true });
  }
}

// ── 字节对账：变异运行不许留下痕迹 ──────────────────────────
const residue = [...baseline.entries()].filter(([rel, sum]) => sha(rel) !== sum);

console.log('「数据出境」措辞红线的变异读数（规则 7 = check:ui-language）');
for (const line of rows) console.log(line);
if (residue.length > 0) {
  console.error(`🔴 变异运行留下了字节：${residue.map(([rel]) => rel).join('、')}`);
  process.exit(1);
}
console.log(`✅ 工作树已还原（对账 ${String(baseline.size)} 条路径的 sha256）`);
process.exit(failed ? 1 : 0);
