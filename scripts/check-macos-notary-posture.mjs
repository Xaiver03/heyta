#!/usr/bin/env node
/**
 * `check:macos-notary-posture` —— **「包可用」与「公证通过」是两件事**
 * ==================================================================
 *
 * ## 它防的是哪一种假绿（有现量）
 *
 * 2026-11-07/08 那两趟 macOS 重装里，公证一直是 `Error: HTTPClientError.connectTimeout`
 * （Apple 侧没回话），而 `reinstall-all.sh` 的汇总仍打 **`✅ mac`**。
 * 那句读起来像"公证也过了" —— 实际包只是**签了名、能装、能跑**，没装订票据，
 * 分发出去用户会看到"无法验证开发者"。
 *
 * 这不是笔误，是**一个布尔装了两件事**：`✅` 同时表示"产物对"与"公证过"。
 * 所以判据不是"提醒人去看日志"，是**让它们各自有各自的读数**：
 *
 *   NOTARY_STATE=stapled / failed / timeout / skipped-* —— 由打包脚本写进一个文件，
 *   重装脚本**单独读**并**单独打一行**。
 *
 * ## 它钉三条（都能被一次故意改动弄红）
 *
 * ① 打包脚本必须**写**那个状态文件（不然下游读到 `unknown`，等于又回到一个布尔）；
 * ② 四个分支必须**各有各的值**（`stapled` / `timeout` / `failed` / `skipped-*`）——
 *    把 `timeout` 和 `failed` 合并成一个 `failed` 会丢掉"该不该重试"这个区别；
 * ③ 重装脚本必须**分别**打这四种话术，且 `✅` 只留给 `stapled`。
 *
 * ## 🔴 它**不**判断"该不该买正式证书 / 该不该修网络"
 *
 * 那是 B2 与运维的事。本判据只保证**读数不撒谎**。
 *
 * ## 用法
 *
 *   node scripts/check-macos-notary-posture.mjs              # 真跑（离线）
 *   node scripts/check-macos-notary-posture.mjs --self-test   # 逐臂证明会红
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(HERE);

export const PACKAGER = 'apps/desktop-macos/scripts/package-app.sh';
export const REINSTALL = 'scripts/reinstall-all.sh';

/** 四个必须各自出现的状态值。 */
export const REQUIRED_STATES = ['stapled', 'timeout', 'failed'];

/** 纯判据：给两份脚本原文，返回 `{ problems, reading }`。 */
export function notaryPostureProblems(packager, reinstall) {
  const problems = [];
  const reading = {};

  // ① 打包脚本写状态文件
  reading.packagerWritesState = /NOTARY_STATE_FILE/.test(packager);
  if (!reading.packagerWritesState) {
    problems.push(
      `\`${PACKAGER}\` 不写 \`NOTARY_STATE_FILE\` —— 下游只能读到 unknown，` +
        '「公证通过」又会被并进那个 ✅ 里。',
    );
  }

  // ② 四个分支各有各的值
  reading.statesFound = REQUIRED_STATES.filter((state) =>
    new RegExp(`NOTARY_STATE=${state}\\b`).test(packager),
  );
  const missing = REQUIRED_STATES.filter((state) => !reading.statesFound.includes(state));
  if (missing.length > 0) {
    problems.push(
      `打包脚本里缺少这些公证状态值：${missing.join(' / ')} —— ` +
        '四档各有各的处置（通过装订票据 / 超时重试 / 被拒看原话 / 跳过不做），合并就丢掉区别。',
    );
  }
  // 跳过分支也要有值：否则"没跑公证"与"跑挂了"在下游同形。
  if (!/NOTARY_STATE=skipped-/.test(packager)) {
    problems.push('打包脚本没有 `skipped-*` 这一档 —— "跳过公证"与"公证挂了"必须能分开。');
  }

  // ③ 重装脚本分别打四种话术
  reading.reinstallReadsState = /MAC_NOTARY_STATE/.test(reinstall);
  if (!reading.reinstallReadsState) {
    problems.push(
      `\`${REINSTALL}\` 不读公证状态 —— 汇总里那个 \`✅ mac\` 会继续同时表示"产物对"与"公证过"。`,
    );
  }
  for (const state of [...REQUIRED_STATES, 'skipped-']) {
    if (!reinstall.includes(state)) {
      problems.push(`重装脚本没有针对 \`${state}\` 的单独话术 —— 那一档的读数会落进兜底。`);
    }
  }
  // ✅ 只留给 stapled：超时那一档若也打 ✅，判据就白加了。
  const timeoutLine = /timeout\)\s*echo\s+"([^"]+)"/.exec(reinstall)?.[1] ?? '';
  reading.timeoutSays = timeoutLine;
  if (timeoutLine === '') {
    problems.push('读不到 `timeout` 那一档的话术 —— 判据形状变了，回来更新它。');
  } else if (timeoutLine.includes('✅')) {
    problems.push(
      `\`timeout\` 那一档的话术里有 ✅：\`${timeoutLine}\` —— 超时**不等于通过**，` +
        '这正是这条判据要防的那个假绿。',
    );
  }

  return { problems, reading };
}

/* ── 自检臂 ─────────────────────────────────────────────────────── */

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function selfTest() {
  const packager = read(PACKAGER);
  const reinstall = read(REINSTALL);
  const arms = [];

  const arm = (name, expectedRed, mutate) => {
    const p = mutate(packager);
    const r = mutate(reinstall);
    const { problems } = notaryPostureProblems(p, r);
    const red = problems.length > 0;
    arms.push(`${red === expectedRed ? '✅' : '❌'} ${name} → ${red ? '红' : '绿'}`);
    return red === expectedRed;
  };

  let ok = true;
  // 真源必须绿
  ok = arm('真源（合规现状）', false, (s) => s) && ok;
  // 臂 1：打包脚本不写状态文件
  ok = arm('不写状态文件', true, (s) => s.replace(/NOTARY_STATE_FILE/g, 'SOMETHING_ELSE')) && ok;
  // 臂 2：把 timeout 与 failed 合并
  // ⚠️ 必须 replaceAll：打包脚本里有**两处** `NOTARY_STATE=timeout`（分支体 + 注释示例），
  //    只换第一处时第二处仍在 ⇒ 这条臂会假绿（第一版就是这么写的，实测抓出来）。
  ok = arm('合并 timeout 与 failed', true, (s) => s.replaceAll('NOTARY_STATE=timeout', 'NOTARY_STATE=failed')) && ok;
  // 臂 3：timeout 那一档打 ✅
  ok = arm(
    'timeout 打 ✅',
    true,
    (s) => s.replace(/timeout\) echo "  ⚠️/, 'timeout) echo "  ✅'),
  ) && ok;

  console.log(arms.join('\n'));
  return ok;
}

const IS_ENTRY = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (IS_ENTRY) {
  if (process.argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1);
  const { problems, reading } = notaryPostureProblems(read(PACKAGER), read(REINSTALL));
  if (problems.length === 0) {
    console.log(
      `✅ 公证状态是**两档读数**：打包脚本写 ${reading.statesFound.join(' / ')}（+ skipped-*），` +
        '重装脚本分别打话术、✅ 只留给 stapled。',
    );
    process.exit(0);
  }
  console.error(`🔴 公证状态又变回"一个布尔"了（${problems.length} 处）：`);
  for (const p of problems) console.error(`   · ${p}`);
  process.exit(1);
}
