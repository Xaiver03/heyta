#!/usr/bin/env node
// 防再犯尺：判「同一段对外正文手抄在多枚法律文件里，改一处不改另几处」那一族缺陷。
//
// 来历（2026-10-28 现量）：工单 §5.2 记下过一句"那段正文手抄在三枚文件里而没有任何一把尺看着它们一致"。
// 这枚尺建起来第一趟就量到：中文三份**逐字同一份**，英文那三份里 `data-rights.ts` 已经和另两份不同文
// （它多列了三项 entitlement 相关的留存条目，而同文件的中文段落只列两类 ⇒ 同一枚界面语言外的另一语言
// 在对外说一件不同的事）。哪一侧是对的归负责人 —— 本尺**不改文案**，只把不同文点名并钉住：
// 再有人只改一处，这趟就红；那条已知漂移被修平而登记没删，这趟也红。
//
// 分母不手抄：它扫 `packages/legal/src/documents/*.ts`，把"非位置编号的 id 且出现在 ≥2 枚文件里"
// 的全部小节自动收进来 —— 加一枚新的共享小节不用回来改名单（臂 7 钉住位置编号 `s1..s12` 不许混进来，
// 那是各份文档自己的第几节，本来就该不同文）。
//
// 跑法：
//   node scripts/check-inbound-legal-copy-parity.mjs              # 判现网
//   node scripts/check-inbound-legal-copy-parity.mjs --self-test  # 只测这把尺有没有牙
//
// 边界：只读，不改任何文件；判的是**字节层**逐字相同（不做"语义相近"那种判据，那会漂）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = 'packages/legal/src/documents';

// 已知漂移登记：键是 (id, locale, 变体里那组文件的排序后拼接)，值必须是"为什么不判红"与"归谁拍"。
// 🔴 登记按**变体**而不是按文件：同一 id 同一语言里每一组互相同文的副本算一枚变体，登记要说清哪几枚
// 是一组、哪一组是少数那一侧 —— 只登记文件名会把"两份都漂了"读成"已登记"。
const KNOWN_DRIFT = new Map([
  [
    'automation-metadata|en|data-rights.ts\x00personal-info-list.ts,privacy.ts',
    {
      id: 'automation-metadata',
      locale: 'en',
      outlier: ['data-rights.ts'],
      rest: ['personal-info-list.ts', 'privacy.ts'],
      reason:
        '英文那份多列 automation entitlement activation / link / subjects 三项，中文三份与另两份英文都只列两类 ⇒ ' +
        '这是**对外法律表征**的口径分歧，改哪一侧归负责人（工单 §5.2 第 2 格）；本线一个字不许代改。' +
        '翻案条件：负责人定了口径、两侧逐字相同后，把这条登记删掉（删之前这尺会因"登记过期"红，那是提醒不是缺陷）。',
    },
  ],
]);

// 键里的"变体形状"= 每组互相同文的副本文件名（组内排序、组间按拼好的串排序），所以登记说的是
// "哪几枚是一组、哪一组是少数那一侧"，不是裸文件名 —— 只登记文件名会把"两组都漂了"读成"已登记"。
const driftKey = (id, locale, variants) =>
  `${id}|${locale}|${variants.map((v) => v.slice().sort().join(',')).sort().join('\x00')}`;

/** 从一份 `*.ts` 里抽出所有 `{ id: "…", title: … }` 小节的**原文字节**（按大括号配对取整段）。 */
export function extractSites(text) {
  const out = [];
  const re = /\{\s*id:\s*["']([a-z0-9-]+)["']\s*,\s*title:/g;
  for (const m of text.matchAll(re)) {
    const open = text.indexOf('{', m.index);
    let depth = 0;
    let end = -1;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue; // 括号不配对交给 TS 自己判，这尺不假装看得见
    const body = text.slice(open, end + 1);
    const cjk = [...body].filter((ch) => ch >= '一' && ch <= '鿿').length;
    out.push({ id: m[1], locale: cjk > 0 ? 'zh' : 'en', body });
  }
  return out;
}

/** 扫一目录 ⇒ 分母：出现在 ≥2 枚文件里的非 `s<数字>` id。 */
export function sharedGroups(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).sort();
  if (files.length === 0) return { files, groups: new Map(), blind: true };
  const byId = new Map();
  for (const f of files) {
    for (const s of extractSites(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      if (/^s\d+$/.test(s.id)) continue; // 位置编号：各份文档各自的"第几节"，本来就该不同文
      if (!byId.has(s.id)) byId.set(s.id, []);
      byId.get(s.id).push({ ...s, file: f });
    }
  }
  const groups = new Map();
  for (const [id, sites] of byId) {
    if (new Set(sites.map((s) => s.file)).size < 2) continue;
    groups.set(id, sites);
  }
  return { files, groups, blind: false };
}

/** 判一目录 ⇒ 逐格问题清单。纯函数：臂把造出来的临时目录指进来，不碰仓。 */
export function judge(dir, exempt = KNOWN_DRIFT) {
  const { files, groups, blind } = sharedGroups(dir);
  const problems = [];
  if (blind) problems.push('分母打空：`' + DOCS_DIR + '` 里一枚 `.ts` 都没扫到 ⇒ 抽取瞎了，这趟不算判过');

  let checked = 0;
  const hitKeys = new Set();
  for (const [id, sites] of [...groups].sort()) {
    // 成对判据按**文件**打：共享小节新加进一枚文档时，两种语言都得有，否则那枚文档对外只说一半。
    const sets = { zh: new Set(), en: new Set() };
    for (const s of sites) sets[s.locale].add(s.file);
    for (const [loc, other] of [['zh', 'en'], ['en', 'zh']]) {
      const missing = [...sets[other]].filter((f) => !sets[loc].has(f)).sort();
      if (missing.length) {
        problems.push(`${id}：${missing.join(',')} 里有另一种语言的副本却没有${loc === 'zh' ? '中文' : '英文'}那一份 ⇒ 共享小节必须逐枚文档都成对`);
      }
    }
    for (const locale of ['zh', 'en']) {
      const locSites = sites.filter((s) => s.locale === locale);
      if (locSites.length === 0) continue;
      checked += 1;
      const variants = new Map();
      for (const s of locSites) {
        if (!variants.has(s.body)) variants.set(s.body, []);
        variants.get(s.body).push(s.file);
      }
      if (variants.size === 1) continue; // 逐字同一份
      const list = [...variants].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
      const shape = list.map(([, fs2]) => [...fs2].sort());
      const key = driftKey(id, locale, shape);
      if (exempt.has(key)) {
        hitKeys.add(key);
        continue;
      }
      const first = [...list[0][0]];
      const second = [...list[1][0]];
      let off = 0;
      while (off < first.length && off < second.length && first[off] === second[off]) off += 1;
      problems.push(
        `${id}/${locale}：${shape.map((g) => g.join(',')).join(' 与 ')} 是 ${variants.size} 种不同文` +
          `（首个不同在第 ${off} 个码点：「${first.slice(off, off + 28).join('')}」vs「${second.slice(off, off + 28).join('')}」）` +
          ` —— 要么把这几处改成逐字相同，要么在下面这张登记里写明归谁拍`,
      );
    }
  }
  // 登记不许变成没人认领的洞：命中不了的那条就是"漂移已被修平而登记还留着"
  for (const key of [...exempt.keys()]) {
    if (!hitKeys.has(key)) {
      const e = exempt.get(key);
      problems.push(`登记过期：${e.id}/${e.locale} 那条已知漂移现在扫不到了（登记里的 ${e.outlier.join(',')} 与 ${e.rest.join(',')}）⇒ 已被修平就把这条删掉`);
    }
  }
  return { fileCount: files.length, checked, problems };
}

function selfTest() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-parity-selftest-'));
  let arms = 0;
  const failed = [];
  const check = (name, ok, why = '') => {
    arms += 1;
    console.log(`${ok ? '✅' : '❌'} 臂 ${name}${ok ? '' : `（${why}）`}`);
    if (!ok) failed.push(name);
  };
  const obj = (id, zh, en) => {
    const cn = `{ id: "${id}", title: "标题", blocks: [{ kind: "p", text: "${zh}" }] }`;
    const ent = `{ id: "${id}", title: "Title", blocks: [{ kind: "p", text: "${en}" }] }`;
    return [cn, ent];
  };
  const write = (name, parts) => fs.writeFileSync(path.join(base, `${name}.ts`), `const zh = [${parts.join(',')}];\n`);
  const fresh = () => {
    for (const f of fs.readdirSync(base)) fs.rmSync(path.join(base, f));
  };

  // 臂 1：三处逐字相同 ⇒ 不判红（这一臂失法的话，下面所有"红"都可能是恒红）
  fresh();
  write('privacy', obj('automation-metadata', '自动收集尚未开放。', 'Automatic capture is not yet available.'));
  write('data-rights', obj('automation-metadata', '自动收集尚未开放。', 'Automatic capture is not yet available.'));
  write('personal-info-list', obj('automation-metadata', '自动收集尚未开放。', 'Automatic capture is not yet available.'));
  let r = judge(base, new Map());
  check('1 三处逐字相同 ⇒ 绿（否则整把尺是恒红）', r.problems.length === 0 && r.checked === 2, JSON.stringify(r));

  // 臂 2：只改其中一枚中文 ⇒ 红且点名是哪两枚
  write('data-rights', obj('automation-metadata', '自动收集尚未开放。改了。', 'Automatic capture is not yet available.'));
  r = judge(base, new Map());
  check('2 改一处不改另两处 ⇒ 红并点名两枚文件',
    r.problems.length === 1 && /data-rights,personal-info-list|personal-info-list,data-rights|privacy/.test(r.problems[0] || '') && /zh/.test(r.problems[0] || ''),
    JSON.stringify(r.problems));

  // 臂 3：漂移只发生在英文 ⇒ 也要红（中文一致不等于英文一致）
  write('data-rights', obj('automation-metadata', '自动收集尚未开放。', 'Automatic capture is not yet available. Extra.'));
  r = judge(base, new Map());
  check('3 中文三份相同而英文漂一份 ⇒ 照样红', r.problems.length === 1 && /en/.test(r.problems[0] || ''), JSON.stringify(r.problems));

  // 臂 4：登记命中 ⇒ 绿；登记指向的内容被修平 ⇒ 红（不许留成没人认领的洞）
  const key = driftKey('automation-metadata', 'en', [['data-rights.ts'], ['personal-info-list.ts', 'privacy.ts']]);
  const map = new Map([[key, { id: 'automation-metadata', locale: 'en', outlier: ['data-rights.ts'], rest: ['personal-info-list.ts', 'privacy.ts'] }]]);
  r = judge(base, map);
  check('4 已知漂移有登记 ⇒ 不冒充新缺陷', r.problems.length === 0, JSON.stringify(r.problems));
  write('data-rights', obj('automation-metadata', '自动收集尚未开放。', 'Automatic capture is not yet available.'));
  r = judge(base, map);
  check('4b 那条漂移被修平而登记还留着 ⇒ 红（登记过期）', r.problems.length === 1 && /登记过期/.test(r.problems[0] || ''), JSON.stringify(r.problems));

  // 臂 5：登记按变体而不是按裸文件名 —— 两组都漂了（2+2）不能被"文件名登记过"吞掉
  fresh();
  write('privacy', obj('shared-x', '甲。', 'A.'));
  write('data-rights', obj('shared-x', '甲。', 'A.'));
  write('personal-info-list', obj('shared-x', '乙。', 'B.'));
  write('terms', obj('shared-x', '乙。', 'B.'));
  r = judge(base, new Map());
  check('5 两组各两枚、彼此不同文 ⇒ 中英两种各红一次',
    r.problems.length === 2 && r.problems.every((p) => /2 种/.test(p)) &&
      r.problems.some((p) => /zh/.test(p)) && r.problems.some((p) => /en/.test(p)),
    JSON.stringify(r.problems));

  // 臂 6：共享那节只剩一种语言有副本 ⇒ 缺译要红
  fresh();
  write('privacy', obj('shared-y', '甲。', 'A.'));
  const enOnly = `{ id: "shared-y", title: "Title", blocks: [{ kind: "p", text: "A." }] }`;
  fs.writeFileSync(path.join(base, 'terms.ts'), `const en = [${enOnly}];\n`);
  r = judge(base, new Map());
  check('6 一枚文档只有另一种语言的副本 ⇒ 成对判据点名它', r.problems.some((p) => /成对/.test(p)), JSON.stringify(r.problems));

  // 臂 7：位置编号 s1..s12 不许进分母（各份文档自己的第几节，本来就该不同文）
  fresh();
  write('privacy', obj('s1', '甲。', 'A.'));
  write('terms', obj('s1', '乙。', 'B.'));
  r = judge(base, new Map());
  check('7 s1..s12 那种位置编号不进分母', r.problems.length === 0 && r.checked === 0, JSON.stringify(r));

  // 臂 8：目录空 ⇒ 分母打空要红（不能"扫不到"就当作"判过了"）
  fresh();
  r = judge(base, new Map());
  check('8 目录里一枚 .ts 都没有 ⇒ 红（分母打空）', r.problems.some((p) => /分母打空/.test(p)), JSON.stringify(r.problems));

  fs.rmSync(base, { recursive: true, force: true });
  console.log(`self_test arms=${arms} failed=${failed.length}`);
  return failed.length === 0 ? 0 : 1;
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const dir = path.join(ROOT, DOCS_DIR);
  const { fileCount, checked, problems } = judge(dir);
  const exempt = KNOWN_DRIFT.size;
  console.log(
    `读数: 扫过 ${fileCount} 枚 *.ts 判了 ${checked} 组(共享小节×语言) 登记=${exempt} 问题=${problems.length} ok=${problems.length === 0}`,
  );
  for (const p of problems) console.log(`  🔴 ${p}`);
  // 登记吞掉的那些**必须照样打出来** —— 否则一条登记就把一处真实的对外口径分歧变成看不见的东西
  for (const e of KNOWN_DRIFT.values()) {
    console.log(`  ⚪ 已登记漂移：${e.id}/${e.locale}　${e.outlier.join(',')} 与 ${e.rest.join(',')} 不同文 —— ${e.reason}`);
  }
  if (problems.length === 0) console.log('结论：跨文档共享的对外小节，每种语言里的每一组副本都逐字相同；登记的漂移已逐枚点名（改哪侧归负责人）✅');
  return problems.length === 0 ? 0 : 1;
}

process.exit(main());
