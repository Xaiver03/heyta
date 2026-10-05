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
 * ## 四条判据（`--self-test` 逐臂证明，臂数由它自己打印）
 *  ① 脚本里每一个 rid 锚点都能落到源码的某条 testID 声明上（字面或模式）；
 *  ② **阳性对照**：必须命中若干"源码里确实存在"的锚点，否则 `未匹配=0` 是探针坏了
 *     而不是脚本干净 ⇒ 退 2；
 *  ③ **模板臂**：至少一条锚点是被**模式**（不是字面）匹配的 —— 少这条，
 *     模板解析坏掉会退化成"只比对字面"，而那时 `ai-consent-breakdown` 会假红；
 *  ④ 模式不许**无锚点通配**：以 `.*` 开头的模式（`${x}send` 那种）只能后缀匹配，
 *     而整条 `${x}` 的模式必须仍带字面段 —— 全通配等于放行任何锚点（那是装饰，不是判据）。
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

function run() {
  const files = walk(join(ROOT, SRC_ROOT));
  if (files.length === 0) {
    console.error(`🔴 ${SRC_ROOT} 里一个 .tsx/.ts 都没读到 —— 探针没有输入，不报"锚点都对"`);
    process.exit(2);
  }
  const decl = declarations(files);
  const scriptRel = process.env.HEYTA_ANCHOR_SCRIPT ?? DEFAULT_SCRIPT;
  const anchors = anchorsFromScript(readScript(join(ROOT, scriptRel)), scriptRel);
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
  console.log(
    `SUMMARY 源码文件=${String(files.length)} 字面testID=${String(decl.literal.size)} ` +
      `模式=${String(decl.patterns.length)} 脚本锚点=${String(anchors.length)} ` +
      `按字面命中=${String(byLiteral)} 按模式命中=${String(byPattern)} 未匹配=${String(missing.length)}`,
  );
  console.log(`模式清单：\n${decl.patterns.map((p) => `  ${p.regex.source}  ← ${p.source}`).join('\n')}`);

  if (missing.length > 0) {
    console.log('🔴 有锚点落不到任何 testID 声明上 —— 要么脚本写错（如那枚不存在的「保存」），' +
      '要么界面换了锚点而验收没跟着改。两条都是红。');
    return 1;
  }
  console.log('✅ 每条 rid 锚点都对得上源码里的 testID 声明');
  return 0;
}

if (process.argv.includes('--self-test')) {
  // 四臂：证明这条门禁**会**红，而不是证明它今天绿。
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

  let fail = 0;
  arms.forEach(([name, ok]) => {
    console.log(`SELFTEST ${name}：${ok ? 'OK' : 'FAIL'}`);
    if (!ok) fail += 1;
  });
  console.log(`ARMS=${String(arms.length)} FAIL=${String(fail)}`);
  process.exit(fail === 0 ? 0 : 1);
}

process.exit(run());
