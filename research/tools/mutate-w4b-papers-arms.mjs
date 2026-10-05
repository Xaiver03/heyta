#!/usr/bin/env node
/**
 * W4b 判据②（后台「调休/补班」把出处回显成可点链接）的变异台。
 *
 * 为什么在仓库里而不是 `/tmp`：`pnpm check` 与设备验收都要重跑这些臂，
 * 装置落在 `/tmp` 就等于"读数不可复现"（同仓先例见 `mutate-w7-e2e-arms.mjs` 文件头）。
 *
 * 用法（在工作树根目录）：
 *   node research/tools/mutate-w4b-papers-arms.mjs apply <B1|B2|B3|B4>
 *   node research/tools/mutate-w4b-papers-arms.mjs revert <B1|B2|B3|B4>
 *
 * 每一条的"应当红在哪"写在 `e2e/tests/admin-console.spec.ts` 对应行号上；
 * 🔴 一次只跑一臂，跑完立刻 revert，并用**链条开头**的 `shasum -a 256` 基线核对还原
 * （"替换命中一次"不保证"还原回到原点"）。
 *
 * 已跑读数（2026-10-04 04:1x–04:2x，载体 `feat/countdown-batch2`）：
 *   B1 ⇒ RC_B1=1，1 failed / 5 passed，红在 `:887`
 *   B2 ⇒ RC_B2=1，1 failed / 5 passed，红在 `:889`
 *   B3 ⇒ RC_B3=1，1 failed / 5 passed，红在 `:909`（正向对照那一句）
 *   B4 ⇒ **未跑**（同一格的第二个旋钮：折行。登记在此而不是删掉，
 *        因为 B3 已经证明这条 CSS 承重，B4 只是把"哪一半承重"再切细一档）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const PANEL = 'apps/web/src/features/admin/AdminPanel.tsx';
const CSS = 'apps/web/src/styles/app/admin.css';

const ARMS = {
  // B1：出处不再是链接 ⇒ `toHaveAttribute('href', paper)` 必须红。
  B1: { file: PANEL, edits: [{ from: 'href={paper}', to: 'href={undefined}' }] },
  // B2：链接不带 rel ⇒ `toHaveAttribute('rel', 'noreferrer noopener')` 必须红
  //     （安全判据：新窗口不许反向拿到后台这一页的 window）。
  B2: { file: PANEL, edits: [{ from: 'rel="noreferrer noopener"', to: 'rel=""' }] },
  // B3：把"出处徽标不再先占 max-content"这条修复拿掉 ⇒ 几何判据必须红。
  //     `flex: 0 1 auto` 就是它原本的默认值（basis = max-content = 两条 URL 一行的宽度）。
  B3: {
    file: CSS,
    edits: [{ from: '  flex: 1 1 0;\n  min-inline-size: 0;', to: '  flex: 0 1 auto;\n  min-inline-size: 0;' }],
  },
  // B4：把"URL 可以在徽标内部折行"拿掉 ⇒ 徽标 min-content 又是一整条 URL ⇒ 同一格再次被挤。
  B4: {
    file: CSS,
    edits: [{ from: '  overflow-wrap: anywhere;', to: '  overflow-wrap: normal;' }],
  },
};

const sha = (t) => createHash('sha256').update(t).digest('hex').slice(0, 12);
const [cmd, key] = process.argv.slice(2);
const arm = ARMS[key];
if (!arm || !['apply', 'revert'].includes(cmd)) {
  console.error('用法: node research/tools/mutate-w4b-papers-arms.mjs <apply|revert> <B1|B2|B3|B4>');
  process.exit(2);
}
let text = readFileSync(arm.file, 'utf8');
for (const [i, edit] of arm.edits.entries()) {
  const src = cmd === 'apply' ? edit.from : edit.to;
  const dst = cmd === 'apply' ? edit.to : edit.from;
  const hits = text.split(src).length - 1;
  if (hits !== 1) {
    console.error(`第 ${i + 1} 处命中数不是 1（${cmd} ${key}：命中 ${hits}），拒动并不落盘。`);
    process.exit(1);
  }
  text = text.replace(src, dst);
}
writeFileSync(arm.file, text, 'utf8');
console.log(`${cmd} ${key} OK file=${arm.file} sha=${sha(text)}`);
