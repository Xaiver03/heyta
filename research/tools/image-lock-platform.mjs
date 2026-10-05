// 🔧 heyta 新增（G-53）：**读 npm 锁里的"平台闸门"字段**的唯一实现。
//
// 为什么要有这个文件：同一套字段读法以前只住在 `gen-image-npm-tree.mjs` 里
// （`os` / `cpu` / `engines.libc` 三个数组 + "缺字段=不限制"）。G-53 那条判据要的是
// **反向**的集合 —— 不是"这台目标机器会装哪几枚"，而是"**所有**被平台闸门管着的条目"，
// 因为一条只在 arm64 上跑才看见 arm64 变体、只在 x64 上跑才看见 x64 变体的门禁，
// 在"承诺发哪几个架构"拍板之前，任何单台机器上的绿都不覆盖承诺面。
// 两处各写一遍字段读法 = 下一次漂移的起点，所以抽到这里，两个消费者共用：
//  · `gen-image-npm-tree.mjs` —— `platformGateOf()` + `gateAllowsTarget()`（按 TARGET 过滤）
//  · `check-image-license-coverage.mjs` —— `lockPlatformEntries()`（挑出全部平台受限条目逐条判许可证）
//
// ⚠️ 这里只有**读法**，没有策略。宽松表 / REVIEWED_OTHER / 登记表的裁决一律留在消费者那边 ——
// 一个共享模块里同时住两套策略，就是"两套定义会漂"的那个形状。

export const NPM_LOCK_V3 = 3;

/** 锁的键是路径（`node_modules/ajv/node_modules/fast-uri`），包名**不在值里**。 */
export function lockPackageNameFromKey(key) {
  const at = key.lastIndexOf('node_modules/');
  return at < 0 ? null : key.slice(at + 'node_modules/'.length);
}

/**
 * 一条锁条目的平台闸门。三个字段缺任一个数组 = 该维度不限制
 * （这是 npm 自己的语义，不是我们的约定 —— 所以"空数组"按不限制处理，
 * 实测 lock v3 里没有空数组的条目，但这个形状决定了过滤方向）。
 */
export function platformGateOf(entry) {
  const os = Array.isArray(entry.os) && entry.os.length ? entry.os : null;
  const cpu = Array.isArray(entry.cpu) && entry.cpu.length ? entry.cpu : null;
  const libc =
    entry.engines && Array.isArray(entry.engines.libc) && entry.engines.libc.length
      ? entry.engines.libc
      : null;
  return { os, cpu, libc, restricted: Boolean(os || cpu || libc) };
}

/** 这个闸门放不放行 `target`（`{os, cpu, libc}`）。三个维度是 AND。 */
export function gateAllowsTarget(gate, target) {
  if (gate.os && !gate.os.includes(target.os)) return false;
  if (gate.cpu && !gate.cpu.includes(target.cpu)) return false;
  if (gate.libc && !gate.libc.includes(target.libc)) return false;
  return true;
}

/**
 * 把锁拆成"非 dev 的条目清单"（每条带上平台闸门）+ 总键数（给消费者做输入哈希用）。
 * 抛错而不是返回空集：`{}` / lockfileVersion 不是 3 / 没有 packages 数组，
 * 这三种形态在消费者那里都**必须**变成红，不能变成"没有平台变体 ⇒ 判定成立"。
 */
export function readImageLock(lockText, { source = 'server/package-lock.json' } = {}) {
  let lock;
  try {
    lock = JSON.parse(lockText);
  } catch (e) {
    throw new Error(`${source} 读不出 JSON：${e.message}`);
  }
  if (lock.lockfileVersion !== NPM_LOCK_V3) {
    throw new Error(
      `${source} 的 lockfileVersion=${String(lock.lockfileVersion)}，不是 ${NPM_LOCK_V3}` +
        ' —— 下面的读法假设"键是 node_modules/<name> 路径、包名不在值里"（npm v7+ 的形状）',
    );
  }
  const packages = lock.packages;
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
    throw new Error(`${source} 里没有 packages 对象 —— 没有输入不等于没有平台变体`);
  }
  const entries = [];
  let totalKeys = 0;
  for (const [key, entry] of Object.entries(packages)) {
    if (key) totalKeys += 1;
    const name = lockPackageNameFromKey(key);
    if (!name || !entry || !entry.version) continue; // 根条目 "" / 没有版本形状的条目
    if (entry.dev) continue;
    entries.push({
      key,
      name,
      version: entry.version,
      id: `${name}@${entry.version}`,
      optional: entry.optional === true,
      license: typeof entry.license === 'string' ? entry.license : null,
      gate: platformGateOf(entry),
    });
  }
  return { entries, totalKeys };
}
