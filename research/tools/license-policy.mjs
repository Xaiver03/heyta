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

/**
 * **按包名**登记的例外 —— 给那些"许可证是随包附带的文件、不是一个标识符"的包。
 *
 * 🔴 为什么必须按包名，而不是塞进上面的 `REVIEWED_OTHER`：
 *
 *   微软的 Windows App SDK / Windows SDK 组件在 nuspec 里写的是
 *   `<license type="file">license.txt</license>` —— 也就是说**根本拿不到 SPDX 标识符**，
 *   能拿到的只是文件名 `license.txt`。
 *   如果把这个字符串放进 `REVIEWED_OTHER`，那么**任何**将来附带 `license.txt`
 *   的包都会被自动放行 —— 恰好把这道门禁想拦的那一类放过去。
 *   键在包名上，影响面就精确到这几个包。
 *
 * 键是**包名前缀**（写全名也行）；值是接受它的理由，会被打印出来。
 *
 * ⚠️ 前缀是**家族级**决定，不是逐包复核 —— 这是刻意的：微软的 Windows 平台包
 *    （`Microsoft.WindowsAppSDK.*`、`Microsoft.Windows.AI.*`、`Microsoft.Windows.SDK.BuildTools*`）
 *    全都用同一套"随包附带许可文件"的做法，逐包登记只会变成打地鼠
 *    （实测就漏过一个 `Microsoft.Windows.AI.MachineLearning`）。
 *    范围仍然**限于微软自己的命名空间** —— NuGet 把 `Microsoft.*` 前缀保留给微软，
 *    第三方包不能占用，所以这不是"任何带 license.txt 的包都放行"。
 */
export const REVIEWED_LICENSE_FILE_PACKAGES = {
  'Microsoft.Windows':
    '微软的 Windows 平台组件家族（WindowsAppSDK.Base/Foundation/WinUI/Widgets/AI/ML/DWrite/Search/Runtime…、' +
    'Windows.AI.MachineLearning、Windows.SDK.BuildTools 及其 MSIX 工具）：nuspec 用' +
    '`<license type="file">license.txt</license>` 或 `sdk_license.txt`，**没有 SPDX 标识符**。' +
    '它们是 Windows 上的 WinUI 3 壳赖以运行的官方运行时/构建组件，许可允许随应用再分发。' +
    '⚠️ 家族级登记：新增**别的**微软家族请另开一条，不要扩大这一条。',
  'Microsoft.Web.WebView2':
    'WebView2 运行时：随包附带 `LICENSE.txt`，无 SPDX 标识符。由 Windows App SDK 传递引入；' +
    '**heyta 自己的界面不用 WebView**（原生性是本决策的前提），此处仅作为依赖树里的一环登记。',
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
