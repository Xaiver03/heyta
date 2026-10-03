// 镜像里装的东西 vs pnpm lockfile 的生产树 —— **对账度量，不是门禁**。
// 用法：node research/tools/image-tree-vs-pnpm-lock.mjs        （不联网、不装、不起 docker）
//
// 为什么单独成一个文件：G-47 登记写的是"差 16/143"，那是一个**混合数** —— 名字差与版本差被算进
// 同一个数，所以它既回答不了"许可证门禁漏没漏东西"，也回答不了"把树钉住会改掉几个包"。
// 这里把两件事分开量。现量与结论在 docs/research/self-host-distribution-audit.md §8.30。
//
// 🔴 两个 v9 lockfile 的解析陷阱（两趟坏探针的症状都长得像"发现"）：
//  · 依赖边在 `snapshots:` 段，不在 `packages:`（后者只有 resolution）⇒ 只读 packages 会停在直接依赖；
//  · 叶子节点写成 `zod@4.6.5: {}`（**同一行内联空映射**），按"整行以 : 结尾"提键会把整串当键名。
// 所以本文件带两条自检：树大小 < 100 直接退 2，外加三枚"必须是传递引入"的阳性对照。
//
// ⚠️ 它没挂进 `pnpm check`：A（镜像里用 pnpm 按 lockfile 装）会让整套快照+覆盖率对账**失去对象**，
// B（继续 npm 但钉住版本）今天会改掉 14 个包的版本。取舍没拍板之前，把它做成门禁就是替一个
// 还没定的答案预置判据。拍板之后再决定它是门禁还是留度量。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, normalize } from 'node:path';

// ⚠️ 必须走 fileURLToPath：仓库父目录名带空格（"All in one Data"），
// new URL(...).pathname 会留下 %20，症状是一句看起来像"文件没建"的 ENOENT。
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const lock = readFileSync(`${ROOT}/pnpm-lock.yaml`, 'utf8').split('\n');

const strip = (s) => s.replace(/^'+/, '').replace(/'+$/, '').replace(/^"+/, '').replace(/"$/, '');
const indent = (l) => l.match(/^ */)[0].length;
/**
 * 取"键行"的键名。🔴 不能要求整行以 `:` 结尾 —— v9 的 snapshots 里叶子节点写成
 * `zod@4.6.5: {}`（**同一行内联空映射**），按 `:$/` 去处理会把 `zod@4.6.5: {}` 整串当键名，
 * 症状是"79 条解析不到 + 树只有 77 个"，看起来像两棵树差得离谱，其实是键没进去。
 */
const keyOf = (line) => strip(line.slice(0, line.indexOf(':')));

/** importer 键 → { deps, dev }（deps 只含生产依赖） */
const importers = {};
/** 依赖边：节点键 → { deps, optional }。v9 里来自 `snapshots:`。 */
const edges = {};
let section = '';
let imp = null;
let iKind = '';
let iName = null;
let node = null;
let eKind = '';

for (const raw of lock) {
  if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
  const i = indent(raw);
  const line = raw.trim();
  if (i === 0) {
    section = line.replace(/:$/, '');
    imp = null;
    node = null;
    iName = null;
    iKind = '';
    eKind = '';
    continue;
  }
  if (section === 'importers') {
    if (i === 2) {
      imp = keyOf(line);
      importers[imp] = { deps: {}, dev: {} };
      iName = null;
      continue;
    }
    if (!imp) continue;
    if (i === 4) {
      iKind = line.replace(/:$/, '');
      iName = null;
      continue;
    }
    if (i === 6 && line.endsWith(':')) {
      iName = strip(line.replace(/:$/, ''));
      continue;
    }
    if (i === 8 && iName) {
      const idx = line.indexOf(':');
      if (line.slice(0, idx).trim() === 'version') {
        const bag = iKind === 'devDependencies' ? importers[imp].dev : importers[imp].deps;
        bag[iName] = line.slice(idx + 1).trim();
      }
    }
    continue;
  }
  if (section === 'snapshots') {
    if (i === 2) {
      node = keyOf(line);
      edges[node] = { deps: {}, optional: {} };
      eKind = '';
      continue;
    }
    if (!node) continue;
    if (i === 4) {
      eKind = line.replace(/:$/, '');
      continue;
    }
    if (i === 6 && (eKind === 'dependencies' || eKind === 'optionalDependencies')) {
      const idx = line.indexOf(':');
      const name = strip(line.slice(0, idx));
      const v = line.slice(idx + 1).trim();
      const bag = eKind === 'dependencies' ? edges[node].deps : edges[node].optional;
      bag[name] = v;
    }
  }
}

const splitKey = (key) => {
  const at = key.lastIndexOf('@');
  return { name: key.slice(0, at), rest: key.slice(at + 1) };
};
const baseOf = (ref) => ref.replace(/\(.*\)$/, '');
const byName = {};
for (const key of Object.keys(edges)) {
  const { name } = splitKey(key);
  (byName[name] ??= []).push(key);
}

const tree = new Map();
const missing = new Set();
const visited = new Set();
const queue = [];

const addDep = (name, ref, opt) => {
  if (ref.startsWith('link:')) return;
  const exact = `${name}@${ref}`;
  const cands = edges[exact]
    ? [exact]
    : (byName[name] ?? []).filter((k) => baseOf(splitKey(k).rest) === baseOf(ref));
  if (cands.length === 0) {
    missing.add(`${name}@${ref}`);
    return;
  }
  const id = `${name}@${baseOf(ref)}`;
  if (!tree.has(id)) tree.set(id, { optional: opt });
  else if (!opt) tree.get(id).optional = false;
  for (const k of cands) {
    if (!visited.has(k)) {
      visited.add(k);
      queue.push(k);
    }
  }
};

const expandImporter = (path, stack = new Set()) => {
  if (stack.has(path)) return;
  stack.add(path);
  const bag = importers[path];
  if (!bag) throw new Error(`lockfile 里没有 importer「${path}」`);
  for (const [n, v] of Object.entries(bag.deps)) {
    if (v.startsWith('link:')) {
      // link 相对**该 importer 自己的目录**解析；importer 键就是仓库相对路径。
      const target = normalize(join(path, v.slice('link:'.length)));
      if (importers[target]) expandImporter(target, stack);
      else missing.add(`${path} 的 link ${v} → ${target}，lockfile 里没有这个 importer`);
      continue;
    }
    addDep(n, v, false);
  }
};
expandImporter('server');

let guard = 0;
while (queue.length) {
  if ((guard += 1) > 50000) throw new Error('BFS 没收敛');
  const key = queue.shift();
  for (const [n, v] of Object.entries(edges[key].deps)) addDep(n, v, false);
  for (const [n, v] of Object.entries(edges[key].optional)) addDep(n, v, true);
}

const snap = JSON.parse(readFileSync(`${ROOT}/server/image-npm-tree.json`, 'utf8'));
const snapSet = new Set(snap.packages.map((p) => `${p.name}@${p.version}`));
const lockSet = new Set(tree.keys());
const onlyLock = [...lockSet].filter((x) => !snapSet.has(x)).sort();
const onlySnap = [...snapSet].filter((x) => !lockSet.has(x)).sort();
const optInLock = [...tree].filter(([, v]) => v.optional).map(([k]) => k).sort();

console.log(`importers=${Object.keys(importers).length} · snapshots 节点=${Object.keys(edges).length}`);
console.log(`lockfile 生产树 = ${String(lockSet.size)} 个 name@version（走过的 snapshot 节点 ${String(visited.size)}，其中 optional 标记 ${String(optInLock.length)}）`);
console.log(`镜像快照        = ${String(snapSet.size)} 个`);
console.log(`只在 lock 树 (${String(onlyLock.length)}): ${onlyLock.join(', ') || '（无）'}`);
console.log(`只在快照   (${String(onlySnap.length)}): ${onlySnap.join(', ') || '（无）'}`);
console.log(`解析不到 (${String(missing.size)}): ${[...missing].join(' | ') || '（无）'}`);

// 🔴 名称集合与版本集合要分开量 —— "差 27/14" 这种读法会把两件事混一件：
//    名称差 = 装了什么（许可证门禁的覆盖面对象），版本差 = 装的是哪一版。
const lockNames = new Set([...lockSet].map((x) => x.replace(/@[^@]*$/, '')));
const snapNames = new Set(snap.packages.map((p) => p.name));
const onlyLockNames = [...lockNames].filter((n) => !snapNames.has(n)).sort();
const onlySnapNames = [...snapNames].filter((n) => !lockNames.has(n)).sort();
console.log(`名称集合：lock=${String(lockNames.size)} 快照=${String(snapNames.size)} · 只在 lock(${String(onlyLockNames.length)}): ${onlyLockNames.join(', ') || '（无）'} · 只在快照(${String(onlySnapNames.length)}): ${onlySnapNames.join(', ') || '（无）'}`);

// 同名不同版本逐条列出版本对与跨度（major/minor/patch）—— "漂"的严重度得看得见。
const drift = [];
for (const n of [...lockNames].filter((x) => snapNames.has(x))) {
  const lv = [...lockSet].filter((x) => x === `${n}@${x.split('@').pop()}` && x.startsWith(`${n}@`)).map((x) => x.slice(n.length + 1)).sort();
  const sv = snap.packages.filter((p) => p.name === n).map((p) => p.version).sort();
  if (lv.join() !== sv.join()) {
    const a = lv[0];
    const b = sv[0];
    const span = a && b ? (a.split('.')[0] !== b.split('.')[0] ? 'major' : a.split('.')[1] !== b.split('.')[1] ? 'minor' : 'patch') : '?';
    drift.push(`${n}: lock=${lv.join('|')} 快照=${sv.join('|')} [${span}]`);
  }
}
console.log(`同名不同版本 ${String(drift.length)} 条：`);
for (const d of drift) console.log(`   · ${d}`);

// 🔴 探针自检：读出来 <100 个不是"两边都空所以相等"，是解析坏了（第一版就是这样坏的）。
if (lockSet.size < 100) {
  console.log('💥 lock 树 < 100 个 —— 先怀疑这个解析器，不要拿上面的差集当结论');
  process.exit(2);
}
// 阳性对照：两边的树里都必须有 pino 与 prisma —— 它们是被传递依赖引到的，
// 只有解析走到了第二层以后才会出现。
for (const needle of ['pino@', 'prisma@', '@fastify/error@']) {
  const inLock = [...lockSet].some((x) => x.startsWith(needle));
  const inSnap = [...snapSet].some((x) => x.startsWith(needle));
  console.log(`阳性对照 ${needle}：lock=${String(inLock)} 快照=${String(inSnap)}`);
  if (!inLock || !inSnap) {
    console.log(`💥 对照落空（${needle}）—— 差集不可信`);
    process.exit(2);
  }
}
