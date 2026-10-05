#!/usr/bin/env node
/* `check-image-license-coverage.mjs` 那张 `IMAGE_ONLY_PACKAGES` 登记表的**变异臂**（审计 §8.149）。
 *
 * 为什么单独一个文件、而不是把 `--mutation` 加进那个门禁本身：
 *   那枚文件是本批与 `main` 的**七枚冲突路径之一**（§8.145 那张身份表）。往它里面加 60 行
 *   装置代码 = 把落地那一刻的合并面再撑宽一层，而这几行判据撑不起那个代价。
 *   所以这里**改的是它的一次性副本**，原件一个字节都不动。
 *
 * 这三条臂回答的是"这张表有没有牙"（此前只有通过读数）：
 *   A 摘掉一枚真登记        ⇒ 该条必须变成"门禁从没见过"（rc≠0）
 *   B 塞一条幽灵登记        ⇒ 必须报"已经不在快照里了"（不许把豁免停在表里不管现实）
 *   C 把 carrier 写成后门值 ⇒ 必须报"不是 snapshot / installed-tree 之一"
 *                             （这个字段只能声明"我属于哪种载体"，不能当逃避过期检查的开关）
 * 外加**未变异对照组**：门禁绿时这三条臂都不该被触发。
 *
 * 两种载体都能跑：
 *   · 不带参数 ⇒ `snapshot`（提交物锁导出的那棵树，不需要 docker）。
 *   · `--installed-tree <dump.json>` ⇒ **跑起来的镜像里那棵树**。导那份 dump 不是"构建窗口级"的贵事
 *     （这里一度把它登记成"排在落地后"，那句是错的）：一条秒级的一次性容器就够，
 *     命令形状照 `scripts/verify-selfhost-stack.sh` 里那一条抄，不要凭记忆拼：
 *       docker run --rm -i --entrypoint node supersync:selfhost-verify --input-type=commonjs - \
 *         < research/tools/dump-installed-tree.js > /tmp/tree.json
 *
 * 用法：node research/tools/selfhost-license-coverage-arms.mjs
 *       node research/tools/selfhost-license-coverage-arms.mjs --installed-tree /tmp/tree.json
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_FILE = join(ROOT, 'research/tools/check-image-license-coverage.mjs');
const HEAD = 'const IMAGE_ONLY_PACKAGES = {\n';
const FAKE_ID = '__pubcheck-ghost@9.9.9';

const rep = (s, needle, withWhat, expectHits) => {
  const hits = s.split(needle).length - 1;
  if (hits !== expectHits) throw new Error(`锚点命中 ${hits} 次，期望 ${expectHits}：${needle.slice(0, 50)}`);
  return s.replaceAll(needle, withWhat);
};
const dropEntry = (s, key) => {
  const lines = s.split('\n');
  const i = lines.findIndex((l) => l.includes(`'${key}': {`));
  if (i < 0) throw new Error(`登记表里没有这一项：${key}（表被改名了？先看清再改这条臂）`);
  let j = i;
  while (j < lines.length && lines[j].trim() !== '},') j += 1;
  if (j >= lines.length) throw new Error(`找不到 ${key} 的收尾`);
  return [...lines.slice(0, i), ...lines.slice(j + 1)].join('\n');
};
const firstKey = (s) => {
  // 整枚 key（含 @version）在**一**对引号里：'@node-rs/argon2-linux-x64-gnu@2.2.1': { …
  const m = s.slice(s.indexOf(HEAD) + HEAD.length).match(/^\s*'([^']+)': \{/m);
  if (!m) throw new Error('从表里取不出第一枚登记项的名字（臂的前提没了）');
  return m[1];
};

/** 真树载体下必须挑一枚**在这棵树里**的登记项：表里有些条目声明 `carrier: 'snapshot'`，
 *  它们在真树那趟本来就不参与判定 —— 摘那种等于什么都没摘，而"什么都没摘"会被读成"这条臂没牙"
 *  （上一轮那条空臂事故就是这个形状）。找不到任何一枚命中就直接抛错。 */
const treeIds = (file) => {
  const dump = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(dump.packages)) throw new Error(`dump 里没有 packages 数组：${file}`);
  return new Set(dump.packages.map((x) => `${x.name}@${x.version}`));
};
const firstKeyIn = (s, ids) => {
  const keys = [...s.slice(s.indexOf(HEAD) + HEAD.length).matchAll(/^\s*'([^']+)': \{/gm)].map((m) => m[1]);
  if (!keys.length) throw new Error('表里取不出任何登记项（臂的前提没了）');
  const hit = keys.find((k) => ids.has(k));
  if (!hit) throw new Error(`表里 ${keys.length} 枚登记项没有一枚在这棵真树里 —— 这条臂会什么都没摘，别把它读成"没牙"`);
  return hit;
};

export function coverageArms(base, ids) {
  const one = ids ? firstKeyIn(base, ids) : firstKey(base);
  return [
    ['对照 未变异（门禁必须绿，且这三条臂都没被触发）', (s) => s, null],
    [`A 摘掉一枚真登记（${one}）`, (s) => dropEntry(s, one), '许可证门禁**从没见过**'],
    ['B 塞一条幽灵登记（不在快照里，也没写 carrier）', (s) => rep(s, HEAD,
      HEAD + `  '${FAKE_ID}': { license: 'MIT', source: 'x', checkedAt: '2026-10-05', why: '假登记' },\n`, 1),
      '已经不在'],
    ['C 把 carrier 写成不存在的载体名（不许当后门）', (s) => rep(s, HEAD,
      HEAD + `  '${FAKE_ID}': { license: 'MIT', source: 'x', checkedAt: '2026-10-05', why: '假登记', carrier: 'whichever' },\n`, 1),
      '不是 snapshot / installed-tree 之一'],
  ];
}

function run(text, tag, tree) {
  const copy = join(ROOT, `research/tools/.covmut-${tag}.tmp.mjs`);
  let out = '';
  let rc = 0;
  try {
    writeFileSync(copy, text);
    out = execFileSync(process.execPath, [copy, ...(tree ? ['--installed-tree', tree] : [])],
      { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    rc = e.status ?? -1;
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  } finally {
    rmSync(copy, { force: true });
  }
  return { out, rc };
}

const argi = process.argv.indexOf('--installed-tree');
if (argi >= 0 && !process.argv[argi + 1]) {
  console.error('❌ --installed-tree 后面要跟文件路径');
  process.exit(2);
}
const TREE = argi < 0 ? null : process.argv[argi + 1];
const base = readFileSync(SRC_FILE, 'utf8');
let bad = 0;
for (const [name, apply, needle] of coverageArms(base, TREE ? treeIds(TREE) : null)) {
  const { out, rc } = run(apply(base), name.split(' ')[0], TREE);
  // 对照组判"绿"，三条变异臂判"rc≠0 且报错里出现那一行判据本体"——
  // 只看 rc≠0 不够：任何语法错误都会红，而那条红与这张表无关。
  const ok = needle === null ? rc === 0 : (rc !== 0 && out.includes(needle));
  if (!ok) bad += 1;
  console.log(`${ok ? '  ok' : 'RED '} ${name} ⇒ rc=${rc}${needle ? `，判据句「${needle}」${out.includes(needle) ? '命中' : '没命中'}` : ''}`);
}
console.log(`许可证登记表变异臂：载体=${TREE ? 'installed-tree（跑起来的镜像里那棵树）' : 'snapshot（提交物锁导出的树）'} · 4 条 · 不符 ${bad}`);
if (bad) {
  console.log('❌ 有臂没红 ⇒ 那张表在这一侧没有牙（或者锚点漂了，看上面那行 rc 与命中）');
  process.exit(1);
}
console.log('✅ 摘掉/塞假/走后门 三条各红一次；对照组未变异时不红。');
