#!/usr/bin/env node
/**
 * 表单解剖门禁（2026-10-24）
 * ==========================
 *
 * ## 为什么需要它
 *
 * 那个「添加习惯」对话框（11 控件平铺、标签在控件上方、动作按钮滚出视口）
 * 把 `check:design`（9 类裸值）、`check:l4`（内联样式）、`check:overlay`（模态账本）
 * **全部走绿**了。原因不是它违反了哪条规则，是"一个表单该长什么样"**从来没有规则**：
 * 实测全仓填表界面有 **6 种解剖**、**84 处手写 `<label>`**，而"对不对"没有判据。
 *
 * 本脚本管两条**只减不增**的债（与 `check:overlay` 同一条纪律）：
 *
 *   **R1 手写**字段**标签账本**
 *      `apps/web/src/features/**` 里每一处**包着文本类控件**的 `<label>`
 *      都是"这一行自己拼解剖"的证据。它们是既存债务，**只许减少**：
 *      新写的字段必须走 `FormField`。
 *      ⚠️ **复选框 / 单选框 / 开关的 label 不算**：那是"选项"，不是"字段"，
 *      解剖不同（方框 + 一句话），它们不该走 `FormField`。
 *      账内读数涨了 ⇒ 红；账外出现 ⇒ 红；**读数掉了却没改账本 ⇒ 也红**
 *      （这条是"它真的在缩"的唯一读数，与 `check:overlay` 同一条理由）。
 *
 *   **R2 `.ht-input-field` 只有一个定义处**
 *      解剖的类名只许在 `apps/web/src/styles/app/form.css` 里定义。
 *      在别处再造一个 `.ht-input-field*`（或 `.xxx__field` 去改 `grid-template-columns`）
 *      就是"第二种解剖"，而它不会被任何既有门禁看见。
 *
 * ## 它**故意不**管什么
 *
 * · 不管"长得好不好看"（那是人看图，见 `docs/agents/ui-acceptance.md`）；
 * · 不管几何（控件几档高、动作区在不在视口里）—— 那些要真浏览器，
 *   在 `e2e/tests/habit-create-shape.spec.ts`。
 *   ⚠️ 把几何写进这里会得到一条**永远通过**的正则判据，比没有更糟（§7 元规则 2）。
 *
 * ## 用法
 *
 *   node scripts/check-form-anatomy.mjs            # 判定
 *   node scripts/check-form-anatomy.mjs --update   # 只许把账本改小
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts/form-anatomy-ledger.json');
const update = process.argv.includes('--update');
/**
 * `--reseed`：**重设基线**，只在"指标定义变了"时用（例如 2026-10-24 把
 * "所有 `<label>`" 收窄成"包着文本控件的 `<label>`"）。平时一律用 `--update`，
 * 它只许把账本改小。
 */
const reseed = process.argv.includes('--reseed');

const FEATURES = join(ROOT, 'apps/web/src/features');
const FORM_CSS = join(ROOT, 'apps/web/src/styles/app/form.css');
const STYLES = join(ROOT, 'apps/web/src/styles/app');

function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, ext, out);
    else if (name.endsWith(ext)) out.push(full);
  }
  return out;
}

/** 去掉注释再数 —— 注释里提到 `<label>` 不算一处债务（本仓的脚本都这么做）。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * **不是字段**的 `<label>`（逐文件登记，必须写理由）。
 *
 * 🔴 为什么要有这一格：`FormField` 的解剖是"标签列 + 控件"。有些界面里的 `<label>`
 * 包着控件，但它**不是录入字段** —— 把它套进字段解剖会让它长得更差。
 * 与其逼着人二选一（要么硬套、要么忍着门禁一直红），不如**明说哪几处不是**，
 * 并让这张表带两个约束：
 *   1. 每条必须写 `why`（成本是刻意的：写理由会逼人想清楚）；
 *   2. 登记的条目**今天必须还能命中** —— 命中不到就报"登记已过期"，
 *      否则它会变成一张越来越长的免死金牌。
 */
const NOT_A_FIELD_ALLOW = [
  {
    file: 'apps/web/src/features/calendar/CalendarHeaderToolbar.tsx',
    why:
      '视图切换（月/周/时间轴）住在 56px 高的表头里，是**工具栏控件**不是录入字段；'
      + '它套进"标签列 + 控件"会让表头长出一个 6rem 的槽。判据：这一处没有提交动作，'
      + '选完即导航（`view.setView` / `onOpenTimeline`）。',
  },
];

/**
 * 这一处 `<label>` 是不是**一个字段**（而不是一个选项）。
 *
 * 🔴 判据是"它里面有没有文本类控件"，不是"有没有 `<label>`"：
 * 复选框 / 单选框 / 开关的 label 属于**选择项**，它们**不该**走 `FormField`
 * （字段是"标签 + 输入"，选项是"方框 + 一句话"，解剖不同）。
 * 第一版把两者一起数，于是 `AiSettings` 被记成 10 处债务，而其中 7 处
 * 是选项 —— **指标一虚，门禁就会开始被人绕过**（这也是本仓反复记的那条）。
 *
 * 匹配方式：`<label` 与它最近的一个 `</label>` 之间那段源码。
 * 本仓的 label 不嵌套，所以"最近的一个"就是它的闭合（有测试证明它会数对）。
 */
const FIELD_CONTROL = /<(input(?![^>]*type=\{?['"](?:checkbox|radio)['"])|input(?![^>]*type=)|select|textarea)[\s>/]/;
function countFieldLabels(code) {
  let count = 0;
  let from = 0;
  for (;;) {
    const open = code.indexOf('<label', from);
    if (open === -1) return count;
    const close = code.indexOf('</label>', open);
    if (close === -1) return count;
    const body = code.slice(open, close);
    // `type="checkbox"` / `type="radio"` / `type={kind}` 一律当选项处理：
    // 宁可少算一处债务，也不要让"选项"被算成"字段"（误报会让门禁失去可信度）。
    // ⚠️ 2026-10-24 第二版：`type="radio"` 原先漏了 —— 它只匹配到 `type={` 那种
    //    动态写法，于是 `TaskRepeat` 的三个单选组被记成"字段债"。
    const isChoice = /type=\{?['"]?(?:checkbox|radio)|type=\{/.test(body);
    if (!isChoice && FIELD_CONTROL.test(body)) count += 1;
    from = close + '</label>'.length;
  }
}

// ── 剔除"不是字段"的登记（并检查每一条今天还命中）──────────────
// ── R1：手写字段标签账本 ────────────────────────────────────────
const found = {};
for (const file of walk(FEATURES, '.tsx')) {
  const code = stripComments(readFileSync(file, 'utf8'));
  const count = countFieldLabels(code);
  if (count > 0) found[relative(ROOT, file)] = count;
}

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));

const problems = [];
for (const entry of NOT_A_FIELD_ALLOW) {
  if (found[entry.file] === undefined) {
    problems.push(
      `NOT_A_FIELD_ALLOW 登记已过期：${entry.file} 今天一处都不命中 —— `
        + '要么它已经迁移完（那就把这条删掉），要么路径写错了',
    );
    continue;
  }
  delete found[entry.file];
}


const drifts = [];

for (const [file, count] of Object.entries(found)) {
  const allowed = ledger.labels[file];
  if (allowed === undefined) {
    problems.push(`账外新增手写字段标签：${file}（${count} 处）—— 新字段请用 apps/web/src/lib/form/FormField.tsx`);
  } else if (count > allowed) {
    problems.push(`账内读数涨了：${file} ${allowed} → ${count}`);
  } else if (count < allowed) {
    drifts.push(`${file} ${allowed} → ${count}`);
  }
}
for (const [file, allowed] of Object.entries(ledger.labels)) {
  if (found[file] === undefined) drifts.push(`${file} ${allowed} → 0`);
}

// ── R2：.ht-input-field 只许在 form.css 里定义 ─────────────────────────
const fieldDefs = [];
for (const file of walk(STYLES, '.css')) {
  if (file === FORM_CSS) continue;
  const css = readFileSync(file, 'utf8');
  if (/\.ht-input-field[\w-]*\s*[,:{]/.test(css)) fieldDefs.push(relative(ROOT, file));
}
if (fieldDefs.length > 0) {
  problems.push(
    `.ht-input-field* 在 form.css 之外被定义：${fieldDefs.join('、')} —— 解剖只有一个来源，`
      + '别处只许改配色/宽度，不许再定义字段形状',
  );
}

// ── 读数 ────────────────────────────────────────────────────────
const totalFound = Object.values(found).reduce((sum, n) => sum + n, 0);
const totalLedger = Object.values(ledger.labels).reduce((sum, n) => sum + n, 0);

console.log('表单解剖门禁：手写**字段**标签账本（R1）+ 解剖单一来源（R2）');
console.log(`   现量：手写字段标签（含 input/select/textarea 的 <label>）${totalFound} 处 / ${Object.keys(found).length} 文件`);
console.log(`   账本：${totalLedger} 处 / ${Object.keys(ledger.labels).length} 文件`);
console.log(`   解剖定义处：${relative(ROOT, FORM_CSS)}（唯一）`);

if (reseed) {
  const next = Object.fromEntries(
    Object.entries(found).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  writeFileSync(LEDGER, `${JSON.stringify({ ...ledger, labels: next }, null, 2)}\n`);
  console.log(`   已重设基线：${Object.values(next).reduce((s2, n) => s2 + n, 0)} 处 / ${Object.keys(next).length} 文件`);
  process.exit(0);
}

if (update) {
  const next = Object.fromEntries(
    Object.entries(found).filter(([file]) => {
      const allowed = ledger.labels[file];
      if (allowed === undefined) return false;
      if (found[file] > allowed) {
        console.error(`🔴 ${file} 涨了（${allowed} → ${found[file]}），--update 只许改小，拒绝写入`);
        process.exitCode = 1;
        return true;
      }
      return found[file] > 0;
    }),
  );
  writeFileSync(LEDGER, `${JSON.stringify({ ...ledger, labels: next }, null, 2)}\n`);
  console.log(`   已更新账本：${Object.values(next).reduce((s, n) => s + n, 0)} 处`);
  process.exit(process.exitCode ?? 0);
}

if (drifts.length > 0) {
  console.error('\n🔴 账内读数掉了，但账本没跟着改小 —— 那会让"只减不增"只剩前半句：');
  for (const line of drifts) console.error(`   ${line}`);
  console.error('   修法：node scripts/check-form-anatomy.mjs --update');
  process.exitCode = 1;
}

if (problems.length > 0) {
  console.error('\n🔴 表单解剖退步：');
  for (const line of problems) console.error(`   ${line}`);
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  console.log('✅ 表单解剖：账外 0 处、读数与账本一致、解剖只有一个来源。');
}
