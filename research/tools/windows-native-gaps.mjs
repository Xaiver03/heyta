/**
 * W0-3：**heyta 自己的**原生依赖在 Windows 上的缺口清单。
 *
 * 为什么需要这个脚本，而不是在文档里写死一个数字：
 *
 *   ADR-0032 曾用生态级数字描述 Windows 缺口（"RN Directory 2716 个库里只有 73 个
 *   支持 Windows = 2.8%"）。那个数字**不是 heyta 的暴露面** —— 实测 apps/mobile
 *   只有 4 个原生库。而这个数字**会随 `apps/mobile` 的依赖变化而失效**，
 *   所以它必须能被一条命令重新数出来，而不是靠人记得去改文档。
 *
 * 三个数据源，各自回答一个问题：
 *
 *   1. `apps/mobile/package.json` —— 我们**实际**声明依赖了什么（唯一真源）
 *   2. npm registry 的 manifest —— 上游仓库在哪、许可证、**有没有 codegenConfig**
 *   3. GitHub 的 `/tree/HEAD/windows` HTTP 状态 —— 上游**有没有** Windows 实现
 *      （RN Directory 是**自愿登记**的：本仓实测 `react-native-svg` 有完整
 *        `windows/` 目录却**没有**登记 Windows ⇒ 不能拿登记当否证）
 *
 * 🔴 **"这个包是不是原生模块"这件事故意不自动判定。**
 *    第一版按"上游有没有 windows/ 目录"一刀切，结果把 `react` / `fast-text-encoding`
 *    / `lucide-react-native` 这些**纯 JS** 包全报成了"缺口"（7 个）——
 *    一个会撒谎的数字比没有数字更糟。所以原生模块清单是**显式手维护**的，
 *    每条都写清"凭什么说它是原生"，而脚本负责**证明这份清单没有过期**：
 *      · 清单里的包不再是 apps/mobile 的直接依赖 → 报警（清单过期）
 *      · 某个直接依赖声明了 `codegenConfig` 却不在清单里 → 报警（可能漏了）
 *
 * ⚠️ **这不是门禁**，不要加进 `pnpm check`：它要联网（npm + github.com），
 *    网络抖动会让门禁变成掷硬币。它是**人工跑的审计工具**，
 *    产物贴进文档时请注明日期。
 *
 * 用法：
 *   node research/tools/windows-native-gaps.mjs          # 打印 markdown
 *   node research/tools/windows-native-gaps.mjs --json   # 打印 JSON
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOBILE_PKG = join(ROOT, 'apps', 'mobile', 'package.json');
const DIRECTORY_URL =
  'https://raw.githubusercontent.com/react-native-community/directory/main/react-native-libraries.json';

/**
 * 显式手维护：`apps/mobile` 用到的**带原生代码**的包。
 * `why` 是判定依据，不是"备注" —— 它要能被人复核。
 */
const NATIVE_DEPS = new Map([
  [
    '@op-engineering/op-sqlite',
    { why: 'SQLite 的 JSI/C++ 绑定（含 iOS podspec + android/ 原生工程）' },
  ],
  [
    'react-native-safe-area-context',
    { why: '安全区插值的原生实现（iOS podspec + android/ 原生工程）' },
  ],
  [
    'react-native-get-random-values',
    { why: '把 crypto.getRandomValues 接到各平台原生 RNG（iOS/Android 原生实现）' },
  ],
  [
    'react-native-svg',
    { why: 'SVG 渲染的原生视图（iOS podspec + android/ 原生工程）' },
  ],
]);

/**
 * 框架本身不算"漏报的原生依赖"：`react-native` 自己声明了 codegenConfig
 * （框架的 Fabric/TurboModule 基础设施就在它里面），但它的 Windows 支持
 * **由壳提供**（RNW），不是"某个第三方库缺 Windows 实现"那一类问题。
 * 不排除的话自检每次都会喊狼来了。
 */
const FRAMEWORK_DEPS = new Set(['react-native', 'react']);

/** 从 npm 的 repository 字段里抠出 { owner, repo }。`git+https://github.com/a/b.git` 这类都要认。 */
function parseRepo(repository) {
  const url = typeof repository === 'string' ? repository : repository?.url;
  if (typeof url !== 'string') return null;
  const match = /github\.com[/:]([^/]+)\/([^/.#]+)/.exec(url);
  if (match === null) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

const statusOf = async (url) => {
  try {
    return (await fetch(url, { redirect: 'follow' })).status;
  } catch {
    return 0;
  }
};

const main = async () => {
  const pkg = JSON.parse(readFileSync(MOBILE_PKG, 'utf8'));
  const deps = Object.entries(pkg.dependencies ?? {})
    .filter(([name]) => !name.startsWith('@heyta/'))
    .map(([name, range]) => ({ name, range }));

  const directory = await (await fetch(DIRECTORY_URL)).json();
  const byName = new Map(directory.map((entry) => [entry.npmPkg, entry]));
  const directoryWindowsCount = directory.filter((entry) => entry.windows === true).length;

  const rows = [];
  for (const dep of deps) {
    const entry = byName.get(dep.name);
    const meta = await (await fetch(`https://registry.npmjs.org/${dep.name}`)).json();
    const manifest = meta.versions?.[meta['dist-tags']?.latest] ?? {};
    const repo = parseRepo(manifest.repository);
    // 🔴 查上游本身，而不是只信 Directory。`HEAD` 让 GitHub 自己解析默认分支，
    // 省掉 main/master 猜错的问题。
    const upstreamWindows =
      repo === null
        ? 0
        : await statusOf(`https://github.com/${repo.owner}/${repo.repo}/tree/HEAD/windows`);

    rows.push({
      name: dep.name,
      declaredRange: dep.range,
      license: manifest.license ?? '(未声明)',
      repo: repo === null ? null : `https://github.com/${repo.owner}/${repo.repo}`,
      codegenConfig: manifest.codegenConfig !== undefined,
      directoryListed: entry !== undefined,
      directoryWindows: entry?.windows === true,
      upstreamWindowsDirStatus: upstreamWindows,
      isNativeDeclared: NATIVE_DEPS.has(dep.name),
    });
  }

  // ── 清单自检：一个会撒谎的清单比没有清单更糟 ────────────────────────────
  const depNames = new Set(rows.map((row) => row.name));
  const staleListEntries = [...NATIVE_DEPS.keys()].filter((name) => !depNames.has(name));
  const possiblyMissed = rows.filter(
    (row) => row.codegenConfig && !NATIVE_DEPS.has(row.name) && !FRAMEWORK_DEPS.has(row.name),
  );

  const nativeRows = rows.filter((row) => row.isNativeDeclared);
  const gaps = nativeRows.filter((row) => row.upstreamWindowsDirStatus !== 200);

  if (process.argv.includes('--json')) {
    process.stdout.write(
      `${JSON.stringify(
        {
          auditedAt: new Date().toISOString(),
          directoryWindowsCount,
          rows,
          staleListEntries,
          possiblyMissed: possiblyMissed.map((r) => r.name),
          gaps: gaps.map((r) => r.name),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  console.log(`直接依赖（去掉 @heyta/* workspace 包）：${rows.length} 个`);
  console.log(`其中**声明为原生模块**的：${nativeRows.length} 个（显式清单，见脚本 NATIVE_DEPS）`);
  console.log(`（对照：RN Directory 全库 ${directory.length} 个包里，声明支持 Windows 的 ${directoryWindowsCount} 个 —— 那是生态口径，不是我们的暴露面）\n`);

  console.log('| 依赖 | 我们声明的版本 | 原生? | RN Directory 声明 Windows | 上游 `windows/` | 许可证 | 判定 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const row of rows) {
    const declared = row.directoryWindows ? '✅ 声明' : row.directoryListed ? '❌ 未声明' : '— 未登记';
    const upstream =
      row.repo === null
        ? '— 非 GitHub'
        : row.upstreamWindowsDirStatus === 200
          ? '✅ 有'
          : `❌ HTTP ${row.upstreamWindowsDirStatus}`;
    const verdict = !row.isNativeDeclared
      ? '· 纯 JS，不适用'
      : row.upstreamWindowsDirStatus === 200
        ? '✅ 有 Windows 实现'
        : '🔴 **缺口**';
    console.log(
      `| \`${row.name}\` | ${row.declaredRange} | ${row.isNativeDeclared ? '是' : '否'} | ${declared} | ${upstream} | ${row.license} | ${verdict} |`,
    );
  }

  console.log('');
  console.log(`🔴 **Windows 缺口 ${gaps.length} 个**：${gaps.map((r) => `\`${r.name}\``).join('、') || '无'}`);
  for (const gap of gaps) {
    console.log(`   · \`${gap.name}\` —— 凭什么算原生：${NATIVE_DEPS.get(gap.name).why}`);
  }

  console.log('');
  if (staleListEntries.length > 0) {
    console.log(`⚠️ NATIVE_DEPS 清单**已过期**（这些包不再是 apps/mobile 的直接依赖）：${staleListEntries.join('、')}`);
  }
  if (possiblyMissed.length > 0) {
    console.log(
      `⚠️ 可能**漏报**的原生依赖（声明了 codegenConfig 但不在 NATIVE_DEPS 里）：${possiblyMissed.map((r) => r.name).join('、')}`,
    );
  }
  if (staleListEntries.length === 0 && possiblyMissed.length === 0) {
    console.log('✅ NATIVE_DEPS 清单自检通过：没有过期条目，也没有漏掉的 codegenConfig 包。');
  }

  console.log('');
  console.log('⚠️ 判定口径：');
  console.log('   · "原生"是**显式手维护**的清单，不是启发式 —— 按目录一刀切会把纯 JS 包');
  console.log('     （react / fast-text-encoding / lucide-react-native）全报成缺口。');
  console.log('   · RN Directory 登记是**自愿**的：react-native-svg 有完整 windows/ 目录却');
  console.log('     没有登记 Windows ⇒ "未登记"不能当作不支持。');
  console.log('   · "上游有 windows/ 目录"**不代表**它支持 RNW 的 New Architecture ——');
  console.log('     那要单独核（见 docs/plans/desktop-native-migration.md §2.6）。');
};

await main();
