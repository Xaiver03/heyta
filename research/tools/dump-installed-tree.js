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
const walk = (dir, prefix) => {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    scannedEntries += 1;
    if (ent.name === '.bin' || ent.name.startsWith('.')) continue;
    const full = `${dir}/${ent.name}`;
    if (ent.name.startsWith('@') && !prefix) {
      walk(full, `${ent.name}/`);
      continue;
    }
    let meta = {};
    try {
      meta = JSON.parse(readFileSync(`${full}/package.json`, 'utf8'));
    } catch {
      packages.push({ name: `${prefix}${ent.name}`, version: 'UNREADABLE', license: null });
      continue;
    }
    packages.push({
      name: meta.name || `${prefix}${ent.name}`,
      version: meta.version || '?',
      license: typeof meta.license === 'string' ? meta.license : null,
      dirName: `${prefix}${ent.name}`,
    });
  }
};
walk(root, '');

packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));

let lock = null;
try {
  lock = JSON.parse(readFileSync('/app/package-lock.json', 'utf8'));
} catch {
  lock = null;
}

console.log(
  JSON.stringify({
    root,
    scannedEntries,
    count: packages.length,
    packages,
    // 构建期 npm 自己写的 lock（不是提交物）。记下来是为了让"这把 lock 存在、
    // 里面每个平台变体都是 optional"这类读数可复核（审计 §8.43 的前置 ③）。
    lockfile: lock
      ? {
          exists: true,
          lockfileVersion: lock.lockfileVersion,
          packagesKeyCount: Object.keys(lock.packages || {}).length,
          optionalVariants: Object.keys(lock.packages || {}).filter(
            (k) => lock.packages[k].optional === true,
          ).length,
        }
      : { exists: false },
  }),
);
