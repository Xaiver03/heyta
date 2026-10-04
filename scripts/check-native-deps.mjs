#!/usr/bin/env node
/**
 * iOS 原生依赖对账门禁：`package.json` 里装了原生库，`Podfile.lock` 里必须有它。
 * ==========================================================================
 *
 * 为什么需要这个门禁 —— 这是本仓库**第一个靠"真的看一眼截图"才发现的缺陷**：
 *
 *   `react-native-svg@15.15.5` 明明在 `apps/mobile/package.json` 里，但 `Podfile.lock`
 *   里只有 `react-native-safe-area-context` —— 因为依赖是在**最后一次 `pod install`
 *   之后**才加的（实测时间戳：`Podfile.lock` 09-25 **18:39**，
 *   `node_modules/react-native-svg` 的链接 09-25 **21:54**）。
 *
 * 后果的全部特征就是"每一层看起来都成功"：
 *
 *   - `xcodebuild` → `** BUILD SUCCEEDED **`
 *   - `xcrun simctl launch` → 返回 pid，12 秒后进程仍在
 *   - `screencapture` → 有图
 *   - 界面布局、中文文案、SQLite 建库**全部正确**
 *   - **只有每一个图标变成一个粉红方块里的 `Uni`**（RN 对未注册原生组件的占位）
 *
 * 而**所有既有断言都测不出它**：无障碍断言查的是 `content-desc` 与文案，
 * 它测不出"这个 View 到底画成了什么"。
 *
 * 所以这里把那条只有人眼能看见的事实，变成两条机器可查的规则：
 *
 *   1. **收录**：每个第三方原生依赖的 pod 名，必须出现在 `Podfile.lock` 的 PODS 段。
 *      第 32 号陷阱就是这条被违反。
 *   2. **版本一致**：`Podfile.lock` 记的版本，必须等于该包 `package.json` 的 `version`。
 *   3. **工程文件不许重复登记**：`project.pbxproj` 里同一个 PBXBuildFile 只能有一条，
 *      且同一个 `files = (…)` 阶段里不许出现两次。
 *
 * 规则 2 之所以能做成**确定性的**（而不是像最初设想的那样比 mtime）：
 * 实测这四个 podspec 全都用 `s.version = package['version']` 取值
 * （`grep -m1 's\.version'` 逐个看过），所以 lock 里的版本就是 podspec 的版本。
 * 比 mtime 可靠得多 —— mtime 在**全新 clone** 上会让 podspec 比 lock 新而假红，
 * 而 pnpm 每次 install 都会重写 `node_modules/<pkg>` 符号链接的 mtime（实测 21:54:40，
 * 与 podspec 自身的 21:54:38 差 2 秒），所以链接 mtime 也不能用。
 *
 * 为什么不检查 `react-native` 自己的 podspec（见 EXCLUDED_PACKAGES）：
 * 它的 pod 由 Podfile 的 `use_react_native!` 统一声明，且含**条件性变体** ——
 * 实测 `React-Core-prebuilt` 与 `ReactNativeDependencies` 在
 * **从源码构建**时（本仓库正是这样，见 AGENTS.md §7 第 30 条）
 * **故意不在** `Podfile.lock` 里。把它们纳入"必须命中"会立刻假红。
 *
 * 为什么不检查反方向（lock 里有、package.json 里没了）：
 * pod 名与 npm 包名之间没有可靠映射（`RNSVG` ↔ `react-native-svg`、
 * `op-sqlite` ↔ `@op-engineering/op-sqlite`），而且 PODS 段里还有 `boost` / `glog`
 * 这类 RN 自己的传递 pod。做一个高假阳率的检查，只会教人忽略红色。
 *
 * 用法：
 *   node scripts/check-native-deps.mjs              # 检查 apps/mobile
 *   node scripts/check-native-deps.mjs --json
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const KNOWN_FLAGS = new Set(['--json', '--flagged', '--help']);
const argv = process.argv.slice(2);
const unknown = argv.filter((a) => a.startsWith('--') && !KNOWN_FLAGS.has(a));
if (unknown.length > 0) {
  console.error(`🔴 未知参数：${unknown.join(', ')}`);
  process.exit(2);
}
const JSON_OUT = argv.includes('--json');
const APP_DIR = argv.find((a) => !a.startsWith('--')) ?? 'apps/mobile';

/** 扫描依赖目录时跳过的子目录：示例工程/文档里也会有 podspec，那不是本 App 的依赖。 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'example',
  'examples',
  'docs',
  'e2e',
  '__tests__',
  'android',
]);
const MAX_DEPTH = 3;

/**
 * RN 自身的 podspec 由 Podfile 声明，不走 autolinking —— 见文件头注释，
 * 纳入检查会因条件性 prebuilt pod 而**假红**。
 */
const EXCLUDED_PACKAGES = new Set(['react', 'react-native']);

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** 注意：必须用 statSync（跟随符号链接）—— pnpm 的 node_modules 全是符号链接，
 *  `readdirSync(..., {withFileTypes:true}).isDirectory()` 对符号链接返回 false，
 *  会让"一个原生模块都没找到"看起来像"没有原生模块"。这个坑当场踩过一次。 */
function findPodspecs(pkgDir) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      if (name.endsWith('.podspec') && isFile(full)) out.push(full);
      else if (isDir(full) && !SKIP_DIRS.has(name)) walk(full, depth + 1);
    }
  };
  walk(pkgDir, 0);
  return out;
}

function parsePodspecName(podspecPath) {
  const text = readFileSync(podspecPath, 'utf8');
  const m = /s\.name\s*=\s*['"]([^'"]+)['"]/.exec(text);
  // 兜底：用文件名。`RNSVG.podspec` 这类名字通常与 s.name 一致。
  return m ? m[1] : basename(podspecPath, '.podspec');
}

/** 解析 Podfile.lock 的 PODS 段 → Map<pod名, 版本>。只取顶层 pod，忽略 subspec。 */
function parsePodfileLock(lockPath) {
  const pods = new Map();
  let inPods = false;
  for (const line of readFileSync(lockPath, 'utf8').split('\n')) {
    if (line.startsWith('PODS:')) {
      inPods = true;
      continue;
    }
    // PODS 之后的第一个顶层段（DEPENDENCIES: / SPEC REPOS: / …）就结束
    if (inPods && /^[A-Za-z]/.test(line)) break;
    if (!inPods) continue;
    // 顶层 pod 恰好缩进 2 空格；4 空格的 "    - X" 是它的依赖，不是顶层条目
    const m = /^ {2}- ([^\s(]+)(?: \(([^)]+)\))?/.exec(line);
    if (!m) continue;
    const name = m[1].split('/')[0];
    if (pods.has(name)) continue;
    // "(from `../node_modules/...`)" 之类的不是版本号
    const version = m[2] && /^\d/.test(m[2]) ? m[2] : undefined;
    pods.set(name, version);
  }
  return pods;
}

// ── 收集第三方原生模块 ────────────────────────────────────────────────────────

const pkgPath = join(APP_DIR, 'package.json');
if (!isFile(pkgPath)) {
  console.error(`🔴 找不到 ${pkgPath}`);
  process.exit(2);
}
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const lockPath = join(APP_DIR, 'ios', 'Podfile.lock');

const natives = [];
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  if (EXCLUDED_PACKAGES.has(dep)) continue;
  const candidates = [resolve(APP_DIR, 'node_modules', dep), resolve('node_modules', dep)];
  const base = candidates.find(isDir);
  if (base === undefined) continue; // 工作区包，或还没装
  const podspecs = findPodspecs(base);
  if (podspecs.length === 0) continue; // 纯 JS 包
  let version;
  try {
    version = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')).version;
  } catch {
    version = undefined;
  }
  for (const podspec of podspecs) {
    natives.push({ dep, version, podspec, pod: parsePodspecName(podspec) });
  }
}

// ── 判定 ─────────────────────────────────────────────────────────────────────

const violations = [];

if (natives.length > 0 && !existsSync(lockPath)) {
  violations.push({
    kind: 'no-lock',
    dep: '(整个 iOS 工程)',
    pod: '(缺失)',
    why: `${lockPath} 不存在，无法证明任何原生模块被链接`,
    fix: `cd ${APP_DIR}/ios && env -u NODE_USE_ENV_PROXY LANG=en_US.UTF-8 RCT_USE_PREBUILT_RNCORE=0 RCT_USE_RN_DEP=0 pod install`,
  });
} else if (natives.length > 0) {
  const pods = parsePodfileLock(lockPath);
  for (const n of natives) {
    if (!pods.has(n.pod)) {
      violations.push({
        kind: 'missing',
        ...n,
        why: `pod 名 "${n.pod}" 完全不在 ${lockPath} 的 PODS 段里 —— 这个原生模块没有被链接，它会被渲染成 "Unsupported" 占位`,
        fix: `cd ${APP_DIR}/ios && env -u NODE_USE_ENV_PROXY LANG=en_US.UTF-8 RCT_USE_PREBUILT_RNCORE=0 RCT_USE_RN_DEP=0 pod install`,
      });
      continue;
    }
    const locked = pods.get(n.pod);
    if (locked !== undefined && n.version !== undefined && locked !== n.version) {
      violations.push({
        kind: 'version',
        ...n,
        locked,
        why: `已安装的包版本是 ${n.version}，而 ${lockPath} 记的是 ${locked} —— lock 是过期状态，实际链接的是旧版原生代码`,
        fix: `cd ${APP_DIR}/ios && env -u NODE_USE_ENV_PROXY LANG=en_US.UTF-8 RCT_USE_PREBUILT_RNCORE=0 RCT_USE_RN_DEP=0 pod install`,
      });
    }
  }
}

// ── 规则 3：Xcode 工程文件里的编译条目不许重复 ───────────────────────────────
//
// 为什么这一条住在这里而不是"让 Xcode 自己去说"：同一个模块被机械追加两次
// （`HeytaCardExportModule.swift` / 它的 `…Bridge.m` 实测各出现 4 次：PBXBuildFile
// 段 2 次 + Sources 阶段 2 次），xcodebuild 只打一行
// `warning: Skipping duplicate build file in Compile Sources build phase` 然后
// **BUILD SUCCEEDED**。警告埋在 16 MB 的构建日志里，而每一次 iOS 构建都有它 ——
// 于是"日志里有警告"这件事再也不能被当成任何信号。
const PBXPROJ = join(APP_DIR, 'ios', 'Heyta.xcodeproj', 'project.pbxproj');
const project = { entries: 0, phases: 0, dupEntries: [], dupInPhase: [] };

if (!isFile(PBXPROJ)) {
  violations.push({
    kind: 'no-pbxproj',
    dep: '(整个 iOS 工程)',
    pod: '(缺失)',
    why: `${PBXPROJ} 不存在 —— 工程文件读不到时下面那条"无重复"的结论不成立，所以判红而不是判绿`,
    fix: `确认 --app-dir 指向带 ios/ 的工程（本仓库是 apps/mobile）`,
  });
} else {
  const text = readFileSync(PBXPROJ, 'utf8');
  const section =
    /\/\* Begin PBXBuildFile section \*\/([\s\S]*?)\/\* End PBXBuildFile section \*\//.exec(text);
  const ids = section
    ? [...section[1].matchAll(/^\t\t([0-9A-F]{24}) \/\* (.*?) \*\/ = \{isa = PBXBuildFile/gm)]
    : [];
  project.entries = ids.length;
  const seenEntry = new Set();
  for (const [, id, name] of ids) {
    if (seenEntry.has(id)) project.dupEntries.push(`${name}（${id}）`);
    seenEntry.add(id);
  }
  for (const phase of text.matchAll(/\t\t\tfiles = \(([\s\S]*?)\n\t\t\t\);/g)) {
    project.phases += 1;
    const seenPhase = new Set();
    for (const m of phase[1].matchAll(/^\t\t\t\t([0-9A-F]{24}) \/\* (.*?) \*\//gm)) {
      if (seenPhase.has(m[1])) project.dupInPhase.push(`${m[2]}（${m[1]}）`);
      seenPhase.add(m[1]);
    }
  }
  // 前置断言：读到 0 条 / 0 个阶段 = 探针没看见东西，不是"没有重复"
  if (project.entries === 0 || project.phases === 0) {
    violations.push({
      kind: 'pbxproj-unreadable',
      dep: '(整个 iOS 工程)',
      pod: '(解析)',
      why: `${PBXPROJ} 里解析到 ${String(project.entries)} 条 PBXBuildFile、${String(project.phases)} 个 files 阶段 —— 其中之一为 0 说明解析形状不对，此时"无重复"是假的`,
      fix: `改 check-native-deps.mjs 的正则前先确认工程文件的段名/缩进没变`,
    });
  }
  for (const dup of [...project.dupEntries, ...project.dupInPhase]) {
    violations.push({
      kind: 'pbxproj-dup',
      dep: '(整个 iOS 工程)',
      pod: dup,
      why: `同一个编译条目出现两次 —— 构建只会 succeed 并留下一行 "Skipping duplicate build file" 警告`,
      fix: `在 ${PBXPROJ} 里删掉多余的那一份（PBXBuildFile 段与 Sources 阶段各一处）`,
    });
  }
}

// ── 输出 ─────────────────────────────────────────────────────────────────────

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        app: APP_DIR,
        lockPath,
        nativeCount: natives.length,
        project,
        natives: natives.map((n) => ({ dep: n.dep, pod: n.pod, version: n.version })),
        violations,
        failing: violations.length,
      },
      null,
      2,
    ),
  );
  process.exit(violations.length === 0 ? 0 : 1);
}

if (violations.length === 0) {
  const listed = natives
    .map((n) => `${n.pod}@${n.version ?? '?'}`)
    .sort()
    .join('、');
  console.log(
    `✅ iOS 原生依赖对账一致（${APP_DIR}：${String(natives.length)} 个原生 pod 全部命中 Podfile.lock：${listed}；工程文件 ${String(project.entries)} 条编译条目 / ${String(project.phases)} 个 files 阶段无重复）。`,
  );
  process.exit(0);
}

console.error(`🔴 iOS 原生依赖对账失败：${String(violations.length)} 处。\n`);
for (const v of violations) {
  console.error(`   ${v.dep}  →  pod ${v.pod}`);
  console.error(`      ${v.why}`);
  console.error(`      修法：${v.fix}\n`);
}
console.error('规则出处：AGENTS.md §7 第 32 条（未链接的原生组件只渲染成占位）。');
console.error('为什么这个门禁不能靠"构建成功"代替：那次事故里构建、启动、截图每一步都是绿的。\n');
process.exit(1);
