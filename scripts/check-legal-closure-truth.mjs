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
 * 词表**只登记已被具体工单否证的形状**，不是"所有限定句式"。加一条的成本 = 一次
 * "这句话因哪个工单失效"的登记 —— 防的是把政策当前的措辞写死成判据。
 *
 * 🔴 **2026-10-04 10:2x 现量更正：这句"必须让它红着合流"已经不成立，而且红着的数字本身是错的。**
 * 原记「命中 3 条 = `privacy[zh-CN]`、`privacy[en]`、`third-parties[zh-CN]`」——
 * 逐格人工普查的真数是 **8 格**：`privacy` 中英各 **两** 处（第 400 行那一行还多一句
 * `当前代码里没有任何…路径，界面上也还没有注销入口`，词表一个字都没对上）、
 * `third-parties` 中英各一处（**en 那处也被漏掉**，它写的是 `wiping on the closure signal
 * does not exist today`，而词表躺着的是 `no such per-device wipe exists today`）、
 * `personal-info-list` 中英各一处（弯引号 + `今天还没有“…这个动作”`）。
 * ⇒ 词表从"逐字"换成 `scripts/lib/legal-stale-families.mjs` 那套**字面 → 句式族 → 共现候选**
 *    三层，射程由句式而不是字面决定；同一份词表由门禁与 `tmp/family-check.mjs` 共用（单一所有者）。
 * 🔴 原记「那两份的 `version` 行在别人未提交的 diff 里 ⇒ 本轮不动那两份」**已被现量否证**
 *    （10:20 `git status --porcelain packages/legal/src/documents/` 为空，全仓法务文档干净）
 *    ⇒ 八格全部改写、三份文档版本各自 bump，没有加豁免、没有从词表摘句子。
 *    "改了正文不记版本"这个更坏的形状没有出现。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { LEGAL_DOCUMENTS } from '../packages/legal/dist/index.js';
import { BROAD, STALE, WAIVERS, clauses, detect } from './lib/legal-stale-families.mjs';
// 前提 B 与"逐壳点名"那条腿的**同一个**读数来源 —— 不在这里抄第二份壳清单。
import { shellErasureRows } from './check-shell-erasure-parity.mjs';

/**
 * 词表住在 `scripts/lib/legal-stale-families.mjs`（单一所有者）——
 * 门禁与 `tmp/family-check.mjs` 那套射程实测读同一份，防止"判据一份、验证装置另一份"。
 */

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

// `detect()` 来自 `scripts/lib/legal-stale-families.mjs`：字面 → 句式族 → 共现候选三层。

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
 *   前提 B `wipeReachesShellDb` ← **每一端桌面壳的驱动**都把容器删除递给了 JS 侧
 *
 *   A ∧ ¬B ⇒ 政策必须写"壳的库文件还在盘上"，不许写反方向
 *   A ∧  B ⇒ 政策**不许**再写"还在盘上"（那句已经不再是边界，是谎话）
 *   ¬A     ⇒ 反向：政策必须写回"界面那份没接"，不许继续写"壳的库文件还在盘上"
 *
 * 🔴 前提 B 的**来源在 2026-10-04 14:1x 换过一次**，而原来那个来源是错的：
 *   它读的是 `packages/storage/src/sqlite/oplog-worker-bridge.ts` 里有没有 `destroy`，
 *   可 `destroy` 是**适配器**动作，压根不进 `OpLogStore` 的词表（论证见计划 §10.15）——
 *   也就是说 B 永远读成 false，这条腿因此**永远要求政策写"还在盘上"**：
 *   哪一天所有壳都接上了，它会反过来把正确的句子判成谎话。
 *   现在 B 从树上推导（`check:shell-erasure-parity` 的那份逐壳读数，同一个所有者、不留抄件），
 *   它既能翻 true 也能翻 false，而"哪一端没接"由下面那条**逐壳点名**的腿管。
 *
 * ⚠️ 前提 A 读源文件（不是 dist）：它是产品代码事实，不住在法务包里。
 * 🔴 读不到 / 内容短到不像那个文件 ⇒ **响亮失败**，不按"前提不成立"处理 ——
 *    把"没读到"当成"没有"，这条腿就退化成一条永远通过的判据（§7 元规则二）。
 */
const CODE_FILES = {
  oplog: 'apps/web/src/lib/oplog.ts',
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
 * 从代码文本 + 逐壳读数**推出前提**（纯函数：`--self-test` 要能喂合成输入走四条臂，
 * 否则"锚点没了要抛"这一条一辈子只被真代码测过一次）。
 *
 * @param {string} rawOplog  `apps/web/src/lib/oplog.ts` 的原文
 * @param {{name: string, wal: boolean, remover: boolean}[]} shellRows  逐壳读数（来自 `check:shell-erasure-parity`）
 */
function computePremises(rawOplog, shellRows) {
  const oplog = codeOnly(rawOplog);
  if (oplog.length < 500) {
    throw new Error('代码文本短到不像那个文件 —— 前提不可用，拒绝按"不成立"处理');
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
  if (!Array.isArray(shellRows) || shellRows.length === 0) {
    throw new Error(
      '桌面壳的逐壳读数是空的 —— 扫不到壳不等于"每端都接上了"，也不等于"都没接"。' +
        '先确认 `check:shell-erasure-parity` 的注入名锚点与排除表还认得那些壳。',
    );
  }
  for (const row of shellRows) {
    if (typeof row?.name !== 'string' || typeof row?.remover !== 'boolean') {
      throw new Error(`逐壳读数里有一行形状不对（${JSON.stringify(row)}）—— 上游那条门禁的输出契约变了`);
    }
  }
  return {
    // 用正则而不是字面量 `=== 'shell'`：比较写法与空白会变，"有没有 shell 这一档 + 有没有探那个端口"才是事实本身。
    shellHostsStorage: /__heytaHostStoragePort/.test(oplog) && /['"]shell['"]/.test(oplog),
    // B 的现义：**每一端**桌面壳的驱动都把容器删除递给了 JS 侧。少一端就不算"够得着"。
    wipeReachesShellDb: shellRows.every((row) => row.remover),
    shells: shellRows,
  };
}

const premises = () =>
  computePremises(readCode(CODE_FILES.oplog), shellErasureRows(fileURLToPath(new URL('../apps', import.meta.url))));

/**
 * 两个方向的句子各给**一组**候选而不是一个字面：政策正文会被重写，
 * 但它重写后总得留下"哪一端留在盘上"这个信息 —— 拿不到的那条就是没写清。
 */
const DIRECTION = {
  shellFileStays: {
    'zh-CN': [
      '壳的那个库文件还在盘上',
      '壳自己那份 SQLite 库文件',
      '写进**壳的库文件**',
      // 🔴 2026-10-04 补：`check:public-copy-register` 不许面向用户的页面上出现 `SQLite`/`壳的库文件`
      //    这类贡献者语言，正文因此改成朴素措辞 —— 于是**这一腿差点把"方向写对了"判成"没写"**。
      //    两组都留着：朴素句与术语句都是方向正确的说法，被禁的是术语，不是这个事实。
      '桌面程序自己的那个库文件还在盘上',
      '写进**桌面程序自己的库文件**',
      // 🔴 2026-10-04 14:1x 补：政策改成"逐端说清"之后，Linux 那一端写的是"删不掉文件本体"。
      '删不掉文件本体',
    ],
    en: [
      'the shell’s own database file',
      'database file stays on disk',
      'the shell’s database file stays',
      'cannot remove the file itself',
    ],
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

/**
 * 逐壳点名那条腿：树上**每一端**桌面壳都必须在政策正文（变更表之外）被点名，中英两栏各一次。
 *
 * 🔴 这条腿是 2026-10-04 14:1x 现量之后加的，起因不是想加检查，是**我自己漏过一次**：
 * 计划 §10.11 那张"逐宿主取证"表只列了 Web / node-host / 移动 / macOS / Windows 五行，
 * 而 `apps/desktop-linux` 也是桌面壳（`permissions` 那份政策对外写着「桌面壳（Windows / macOS / Linux）」），
 * 它的驱动今天**没有** `removeDatabase` —— 政策那条"不承诺"清单因此点名了两个已经接上的壳、
 * 漏掉了唯一没接上的那个。分母凭记忆列，就会漏成这样。
 * 现在分母来自 `check:shell-erasure-parity` 的树上读数，加一个壳 = 政策必须多点一个名。
 */
const SHELL_DISPLAY = {
  'desktop-macos': 'macOS',
  'desktop-windows': 'Windows',
  'desktop-linux': 'Linux',
};

function checkShellNaming(byLang, shells) {
  const problems = [];
  for (const row of shells ?? []) {
    const display = SHELL_DISPLAY[row.name];
    if (display === undefined) {
      problems.push(
        `树上有一端桌面壳 ${row.name} 没登记对外名字 —— 它在政策里永远不会被点名，` +
          '先把它加进 SHELL_DISPLAY，再决定政策怎么写那一端',
      );
      continue;
    }
    for (const lang of LANGS) {
      if (!byLang[lang].includes(display)) {
        problems.push(
          `${lang} 栏没点名 ${row.name}（对外叫 ${display}）—— 逐宿主取证的分母来自树，不来自记忆`,
        );
      }
    }
  }
  for (const name of Object.keys(SHELL_DISPLAY)) {
    if (!shells?.some((row) => row.name === name)) {
      problems.push(`SHELL_DISPLAY 还登记着 ${name}，树上已经没有这端壳 —— 摘掉它，别替不存在的东西作证`);
    }
  }
  return problems;
}

/**
 * 第二层壳对账：**任何一份**文档里"某个壳 + 那句话还在说它没接上"的小句，点名的壳必须真的还没接上。
 *
 * 🔴 这条腿是 2026-10-04 现量 sweep 抓出来的：`minors` 第五节那一格抄了一句
 * "（macOS 与 Windows 桌面壳上还有一层今天没接进本机销毁通道）"，而那两个壳今天已经接上了、
 * 没接上的是 Linux。`checkShellNaming` 只对 data-rights 生效（其余八份刻意不抄第二份，
 * 就不该被要求点名每一端），于是**抄了名字的那句反而没人判**。
 * 现在改成：谁在"没接上"这句话里点了壳的名，谁就得对得上树上读数 —— 不点名不管，点了名就管。
 */
const SHELL_STAYS_MARKERS = {
  'zh-CN': ['没接进本机销毁', '删不掉文件本体', '删不掉容器', '没有把「删掉容器」'],
  en: ['not yet wired', 'cannot remove the file itself', 'cannot remove the container'],
};

function checkShellClaimsByDoc(docId, byLang, shells) {
  const problems = [];
  let judged = 0;
  const unwired = new Set(
    (shells ?? []).filter((row) => !row.remover).map((row) => SHELL_DISPLAY[row.name]).filter((n) => n !== undefined),
  );
  for (const lang of LANGS) {
    const markers = SHELL_STAYS_MARKERS[lang];
    if (!Array.isArray(markers)) throw new Error(`${lang} 没有"壳没接上"的标记词表`);
    // 🔴 切到"句"而不是"小句"：`clauses()` 只按中文标点切，英文那一栏因此一整段是一句 ——
    // 实测把 data-rights 英文栏第五节判成假红（"…cannot remove the file itself。✅ The macOS and
    // Windows … were wired up" 被并成一句）。按 `.`/`;` 再切一层，谁和标记同句才算谁被点名。
    const sentences = clauses(byLang[lang]).flatMap((clause) => clause.split(/[.;]/));
    for (const sentence of sentences) {
      if (!markers.some((m) => sentence.includes(m))) continue;
      const named = Object.values(SHELL_DISPLAY).filter((display) => sentence.includes(display));
      if (named.length === 0) continue;
      judged += 1;
      const wrong = named.filter((display) => !unwired.has(display));
      if (wrong.length > 0) {
        problems.push(
          `${docId} ${lang} 栏有一句说「${wrong.join('、')}」还没接上本机销毁通道，而树上读数里这些壳已经递出了 removeDatabase：` +
            `今天删不掉容器的是${[...unwired].join('、') || '（没有，每一端都接上了）'}`,
        );
      }
    }
  }
  return { problems, judged };
}

/**
 * 封闭计数对账：政策里「下面 N 项」/ "the N items below" 这类句子，N 必须等于**紧随其后那个集合的长度**。
 *
 * 🔴 这条腿是 2026-10-04 现量之后加的，起因是我自己刚刚差一点就把这份政策写成假话：
 * 给第五节补第二条"不承诺"（Linux 桌面壳）时，第八节那句"下面三项一变"和它的 ul 条数就分叉了。
 * 那种句子和批次二 §10.4 第 3 条讲的授权面是**同一个形状** —— 它替"句子之外的东西"数着数，
 * 而加一条的人不会想起回头改它。中英两栏各判一次（这一版在 legal 数字对账上漏过整栏英文，别再漏一次）。
 */
const ZH_NUMERALS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const EN_NUMERALS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const COUNT_SENTENCES = {
  'zh-CN': /下面([一二三四五六七八九十]|\d+)项/,
  en: /\bthe (one|two|three|four|five|six|seven|eight|nine|ten|\d+) items below\b/i,
};

function statedCount(lang, token) {
  if (/^\d+$/.test(token)) return Number(token);
  const table = lang === 'zh-CN' ? ZH_NUMERALS : EN_NUMERALS;
  return table[lang === 'zh-CN' ? token : token.toLowerCase()] ?? Number.NaN;
}

function checkEnumerations(doc) {
  const problems = [];
  let judged = 0;
  for (const lang of LANGS) {
    const sections = doc.sections?.[lang];
    if (!Array.isArray(sections)) {
      throw new Error(`${doc.id} 没有 sections['${lang}'] —— 计数对账读不到这一栏`);
    }
    for (const section of sections) {
      const blocks = section.blocks ?? [];
      for (let i = 0; i < blocks.length; i += 1) {
        const block = blocks[i];
        if (block.kind !== 'p' || typeof block.text !== 'string') continue;
        const match = COUNT_SENTENCES[lang].exec(block.text);
        if (match === null) continue;
        const next = blocks[i + 1];
        if (next?.kind !== 'ul' && next?.kind !== 'table') {
          throw new Error(
            `${doc.id} ${lang} 栏有一句「${match[0]}」，紧跟的却不是 ul/table（实际 ${String(next?.kind)}）` +
              ' —— 这一腿的形状假设漂了，继续跑就是在替不存在的东西作证',
          );
        }
        const stated = statedCount(lang, match[1]);
        if (Number.isNaN(stated)) {
          throw new Error(`${doc.id} ${lang} 栏的计数词「${match[1]}」不在词表里 —— 补词表，别让它静默跳过`);
        }
        const actual = next.kind === 'ul' ? next.items.length : next.rows.length;
        judged += 1;
        if (stated !== actual) {
          problems.push(
            `${lang} 栏写「${match[0]}」，而紧随其后的${next.kind === 'ul' ? '那份列表' : '那张表'}实际有 ${String(actual)} 条` +
              ` —— 加/删一条没回头改那个数字（或反过来）：这句现在替一份不存在的名录数着数`,
          );
        }
      }
    }
  }
  return { problems, judged };
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

// —— 阳性对照：三层各造一次必然命中。0 命中只有在探测器能命中的前提下才等于"干净"。 ——
const CONTROL_FIXTURES = [
  { layer: '字面', text: `对照句：${STALE[0][0]} … ${STALE[6][0]}`, wantViolations: 2, wantCandidates: 0 },
  { layer: '句式族 zh', text: '对照句：界面上也还没有注销入口。', wantViolations: 1, wantCandidates: 0 },
  {
    layer: '句式族 en',
    text: 'Control: there is currently no code path that wipes a device when its account is closed.',
    wantViolations: 1,
    wantCandidates: 0,
  },
  {
    layer: '共现候选',
    text: '对照句：这台设备上清除本机数据这件事目前还没有。',
    wantViolations: 0,
    wantCandidates: 1,
  },
];
for (const f of CONTROL_FIXTURES) {
  const got = detect(f.text);
  if (got.violations.length !== f.wantViolations || got.candidates.length !== f.wantCandidates) {
    console.error(
      `❌ 阳性对照「${f.layer}」命中 ${String(got.violations.length)} 违规 + ${String(got.candidates.length)} 候选，` +
        `要求 ${String(f.wantViolations)} + ${String(f.wantCandidates)} —— 探测器本身坏了`,
    );
    process.exit(1);
  }
}

/** 豁免表那条腿要能红：把 marker 摘掉，同一句必须变成"未判定的候选"。 */
const WAIVED_FIXTURE = {
  en: '⚠️ **Two things we do not promise today**: (1) a device that never comes back online keeps its readable local data — that copy is not removed until it syncs again',
  zh: '⚠️ **今天不承诺的有两处**：我们没有远程擦除未连接设备的能力，那台设备上的可读副本交还干净只能靠系统层面清除应用数据',
};
{
  for (const [lang, text] of Object.entries(WAIVED_FIXTURE)) {
    const withWaiver = detect(text);
    if (withWaiver.candidates.length !== 0 || withWaiver.violations.length !== 0) {
      console.error(`❌ 豁免失效（${lang}）：带 marker 的诚实边界句仍被报出来 —— 豁免表没接进探测器`);
      process.exit(1);
    }
  }
  // 🔴 marker 不许把"有几处"钉死：数量是政策自己的事，改数量不该让判据失明或误报。
  //   这一腿同时是两件事的读数：换了数字仍然豁免（正），摘掉词干立刻变候选（牙）。
  const renumbered = {
    en: WAIVED_FIXTURE.en.replace('Two things we do not promise today', 'Five things we do not promise today'),
    zh: WAIVED_FIXTURE.zh.replace('不承诺的有两处', '不承诺的有六处'),
  };
  for (const [lang, text] of Object.entries(renumbered)) {
    const got = detect(text);
    if (got.candidates.length !== 0 || got.violations.length !== 0) {
      console.error(`❌ 豁免认了字面数字（${lang}）：诚实边界从两处改成别的数字后，同一句被判成失效声明 —— marker 要留词干，不留计数`);
      process.exit(1);
    }
  }
  const tornWaiver = detect(WAIVED_FIXTURE.en.replace('we do not promise today', 'are facts about the product today'));
  if (tornWaiver.candidates.length === 0) {
    console.error('❌ 豁免是免费的：摘掉 marker 后同一句没有被判成候选 —— 这条豁免没有牙');
    process.exit(1);
  }
  const tornZh = detect(WAIVED_FIXTURE.zh.replace('不承诺的有', '要说的事有'));
  if (tornZh.candidates.length === 0) {
    console.error('❌ 中文那半的豁免是免费的：摘掉 marker 后同一句没有被判成候选');
    process.exit(1);
  }
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
  const perLang = [detect(injected['zh-CN']).violations.length, detect(injected.en).violations.length];
  console.log(`--self-test：合成两栏命中 ${String(perLang.join(' + '))}，对照 ${CONTROL_FIXTURES.map((f) => `${f.layer}=${String(f.wantViolations)}/${String(f.wantCandidates)}`).join(' ')}`);
  if (perLang.some((n) => n !== 1)) {
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
    'zh-CN': '可读的那份数据写进**桌面程序自己的库文件** —— 桌面程序自己的那个库文件还在盘上',
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
  const SHELLS_PARTIAL = [
    { name: 'desktop-macos', wal: true, remover: true },
    { name: 'desktop-windows', wal: true, remover: true },
    { name: 'desktop-linux', wal: true, remover: false },
  ];
  const SHELLS_ALL = SHELLS_PARTIAL.map((row) => ({ ...row, remover: true }));
  const pArms = [
    {
      name: '真形状（Linux 那端没接）→ 壳托管=真 / 每端都删得掉=假',
      run: () => computePremises(OPLOG_OK, SHELLS_PARTIAL),
      want: { shellHostsStorage: true, wipeReachesShellDb: false },
    },
    {
      name: '比较写法换了（=== "shell"）仍认得',
      run: () => computePremises(`function resolveStorageBackend(){ return hostWindow().__heytaHostStoragePort !== undefined; } // 'shell'\nif (resolveStorageBackend() === "shell") {}${FILL}`, SHELLS_PARTIAL),
      want: { shellHostsStorage: true, wipeReachesShellDb: false },
    },
    {
      name: '每一端都接上 → 销毁够得着=真（这时政策再写"还在盘上"就该红）',
      run: () => computePremises(OPLOG_OK, SHELLS_ALL),
      want: { shellHostsStorage: true, wipeReachesShellDb: true },
    },
    {
      name: '只剩两端在册（删掉的那端不该被记成"没接"）',
      run: () => computePremises(OPLOG_OK, SHELLS_ALL.slice(0, 2)),
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
    ['锚点 resolveStorageBackend 不见了要抛', () => computePremises(`const a = 1;${FILL}`, SHELLS_PARTIAL)],
    ['文件短到不像要抛', () => computePremises('tiny', SHELLS_PARTIAL)],
    ['逐壳读数为空要抛（扫不到壳 ≠ 每端都接上）', () => computePremises(OPLOG_OK, [])],
    ['逐壳读数形状不对要抛', () => computePremises(OPLOG_OK, [{ name: 'desktop-x' }])],
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
  /**
   * 逐壳点名那条腿的四支臂：全对 / 正文漏点名 / 树上多出一端 / 登记了一端而树上没有。
   * 这条腿存在的原因写在 `checkShellNaming` 上面 —— 分母凭记忆列过一次，就漏过一整端壳。
   */
  const NAMED_TEXT = {
    'zh-CN': '今天不承诺的有两处：① 再也不上线的设备；② Linux 桌面壳删不掉文件本体。macOS 与 Windows 的桌面壳已接上。',
    en: 'Two things we do not promise today: (1) an offline device; (2) the Linux desktop shell cannot remove the file itself. The macOS and Windows desktop shells are wired.',
  };
  const dropFromBoth = (needle) => ({
    'zh-CN': NAMED_TEXT['zh-CN'].split(needle).join(''),
    en: NAMED_TEXT.en.split(needle).join(''),
  });
  const nameArms = [
    { name: '三端都点名', text: NAMED_TEXT, shells: SHELLS_PARTIAL, wantRed: false },
    { name: '正文漏掉 Linux', text: dropFromBoth('Linux'), shells: SHELLS_PARTIAL, wantRed: true },
    {
      name: '树上多出一端没登记名字的壳',
      text: NAMED_TEXT,
      shells: [...SHELLS_PARTIAL, { name: 'desktop-harmony', wal: true, remover: false }],
      wantRed: true,
    },
    {
      name: '登记了一端而树上没有',
      text: NAMED_TEXT,
      shells: SHELLS_PARTIAL.filter((row) => row.name !== 'desktop-linux'),
      wantRed: true,
    },
  ];
  for (const arm of nameArms) {
    const red = checkShellNaming(arm.text, arm.shells).length > 0;
    if (red !== arm.wantRed) {
      console.error(`❌ 逐壳点名的臂「${arm.name}」期望 ${arm.wantRed ? '红' : '绿'}，实得 ${red ? '红' : '绿'}`);
      process.exit(1);
    }
    console.log(`  臂 ${arm.name} → ${red ? '红' : '绿'}（如预期）`);
  }

  /**
   * 封闭计数那条腿的臂：全对 / 中文栏少改一个数字 / 英文栏少改一个数字 / 集合是表格 / 形状漂了要抛。
   * 中英各一支是刻意的 —— 这一族的门禁历史上就漏判过整栏英文。
   */
  const collection = (kind, len) =>
    kind === 'table'
      ? { kind: 'table', head: ['事项', '说明'], rows: Array.from({ length: len }, (_, i) => [`第${String(i)}条`, 'x']) }
      : { kind: 'ul', items: Array.from({ length: len }, (_, i) => `第${String(i)}条`) };
  const enumDoc = (zh, en) => ({
    id: 'fixture',
    sections: {
      'zh-CN': [
        {
          blocks: [
            { kind: 'p', text: `本文件里每一处"目前不能"都带触发条件。下面${zh.stated}项一变，文本就跟着改。` },
            zh.nextKind === 'p' ? { kind: 'p', text: '紧跟其后的不是集合。' } : collection(zh.kind ?? 'ul', zh.len),
          ],
        },
      ],
      en: [
        {
          blocks: [
            { kind: 'p', text: `Every "not today" has a trigger. When the ${en.stated} items below change, the text changes.` },
            en.nextKind === 'p' ? { kind: 'p', text: 'not a collection' } : collection(en.kind ?? 'ul', en.len),
          ],
        },
      ],
    },
  });
  const enumArms = [
    {
      name: '中英两栏数字都对',
      doc: enumDoc({ stated: '三', len: 3 }, { stated: 'three', len: 3 }),
      wantRed: false,
      wantJudged: 2,
    },
    {
      name: '中文栏写三项而列表四条',
      doc: enumDoc({ stated: '三', len: 4 }, { stated: 'three', len: 3 }),
      wantLang: 'zh-CN',
    },
    {
      name: '英文栏写 three 而列表四条（中文栏是对的）',
      doc: enumDoc({ stated: '三', len: 3 }, { stated: 'three', len: 4 }),
      wantLang: 'en',
    },
    {
      name: '集合是表格时也要对账（英文栏写 two 而表三行）',
      doc: enumDoc({ stated: '三', len: 3, kind: 'table' }, { stated: 'two', len: 3, kind: 'table' }),
      wantLang: 'en',
    },
  ];
  for (const arm of enumArms) {
    const { problems, judged } = checkEnumerations(arm.doc);
    if (judged !== (arm.wantJudged ?? 2)) {
      console.error(`❌ 计数臂「${arm.name}」拍到 ${String(judged)} 对，期望 2 —— 有一栏根本没走到断言`);
      process.exit(1);
    }
    if (arm.wantRed === false && problems.length !== 0) {
      console.error(`❌ 计数臂「${arm.name}」期望绿，实得 ${String(problems.length)} 条：${problems.join(' / ')}`);
      process.exit(1);
    }
    if (arm.wantLang !== undefined) {
      if (problems.length !== 1) {
        console.error(`❌ 计数臂「${arm.name}」期望恰好 1 条，实得 ${String(problems.length)} 条`);
        process.exit(1);
      }
      if (!problems[0].includes(arm.wantLang)) {
        console.error(`❌ 计数臂「${arm.name}」的红没落在 ${arm.wantLang} 栏上：${problems[0]}`);
        process.exit(1);
      }
    }
    console.log(`  臂 ${arm.name} → ${problems.length === 0 ? '绿' : `红（${problems[0].slice(0, 12)}…）`}（如预期）`);
  }
  let enumThrew = false;
  try {
    checkEnumerations(enumDoc({ stated: '三', len: 3, nextKind: 'p' }, { stated: 'three', len: 3 }));
  } catch {
    enumThrew = true;
  }
  if (!enumThrew) {
    console.error('❌ 计数臂「紧跟的不是集合」没有抛 —— 形状漂了它会一声不响地判 0 对');
    process.exit(1);
  }
  console.log('  臂 紧跟的不是集合 → 抛（如预期）');

  /**
   * "谁点名谁对账"那条腿的臂：点名的壳对 / 点错成已经接上的那两端 / 一句没点名（该跳过）/ 英文栏同样有牙。
   * 造的红就是 2026-10-04 在 `minors` 里真抄过的那一句。
   */
  const shellClaimArms = [
    {
      name: '点名 Linux（树上确实只有它没接上）',
      text: {
        'zh-CN': '🟡 Linux 桌面壳上那条本机销毁通道今天删不掉文件本体。',
        en: 'Nothing about shells here.',
      },
      wantRed: false,
      wantJudged: 1,
    },
    {
      name: '点名 macOS 与 Windows 说它们没接上（minors 真抄过的那句）',
      text: {
        'zh-CN': '🟡 macOS 与 Windows 桌面壳上还有一层今天没接进本机销毁通道。',
        en: 'Nothing about shells here.',
      },
      wantRed: true,
      wantJudged: 1,
    },
    {
      name: '说"删不掉文件本体"但不点任何壳的名（这条腿不该管）',
      text: {
        'zh-CN': '那条本机销毁通道今天删不掉文件本体。',
        en: 'The local destruction path cannot remove the file itself.',
      },
      wantRed: false,
      wantJudged: 0,
    },
    {
      name: '英文栏点名 macOS 说它 not yet wired',
      text: {
        'zh-CN': '不写壳。',
        en: 'On the macOS desktop shell the path is not yet wired into local destruction.',
      },
      wantRed: true,
      wantJudged: 1,
    },
    {
      // 这一支就是 2026-10-04 把整段英文并成一句时误判的那句 —— 切到"句"才算点名。
      name: '标记句只说 Linux，下一句才提 macOS/Windows 已接上',
      text: {
        'zh-CN': '不写壳。',
        en: 'On the Linux desktop shell the path cannot remove the file itself. The macOS and Windows desktop shells were wired up on 2026-10-04.',
      },
      wantRed: false,
      wantJudged: 1,
    },
  ];
  for (const arm of shellClaimArms) {
    const { problems, judged } = checkShellClaimsByDoc('fixture', arm.text, SHELLS_PARTIAL);
    if (judged !== arm.wantJudged) {
      console.error(`❌ 点名句臂「${arm.name}」判了 ${String(judged)} 句，期望 ${String(arm.wantJudged)}`);
      process.exit(1);
    }
    if ((problems.length > 0) !== arm.wantRed) {
      console.error(
        `❌ 点名句臂「${arm.name}」期望 ${arm.wantRed ? '红' : '绿'}，实得 ${problems.length === 0 ? '绿' : `红：${problems[0]}`}`,
      );
      process.exit(1);
    }
    console.log(`  臂 ${arm.name} → ${problems.length === 0 ? '绿' : '红'}（判 ${String(judged)} 句，如预期）`);
  }

  console.log(
    `✅ 中英两栏各有一条注入违规被抓到；方向腿 ${String(arms.length)} 支 + 前提腿 ${String(
      pArms.length + throwArms.length,
    )} 支 + 逐壳点名 ${String(nameArms.length)} 支 + 封闭计数 ${String(enumArms.length + 1)} 支 + 点名句 ${String(
      shellClaimArms.length,
    )} 支全部按预期。`,
  );
  process.exit(0);
}

// 变更表那条腿要量得出工作量：不排除时命中必须**更多**，相等说明排除没起作用。
// 计的是"违规 + 候选"两层 —— 只数违规的话，历史引用如果被候选层抓住就不算进工作量。
let naive = 0;
for (const doc of LEGAL_DOCUMENTS) {
  const all = docTextByLang(doc, false);
  naive += LANGS.reduce((n, lang) => {
    const got = detect(all[lang]);
    return n + got.violations.length + got.candidates.length;
  }, 0);
}

const hits = [];
const candidates = [];
for (const { id, lang, text } of texts) {
  const got = detect(text);
  for (const [needle, why] of got.violations) hits.push({ id, lang, needle, why });
  for (const [needle, why] of got.candidates) candidates.push({ id, lang, needle, why });
}

/**
 * 豁免表不许长草：每一条都得**承重** —— 存在一条含该 marker 的小句，
 * 若把它从豁免表里拿掉就会成为候选。没有这一腿，"豁免生效"与"豁免早已够不着东西"
 * 在输出上长得一样，而后者会一直红着被人整行删掉。
 */
const waiverIsLoadBearing = (marker) =>
  texts.some(({ text }) => clauses(text).some((c) => c.includes(marker) && (BROAD.zh(c) || BROAD.en(c))));
const danglingWaivers = WAIVERS.filter(([marker]) => !waiverIsLoadBearing(marker));

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
const directionText = docTextByLang(directionDoc);
const directionProblems = [
  ...checkDirection(directionText, p),
  ...checkShellNaming(directionText, p.shells),
];
const enumReadings = LEGAL_DOCUMENTS.map((doc) => ({ id: doc.id, ...checkEnumerations(doc) }));
const shellClaimReadings = LEGAL_DOCUMENTS.map((doc) => ({
  id: doc.id,
  ...checkShellClaimsByDoc(doc.id, docTextByLang(doc), p.shells),
}));
const shellClaimsJudged = shellClaimReadings.reduce((n, r) => n + r.judged, 0);
const shellClaimProblems = shellClaimReadings.flatMap((r) => r.problems);
if (shellClaimsJudged === 0) {
  console.error(
    '❌ 九份文档里没有一句"某个壳 + 还没接上本机销毁通道"的小句被拍到 —— ' +
      '要么政策不再点名任何壳（那这条腿该摘），要么标记词表漂了（那它在替不存在的句子作证）',
  );
  process.exit(1);
}
const enumPairs = enumReadings.reduce((n, r) => n + r.judged, 0);
const enumProblems = enumReadings.flatMap((r) => r.problems.map((problem) => `${r.id} ${problem}`));
if (enumPairs === 0) {
  console.error(
    '❌ 一句「下面 N 项」/ "the N items below" 都没拍到 —— 计数对账这一趟没判过任何东西：' +
      '要么政策把那种句子重写掉了（那这条腿该摘），要么词形漂了（那它在替不存在的句子作证）',
  );
  process.exit(1);
}
console.log(
  `方向对账前提现量：壳托管存储 = ${String(p.shellHostsStorage)}（${CODE_FILES.oplog}）/ ` +
    `每一端壳都删得掉容器 = ${String(p.wipeReachesShellDb)}（逐壳：${p.shells
      .map((row) => `${row.name}${row.remover ? '=Y' : '=N'}`)
      .join(' ')}）`,
);

console.log(
  `文档 9 份 × 中英 = 18 栏 / 拍到 ${String(totalChars)} 字符 / 变更表内引用 ${String(naive - hits.length - candidates.length)} 条（那是历史，不算违规）/ 未判定候选 ${String(candidates.length)} 条 / 豁免 ${String(WAIVERS.length)} 条（承重 ${String(WAIVERS.length - danglingWaivers.length)}）/ 封闭计数 ${String(enumPairs)} 对（不符 ${String(enumProblems.length)}）/ 逐壳点名句 ${String(shellClaimsJudged)} 句（不符 ${String(shellClaimProblems.length)}）`,
);
if (naive === hits.length + candidates.length) {
  console.error('❌ 变更表内外命中数相等 —— 排除那条腿没起作用（要么没读到变更表，要么把历史引用当成了违规）');
  process.exit(1);
}
console.log(`版本指纹 ${LEGAL_DOCUMENTS.map((d) => `${d.id}@${d.version}`).join(';')}`);

if (hits.length > 0) {
  console.error(`\n❌ 政策里仍有被批次 E 否证掉的句子（${String(hits.length)} 条，每一句都在对用户说一件已经不真的事）：`);
  for (const h of hits) console.error(`  · ${h.id} [${h.lang}]  «${h.needle}»  ← ${h.why}`);
}
if (candidates.length > 0) {
  console.error(
    `\n❌ ${String(candidates.length)} 条**未判定的共现候选**（句式族没抓住、豁免表里也没有它 —— 要么它是一句该改写的失效声明，要么它得进豁免表并写明理由）：`,
  );
  for (const c of candidates) console.error(`  · ${c.id} [${c.lang}]  «${c.needle}»  ← ${c.why}`);
}
if (danglingWaivers.length > 0) {
  console.error(`\n❌ ${String(danglingWaivers.length)} 条豁免不承重（正文里已经没有含该 marker、且会被共现层抓住的小句）：`);
  for (const [marker, why] of danglingWaivers) console.error(`  · «${marker}»  ← ${why}`);
}
if (directionProblems.length > 0) {
  console.error(`\n❌ ${String(directionProblems.length)} 条方向对账不符（这一类不是"过期"，是**说反了**）：`);
  for (const problem of directionProblems) console.error(`  · data-rights ${problem}`);
}
if (enumProblems.length > 0) {
  console.error(`\n❌ ${String(enumProblems.length)} 条封闭计数与它数的那个集合不符（那种句子替一份名录数着数，名录变了它不变就是在说谎）：`);
  for (const problem of enumProblems) console.error(`  · ${problem}`);
}
if (shellClaimProblems.length > 0) {
  console.error(`\n❌ ${String(shellClaimProblems.length)} 句"某个壳还没接上"点名点错了（树上读数来自 check:shell-erasure-parity）：`);
  for (const problem of shellClaimProblems) console.error(`  · ${problem}`);
}
if (
  hits.length > 0 ||
  candidates.length > 0 ||
  danglingWaivers.length > 0 ||
  directionProblems.length > 0 ||
  enumProblems.length > 0 ||
  shellClaimProblems.length > 0
)
  process.exit(1);
console.log(
  '✅ 九份文档（版本变更表以外，中英两栏都扫了）没有被批次 E 否证的句子，也没有未判定的共现候选；豁免表条条承重，桌面壳那一档的方向与代码一致，每一句"下面 N 项"都对得上它数的那个集合。',
);
