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
 * 只留**可执行的那些行**（丢掉 `#` 开头的整行注释）。
 *
 * 🔴 判"形状"若拿"字符串在不在"去比，注释会把每一条变异都洗成绿 ——
 *    本文件 臂 36/38/39 第一次就是这么空的（`127.`、`SCAN-CAP`、`blur_focus`
 *    三串都躺在注释里，摘掉真代码那一行照样报绿）。写在这里而不是各判据里再抄一遍：
 *    同一个判断抄两遍就是下一次漂移的起点（AGENTS §3.5 那条教训的门禁版）。
 */
function codeOf(text) {
  return text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
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

/**
 * 判据 ⑪：**装包那一步必须自带原因**，而"换了打包机"那一档失败要有出口。
 *
 * 起因（2026-10-06 05:50 实测，rig30）：第 0 步写着
 *   `$ADB install -r -g "$APK" >/dev/null 2>&1 || echo "❌ 装不上 $APK"`
 * 然后 abort。屏幕上只有「装不上」三个字，adb 的原因被丢进 /dev/null。手动复现才拿到：
 *   `INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.heyta signatures do not
 *   match newer version; ignoring!`
 * 机制不是设备坏了：**release 变体在没有发布键时挂的是打包机自己的 debug keystore**
 * （`build.gradle` 那条回退，AGENTS §6.1 那格写明"那趟的证书 CN=Android Debug"）。
 * 所以「远程打 → 本机打」（或反过来）= 换签名键，而同包名跨键**不能 `-r` 覆盖安装**。
 * 这条失败在换机后的**第一次**验收必然出现，而载体当时只会说「装不上」。
 *
 * 于是钉两件事：① 装包命令不许把输出丢掉（判据坏掉的那一步要能自证原因）；
 * ② 这一种失败在脚本里必须有一档出口（卸载重装），否则换机这件事永远靠人现场猜。
 *
 * ⚠️ 只看非注释行 —— 判据自己的说明注释里必然提到那枚错误码和那行旧代码，
 *    把它们当调用点会让这条检查永远红（一条乱红的检查比没有检查更危险，臂 22 之外还有臂 25 守着）。
 */
const INSTALL_CALL = /\$ADB\b.*\binstall\b/;
function installChannel(text) {
  const calls = [];
  text.split('\n').forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    if (INSTALL_CALL.test(line)) calls.push([i + 1, line]);
  });
  if (calls.length === 0) return null; // 探针没有输入 ⇒ 由调用方退 2，不报"装包通道没问题"
  const red = [];
  for (const [n, line] of calls) {
    if (line.includes('/dev/null')) {
      red.push(
        `第 ${String(n)} 行的装包命令把输出丢进 /dev/null ⇒ 装不上时判据只剩「装不上」三个字，` +
          `真原因（签名键不同 / 磁盘满 / 设备只读）要人重新手动复现才知道。载体坏掉的那一步必须自带原因：${line.trim()}`,
      );
    }
  }
  if (!/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(text)) {
    red.push(
      '整个脚本没有一处认得 INSTALL_FAILED_UPDATE_INCOMPATIBLE —— release 变体在没有发布键时挂的是' +
        '**打包机自己的 debug keystore**，换打包机 = 换签名键，同包名不能 -r 覆盖安装。' +
        '这一档失败没有出口，验收会在换机后第一次红得没有原因。',
    );
  }
  return red;
}

/**
 * 判据 ⑫：**reveal 类 helper 的失败出口必须先排除"只会往一个方向滚"**。
 *
 * 起因（2026-10-06 06:03 实测，rig31）：端点表单里加了能力 chip 那一行之后，表单整体变高，
 * 滚动停靠点落到 chip 以下，而「名称」那一格（`ai-endpoint-label`）在**上面**。
 * `reveal_rid` 的手势只有一种方向（1900→900 = 往下滚），于是它滚满 5 发之后打印
 *   `❌ testID=ai-endpoint-label 滚了 5 次仍没有一枚落在安全带里的可点节点 —— 界面形状或 testID 变了`
 * 那句话是**错的**：界面形状没变，testID 也没变，变的是载体够不到的那一侧。
 * 同一趟里第 5 步第二发的 `tool-input` 也是这样红的（结果卡在下面，输入框在上面）。
 *
 * 这条不变量的形状：`reveal_rid` 的两个失败出口都得走"摘焦点 + 回到顶部再找一次"那一档，
 * 而那档必须真的调用反向手势（`scroll_to_top`），不是只换一句更温和的红字。
 */
function revealDirection(scriptRel) {
  const reveal = helperBody(scriptRel, 'reveal_rid');
  const fallback = helperBody(scriptRel, 'reveal_rid_top_fallback');
  if (reveal === null || fallback === null) return null;
  const red = [];
  if (!/reveal_rid_top_fallback/.test(reveal)) {
    red.push(
      'reveal_rid 的失败出口里没有"回到顶部再找一次"那一档 ⇒ 只会往下滚的 helper 会把' +
        '"控件在视口上方"读成"界面形状或 testID 变了"（rig31 的 ai-endpoint-label 与 tool-input 都是这一句冒充的）。',
    );
  }
  if (!/scroll_to_top/.test(fallback)) {
    red.push(
      'reveal_rid_top_fallback 没有调用 scroll_to_top ⇒ 那一档只是换一句更温和的红字，方向局限一点没排除。',
    );
  }

  // tap_rid 是**点击路径**上的同一把尺（rig32 现量：`tool-input` 那句
  //   「滚了 5 次仍没有落在安全带里的可点节点 —— 界面形状或 testID 变了」就是它打印的，
  //   而 reveal_rid 已经修好 —— 同一个缺陷在两枚 helper 上，只修一枚等于没修）。
  //   它比 reveal_rid 多一个条件：它**知道** y 在安全带的哪一侧，所以方向必须由读数选。
  const tap = helperBody(scriptRel, 'tap_rid');
  if (tap === null) return null;
  if (!/540 900 540 1900/.test(tap)) {
    red.push(
      'tap_rid 里只有往下滚那一种手势（1900→900）⇒ 可点节点在安全带**上方**时它越滚越远，' +
        '五发滚满后把"还没滚到位"打印成"界面形状或 testID 变了"。方向要由 y 与带子的符号选。',
    );
  }
  if (!/for pass in 1 2/.test(tap)) {
    red.push(
      'tap_rid 没有第二趟（摘焦点回到顶部再走一遍）⇒ "控件在视口上方"这一档永远没有机会。',
    );
  }
  // 顺序判据（这条最容易写错的地方）：「没找到」那一格必须在**两趟都走完**之后。
  //   写在 pass 循环里面时，第 1 趟没找到就 return 1 退出函数，换方向那一趟永远不会执行，
  //   而读数看着像"两种方向都试过"（本轮第一次改完就是这个形状，靠 shellcheck 之外的
  //   人读循环层次才发现 —— 所以把它写成会红的顺序断言，不靠下一次有人认真读）。
  const lastDone = tap.lastIndexOf('done');
  const notFound = tap.indexOf('if [ -z "$ctrl" ]');
  if (notFound !== -1 && lastDone !== -1 && notFound < lastDone) {
    red.push(
      'tap_rid 里「没拿到可点节点」那一格排在最后一层 done **之前** ⇒ 它在 pass 循环内部，' +
        '第 1 趟就 return 了，第二趟（换方向）永远不会跑。',
    );
  }
  return red;
}

/**
 * 判据 ⑬：**"本机规则命中"这句判据只能压在真的被规则表命中的句子上**，
 * 否则这一趟必须把它登记成"设备侧未覆盖"。
 *
 * 起因（2026-10-06 06:44 实测，rig33 现场树）：第 5 步的 RULE_PROMPT 写的是
 * `list all tasks`，而规则表 12 条的**谓词头全是中文**（列出/看看/查看/有哪些…），
 * 于是那句 ASCII 从来就不命中任何规则 —— 载体的"规则命中"判据一直在断言一件
 * 从没发生的事。设备上实际看到的是失败面：
 *   技术详情无法连接端点「stub-loopback」：privacy-consent-not-granted: 用户尚未同意隐私规则，
 *   拒绝发起任何请求（http://127.0.0.1:4399/v1/chat/completions）
 * —— 也就是"发出去了、被本机闸门拦在客户端"，而不是"规则答了"。
 * 期望值从**规则表真源**算（不写死中文，也不写死条数），所以这张表换了措辞判据跟着动。
 */
const TOOL_RULES_SRC = 'packages/app-host/src/ai-tool-selection.ts';
const RULE_UNCOVERED_MARKER = '设备侧未覆盖';

function toolRulePatterns(text) {
  const out = [];
  const re = /pattern:\s*\/((?:[^\\/]|\\.)+)\/([gimsuy]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    try {
      out.push(new RegExp(m[1], m[2]));
    } catch {
      /* 跳过解析不了的（例如带命名组的），由调用方的"零条即退 2"兜住 */
    }
  }
  return out;
}

function typedPrompts(scriptText) {
  const out = [];
  scriptText.split('\n').forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const m = /^(\w*PROMPT)="([^"]*)"\s*$/.exec(line.trim());
    if (m) out.push({ at: `第 ${String(i + 1)} 行`, name: m[1], value: m[2] });
  });
  return out;
}

function ruleHitHonesty(scriptText, rulesText) {
  const rules = toolRulePatterns(rulesText);
  if (rules.length === 0) return { probe: false, red: [] };
  const prompts = typedPrompts(scriptText);
  // 🔴 这一支**无条件**先走，放在"这趟还拿不拿规则命中当判据"那道提前返回**之前**：
  //    名字撒谎与有没有那条判据无关。臂 33 第一次就是这么空的 —— 我把 has_sub 判据摘掉之后
  //    整条判据 ⑬ 提前返回，"名字叫 RULE 却不命中"从此永远不会红（一条会死的判据被
  //    另一格的改动顺手救活，等于没有）。
  //    抓出来的那条：`RULE_PROMPT="list all tasks"` 与一句登记隔了 80 行，
  //    登记救不了名字 —— 后面的人会照着名字加句子，以为那测的是规则。
  const lying = prompts.filter((p) => /RULE/.test(p.name) && !rules.some((r) => r.test(p.value)));
  if (lying.length > 0) {
    return {
      probe: true,
      red: lying.map(
        (p) =>
          `${p.at} ${p.name}="${p.value}" —— 名字声称这是"规则句"，但规则表（现算 ${String(rules.length)} 条 pattern）` +
          `一条都没命中它。要么改命（它只是"走发送链路的第一句"），要么换成真能命中的句子；` +
          `一张全中文谓词的表是选不出 ASCII 句子的（本仓的 ASCII 输入通道逐条试过，见 traps #334）。`,
      ),
    };
  }
  // 这一趟不再拿"规则命中"当判据 —— 除了名字撒谎，没什么可判的。
  const assertsRule = /(?:has_sub|reveal_sub)[^\n]*本机规则命中/.test(scriptText);
  if (!assertsRule) return { probe: true, red: [] };
  const hit = prompts.filter((p) => rules.some((r) => r.test(p.value)));
  if (hit.length > 0) return { probe: true, red: [] };
  if (scriptText.includes(RULE_UNCOVERED_MARKER)) return { probe: true, red: [] };
  return {
    probe: true,
    red: [
      `脚本把「本机规则命中」当判据（has_sub / reveal_sub），但打进去的 ${String(prompts.length)} 句里` +
        `没有一句被规则表（现算 ${String(rules.length)} 条 pattern）命中，也没有一行登记「${RULE_UNCOVERED_MARKER}」。` +
        `⇒ 这条判据断言的是一件从没发生的事：要么用真能命中的句子，要么显式登记未覆盖（写清是哪条通道够不到）。`,
    ],
  };
}

/**
 * 判据 ⑭：逐功能授权入口的**期望值**必须由端点字面量推，而"没有"那一支必须带分母。
 * rig28~34 现量：那一趟配的是回环 stub，而 `ai-consent-<feature>` 罩在 `{needs ? …}` 里
 * —— 目的地 'none' ⇒ `requiresEgressConsent` false ⇒ 那一行**按设计不渲染**，
 * 载体却无条件逐档 reveal 那枚按钮 ⇒ 五档全报"滚不出来"，白花五轮滚动还打出五条假红。
 * 一条恒不成立的判据比没有判据更糟（traps 里 #333 的同族第二种面目）。
 */
function consentExpectation(scriptRel) {
  const bindRaw = helperBody(scriptRel, 'bind_all_routes');
  const scanRaw = helperBody(scriptRel, 'scan_rids');
  if (bindRaw === null || scanRaw === null) return null;
  // 🔴 只读**可执行的那些行**：这三条判据第一版全数失效，因为注释里也写着
  //    `127.0.0.0/8`、`SCAN-CAP`、`blur_focus` —— 拿"字符串在不在"去判形状，
  //    注释会把每一条变异都洗成绿（#191 那一族在门禁自己身上的样子）。
  const bind = codeOf(bindRaw);
  const scan = codeOf(scanRaw);
  const red = [];
  // 期望值的定性必须**与那一档的赋值同一行**：分在两处写就等于允许其中一处被换掉而另一处还留着。
  const qual = bind.split('\n').filter((l) => /NEEDS_CONSENT=0/.test(l));
  if (!/ep_host=/.test(bind) || !qual.some((l) => /127\./.test(l) && /localhost/.test(l) && /::1/.test(l))) {
    red.push(
      'bind_all_routes 里没有"把回环字面量判成免授权"的那一行（ep_host 的推导不在，或者 NEEDS_CONSENT=0 那一行不带 127./localhost/::1 的定性）⇒ ' +
        '退回"无条件去点同意"那个形状：回环那一档恒不成立、非回环那一档恒成立，两档在输出上长得一模一样。',
    );
  }
  if (!/scan_rids/.test(bind)) {
    red.push(
      '回环那一支没走 scan_rids（整页逐帧）⇒ "当前这一帧没看到"会被打印成"界面上没有授权入口"：一条没有分母的否定判据。',
    );
  }
  if (!/SCAN-CAP[^\n]*cap=1/.test(bind.replace(/\s+/g, ' '))) {
    red.push(
      'scan_rids 的 SCAN-CAP 哨兵在调用方没人接（没有一行同时写着 SCAN-CAP 与 cap=1）⇒ ' +
        '载体走不完整页时那一格会被读成"查过了、确实没有"（假绿）。',
    );
  }
  const firstSwipe = scan.indexOf('$ADB shell input swipe');
  const blurAt = scan.indexOf('blur_focus');
  const topAt = scan.indexOf('scroll_to_top');
  if (firstSwipe === -1 || blurAt === -1 || topAt === -1 || blurAt > firstSwipe || topAt > firstSwipe) {
    red.push(
      'scan_rids 没在**第一发手势之前**摘焦点、回到顶部 ⇒ 与 reveal_rid 栽过的两档同一形状' +
        '（长手势被输入框吞 / 起点落在屏幕中段，于是"没查到"其实只是"没走到"）。',
    );
  }
  return red;
}

/**
 * 判据 ⑮：`adb reverse` 隧道必须是**用到那一刻的断言**，不是起跑前的一次性前置。
 * rig39 现量（A/B 复现过）：`adb root` 与 `adb unroot` 都会重启 adbd，而重启把该设备上
 * 全部 `adb reverse` 清掉（root 前 `reverse --list` = `host-20 tcp:4399 tcp:4399`，root 后为空）。
 * 读设备库的两个 helper 各含一对 root+unroot ⇒ 第一次库回读就把后面每一发 AI 请求的通道拆了。
 * 最坏的不是第 9 步红，是第 5/7/8 那几条「假端点计数 0→0」——**通道断了**与**闸门拦住了**
 * 在这条读数上长得一模一样，于是隐私闸门的证据悄悄变成空转（#335 那族的第二种面目）。
 * 判三件事：① 每一处 `$ADB root` 所在的 bash 函数里都得有补隧道；② 每一发真发送之前都得有
 * 一次带正向对照的通道断言（顺序判据，不是"整份文件里出现过"）；③ 断言只能在父 shell 里退，
 * 所以 `ensure_tunnel` 自己不许调 `summary`（子 shell 里 exit 等于没 exit）。
 */
function tunnelInvariant(scriptRel) {
  const full = codeOf(readFileSync(join(ROOT, scriptRel), 'utf8'));
  const ensure = helperBody(scriptRel, 'ensure_tunnel');
  const runner = helperBody(scriptRel, 'tunnel_or_environment_fail');
  if (ensure === null || runner === null) return null;
  const ensureCode = codeOf(ensure);
  const runnerCode = codeOf(runner);
  const red = [];

  // ① root 站点必须带补隧道。按**函数体**扫，不写死函数名清单 ——
  //    写死清单的那一版，第三处 root 一加进来判据就悄悄不覆盖它了。
  const fnRe = /^([a-zA-Z_][\w]*)\(\) \{/gm;
  const bodies = [];
  let m;
  while ((m = fnRe.exec(full)) !== null) {
    const next = full.indexOf('\n}', m.index);
    if (next === -1) continue;
    bodies.push({ name: m[1], body: full.slice(m.index, next + 2) });
  }
  const rootFns = bodies.filter((b) => /\$ADB root|\$ADB unroot/.test(b.body));
  const unrepaired = rootFns.filter((b) => !/ensure_tunnel/.test(b.body));
  if (rootFns.length === 0 || unrepaired.length > 0) {
    red.push(
      `含 root/unroot 的 bash 函数里没补 adb reverse 隧道（现量：这类函数 ${String(rootFns.length)} 枚，未补的 ${String(unrepaired.length)} 枚：` +
        `${unrepaired.map((b) => b.name).join(' ') || '一枚都没扫到'}）⇒ 库回读一跑，后面的发送判据就在断了的通道上打分。`,
    );
  }

  // ② **每一步的第一发**发送之前都要有一次通道断言（按步骤分段判，不是"整份文件里出现过"）。
  //    分段而不是逐发：同一趟里 `breakdown-start` 与紧随的 `ai-send` 之间隔几秒，
  //    再插一次不增加任何信息，只会把"要不要证"这件事磨成"反正每次都证"的形式主义。
  const sendRe = /tap_rid (ai-send|ai-tool-send|breakdown-start|tool-start-assistant)/;
  const stepSplit = full.split(/\n(?=step ")/);
  const naked = [];
  for (const seg of stepSplit) {
    const firstSend = seg.search(sendRe);
    if (firstSend === -1) continue;
    const sendName = seg.match(sendRe)[1];
    if (!seg.slice(0, firstSend).includes('tunnel_or_environment_fail')) naked.push(sendName);
  }
  if (naked.length > 0) {
    red.push(
      `有 ${String(naked.length)} 个步骤的第一发发送（${naked.join(' ')}）前面没有 tunnel_or_environment_fail ⇒ ` +
        `起跑那一次正向对照证明不了**这一发**通着，"计数没动"于是有两种读数一样的解释（真没发／通道断了）。`,
    );
  }

  // ③ 退出必须在父 shell 里。
  if (!/TUNNEL_WHY=\$\(ensure_tunnel\)/.test(runnerCode) || /summary/.test(ensureCode)) {
    red.push(
      '隧道断言的退出不长在父 shell（ensure_tunnel 里调了 summary，或 runner 没把 $(ensure_tunnel) 的返回值接到自己的变量上）' +
        '⇒ 命令替换是子 shell，那里面的 exit 退不掉整趟（本仓在同一件事上栽过：scan_rids 的 SCAN_INCOMPLETE）。',
    );
  }

  // ④ 断言必须有分母：只 `adb reverse` 而不从设备里打一发 /__probe，就只是"我以为通了"。
  if (!/\$ADB reverse/.test(ensureCode) || !/stub_probe_hits/.test(ensureCode) || !/toybox nc/.test(ensureCode)) {
    red.push(
      'ensure_tunnel 里没有"补转发 + 从设备里打一发 /__probe 再读回 probeHits"这整半 ⇒ ' +
        '一条只会重新下命令、不证明它生效的断言，等于没有断言（#58 那一族）。',
    );
  }
  return red;
}

/**
 * 判据 ⑯：第 9 步那条"没点确认 ⇒ 库里不写"的否定判据必须**挂在提案卡的分母上**。
 * rig39 现量：屏上是那句"连不上端点"（压根没出提案），下一行照样打 ✅「只看了提案、没点确认
 * ⇒ 手机库条数不变（1→1）」—— 没有提案可看时，"没写库"只是"什么都没发生"的另一个名字。
 * 期望值也不许再退成一行 ↷：卡片出现 ⇒ 假端点计数恰好 +1，否则那张卡不是这一发送回来的。
 */
function proposalDenominator(scriptRel) {
  const full = codeOf(readFileSync(join(ROOT, scriptRel), 'utf8'));
  const red = [];
  if (!/PROPOSAL=0/.test(full) || !/PROPOSAL=1/.test(full)) {
    red.push(
      '第 9 步没有把"提案卡出没出"登记成一个可读的标志（PROPOSAL=0／=1 两档缺其一）⇒ ' +
        '"没点确认不写库"会在什么都没发生时报绿。',
    );
  }
  // 顺序 + 形状：那条 ok 必须是 PROPOSAL=0 那一支的 **elif**，不是独立 if。
  const guard = full.indexOf('[ "$PROPOSAL" = "0" ]');
  const claimed = full.indexOf('只看了提案、没点确认');
  if (guard === -1 || claimed === -1 || claimed < guard) {
    red.push(
      '「只看了提案、没点确认」不在 PROPOSAL=0 那支之后（顺序不对或整支被摘）⇒ 判据可以没有输入就打分。',
    );
  }
  if (!/elif \[ "\$OPS_NOCONFIRM" = "\$OPS_BEFORE" \]/.test(full)) {
    red.push(
      '库条数比较不是 PROPOSAL=0 那一支的 elif（被改回独立 if 了）⇒ 摘掉守卫只需要动一个词，' +
        '而读数上看不出这条判据已经没了分母。',
    );
  }
  if (!/\[ "\$S1" = "\$\(\(S0\+1\)\)" \]/.test(full)) {
    red.push(
      '假端点计数恰好 +1 的期望值被退成了一行 ↷ 打印（读的人得自己算）⇒ 提案卡与"这一发真出去了"脱钩，' +
        '缓存或上一趟残留都能冒充这一趟的产出。',
    );
  }
  return red;
}

/**
 * 判据 ⑰：收尾必须挂在**退出路径**上，而"清干净"必须是判据。
 * rig41 现量：第 11 步 `summary … 1` 中止 ⇒ 第 14 步（摘 reverse + kill 假端点）从来没跑到，
 * 机器上留下一枚 `ppid=1` 的桩和一条 `adb reverse`；下一轮的 readiness 只问"有没有人答"，
 * 于是借用上一轮的桩（#341）。而固定名的 pidfile 会被下一轮起跑第一句 `rm -f` 抹掉 ⇒
 * **清理凭据本身就是会被销毁的证据**（#342）。
 */
function teardownInvariant(scriptRel) {
  const full = codeOf(readFileSync(join(ROOT, scriptRel), 'utf8'));
  const body = helperBody(scriptRel, 'teardown_rig');
  if (body === null) return null; // 抽不到定义 ⇒ 让调用它的臂红，而不是"这几臂不存在"
  const bodyCode = codeOf(body);
  const red = [];

  // ① 注册在 EXIT trap 上，并且**早于** spawn 假端点那一行（晚注册等于这一轮没人接）。
  const trapIdx = full.search(/trap '[^']*teardown_rig[^']*' EXIT/);
  const spawnIdx = full.search(/nohup "\$NODE" "\$HEYTA_REPO_ROOT\/e2e\/stub-provider\.mjs"/);
  if (trapIdx === -1 || spawnIdx === -1 || trapIdx > spawnIdx) {
    red.push(
      '收尾没有注册在 spawn 假端点之前的 EXIT trap 上 ⇒ 任何一步 `summary … 1/3` 中止都是 exit，' +
        '写在最后一步的清理其实只在成功路径上执行，桩与 adb reverse 留给下一轮（#342）。',
    );
  }

  // ② teardown 里那两件动作必须在，而且 kill 之前要核对 argv（pid 会复用，光看号码可能动到别人）。
  if (
    !/reverse --remove/.test(bodyCode) ||
    !/kill -TERM/.test(bodyCode) ||
    !/ps -o args=/.test(bodyCode) ||
    !/stub-provider\.mjs/.test(bodyCode)
  ) {
    red.push(
      'teardown_rig 少了"摘 reverse / kill / 按 argv 核对那枚是本脚本的桩"里的一环 ⇒ ' +
        '要么残留照旧，要么按号 kill 打到别人的进程。',
    );
  }

  // ③ 清理凭据按轮隔离。
  if (!/STUB_PIDFILE="[^"]*\$\$[^"]*"/.test(full)) {
    red.push(
      'pidfile 是固定名（不带本轮 $$）⇒ 下一轮起跑的 `rm -f "$STUB_PIDFILE"` 抹掉的是上一轮那份' +
        '"该关谁"的记录，清理按 pidfile 找人时找的已不是该找的那枚（#342）。',
    );
  }

  // ④ 第 14 步是判据：清没清都要读，不许只在"有东西可清"时打印一行。
  const tail = full.slice(full.indexOf('step "14.'));
  if (!/STUB_GONE/.test(tail) || !/bad "[^"]*监听者/.test(tail) || !/bad "[^"]*反向代理/.test(tail)) {
    red.push(
      '第 14 步没有把"端口上已无监听者 / reverse 清单里已无这一枚"写成 ok／bad 判据 ⇒ ' +
        '"没东西可清"和"什么都没清"在日志上长得一样，逐轮累积的那条路不会自己出声（元规则二）。',
    );
  }
  return red;
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

  // ── 判据 ⑪：装包通道（见函数上方那段实测）──
  const installRed = installChannel(scriptText);
  if (installRed === null) {
    console.error('🔴 脚本里一条 $ADB install 调用都没取到 —— 是探针没输入，不报"装包通道没问题"');
    process.exit(2);
  }
  for (const line of installRed) console.log(`装包通道\t${line}`);
  console.log(`INSTALL_SUMMARY 装包调用=${String(
    scriptText.split('\n').filter((l) => !/^\s*#/.test(l) && INSTALL_CALL.test(l)).length,
  )} 红=${String(installRed.length)}`);

  // ── 判据 ⑫：reveal 的失败出口要排除"方向局限"，才许说"不存在" ──
  const dirRed = revealDirection(scriptRel);
  if (dirRed === null) {
    console.error('🔴 取不到 reveal_rid / reveal_rid_top_fallback 的函数体 —— 探针没输入，不报"滚动方向没问题"');
    process.exit(2);
  }
  for (const line of dirRed) console.log(`滚动方向\t${line}`);
  console.log(`DIRECTION_SUMMARY reveal_rid 有 fallback 调用=${String(dirRed.length === 0 ? 1 : 0)} 红=${String(dirRed.length)}`);

  // ── 判据 ⑬：规则命中这句话只能压在真命中的句子上 ──
  const rulesRel = process.env.HEYTA_TOOL_RULES_SRC ?? TOOL_RULES_SRC;
  const honesty = ruleHitHonesty(scriptText, readScript(join(ROOT, rulesRel)));
  if (!honesty.probe) {
    console.error(`🔴 在 ${rulesRel} 里解析不出任何 pattern: /…/ —— 探针没输入，不报"规则句判据诚实"`);
    process.exit(2);
  }
  for (const line of honesty.red) console.log(`规则句诚实性\t${line}`);
  console.log(`HONESTY_SUMMARY 规则pattern=${String(toolRulePatterns(readScript(join(ROOT, rulesRel))).length)} 红=${String(honesty.red.length)}`);

  // ── 判据 ⑭：逐功能授权入口的期望值由端点字面量推，否定那一支带分母 ──
  const consentRed = consentExpectation(scriptRel);
  if (consentRed === null) {
    console.error('🔴 取不到 bind_all_routes / scan_rids 的函数体 —— 探针没输入，不报"授权期望值是对的"');
    process.exit(2);
  }
  for (const line of consentRed) console.log(`授权期望值\t${line}`);
  console.log(`CONSENT_SUMMARY bind/scan 取得到=1 红=${String(consentRed.length)}`);

  // ── 判据 ⑮：隧道是"用到那一刻的断言"（root/unroot 会拆掉 adb reverse）──
  const tunnelRed = tunnelInvariant(scriptRel);
  if (tunnelRed === null) {
    console.error('🔴 取不到 ensure_tunnel / tunnel_or_environment_fail 的函数体 —— 探针没输入，不报"通道有人管"');
    process.exit(2);
  }
  for (const line of tunnelRed) console.log(`隧道断言\t${line}`);
  console.log(`TUNNEL_SUMMARY 两个 helper 取得到=1 红=${String(tunnelRed.length)}`);

  // ── 判据 ⑯：第 9 步那条否定判据要挂在提案卡的分母上 ──
  const proposalRed = proposalDenominator(scriptRel);
  for (const line of proposalRed) console.log(`提案分母\t${line}`);
  console.log(`PROPOSAL_SUMMARY 红=${String(proposalRed.length)}`);

  // ── 判据 ⑰：收尾挂在退出路径上，且"清干净"是判据（traps #342）──
  const teardownRed = teardownInvariant(scriptRel);
  if (teardownRed === null) {
    console.error('🔴 取不到 teardown_rig 的函数体 —— 探针没输入，不报"收尾有人管"');
    process.exit(2);
  }
  for (const line of teardownRed) console.log(`收尾判据\t${line}`);
  console.log(`TEARDOWN_SUMMARY helper 取得到=1 红=${String(teardownRed.length)}`);

  if (missing.length > 0 || descRed.length > 0 || backtickRed.length > 0 || capRed.length > 0 || capOrderRed.length > 0 || installRed.length > 0 || dirRed.length > 0 || honesty.red.length > 0 || consentRed.length > 0 || tunnelRed.length > 0 || proposalRed.length > 0 || teardownRed.length > 0) {
    console.log('🔴 有锚点落不到源码上：rid 未匹配=' + String(missing.length) +
      '，desc/text 未命中=' + String(descRed.length) +
      '，双引号文案里的反引号=' + String(backtickRed.length) +
      '，移动侧能力字段缺口=' + String(capRed.length) + '，装包通道=' + String(installRed.length) + '，滚动方向=' + String(dirRed.length) + '，规则句诚实性=' + String(honesty.red.length) +
      '，授权期望值=' + String(consentRed.length) +
      '，隧道断言=' + String(tunnelRed.length) + '，提案分母=' + String(proposalRed.length) +
      '，收尾判据=' + String(teardownRed.length) + '。' +
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
  // 整份副本变异用的助手：runMutant 只会**追加**一行，而"摘掉某一档"必须改既有内容。
  //   仍然打在 tmp 副本上、经 env 重定向进整条流水线（真树 mtime 不动）。
  const runMutantFile = (text, tag) => {
    const dir = join(ROOT, 'tmp');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `.mut-${tag}.sh`);
    writeFileSync(file, text);
    let code = -1;
    let out = '';
    try {
      const kid = spawnSync(process.execPath, [join(ROOT, 'scripts/check-mobile-ai-anchors.mjs')], {
        encoding: 'utf8',
        cwd: ROOT,
        env: { ...process.env, HEYTA_ANCHOR_SCRIPT: `tmp/.mut-${tag}.sh` },
      });
      code = kid.status ?? -1;
      out = `${kid.stdout ?? ''}${kid.stderr ?? ''}`;
    } finally {
      rmSync(file, { force: true });
    }
    return { code, out };
  };

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

  // ── 判据 ⑪（装包通道）的四臂 ──
  //   病是 rig30 那次「❌ 装不上」连原因都没有：adb 的 stderr 被 `>/dev/null 2>&1` 吞掉，
  //   真原因（换打包机 = 换 debug keystore ⇒ INSTALL_FAILED_UPDATE_INCOMPATIBLE）
  //   只有人手忙脚乱复现一次才看得见。臂 22 证明探针确有输入，23/24 证明两种漏法都会红，
  //   臂 25 证明"注释行不算调用点"这条豁免本身有牙齿（否则判据可以把真调用也跳掉而全绿）。
  const realInstallRed = installChannel(readScript(join(ROOT, DEFAULT_SCRIPT)));
  arms.push([
    '臂 22 真脚本里装包调用取得到、判据 ⑪ 不误红（探针确有输入）',
    realInstallRed !== null && realInstallRed.length === 0,
  ]);
  const m23 = runMutant('$ADB install -r -g "$APK" >/dev/null 2>&1 || true', 'install-swallow');
  arms.push(['臂 23 装包命令把输出丢进 /dev/null ⇒ 非零退出', m23.code !== 0]);
  arms.push(['臂 23 红字点名"装包通道"（不是只退码）', m23.out.includes('装包通道')]);
  const m25 = runMutant('# 旧写法 $ADB install -r -g "$APK" >/dev/null 2>&1 已经废掉了', 'install-comment');
  arms.push(['臂 25 同一行只写在注释里 ⇒ 整条流水线仍为 0', m25.code === 0]);

  // 臂 24：把那一档失败的处理摘掉（改标识符，保持 bash 语法完整）⇒ 必须红且点名。
  const mutDir24 = join(ROOT, 'tmp');
  mkdirSync(mutDir24, { recursive: true });
  const mut24 = join(mutDir24, '.install-nodecl.sh');
  const base24 = readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8');
  writeFileSync(mut24, base24.split('INSTALL_FAILED_UPDATE_INCOMPATIBLE').join('ZZ_REMOVED_BRANCH'));
  let code24 = -1;
  let out24 = '';
  try {
    const k24 = spawnSync(process.execPath, [join(ROOT, 'scripts/check-mobile-ai-anchors.mjs')], {
      encoding: 'utf8',
      cwd: ROOT,
      env: { ...process.env, HEYTA_ANCHOR_SCRIPT: 'tmp/.install-nodecl.sh' },
    });
    code24 = k24.status ?? -1;
    out24 = `${k24.stdout ?? ''}${k24.stderr ?? ''}`;
  } finally {
    rmSync(mut24, { force: true });
  }
  arms.push(['臂 24 摘掉换签名键那一档 ⇒ 非零退出', code24 !== 0]);
  arms.push(['臂 24 红字说明为什么这一档必须有出口', out24.includes('debug keystore')]);

  // ── 判据 ⑫（滚动方向）的三臂 ──
  //   臂 26 阳性对照（探针确有输入且不误红），27 摘掉 reveal_rid 里那一档 ⇒ 红，
  //   臂 28 把 fallback 里的反向手势摘掉（留个同名空壳）⇒ 红。
  const dirReal = revealDirection(DEFAULT_SCRIPT);
  arms.push(['臂 26 真脚本两个 helper 都取得到、判据 ⑫ 不误红', dirReal !== null && dirReal.length === 0]);
  // 🔴 必须**全部**摘掉：reveal_rid 现在有两处调用（滚不动那一档 + 滚满那一档），
  //    只 replace 第一处会让第二处留着 ⇒ 臂自己失效（读数看着像门禁不红）。
  const mutDir27 = readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8')
    .split('reveal_rid_top_fallback "$rid" && return 0')
    .join('true && return 0');
  const m27 = runMutantFile(mutDir27, 'reveal-no-fallback');
  arms.push(['臂 27 reveal_rid 不回到顶部再找 ⇒ 非零退出且点名', m27.code !== 0 && m27.out.includes('滚动方向')]);
  const mutDir28 = readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8').replace(
    'reveal_rid_top_fallback() {  # <testID> → 0=在视口上方，回到顶部后取到 / 1=回到顶部也没有\n  local rid=$1\n  blur_focus\n  scroll_to_top',
    'reveal_rid_top_fallback() {  # <testID>\n  local rid=$1\n  blur_focus',
  );
  const m28 = runMutantFile(mutDir28, 'reveal-no-scroll');
  arms.push(['臂 28 那一档只是空壳（没反向手势）⇒ 非零退出且点名', m28.code !== 0 && m28.out.includes('scroll_to_top')]);

  // 臂 29/30/31（tap_rid 的三种漏法）：单方向手势 / 没有第二趟 / 把"没找到"挪回循环里。
  const mutDir29 = readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8')
    .split('        $ADB shell input swipe 540 900 540 1900 300')
    .join('        $ADB shell input swipe 540 1900 540 900 300');
  const m29 = runMutantFile(mutDir29, 'tap-one-way');
    // 🔴 断言字串要**从红字里取**，不是凭印象写：这一臂第一版查的是「只有一种手势」，
  //    而红字写的是「只有往下滚那一种手势」—— 于是变异真的生效、门禁真的红了，
  //    臂却报 FAIL（§7 #274 那一族：负向断言的正向对照要落在真的会动的那一侧）。
  //    并且加一道"变异必须真的进副本"的前置，否则臂会退化成"没测任何东西的绿"。
  arms.push([
    '臂 29 的变异确实改掉了那一行（前置：否则这条臂等于没有）',
    mutDir29 !== readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8'),
  ]);
  arms.push(['臂 29 tap_rid 只留一个方向 ⇒ 非零退出且点名方向由读数选', m29.code !== 0 && m29.out.includes('tap_rid 里只有往下滚')]);
  const mutDir30 = readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8').replace('for pass in 1 2; do', 'for pass in 1; do');
  const m30 = runMutantFile(mutDir30, 'tap-one-pass');
  arms.push(['臂 30 tap_rid 没有第二趟 ⇒ 非零退出且点名', m30.code !== 0 && m30.out.includes('没有第二趟')]);
  const mutDir31 = readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8')
    .replace('      ctrl=""\n      sleep 1.5\n    done\n', '      ctrl=""\n      sleep 1.5\n      if [ -z "$ctrl" ]; then return 1; fi\n    done\n');
  const m31 = runMutantFile(mutDir31, 'tap-return-inside');
  arms.push([
    '臂 31 「没找到」挪回 pass 循环里面 ⇒ 非零退出且点名顺序',
    mutDir31 !== readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8') && m31.code !== 0 && m31.out.includes('永远不会跑'),
  ]);

  // ── 判据 ⑬ 的三臂 ──
  const hReal = ruleHitHonesty(
    readScript(join(ROOT, DEFAULT_SCRIPT)),
    readScript(join(ROOT, TOOL_RULES_SRC)),
  );
  arms.push(['臂 32 真脚本：规则句判据要么有真命中要么登记了未覆盖（探针确有输入）', hReal.probe && hReal.red.length === 0]);
  // 臂 33：摘掉那行登记 ⇒ 必须红，且点名"没有一句被规则表命中"。
  // 臂 33（本轮真抓到的那条）：往副本里塞一枚"名字叫 RULE_PROMPT 却不命中"的赋值 ⇒ 必须红。
  //   第一版这里写的是"摘掉登记行"，而**脚本已经不拿 has_sub 当判据了**，于是那一臂
  //   没有输入、照样报绿 —— 臂 FAIL 才把它照出来（一条永远不红的臂等于没有臂）。
  const baseFor33 = readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8');
  const mutDir33 = `${baseFor33}\nRULE_PROMPT="list all tasks"\n`;
  arms.push(['臂 33 的假规则句确实进了副本（前置）', mutDir33 !== baseFor33 && mutDir33.includes('RULE_PROMPT=')]);
  const m33 = runMutantFile(mutDir33, 'lying-rule-name');
  arms.push(['臂 33 名字叫 RULE 却不命中 ⇒ 非零退出且点名', m33.code !== 0 && m33.out.includes('名字声称这是')]);
  // 臂 34：把打的句子换成规则表真能命中的中文句 ⇒ 必须放行（证明 OR 的另一支不是装饰）。
  const baseFor34 = readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8');
  const mutDir34 = `${baseFor34}\nRULE_PROMPT="列出所有任务"\n`;
  arms.push(['臂 34 的真规则句确实进了副本（前置）', mutDir34 !== baseFor34]);
  const m34 = runMutantFile(mutDir34, 'real-rule-sentence');
  arms.push(['臂 34 用真命中的句子 ⇒ 整条流水线仍为 0（另一支是活的）', m34.code === 0]);

  // ── 判据 ⑭（授权入口的期望值）的臂 ──
  const cReal = consentExpectation(DEFAULT_SCRIPT);
  arms.push(['臂 35 真脚本两个 helper 都取得到、判据 ⑭ 不误红（探针确有输入）', cReal !== null && cReal.length === 0]);
  const baseFor36 = readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8');
  // 臂 36：把回环那一档的定性拿掉（期望值从此不看端点）⇒ 必须红。
  const mutDir36 = baseFor36.replace('127.[0-9]* | localhost | ::1) NEEDS_CONSENT=0 ;;', 'NOT-A-REAL-PATTERN) NEEDS_CONSENT=0 ;;');
  arms.push(['臂 36 的变异确实摘掉了端点定性（前置）', mutDir36 !== baseFor36]);
  const m36 = runMutantFile(mutDir36, 'consent-no-derivation');
  arms.push(['臂 36 期望值不从端点推 ⇒ 非零退出且点名', m36.code !== 0 && m36.out.includes('回环字面量判成免授权')]);
  // 臂 37：把整页扫描换成空串（否定那一支从此没有分母）⇒ 必须红。
  const mutDir37 = baseFor36.replace(
    '    consent_hit=$(scan_rids "ai-consent-capture ai-consent-breakdown ai-consent-prioritize ai-consent-duration-estimate ai-consent-tool-calling")',
    '    consent_hit=""',
  );
  arms.push(['臂 37 的变异确实摘掉了 scan_rids 调用（前置）', mutDir37 !== baseFor36]);
  const m37 = runMutantFile(mutDir37, 'consent-no-scan');
  arms.push(['臂 37 没有整页分母 ⇒ 非零退出且点名', m37.code !== 0 && m37.out.includes('没有分母的否定判据')]);
  // 臂 38：只摘调用方对 SCAN-CAP 的处理（走不完时没人接哨兵 ⇒ 假绿）⇒ 必须红。
  const mutDir38 = baseFor36.replace('      *" SCAN-CAP "*) cap=1; consent_hit=$(printf \'%s\' "$consent_hit" | sed \'s/ *SCAN-CAP//\') ;;', '      *) cap=0 ;;');
  arms.push(['臂 38 的变异确实摘掉了 SCAN-CAP 那一格（前置）', mutDir38 !== baseFor36]);
  const m38 = runMutantFile(mutDir38, 'consent-no-cap');
  arms.push(['臂 38 哨兵没人接 ⇒ 非零退出且点名', m38.code !== 0 && m38.out.includes('SCAN-CAP 哨兵')]);
  // 臂 39：scan_rids 不摘焦点（与 reveal_rid 栽过的同一档）⇒ 必须红。
  const mutDir39 = baseFor36.replace(
    '  local pending="$1" hit="" still="" r ref now stuck=0 frames=0\n  blur_focus\n  scroll_to_top',
    '  local pending="$1" hit="" still="" r ref now stuck=0 frames=0\n  scroll_to_top',
  );
  arms.push(['臂 39 的变异确实摘掉了 scan_rids 的 blur_focus（前置）', mutDir39 !== baseFor36]);
  // 🔴 这三臂同时是"注释不许顶替可执行代码"的臂：真脚本的**注释里**就写着
  //    `127.0.0.0/8`、`SCAN-CAP`、`blur_focus`，第一版三条判据因此三条全空转
  //    （变异真的生效、门禁却读成绿）—— 现在每条都只看剔掉注释之后的可执行行。
  const m39 = runMutantFile(mutDir39, 'consent-no-blur');
  arms.push(['臂 39 整页扫描不摘焦点 ⇒ 非零退出且点名', m39.code !== 0 && m39.out.includes('没在**第一发手势之前**摘焦点')]);

  // ── 判据 ⑮（隧道是"用到那一刻的断言"）与 ⑯（否定判据要挂分母）的臂 ──
  //   rig39 现量：`adb root`/`unroot` 重启 adbd ⇒ 每一枚 adb reverse 被清掉，
  //   而通道断了与闸门拦住了在"计数 0→0"这条读数上**一模一样**；
  //   同一步里"没有提案"却打了"没点确认不写库"的 ✅。两条都不许靠人记得。
  const baseTun = readFileSync(join(ROOT, DEFAULT_SCRIPT), 'utf8');
  const tReal = tunnelInvariant(DEFAULT_SCRIPT);
  const pReal = proposalDenominator(DEFAULT_SCRIPT);
  arms.push(['臂 40 真脚本两个 helper 都取得到、⑮⑯ 都不误红（探针确有输入）', tReal !== null && tReal.length === 0 && pReal.length === 0]);
  // 臂 41：只摘 pull_prefs_db 里那一处补修（replace 第一处）⇒ 必须红，且点名"没补 adb reverse 隧道"。
  const mutTun41 = baseTun.replace('  ensure_tunnel >/dev/null 2>&1 || true', '  : # 变异：这一处原本把隧道补回来');
  arms.push(['臂 41 的变异确实摘掉了一处补修（前置）', mutTun41 !== baseTun && (mutTun41.match(/ensure_tunnel >\/dev\/null/g) || []).length === 1]);
  const m41 = runMutantFile(mutTun41, 'root-no-repair');
  arms.push(['臂 41 root 站点没补隧道 ⇒ 非零退出且点名', m41.code !== 0 && m41.out.includes('没补 adb reverse 隧道')]);
  // 臂 42：摘掉第 9 步第一发之前的断言 ⇒ 必须红（顺序判据，不是"整份文件出现过"）。
  const mutTun42 = baseTun.replace('tunnel_or_environment_fail "第 9 步发送前"\n', '');
  arms.push(['臂 42 的变异确实摘掉了第 9 步那句断言（前置）', mutTun42 !== baseTun && !mutTun42.includes('第 9 步发送前')]);
  const m42 = runMutantFile(mutTun42, 'send-no-tunnel-assert');
  arms.push(['臂 42 第一发发送前没证通道 ⇒ 非零退出且点名', m42.code !== 0 && m42.out.includes('前面没有 tunnel_or_environment_fail')]);
  // 臂 43：把断言退化成"只下命令不证明"（摘掉设备侧那一发）⇒ 必须红。
  const mutTun43 = baseTun.replace('toybox nc -w 4 127.0.0.1', 'true # 变异：设备里那一发没了');
  arms.push(['臂 43 的变异确实摘掉了设备侧那一发（前置）', mutTun43 !== baseTun]);
  const m43 = runMutantFile(mutTun43, 'tunnel-no-positive-control');
  arms.push(['臂 43 断言没有正向对照 ⇒ 非零退出且点名', m43.code !== 0 && m43.out.includes('ensure_tunnel 里没有')]);
  // 臂 44：把"没点确认不写库"从 PROPOSAL 那一支的 elif 改回独立 if ⇒ 必须红。
  const mutP44 = baseTun.replace('elif [ "$OPS_NOCONFIRM" = "$OPS_BEFORE" ]; then', 'if [ "$OPS_NOCONFIRM" = "$OPS_BEFORE" ]; then');
  arms.push(['臂 44 的变异确实把守卫解开了（前置）', mutP44 !== baseTun && mutP44.includes('if [ "$OPS_NOCONFIRM"')]);
  const m44 = runMutantFile(mutP44, 'no-write-without-denominator');
  arms.push(['臂 44 否定判据脱离分母 ⇒ 非零退出且点名', m44.code !== 0 && m44.out.includes('不是 PROPOSAL=0 那一支的 elif')]);
  // 臂 45：摘掉 PROPOSAL=1 那一档（标志恒 0）⇒ 必须红。
  const mutP45 = baseTun.replace('  PROPOSAL=1\n', '');
  arms.push(['臂 45 的变异确实摘掉了 PROPOSAL=1（前置）', mutP45 !== baseTun && !mutP45.includes('PROPOSAL=1')]);
  const m45 = runMutantFile(mutP45, 'proposal-flag-half-missing');
  arms.push(['臂 45 提案标志只剩一档 ⇒ 非零退出且点名', m45.code !== 0 && m45.out.includes('PROPOSAL=0／=1 两档缺其一')]);
  // 臂 46：把"恰好 +1"的期望退成同数（S1=S0）⇒ 必须红（卡片与"真发出去了"脱钩）。
  const mutP46 = baseTun.replace('elif [ "$S1" = "$((S0+1))" ]; then', 'elif [ "$S1" = "$S0" ]; then');
  arms.push(['臂 46 的变异确实改了期望值（前置）', mutP46 !== baseTun && mutP46.includes('[ "$S1" = "$S0" ]')]);
  const m46 = runMutantFile(mutP46, 'count-expectation-lost');
  arms.push(['臂 46 计数期望值不再是恰好 +1 ⇒ 非零退出且点名', m46.code !== 0 && m46.out.includes('恰好 +1 的期望值被退成')]);

  // ── 判据 ⑰（收尾挂在退出路径上，"清干净"是判据 —— traps #342）的臂 ──
  //   rig41 现量：第 11 步中止 ⇒ 第 14 步从没跑到 ⇒ 4399 上留下一枚 ppid=1 的桩和一条 adb reverse，
  //   下一轮就绪循环只问"有没有人答"就借用了它。这几臂证明现在会红，而不是证明今天绿。
  const dReal = teardownInvariant(DEFAULT_SCRIPT);
  arms.push(['臂 47 真脚本 teardown_rig 取得到、⑰ 不误红（探针确有输入）', dReal !== null && dReal.length === 0]);
  // 臂 48：把 EXIT trap 摘回"只删快照"那一版（= rig41 跑过的形状）⇒ 必须红。
  const mutTun48 = baseTun.replace(`trap 'rm -f -- "$0"; declare -F teardown_rig >/dev/null && teardown_rig' EXIT`, `trap 'rm -f -- "$0"' EXIT`);
  arms.push(['臂 48 的变异确实把收尾从 EXIT trap 上摘掉了（前置）', mutTun48 !== baseTun && !mutTun48.includes("teardown_rig' EXIT")]);
  const m48 = runMutantFile(mutTun48, 'teardown-not-on-exit');
  arms.push(['臂 48 收尾不挂退出路径 ⇒ 非零退出且点名', m48.code !== 0 && m48.out.includes('收尾没有注册在 spawn 假端点之前')]);
  // 臂 49：pidfile 退回固定名 ⇒ 必须红（清理凭据会被下一轮起跑的 rm -f 抹掉）。
  const mutTun49 = baseTun.replace('STUB_PIDFILE="/tmp/heyta-ai-stub.$$.pid"', 'STUB_PIDFILE="/tmp/heyta-ai-stub.pid"');
  arms.push(['臂 49 的变异确实把 pidfile 改成固定名（前置）', mutTun49 !== baseTun && !mutTun49.includes('heyta-ai-stub.$$.pid')]);
  const m49 = runMutantFile(mutTun49, 'shared-pidfile');
  arms.push(['臂 49 清理凭据共享一个名字 ⇒ 非零退出且点名', m49.code !== 0 && m49.out.includes('pidfile 是固定名')]);
  // 臂 50：把第 14 步"端口还坐着东西"从 bad 退成一 ↷ 打印 ⇒ 必须红。
  const mutTun50 = baseTun.replace('bad "${STUB_PORT} 仍有监听者', 'echo "   ↷ ${STUB_PORT} 仍有监听者');
  arms.push(['臂 50 的变异确实把那条 bad 退成打印（前置）', mutTun50 !== baseTun && mutTun50.includes('↷ ${STUB_PORT} 仍有监听者')]);
  const m50 = runMutantFile(mutTun50, 'teardown-not-a-claim');
  arms.push(['臂 50 收尾不再打分 ⇒ 非零退出且点名', m50.code !== 0 && m50.out.includes('第 14 步没有把')]);
  // 臂 51：摘掉 kill 之前的 argv 核对 ⇒ 必须红（按号 kill 可能打到别人的进程）。
  const mutTun51 = baseTun.replace(
    `ps -o args= -p "$sp" 2>/dev/null | grep -q "e2e/stub-provider.mjs"`,
    `ps -p "$sp" >/dev/null 2>&1`,
  );
  arms.push(['臂 51 的变异确实摘掉了 argv 核对（前置）', mutTun51 !== baseTun && !mutTun51.includes('ps -o args= -p "$sp"')]);
  const m51 = runMutantFile(mutTun51, 'kill-without-argv');
  arms.push(['臂 51 按号码就 kill ⇒ 非零退出且点名', m51.code !== 0 && m51.out.includes('teardown_rig 少了')]);

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
