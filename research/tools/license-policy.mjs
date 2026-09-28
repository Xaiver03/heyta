/**
 * 许可证政策的**唯一真源**：白名单、限制清单、以及"白名单外已复核"的登记表。
 *
 * 为什么要单独一个模块：
 *   仓库现在有**两个**许可证扫描器 —— npm 侧（`license-inventory.mjs`）与
 *   NuGet/.NET 侧（`nuget-license-inventory.mjs`）。两边如果各维护一份白名单，
 *   就一定会漂移；而**漂移的规则比没有规则更危险**（照着过期的那份执行，
 *   而且没人知道哪份是对的）—— 这条纪律整个仓库都写在 `CLAUDE.md` 里。
 *
 * 🔴 存在的理由（原本写在 `license-inventory.mjs` 里，此处保留其原意）：
 *   这个脚本以前把"需归类"（`other`）**只打印、不判定** —— 退出码里完全不含 `other`，
 *   于是它打印完 `❔ 其他（需归类）: 1` 之后接着报 `结论：全部依赖均为宽松许可 ✅`
 *   并退出 **0**。那等于**这一档永远不会失败**：白名单是显式枚举的，所以任何不在表里的
 *   许可都会落进 `other` 并被静默放行 —— 正好是白名单想拦的那一类。
 *
 *   现在的语义：`other` **默认失败**，只有在 `REVIEWED_OTHER` 里逐项登记
 *   （并写明为什么可以接受）才放行。加一条的成本是刻意的 —— 它逼人为这个许可
 *   做一次真正的判断，而不是让它悄悄混进"全部宽松"里。
 */

/** 宽松许可：允许闭源商用。 */
export const PERMISSIVE = [
  'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause',
  '0BSD', 'Unlicense', 'CC0-1.0', 'Python-2.0', 'BlueOak-1.0.0',
  'MIT-0', 'Apache-2.0 WITH LLVM-exception', 'Zlib',
  // MPL-2.0 是**文件级** copyleft：改动过的文件要开源，但可以与闭源代码链接、
  // 一起分发。heyta 的政策明确允许（见 docs/02-licensing-and-compliance.md）。
  // 漏了它会把 lightningcss 误报成"待判断"。
  'MPL-2.0',
];

/** 需要人判断或明确禁止。 */
export const RESTRICTED = [
  'AGPL', 'GPL', 'LGPL', 'SSPL', 'BUSL', 'BSL', 'FSL', 'Elastic',
  'CC-BY-NC', 'CC-BY-SA', 'EUPL', 'OSL', 'CPAL', 'Commons Clause',
];

/**
 * 白名单**之外**、但已逐个复核并接受的许可证。
 * 键是许可证标识，值是**接受它的理由**（会被打印出来，所以必须说清楚）。
 */
export const REVIEWED_OTHER = {
  'CC-BY-4.0':
    'caniuse-lite@1.0.30001812：browserslist 的**构建期数据包**，不进入运行时产物；' +
    'CC-BY 是署名许可（不是禁用的 CC-BY-NC），归属已在 THIRD_PARTY_LICENSES.md §2 登记。',
};

/** 把各来源的许可证字段（字符串 / `{type}` / 数组）压成一个字符串。 */
export const normalizeLicense = (raw) => {
  if (raw == null) return 'UNKNOWN';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    if (typeof raw.type === 'string') return raw.type;
    if (Array.isArray(raw)) return raw.map(normalizeLicense).join(' OR ');
  }
  if (Array.isArray(raw)) return raw.map(normalizeLicense).join(' OR ');
  return 'UNKNOWN';
};

/** 归类成 `permissive` / `restricted` / `other` / `unknown`。 */
export const classifyLicense = (lic) => {
  const up = lic.toUpperCase();
  if (lic === 'UNKNOWN') return 'unknown';
  // 先判限制类：'MIT OR GPL-3.0' 这种双许可要人看
  if (RESTRICTED.some((k) => up.includes(k.toUpperCase()))) return 'restricted';
  if (PERMISSIVE.some((k) => up.includes(k.toUpperCase()))) return 'permissive';
  return 'other';
};
