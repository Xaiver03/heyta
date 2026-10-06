/**
 * W7 e2e 判据的变异臂（一次性 rig，不入库）
 *
 * 每一臂：备份 → 改一处（命中数必须恰好 1，否则当场抛）→ 只跑那一条用例 →
 * 记 rc 与失败用例名 → **逐字节还原并核 md5**。
 * 还原失败 = 立刻停止（不许把变异留在工作树里）。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = '/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-w7';
const md5 = (file) => createHash('md5').update(readFileSync(file)).digest('hex');
const abs = (p) => `${ROOT}/${p}`;

const PAINTER = 'apps/web/src/features/countdown/card-export.ts';
const VIEW = 'apps/web/src/features/countdown/CountdownView.tsx';
const PROBES = 'e2e/tests/net-egress.ts';

const ARMS = [
  {
    id: 'M1 尺寸翻倍',
    file: PAINTER,
    from: 'buildCardExportLayout(request, EXPORT_CARD_SCALE)',
    to: 'buildCardExportLayout(request, EXPORT_CARD_SCALE * 2)',
    grep: '导出这张图',
    expectRed: '导出这张图',
  },
  {
    id: 'M2 导出路上发一条请求',
    file: PAINTER,
    from: '  document.body.appendChild(anchor);',
    to: "  {\n    const probe = new XMLHttpRequest();\n    probe.open('GET', '/api/mutated-into-export-path');\n    probe.send();\n  }\n  document.body.appendChild(anchor);",
    grep: '导出这张图',
    expectRed: '导出这张图',
    // ⚠️ 这一臂**故意用 XHR 而不是 fetch**：`consent-gate.ts:179` 把 `globalThis.fetch`
    //   换成了带闸门的实现，而闸门装在**我们的页内计数器外面** —— 在「只用本机」这台载体上
    //   一条 `fetch()` 变异会被产品自己挡掉（两支计数器都数不到），臂会"存活"，
    //   而那存活证明的是**产品的闸门有牙**，不是这条判据没牙。两件事要分开记。
  },
  {
    id: 'M2b 路上 fetch 一条（对照：产品自己的同意闸门会先挡住）',
    file: PAINTER,
    from: '  document.body.appendChild(anchor);',
    to: "  void fetch('/api/mutated-into-export-path');\n  document.body.appendChild(anchor);",
    grep: '导出这张图',
    expectRed: '导出这张图',
    // ⚠️ 这一臂**预期不红**，而且那是好消息：`consent-gate.ts:179` 把 `globalThis.fetch`
    //   换成了带闸门的实现，闸门装在页内计数器**外面**，所以「只用本机」这台载体上
    //   这条 fetch 根本发不出去。它证明的是产品闸门有牙，不是这条判据没牙 ——
    //   判据的牙由上面那条 XHR 臂回答（XHR 不经那个闸门）。
    expectSurvive: true,
  },
  {
    id: 'M3 页内计数器不装',
    file: PROBES,
    from: 'export async function installInPageNetCounter(page: Page): Promise<void> {\n  await page.addInitScript(() => {',
    to: 'export async function installInPageNetCounter(page: Page): Promise<void> {\n  return;\n  await page.addInitScript(() => {',
    grep: '正向对照',
    expectRed: '正向对照',
  },
  {
    id: 'M4 失败被当成成功',
    file: PAINTER,
    from: "  if (ctx === null) return { ok: false, error: 'no-canvas' };",
    to: "  if (ctx === null) return { ok: true, fileName: 'x.png', width: 0, height: 0 };",
    grep: '导不出来必须上屏',
    expectRed: '导不出来必须上屏',
  },
  {
    id: 'M5 主题不参与绘制',
    file: VIEW,
    from: '      theme: { tokens: theme.tokens, text: theme.text },',
    to: "      theme: { tokens: { ...theme.tokens, 'color.background': '#f8fafc' }, text: theme.text },",
    grep: '暗色主题跟着走',
    expectRed: '暗色主题跟着走',
  },
];

function run(grep) {
  try {
    const out = execFileSync(
      'npx',
      ['playwright', 'test', 'tests/countdown-export.spec.ts', '-g', grep, '--reporter=list', '--retries=0'],
      { cwd: `${ROOT}/e2e`, encoding: 'utf8', stdio: 'pipe', timeout: 300_000, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } },
    );
    return { rc: 0, out };
  } catch (error) {
    return { rc: Number(error.status ?? 1), out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

const TITLES = (out, mark) =>
  [...out.matchAll(new RegExp(`\\s${mark}\\s+\\d+\\s.+\\u203a\\s+(.+)\\s+\\(\\d[\\d.]*m?s\\)`, 'gmu'))].map(
    (m) => (m[1] ?? '').trim(),
  );

// 🔴 未变异对照：先原样跑一遍整个文件，确认**这个 rig 数得出 5 条绿**。
// 少了这一条，后面每一臂的 `red: []` 都可能只是"解析器没匹配上"（本仓踩过两次）。
{
  const ctl = run('W7 ·');
  const green = TITLES(ctl.out, '✓');
  console.log(`CONTROL rc=${ctl.rc} green=${green.length} ${JSON.stringify(green)}`);
  if (ctl.rc !== 0 || green.length !== 5) {
    console.error('🔴 未变异对照不成立（要 rc=0 且恰好 5 条绿），后面的臂读数全部作废');
    process.exit(1);
  }
}


const results = [];
for (const arm of ARMS) {
  const file = abs(arm.file);
  const before = md5(file);
  const source = readFileSync(file, 'utf8');
  const hits = source.split(arm.from).length - 1;
  if (hits !== 1) {
    results.push({ arm: arm.id, error: `命中 ${hits} 次（要恰好 1 次），这一臂没做成` });
    continue;
  }
  writeFileSync(file, source.replace(arm.from, arm.to));
  const { rc, out } = run(arm.grep);
  // 行形状（NO_COLOR 之后）：`  ✘  2 [chromium] › tests/x.spec.ts:1:3 › 组 › 用例名 (1.8s)`
  // 原来的正则要求 `✘` 前**恰好一个**空格，实际是两个 ⇒ 数出 0 条（探针自己坏了）。
  const titles = (mark) =>
    [...out.matchAll(new RegExp(`\\s${mark}\\s+\\d+\\s.+\\u203a\\s+(.+)\\s+\\(\\d[\\d.]*m?s\\)`, 'gmu'))].map(
      (m) => (m[1] ?? '').trim(),
    );
  const failed = titles('✘');
  const passed = titles('✓');
  const firstError = (out.match(/^\s*Error:.*$/mu) ?? [''])[0]?.trim().slice(0, 150) ?? '';
  writeFileSync(file, source);
  const after = md5(file);
  results.push({
    arm: arm.id,
    rc,
    red: failed,
    green: passed,
    firstError,
    restored: after === before,
    asExpected:
      arm.expectSurvive === true
        ? rc === 0 && failed.length === 0
        : rc !== 0 && failed.some((name) => name.includes(arm.expectRed)),
  });
  if (after !== before) {
    console.error(`🔴 ${arm.id} 还原失败，停止后续臂`);
    break;
  }
  console.log(JSON.stringify(results.at(-1)));
}
console.log('SUMMARY ' + JSON.stringify(results, null, 1));
