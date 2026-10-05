/**
 * `research/tools/dump-installed-tree.js` —— 在**跑起来的镜像里面**枚举真正装上的包，
 * 连它们各自 `package.json` 里声明的 license 一起打出来。
 *
 * 为什么要在容器里跑、而不是在宿主机上解析 lockfile：
 * `check:image-license-coverage` 今天对的是**预测快照**（`gen-image-npm-tree.mjs` 替 npm
 * 解析出来的一棵树）。审计 §8.43 量到预测与真树之间确实有漂移，而漂移正是这条门禁存在的意义 ——
 * 所以判据的输入必须是**产物本身**，不能又是另一次预测。
 *
 * 用法（由 `scripts/verify-selfhost-stack.sh` 调，不单独跑）：
 *   docker run --rm -i --entrypoint node <image> --input-type=commonjs - < 本文件 > tree.json
 *
 * 🔴 输出里的 `license` 是从**镜像内那个包自己的 package.json** 读的，不是从注册表、
 * 也不是从人抄的表 —— 对账时"登记的 license ≠ 包自己声明的 license"要能红，靠的就是这一列。
 */
const { readdirSync, readFileSync, existsSync } = require('fs');

const ROOTS = ['/app/node_modules', '/app/server/node_modules'];
const root = ROOTS.find((r) => existsSync(r));
if (!root) {
  console.error(JSON.stringify({ error: 'node_modules 不在预期位置', tried: ROOTS }));
  process.exit(1);
}

const packages = [];
let scannedEntries = 0;

// 🔴 必须递归下钻嵌套的 node_modules：只数顶层会**漏掉版本与顶层不同的嵌套副本**。
// 实测漏了 4 条（`fastify-plugin@5.1.0` / `fast-uri@3.1.8` / `process-warning@4.0.1` /
// `tslib@1.14.1`，审计 §8.45），而它们在 lock 里都是非 dev —— 也就是**真的装在镜像里**、
// 真的会被用户跑到，却不在任何一条许可证判据的输入里。
const pending = [root];
const queued = new Set([root]);
const readMeta = (full) => {
  try {
    return JSON.parse(readFileSync(`${full}/package.json`, 'utf8'));
  } catch {
    return null;
  }
};
const takeLevel = (dir) => {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    scannedEntries += 1;
    if (ent.name === '.bin' || ent.name.startsWith('.')) continue;
    const full = `${dir}/${ent.name}`;
    if (ent.name.startsWith('@') && ent.isDirectory()) {
      for (const sub of readdirSync(full, { withFileTypes: true })) {
        scannedEntries += 1;
        if (sub.name.startsWith('.')) continue;
        addPackage(`${full}/${sub.name}`, `${ent.name}/${sub.name}`);
      }
      continue;
    }
    addPackage(full, ent.name);
  }
};
function addPackage(full, dirName) {
  const meta = readMeta(full);
  if (!meta) {
    packages.push({ name: dirName, version: 'UNREADABLE', license: null, dirName });
  } else {
    packages.push({
      name: meta.name || dirName,
      version: meta.version || '?',
      license: typeof meta.license === 'string' ? meta.license : null,
      dirName,
    });
  }
  const nested = `${full}/node_modules`;
  if (existsSync(nested) && !queued.has(nested)) {
    queued.add(nested);
    pending.push(nested);
  }
}
while (pending.length) takeLevel(pending.shift());

packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));

let lock = null;
try {
  lock = JSON.parse(readFileSync('/app/package-lock.json', 'utf8'));
} catch {
  lock = null;
}
// lock 的键是**路径**，包名不在值里（`p.name` 恒 undefined —— 第一版探针就栽在这儿，
// 数出"去重后 0 条"）。所以名字从键的最后一个 `node_modules/` 之后切出来。
const nameFromKey = (k) => k.slice(k.lastIndexOf('node_modules/') + 'node_modules/'.length);
const lockEntries = lock
  ? Object.entries(lock.packages || {})
      .filter(([k, p]) => k && !p.dev)
      .map(([k, p]) => ({
        id: `${nameFromKey(k)}@${p.version || '?'}`,
        optional: p.optional === true,
        license: typeof p.license === 'string' ? p.license : null,
      }))
  : null;

console.log(
  JSON.stringify({
    root,
    scannedEntries,
    count: packages.length,
    packages,
    // 构建期 npm 自己写的 lock（不是提交物）。记两件事：
    // ① 它存在、里面每个平台变体都是 optional（审计 §8.43 的前置 ③）；
    // ② 它的**非 dev 条目集**是 npm 自己记下的"该装哪些"，用来和上面那份磁盘枚举
    //    互相印证 —— 两个独立载体对不上，就说明有一方坏了，而不是"没事"。
    lockfile: lock
      ? {
          exists: true,
          lockfileVersion: lock.lockfileVersion,
          packagesKeyCount: Object.keys(lock.packages || {}).length,
          optionalVariants: Object.keys(lock.packages || {}).filter(
            (k) => lock.packages[k].optional === true,
          ).length,
          nonDevCount: lockEntries.length,
          devCount: Object.entries(lock.packages || {}).filter(([k, p]) => k && p.dev).length,
        }
      : { exists: false },
    lockEntries,
  }),
);
