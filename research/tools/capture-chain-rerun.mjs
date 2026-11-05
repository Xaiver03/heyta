// 主链整趟复跑（可复用装置，收集框线）：顺序照 `pnpm check`，但**会启动浏览器、
// 或射程覆盖别人取证图的步骤不跑**；`-r test` 换成"排除 e2e 包"的同义写法。
//
// 🔴 这枚装置本身踩过三次静默失效，全部记在 `docs/reference/environment-traps.md` #650：
//    ① 步骤串没剥 `pnpm ` 前缀 ⇒ 跳过集合一枚都没匹配上 ⇒ 整条 e2e 被套跑完，
//       重写 34 张别线取证图（14 张内容与 HEAD 不同）；
//    ② 改写放在跳过判定**之后** ⇒ `-r test` 被整枚跳掉，`ran=150` 里一枚包测试都没跑；
//    ③ `pnpm -r --filter '!@heyta/e2e' test` 回 `No projects matched the filters` 且 **rc=0**
//       —— 少了 `run` 这个词就什么都不跑，而退出码看不出来。
//    ⇒ 所以这里三条都做成会红的：跳过集合自证匹配、改写先于跳过、`--dry-run` 先把分类打出来。
//
// 用法：
//   node research/tools/capture-chain-rerun.mjs --dry-run   # 只打印分类，不执行
//   node research/tools/capture-chain-rerun.mjs             # 真跑（失败不中断，末尾报全部红点）
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, globSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DRY = process.argv.includes('--dry-run');
const LOG = `${ROOT}.run-logs/chain/${DRY ? 'dryrun' : 'run'}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}.log`;

const normalize = (s) => s.trim().replace(/^pnpm\s+/, '');
const SKIP = new Set([
  'check:ai-e2e',
  'check:privacy-consent-e2e',
  'check:landing-e2e',
  'check:reminder-permission',
  'check:calendar-evidence-rigs',
  '-r test',
]);
// 兜底按内容再拦一道。⚠️ 别写 `check:ai-` 这种宽前缀：那会连 `check:ai-quota`
// / `check:ai-tools` / `check:ai-coverage` 三枚**静态门**一起误拦（--dry-run 能看见）。
const DANGEROUS = /(--dir e2e run test|playwright test|check:ai-e2e|check:privacy-consent-e2e|check:landing-e2e|check:reminder-permission|check:calendar-evidence-rigs)/;
// `-r test` 的同义写法：排除 e2e 包。⚠️ 必须带 `run`（见 #650 ③）。
const REWRITE = new Map([['-r test', `-r --filter '!@heyta/e2e' run test`]]);

const chain = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')).scripts.check;
const steps = chain.split('&&').map(normalize).filter(Boolean);
if (steps.length < 100) throw new Error(`链只有 ${String(steps.length)} 步，不像完整的 check`);

// 🔴 自证：SKIP 里每一枚都必须真的在链里出现，否则等于没跳 —— 当场抛。
const unmatched = [...SKIP].filter((n) => !steps.includes(n));
if (unmatched.length > 0) throw new Error(`跳过集合里这些名字在链里找不到（等于没跳）：${unmatched.join(', ')}`);

function foreignEvidenceLines() {
  return globSync('apps/*/evidence/**/*.png', { cwd: ROOT, windowsPathsNoEscape: true })
    .filter((f) => !f.includes('capture-due-capsule') && !f.includes('capture-inline-highlight-spike'))
    .sort()
    .map((f) => {
      const h = createHash('md5');
      h.update(readFileSync(`${ROOT}${f}`));
      return `${h.digest('hex')} ${f}`;
    });
}

const plan = steps.map((step) => {
  const cmd = REWRITE.has(step) ? REWRITE.get(step) : step;
  const skip = !REWRITE.has(step) && (SKIP.has(step) || DANGEROUS.test(cmd));
  return { step, cmd, skip };
});
const toRun = plan.filter((p) => !p.skip);
const toSkip = plan.filter((p) => p.skip);

// 🔴 零执行必须红：改写没生效（全被跳掉）就是这种情况。
if (toRun.length < steps.length - SKIP.size) {
  throw new Error(`只打算跑 ${String(toRun.length)} 步，比"总数 − 跳过数"还少 ⇒ 有步骤被双重吞掉`);
}

if (DRY) {
  console.log(`链 ${String(steps.length)} 步：将跑 ${String(toRun.length)}，跳过 ${String(toSkip.length)}`);
  console.log('跳过清单：\n  ' + toSkip.map((p) => p.step).join('\n  '));
  console.log('改写清单：\n  ' + plan.filter((p) => REWRITE.has(p.step)).map((p) => `${p.step} → pnpm ${p.cmd}`).join('\n  '));
  const staticAi = ['check:ai-quota', 'check:ai-tools', 'check:ai-coverage'].filter((x) => toSkip.some((p) => p.step === x));
  console.log(staticAi.length === 0
    ? '✅ 三枚静态 check:ai-* 门仍在要跑的集合里（没被宽正则误拦）'
    : `🔴 静态门被误拦：${staticAi.join(', ')}`);
  process.exitCode = staticAi.length === 0 ? 0 : 1;
} else {
  writeFileSync(LOG, `chain steps=${String(steps.length)} 将跑=${String(toRun.length)} 跳过=${String(toSkip.length)}\n`);
  const before = foreignEvidenceLines();
  const failures = [];
  for (const { cmd } of toRun) {
    try {
      execSync(`pnpm ${cmd}`, { cwd: ROOT, stdio: 'pipe', timeout: 3_600_000, maxBuffer: 64 * 1024 * 1024 });
      appendFileSync(LOG, `OK   pnpm ${cmd}\n`);
    } catch (error) {
      failures.push(`pnpm ${cmd}`);
      appendFileSync(LOG, `RC${String(error.status ?? 'ERR')} pnpm ${cmd}\n${String(error.stderr ?? '').slice(0, 800)}\n`);
    }
  }
  const after = foreignEvidenceLines();
  const keyOf = (l) => l.slice(32);
  const beforeByFile = new Map(before.map((l) => [keyOf(l), l]));
  const touched = after.filter((l) => beforeByFile.get(keyOf(l)) !== l).length;
  const vanished = before.filter((l) => !after.some((a) => keyOf(a) === keyOf(l))).length;
  appendFileSync(LOG, `\nran=${String(toRun.length)} failures=${String(failures.length)} 别线图改写=${String(touched)} 消失=${String(vanished)}（跑前 ${String(before.length)} 张）\n${failures.join('\n')}\n`);
  console.log(`ran=${String(toRun.length)} failures=${String(failures.length)} 别线图改写=${String(touched)} 消失=${String(vanished)}  日志 ${LOG}`);
  for (const f of failures) console.log(`  🔴 ${f}`);
  process.exitCode = failures.length === 0 && touched === 0 && vanished === 0 ? 0 : 1;
}
