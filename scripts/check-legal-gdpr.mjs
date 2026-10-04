#!/usr/bin/env node
/**
 * GDPR 口径的常驻门禁（批次 E / 工单 E6）
 * ======================================
 *
 * 这条门禁存在的意义不是"文档里提没提 GDPR"，而是**逐条对到代码事实，并把对不上的
 * 部分写在同一行里**。它最可能烂成的样子不是写错，而是慢慢写得比实际好 —— 有人补一行
 * "我们已任命数据保护专员"，或者把某一行的"对不上的部分"删掉让表格看起来干净。
 * 三类失败各有判据：
 *
 *   1. **条文集合两侧一致，且等于登记清单**。中文多对 27 条、英文漏 20 条，
 *      形状镜像（`structure.spec.ts`）抓不住 —— 它比的是块序与单元格数，不看列内容。
 *   2. **每一行"对不上的部分"那一格不许为空，且必须含否定词**。一行全✓就是虚假陈述的形状。
 *   3. **禁止句**：转移机制那一层今天既没有代码也没有文档支撑，`ai-and-transfer.ts` 文件头
 *      已写明既不写"已完成评估/标准合同/认证"也不写"完全不需要手续"。
 *      这一层按**句子**判定，含否定的句子跳过 —— 不是为了让门禁变松，而是因为本节**要求**
 *      存在的缺口句（"没有标准合同条款、没有充分性决定"）和声称形态共享子串。
 *      代价是词表必须写成声称形状而不是关键字，且**反向腿**（注缺口句不许报）与正向腿同批跑：
 *      只测正向腿时，"把门禁调宽到什么都不放过"也算通过。
 *
 * ## 覆盖面：九份文档是一份**封闭集合**，不是"想到哪份写哪份"
 *
 * `FULL_TABLE` 那份（`data-rights`）持有逐条对照表；`POINTERS` 那几份各自写自己领域的
 * GDPR 判据，并**不许复制那张表** —— 判据是"它的条文集合不许等于登记清单"，
 * 因为相等就意味着抄了第二份，而同一对抄件历史上一定漂（本仓库已为此写过门禁）。
 * `BLOCKED` 那三份今天没有 GDPR 节，逐份写明为什么，并且有一条**反查**：
 * 哪一份真的长出了节，它还留在 `BLOCKED` 里就判红 —— 白名单只会过期，不会自己缩短。
 * 新增文档而没在这里登记归属同样判红。
 *
 * ## 变异怎么做，以及为什么不是原地改文件
 *
 * `--fixture <file.json>` 让同一套检查跑在**喂进去的文档**上。变异臂因此在内存里造出
 * 损坏的文档再落一份临时 JSON，不必去动 `packages/legal/src` 或它的 `dist` ——
 * 那是全仓共享的构建产物，动它一次就有几十秒让并行会话读到变异体（§7 那一族事故）。
 * `--self-test` 用它跑变异臂（每条都必须判红）、反向腿（每条都必须不判红）与一条未变异对照。
 * 条数不写在这里 —— 写在这里就会漂；现量看它自己打印的那一行。
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

import { LEGAL_DOCUMENTS } from '../packages/legal/dist/index.js';

/** 持有逐条对照表的那一份。 */
const FULL_TABLE = { docId: 'data-rights', sectionId: 's9' };

/** 各写自己那一档 GDPR 判据的文档 → 它的小节 id。 */
const POINTERS = {
  'ai-and-transfer': 's10',
  'subscription-refund': 's10',
  minors: 's9',
  terms: 's13',
  'personal-info-list': 's9',
};

/**
 * 今天还**不该**有 GDPR 节的三份，逐份写明为什么（这一栏本身就是断言，要现量复核）。
 * 三份的落点都正在被并行会话整片重写：`git status --porcelain packages/legal/src/documents/`
 * 于 2026-10-04 04:0x 现量，那三份逐个是 `M`（同一趟还量到另外六份也是 `M`，那六份是我这一轮改的）。
 * 闭合条件：那三份的未提交 diff 清空之后，把路径从这里删掉、在 `POINTERS` 里补一节。
 */
const BLOCKED = {
  privacy: '该文件正被并行会话整片重写（隐私政策那节的留存与出境表述是它的在途内容），改它等于造一次没人能干净解的冲突',
  'third-parties': '同上；而且第三方那节的逐项披露要跟着工具目录走，目录此刻还在动',
  permissions: '同上；W7 成品图导出的权限清单还没落地，此刻写"第 5 条相称性"会写进一个将要变化的集合',
};

/** 登记条文号（顺序无关，按集合比）。加一条要同时改文本与这里。 */
const EXPECTED_ARTICLES = [13, 14, 15, 16, 17, 18, 20, 21, 22, 32, 33];

/**
 * 只认"已经完成/已具备"这类**声称形态**。词表本身是开放的（谁也没法穷举句式），
 * 所以真正的牙在下一层：判定按**句子**做，含否定的句子跳过。
 * 这一层不是为了让门禁变松 —— 它是因为第一版整段 `test()` 会咬到自己写的缺口句
 * （"这一格记录的是一个尚未闭合的缺口"里就没有声称），而缺口句正是本节要求存在的行。
 */
const FORBIDDEN = [
  /已经?完成[^。]{0,12}(标准合同|充分性|转移影响评估|出境评估)/,
  /已经?取得[^。]{0,12}(充分性决定|标准合同)/,
  /we have (obtained|filed|completed|executed)[^.]*(standard contractual|adequacy|transfer impact)/i,
  /standard contractual clauses are in place/i,
  /an adequacy decision covers us/i,
  /(已|已经)(任命|设立|指定)[^。]{0,8}(数据保护专员|欧盟代表|DPO)/,
  // 🔴 `an?` 不是排版洁癖：写成 `a` 时 "We have appointed **an** EU representative" 原样穿过，
  // 变异臂就是用它测出这个洞的（英文不定冠词有 a/an 两种，声称形态只认其中一种等于没认）。
  /we have (appointed|designated) an? (eu representative|data protection officer|dpo)/i,
  /an? (eu representative|data protection officer|dpo) (has|have) been (appointed|designated|set up)/i,
];

/** 否定形状：中英混在一份文档里，所以两层都查。含否定的句子是"缺口陈述"，不是声称。 */
const NEGATION = /[不没未非]|无法|未能|\b(not|no|never|without|yet to)\b/i;

/** 按句子切：中文句末标点、分号、换行，以及英文句号（后面跟空白或结尾才算句末）。 */
const sentencesOf = (text) =>
  text
    .split(/[。！？!?；;\n]+|(?<=\S)\.(?=\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** 逐句找声称形态；返回命中的 `/{pattern}/{句子}` 描述数组。 */
const claimsIn = (text) => {
  const hits = [];
  for (const s of sentencesOf(text)) {
    if (NEGATION.test(s)) continue;
    for (const re of FORBIDDEN) if (re.test(s)) hits.push(`/${re.source}/ ← "${s}"`);
  }
  return hits;
};

/** "对不上的部分"那一格必须含的否定形状。 */
const GAP_MARK = { 'zh-CN': /不|没|无法|未能/, en: /\b(not|no|cannot|never|without)\b/i };

const LANGS = ['zh-CN', 'en'];

/** 从一行的第一格抠出条文号。 */
const articlesOf = (cell) => (String(cell).match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b);

/**
 * 定位 GDPR 那一节：**按小节 id 找**，不按"文本里有没有 GDPR 字样"找。
 * 第一版按字样找，报出 `zh-CN 栏的 GDPR 节数量 = 2` —— 版本变更表里那一行的职责
 * 就是说明"新增了 GDPR 一节"，它当然含这个词。台账冒充正文会把门禁引到一张没有对照表的节上。
 */
function gdprSection(doc, lang, sectionId) {
  const found = (doc.sections?.[lang] ?? []).filter((s) => s.id === sectionId);
  if (found.length !== 1 || !String(found[0].title).includes('GDPR')) return null;
  return found[0];
}

const flatten = (node, out = []) => {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) for (const child of node) flatten(child, out);
  else if (node && typeof node === 'object') for (const child of Object.values(node)) flatten(child, out);
  return out;
};

const tableOf = (section) => (section.blocks ?? []).find((b) => b.kind === 'table') ?? null;

const articleSetOf = (table) => {
  const list = [];
  for (const row of table.rows) for (const n of articlesOf(row[0])) if (!list.includes(n)) list.push(n);
  return list.sort((a, b) => a - b);
};

/** 返回失败原因数组（空 = 通过）。检查逻辑与输出分离，变异臂才能同一条路径上跑。 */
export function checkDocs(docs) {
  const fails = [];
  const byId = new Map(docs.map((d) => [d.id, d]));

  // —— 0. 封闭集合：每份文档都要有归属，白名单不许过期 ——
  for (const doc of docs) {
    const covered =
      doc.id === FULL_TABLE.docId ||
      Object.hasOwn(POINTERS, doc.id) ||
      Object.hasOwn(BLOCKED, doc.id);
    if (!covered) {
      fails.push(
        `${doc.id} 有 GDPR 内容却没有登记归属（加进 POINTERS 或 BLOCKED，并写明理由）`,
      );
    }
    if (Object.hasOwn(BLOCKED, doc.id)) {
      const hasIt = LANGS.some((lang) => (doc.sections?.[lang] ?? []).some((s) => String(s.title).includes('GDPR')));
      if (hasIt) fails.push(`${doc.id} 已经长出了 GDPR 节，却还挂在 BLOCKED 白名单里 —— 白名单必须缩短`);
    }
    if (Object.hasOwn(POINTERS, doc.id) && !byId.has(doc.id)) {
      fails.push(`POINTERS 登记了 ${doc.id}，但文档清单里没有它`);
    }
  }

  const fullDoc = byId.get(FULL_TABLE.docId);
  if (!fullDoc) return [`${FULL_TABLE.docId} 不在文档清单里 —— 门禁的落点没了`];

  /** 逐栏取某文档的 GDPR 对照表；不合格就往 `fails` 里写原因并返回 null。 */
  const tablesFor = (doc, sectionId, label) => {
    const out = {};
    for (const lang of LANGS) {
      const section = gdprSection(doc, lang, sectionId);
      if (!section) {
        fails.push(`${label}：${lang} 栏里 id='${sectionId}' 且标题含 GDPR 的小节不存在（或标题被改了）`);
        return null;
      }
      const table = tableOf(section);
      if (!table) {
        fails.push(`${label}：${lang} 栏的 GDPR 节里没有对照表`);
        return null;
      }
      if (table.head.length !== 4) {
        fails.push(`${label}：${lang} 栏的表头是 ${String(table.head.length)} 列，期望 4`);
        return null;
      }
      out[lang] = table;
    }
    return out;
  };

  // —— 1. 逐行"对不上的部分" + 禁止句（两份角色共用） ——
  const audit = (doc, sectionId, label) => {
    const tables = tablesFor(doc, sectionId, label);
    if (!tables) return null;
    for (const lang of LANGS) {
      tables[lang].rows.forEach((row, i) => {
        const gap = String(row[row.length - 1] ?? '').trim();
        if (gap.length === 0) {
          fails.push(`${label} ${lang} 栏第 ${String(i + 1)} 行的"对不上的部分"是空的（一行全✓就是虚假陈述）`);
        } else if (!GAP_MARK[lang].test(gap)) {
          fails.push(
            `${label} ${lang} 栏第 ${String(i + 1)} 行那一格没有任何否定词，读起来像"这一条已完全满足"`,
          );
        }
      });
    }
    const text = [...flatten(gdprSection(doc, 'zh-CN', sectionId)), ...flatten(gdprSection(doc, 'en', sectionId))].join('\n');
    if (text.length < 800) fails.push(`${label}：只拍出 ${String(text.length)} 字符 —— 遍历层坏了，0 命中不可信`);
    for (const hit of claimsIn(text)) fails.push(`${label}：出现越界声称 —— ${hit}`);
    return tables;
  };

  // —— 2. 那张主表：条文集合逐栏等于登记清单，两栏彼此一致，行数一致 ——
  const fullTables = audit(fullDoc, FULL_TABLE.sectionId, `主表(${FULL_TABLE.docId})`);
  if (fullTables) {
    const arts = {};
    for (const lang of LANGS) {
      arts[lang] = articleSetOf(fullTables[lang]);
      if (String(arts[lang]) !== String([...EXPECTED_ARTICLES].sort((a, b) => a - b))) {
        fails.push(
          `主表 ${lang} 栏条文集合 = ${arts[lang].join(',')}，登记清单 = ${EXPECTED_ARTICLES.join(',')}（加条文要同时改两处）`,
        );
      }
    }
    if (String(arts['zh-CN']) !== String(arts.en)) fails.push('主表中英两栏的条文集合不一致');
    if (fullTables['zh-CN'].rows.length !== fullTables.en.rows.length) {
      fails.push(
        `主表行数不一致：中文 ${String(fullTables['zh-CN'].rows.length)} / 英文 ${String(fullTables.en.rows.length)}`,
      );
    }

    // —— 3. 其余各份不许把主表抄第二遍 ——
    for (const [docId, sectionId] of Object.entries(POINTERS)) {
      const doc = byId.get(docId);
      if (!doc) continue;
      const tables = audit(doc, sectionId, `${docId}`);
      if (!tables) continue;
      const set = articleSetOf(tables['zh-CN']);
      if (String(set) === String([...EXPECTED_ARTICLES].sort((a, b) => a - b))) {
        fails.push(`${docId} 的条文集合与主表登记清单逐字相同 —— 那是抄了第二份，两份一定会漂`);
      }
      const zh = gdprSection(doc, 'zh-CN', sectionId);
      const en = gdprSection(doc, 'en', sectionId);
      for (const [lang, section] of [['zh-CN', zh], ['en', en]]) {
        if (!(section.blocks ?? []).some((b) => b.kind === 'docRef')) {
          fails.push(`${docId} 的 ${lang} 栏那一节没有指向其它文档的引用，读者无法跳到主表`);
        }
      }
    }
  }

  return fails;
}

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  // 两条腿：声称句必须每条被抓；**带否定的缺口句必须不被抓**（门禁咬自己那一族的防线）。
  const claims = [
    '我们已经完成数据出境安全评估并签署标准合同条款。',
    'We have executed standard contractual clauses with every processor.',
    '已完成备案充分性决定。',
    'We have appointed a data protection officer for the union.',
    '我们已设立欧盟代表处。',
    'An EU representative has been designated for heyta.',
  ];
  const gaps = [
    '我们没有指定欧盟代表，也没有欧盟境内的送达地址。',
    'No EU representative has been appointed and we do not hold an adequacy decision.',
    '这一格记录的是一个尚未闭合的缺口，不是既成事实。',
    '我们不声称已有任何转移机制（标准合同条款、充分性决定或转移影响评估）。',
  ];
  const caught = claims.map((s) => claimsIn(s).length > 0);
  const falsePositives = gaps.filter((s) => claimsIn(s).length > 0);
  // 用到几个不同模式 = 词表里真正有贡献的条目数（写成 0 会由下面那条 `< 2` 立刻抓到 ——
  // 第一版这里手滑写成 `new Set(...).size).size`，报出"用到 0 个模式"，正是那条判据咬住的）
  const patternCount = FORBIDDEN.filter((re) =>
    claims.some((s) => sentencesOf(s).some((x) => !NEGATION.test(x) && re.test(x))),
  ).length;
  console.log(
    `--self-test 禁止句：${String(claims.length)} 条声称抓到 ${String(caught.filter(Boolean).length)} 条，用到 ${String(patternCount)} 个不同模式；${String(gaps.length)} 条缺口句误判 ${String(falsePositives.length)} 条`,
  );
  if (caught.some((c) => !c) || patternCount < 2) {
    console.error(`❌ 有声称没被抓到（${JSON.stringify(caught)}），或词表实际只有一个模式 —— 这条没有牙`);
    process.exit(1);
  }
  if (falsePositives.length > 0) {
    console.error(`❌ 门禁咬到了自己的缺口陈述：\n  · ${falsePositives.join('\n  · ')}`);
    process.exit(1);
  }

  // 结构类变异：把真文档拷一份再破坏，逐条要求"必须判红"，另加一条未变异对照。
  const clone = (d) => JSON.parse(JSON.stringify(d));
  const base = clone(LEGAL_DOCUMENTS);
  const arms = [];

  const mk = (name, mutate) => {
    const docs = clone(LEGAL_DOCUMENTS);
    mutate(docs);
    arms.push({ name, fails: checkDocs(docs) });
  };

  mk('主表某行清空"对不上的部分"', (docs) => {
    const t = docs.find((d) => d.id === FULL_TABLE.docId).sections['zh-CN'].find((s) => s.id === FULL_TABLE.sectionId).blocks.find((b) => b.kind === 'table');
    t.rows[5] = [...t.rows[5].slice(0, -1), ''];
  });
  mk('主表只删中文一栏的某条文行', (docs) => {
    const s = docs.find((d) => d.id === FULL_TABLE.docId).sections['zh-CN'].find((x) => x.id === FULL_TABLE.sectionId);
    const t = s.blocks.find((b) => b.kind === 'table');
    t.rows = t.rows.filter((r) => !String(r[0]).includes('第 20 条'));
  });
  mk('某份文档冒出越界声称（主动语态 + an）', (docs) => {
    const s = docs.find((d) => d.id === 'minors').sections.en.find((x) => x.id === POINTERS.minors);
    s.blocks.find((b) => b.kind === 'p').text += ' We have appointed an EU representative.';
  });
  mk('某份文档冒出越界声称（被动语态）', (docs) => {
    const s = docs.find((d) => d.id === FULL_TABLE.docId).sections['zh-CN'].find((x) => x.id === FULL_TABLE.sectionId);
    s.blocks.find((b) => b.kind === 'p').text += ' An EU representative has been designated.';
  });
  mk('GDPR 节标题被改名（落点消失）', (docs) => {
    const s = docs.find((d) => d.id === 'terms').sections['zh-CN'].find((x) => x.id === POINTERS.terms);
    s.title = '其它口径';
  });
  mk('白名单过期（BLOCKED 里那份长出了节）', (docs) => {
    docs.find((d) => d.id === 'privacy').sections['zh-CN'].push({ id: 's99', title: 'GDPR 附录', blocks: [{ kind: 'p', text: '一段足够长的中文说明，用来让遍历层不空。'.repeat(30) }] });
  });
  mk('文档清单里多出一份没登记的', (docs) => {
    docs.push({ id: 'newcomer', sections: { 'zh-CN': [{ id: 's1', title: '甲', blocks: [{ kind: 'p', text: '一' }] }], en: [{ id: 's1', title: 'A', blocks: [{ kind: 'p', text: 'a' }] }] } });
  });

  // 🔴 反向腿：把**合法的缺口句**注进正文，声称层一条都不许报。
  // 只有正向腿的话，"把门禁调宽到什么都不放过"也算通过 —— 那正是这一族最坏的烂法。
  const mustNotBite = (name, inject) => {
    const docs = clone(LEGAL_DOCUMENTS);
    inject(docs);
    const bad = checkDocs(docs).filter((f) => f.includes('越界声称'));
    console.log(`  反向腿「${name}」→ 声称层报 ${String(bad.length)} 条 ${bad.length === 0 ? '✓' : '✖（咬到缺口陈述）'}`);
    for (const f of bad) console.log(`    · ${f}`);
    return bad.length === 0;
  };
  const greenLegs = [
    mustNotBite('中文缺口句：没有指定欧盟代表', (docs) => {
      const s = docs.find((d) => d.id === FULL_TABLE.docId).sections['zh-CN'].find((x) => x.id === FULL_TABLE.sectionId);
      s.blocks.find((b) => b.kind === 'p').text += ' 我们没有指定欧盟代表，也没有指定数据保护专员。';
    }),
    mustNotBite('英文缺口句：has not been appointed', (docs) => {
      const s = docs.find((d) => d.id === 'minors').sections.en.find((x) => x.id === POINTERS.minors);
      s.blocks.find((b) => b.kind === 'p').text += ' No EU representative has been appointed, and we do not hold an adequacy decision.';
    }),
    mustNotBite('列举形态：把三种机制名一起写出来', (docs) => {
      const s = docs.find((d) => d.id === 'ai-and-transfer').sections['zh-CN'].find((x) => x.id === POINTERS['ai-and-transfer']);
      s.blocks.find((b) => b.kind === 'p').text += ' 这里不声称已有任何转移机制（标准合同条款、充分性决定或转移影响评估）。';
    }),
  ];

  let red = 0;
  for (const arm of arms) {
    const hit = arm.fails.length > 0;
    red += hit ? 1 : 0;
    console.log(`  变异「${arm.name}」→ ${hit ? `判红 ${String(arm.fails.length)} 条 ✓` : '存活 ✖（这条判据没有牙）'}`);
  }
  const control = checkDocs(base);
  console.log(`  未变异对照 → ${control.length === 0 ? '通过 ✓' : `判红 ${String(control.length)} 条 ✖（真文档不合格）`}`);
  for (const f of control) console.log(`    · ${f}`);
  const greenOk = greenLegs.every(Boolean);
  if (red !== arms.length || control.length !== 0 || !greenOk) {
    console.error(
      `❌ 变异读数 ${String(red)}/${String(arms.length)}，反向腿 ${String(greenLegs.filter(Boolean).length)}/${String(greenLegs.length)}，对照 ${String(control.length)} 条 —— 不合格`
    );
    process.exit(1);
  }
  console.log(
    `✅ 变异 ${String(red)}/${String(arms.length)} 各自判红，反向腿 ${String(greenLegs.length)}/${String(greenLegs.length)} 没有咬到缺口陈述，未变异对照通过。`,
  );
  process.exit(0);
}

const fixtureAt = argv.indexOf('--fixture');
if (fixtureAt >= 0) {
  const file = argv[fixtureAt + 1];
  if (!file) {
    console.error('❌ --fixture 后面要跟一个 json 路径');
    process.exit(2);
  }
  const fails = checkDocs(JSON.parse(readFileSync(file, 'utf8')));
  console.log(`fixture ${file} → ${fails.length === 0 ? '通过' : `判红 ${String(fails.length)} 条`}`);
  for (const f of fails) console.log(`  · ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

const fails = checkDocs(LEGAL_DOCUMENTS);
if (fails.length > 0) {
  console.error('❌ GDPR 口径不合格：');
  for (const f of fails) console.error(`  · ${f}`);
  process.exit(1);
}
// 🔴 通过那一行的路径**第一次跑到就崩了**（前几轮全是判红，从没走到这里）：`gdprSection`
// 返回的是**小节**，表要经 `tableOf` 再取一层。判红的那条路有日志可看，判绿的这条没有 ——
// 所以绿路径也要当成被测代码，不能只测红。
const fullZhTable = tableOf(
  gdprSection(LEGAL_DOCUMENTS.find((d) => d.id === FULL_TABLE.docId), 'zh-CN', FULL_TABLE.sectionId),
);
console.log(
  `✅ GDPR 口径：主表 ${String(fullZhTable.rows.length)} 行 × 条文 ${EXPECTED_ARTICLES.join('/')}，` +
    `逐领域文档 ${String(Object.keys(POINTERS).length)} 份各带自己的对照表与去处，` +
    `白名单 ${String(Object.keys(BLOCKED).length)} 份（${Object.keys(BLOCKED).join(', ')}）；每行都有"对不上的部分"，没有越界声称。`,
);
