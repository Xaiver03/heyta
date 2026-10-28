#!/usr/bin/env node
/**
 * 「自动收集规则的读面谓词收紧了，每一处 fixture 都得跟上」—— 结构性门禁
 * =====================================================================
 *
 * 判据出处：2026-10-28 那枚 `AC6-browser` 的红（`docs/plans/inbound-automation.md` 文末 15:0x 那一节）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么需要这一道（不是风格检查）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `packages/app-host/src/inbound-rules-remote.ts` 里那枚 `valid()` 是**读面红线**：
 * 它要求服务端回来的每一枚规则对象都带齐一组字段，认不出就不渲染那一格，而不是猜一个默认值。
 * 2026-10-27 23:41 那笔给规则加"抽取归谁"那一格时，谓词多了一支
 * `typeof r.hostedExtraction === 'boolean'`，**单元侧的 fixture 全补了，e2e 那三段没补** ——
 * 于是真浏览器里整屏"规则读取失败"、六条腿一起红，而这条红**藏了一天**：
 * 那趟整串主动剔掉了 `AC6-browser` 那枚腿，之后没有任何东西跑过它。
 *
 * 缺的不是"多跑一次浏览器腿"，是**没有一把尺知道"谓词的必填集合"与"fixture 带的键"是同一件事**。
 * 所以本尺不抄字段清单（抄一份就立刻变成第四份会漂的抄件），而是**从谓词源码里派生**，
 * 再逐处比对 fixture。谓词加一支，下一趟所有没跟上的 fixture 当场红。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三组断言（两组的分母是"扫不到就红"）
 * ─────────────────────────────────────────────────────────────────────────
 * A. **派生集非空，且含 `hostedExtraction`**。
 *    少于预期 ⇒ 有人把 `valid()` 改坏或整支删了 —— 那正是"没有违规可报"的假绿来源，必须红。
 * B. **分母非空**：被扫的那几份测试文件里至少有一枚规则 fixture。
 *    读到 0 枚 ⇒ 要么 fixture 的标记写法变了（本尺瞎了），要么测试被删 —— 两种都不许绿。
 * C. **每枚规则 fixture 带齐派生集里的全部键**，缺哪个键、在哪枚文件第几行，逐条点名。
 *
 * 只扫**装这份线协议的那些信封**：锚是 `rules:`（服务端回来的那层信封键，也正是 `valid()` 判的东西），
 * 不是"任何带 `allowedFields` 的对象"。第一版我按后者扫，主判当场报 88 条 —— 逐条读了来源后确认
 * **那是我把分母开错了**：`packages/app-host/tests/inbound-process.spec.ts` 与 `inbound-runner.spec.ts`
 * 里那些是喂 runner 的**内部规则配置**（本来就不带 `createdAt`/`keyId` 这些线字段），
 * 把它们拉进分母等于用线协议契约去判一个不承诺它的对象 —— 尺会红，但红的是尺。
 * 收窄到 `rules:` 之后，被钉住的正是"谁在冒充服务端响应"这一类，也就是本尺唯一该管的东西。
 * 同理 `server/tests/**` 不在分母里：那边写的是 Prisma 行（库里的列），不是这份客户端读面契约。

 *
 * ─────────────────────────────────────────────────────────────────────────
 * 跑法
 * ─────────────────────────────────────────────────────────────────────────
 *   node scripts/check-inbound-rule-fixture-parity.mjs              # 判当前树
 *   node scripts/check-inbound-rule-fixture-parity.mjs --self-test  # 五臂：干净必须绿、四种坏法各必须红
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 🔴 不能用 `new URL('..', import.meta.url).pathname`：本仓根目录名里有空格，
// `pathname` 会把它百分号编码成 `All%20in%20one%20Data`，于是每个 readFileSync 都 ENOENT。
const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));

const PREDICATE_FILE = 'packages/app-host/src/inbound-rules-remote.ts';
/** 这一枚是本轮事故的当事字段：谓词里它一旦不在，A 组就红（见文件头）。 */
const MUST_INCLUDE = 'hostedExtraction';
const FIXTURE_GLOBS = [
  { file: 'e2e/tests/inbound-automation.spec.ts' },
  { dir: 'apps/web/tests', prefix: 'inbound-', suffixes: ['.spec.tsx', '.spec.ts'] },
  { dir: 'packages/app-host/tests', prefix: 'inbound-', suffixes: ['.spec.ts'] },
];

// 🔴 剥注释必须**保持行数**：豁免标记住在注释里，而它是拿"原文件的那一行"去认的 ——
// 一旦剥完行号错位，豁免就会飘到别行上去（要么漏豁免、要么豁免错对象）。
const stripComments = (text) => text
  .replace(/\/\*[\S\s]*?\*\//gu, (block) => '\n'.repeat((block.match(/\n/gu) || []).length))
  .replace(/(^|[^:])\/\/[^\n]*/gu, '$1');


/** 从 `valid()` 的函数体里派生"必填键"集合 —— 只认代码，不认散文。 */
export function deriveRequiredKeys(source) {
  const code = stripComments(source);
  const start = code.indexOf('const valid = ');
  if (start < 0) return [];
  const end = code.indexOf('\n};', start);
  if (end < 0) return [];
  const body = code.slice(start, end);
  const keys = new Set();
  const patterns = [
    /typeof\s+r\.([A-Za-z0-9_]+)\s*===\s*['"](string|number|boolean)['"]/gu,
    /r\.([A-Za-z0-9_]+)\s*===\s*null\s*\|\|\s*typeof\s+r\.[A-Za-z0-9_]+\s*===\s*['"]string['"]/gu,
    /Array\.isArray\(\s*r\.([A-Za-z0-9_]+)\s*\)/gu,
  ];
  for (const re of patterns) {
    for (const match of body.matchAll(re)) keys.add(match[1]);
  }
  return [...keys].sort();
}

function fixtureFiles() {
  const files = [];
  for (const entry of FIXTURE_GLOBS) {
    if (entry.file) { files.push(entry.file); continue; }
    const dir = join(ROOT, entry.dir);
    for (const name of readdirSync(dir).sort()) {
      if (!name.startsWith(entry.prefix)) continue;
      if (!entry.suffixes.some((s) => name.endsWith(s))) continue;
      files.push(`${entry.dir}/${name}`);
    }
  }
  return files;
}

/** fixture 的锚：服务端回来的那层**线信封**键（`valid()` 判的就是它里面的每一枚对象）。 */
const WIRE_ENVELOPE = /rules:\s*\[/gu;
/**
 * 故意造的不法样本（测 fail-closed 那一类）要在**同一行**挂这枚标记才豁免。
 * 🔴 豁免必须被数出来并逐枚打印（见 `main` 与臂 A4）：一把能静默跳过样本的尺，
 * 和一把没有尺一样容易绿。
 */
const EXEMPT = 'fixture-parity: 故意不法样本';

/** 从 `rules: [` 的那个 `[` 起，取出该数组里每一枚**顶层对象字面量**（含其起始偏移）。 */
function arrayElements(text, openBracket) {
  const out = [];
  let depth = 0; let i = openBracket;
  for (; i < text.length; i += 1) {
    const c = text[i];
    if (c === '[' || c === '{') {
      depth += 1;
      if (c === '{' && depth === 2) {
        let inner = 0; let j = i;
        for (; j < text.length; j += 1) {
          if (text[j] === '{') inner += 1;
          else if (text[j] === '}') { inner -= 1; if (inner === 0) break; }
        }
        out.push({ start: i, text: text.slice(i, j + 1) });
        i = j; depth -= 1;
      }
    } else if (c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return out;
}

/** 主判定：返回 `{ ok, 派生集, 分母, 豁免[], 缺漏[] }`，不直接打印，方便 self-test 复用。 */
export function judge({ predicateSource, fixtures }) {
  const required = deriveRequiredKeys(predicateSource);
  const missing = [];
  const exempt = [];
  let denominator = 0;
  for (const { file, source } of fixtures) {
    const lines = source.split('\n');
    const code = stripComments(source);
    for (const match of code.matchAll(WIRE_ENVELOPE)) {
      const openBracket = code.indexOf('[', match.index);
      for (const element of arrayElements(code, openBracket)) {
        const line = code.slice(0, element.start).split('\n').length;
        if (lines[line - 1] !== undefined && lines[line - 1].includes(EXEMPT)) {
          exempt.push(`${file}:${String(line)}`);
          continue;
        }
        denominator += 1;
        for (const key of required) {
          if (!new RegExp(`\\b${key}\\s*:`, 'u').test(element.text)) {
            missing.push(`${file}:${String(line)} 缺 ${key}`);
          }
        }
      }
    }
  }
  const aFail = required.length === 0 || !required.includes(MUST_INCLUDE);
  const bFail = denominator === 0;
  return {
    ok: !aFail && !bFail && missing.length === 0,
    required, denominator, exempt, missing, aFail, bFail,
  };
}

function main() {
  const predicateSource = readFileSync(join(ROOT, PREDICATE_FILE), 'utf8');
  const fixtures = fixtureFiles().map((file) => ({ file, source: readFileSync(join(ROOT, file), 'utf8') }));
  const verdict = judge({ predicateSource, fixtures });
  console.log(`谓词派生的必填键（现量自 ${PREDICATE_FILE}）= ${String(verdict.required.length)} 枚：${verdict.required.join(' ')}`);
  console.log(`分母：规则 fixture ${String(verdict.denominator)} 枚，扫 ${String(fixtures.length)} 份文件`);
  console.log(`豁免：${String(verdict.exempt.length)} 枚（挂了 \`${EXEMPT}\` 的故意不法样本）${verdict.exempt.length > 0 ? ` —— ${verdict.exempt.join(' , ')}` : ''}`);
  // 这行是给电池（`research/tools/verify-inbound-ac-battery.py`）的摘要针落的：它的 `SUMMARY_RE` 认"读数"，
  // 只有 rc 的话 rc.txt 里那一格就只剩"判过"而没有"判出什么"。
  console.log(`读数: keys=${String(verdict.required.length)} denom=${String(verdict.denominator)} exempt=${String(verdict.exempt.length)} missing=${String(verdict.missing.length)} ok=${String(verdict.ok)}`);
  if (verdict.aFail) {
    console.log(`❌ A 组：派生集为空或缺 \`${MUST_INCLUDE}\` —— 谓词被改坏了，这时"没有违规"是零信息，不许绿`);
    process.exitCode = 1; return;
  }
  if (verdict.bFail) {
    console.log('❌ B 组：一枚规则 fixture 都没扫到 —— 要么 fixture 的标记写法变了（本尺瞎了），要么测试被删。不许绿');
    process.exitCode = 1; return;
  }
  if (verdict.missing.length > 0) {
    for (const line of verdict.missing) console.log(`❌ C 组：${line}`);
    process.exitCode = 1; return;
  }
  console.log(`✅ 每枚 fixture 都带齐谓词要求的 ${String(verdict.required.length)} 枚键（${String(verdict.denominator)} 枚全过）`);
}

/**
 * 五臂（全在内存里造失法，**不动工作树**）：
 *  0 对照臂：真源码 + 真 fixture ⇒ 必须绿（否则这台机器/这棵树本身有问题，臂的红就没意义）；
 *  A1 抹掉 fixture 里的 `hostedExtraction:` ⇒ 必须红，且点名的就是这一枚键；
 *  A2 把谓词里那一支删掉 ⇒ 必须红（派生集缺 `hostedExtraction`，A 组）；
 *  A3 分母清空（没有任何 fixture）⇒ 必须红（B 组，防"扫不到就当没这事"）；
 *  A4 抹掉**豁免标记**本身 ⇒ 那一枚的整批缺漏必须回来（比的是缺漏条数之差，不比 `ok`，理由写在那段里）。
 */
function selfTest() {
  const predicateSource = readFileSync(join(ROOT, PREDICATE_FILE), 'utf8');
  const fixtureRel = 'e2e/tests/inbound-automation.spec.ts';
  const realFixture = readFileSync(join(ROOT, fixtureRel), 'utf8');
  const arms = [];
  const check = (name, ok, why) => arms.push({ name, ok: ok === true, why: ok ? '' : why });

  const clean = judge({ predicateSource, fixtures: [{ file: fixtureRel, source: realFixture }] });
  check('0 对照臂：真源码 + 真 fixture ⇒ 绿', clean.ok, `真树本身就红：${clean.missing.slice(0, 3).join(' / ') || 'A/B 组失败'}`);

  const broken = realFixture.replace(/hostedExtraction: false/gu, 'hostedExtractionRemoved: false');
  const a1 = judge({ predicateSource, fixtures: [{ file: fixtureRel, source: broken }] });
  check('A1 抹掉 fixture 里的 hostedExtraction ⇒ 红且点名该键',
    !a1.ok && a1.missing.some((line) => line.includes(MUST_INCLUDE)),
    `ok=${String(a1.ok)} missing=${String(a1.missing.length)}`);

  const weakened = predicateSource.replace(/typeof\s+r\.hostedExtraction\s*===\s*'boolean'/gu, 'true');
  const a2 = judge({ predicateSource: weakened, fixtures: [{ file: fixtureRel, source: realFixture }] });
  check('A2 谓词那一支被删/改坏 ⇒ 红（派生集不再含该键）', !a2.ok && a2.aFail, `ok=${String(a2.ok)}`);

  const a3 = judge({ predicateSource, fixtures: [{ file: fixtureRel, source: '// 这一趟没有任何规则 fixture\n' }] });
  check('A3 分母为空 ⇒ 红（不许"扫不到就当没这事"）', !a3.ok && a3.denominator === 0 && a3.bFail,
    `ok=${String(a3.ok)} 分母=${String(a3.denominator)}`);

  // 🔴 豁免必须是**被指着豁免的**，不是碰巧没扫到：抹掉那行注释里的标记，那一枚的缺漏就该整批回来。
  // ⚠️ 这里比的**不是 `ok`**：那枚文件里唯一一层 `rules:` 信封就是被豁免的这一枚（其余响应体走的是
  // 变量而非对象字面量，扫不出元素），所以单独判它时分母为 0、B 组必然红 —— 第一版我拿 `ok` 当断言，
  // 臂红的是臂自己的前提，不是尺的牙。比"缺漏条数的差"才对准了这件事。
  const remoteRel = 'packages/app-host/tests/inbound-rules-remote.spec.ts';
  const remoteReal = readFileSync(join(ROOT, remoteRel), 'utf8');
  const withMarker = judge({ predicateSource, fixtures: [{ file: remoteRel, source: remoteReal }] });
  const unmarked = judge({ predicateSource, fixtures: [{ file: remoteRel, source: remoteReal.replace(/\/\/ fixture-parity:[^\n]*/gu, '') }] });
  const delta = unmarked.missing.length - withMarker.missing.length;
  check('A4 抹掉豁免标记 ⇒ 那一枚的整批缺漏回来（豁免是指着标的，不是碰巧没扫到）',
    withMarker.exempt.length === 1 && delta === withMarker.required.length
      && unmarked.missing.every((line) => line.includes(remoteRel)),
    `带标记 豁免=${String(withMarker.exempt.length)} 缺漏=${String(withMarker.missing.length)}；抹掉后 缺漏=${String(unmarked.missing.length)}（差=${String(delta)}，派生集=${String(withMarker.required.length)}）`);

  for (const arm of arms) console.log(`${arm.ok ? '✅' : '❌'} 臂 ${arm.name}${arm.ok ? '' : `（${arm.why}）`}`);
  const failed = arms.filter((arm) => !arm.ok);
  console.log(`self_test arms=${String(arms.length)} failed=${String(failed.length)}`);
  if (failed.length > 0) process.exitCode = 1;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();
else main();
