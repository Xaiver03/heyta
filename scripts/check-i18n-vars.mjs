#!/usr/bin/env node
/**
 * 界面文案的**占位符对账**（常驻门禁，不占设备，纯读盘）。
 *
 * ## 为什么要有这条
 *
 * `check:ui-language` 钉的是"界面里不许出现硬编码文案"，它挡不住**另一种**说谎：
 * 调用点用 `t('key')` 取了一条**带 `{placeholder}`** 的词条却不传 vars。
 * 构建绿、类型绿、`check:ui-language` 绿，而用户看到的是字面的
 * `拆解结果（{count} 项）`、`添加 {name}`、`「{feature}」的端点不在这台设备上…`。
 *
 * 🔴 最后那一条不是排版问题，是**出境同意那句话里被同意的对象不见了** ——
 * 隐私文案缺了参数，用户就没法知道"这一次批的是哪件事"。
 *
 * ## 判据范围（写清楚，别读多）
 *
 * 只判**会渲染给用户**的调用点：apps 各壳的 src 与 packages 各包的 src。
 * 测试与夹具**不判** —— 那里的 `t('key')` 两边都少传时是自洽的（断言的就是同一串字面），
 * 把它算成缺陷只会制造需要被人忽略的假红。
 *
 * 一个调用点被判"缺参数"，要同时满足三条：
 *  ① 第一个实参是**字面量** key（`t(AI_FEATURE_LABEL_KEY[feature])` 那种动态 key 静态推不出来，
 *     单独计数报出来，不混进红）；
 *  ② 该 key 的 zh 值里确有 `{name}` 形状的占位符；
 *  ③ 要么**没有**第二个实参（也没有紧跟的 `.replace('{name}'` 手工处理），要么第二个实参是
 *     **能静态读出键名的对象字面量**且缺了某个键名。
 *
 * 🔴 第二种实参形状（变量、`{ ...展开 }`、计算键、key 后挂 ` as 类型` 之外的尾巴）
 * 归进**独立的"推不出"计数**并逐条打印，**不判红**。把它们判红会造出假缺陷，
 * 而假缺陷的代价是这条门禁整体被人忽略 —— 真缺陷就藏在同一份输出里。
 *
 * `--self-test` 的臂数由它自己打印（文档里不抄数字），逐臂覆盖：少传 vars 必须红、
 * 传了必须绿、手工 `.replace` 不算红、注释里的 `t()` 不算红、模板插值里的必须红、
 * 三种"推不出"形状不红**且必须被看见**、键名对不上必须红。
 * 另有一条阳性对照：真仓库里必须**读到**若干正常调用，读到 0 就是探针坏了，
 * 报退 2 而不是报"全部合规"。
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const DIST = join(ROOT, 'packages/i18n/dist');

function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

/** 取 zh 词表：优先 `import()` 具名导出 `zhCN`，失败退 2。 */
async function zhTable() {
  const url = new URL(`file://${join(DIST, 'index.js')}`);
  const m = await import(url.href);
  const tab = m.zhCN ?? m.ZH ?? m.default?.zhCN;
  if (!tab || typeof tab !== 'object') {
    die('🔴 从 i18n 产物里取不到 zhCN 表 —— 表名换了要同步改这条门禁，不然它会读出一张空表。');
  }
  return tab;
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'build') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(spec|test)\./.test(name) && !`${p}`.includes('/tests/')) acc.push(p);
  }
  return acc;
}

/**
 * 把**注释**抹成空格（长度不变、行号照旧），字符串与模板原样保留。
 *
 * 🔴 两件事都要，而且方向相反：
 *  · 注释必须抹 —— 第一版直接扫原文，于是文件头注释里那句
 *    「每个分支都写完整的 `t('key')`」被当成真实调用点，报出一条
 *    `key 不在词表里` 的**假缺陷**（`ProfileScreen.tsx` 实测）。
 *    假缺陷的代价不是多一行输出，是这条门禁开始被人整体忽略。
 *  · 字符串**不许**抹 —— 第二版顺手把引号内容也空白掉，于是
 *    `t('web.ai.breakdown.proposalHead')` 变成 `t('…空…')`，
 *    整条门禁读出"调用数 0"（自测臂 A/E 当场把它抓住，而不是被我肉眼放过）。
 *    要判的是**词条 key**，key 就住在字符串里。
 * 模板串里的 `${…}` 要当代码继续扫 —— `` `${t('x')} 项` `` 是真调用点。
 */
function codeOnly(text) {
  const out = [];
  const stack = [];
  let mode = 'code';
  let braceDepth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (mode === 'line') {
      out.push(c === '\n' ? '\n' : ' ');
      if (c === '\n') mode = stack.length > 0 ? stack.pop() : 'code';
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') {
        out.push('  ');
        i += 1;
        mode = stack.length > 0 ? stack.pop() : 'code';
      } else out.push(c === '\n' ? '\n' : ' ');
      continue;
    }
    if (mode === 'dq' || mode === 'sq') {
      out.push(c);
      if (c === '\\') {
        out.push(text[i + 1] === '\n' ? '\n' : (text[i + 1] ?? ' '));
        i += 1;
      } else if (c === (mode === 'dq' ? '"' : "'")) mode = stack.length > 0 ? stack.pop() : 'code';
      continue;
    }
    if (mode === 'tpl') {
      if (c === '\\') {
        out.push(c, text[i + 1] ?? ' ');
        i += 1;
      } else if (c === '`') {
        out.push(c);
        mode = stack.length > 0 ? stack.pop() : 'code';
      } else if (c === '$' && next === '{') {
        out.push(c, next);
        i += 1;
        stack.push('tpl');
        mode = 'code';
        braceDepth += 1;
      } else out.push(c);
      continue;
    }
    // mode === 'code'
    if (c === '/' && next === '/') {
      out.push('  ');
      i += 1;
      stack.push('code');
      mode = 'line';
      continue;
    }
    if (c === '/' && next === '*') {
      out.push('  ');
      i += 1;
      stack.push('code');
      mode = 'block';
      continue;
    }
    if (c === "'" || c === '"') {
      out.push(c);
      stack.push(mode);
      mode = c === "'" ? 'sq' : 'dq';
      continue;
    }
    if (c === '`') {
      out.push(c);
      stack.push(mode);
      mode = 'tpl';
      continue;
    }
    if (braceDepth > 0 && c === '}') {
      braceDepth -= 1;
      out.push(c);
      mode = stack.length > 0 ? stack.pop() : 'code';
      continue;
    }
    out.push(c);
  }
  return out.join('');
}

/** 括号配平地取出每个 `t(` 调用的实参文本与结束位置。 */
function translateCalls(text) {
  const out = [];
  const re = /(^|[^\w.$])t\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    let inStr = null;
    for (; i < text.length && depth > 0; i += 1) {
      const c = text[i];
      if (inStr) {
        if (c === '\\') i += 1;
        else if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        inStr = c;
        continue;
      }
      if (c === '(' || c === '{' || c === '[') depth += 1;
      else if (c === ')' || c === '}' || c === ']') depth -= 1;
    }
    out.push({
      args: text.slice(start, i - 1),
      endIdx: i,
      line: text.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

/** 按**顶层**逗号切实参（字符串与嵌套括号里的逗号不算）。 */
function splitArgs(args) {
  const parts = [];
  let depth = 0;
  let inStr = null;
  let cur = '';
  for (let i = 0; i < args.length; i += 1) {
    const c = args[i];
    if (inStr) {
      cur += c;
      if (c === '\\') {
        cur += args[i + 1] ?? '';
        i += 1;
      } else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c;
      cur += c;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

const PLACEHOLDER = /\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}/g;

/**
 * 声明"这一处的占位符由下游填"的标记（写在调用点那一行）。
 *
 * 形状是真的：`tasksMarkdownCopy()` 把**整条词条原文**装进 `TasksMarkdownCopy.generatedAt`
 * 交给 `packages/app-host/export-dump.ts:369`，那里才有
 * `copy.generatedAt.replace('{at}', exportedAtIso)`。插值点跨了一个包，
 * 任何"只看本文件调用点之后 240 字符"的探针都不可能认出它 ——
 * 把它判成缺陷就是假缺陷（见 `varsShape` 上面那段）。
 *
 * 🔴 但标记本身会变成谎话：哪天下游那句 `.replace` 被删了，注释还在，
 * 界面就又露出花括号而门禁不响。所以**标记必须有一个活着的下游消费者**：
 * 该调用点缺的每一个占位符，全仓必须真的存在一处 `.replace('{X}'` /
 * `.replaceAll('{X}'`，否则这一条照样判红（自测臂 M 钉的就是这个）。
 */
const FILLED_LATER = 'i18n-vars:filled-later';

/** 全仓扫一遍"谁在手工替换哪个占位符"。 */
function replacedPlaceholders(roots) {
  const set = new Set();
  for (const root of roots) {
    for (const f of walk(join(ROOT, root))) {
      const text = codeOnly(readFileSync(f, 'utf8'));
      for (const m of text.matchAll(/\.(?:replace|replaceAll)\(\s*['"`]\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) set.add(m[1]);
    }
  }
  return set;
}

/**
 * 从一个对象字面量里取出**键名**。
 *
 * 🔴 这一版是被自己的假缺陷逼出来的。前一版用一个正则一把抓：
 * `/([a-zA-Z_]\w*)\s*(?::|[,}])/g` —— 看着像"后面跟冒号或逗号"的**前瞻**，
 * 但 `(?::|[,}])` 实际被解析成 `(?:` + `:` + `|[,}]` + `)` = **非捕获组**，它会**吃掉**那个分隔符。
 * 后果：`{ start, end }` 只读出 `start`（`end` 前面的逗号已经被上一枚匹配消费掉了），
 * 于是 92 个**本来传对了 vars** 的调用点被判成缺陷。
 * 现在按顶层逗号切实参、逐条取键名 —— 分隔符不再是谁的消耗品。
 * 返回 null = 这个字面量读不动（调用方归 unchecked，不判红）。
 */
function objectKeys(lit) {
  const names = new Set();
  for (const raw of splitArgs(lit.slice(1, -1))) {
    const p = raw.trim();
    if (p === '') continue;
    const m = p.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::|$)/);
    if (m) {
      names.add(m[1]);
      continue;
    }
    return null; // 计算键 / 引号键 / 三元之类 —— 静态读不出键名
  }
  return names;
}

/**
 * 第二个实参（vars）静态能推到什么程度，分三档 —— **不许把推不动的算成缺陷**。
 *
 * 🔴 这三种"推不动"的形状全是现量踩出来的，第一版把它们报成了缺参数：
 *  · `t('k', migrationProgress)` —— vars 住在一个变量里（`VaultSettingsSection.tsx:541`、
 *    `VaultSettingsPanel.tsx:443`）。键名要类型信息才知道，静态读不出来。
 *  · `t('k', { ...restorePreviewVars(p) })` —— 展开一个函数返回值（`ExportScreen.tsx:517`）。
 *  · `t('k' as never, { name })` —— key 后面挂了类型断言（`HabitGoalEditor.tsx:125`）。
 *    这一条最阴：它**其实传了 vars**，而断言把逗号挤到了"非紧邻"位置，
 *    于是探针把一句完全正确的文案判成缺陷。
 * 判成红的代价不是多一行输出，是这批"红"里混着真缺陷，人开始整体忽略这条门禁。
 */
function varsShape(secondArg) {
  if (secondArg === undefined) return { kind: 'none' };
  const t = secondArg.trim();
  if (t.startsWith('{') && balancedObjectLiteral(t)) {
    if (t.includes('...')) return { kind: 'unchecked', why: '对象里有展开' };
    const names = objectKeys(t);
    if (names === null) return { kind: 'unchecked', why: '对象里有读不出的键' };
    return { kind: 'literal', names };
  }
  return { kind: 'unchecked', why: 'vars 不是对象字面量' };
}

function balancedObjectLiteral(t) {
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (inStr) {
      if (c === '\\') i += 1;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i === t.length - 1;
    }
  }
  return false;
}

function scan(roots, tab, replaced) {
  const bad = [];
  const dynamic = [];
  const unchecked = [];
  let withVars = 0;
  let plainOk = 0;
  for (const root of roots) {
    for (const f of walk(join(ROOT, root))) {
      const raw = readFileSync(f, 'utf8');
      const rawLines = raw.split('\n');
      const text = codeOnly(raw);
      for (const c of translateCalls(text)) {
        const parts = splitArgs(c.args);
        const key = parts[0]?.match(/^\s*'([a-zA-Z0-9._-]+)'/);
        if (!key) {
          if (/^\s*[A-Za-z_$]/.test(c.args.trim())) dynamic.push(`${f}:${String(c.line)}\t${c.args.trim().slice(0, 40)}`);
          continue;
        }
        const value = tab[key[1]];
        if (typeof value !== 'string') {
          bad.push({ at: `${f}:${String(c.line)}`, key: key[1], missing: ['<KEY 不在词表里>'] });
          continue;
        }
        const need = [...value.matchAll(PLACEHOLDER)].map((x) => x[1]);
        if (need.length === 0) {
          plainOk += 1;
          continue;
        }
        // key 之后只认两种尾巴：空，或 ` as 一个不含逗号的类型`（词条 key 的 TS 断言）。
        // 其它形状一律归 unchecked —— 认不出来不是缺陷，是探针的极限。
        const afterKey = String(parts[0].slice(key[0].length)).trim();
        let second;
        if (afterKey === '' || /^as\s+[\w<>[\]|&. ]+$/.test(afterKey)) second = parts[1];
        else {
          unchecked.push(`${f}:${String(c.line)}\t${key[1]}\tkey 后有认不出的尾巴：${afterKey.slice(0, 24)}`);
          continue;
        }
        const shape = varsShape(second);
        if (shape.kind === 'none') {
          const after = text.slice(c.endIdx, c.endIdx + 240);
          let unhandled = need.filter(
            (v) => !new RegExp(`\\.replace(?:All)?\\(\\s*['\`"]\\{${v}\\}`).test(after),
          );
          if (unhandled.length > 0 && (rawLines[c.line - 1] ?? '').includes(FILLED_LATER)) {
            // 声明了"下游填"—— 但声明要有活着的消费者，否则标记就是第二份谎话。
            unhandled = unhandled.filter((v) => !replaced.has(v));
            if (unhandled.length > 0) {
              bad.push({
                at: `${f}:${String(c.line)}`,
                key: key[1],
                missing: unhandled,
                note: `挂了 ${FILLED_LATER} 但全仓找不到对这些占位符的 .replace`,
              });
              continue;
            }
            withVars += 1;
            continue;
          }
          if (unhandled.length > 0) bad.push({ at: `${f}:${String(c.line)}`, key: key[1], missing: unhandled });
          else withVars += 1;
          continue;
        }
        if (shape.kind === 'unchecked') {
          unchecked.push(`${f}:${String(c.line)}\t${key[1]}\t${shape.why}`);
          continue;
        }
        const still = need.filter((v) => !shape.names.has(v));
        if (still.length > 0) bad.push({ at: `${f}:${String(c.line)}`, key: key[1], missing: still });
        else withVars += 1;
      }
    }
  }
  return { bad, dynamic, unchecked, withVars, plainOk };
}

async function main() {
  const tab = await zhTable();
  const args = process.argv.slice(2);
  const scanIdx = args.indexOf('--scan');
  const roots = scanIdx >= 0 ? [args[scanIdx + 1]] : ['apps', 'packages'];
  const r = scan(roots, tab, replacedPlaceholders(roots));
  const asJson = args.includes('--json');
  if (asJson) {
    process.stdout.write(
      JSON.stringify({
        bad: r.bad,
        dynamic: r.dynamic.length,
        unchecked: r.unchecked.length,
        withVars: r.withVars,
        plainOk: r.plainOk,
      }),
    );
    process.exit(0);
  }
  for (const b of r.bad) {
    console.log(
      `缺参数\t${b.at}\t${b.key}\t{${b.missing.join('}{')}}${'note' in b && b.note !== undefined ? `\t${b.note}` : ''}`,
    );
  }
  console.log(
    `SUMMARY 无占位符调用=${String(r.plainOk)} 有参数(或已手工替换)=${String(r.withVars)} ` +
      `动态key未判=${String(r.dynamic.length)} vars形状推不出=${String(r.unchecked.length)} 缺参数=${String(r.bad.length)}`,
  );
  if (r.unchecked.length > 0) {
    console.log('   ↷ 推不出键名的 vars（vars 是变量 / 有展开 / 计算键）—— 这些**不判红**，只登记数量：');
    for (const u of r.unchecked) console.log(`     ${u}`);
  }
  // 判据 ④：阳性对照。正常调用读到 0 就是探针坏了 —— 那时长得像"全部合规"。
  if (r.plainOk + r.withVars === 0) {
    die('🔴 一条正常调用都没读到 —— 解析器或词表探针坏了，本次"缺参数数"不可信（报探针，不报合规）');
  }
  if (r.bad.length > 0) {
    console.log('🔴 有界面文案调用取了带 {placeholder} 的词条却没填参数 —— 用户会看到字面花括号。');
    return 1;
  }
  console.log('✅ 每个 {placeholder} 都有来源（vars 或显式替换）');
  return 0;
}

if (process.argv.includes('--self-test')) {
  const dir = join(ROOT, 'tmp/i18n-vars-selftest');
  const key = 'web.ai.breakdown.proposalHead'; // 值 = 拆解结果（{count} 项）
  const fixtures = [
    {
      name: '臂 A 少传 vars ⇒ 必须红',
      src: `const t = (k: string, v?: unknown) => String(k) + String(v ?? '');\nexport const A = () => t('${key}');\n`,
      wantRed: true,
    },
    {
      name: '臂 B 正常传 vars ⇒ 必须绿',
      src: `const t = (k: string, v?: unknown) => String(k) + String(v ?? '');\nexport const B = () => t('${key}', { count: 3 });\n`,
      wantRed: false,
    },
    {
      name: '臂 C 手工 .replace 处理 ⇒ 不算红（挡假缺陷）',
      src: `const t = (k: string, v?: unknown) => String(k) + String(v ?? '');\nexport const C = () => t('${key}').replace('{count}', String(3));\n`,
      wantRed: false,
    },
    {
      // 真仓库实测过的假缺陷形状：文件头注释里写着「每个分支都写完整的 `t('key')`」。
      name: '臂 D 注释里的 t() ⇒ 不算红（探针不许把散文当调用点）',
      src: `// 每个分支都写完整的 t('${key}') 形状，门禁才认得出。\nexport const D = 1;\n`,
      wantRed: false,
    },
    {
      name: '臂 E 模板串插值里的 t() ⇒ 必须红（抹注释不许顺手抹掉 ${…}）',
      src: `const t = (k: string, v?: unknown) => String(k) + String(v ?? '');\nexport const E = () => \`\${t('${key}')}。\`;\n`,
      wantRed: true,
    },
    // 🔴 臂 F/G/H 是**真仓库里报成缺陷、其实没缺陷**的三种形状（现量：
    // `VaultSettingsSection.tsx:541`、`HabitGoalEditor.tsx:125`、`ExportScreen.tsx:517`）。
    // 它们不只断言"不红"，还要断言**这一条确实被看见了**（落进推不出档）——
    // 否则"解析器压根不扫这种形状"和"扫了但判它合规"在输出上长得一样，
    // 而那正是把门禁修弱（而不是修准）最容易蒙过去的地方。
    {
      name: '臂 F vars 是一个变量 ⇒ 不红，但必须被看见（推不出键名）',
      src: `const t = (k: string, v?: unknown) => String(k) + String(v ?? '');\nexport const F = (p: { count: number }) => t('${key}', p);\n`,
      wantRed: false,
      wantUnchecked: 1,
    },
    {
      name: '臂 G key 挂了 `as never` 断言 ⇒ 不红，且必须认出后面的 vars',
      src: `const t = (k: string, v?: unknown) => String(k) + String(v ?? '');\nexport const G = (n: string) => t('${key}' as never, { count: n });\n`,
      wantRed: false,
      wantWithVars: true,
    },
    {
      name: '臂 H vars 里展开了函数返回值 ⇒ 不红，但必须被看见',
      src: `const t = (k: string, v?: unknown) => String(k) + String(v ?? '');\nexport const H = (o: object) => t('${key}', { ...o });\n`,
      wantRed: false,
      wantUnchecked: 1,
    },
    {
      name: '臂 I vars 传了但键名对不上 ⇒ 必须红（"有第二个实参"不等于合规）',
      src: `const t = (k: string, v?: unknown) => String(k) + String(v ?? '');\nexport const I = () => t('${key}', { wrongName: 3 });\n`,
      wantRed: true,
    },
    {
      // 🔴 这条钉的是"只读出第一个键"那个正则缺陷（`(?::|[,}])` 其实是消费型非捕获组）。
      // 两个占位符的词条 + 简写多键：前一版把 `{ start, end }` 只读出 `start`，
      // 于是全仓 92 个正确调用点被判成缺陷。臂 A~I 全都只有单键，抓不到它。
      name: '臂 J 两个占位符 + 简写多键 ⇒ 不红（键名提取不许只看第一个）',
      src: `const t = (k: string, v?: unknown) => String(k) + String(v ?? '');\nexport const J = (a: string, b: string) => t('web.growth.week.range' as never, { start: a, end: b });\nexport const J2 = (a: string, b: string) => t('web.growth.week.range', { start: a, end: b });\n`,
      wantRed: false,
      wantWithVars: true,
    },
    {
      name: '臂 K 两个占位符只传了一个 ⇒ 必须红（多键场景真的会漏）',
      src: `const t = (k: string, v?: unknown) => String(k) + String(v ?? '');\nexport const K = (a: string) => t('web.growth.week.range', { start: a });\n`,
      wantRed: true,
    },
    {
      // 🔴 这条钉的是 `apps/*/export-copy.ts` 那个**看起来像缺陷但其实不是**的形状：
      // 整条词条原文交给 app-host，由那里 `.replace('{at}', …)` 填。
      name: '臂 L 声明 filled-later 且全仓真有对应 replace ⇒ 不红',
      src: `const t = (k: string, v?: unknown) => String(k) + String(v ?? '');\nexport const L = () => t('web.export.markdown.generatedAt'); // i18n-vars:filled-later\nexport const fill = (s: string, iso: string) => s.replace('{at}', iso);\n`,
      wantRed: false,
      wantWithVars: true,
    },
    {
      name: '臂 M 声明 filled-later 但全仓没有对应 replace ⇒ 必须红（标记不许变成谎话）',
      src: `const t = (k: string, v?: unknown) => String(k) + String(v ?? '');\nexport const M = () => t('web.export.markdown.generatedAt'); // i18n-vars:filled-later\n`,
      wantRed: true,
      wantNote: '全仓找不到',
    },
  ];
  let fail = 0;
  for (const fx of fixtures) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'fx.tsx'), fx.src);
    const kid = spawnSync(process.execPath, [join(ROOT, 'scripts/check-i18n-vars.mjs'), '--scan', 'tmp/i18n-vars-selftest', '--json'], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    let red = false;
    let parsed;
    try {
      parsed = JSON.parse(String(kid.stdout));
      red = Array.isArray(parsed.bad) && parsed.bad.length > 0;
    } catch {
      console.log(`${fx.name}：FAIL（夹具跑不出 JSON：${String(kid.stdout).slice(0, 80)}）`);
      fail += 1;
      continue;
    }
    let ok = red === fx.wantRed;
    let detail = `red=${String(red)} want=${String(fx.wantRed)}`;
    if (ok && fx.wantUnchecked !== undefined) {
      ok = parsed.unchecked === fx.wantUnchecked;
      detail += ` unchecked=${String(parsed.unchecked)} want=${String(fx.wantUnchecked)}`;
    }
    if (ok && fx.wantWithVars) {
      ok = parsed.withVars >= 1;
      detail += ` withVars=${String(parsed.withVars)} want>=1`;
    }
    if (ok && fx.wantNote !== undefined) {
      ok = parsed.bad.some((b) => String(b.note ?? '').includes(fx.wantNote));
      detail += ' 红项里要带那句理由';
    }
    console.log(`${fx.name}：${ok ? 'OK' : 'FAIL'}（${detail}）`);
    if (!ok) fail += 1;
  }
  rmSync(dir, { recursive: true, force: true });
  const selfArms = fixtures.length;
  console.log(`ARMS=${String(selfArms)} FAIL=${String(fail)}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().then((code) => process.exit(code));
