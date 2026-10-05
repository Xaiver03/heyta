#!/usr/bin/env node
/**
 * 真机验收脚本的 **resource-id 锚点对账**（常驻门禁，不占设备、不占端口，纯读盘）。
 *
 * ## 为什么要有这条
 *
 * `verify-mobile-ai.sh` 第一版整篇按 content-desc 找按钮，其中一枚写的是「保存」——
 * 而 `AiSettingsSection` 里**没有保存那枚按钮**（提交就是「添加自定义端点」那一次点击）。
 * 那一行当时写成「取不到坐标就不点」，于是它既不报错也不前进：端点从未落库，
 * 后面每一步都在对一个没配好的界面打分，而症状长得像"界面变了找不到入口"
 * （§7 第 46 条：没复现 ≠ 路径没执行）。
 *
 * 这类缺陷的特征和 `check:verify-script-copy` 一模一样：**只有真设备那一趟才现形**，
 * 而设备窗口是全仓最稀缺的资源。所以同样挪到不占窗口的地方。
 *
 * ## 为什么不能只做字面 grep
 *
 * RN 侧大量 `testID` 是**算出来的**：`ai-consent-${feature}`、`ai-endpoint-${endpoint.id}`、
 * `${testIdPrefix}send`。字面比对会把这些全判成"源码没有"（假缺陷），
 * 而假缺陷的代价是这条门禁被人整体忽略掉。
 * ⇒ 模板声明转成**模式**（`${…}` ⇒ `.*`），脚本里的具体锚点按模式匹配。
 *
 * ## 判据（`--self-test` 逐臂证明，臂数由它自己打印）
 *  ① 脚本里每一个 rid 锚点都能落到源码的某条 testID 声明上（字面或模式）；
 *  ② **阳性对照**：必须命中若干"源码里确实存在"的锚点，否则 `未匹配=0` 是探针坏了
 *     而不是脚本干净 ⇒ 退 2；
 *  ③ **模板臂**：至少一条锚点是被**模式**（不是字面）匹配的 —— 少这条，
 *     模板解析坏掉会退化成"只比对字面"，而那时 `ai-consent-breakdown` 会假红；
 *  ④ 模式不许**无锚点通配**：以 `.*` 开头的模式（`${x}send` 那种）只能后缀匹配，
 *     而整条 `${x}` 的模式必须仍带字面段 —— 全通配等于放行任何锚点（那是装饰，不是判据）。
 *  ⑤ desc/text 的**字面**锚点也要对得上（判据 ① 只护 rid，这一档以前没人守）：
 *     每一句要么是一条**移动端源码引用过的中文词条**的原文，要么正是某行拼出来的
 *     `「标签, 提示」`；只写了"标签"而那一行其实带 hint ⇒ 红（精确等值恒不命中）。
 *  ⑥ **块内那一指落在哪一层**（rig20 现量）：RN 的 `Pressable` 把 `content-desc` 挂在
 *     `clickable=false` 的层上，点它退出码 0 却什么都不发生。`xy_clickable_in_rid`
 *     取"包含该标签矩形且面积最小的可点祖先"，没有则如实报哨兵。
 *     这几臂把函数体抽出来喂**合成 AX 树**跑（不占设备），期望值是**写死的坐标** ——
 *     在臂里重算一遍选择规则等于造第二把尺，两把尺一起错就永远读成绿。
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
/**
 * 对账对象默认是移动端助手那条验收脚本。
 * 🔴 这个旋钮**是为了让变异能真的喂进来**：self-test 的阴性臂要拿一份"多写了一枚不存在
 * 锚点"的副本跑**整条流水线**，而不是只调用匹配函数 —— 只测匹配器证明不了
 * "有缺失时会退非零"那一半（那条曾经就是只打印不判失败，§7 反复出现的病）。
 */
const DEFAULT_SCRIPT = 'scripts/verify-mobile-ai.sh';
const SRC_ROOT = 'apps/mobile/src';

/** 脚本里被当作 resource-id 用的调用点（新增 helper 要登记到这里，否则它护不住）。 */
const RID_CALLS = [
  'rid_center',
  'rid_attr',
  'tap_rid',
  'has_rid',
  'edit_value_by_rid',
  'tap_in_rid',
  'xy_in_rid',
  'xy_clickable_in_rid',
];

function readScript(file) {
  if (!existsSync(file)) {
    console.error(`🔴 验收脚本不存在：${file} —— 对账没有输入（这不算"锚点都对"）`);
    process.exit(2);
  }
  return readFileSync(file, 'utf8');
}

/** 取出某行里第 k 个 rid 实参（字面量才算；变量拼接的锚点不在本门禁范围内，如实报出）。 */
function anchorsFromScript(text, label) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    // 🔴 **注释行不算调用点**：第一版扫全文，于是本文件里那段"别再写 `xy_desc \"设置\"`"
    //    的说明被当成一枚真锚点 —— 门禁把**讲它的那句话**判成了红（假红方向），
    //    而同一条误读在判据 ① 那一侧会反过来**放行**：注释里写一句 `tap_rid 存在的名字`
    //    就能把缺失的锚点补绿。两种面目同一个成因：探针没有区分代码与关于代码的话。
    if (line.trim().startsWith('#')) return;
    for (const fn of RID_CALLS) {
      const re = new RegExp(`\\b${fn} +(["']?)([a-z][a-z0-9-]{3,})\\1`);
      const m = line.match(re);
      if (m) out.push({ anchor: m[2], at: `${label}:${String(i + 1)}`, fn });
    }
    // `$(rid_center x)` / `$(rid_attr x enabled)` 这种命令替换里的调用点
    for (const fn of RID_CALLS) {
      const re = new RegExp(`\\$\\( *${fn} +["']?([a-z][a-z0-9-]{3,})`, 'g');
      let mm;
      while ((mm = re.exec(line)) !== null) out.push({ anchor: mm[1], at: `${label}:${String(i + 1)}`, fn });
    }
  });
  const seen = new Set();
  return out.filter((a) => (seen.has(a.anchor) ? false : (seen.add(a.anchor), true)));
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(tsx|ts)$/.test(name)) acc.push(p);
  }
  return acc;
}

/**
 * 从验收脚本里抽出某个 bash 函数的完整定义（`name() { … }`）。
 *
 * 为什么要抽而不是"信它在设备上跑过"：`xy_clickable_in_rid` 只在真设备上被调用，
 * 而设备窗口是全仓最稀缺的资源；它的正确性（落到可点的那一层，而不是标签那一层）
 * 完全可以在一份合成 AX 树上判。抽不到定义就**如实返回 null**，让调用它的臂自己红 ——
 * 函数被改名或被删，读数是"臂红"，不是"这几臂不存在"。
 */
function helperBody(file, name) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const start = text.indexOf(`${name}() {`);
  if (start === -1) return null;
  const end = text.indexOf('\n}', start);
  if (end === -1) return null;
  const body = text.slice(start, end + 2);
  return body.includes('\n') ? body : null;
}

/**
 * 源码侧的 testID 声明：字面量 + 模板（模板里的 `${…}` 段变成 `.*`）。
 * 返回 `{ literal:Set<string>, patterns:[{source, regex}] }`。
 */
function declarations(files) {
  const literal = new Set();
  const patterns = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    // 两种写法：testID="x" 与 testID={`a-${b}`} / testID={`${p}send`}
    for (const m of text.matchAll(/testID=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
      if (m[1] !== undefined) {
        literal.add(m[1]);
        continue;
      }
      addPattern(m[2], f);
    }
    // 🔴 **对象字面量那一形也必须收**：入口清单是 `{ testID: 'profile-entry-assistant', label: … }`
    //    （`ProfileScreen` 的条目数组，且那里的注释写明"testID 用词条 key 而不是下标"）。
    //    第一版只扫 JSX 属性形，于是这条**真实存在**的锚点被判成"源码没有"——
    //    假缺陷就出在探针自己的覆盖面漏了一档（§7 第 165/167 条那一族）。
    for (const m of text.matchAll(/testID:\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/g)) {
      const lit2 = m[1] ?? m[2];
      if (lit2 !== undefined) {
        literal.add(lit2);
        continue;
      }
      addPattern(m[3], f);
    }
  }
  return { literal, patterns };

  function addPattern(tpl, file) {
    const parts = tpl.split(/\$\{[^}]*\}/);
    const head = parts[0] ?? '';
    const tail = parts[parts.length - 1] ?? '';
    const middles = parts.slice(1, -1);
    // 全通配（`${x}` 一整条）不收成模式 —— 它会放行任何锚点。
    if (head === '' && tail === '' && middles.every((s) => s === '')) return;
    const body = parts.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    patterns.push({ source: `testID=${tpl} @ ${file}`, regex: new RegExp(`^${body}$`) });
  }
}

function match(anchor, decl) {
  if (decl.literal.has(anchor)) return { via: 'literal' };
  for (const p of decl.patterns) if (p.regex.test(anchor)) return { via: 'pattern', source: p.source };
  return null;
}

/**
 * 判据 ⑤：**desc / text 字面锚点**也对账源码 + 词条表。
 *
 * 为什么单开一判据（2026-10-06 实测，本门禁此前的覆盖面漏了整整一档）：
 *   `verify-mobile-ai.sh` 里那句 `xy_desc "设置"` **精确等值恒取空** ——
 *   那一格实际渲染出的 content-desc 是
 *   `设置, 同步凭据、桌面小组件与语言`（现量：`adb shell uiautomator dump`
 *   里 profile-entry-settings 那枚节点的 content-desc）。RN 没给 accessibilityLabel
 *   时，Android 无障碍把**子节点的文本按顺序用「, 」串起来**当可辨识名。
 *   ⇒ 任何"一行里有两段文字"的控件，用**行标签本身**做精确锚点都是恒不命中。
 *   症状是"设置里没有「AI 设置」区块"，而真正的成因是**根本没进设置页**。
 *
 * 静态侧能拿到什么：行对象写成 `{ label: t('A'), hint: t('B') }`，
 * 而 A/B 的中文都在 `packages/i18n` 的唯一事实源里 ⇒ "哪些标签带 hint"
 * 与"那一格的完整 content-desc 是什么"都能算出来，不需要设备。
 */
const DESC_CALLS = ['xy_desc', 'has_desc', 'xy_text', 'has_text'];
const ZH_LOCALE = 'packages/i18n/src/locales/zh-CN.ts';

function zhValues() {
  const text = readFileSync(join(ROOT, ZH_LOCALE), 'utf8');
  const map = new Map();
  // `'key': 'value'` 与 `"key": "value"` 两形都要；值里允许转义引号。
  for (const m of text.matchAll(/(['"])((?:\\.|(?!\1)[^\\])+)\1\s*:\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g)) {
    if (!map.has(m[2])) map.set(m[2], m[4].replace(/\\(["'])/g, '$1'));
  }
  return map;
}

/** 源码里 `label: t('A') … hint: t('B')` 的行 → 完整 content-desc 与"有 hint 的标签"两张表。 */
function rowPairs(files, zh) {
  const pairs = new Set();
  const labelsWithHint = new Map();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (
      const m of text.matchAll(
        /label:\s*t\(\s*['"]([^'"]+)['"]\s*\)[\s\S]{0,80}?hint:\s*t\(\s*['"]([^'"]+)['"]\s*\)/g,
      )
    ) {
      const a = zh.get(m[1]);
      const b = zh.get(m[2]);
      if (a === undefined || b === undefined) continue;
      const full = `${a}, ${b}`;
      pairs.add(full);
      if (!labelsWithHint.has(a)) labelsWithHint.set(a, full);
    }
  }
  return { pairs, labelsWithHint };
}

/** 移动端源码**引用过**的词条值（键以字面量出现在 apps/mobile/src 里才算 —— 别处的同文案不算）。 */
function mobileValues(files, zh) {
  const blob = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const out = new Set();
  for (const [key, value] of zh) {
    if (blob.includes(`'${key}'`) || blob.includes(`"${key}"`)) out.add(value);
  }
  return out;
}

/** 脚本里 desc/text 调用点的**字面**实参（带 `$` 的变量锚点不在对账面内，如实报数）。 */
function descAnchors(text, label) {
  const out = [];
  const dynamic = [];
  text.split('\n').forEach((line, i) => {
    if (line.trim().startsWith('#')) return; // 与判据 ① 同一条规矩：注释不是调用点
    for (const fn of DESC_CALLS) {
      const exact = new RegExp(`\\b${fn} +(["'])([^"'$]*)\\1`);
      const dyn = new RegExp(`\\b${fn} +["'][^"']*\\$[^"']*["']`);
      const m = line.match(exact);
      if (m && m[2] !== '') out.push({ anchor: m[2], at: `${label}:${String(i + 1)}`, fn });
      else if (dyn.test(line)) dynamic.push(`${label}:${String(i + 1)} [${fn}]`);
    }
  });
  const seen = new Set();
  return {
    anchors: out.filter((a) => (seen.has(a.anchor) ? false : (seen.add(a.anchor), true))),
    dynamic,
  };
}

// 判据 ⑧：双引号**文案**里不许出现反引号。
//   在 bash 里反引号是命令替换，`bash -n` 不报（语法完全合法），症状是"打印判据的那一行
//   自己去执行了一条命令"：实测 `line 1226: target: command not found`，判据行输出成半句话。
//   🔴 这条在本仓库犯了**两次**，第二次就发生在把它写进环境陷阱 #329 之后几分钟的下一次编辑里 ——
//   所以光有一条文档规矩是不够的（文档不会在编辑时说话），这里把它做成会红的门禁。
//   注释行里的反引号不算（那些是给读者看的代码名）。
function quoteBackticks(text) {
  const red = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*#/.test(line)) continue;
    let state = 'code'; // code | single | double
    for (let j = 0; j < line.length; j += 1) {
      const c = line[j];
      if (state === 'code') {
        if (c === "'") state = 'single';
        else if (c === '"') state = 'double';
        else if (c === '#') break; // 行内注释，后面不判
      } else if (state === 'single') {
        if (c === "'") state = 'code';
      } else {
        if (c === '\\') { j += 1; continue; }
        if (c === "'") { state = 'single'; continue; }
        if (c === '"') { state = 'code'; continue; }
        if (c === '`') {
          red.push(
            `${i + 1} 行  双引号串里的反引号 = 命令替换：${line.trim().slice(0, 72)}\n` +
              '        修法：把那段改成「」或直接去掉反引号（`$(…)` 形式的替换不在此列）。',
          );
          break;
        }
      }
    }
  }
  return red;
}


// 判据 ⑨：**模型要求用户声明的字段，界面上必须有处可填**（2026-10-06 实测的这类缺口的形状）。
//   移动壳的端点表单此前压根没有「能力」这一格 ⇒ 手机上建出来的端点永远只拿基线
//   `structured_output`，`tool-calling`（要 `tool_calling`）与 `breakdown`（要 `long_context`）
//   在移动侧**结构上不可用**，而界面只表现为"发送按钮恒灰"。web 有、移动没有，这种不对称
//   typecheck 看不见（字段是可选的）、`check:ai-coverage` 也看不见（它数的是功能接线，不是表单字段）。
//   判据：`packages/ai` 的 CAPABILITY_ORDER 每一枚，都必须①在移动表单里被渲染（走共享那份顺序表，
//   不许自己抄一张），②有对应词条键。顺序表一旦被抄成第二份，下一次加能力就只有半个界面跟上。
const AI_SETTINGS_SRC = 'apps/mobile/src/ai/AiSettingsSection.tsx';
const AI_ROUTING_SRC = 'packages/ai/src/routing.ts';
const CAP_TESTID = 'ai-endpoint-cap-';

function capabilityOrder(routingText) {
  const m = /export const CAPABILITY_ORDER: readonly AiCapability\[\] = \[([^\]]*)\]/.exec(routingText);
  if (m === null) return null;
  return (m[1].match(/'[a-z_]+'/g) ?? []).map((x) => x.replaceAll("'", ''));
}

function capabilityFieldGaps(order, settingsText) {
  const red = [];
  if (!settingsText.includes('CAPABILITY_ORDER')) {
    red.push('移动表单没引用共享的 CAPABILITY_ORDER（自己抄了一张顺序表 ⇒ 下次加能力只有半边跟上）');
  }
  if (!settingsText.includes(CAP_TESTID)) {
    red.push(`移动端点表单没有能力这一格（缺 testID ${CAP_TESTID}<capability>）`);
    return red;
  }
  const keyBlock = /const CAPABILITY_LABEL_KEY[^{]*\{([^}]*)\}/.exec(settingsText);
  for (const cap of order) {
    if (!new RegExp(`(^|[,{\\s])${cap}:`, 'm').test(keyBlock?.[1] ?? '')) {
      red.push(`能力「${cap}」在移动侧没有词条键（CAPABILITY_LABEL_KEY 少这一条 ⇒ 界面渲染的是键名或干脆没有）`);
    }
  }
  return red;
}

// 判据 ⑩：**每个功能要求的能力，必须在界面上有处可声明**。
//   这条与 ⑨ 合起来才是完整的一条：⑨ 说"移动表单渲染了 CAPABILITY_ORDER 的每一枚"，
//   ⑩ 说"顺序表罩得住所有功能的要求"。缺任意一半，症状都一样 —— 某档功能在手机上永远进不了候选，
//   而界面只表现为"发送按钮恒灰"（2026-10-06 实测的那条 `tool-calling` 缺口就是这个形状）。
//   判据写在源码文本上（不是构建产物），因为这里要防的是"有人给功能加了一枚新能力、没同步界面词表"。
function requiredCapsNotDeclarable(routingText) {
  const order = capabilityOrder(routingText);
  if (order === null) return null;
  const block = /DEFAULT_FEATURE_CAPABILITIES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(routingText);
  if (block === null) return null;
  const req = new Set((block[1].match(/'([a-z_]+)'/g) ?? []).map((x) => x.replaceAll("'", '')));
  return [...req].filter((c) => !order.includes(c));
}

function run() {
  const files = walk(join(ROOT, SRC_ROOT));
  if (files.length === 0) {
    console.error(`🔴 ${SRC_ROOT} 里一个 .tsx/.ts 都没读到 —— 探针没有输入，不报"锚点都对"`);
    process.exit(2);
  }
  const decl = declarations(files);
  const scriptRel = process.env.HEYTA_ANCHOR_SCRIPT ?? DEFAULT_SCRIPT;
  const scriptText = readScript(join(ROOT, scriptRel));
  const anchors = anchorsFromScript(scriptText, scriptRel);
  if (anchors.length === 0) {
    console.error('🔴 脚本里一个 rid 锚点都没取到 —— 那是探针坏了，不是脚本干净（报退 2）');
    process.exit(2);
  }

  const missing = [];
  let byLiteral = 0;
  let byPattern = 0;
  for (const a of anchors) {
    const hit = match(a.anchor, decl);
    if (hit === null) missing.push(a);
    else if (hit.via === 'literal') byLiteral += 1;
    else byPattern += 1;
  }

  // 判据 ②：阳性对照
  if (byLiteral + byPattern === 0) {
    console.error('🔴 阳性对照为 0：没有任何锚点匹配上源码声明 —— 本次"未匹配数"不可信');
    process.exit(2);
  }
  // 判据 ③：模板臂必须真的在工作
  if (byPattern === 0) {
    console.error(
      '🔴 没有一条锚点是被**模式**匹配的 —— 要么模板解析坏了，要么源码里的 testID 全是字面量。\n' +
        '   本门禁的意义一半在模板那一臂上（`ai-consent-${feature}` 那种），它静默失效就等于退化成字面 grep。',
    );
    process.exit(2);
  }

  for (const a of missing) console.log(`未匹配\t${a.at}\t[${a.fn}]\t"${a.anchor}"`);

  // ── 判据 ⑤：desc / text 字面锚点（以前整档没人守，见上面注释里那枚「设置」）──
  const zh = zhValues();
  if (zh.size === 0) {
    console.error(`🔴 ${ZH_LOCALE} 解析出 0 条词条 —— 探针没有输入，不报"锚点都对"`);
    process.exit(2);
  }
  const { pairs, labelsWithHint } = rowPairs(files, zh);
  if (labelsWithHint.size === 0) {
    console.error(
      '🔴 源码里"带 hint 的行"解析出 0 条 —— 是判据 ⑤ 的探针坏了，不是界面没有这种行。\n' +
        '   没有这张表，"锚点只写了标签"那一类恒不命中根本不会被发现（今天这条红就是这么漏的）。',
    );
    process.exit(2);
  }
  const allowed = mobileValues(files, zh);
  const { anchors: dAnchors, dynamic: dDyn } = descAnchors(scriptText, scriptRel);
  if (dAnchors.length === 0) {
    console.error('🔴 脚本里一条 desc/text 字面锚点都没取到 —— 探针坏了，不报"都对"');
    process.exit(2);
  }
  const descRed = [];
  let byValue = 0;
  let byPair = 0;
  for (const a of dAnchors) {
    if (pairs.has(a.anchor)) {
      byPair += 1;
      continue;
    }
    if (labelsWithHint.has(a.anchor)) {
      descRed.push(
        `${a.at}  [${a.fn}] "${a.anchor}" —— 这一格里还有第二段文字，渲染出的 content-desc 是` +
          `"${labelsWithHint.get(a.anchor)}"；xy_desc / has_desc 是**精确等值**，所以这一句恒取空。` +
          `要么写全那一句，要么改用 testID（rid 锚点走判据 ①）。`,
      );
      continue;
    }
    if (allowed.has(a.anchor)) {
      byValue += 1;
      continue;
    }
    descRed.push(
      `${a.at}  [${a.fn}] "${a.anchor}" —— 不是移动端源码引用过的任何一条中文词条的原文，` +
        `也不是任何"标签, 提示"拼出来的行名（界面换了文案而锚点没跟着改，或本来写的就是别处的词）。`,
    );
  }
  if (byValue + byPair === 0) {
    console.error(
      `🔴 判据 ⑤ 阳性对照为 0：${String(dAnchors.length)} 条字面锚点没有一条落进词条表 —— ` +
        '本次"desc 锚点全对"不可信（要么表读错了要么锚点全写歪了）',
    );
    process.exit(2);
  }
  for (const line of descRed) console.log(`DESC未命中\t${line}`);
  console.log(
    `DESC_SUMMARY 字面锚点=${String(dAnchors.length)} 按词条原文命中=${String(byValue)} ` +
      `按"标签, 提示"命中=${String(byPair)} 红=${String(descRed.length)} ` +
      `变量锚点(不在面内)=${String(dDyn.length)} 带hint的行=${String(labelsWithHint.size)}`,
  );
  if (dDyn.length > 0) {
    console.log(`  ⓘ 这些锚点是变量拼的，本门禁不判（要判得先给出取值来源）：\n${dDyn.map((x) => `    ${x}`).join('\n')}`);
  }
  console.log(
    `SUMMARY 源码文件=${String(files.length)} 字面testID=${String(decl.literal.size)} ` +
      `模式=${String(decl.patterns.length)} 脚本锚点=${String(anchors.length)} ` +
      `按字面命中=${String(byLiteral)} 按模式命中=${String(byPattern)} 未匹配=${String(missing.length)}`,
  );
  console.log(`模式清单：\n${decl.patterns.map((p) => `  ${p.regex.source}  ← ${p.source}`).join('\n')}`);

  // 判据 ⑨（表单字段覆盖面）：两处源码都能被 env 换掉，变异才敢打在副本上、不动真树。
  const routingRel = process.env.HEYTA_AI_ROUTING ?? AI_ROUTING_SRC;
  const settingsRel = process.env.HEYTA_MOBILE_AI_SETTINGS ?? AI_SETTINGS_SRC;
  const order = capabilityOrder(readScript(join(ROOT, routingRel)));
  const capRed = order === null
    ? [`在 ${routingRel} 里解析不出 CAPABILITY_ORDER —— 是探针读不到，不是没缺口（报退 2）`]
    : capabilityFieldGaps(order, readScript(join(ROOT, settingsRel)));
  if (order === null) {
    console.error(`🔴 ${capRed[0]}`);
    process.exit(2);
  }
  for (const line of capRed) console.log(`能力字段缺口\t${line}`);

  const notDeclarable = requiredCapsNotDeclarable(readScript(join(ROOT, routingRel)));
  if (notDeclarable === null) {
    console.error(`🔴 在 ${routingRel} 里解析不出 DEFAULT_FEATURE_CAPABILITIES 的形状 —— 探针没输入，不报"都能声明"`);
    process.exit(2);
  }
  const capOrderRed = notDeclarable.map(
    (c) => `功能要求里的能力「${c}」不在 CAPABILITY_ORDER 里 ⇒ 任何界面都渲染不出它、用户无从声明（加能力要同时加那张表）`,
  );
  for (const line of capOrderRed) console.log(`能力不可声明\t${line}`);

  const backtickRed = quoteBackticks(scriptText);
  for (const line of backtickRed) console.log(`文案反引号\t${line}`);
  if (missing.length > 0 || descRed.length > 0 || backtickRed.length > 0 || capRed.length > 0 || capOrderRed.length > 0) {
    console.log('🔴 有锚点落不到源码上：rid 未匹配=' + String(missing.length) +
      '，desc/text 未命中=' + String(descRed.length) +
      '，双引号文案里的反引号=' + String(backtickRed.length) +
      '，移动侧能力字段缺口=' + String(capRed.length) + '。' +
      '要么脚本写错（如那枚不存在的「保存」、那枚只写了「设置」的行），' +
      '要么界面换了锚点而验收没跟着改，要么判据文案里混进了会被 bash 当成命令替换的反引号。都是红。');
    return 1;
  }
  console.log('✅ 每条 rid 锚点都对得上源码里的 testID 声明；每条 desc/text 字面锚点都对得上词条');
  return 0;
}

if (process.argv.includes('--self-test')) {
  // 逐臂：证明这条门禁**会**红，而不是证明它今天绿。
  //   ⚠️ 臂数**只由下面的 ARMS= 自己打印**，注释与任何文档里都不许抄（抄一次就开始漂）。
  // 臂 0/3 走**整条流水线**（子进程 + 变异副本），只调用匹配函数证明不了
  // "有缺失时退非零"那一半 —— 那条病在仓里出现过不止一次（§7）。
  const lit = declarations(walk(join(ROOT, SRC_ROOT)));
  const arms = [];

  // 臂 0（阳性对照）：真脚本现在必须整体过 —— 它不过就不是"能失败"，是"已经在红"。
  const base = spawnSync(process.execPath, [join(ROOT, 'scripts/check-mobile-ai-anchors.mjs')], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  arms.push(['臂 0 真脚本整链退出码 0', base.status === 0]);

  // 臂 1：源码里确实存在的字面 testID 必须命中。
  arms.push(['臂 1 assistant-screen 按字面命中', match('assistant-screen', lit)?.via === 'literal']);

  // 臂 2：算出来的 testID 必须靠**模式**命中 —— 模板那一臂静默失效，
  // 整条门禁就退化成字面 grep，而 ai-consent-breakdown 会假红。
  arms.push(['臂 2 ai-consent-breakdown 按模式命中', match('ai-consent-breakdown', lit)?.via === 'pattern']);

  // 臂 3（阴性对照 / 真变异）：往副本里加一枚源码里不存在的锚点，整条流水线必须
  // **非零退出并点名它**。
  // 🔴 变异名要**先证明它不被任何模式罩住**：第一版随手写的是 `ai-endpoint-save`，
  //    结果它被 `ai-endpoint-${endpoint.id}` 那条通配吃掉 —— 变异"没红"不是因为门禁坏了，
  //    是因为挑了个本来就该放行的名字（臂自己失效而读数看着像门禁失效）。
  //    名字与模式先对账一次，这条臂才有意义。
  const BOGUS = 'zz-bogus-anchor';
  if (match(BOGUS, lit) !== null) {
    console.log(`SELFTEST 臂 3 的变异名 ${BOGUS} 被某条模式命中 —— 换名字，这条臂现在等于没有`);
    process.exit(1);
  }
  const mutantDir = join(ROOT, 'tmp');
  mkdirSync(mutantDir, { recursive: true });
  const mutant = join(mutantDir, '.anchor-mutant.sh');
  writeFileSync(mutant, `${readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8')}\ntap_rid ${BOGUS}\n`);
  let code = -1;
  let out = '';
  try {
    const kid = spawnSync(process.execPath, [join(ROOT, 'scripts/check-mobile-ai-anchors.mjs')], {
      encoding: 'utf8',
      cwd: ROOT,
      env: { ...process.env, HEYTA_ANCHOR_SCRIPT: 'tmp/.anchor-mutant.sh' },
    });
    code = kid.status ?? -1;
    out = `${kid.stdout ?? ''}${kid.stderr ?? ''}`;
  } finally {
    rmSync(mutant, { force: true });
  }
  arms.push(['臂 3 变异副本非零退出', code !== 0]);
  arms.push([`臂 3 变异副本被点名（不是只退码）`, new RegExp(BOGUS).test(out)]);

  // ── 判据 ⑤ 的三臂 ──
  // 臂 4 是**探针自己的阳性对照**：今天真漏掉的那一行必须被静态侧读出来，
  // 期望值从词条表现取（不写死中文），否则这条臂会跟着文案一起漂。
  const zh = zhValues();
  const SETTINGS_KEY = 'mobile.profile.entry.settings';
  const HINT_KEY = `${SETTINGS_KEY}.hint`;
  const labelValue = zh.get(SETTINGS_KEY);
  const hintValue = zh.get(HINT_KEY);
  const { labelsWithHint, pairs } = rowPairs(walk(join(ROOT, SRC_ROOT)), zh);
  arms.push([
    `臂 4 「${labelValue}」那一行被读成「${labelValue}, ${hintValue}」（判据 ⑤ 自己没坏）`,
    labelValue !== undefined &&
      hintValue !== undefined &&
      labelsWithHint.get(labelValue) === `${labelValue}, ${hintValue}` &&
      pairs.has(`${labelValue}, ${hintValue}`),
  ]);

  // 变异跑整条流水线的小工具（判据 ①②③④ 的臂也是"追加一行再跑一遍"，
  // 失败判据只有一份 —— 同一个判断抄三遍就是漂移的起点）。
  const runMutant = (suffix, tag) => {
    const mutantDir = join(ROOT, 'tmp');
    mkdirSync(mutantDir, { recursive: true });
    const file = join(mutantDir, `.anchor-mutant-${tag}.sh`);
    writeFileSync(file, `${readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8')}\n${suffix}\n`);
    try {
      const kid = spawnSync(process.execPath, [join(ROOT, 'scripts/check-mobile-ai-anchors.mjs')], {
        encoding: 'utf8',
        cwd: ROOT,
        env: { ...process.env, HEYTA_ANCHOR_SCRIPT: `tmp/.anchor-mutant-${tag}.sh` },
      });
      return { code: kid.status ?? -1, out: `${kid.stdout ?? ''}${kid.stderr ?? ''}` };
    } finally {
      rmSync(file, { force: true });
    }
  };

  // 臂 5：把**今天真的那枚坏锚点**塞回去（只写标签、不写拼完的那一句）⇒ 必须红且点名。
  const m5 = runMutant(`xy_desc "${labelValue}"`, 'desc-pair');
  arms.push(['臂 5 只写「标签」的精确锚点 ⇒ 整条流水线非零退出', m5.code !== 0]);
  arms.push(['臂 5 红字里带着那一格的完整 content-desc（不是只退码）', m5.out.includes(`${labelValue}, ${hintValue}`)]);

  // 臂 6：一句谁的词条里都没有的锚点 ⇒ 同样必须红且点名。
  const BOGUS_ZH = '压根不存在的一句中文锚点';
  const m6 = runMutant(`has_desc "${BOGUS_ZH}"`, 'desc-bogus');
  arms.push(['臂 6 不存在的文案锚点 ⇒ 非零退出', m6.code !== 0]);
  arms.push(['臂 6 点名了那枚锚点', m6.out.includes(BOGUS_ZH)]);

  // 臂 7：给"注释行不算调用点"这条本身装上牙齿 —— 同一句只在**注释里**出现时必须放行。
  //   没有这条，"跳过注释"就是一条没人验过的豁免（它可以悄悄把真锚点也跳掉而全绿）。
  const m7 = runMutant(`# 别再写 has_desc "${BOGUS_ZH}" 这种锚点`, 'desc-comment');
  arms.push(['臂 7 同一句只写在注释里 ⇒ 整条流水线仍为 0（注释不是调用点）', m7.code === 0]);

  // 臂 15/16（判据 ⑧）：双引号文案里的反引号 = bash 命令替换。
  //   🔴 这两臂是**我自己踩了两次之后**才加的，第二次就在写下文档规矩之后的下一次编辑里 ——
  //   文档拦不住编辑动作，能拦的只有会红的门禁。臂 15 证明它会红，臂 16 证明注释里的不算（否则
  //   这条判据会把所有写给读者看的代码名全判红，一条乱红的检查比没有检查更危险）。
  const m8 = runMutant('bad "把「x」写成 `stub-model` 这种反引号"', 'backtick-prose');
  arms.push(['臂 15 双引号文案里的反引号 ⇒ 整条流水线非零退出', m8.code !== 0]);
  arms.push(['臂 15 红字点名了那一行（不是只退码）', m8.out.includes('文案反引号')]);
  const m9 = runMutant('# 别在文案里写 `反引号`，那是命令替换', 'backtick-comment');
  arms.push(['臂 16 同一个反引号只写在注释里 ⇒ 整条流水线仍为 0', m9.code === 0]);

  // ── 判据 ⑨ 的三臂：证明"必须有处可填"这条会红 ──
  //   变异打在 tmp 里的副本上（真树不动 —— 动 apps/*/src 会把 mtime 抬起来，
  //   下一趟设备验收会被新鲜度门顶成 rc=3；那是探针自己把路堵死）。
  const capMutant = (tag, text) => {
    const dir = join(ROOT, 'tmp');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `.cap-mutant-${tag}.tsx`);
    writeFileSync(file, text);
    try {
      const kid = spawnSync(process.execPath, [join(ROOT, 'scripts/check-mobile-ai-anchors.mjs')], {
        encoding: 'utf8',
        cwd: ROOT,
        env: { ...process.env, HEYTA_MOBILE_AI_SETTINGS: `tmp/.cap-mutant-${tag}.tsx` },
      });
      return { code: kid.status ?? -1, out: `${kid.stdout ?? ''}${kid.stderr ?? ''}` };
    } finally {
      rmSync(file, { force: true });
    }
  };
  const aiSettingsText = readFileSync(join(ROOT, AI_SETTINGS_SRC), 'utf8');
  const m17 = capMutant('no-testid', aiSettingsText.replaceAll(CAP_TESTID, 'zz-no-cap-field'));
  arms.push(['臂 17 表单里没有能力这一格 ⇒ 整条流水线非零退出', m17.code !== 0]);
  arms.push(['臂 17 红字点名"能力字段缺口"（不是只退码）', m17.out.includes('能力字段缺口')]);
  const m18 = capMutant('copied-order', aiSettingsText.replaceAll('CAPABILITY_ORDER', 'LOCAL_CAP_ORDER'));
  arms.push(['臂 18 顺序表被抄成第二份 ⇒ 非零退出并点名它', m18.code !== 0 && m18.out.includes('共享的 CAPABILITY_ORDER')]);
  const m19 = capMutant('missing-label', aiSettingsText.replace(/\n *tool_calling: 'web\.ai\.capability\.toolCalling',/, ''));
  arms.push(['臂 19 少一枚词条键 ⇒ 非零退出且点名那枚能力', m19.code !== 0 && m19.out.includes('tool_calling')]);

  // ── 判据 ⑩ 的两臂 ──
  const routingText = readFileSync(join(ROOT, AI_ROUTING_SRC), 'utf8');
  const runRoutingMutant = (tag, text) => {
    const dir = join(ROOT, 'tmp');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `.routing-mutant-${tag}.ts`);
    writeFileSync(file, text);
    try {
      const kid = spawnSync(process.execPath, [join(ROOT, 'scripts/check-mobile-ai-anchors.mjs')], {
        encoding: 'utf8',
        cwd: ROOT,
        env: { ...process.env, HEYTA_AI_ROUTING: `tmp/.routing-mutant-${tag}.ts` },
      });
      return { code: kid.status ?? -1, out: `${kid.stdout ?? ''}${kid.stderr ?? ''}` };
    } finally {
      rmSync(file, { force: true });
    }
  };
  // 臂 20（阳性对照）：今天两处都能解析、且每一条要求能力都在表里 ⇒ 整条流水线仍为 0。
  const m20 = runRoutingMutant('asis', routingText);
  arms.push(['臂 20 原样副本 ⇒ 判据 ⑩ 不产生误红（探针确有输入）', m20.code === 0]);
  // 臂 21（变异）：给某个功能加一枚不在顺序表里的能力 ⇒ 必须红且点名它。
  //   这正是本批那条缺口的下一步形态（有人加 `audio` 而没人改界面词表），所以这条臂不是装饰。
  const m21 = runRoutingMutant(
    'undeclarable',
    routingText.replace("  'tool-calling': ['tool_calling'],", "  'tool-calling': ['tool_calling', 'audio'],")
  );
  arms.push(['臂 21 功能要求一枚表外能力 ⇒ 非零退出且点名它', m21.code !== 0 && m21.out.includes('audio')]);

  // ── 判据 ⑥：块内那一指落在**哪一层**（rig20 现量的第三种面目）──
  //   RN 的 `Pressable(accessibilityRole=button, accessibilityLabel=label)` 会把
  //   `content-desc` 挂在 **clickable=false** 的那一层上：手指落下去退出码 0、什么都不发生。
  //   这几臂**不占设备** —— 把函数体抽出来喂合成 AX 树。
  //   🔴 期望值是**写死的坐标**，不是在臂里重算一遍"包含标签且面积最小"：
  //   重算等于造出第二把尺，两把尺一起错就永远读成绿（§7 元规则二）。
  const helper = helperBody(DEFAULT_SCRIPT, 'xy_clickable_in_rid');
  arms.push(['臂 8 从验收脚本里抽到了 xy_clickable_in_rid 的定义（这几臂有输入）', helper !== null]);

  const runHelper = (body, xml, fn = 'xy_clickable_in_rid', args = 'blk chip') => {
    const dir = join(ROOT, 'tmp');
    mkdirSync(dir, { recursive: true });
    const fnPath = join(dir, '.anchor-helper.sh');
    const fx = join(dir, '.anchor-helper.xml');
    writeFileSync(fnPath, `${body}\n`);
    writeFileSync(fx, xml);
    try {
      const kid = spawnSync(
        'bash',
        ['-c', `source '${fnPath}'; UI_XML='${fx}' ${fn} ${args}`],
        { encoding: 'utf8', cwd: ROOT },
      );
      return `${kid.stdout ?? ''}`.trim();
    } finally {
      rmSync(fnPath, { force: true });
      rmSync(fx, { force: true });
    }
  };
  // 一块容器 + 一枚标签 + 两枚**套叠**的可点祖先（小那枚中心 150,175；大那枚 150,180）
  const NESTED =
    '<hierarchy>' +
    '<node resource-id="blk" clickable="false" bounds="[0,100][540,400]">' +
    '<node content-desc="chip" clickable="false" bounds="[100,150][200,200]" />' +
    '<node clickable="true" bounds="[90,140][210,210]" />' +
    '<node clickable="true" bounds="[50,120][250,240]" />' +
    '</node></hierarchy>';
  // 同一枚标签，但**没有**任何可点祖先 ⇒ 必须如实报哨兵，不许假装点到了
  const FLAT =
    '<hierarchy>' +
    '<node resource-id="blk" clickable="false" bounds="[0,100][540,400]">' +
    '<node content-desc="chip" clickable="false" bounds="[100,150][200,200]" />' +
    '</node></hierarchy>';
  arms.push([
    `臂 9 套叠的可点祖先必须取**最小**那层（期望逐字 "150 175 clickable-ancestor"）`,
    helper !== null && runHelper(helper, NESTED) === '150 175 clickable-ancestor',
  ]);
  arms.push([
    `臂 10 没有可点祖先时如实报哨兵（期望逐字 "150 175 label-self-no-clickable-ancestor"）`,
    helper !== null &&
      runHelper(helper, FLAT) === '150 175 label-self-no-clickable-ancestor',
  ]);

  // 臂 11（变异）：把"取最小"换成"取最大" ⇒ 臂 9 那一格必须变红。
  //   没有这条，臂 9 的坐标可能只是恰好与"任何一种选择"都相容（= 装饰）。
  const mutated = helper === null ? '' : helper.replace('min(anc,', 'max(anc,');
  arms.push([
    '臂 11 变异 min→max 后臂 9 的读数不再等于期望（证明期望坐标锁住了"取哪一层"）',
    helper !== null &&
      mutated !== helper &&
      runHelper(mutated, NESTED) !== '150 175 clickable-ancestor',
  ]);

  // 臂 12：读侧改了、比较它的 `tap_in_rid` 没跟上 ⇒ 拒绝分支会变成死码。
  //   🔴 判的是**两处各自的形状**（打印处在那段 python 里、比较处是一条 `[ … = "…" ]`），
  //   不是"全文数这个词几次" —— 注释里多写一句就能把计数凑够，那是会假绿的数法。
  const SENTINEL = 'label-self-no-clickable-ancestor';
  const scriptText = readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8');
  const tapGuard = new RegExp(`\\[\\s*"\\$src"\\s*=\\s*"${SENTINEL}"\\s*\\]`).test(scriptText);
  arms.push([
    `臂 12 哨兵两处都在：helper 打印它 + tap_in_rid 用 [ "$src" = … ] 比较它`,
    helper !== null && helper.includes(SENTINEL) && tapGuard,
  ]);

  // ── 判据 ⑦：滚动参照锚必须是**会动的**那一枚 ──
  //   rig23 现量：第一版"取树里第一枚有 resource-id 的节点"挑中的是 `android:id/content`
  //   （整棵树的根，[0,0][1080,2400] 永远不动），于是每一发 swipe 都读成"画面没动"，
  //   把四格本来能成的绑定拦死 —— **一条自己坏掉的新判据，比它要护的那条旧判据更危险**。
  const picker = helperBody(DEFAULT_SCRIPT, 'scroll_anchor_bounds');
  const PICK_XML =
    '<hierarchy>' +
    '<node resource-id="android:id/content" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]">' +
    '<node resource-id="ai-settings-title" class="android.widget.TextView" text="AI 设置" bounds="[42,300][600,360]" />' +
    '</node></hierarchy>';
  arms.push(['判据 ⑦ 抽到了 scroll_anchor_bounds 的定义', picker !== null]);
  arms.push([
    '臂 13 参照锚必须挑**会随列表位移的内容节点**（期望逐字 "ai-settings-title 42 300 600 360"，不是那枚根）',
    picker !== null &&
      runHelper(picker, PICK_XML, 'scroll_anchor_bounds') === 'ai-settings-title 42 300 600 360',
  ]);
  // 臂 14（变异）：摘掉"跳过 android: 系统 id"那道过滤 ⇒ 臂 13 的期望必须不成立。
  //   🔴 匹配串要**逐字抄被测那一行**：第一版写了 `if (rid.startswith…`（多一层括号），
  //   `replace` 没命中 ⇒ 变异原样返回 ⇒ 这条臂报 FAIL，响的是臂自己坏了，不是判据没牙。
  const pickerLoose =
    picker === null
      ? ''
      : picker.replace(
          "if rid.startswith('android:') or not (d.get('text') or d.get('content-desc')):",
          'if not rid:',
        );
  arms.push([
    '臂 14 摘掉 android:/无文本那两道过滤后，臂 13 的读数不再等于期望（证明挑的不是根）',
    picker !== null &&
      pickerLoose !== picker &&
      runHelper(pickerLoose, PICK_XML, 'scroll_anchor_bounds') !== 'ai-settings-title 42 300 600 360',
  ]);

  let fail = 0;
  arms.forEach(([name, ok]) => {
    console.log(`SELFTEST ${name}：${ok ? 'OK' : 'FAIL'}`);
    if (!ok) fail += 1;
  });
  console.log(`ARMS=${String(arms.length)} FAIL=${String(fail)}`);
  process.exit(fail === 0 ? 0 : 1);
}

process.exit(run());
