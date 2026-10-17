#!/usr/bin/env node
/**
 * `check:version-declarations` —— **同一个版本号，六个壳各写了一遍**，改一处忘了别处就红。
 * ==================================================================================
 *
 * ## 它挡的是什么（2026-10-16 实测出来的形状）
 *
 * 版本号在这套代码里**不是一个事实，而是五份字面量**：
 *
 * | 壳 | 声明处 | 今天写的 |
 * |---|---|---|
 * | Android | `apps/mobile/android/app/build.gradle` 的 `versionName` | `"1.0"` |
 * | iOS | `…/Heyta.xcodeproj/project.pbxproj` 的 `MARKETING_VERSION` | `1.0` |
 * | macOS | `apps/desktop-macos/scripts/package-app.sh` 的 `VERSION` | `"1.0.0"` |
 * | Windows | `apps/desktop-windows/scripts/package-msix.ps1` 的 `$version` | `'1.0.0.0'` |
 * | Linux | `apps/desktop-linux/scripts/package-deb.sh` 的 `VERSION` 默认值 | `${HEYTA_VERSION:-1.0.0}` |
 *
 * 今天这五处**语义上是同一个版本**（`1.0` ≡ `1.0.0` ≡ `1.0.0.0`，见下面的 `sameVersion()`），
 * 所以本判据是**绿的**。它守的是**将来**：`MARKETING_VERSION` 单独改一下、或者只改了 deb 那一行，
 * 五端就会开始报**五个不同的版本**，而**没有任何一层会说话**。
 *
 * 🔴 这与本仓治理过的那件事是同一个形状：价格原先"同一个数字住在三个地方"，
 * 后来收进 `price-book.ts` 一处。版本号还没收 —— 而 **`apps/*` 里出现同一个产品事实的五份字面量**，
 * 也正是宿主边界（AGENTS §3.5：`apps/*` 只许放平台差异）的反面。
 *
 * ## 🔴 本判据**刻意不管**的那件事（写在这里，免得被读成"版本号已经对账了"）
 *
 * 根 `package.json` 的 `version` 是**另一个号**（今天 `0.1.0`），它经
 * `scripts/gen-app-version.mjs` 生成 `HEYTA_APP_VERSION` 并由客户端**上报给服务端**。
 * "**以谁为准**"是一个**未决的产品决定**（对账件的 **B11**，含"其实有三个号"的实测），
 * 所以这里**不拿它来判红** —— 那会把一个决定塞进一条判据里。
 * 本判据只断言一件事：**六个壳之间必须互相一致**。
 *
 * ## 用法
 *
 *   node scripts/check-version-declarations.mjs             # 真跑（离线）
 *   node scripts/check-version-declarations.mjs --self-test  # 逐臂证明会红
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(HERE);

/**
 * **六个**壳的声明点。
 *
 * ⚠️ 每一条都给**两个**正则：`find` 用来在文件里定位那一行，`value` 用来从**那一行**取值。
 * 分成两步是为了让"锚点失效"（文件被改了形状）与"值变了"能分开报 —— 前者是探针失效，
 * 后者才是真的漂移；混成一句会让"判据没在保护东西"和"东西真的变了"读起来一样。
 */
export const SITES = [
  {
    shell: 'Android',
    file: 'apps/mobile/android/app/build.gradle',
    find: /^\s*versionName\s+["']([^"']+)["']/m,
  },
  {
    shell: 'iOS',
    file: 'apps/mobile/ios/Heyta.xcodeproj/project.pbxproj',
    find: /^\s*MARKETING_VERSION\s*=\s*([^;]+);/m,
  },
  {
    shell: 'macOS',
    file: 'apps/desktop-macos/scripts/package-app.sh',
    find: /^\s*VERSION=["']?([0-9][0-9.]*)["']?\s*$/m,
  },
  {
    shell: 'Windows',
    file: 'apps/desktop-windows/scripts/package-msix.ps1',
    find: /^\s*\$version\s*=\s*'([0-9][0-9.]*)'/m,
  },
  {
    // 🔴 **2026-10-16 补的第六个壳**：鸿蒙的版本声明在 `AppScope/app.json5` 里
    //    （`versionName` / `versionCode`），而它此前**不在本判据的视野里** ——
    //    判据说的是"五个壳互相一致"，而实际有六个壳各自声明版本 —— 鸿蒙是补上来的第六个。
    //    ⇒ 与第 52 轮那条 `readdirSync` 非递归的失效**同族**：
    //      **判据对它知道的那几个报绿，对它不知道的那个一句话都不说。**
    shell: '鸿蒙',
    file: 'apps/mobile/harmony/AppScope/app.json5',
    find: /"versionName"\s*:\s*"([^"]+)"/m,
  },
  {
    shell: 'Linux',
    file: 'apps/desktop-linux/scripts/package-deb.sh',
    // `${HEYTA_VERSION:-1.0.0}` ⇒ 取那个**默认值**（没人设环境变量时实际写进 deb 的那个）。
    find: /^\s*VERSION=["']?\$\{HEYTA_VERSION:-([0-9][0-9.]*)\}["']?\s*$/m,
  },
];

/** `1.0` / `1.0.0` / `1.0.0.0` 是**同一个版本**：按段比，尾部零不参与。 */
export function sameVersion(a, b) {
  const parts = (v) => String(v).trim().split('.').map((s) => Number(s));
  const [x, y] = [parts(a), parts(b)];
  if (x.some(Number.isNaN) || y.some(Number.isNaN)) return false;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return false;
  }
  return true;
}

/**
 * 纯判据：给一份 `{ 文件路径: 内容 }`，返回问题列表（空 = 放行）。
 *
 * ⚠️ 做成纯函数是为了**自检能喂合成输入**（不必造五份夹具文件），
 * 也为了 `check:*` 那条"离线可跑"的纪律。
 */
export function versionDeclarationProblems(sources) {
  const problems = [];
  const found = [];

  for (const site of SITES) {
    const text = sources[site.file];
    if (text === undefined) {
      // 🔴 文件都不在 ⇒ 这条判据**正在变成空规则**，必须响亮失败而不是跳过。
      problems.push(`${site.shell}：读不到 ${site.file} —— 这条判据对它是空转的`);
      continue;
    }
    const m = site.find.exec(text);
    if (m === null) {
      // 与"值漂移"分开报：这一条说的是**探针失效**（文件形状变过），不是版本不一致。
      problems.push(
        `${site.shell}：在 ${site.file} 里找不到版本声明（锚点失效）—— ` +
          '页面结构/脚本被改过，请更新本脚本的 `find`',
      );
      continue;
    }
    found.push({ shell: site.shell, value: m[1].trim() });
  }


/*
 * 🔴 **覆盖判据（2026-10-16 加）：有打包配置的壳目录，必须都在 `SITES` 里登记。**
 *
 * 为什么需要它：上面那张表是**手写**的，而"漏登记一个壳"这件事**不会报错** ——
 * 判据会继续对它知道的那几个报绿。鸿蒙就是这么漏掉的（它的版本声明在
 * `AppScope/app.json5`，而表里当时只有五个壳）。
 * ⇒ 与 `check-materialized-reads` 那条 `readdirSync` 非递归的失效**同族**：
 *   **不是判错，是没看见。**
 *
 * ⚠️ 本判据的边界（写在明处）：它认的是**文件名**（`build.gradle` / `project.pbxproj` /
 * `app.json5` / `package-*.sh|ps1`）。一个用全新文件名声明版本的壳仍然会漏 ——
 * 但那至少要求**引入一种新的打包形状**，比"多了一个目录"响得多。
 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'build', 'evidence', '.hvigor', 'Pods'].includes(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const registeredFiles = new Set(SITES.map((s) => s.file));
const shellDirs = new Set();
for (const file of walk(join(ROOT, 'apps'))) {
  const rel = relative(ROOT, file);
  const isPackaging =
    /(^|\/)(build\.gradle|project\.pbxproj|app\.json5)$/.test(rel) ||
    /(^|\/)package-[^/]*\.(sh|ps1)$/.test(rel);
  if (!isPackaging) continue;
  // ⚠️ **只对真的声明了版本的打包配置要求登记**。
  //    第一版漏了这一步，于是 `apps/desktop-macos/HeytaWidgets.xcodeproj/project.pbxproj`
  //    （一个**没有** `MARKETING_VERSION` 的小组件工程）被误报成"漏登记" —— **假红**。
  //    假红与漏报一样有害：它会让人以为"这条判据总是乱喊"，然后把它关掉。
  const text = readFileSync(file, 'utf8');
  const declaresVersion =
    /versionName/.test(text) ||
    /MARKETING_VERSION/.test(text) ||
    /^\s*VERSION=/m.test(text) ||
    /\$version\s*=/.test(text);
  if (!declaresVersion) continue;
  // 只认"壳根目录"这一层：取到 `apps/<…>/` 里**含打包配置的那个目录**
  const dir = rel.slice(0, rel.lastIndexOf('/'));
  shellDirs.add(dir);
}
for (const dir of shellDirs) {
  const covered = [...registeredFiles].some((f) => f.startsWith(`${dir}/`));
  if (!covered) {
    problems.push(
      `壳目录 ${dir}/ 里有打包配置（版本声明就在里面），但它**不在 SITES 里登记** —— ` +
        '本判据对它一句话都不会说。请把它的版本声明加进 SITES。',
    );
  }
}

  if (found.length > 0) {
    const first = found[0];
    for (const other of found.slice(1)) {
      if (!sameVersion(first.value, other.value)) {
        problems.push(
          `版本号不一致：${first.shell} 写的是 ${first.value}，而 ${other.shell} 写的是 ${other.value}`,
        );
      }
    }
  }
  return { problems, found };
}

function main() {
  const sources = {};
  for (const site of SITES) {
    try {
      sources[site.file] = readFileSync(join(ROOT, site.file), 'utf8');
    } catch {
      // 交给纯判据去报"读不到"，这里不吞
    }
  }
  const { problems, found } = versionDeclarationProblems(sources);

  if (problems.length > 0) {
    console.error(`🔴 版本号声明对不上（${problems.length} 条）：`);
    for (const p of problems) console.error(`   · ${p}`);
    console.error(
      '\n   ⇒ 六个壳各写了一遍版本号。改一处忘了别处，六端就会报出六个不同的版本，' +
        '而没有任何一层会说话。\n' +
        '      （这与价格那次治理前的形状相同：同一个数字住在多处。）',
    );
    process.exit(1);
  }

  let rootVersion = '(读不到)';
  try {
    rootVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  } catch {
    /* 保持占位，下面只是一行读数 */
  }

  console.log(
    `✅ 六个壳的版本声明一致：${found.map((f) => `${f.shell}=${f.value}`).join(' · ')}`,
  );
  // 🔴 这一行是**读数不是判据**：根 package.json 与壳是否必须一致，是未决的产品决定（对账件 B11）。
  console.log(
    `   ℹ️ 读数（**不在本判据的判定范围内**）：根 package.json 的 version = ${rootVersion}。` +
      '它与上面这六个是否必须一致，是 B11 那个未决的口径问题。',
  );
}

/* ── 自检：三臂各自必须能红，另有一条阳性对照 ─────────────────────────── */

const ALL = Object.fromEntries(SITES.map((s) => [s.file, 'placeholder']));

function fixture(overrides) {
  const sources = {};
  const values = {
    Android: '1.0',
    iOS: '1.0',
    macOS: '1.0.0',
    Windows: '1.0.0.0',
    鸿蒙: '1.0.0',
    Linux: '1.0.0',
    ...overrides.values,
  };
  for (const site of SITES) {
    const v = values[site.shell];
    sources[site.file] =
      site.shell === '鸿蒙'
        ? `{\n  "app": {\n    "versionName": "${v}",\n  },\n}\n`
        : site.shell === 'Linux'
        ? `VERSION="\${HEYTA_VERSION:-${v}}"\n`
        : site.shell === 'iOS'
          ? `\t\t\t\tMARKETING_VERSION = ${v};\n`
          : site.shell === 'Windows'
            ? `$version      = '${v}'\n`
            : site.shell === 'macOS'
              ? `VERSION="${v}"\n`
              : `        versionName "${v}"\n`;
  }
  for (const key of overrides.missing ?? []) delete sources[key];
  for (const [key, text] of Object.entries(overrides.raw ?? {})) sources[key] = text;
  return sources;
}

function selfTest() {
  const arms = [
    ['A 五处写法不同但版本相同（1.0 / 1.0.0 / 1.0.0.0）⇒ 绿', () => versionDeclarationProblems(fixture({})), false],
    ['B iOS 单独改成 1.1 ⇒ 红', () => versionDeclarationProblems(fixture({ values: { iOS: '1.1' } })), true],
    ['C 只改 Linux 的默认值 ⇒ 红', () => versionDeclarationProblems(fixture({ values: { Linux: '0.9' } })), true],
    ['D 一个壳的文件读不到 ⇒ 红（空规则要比没有更响）', () => versionDeclarationProblems(fixture({ missing: [SITES[2].file] })), true],
    [
      'E 锚点失效（文件在、但那一行没了）⇒ 红，且报的是"锚点失效"',
      () => versionDeclarationProblems(fixture({ raw: { [SITES[0].file]: '// 什么都没有\n' } })),
      true,
    ],
  ];
  let failures = 0;
  for (const [label, run, expectRed] of arms) {
    const { problems } = run();
    const red = problems.length > 0;
    const hit = red === expectRed;
    console.log(`${hit ? '✅' : '❌'} ${label}${hit ? '' : `（问题：${problems.join(' / ')}）`}`);
    if (!hit) failures += 1;
  }
  // 阳性对照：锚点失效那一条必须报的是"锚点失效"，不能把两种失败混成一句
  const { problems: anchorProblems } = versionDeclarationProblems(
    fixture({ raw: { [SITES[0].file]: '// 什么都没有\n' } }),
  );
  const distinct = anchorProblems.some((p) => p.includes('锚点失效'));
  console.log(`${distinct ? '✅' : '❌'} 阳性对照：锚点失效与版本不一致分开报`);
  if (!distinct) failures += 1;

  console.log(`\n臂数 ${arms.length}（由本脚本自己打印）+ 阳性对照，失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
