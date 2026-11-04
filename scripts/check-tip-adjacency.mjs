#!/usr/bin/env node
/**
 * G-6 的第二半：`?` 的**位置**口径（账本制，只减不增）
 * ==================================================
 *
 * 规则文件里那条口径是两句：
 *   ① 说明文字不许内联，只许进 `?`  —— 已由 `check-settings-no-prose.mjs` 钉住；
 *   ② 「一枚 `?` **紧跟它所解释的标签或小标题**（同一段文字之后），值那一列不许出现问号」
 *      —— 这一半此前**只有 `profile-panel.spec.tsx` 一枚断言**在管，而且只管个人资料那一屏。
 *
 * 🔴 为什么这一半必须有尺：②被违反时**不会有任何测试变红**，症状是屏幕上出现一枚
 *   **没有归属的孤零零问号**（2026-11-04 真浏览器截图在 PasswordPanel 抓到两枚：
 *   代码注释自己写着"按钮旁的 `?`"，代码却把它排在段落之后）。
 *   同类缺陷是一族不是一个，所以这里扫**全部**调用点。
 *
 * 判据（调用点级，不扫组件内部 —— 与 prose 那把尺同一个边界）：
 *   每个 `<SettingsInfoTip` 必须落在下面四种位置之一 ——
 *     · 标签/标题元素**内部**：`<label>` / `<h2>` / `<h3>` / `<span>`
 *     · 宿主那一格的 className 里含 `__labelcell` / `__row-label` / `__actions`
 *     · 作为**prop** 交给原语（`labelTip={<…/>}` / `tip={<…/>}`）—— 位置由原语保证
 *     · 共享行模型里的 `hint:` 字段（那条路走 `packages/ui`，不在这个文件的射程内）
 *   其余 ⇒ 违规。
 *
 * 账本制（与 `check:overlay` / `check:settings-prose` 同一条纪律）：
 *   账本外新增 ⇒ 红；账内读数涨了 ⇒ 红；掉了却没改账本 ⇒ 红（这是"它真的在缩"的唯一读数）。
 *   清理时只许改小：`node scripts/check-tip-adjacency.mjs --update`。
 *
 * 用法：node scripts/check-tip-adjacency.mjs [--report | --update | --self-test]
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['apps/web/src/features/settings'];
const LEDGER = join(ROOT, 'scripts', 'settings-tip-ledger.json');

/**
 * 紧跟标签/小标题这一族里合法的**父元素**。
 * ⚠️ 口径原文是「一枚 `?` 紧跟它所解释的标签或小标题（**同一段文字之后**）」——
 *   所以 `p` / `legend` 这类"承载那段文字的节点"内部也算紧跟：
 *   `MemoryPanel` 与 `AiSettings` 里就有把 `?` 挂在 hint 段落末尾的写法，那是合规，
 *   不是违规（第一版把它们误判成违规，正是把"独立一块"与"排在段落之后"混为一谈）。
 */
const OK_PARENTS = new Set(['label', 'legend', 'h2', 'h3', 'h4', 'span', 'p', 'dt', 'summary']);
/** 合法的父容器 className 片段（宿主那一格）。 */
const OK_CLASS_FRAGMENTS = ['__labelcell', '__row-label', '__actions'];
/**
 * 父容器 className 里出现这些片段 ⇒ 这一格本身就是**标题/正文节点**，
 * `?` 排在它的文字之后就是"紧跟它所解释的小标题"（`SettingsNotice` 的
 * `<div class="ht-type-headline">{title}<SettingsInfoTip/></div>` 是这一族）。
 */
const OK_HEADLINE_FRAGMENTS = ['__h3', 'ht-type-headline', 'ht-type-row-title', '__help-line'];
/**
 * 🔴 前一个**兄弟**是这些闭合标签 ⇒ `?` 紧跟在它解释的那个东西后面。
 *   `.ht-settings__toggle` 那一行就是这种写法：`<label>…</label>` 之后一枚 `?`，
 *   视觉上完全相邻；把它判成违规会逼着人把 `?` 塞进 label 内部 ——
 *   而塞进 label 会偷走焦点（本线刚修掉的那个隐患）。
 */
const OK_PREVIOUS_SIBLING = /<\/(label|h2|h3|h4|legend|span|button|a|summary|dt)>$/;
/** 作为 prop 交给原语（位置由原语保证）。 */
const PROP_POSITION = /(?:^|\s)[A-Za-z$][\w$]*[Tt]ip\s*=\s*\{\s*$/;
/**
 * 🔴 但 prop 的表达式里可以夹三元：`tip={ x === undefined ? undefined : (<SettingsInfoTip/>) }`
 *   （PasswordPanel 的 `PasswordField.tip` 就是这么写的）。只看"`Tip={` 紧挨着"会把这种
 *   合规写法判成违规 —— 所以再认一层：**当前仍处在一个 `*Tip={` 的未闭合花括号里**就算 prop 位置。
 */
const INSIDE_TIP_PROP = /[A-Za-z$][\w$]*[Tt]ip\s*=\s*\{[^}]*$/;

/**
 * 去掉尾部空白与 JSX 注释，露出真正的"前一个东西"。
 * ⚠️ 不脱注释会漏判：`labelTip={` 与那枚 tip 之间可以只隔着一段 JSX 注释
 *   （PasswordPanel 就是这么写的），第一版因此把合规的 prop 位置读成了违规。
 *   （这里刻意不把那段注释的字面形状写出来：块注释里出现"星号斜杠"会提前结束注释，
 *   本文件第一版就踩过这个，症状是整个脚本语法错误。）
 */
function stripTail(t) {
  let out = t.replace(/\s+$/, '');
  for (;;) {
    const next = out.replace(/\s+$/, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}\s*$/, '').replace(/\/\*[\s\S]*?\*\/\s*$/, '');
    if (next === out) return out;
    out = next;
  }
}

function isTsx(name) {
  return name.endsWith('.tsx');
}

/**
 * 扫一个文件，返回每一处 `<SettingsInfoTip` 的判定。
 *
 * 🔴 这里**不**用完整 JSX parser：本文件只需要"这个调用点的父元素是谁"，
 *   而一个 parser 会让判据依赖构建工具链。做法是逐字符走一遍，维护元素栈，
 *   跳过字符串与注释 —— 与本仓 `check-ui-provider.mjs` 的配对标签扫描同族。
 */
function scan(file) {
  const src = readFileSync(file, 'utf8');
  const findings = [];
  /** 元素栈：`{ name, openTag }`。 */
  const stack = [];

  /**
   * 处理 `start` 处的一个标签；返回它结束的位置。
   *
   * 🔴 属性表达式里可以再套 JSX（`labelTip={<SettingsInfoTip … />}`），所以这里**递归**：
   *   第一版按 `[^>]*>` 读开标签，把整段（连同里面那枚 `?`）当成外层标签吃掉 ——
   *   33 处调用点只读到 31 处，缺的正好是两枚 prop 位置的。
   *   这种漏法比误报更坏：它让门禁在"最该看的那种写法"上失明。
   */
  function handleTag(start) {
    let i = start + 1;
    if (src[i] === '/') i += 1;
    const nameStart = i;
    while (i < src.length && /[\w.$]/.test(src[i])) i += 1;
    if (i === nameStart) return start + 1;
    const name = src.slice(nameStart, i);
    const closing = src[start + 1] === '/';
    if (closing) {
      // 闭合标签：弹到配对的那一层。
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
    } else if (name !== 'SettingsInfoTip') {
      stack.push({ name, openTag: src.slice(start, start + 400) });
    }

    let depth = 0;
    let selfClosing = false;
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        let j = i + 1;
        while (j < src.length) {
          if (src[j] === '\\') {
            j += 2;
            continue;
          }
          if (src[j] === ch) break;
          j += 1;
        }
        i = j;
        continue;
      }
      if (ch === '{') {
        depth += 1;
        continue;
      }
      if (ch === '}') {
        depth -= 1;
        continue;
      }
      // 属性表达式内部的嵌套元素（含 `labelTip={<SettingsInfoTip/>}`）
      if (ch === '<' && depth > 0 && /[A-Za-z/]/.test(src[i + 1] ?? '')) {
        i = handleTag(i) - 1;
        continue;
      }
      if (ch === '>' && depth === 0) {
        selfClosing = src[i - 1] === '/';
        if (name === 'SettingsInfoTip') {
          if (selfClosing) {
            findings.push({ ...classify(src, start, stack), line: src.slice(0, start).split('\n').length });
          }
          if (!selfClosing) stack.pop();
          return i + 1;
        }
        if (selfClosing) stack.pop();
        return i + 1;
      }
    }
    return src.length;
  }

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === c) {
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }
    if (c === '<' && /[A-Za-z/]/.test(src[i + 1] ?? '')) {
      i = handleTag(i);
      continue;
    }
    i += 1;
  }
  return findings;
}

function classify(src, at, stack) {
  const lineStart = src.lastIndexOf('\n', at - 1) + 1;
  const sameLine = src.slice(lineStart, at);
  const parent = stack.length > 0 ? stack[stack.length - 1] : null;
  const tail = stripTail(src.slice(Math.max(0, at - 400), at));

  // ① prop 位置：`labelTip={<…/>}` / `tip={<…/>}` —— 位置由原语保证
  if (PROP_POSITION.test(tail) || INSIDE_TIP_PROP.test(tail)) {
    return { ok: true, why: 'prop 交给原语（位置由原语保证）', parent: parent?.name ?? null };
  }
  // ② 在标签/标题/正文节点**内部**，排在它的文字之后
  if (parent !== null && OK_PARENTS.has(parent.name)) {
    return { ok: true, why: `在 <${parent.name}> 内部`, parent: parent.name };
  }
  if (parent !== null) {
    const cls = /className="([^"]*)"/.exec(parent.openTag)?.[1] ?? '';
    const hit = OK_CLASS_FRAGMENTS.find((f) => cls.includes(f));
    if (hit !== undefined) {
      return { ok: true, why: `在 .${hit} 那一格里`, parent: `${parent.name}.${cls}` };
    }
    const headline = OK_HEADLINE_FRAGMENTS.find((f) => cls.includes(f));
    if (headline !== undefined) {
      return { ok: true, why: `在标题格 .${headline} 的文字之后`, parent: `${parent.name}.${cls}` };
    }
    // ③ 前一个兄弟就是它所解释的那个标签/标题/控件
    if (OK_PREVIOUS_SIBLING.test(tail)) {
      return { ok: true, why: `紧跟前一个兄弟（${tail.slice(-12)}）`, parent: parent.name };
    }
    return { ok: false, why: `独立一块（父元素 <${parent.name}${cls ? ' .' + cls : ''}>，前面是「${tail.slice(-24)}」）`, parent: parent.name };
  }
  return { ok: false, why: '找不到父元素（栈空）', parent: null };
}

function collect() {
  const rows = [];
  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) {
      console.error(`🔴 判据锚点失效：找不到 ${dir} —— 目录搬家之后这把尺会永远"零违规"，所以它必须报错。`);
      process.exit(1);
    }
    for (const name of readdirSync(abs).sort()) {
      if (!isTsx(name)) continue;
      const rel = `${dir}/${name}`;
      for (const f of scan(join(abs, name))) rows.push({ file: name, rel, ...f });
    }
  }
  return rows;
}

function loadLedger() {
  if (!existsSync(LEDGER)) return null;
  return JSON.parse(readFileSync(LEDGER, 'utf8'));
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--self-test')) {
    // 变异臂：往容器**第一个孩子**的位置塞一枚 `?`（前面没有任何标签 ⇒ 独立一块），门禁必须红。
    const target = join(ROOT, 'apps/web/src/features/settings/SessionsPanel.tsx');
    const original = readFileSync(target, 'utf8');
    const anchor = '<div className="ht-settings" data-testid="sessions-panel">\n';
    const injected =
      anchor + '      <SettingsInfoTip testId="mut-tip-standalone" label="变异臂" text="变异臂" />\n';
    const mutated = original.replace(anchor, injected);
    if (mutated === original) {
      console.error('self-test: 找不到可注入的面板根容器锚点，夹具失效');
      process.exit(1);
    }
    writeFileSync(target, mutated);
    /**
     * 🔴 `finally` 里不许再走 `process.exit`，而**成功路径上的 `process.exit(1)` 会跳过 finally**
     *   —— 本脚本第一版就是这么把注入的变异留在工作树里没还原的（症状：SessionsPanel 莫名多一行）。
     *   所以这里只记状态，退出一律放在还原之后。
     */
    let failure = null;
    try {
      const rows = collect();
      const bad = rows.filter((r) => !r.ok);
      if (bad.length === 0) {
        failure = 'self-test: 注入独立一枚后仍读不出违规 ⇒ 这把尺不能失败';
      } else if (!bad.some((r) => r.file === 'SessionsPanel.tsx')) {
        failure = `self-test: 注入了 SessionsPanel，红的却不是它（${bad.map((b) => b.file).join(', ')}）`;
      }
    } finally {
      writeFileSync(target, original);
    }
    if (failure !== null) {
      console.error(`${failure}（工作树已还原：现量 \`git status --short\` 对该文件为空）`);
      process.exit(1);
    }
    console.log('self-test: ✅ 变异臂被读到并已还原（独立一枚 ⇒ 违规里含 SessionsPanel）');
    return;
  }

  const rows = collect();
  const bad = rows.filter((r) => !r.ok);
  const byFile = {};
  for (const r of bad) byFile[r.file] = (byFile[r.file] ?? 0) + 1;
  const total = bad.length;

  if (args.includes('--report')) {
    console.log(`调用点 ${String(rows.length)} 处：合规 ${String(rows.length - total)} / 独立一块 ${String(total)}`);
    for (const r of rows) {
      console.log(`  ${r.ok ? '✅' : '🔴'} ${r.rel}:${String(r.line)} ${r.why}`);
    }
    return;
  }

  const ledger = loadLedger();
  if (args.includes('--update')) {
    const next = { total, files: byFile };
    const prev = ledger ?? { total: -1, files: {} };
    if (prev.total >= 0 && next.total > prev.total) {
      console.error(`🔴 账本只许改小：${String(prev.total)} → ${String(next.total)}。新增的那些格要么改用共享载体，要么本来就不该新增。`);
      process.exit(1);
    }
    writeFileSync(LEDGER, JSON.stringify(next, null, 1));
    console.log(
      prev.total < 0
        ? `账本已建基线：${String(total)} 处（${String(Object.keys(byFile).length)} 个文件）—— 这是**存量**，此后新增即红、缩了要回来改小`
        : `账本已按现量重写：${String(prev.total)} → ${String(next.total)}（${String(Object.keys(byFile).length)} 个文件）`,
    );
    return;
  }

  if (ledger === null) {
    console.error('🔴 没有账本 —— 先 `node scripts/check-tip-adjacency.mjs --update` 建基线（不许没有账本就跑：那样它永远"零违规"）');
    process.exit(1);
  }

  const errors = [];
  for (const [file, count] of Object.entries(byFile)) {
    const known = ledger.files[file] ?? 0;
    if (count > known) {
      errors.push(`${file} 的独立 ` + '`?`' + ` 从 ${String(known)} 涨到 ${String(count)} ⇒ 新增一枚没有归属的问号`);
    } else if (count < known) {
      errors.push(`${file} 从 ${String(known)} 缩到 ${String(count)} 却没改账本 ⇒ 跑 --update（只许改小）`);
    }
  }
  if (Object.keys(ledger.files).some((f) => !(f in byFile) && ledger.files[f] > 0)) {
    const gone = Object.keys(ledger.files).filter((f) => !(f in byFile));
    errors.push(`账本里还登记着 ${gone.join(', ')}，现量却是 0 ⇒ 跑 --update 把账收小`);
  }

  if (errors.length > 0) {
    console.error(`G-6 ` + '`?`' + ` 位置门：❌ ${String(errors.length)} 条`);
    for (const e of errors) console.error(`  · ${e}`);
    console.error('\n判据正文：docs/agents/design-system.md 的「`?` 的位置与数量」+ docs/plans/settings-ui-governance-2026-11.md G-6。');
    console.error('出路：把 `?` 挪进它所解释的 label/h2/h3 内部，或挂进 .ht-settings__actions / labelTip；确实要独立一块就先写理由再 --update。');
    process.exit(1);
  }

  console.log(
    `G-6 ` + '`?`' + ` 位置门：✅ ${String(rows.length)} 处调用点，独立一块 ${String(total)} 处，与账本逐格相同（新增即红）`,
  );
}

main();
