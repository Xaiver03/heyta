#!/usr/bin/env node
/**
 * 移动端设备腿的**界面锚点**门禁（2026-10-26）
 * =============================================
 *
 * ## 为什么需要它
 *
 * `scripts/verify-mobile-auth.sh` 曾经**从没绿过**，而它的每一条坏法都长得像产品坏了：
 * 脚本里写着 `L_TERMS="我同意该服务端提供的服务条款与隐私政策"`，而词条早就改成
 * 「我同意服务条款与隐私政策，并允许本机联网」⇒ 那一步必红，报的是"找不到同意项"。
 * 同类还有：脚本点「注册新账号」（那个折叠区默认收起、节点根本不在树上）、
 * 要「粘贴令牌」那一栏（只有 `allowServerSelection` 才渲染）。
 *
 * **界面文案会跟着产品改，脚本里的字面量不会。** 所以要么让脚本从词条表取字
 * （shell 里做不到），要么让门禁在**文案改名的那一刻**就红。
 * 这道门就是后者：它把脚本里的界面锚点与**真源**逐字对一遍。
 *
 * ## 两条判据
 *
 *   ① `L_*="…"`（含中文的界面锚点）必须**逐字**出现在 `zh-CN.ts` 的某个值里。
 *      不出现 ⇒ 那个字在界面上已经不存在了，脚本点的是一个不存在的控件。
 *   ② `ID_*="…"` 必须以 `testID="…"` 或 `testID={`…`}` 的形状出现在 `apps/mobile/src`。
 *      不出现 ⇒ testID 被改名/删除，脚本会静默落在"滚 5 次也不在可点区"上。
 *
 * ⚠️ 只认**含中日韩字符**的 `L_*`：那些变量里也有路径、命令、纯 ASCII 标识，
 * 把它们也纳入会让这道门变成"每次都红"，然后被人关掉 —— 一条永远红的检查
 * 比没有检查更糟（§7 那条元规则）。
 *
 * ## 能失败
 *
 * `--self-test` 会注入一枚**必然过期**的锚点（照着 2026-10-24 那次的真实形状），
 * 断言门禁真的红；再注入一枚真的存在的锚点，断言不红。两条臂都由它自己打印。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'scripts');
const ZH = join(ROOT, 'packages/i18n/src/locales/zh-CN.ts');
const MOBILE_SRC = join(ROOT, 'apps/mobile/src');

/** 含中日韩字符 ⇒ 它是一句界面文案，而不是路径/命令/标识符。 */
const CJK = /[\u3400-\u9FFF\uFF00-\uFFEF]/;

/** 从脚本里抽出 `L_X="…"` / `ID_X="…"`。 */
export function anchorsOf(source) {
  const labels = [];
  const ids = [];
  for (const line of source.split('\n')) {
    const m = /^(L_[A-Z0-9_]+)="([^"]*)"\s*$/.exec(line.trim());
    if (m !== null) labels.push({ name: m[1], value: m[2] });
    const i = /^(ID_[A-Z0-9_]+)="([^"]*)"\s*$/.exec(line.trim());
    if (i !== null) ids.push({ name: i[1], value: i[2] });
  }
  return { labels, ids };
}

/**
 * 设备腿里**导入**的锚点：`L_*` / `ID_*` 除了在脚本自己里定义，也可能来自 `scripts/lib/*.sh`。
 * 这三类之外的名字（比如 `$TOKEN`）不在这道门管辖内 —— 它们不是界面锚点。
 */
const ANCHOR_DEF = /^\s*(L_[A-Z0-9_]+|ID_[A-Z0-9_]+)=/;

/** 一个文件里定义过的锚点名。 */
export function definedAnchors(source) {
  const names = new Set();
  for (const line of source.split('\n')) {
    const m = ANCHOR_DEF.exec(line);
    if (m !== null) names.add(m[1]);
  }
  return names;
}

/** 一个文件里**引用**过的锚点名（`$L_X` 与 `${L_X}` 两种写法）。 */
export function referencedAnchors(source) {
  const names = new Set();
  for (const m of source.matchAll(/\$\{?(L_[A-Z0-9_]+|ID_[A-Z0-9_]+)\b/g)) names.add(m[1]);
  return names;
}

/** 词条表里所有值（只取单引号字符串值，够用且不引 TS 解析）。 */
export function zhValues(source) {
  const out = [];
  for (const m of source.matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)) out.push(m[1]);
  return out;
}

/**
 * 收集 testID 的两半：**字面量**与**模板后缀**。
 *
 * 🔴 为什么不能只收字面量：共享表单里的按钮是合成出来的
 * （`testID={`${testID}-submit`}`，而 `testID="mobile-auth-form"` 由壳传入），
 * 所以 `mobile-auth-form-submit` 这串**在源码里一个字都不出现**。
 * 只收字面量的话，脚本里正确的那一枚也会被判红 —— 一条会误报的门禁等于没有。
 *
 * 于是判定拆成两条：`ID` 要么是字面量，要么能拆成「字面量前缀 + 模板后缀」。
 */
function collectTestIds(dir, literals = new Set(), suffixes = new Set()) {
  if (!existsSync(dir)) return { literals, suffixes };
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) {
      collectTestIds(p, literals, suffixes);
      continue;
    }
    if (!/\.tsx?$/.test(name.name)) continue;
    const text = readFileSync(p, 'utf8');
    for (const m of text.matchAll(/testID=(?:"([^"]+)"|\{'([^']+)'\})/g)) {
      const value = m[1] ?? m[2];
      if (value !== undefined && !value.includes('$')) literals.add(value);
    }
    for (const m of text.matchAll(/testID=\{`([^`]+)`\}/g)) {
      const value = m[1] ?? '';
      // `${testID}-submit` ⇒ 后缀 `-submit`；`tab-${key}` ⇒ 前缀 `tab-`。
      const tail = /\}$/.test(value) ? '' : value.slice(value.lastIndexOf('}') + 1);
      const head = /^\$\{/.test(value) ? '' : value.slice(0, value.indexOf('${'));
      if (tail !== '') suffixes.add(tail);
      if (head !== '') literals.add(head);
    }
  }
  return { literals, suffixes };
}

/** `ID` 是否指向一个真实存在的 testID（字面量，或「字面量前缀 + 模板后缀」）。 */
function idExists(id, literals, suffixes) {
  if (literals.has(id)) return true;
  for (const suffix of suffixes) {
    if (!id.endsWith(suffix)) continue;
    const prefix = id.slice(0, id.length - suffix.length);
    if (prefix !== '' && literals.has(prefix)) return true;
  }
  return false;
}

/**
 * 校验一份脚本的锚点。返回 `{ red, checked, labels }`。
 * `idSet` 由调用方给（便于 self-test 注入）。
 */
/**
 * @param libAnchors 各 `scripts/lib/*.sh` 里定义过的锚点名（脚本会 source 它们）
 */
export function audit(scriptPath, zhTable, idSet, libAnchors = new Set()) {
  const source = readFileSync(scriptPath, 'utf8');
  const { labels, ids } = anchorsOf(source);
  const problems = [];
  let checked = 0;

  // 🔴 引用了一个**哪儿都没定义**的锚点：最典型的半截改名（把 L_PASSWORD 改成
  // L_LOGIN_PASSWORD，只改了引用没改定义）。它在 shell 里展开成空串，
  // 于是 `xy_desc ""` 返回第一个节点 —— 点下去的是别的东西，而日志只是"没反应"。
  const defined = definedAnchors(source);
  for (const name of referencedAnchors(source)) {
    checked += 1;
    if (!defined.has(name) && !libAnchors.has(name)) {
      problems.push(`锚点没定义：${name}（脚本与 scripts/lib/*.sh 里都没有赋值，展开是空串）`);
    }
  }

  for (const label of labels) {
    if (!CJK.test(label.value)) continue;
    checked += 1;
    // 「逐字出现在某个值里」而不是「等于某个值」：脚本常只写前半句（"如果这个邮箱可用"），
    // 那是刻意的 —— 整句会随词条微调而漂，片段反而稳。
    if (!zhTable.some((value) => value.includes(label.value))) {
      problems.push(`文案已不存在：${label.name}="${label.value}"（zh-CN 里没有包含它的值）`);
    }
  }

  for (const id of ids) {
    checked += 1;
    if (!idExists(id.value, idSet.literals, idSet.suffixes)) {
      problems.push(`testID 已不存在：${id.name}="${id.value}"（apps/mobile/src + packages/ui/src 里没有这个 testID）`);
    }
  }

  return { red: problems.length > 0, checked, problems, labels, ids };
}

function main() {
  const selfTest = process.argv.includes('--self-test');
  const zhTable = zhValues(readFileSync(ZH, 'utf8'));
  const idSet = collectTestIds(MOBILE_SRC);
  // 组合件的 testID 由共享层合成（`${testID}-submit`），所以两边都要收。
  collectTestIds(join(ROOT, 'packages/ui/src'), idSet.literals, idSet.suffixes);

  if (selfTest) {
    const tmp = join(SCRIPTS, '.label-selftest.sh');
    const cases = [
      { name: '过期文案必须红', body: 'L_STALE="我同意该服务端提供的服务条款与隐私政策"', want: true },
      { name: '现存文案不许红', body: 'L_LIVE="注册 / 登录"', want: false },
      { name: '改名后的 testID 必须红', body: 'ID_GONE="mobile-auth-gone"', want: true },
      { name: '现存 testID 不许红', body: 'ID_LIVE="mobile-auth-form-submit"', want: false },
      { name: '引用了没定义的锚点必须红', body: 'echo "$L_NOT_DEFINED_ANYWHERE"', want: true },
      { name: '定义了再引用不许红', body: 'L_OK="注册 / 登录"\necho "$L_OK"', want: false },
    ];
    let failed = 0;
    for (const c of cases) {
      // eslint-disable-next-line no-restricted-syntax -- 自测要写一个临时脚本，位置固定且立刻删。
      const source = `#!/bin/bash\n${c.body}\n`;
      // 用 writeFileSync 会引入 import；这里用最直接的方式：由调用方 shell 创建更麻烦，
      // 所以复用 readFileSync 的兄弟模块。
      writeFileSync(tmp, source);
      const result = audit(tmp, zhTable, idSet, new Set());
      unlinkSync(tmp);
      const got = result.red;
      const okArm = got === c.want;
      if (!okArm) failed += 1;
      console.log(`   臂「${c.name}」⇒ ${got ? '红' : '绿'}（期望 ${c.want ? '红' : '绿'}）${okArm ? ' ✅' : ' ❌'}`);
    }
    console.log(`   ARMS=${String(cases.length)} FAIL=${String(failed)}`);
    process.exit(failed === 0 ? 0 : 1);
  }

  // 脚本会 source `scripts/lib/*.sh`，那里面定义的锚点也算"有定义"。
  const libAnchors = new Set();
  for (const name of readdirSync(join(SCRIPTS, 'lib'))) {
    if (!name.endsWith('.sh')) continue;
    for (const defined of definedAnchors(readFileSync(join(SCRIPTS, 'lib', name), 'utf8'))) {
      libAnchors.add(defined);
    }
  }

  const files = readdirSync(SCRIPTS)
    .filter((name) => /^verify-mobile-.*\.sh$/.test(name))
    .sort();
  let red = 0;
  let checked = 0;
  for (const file of files) {
    const result = audit(join(SCRIPTS, file), zhTable, idSet, libAnchors);
    checked += result.checked;
    if (!result.red) continue;
    red += 1;
    console.log(`🔴 ${file}`);
    for (const problem of result.problems) console.log(`     · ${problem}`);
  }
  console.log('');
  console.log(
    red === 0
      ? `✅ 设备腿的界面锚点与真源一致（${String(files.length)} 个脚本、${String(checked)} 个锚点）。`
      : `🔴 ${String(red)} 个脚本的锚点已经过期 —— 它们指向的文案或 testID 在界面上不存在了。`,
  );
  process.exit(red === 0 ? 0 : 1);
}

/** self-test 需要写临时文件；单独封装，避免顶部再引一堆 fs 名字。 */
function requireFs() {
  // 顶层已 `import { readFileSync, readdirSync, existsSync }`；这里补两个。
  return fsExtra;
}

import { writeFileSync, unlinkSync } from 'node:fs';
const fsExtra = { writeFileSync, unlinkSync };

main();
