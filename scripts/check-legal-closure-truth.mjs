#!/usr/bin/env node
/**
 * 政策里"今天还不存在"那一类封闭句，与代码现状对账（批次 E / 工单 E5 的常驻门禁）
 * ==============================================================================
 *
 * 要防的失效形状很具体：批次 E 把"随注销信号清本机"（E2）和"三端自助注销入口"（E3）
 * 做了，而**政策文本里没有任何一行会因此变红** —— 于是政策继续对用户说"这个动作今天
 * 还不存在"。那句话在被写下的当天是真的；它变成谎话的那一刻，全仓没有任何一层失败。
 *
 * 这与 `check:legal-tools` 拦的是同一类东西：**文档里那种"未列出的即视为未授权"的
 * 封闭句式，本身就是一个会悄悄烂掉的断言**（批次二 §10.4 第 3 条同一课）。
 *
 * ## 三条不让它变成装饰的设计
 *
 *   1. **扫的是构建产物**而不是源文件 —— 站点文案（`gen-site-copy`）与服务端快照
 *      （`gen-server-legal`）的消费者读的都是产物，判据必须和它们看到的一致
 *      （§7 第 79 条：改完不 build 不算数）。
 *   2. **版本变更表不计违规**。那一栏的职责就是把旧措辞引用出来（"从 X 改写成 Y"），
 *      照字面扫它必然自己抓自己 —— 命中数从 `naive` 到 `hits` 的差就是这条腿的工作量，
 *      两个数都打出来，少一个说明排除逻辑没生效或生效过头。
 *   3. **`--self-test` 造一次必然命中**：0 命中只有在探测器能命中的前提下才等于"干净"
 *      （§7 元规则二：一条永远通过的判据比没有判据更糟）。
 *
 * 词表**只登记已被具体工单否证的句子**，不是"所有限定句式"。加一条的成本 = 一次
 * "这句话因哪个工单失效"的登记 —— 防的是把政策当前的措辞写死成判据。
 *
 * 🔴 **2026-10-04 04:2x 现量：这条门禁今天就是红的，而且必须让它红着合流。**
 * 命中 3 条 = `privacy[zh-CN]`、`privacy[en]`、`third-parties[zh-CN]` 的"今天还不存在"。
 * 三份里前两份的 `version` 行与 `updatedDate` 行**在别人未提交的 diff 里**
 * （`privacy` hunk 在 362/591/889/1118/1136，`third-parties` 在 235/526/627/629），
 * 实质修改必须 bump 版本 ⇒ 要么踩别人的行，要么留下"改了正文不记版本"的更坏形状。
 * 所以本轮不动那两份文件，改的是自己名下的 `data-rights` 与 `minors`（见 ADR-0048 §12）。
 * **不要**为了让它 exit 0 而从词表里摘句子，也不要给这两份加豁免 ——
 * 那等于把"政策会悄悄变谎话"这个唯一会被观测到的信号源关掉。
 */

import { readFileSync } from 'node:fs';

import { LEGAL_DOCUMENTS } from '../packages/legal/dist/index.js';

/** 失效声明词表：`[句子, 否证它的工单]`。 */
const STALE = [
  ['界面上目前没有这个按钮', 'E3 注销入口落到三端'],
  ['界面上目前还没有这个按钮', 'E3 注销入口落到三端'],
  ['没有自助注销的入口', 'E3 注销入口落到三端'],
  ['今天还没有随注销清除本机数据的动作', 'E2 随注销信号清本机已落'],
  ['今天还不存在', 'E2 随注销信号清本机已落'],
  ['no such button in the interface', 'E3 注销入口落到三端'],
  ['no such per-device wipe exists today', 'E2 随注销信号清本机已落'],
  ['does not exist in the product today', 'E2 随注销信号清本机已落'],
  ['neither a self-service closure entry point', 'E3 已是自助表述'],
  ['a channel, not self-service', 'E3 已是自助表述'],
];

/** 版本变更表（中英两种表头）：那一栏引用旧措辞是它的职责，不算违规。 */
const CHANGELOG_HEADS = new Set([
  JSON.stringify(['版本', '日期', '变化']),
  JSON.stringify(['Version', 'Date', 'Change']),
]);

/** 两栏的**真键名**（`sections` 是 `{ 'zh-CN': [...], en: [...] }`，不是 `{zh, en}`）。 */
const LANGS = ['zh-CN', 'en'];

/**
 * 按语言逐栏拍平，并让每一栏都可单独断言。
 *
 * 🔴 这里原来写的是 `doc.sections.zh` —— 那个键**不存在**，`?? []` 把整栏中文
 * 悄悄换成空数组，于是"中文里还有两句谎话"在输出上长得和"中文干净"一模一样。
 * 现在逐栏断言非空（`perLang` 那一段），少任何一栏都直接判红。
 */
function docTextByLang(doc, skipChangelog = true) {
  const perLang = {};
  for (const lang of LANGS) {
    const out = [];
    const walk = (node) => {
      if (typeof node === 'string') {
        out.push(node);
        return;
      }
      if (Array.isArray(node)) {
        for (const child of node) walk(child);
        return;
      }
      if (node && typeof node === 'object') {
        if (skipChangelog && node.kind === 'table' && CHANGELOG_HEADS.has(JSON.stringify(node.head))) return;
        for (const child of Object.values(node)) walk(child);
      }
    };
    const sections = doc.sections?.[lang];
    if (!Array.isArray(sections)) {
      throw new Error(`${doc.id} 没有 sections['${lang}']（实际键：${Object.keys(doc.sections ?? {}).join(',')}）`);
    }
    walk(sections);
    perLang[lang] = out.join('\n');
  }
  return perLang;
}

const detect = (text) => STALE.filter(([needle]) => text.includes(needle));

/**
 * ── 第二条腿：政策关于**桌面壳本机销毁**的那句，方向必须跟着代码走 ──────────────
 *
 * 这条腿是 2026-10-04 05:1x 现量之后加的，起因不是"想加个检查"，是**已经漂了一次**：
 * `data-rights` 第五节 1.2 写的是"界面那份落在 WebView 存储里、销毁通道只接到壳的 SQLite"，
 * 而 `3b6d46df`（"壳内存储改真 SQLite"）把这件事**整个倒过来了** —— 壳现在托管存储，
 * 可读的那份写进壳的库文件，销毁通道接的是界面自己那个 realm。
 * 政策于是对用户说反了一句：**清掉的是界面那份，留在盘上的是壳那个库文件**。
 * 没有任何一层失败：`check:legal-copy` 只比生成物与真源，正文不在生成物里；
 * 结构对账只比中英块数。⇒ 这句话必须和**它能被代码否证的那两个事实**绑在一起。
 *
 * 三个状态都算，不把"当前是哪一个"写死（那是另一种漂）：
 *
 *   前提 A `shellHostsStorage`  ← `apps/web/src/lib/oplog.ts` 里有 shell 后端与端口探测
 *   前提 B `wipeReachesShellDb` ← 线协议的主人 `oplog-worker-bridge.ts` 里有没有 destroy 这一发
 *
 *   A ∧ ¬B ⇒ 政策必须写"壳的库文件还在盘上"，不许写反方向
 *   A ∧  B ⇒ 政策**不许**再写"还在盘上"（那句已经不再是边界，是谎话）
 *   ¬A     ⇒ 反向：政策必须写回"界面那份没接"，不许继续写"壳的库文件还在盘上"
 *
 * ⚠️ 两个前提都**读源文件**（不是 dist）：它们是产品代码事实，不住在法务包里。
 * 🔴 读不到 / 内容短到不像那个文件 ⇒ **响亮失败**，不按"前提不成立"处理 ——
 *    把"没读到"当成"没有"，这条腿就退化成一条永远通过的判据（§7 元规则二）。
 */
const CODE_FILES = {
  oplog: 'apps/web/src/lib/oplog.ts',
  wire: 'packages/storage/src/sqlite/oplog-worker-bridge.ts',
};

const readCode = (rel) => {
  const abs = new URL(`../${rel}`, import.meta.url);
  const text = readFileSync(abs, 'utf8');
  if (text.length < 500) {
    throw new Error(`${rel} 只读到 ${String(text.length)} 字符 —— 前提不可用，拒绝按"不成立"处理`);
  }
  return text;
};

/**
 * 只看**代码行**，注释剥掉。
 *
 * 🔴 不是洁癖：这一腿守的是一个对用户承诺的方向，而别人在注释里写一句
 *    "`destroy()` 今天没有转发"就会把前提翻成"已经接上了" —— 那时政策句子会被判成谎话，
 *    而真正的代码什么都没变。同一条理由见 E5 那条 spec 里的 `scriptCode()`。
 */
const codeOnly = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');

/**
 * 从两份代码文本**推出前提**（纯函数：`--self-test` 要能喂合成文本走四条臂，
 * 否则"锚点没了要抛"这一条一辈子只被真代码测过一次）。
 */
function computePremises(rawOplog, rawWire) {
  const oplog = codeOnly(rawOplog);
  const wire = codeOnly(rawWire);
  if (oplog.length < 500 || wire.length < 500) {
    throw new Error('代码文本短到不像那两个文件 —— 前提不可用，拒绝按"不成立"处理');
  }
  /**
   * 🔴 **锚点没了就抛错，不按"前提不成立"处理。**
   *
   * 这一腿的输入是别人的代码，而它的输出决定一句法律承诺的方向。
   * 形状变了（改名、换比较写法、后端词表换字面量）如果悄悄读成 `false`，
   * 门禁会去**要求反方向的句子** —— 那是把"探测失败"变成"政策被判成谎话"。
   * 抛错至少是对的：它让人来看这条腿，而不是让人来改正文。
   */
  if (!/resolveStorageBackend/.test(oplog)) {
    throw new Error(`${CODE_FILES.oplog} 里没有 resolveStorageBackend —— 后端分流的锚点换了，这条腿要按新形状重写`);
  }
  if (!/handleOpLogWorkerRequest|serveOpLogWorker/.test(wire)) {
    throw new Error(`${CODE_FILES.wire} 里没有桥的入口 —— 这条腿读的不是那个文件了，先确认主人`);
  }
  return {
    // 用正则而不是字面量 `=== 'shell'`：比较写法与空白会变，"有没有 shell 这一档 + 有没有探那个端口"才是事实本身。
    shellHostsStorage: /__heytaHostStoragePort/.test(oplog) && /['"]shell['"]/.test(oplog),
    wipeReachesShellDb: /destroy/.test(wire),
  };
}

const premises = () =>
  computePremises(readCode(CODE_FILES.oplog), readCode(CODE_FILES.wire));

/**
 * 两个方向的句子各给**一组**候选而不是一个字面：政策正文会被重写，
 * 但它重写后总得留下"哪一端留在盘上"这个信息 —— 拿不到的那条就是没写清。
 */
const DIRECTION = {
  shellFileStays: {
    'zh-CN': ['壳的那个库文件还在盘上', '壳自己那份 SQLite 库文件', '写进**壳的库文件**'],
    en: ['the shell’s own database file', 'database file stays on disk', 'the shell’s database file stays'],
  },
  interfaceCopyStays: {
    'zh-CN': ['界面那一份还在盘上', '没接进本机销毁通道'],
    en: ['the interface copy stays on disk', 'keeps its own readable copy inside the WebView'],
  },
};

const anyNeedle = (text, needles) => needles.some((n) => text.includes(n));

/**
 * 方向对账。**抽成纯函数**是为了让 `--self-test` 能在没有真代码的那个状态下
 * 把三个分支都走一遍 —— 否则这一腿一辈子只被测过一支。
 */
function checkDirection(byLang, p) {
  const problems = [];
  if (p.shellHostsStorage && !p.wipeReachesShellDb) {
    for (const lang of LANGS) {
      if (!anyNeedle(byLang[lang], DIRECTION.shellFileStays[lang])) {
        problems.push(`${lang} 栏没写出"托管之后留在盘上的是壳的库文件"这一端（代码事实：壳托管存储、线协议还没有 destroy 这一发）`);
      }
      if (anyNeedle(byLang[lang], DIRECTION.interfaceCopyStays[lang])) {
        problems.push(`${lang} 栏还在说"留在盘上的是界面那一份"，方向已被代码倒过来`);
      }
    }
  } else if (p.shellHostsStorage && p.wipeReachesShellDb) {
    for (const lang of LANGS) {
      if (anyNeedle(byLang[lang], DIRECTION.shellFileStays[lang])) {
        problems.push(`${lang} 栏还写着"壳的库文件还在盘上"，而线协议已经能带 destroy —— 这句现在是谎话`);
      }
    }
  } else {
    for (const lang of LANGS) {
      if (anyNeedle(byLang[lang], DIRECTION.shellFileStays[lang])) {
        problems.push(`${lang} 栏写着"壳的库文件还在盘上"，而代码里壳**不再**托管存储 —— 前提变了，这句要回写`);
      }
    }
  }
  return problems;
}

// —— 前提：九份文档；**每一份的每一个语言栏**都单独断言非空 ——
// 只断言总量的话，一栏空、另一栏翻倍也能过 —— 这条门禁的第一版就是这么漏掉整栏中文的。
if (LEGAL_DOCUMENTS.length !== 9) {
  console.error(`❌ 文档数 = ${String(LEGAL_DOCUMENTS.length)}，不是 9 —— 词表与文档清单的前提变了`);
  process.exit(1);
}
const texts = [];
for (const doc of LEGAL_DOCUMENTS) {
  const byLang = docTextByLang(doc);
  for (const lang of LANGS) {
    if (byLang[lang].length < 300) {
      console.error(`❌ ${doc.id} 的 ${lang} 栏只拍出 ${String(byLang[lang].length)} 字符 —— 这一栏没读到，0 命中不可信`);
      process.exit(1);
    }
    texts.push({ id: doc.id, lang, text: byLang[lang] });
  }
}
if (texts.length !== 18) {
  console.error(`❌ 拍到 ${String(texts.length)} 个（文档 × 语言）栏，期望 18 —— 遍历层坏了`);
  process.exit(1);
}
const totalChars = texts.reduce((n, t) => n + t.text.length, 0);

// —— 阳性对照：探测器必须命中，两条腿各一条 ——
const control = detect(`对照句：${STALE[0][0]} … ${STALE[6][0]}`);
if (control.length !== 2) {
  console.error(`❌ 阳性对照只命中 ${String(control.length)} / 2 —— 探测器本身坏了`);
  process.exit(1);
}

if (process.argv.includes('--self-test')) {
  // 走**同一个 docTextByLang**：注入对象必须按真形状（sections['zh-CN'] / sections.en）摆，
  // 否则自测在量另一条路径，那条路径坏了也不会报。
  const injected = docTextByLang({
    id: 'synthetic',
    sections: {
      'zh-CN': [{ kind: 'p', text: '这个动作今天还不存在' }],
      en: [{ kind: 'p', text: 'no such per-device wipe exists today' }],
    },
  });
  const perLang = [detect(injected['zh-CN']).length, detect(injected.en).length];
  console.log(`--self-test：合成两栏命中 ${String(perLang.join(' + '))}，对照 ${String(control.length)} / 2`);
  if (perLang.some((n) => n !== 1) || control.length !== 2) {
    console.error('❌ 注入违规没有被抓到 —— 这条门禁没有牙');
    process.exit(1);
  }

  /**
   * 方向那条腿的三个状态都要被测到。
   *
   * 🔴 它不读真代码：真代码只有**一个**状态，于是那一腿一辈子只会被走过一次，
   *    另外两支坏了也不会报。合成前提是为了让"这一腿能红"被证明，
   *    而不是被假设。每支都要求**该红的红、该绿的黑**，缺一支持续失败。
   */
  const SHELL_TEXT = {
    'zh-CN': '可读的那份数据写进**壳的库文件** —— 壳的那个库文件还在盘上',
    en: 'its readable copy is written into the shell’s own database file and the database file stays on disk',
  };
  const INTERFACE_TEXT = {
    'zh-CN': '界面自己那份可读数据落在 WebView 自己的存储里，界面那一份还在盘上',
    en: 'the shared interface keeps its own readable copy inside the WebView and the interface copy stays on disk',
  };
  const EMPTY_TEXT = { 'zh-CN': '这一节不谈桌面壳', en: 'this section does not discuss shells' };
  const arms = [
    // A ∧ ¬B：壳托管、销毁通道够不着 ⇒ 写壳那份留下的 = 绿；写反方向 = 红；什么都没写 = 红
    { name: 'A∧¬B 正确方向', p: { shellHostsStorage: true, wipeReachesShellDb: false }, text: SHELL_TEXT, wantRed: false },
    { name: 'A∧¬B 反方向', p: { shellHostsStorage: true, wipeReachesShellDb: false }, text: INTERFACE_TEXT, wantRed: true },
    { name: 'A∧¬B 什么都不写', p: { shellHostsStorage: true, wipeReachesShellDb: false }, text: EMPTY_TEXT, wantRed: true },
    // A ∧ B：销毁已经能够着 ⇒ 还写"还在盘上"就是谎话
    { name: 'A∧B 仍写盘上', p: { shellHostsStorage: true, wipeReachesShellDb: true }, text: SHELL_TEXT, wantRed: true },
    // ¬A：壳不再托管 ⇒ 还写"壳的库文件还在盘上"也是谎话
    { name: '¬A 仍写壳库', p: { shellHostsStorage: false, wipeReachesShellDb: false }, text: SHELL_TEXT, wantRed: true },
    { name: '¬A 正确方向', p: { shellHostsStorage: false, wipeReachesShellDb: false }, text: INTERFACE_TEXT, wantRed: false },
  ];
  for (const arm of arms) {
    const n = checkDirection(arm.text, arm.p).length;
    const red = n > 0;
    if (red !== arm.wantRed) {
      console.error(`❌ 方向腿的臂「${arm.name}」期望 ${arm.wantRed ? '红' : '绿'}，实得 ${red ? '红' : '绿'}`);
      process.exit(1);
    }
    console.log(`  臂 ${arm.name} → ${red ? '红' : '绿'}（如预期）`);
  }

  /**
   * 前提那两条读取也要有臂 —— 它们的输出决定上面六支走哪一支，
   * 而它们读的是**别人的代码**：形状一变，整条腿的方向就会翻。
   */
  const FILL = '\nconst filler = "'.padEnd(520, 'x');
  const OPLOG_OK = `export function resolveStorageBackend() { if (hostWindow()?.__heytaHostStoragePort !== undefined) return 'shell'; }${FILL}`;
  const WIRE_OK = `export async function handleOpLogWorkerRequest(store, req) { return store[req.method]; }${FILL}`;
  const pArms = [
    {
      name: '真形状 → 壳托管=真 / 销毁够得着=假',
      run: () => computePremises(OPLOG_OK, WIRE_OK),
      want: { shellHostsStorage: true, wipeReachesShellDb: false },
    },
    {
      name: '比较写法换了（=== "shell"）仍认得',
      run: () => computePremises(`function resolveStorageBackend(){ return hostWindow().__heytaHostStoragePort !== undefined; } // 'shell'\nif (resolveStorageBackend() === "shell") {}${FILL}`, WIRE_OK),
      want: { shellHostsStorage: true, wipeReachesShellDb: false },
    },
    {
      name: '注释里出现 destroy 不算接上',
      run: () => computePremises(OPLOG_OK, `// 说明：adapter.destroy() 今天没有转发\nexport function serveOpLogWorker(p){}${FILL}`),
      want: { shellHostsStorage: true, wipeReachesShellDb: false },
    },
    {
      name: '代码里真有 destroy 才算接上',
      run: () => computePremises(OPLOG_OK, `export function serveOpLogWorker(p){ p.on('destroy', () => {}); }${FILL}`),
      want: { shellHostsStorage: true, wipeReachesShellDb: true },
    },
  ];
  for (const arm of pArms) {
    const got = arm.run();
    if (got.shellHostsStorage !== arm.want.shellHostsStorage || got.wipeReachesShellDb !== arm.want.wipeReachesShellDb) {
      console.error(`❌ 前提臂「${arm.name}」实得 ${JSON.stringify(got)}`);
      process.exit(1);
    }
    console.log(`  臂 ${arm.name} → ${JSON.stringify(got)}（如预期）`);
  }
  const throwArms = [
    ['锚点 resolveStorageBackend 不见了要抛', () => computePremises(`const a = 1;${FILL}`, WIRE_OK)],
    ['桥的入口不见了要抛', () => computePremises(OPLOG_OK, `const b = 2;${FILL}`)],
    ['文件短到不像要抛', () => computePremises('tiny', 'tiny')],
  ];
  for (const [name, run] of throwArms) {
    let threw = false;
    try {
      run();
    } catch {
      threw = true;
    }
    if (!threw) {
      console.error(`❌ 前提臂「${name}」没有抛 —— 它会悄悄把前提读成 false，然后要求反方向的政策`);
      process.exit(1);
    }
    console.log(`  臂 ${name} → 抛（如预期）`);
  }
  console.log(`✅ 中英两栏各有一条注入违规被抓到；方向腿 ${String(arms.length)} 支 + 前提腿 ${String(pArms.length + throwArms.length)} 支全部按预期。`);
  process.exit(0);
}

// 变更表那条腿要量得出工作量：不排除时命中必须**更多**，相等说明排除没起作用。
let naive = 0;
for (const doc of LEGAL_DOCUMENTS) {
  const all = docTextByLang(doc, false);
  naive += LANGS.reduce((n, lang) => n + detect(all[lang]).length, 0);
}

const hits = [];
for (const { id, lang, text } of texts) {
  for (const [needle, why] of detect(text)) hits.push({ id, lang, needle, why });
}

/**
 * 方向对账只对**带方向的那一份**。
 *
 * `minors` 那一行是刻意不抄方向的（"🟡 逐端清到哪一层……以《个人权利行使与请求响应》
 * 第五节为准，本文件不抄第二份"）—— 那正是它不会跟着漂的原因。
 * 把这一腿套到它头上，等于奖励它抄第二份。
 */
const p = premises();
const directionDoc = LEGAL_DOCUMENTS.find((d) => d.id === 'data-rights');
if (!directionDoc) {
  console.error('❌ 法务清单里没有 data-rights —— 方向那条腿的前提变了');
  process.exit(1);
}
const directionProblems = checkDirection(docTextByLang(directionDoc), p);
console.log(
  `方向对账前提现量：壳托管存储 = ${String(p.shellHostsStorage)}（${CODE_FILES.oplog}）/ ` +
    `销毁够得着壳的库 = ${String(p.wipeReachesShellDb)}（${CODE_FILES.wire}）`,
);

console.log(
  `文档 9 份 × 中英 = 18 栏 / 拍到 ${String(totalChars)} 字符 / 变更表内引用 ${String(naive - hits.length)} 条（那是历史，不算违规）`,
);
if (naive === hits.length) {
  console.error('❌ 变更表内外命中数相等 —— 排除那条腿没起作用（要么没读到变更表，要么把历史引用当成了违规）');
  process.exit(1);
}
console.log(`版本指纹 ${LEGAL_DOCUMENTS.map((d) => `${d.id}@${d.version}`).join(';')}`);

if (hits.length > 0) {
  console.error(`\n❌ 政策里仍有被批次 E 否证掉的句子（${String(hits.length)} 条，每一句都在对用户说一件已经不真的事）：`);
  for (const h of hits) console.error(`  · ${h.id} [${h.lang}]  «${h.needle}»  ← ${h.why}`);
}
if (directionProblems.length > 0) {
  console.error(`\n❌ ${String(directionProblems.length)} 条方向对账不符（这一类不是"过期"，是**说反了**）：`);
  for (const problem of directionProblems) console.error(`  · data-rights ${problem}`);
}
if (hits.length > 0 || directionProblems.length > 0) process.exit(1);
console.log('✅ 九份文档（版本变更表以外，中英两栏都扫了）没有被批次 E 否证的句子，桌面壳那一档的方向与代码一致。');
