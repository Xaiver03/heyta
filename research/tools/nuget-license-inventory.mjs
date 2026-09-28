/**
 * NuGet / .NET 侧的许可证门禁 —— 补上 `check:licenses` 的**结构性盲区**。
 *
 * ## 为什么需要它
 *
 * `license-inventory.mjs` 只扫 **npm 依赖树**。而 heyta 正在长出第二棵依赖树：
 * `apps/desktop-windows`（WinUI 3 / Windows App SDK）会带来一整片
 * **NuGet 世界**的依赖 —— Jint、Microsoft.Data.Sqlite、SQLitePCLRaw、
 * Microsoft.WindowsAppSDK…… 它们对 npm 扫描器**完全不可见**。
 *
 * 🔴 同一个脚本里已经记录过一次同类事故（`license-inventory.mjs` §"Playwright 及其依赖
 * 会**完全不可见**：`check:licenses` 绿着"）。这次的形状一模一样，只是换了生态：
 * **门禁是绿的，因为门禁根本没看那一半。**
 *
 * ## 为什么联网只发生在 `--refresh`
 *
 * 门禁里联网 = 把门禁变成掷硬币（网络抖一下就红，红了还得人去看是不是真问题）。
 * 所以分成两半，和 npm 侧同一套哲学：
 *
 *   · **检查时（默认）**：只跑 `dotnet list package --include-transitive --format json`
 *     读**本机实际还原出来的依赖树**（不联网），再去查**已入库的**清单
 *     `research/nuget-licenses-inventory.json`。清单里没有的包 → 失败。
 *   · **刷新时（`--refresh`）**：联网去 NuGet flatcontainer 拉每个包的 `.nuspec`，
 *     取出 `license` 字段（SPDX expression），重写清单。
 *
 * 这样"引入一个新 NuGet 包"这件事**必须**过一次人工刷新，
 * 而不是悄悄混进"全部宽松"里 —— 与 npm 侧 `REVIEWED_OTHER` 的刻意摩擦同源。
 *
 * ⚠️ **一个实测出来的边界**：`dotnet list package` 会**隐式还原**（implicit restore）——
 *    即使 `obj/` 被删掉（CI 上的干净检出就是如此）它也照样能列出依赖树。
 *    代价是：**NuGet 缓存冷的机器上，这一步要联网**。
 *    也就是说"检查时不联网"这句在**缓存已热**时成立，冷缓存时这一步会去拉包。
 *    （实测：删掉两个 spike 工程的 `obj/` 后仍列出 8 个包，并重建了 `obj/`。）
 *
 * 用法：
 *   node research/tools/nuget-license-inventory.mjs            # 检查（门禁用，不联网）
 *   node research/tools/nuget-license-inventory.mjs --refresh   # 联网刷新清单
 *   node research/tools/nuget-license-inventory.mjs --json
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REVIEWED_OTHER,
  classifyLicense,
  normalizeLicense,
} from './license-policy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const INVENTORY_PATH = join(ROOT, 'research', 'nuget-licenses-inventory.json');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'bin', 'obj', 'dist', 'dist-types', 'release',
  '.pnpm-store', 'upstream', 'standalone', 'parts',
]);

const asJson = process.argv.includes('--json');
const refresh = process.argv.includes('--refresh');
const log = (...args) => {
  if (!asJson) console.log(...args);
};

/** 找出仓库里所有 `*.csproj`（跳过构建产物与不入库的调研目录）。 */
function findProjects(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      findProjects(join(dir, entry.name), found);
    } else if (entry.name.endsWith('.csproj')) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

const hasDotnet = () => {
  try {
    execFileSync('dotnet', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/** 跑 `dotnet list package --include-transitive --format json`，取回 `{ id, version }` 集合。 */
function listPackages(projectPath) {
  const raw = execFileSync(
    'dotnet',
    ['list', projectPath, 'package', '--include-transitive', '--format', 'json'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  // `dotnet list` 有时会在 JSON 前面打印警告行，所以从第一个 `{` 开始截。
  const start = raw.indexOf('{');
  if (start < 0) throw new Error(`dotnet list 没有输出 JSON：${raw.slice(0, 400)}`);
  const parsed = JSON.parse(raw.slice(start));

  const packages = new Map();
  for (const project of parsed.projects ?? []) {
    for (const framework of project.frameworks ?? []) {
      const groups = [framework.topLevelPackages, framework.transitivePackages];
      for (const group of groups) {
        for (const pkg of group ?? []) {
          const version = pkg.resolvedVersion ?? pkg.requestedVersion;
          if (typeof pkg.id !== 'string' || typeof version !== 'string') continue;
          packages.set(`${pkg.id}@${version}`, { id: pkg.id, version });
        }
      }
    }
  }
  return packages;
}

/** 从 NuGet flatcontainer 的 `.nuspec` 里取许可证（SPDX expression）。联网。 */
async function fetchLicense(id, version) {
  const lower = id.toLowerCase();
  const url = `https://api.nuget.org/v3-flatcontainer/${lower}/${version}/${lower}.nuspec`;
  const response = await fetch(url);
  if (!response.ok) {
    return { license: 'UNKNOWN', note: `nuspec HTTP ${response.status}`, projectUrl: null };
  }
  const xml = await response.text();
  const pick = (tag) => {
    const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
    return match === null ? null : match[1].trim();
  };
  // `<license type="expression">MIT</license>` 优先；老包只有 `<licenseUrl>`。
  const license = pick('license') ?? normalizeLicense(pick('licenseUrl'));
  return { license, projectUrl: pick('projectUrl'), authors: pick('authors') };
}

const main = async () => {
  const projects = findProjects(ROOT);

  if (projects.length === 0) {
    log('⚠️  仓库里没有任何 `*.csproj` —— NuGet 许可证检查**已跳过**（没有东西可查）。');
    return 0;
  }

  if (!hasDotnet()) {
    // 🔴 明确"跳过"，而不是假装通过。这正是 ci-and-runner.md §8.1
    //    「看着在跑，其实什么都没验」那一类坑。
    log(`⚠️  未找到 \`dotnet\` —— NuGet 许可证检查**已跳过**。`);
    log(`    待查工程 ${projects.length} 个：${projects.map((p) => relative(ROOT, p)).join(', ')}`);
    log('    ⇒ 这一半依赖树**本轮没有被验过**，不要在报告里当成"已合规"。');
    return 0;
  }

  const packages = new Map();
  for (const project of projects) {
    for (const [key, value] of listPackages(project)) packages.set(key, value);
  }

  log(`扫描 ${projects.length} 个 .NET 工程，依赖树里 ${packages.size} 个包（含传递依赖）。`);

  // ── 刷新模式：联网取许可证，重写清单 ──────────────────────────────
  if (refresh) {
    const inventory = {};
    const sorted = [...packages.keys()].sort();
    for (const key of sorted) {
      const { id, version } = packages.get(key);
      inventory[key] = await fetchLicense(id, version);
    }
    writeFileSync(
      INVENTORY_PATH,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString().slice(0, 10),
          source: 'NuGet flatcontainer 的 .nuspec `license` 字段（SPDX expression）',
          why: '入库存档，好让门禁在**不联网**的情况下也能判定；新增 NuGet 包必须 --refresh 一次。',
          packages: inventory,
        },
        null,
        2,
      )}\n`,
    );
    log(`✅ 已刷新清单：${relative(ROOT, INVENTORY_PATH)}（${sorted.length} 个包）`);
    return 0;
  }

  // ── 检查模式：只读已入库的清单，不联网 ────────────────────────────
  let inventory;
  try {
    inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')).packages;
  } catch (error) {
    log(`❌ 读不到清单 ${relative(ROOT, INVENTORY_PATH)}：${error.message}`);
    log('   先跑一次：node research/tools/nuget-license-inventory.mjs --refresh');
    return 1;
  }

  const missing = [];
  const buckets = { permissive: [], restricted: [], other: [], unknown: [] };
  for (const key of [...packages.keys()].sort()) {
    const entry = inventory[key];
    if (entry === undefined) {
      missing.push(key);
      continue;
    }
    const license = normalizeLicense(entry.license);
    buckets[classifyLicense(license)].push({ key, license });
  }

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ projects: projects.length, packages: packages.size, missing, buckets }, null, 2)}\n`,
    );
  } else {
    log('');
    for (const kind of ['permissive', 'restricted', 'other', 'unknown']) {
      const list = buckets[kind];
      if (list.length === 0) continue;
      const icon = kind === 'permissive' ? '✅' : kind === 'restricted' ? '🔴' : '❔';
      log(`  ${icon} ${kind} : ${list.length}`);
      if (kind !== 'permissive') {
        for (const item of list) log(`     ${item.key}  →  ${item.license}`);
      }
    }
    log('');
  }

  // 🔴 `other` 的语义与 npm 侧**完全一致**：默认失败，只有在 REVIEWED_OTHER
  //    里逐项登记（写明理由）才放行。
  const unreviewedOther = buckets.other.filter((p) => !Object.hasOwn(REVIEWED_OTHER, p.license));
  const failing =
    missing.length > 0 ||
    buckets.restricted.length > 0 ||
    buckets.unknown.length > 0 ||
    unreviewedOther.length > 0;

  if (missing.length > 0) {
    log(`❌ 有 ${missing.length} 个包**不在已入库的清单里**：`);
    for (const key of missing) log(`     ${key}`);
    log('   ⇒ 新增 NuGet 依赖必须刷新一次清单（它会把许可证写进版本控制，供人复核）：');
    log('     node research/tools/nuget-license-inventory.mjs --refresh');
  }
  if (buckets.restricted.length > 0) log(`❌ 受限许可证 ${buckets.restricted.length} 个（见上方列表）`);
  if (buckets.unknown.length > 0) log(`❌ 许可证未知 ${buckets.unknown.length} 个（见上方列表）`);
  if (unreviewedOther.length > 0) {
    log(`❌ 白名单外且未登记 ${unreviewedOther.length} 个 —— 要到 license-policy.mjs 的 REVIEWED_OTHER 里逐项写理由`);
  }

  if (!asJson) {
    log(
      failing
        ? '结论：NuGet 侧**未通过** ❌'
        : `结论：NuGet 侧全部依赖均为宽松许可（含已登记的例外）✅  （${packages.size} 个包）`,
    );
  }
  return failing ? 1 : 0;
};

// 🔴 不能用 `process.exit()`：stdout 是管道时写入是异步的，会被截断
//    （npm 侧同一个坑，见 license-inventory.mjs 的注释）。
process.exitCode = await main();
