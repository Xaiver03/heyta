/**
 * 🔴 镜像依赖快照的**新鲜度指纹**：只盖依赖相关字段，不盖整个 package.json。
 *
 * 为什么只盖依赖字段（2026-10-04 收窄，起因是实测）：原先哈希整个文件，
 * 往 `scripts` 里加一条测试名也会让 `--check` 红，而那个改动不影响镜像里
 * 装出来的任何东西。一杆对无关改动乱响的尺子会训练人忽略它——真到依赖
 * 漂移那天反而当噪声放过去。
 *
 * 收窄后仍然盖住全部会改变安装结果的面：dependencies / devDependencies /
 * optionalDependencies / peerDependencies / overrides / engines / packageManager。
 *
 * ⚠️ 生成器（`gen-image-npm-tree.mjs`）与对账器（`check-image-license-coverage.mjs`）
 * **必须共用这一份实现** —— 各抄一份等于两套裁决标准（本仓为这个形状记过多次）。
 * ⚠️ 改 `DEP_FIELDS` 的取值集合 = 换了指纹口径 ⇒ 必须重跑生成器落新快照，
 * 且要在上面写明为什么新集合仍然盖住"真进镜像的东西"。
 */
import { createHash } from 'node:crypto';

export const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
  'engines',
  'packageManager',
];

export function depsFingerprint(pkgJsonText) {
  const pkg = JSON.parse(pkgJsonText);
  const picked = {};
  for (const key of DEP_FIELDS) {
    if (pkg[key] !== undefined) picked[key] = pkg[key];
  }
  return createHash('sha256').update(JSON.stringify(picked)).digest('hex');
}
