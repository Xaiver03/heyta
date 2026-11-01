#!/usr/bin/env node
/**
 * 鸿蒙 RNOH 原生侧探针 —— **在 `windows-pc` 上执行的那一半**。
 *
 * 由 `scripts/build-harmony-rnoh-windows.mjs` 推过去、用 DevEco 自带的 node 跑。
 * 不要在本机（Mac）直接跑：那台机器没有 DevEco。
 *
 * 这是 `scripts/verify-harmony-rnoh.sh`（macOS 版，写死
 * `/Applications/DevEco-Studio.app/Contents`）的 Windows 移植。**移植的是判据，不是措辞**：
 * 原脚本第 4 步那三条 `.so` 断言、以及"日志里必须真的跑过 BuildNativeWithNinja"
 * 都逐条保留 —— 因为退出码 0 不携带"原生库真的进包了"这个信息。
 *
 * ## 🔴 本脚本**不**回答的问题（与 mac 版同一条边界）
 *
 * 它用**桩**顶替 codegen/autolinking（`autolinking.cmake` no-op、空 `PackageProvider.cpp`、
 * 空包工厂、纯 ArkTS 入口页）。所以它只回答一件事：
 *
 *      RNOH 的 C++ 在这一台机器上能不能编译，并真的打进 HAP。
 *
 * "RN 应用能不能跑起来"、"codegen 对不对"属于另一环（`verify-harmony-rnoh-js.sh`），
 * 不要拿本脚本的绿灯去说那件事。
 *
 * ## 输出契约
 *
 * 每行一条判据，前缀固定：`OK  ` / `BAD ` / `INFO`。驱动侧按前缀计数，**不猜**。
 * 退出码 = BAD 条数非零 ⇒ 1。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEVECO = process.env.HEYTA_DEVECO || 'C:\\Program Files\\Huawei\\DevEco Studio';
/* 🔴 工作目录必须是**短路径**：hvigor 内部 pnpm 在深路径上会 ENAMETOOLONG（mac 版同一条注释）。 */
const WORK = process.env.HEYTA_HARMONY_RN_WORK || 'C:\\hx-rnoh';
const RNOH_VERSION = process.env.RNOH_VERSION || '0.84.4';
/*
 * 🔴 **声明用的版本号不等于 `sdk-pkg.json` 里的那个。** 这是实测撞出来的：
 *
 *   装的是 `HarmonyOS 26.0.0`（API 26）；把它原样填进 `compatibleSdkVersion` ⇒
 *   `hvigor ERROR: 00308018`，build.log 里真正的因是
 *   `Error: api version parameter is illegal! Expected format: <major>[.<minor>][.<patch>]`
 *   —— 这一版 `hvigor-ohos-plugin` 不认识 `26.0.0(26)` 这个形状。
 *   填 `6.1.1(24)`（**本仓 `apps/mobile/harmony` 自己声明的那个**，它在这台机上能出包）⇒
 *   BUILD SUCCESSFUL，`BuildNativeWithNinja` 跑了 3 分 46 秒。
 *
 * 所以默认取"本仓已验证过的那个声明值"，而不是从 sdk-pkg.json 现算。
 * 装的是哪个 SDK 仍然照实打印（`INFO`），免得读者以为版本对得上。
 */
const SDK_DECL = process.env.HEYTA_HARMONY_SDK_DECL || '6.1.1(24)';

const NODE_EXE = path.join(DEVECO, 'tools', 'node', 'node.exe');
const NPM_CMD = path.join(DEVECO, 'tools', 'node', 'npm.cmd');
const OHPM_BAT = path.join(DEVECO, 'tools', 'ohpm', 'bin', 'ohpm.bat');
const HVIGORW_BAT = path.join(DEVECO, 'tools', 'hvigor', 'bin', 'hvigorw.bat');
const SDK_HOME = path.join(DEVECO, 'sdk');

/*
 * 🔴 **只用裸命令名，绝不把带空格的绝对路径拼进命令行。**
 *
 * DevEco 装在 `C:\Program Files\Huawei\DevEco Studio` —— 路径里有空格。而 Node 的
 * `spawnSync` 在 Windows 上会给带空格的参数套引号、并把内部引号转成 `\"`；
 * **cmd.exe 不认 `\"` 这个转义**，于是它把整串 `"C:\Program Files\...\npm.cmd"`
 * 当成一个文件名去找，报 `<路径>' 不是内部或外部命令`（实测过，就是这条）。
 *
 * `cmd /d /s /c ""<带空格的 exe>" args"` 那套外层再包引号的办法也救不了它 ——
 * 那需要精确控制最终命令行，而 Node 在我们的字符串外面又套了一层。
 *
 * 所以：生存性检查用绝对路径（`fs.existsSync`，不经过 shell），**执行一律走 PATH**
 * （`childEnv.PATH` 已经把三个工具目录排在最前，PATHEXT 会自动补 .cmd/.bat）。
 */
const NPM = 'npm';
const OHPM = 'ohpm';
const HVIGORW = 'hvigorw';
const NDK = path.join(SDK_HOME, 'default', 'openharmony', 'native');

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS += 1; console.log(`OK   ${m}`); };
const bad = (m) => { FAIL += 1; console.log(`BAD  ${m}`); };
const info = (m) => console.log(`INFO ${m}`);
const step = (t) => console.log(`\n==== ${t} ====`);

/* 子进程环境：非交互 ssh 不继承图形会话的变量，全部显式拼。 */
const childEnv = {
  ...process.env,
  DEVECO_SDK_HOME: SDK_HOME,
  NODE_HOME: path.join(DEVECO, 'tools', 'node'),
  PATH: [
    path.join(DEVECO, 'tools', 'node'),
    path.join(DEVECO, 'tools', 'ohpm', 'bin'),
    path.join(DEVECO, 'tools', 'hvigor', 'bin'),
    process.env.PATH || '',
  ].join(';'),
};

/**
 * 跑一条命令行。
 *
 * 🔴 Node 20 起 `spawnSync` 直接执行 `.bat/.cmd` 会 EINVAL
 * （CVE-2024-27980 的修复），所以统一过 `cmd.exe /c`。`shell:true` 也行，
 * 但那会把参数再做一次拼接，路径里的空格就变成注入面 —— 这里只走一次解析。
 */
function run(line, { cwd, timeout = 0 } = {}) {
  const r = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], {
    cwd,
    env: childEnv,
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    /* 🔴 见上：让 Node **不要**替我们给参数套引号/转义引号。 */
    windowsVerbatimArguments: true,
  });
  if (r.error) return { status: 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error.message}` };
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** ZIP 中央目录读取器：HAP 是 zip，用它在 JS 里拿「条目名 + 解压后大小」。 */
function readZipEntries(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是 zip：找不到 EOCD');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('中央目录损坏');
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entries.push({ name, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function walk(dir, hit, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (d.name === 'oh_modules' || d.name === 'node_modules') continue;
      walk(full, hit, out);
    } else if (hit(d.name)) out.push(full);
  }
  return out;
}

/* ── 0. 前置 ─────────────────────────────────────────────── */

step('0. 前置');
for (const [label, p] of [
  ['ohpm.bat', OHPM_BAT],
  ['hvigorw.bat', HVIGORW_BAT],
  ['node.exe', NODE_EXE],
  ['npm.cmd', NPM_CMD],
]) {
  if (fs.existsSync(p)) ok(`${label} 在位`);
  else { bad(`${label} 缺失：${p}`); }
}
for (const [label, p] of [
  ['cmake.exe', path.join(NDK, 'build-tools', 'cmake', 'bin', 'cmake.exe')],
  ['ninja.exe', path.join(NDK, 'build-tools', 'cmake', 'bin', 'ninja.exe')],
  ['llvm', path.join(NDK, 'llvm')],
]) {
  if (fs.existsSync(p)) ok(`NDK: ${label}`);
  else bad(`NDK 缺 ${label}：${p}`);
}
if (FAIL > 0) { console.log(`\n通过 ${PASS}，失败 ${FAIL}`); process.exit(1); }

/* SDK 版本：模板里写的是旧版本号，必须对齐实际安装值，否则 hvigor 直接 schema 报错。 */
const sdkPkg = path.join(SDK_HOME, 'default', 'sdk-pkg.json');
let SDK_FULL = '';
try {
  const data = JSON.parse(fs.readFileSync(sdkPkg, 'utf8')).data;
  info(`装的 SDK：${data.displayName}（API ${data.apiVersion}）`);
  SDK_FULL = SDK_DECL;
  ok(`声明用 ${SDK_FULL}（不是从 sdk-pkg.json 现算的那个 —— 原因见文件头常量注释）`);
} catch (e) {
  bad(`读不到 ${sdkPkg}：${e.message}`);
  console.log(`\n通过 ${PASS}，失败 ${FAIL}`);
  process.exit(1);
}

/* ── 1. 取官方 CLI 模板 ──────────────────────────────────── */

step('1. 取 RNOH 官方 CLI 里的工程模板（不手写脚手架）');
/*
 * `oh_modules` 里是 RNOH 的 har（几百 MB，ohpm 要从远端拉）。每轮都删等于每轮重下 ——
 * 所以先把它挪出来，擦完工作目录再放回去。这是**缓存**，不影响判据：
 * `ohpm install` 仍然会跑，只是不必重新下载。
 */
const CACHE_OH = path.join(WORK, '_oh_modules_cache');
const PROJ_OH = path.join(WORK, 'proj', 'oh_modules');
if (fs.existsSync(PROJ_OH)) {
  fs.rmSync(CACHE_OH, { recursive: true, force: true });
  fs.renameSync(PROJ_OH, CACHE_OH);
  info('oh_modules 已挪进缓存');
}
fs.rmSync(WORK, { recursive: true, force: true });
const CLI_DIR = path.join(WORK, '_cli');
fs.mkdirSync(CLI_DIR, { recursive: true });
const pack = run(`${NPM} pack "@react-native-oh/react-native-harmony-cli@${RNOH_VERSION}"`, { cwd: CLI_DIR });
if (pack.status === 0) ok(`npm pack 成功（CLI ${RNOH_VERSION}）`);
else { bad(`取不到 @react-native-oh/react-native-harmony-cli@${RNOH_VERSION}`); info(pack.out.trim().split('\n').slice(-6).join('\n')); }

const tgz = fs.readdirSync(CLI_DIR).find((f) => f.endsWith('.tgz'));
if (tgz === undefined) {
  bad('npm pack 没有产出 .tgz');
  console.log(`\n通过 ${PASS}，失败 ${FAIL}`);
  process.exit(1);
}
const untar = run(`tar -xzf "${path.join(CLI_DIR, tgz)}" -C "${CLI_DIR}"`);
if (untar.status === 0) ok('tgz 解开');
else bad(`解 tgz 失败：${untar.out.trim()}`);

const TEMPLATE = path.join(CLI_DIR, 'package', 'src', 'init', 'templates', 'harmony');
if (!fs.existsSync(TEMPLATE)) {
  bad('CLI 包里没有 harmony 模板');
  console.log(`\n通过 ${PASS}，失败 ${FAIL}`);
  process.exit(1);
}
const tplFiles = walk(TEMPLATE, () => true);
ok(`官方模板就位（${tplFiles.length} 个文件）`);

/* ── 2. 建工程 + 四个 codegen 桩 ─────────────────────────── */

step('2. 建工程（官方模板 + 四个 codegen 桩）');
const PROJ = path.join(WORK, 'proj');
fs.mkdirSync(PROJ, { recursive: true });
fs.cpSync(TEMPLATE, PROJ, { recursive: true });
if (fs.existsSync(CACHE_OH)) {
  fs.renameSync(CACHE_OH, path.join(PROJ, 'oh_modules'));
  info('oh_modules 缓存已还原');
}

/* 模板里带一个 `gitignore`（没有点）—— 挪成 `.gitignore` 没意义，直接删。 */
for (const f of walk(PROJ, (n) => n === 'gitignore')) fs.rmSync(f);

const edit = (rel, fn) => {
  const p = path.join(PROJ, rel);
  if (!fs.existsSync(p)) { bad(`模板里没有 ${rel}（模板结构变了？）`); return; }
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) bad(`${rel} 替换零命中（正则没咬住，别当成功）`);
  else { fs.writeFileSync(p, after); ok(`${rel} 已对齐`); }
};

edit('build-profile.json5', (s) => s
  .replace(/compatibleSdkVersion:\s*'[^']*'/g, `compatibleSdkVersion: '${SDK_FULL}'`)
  .replace(/targetSdkVersion:\s*'[^']*'/g, `targetSdkVersion: '${SDK_FULL}'`));

/* bundleName：模板是 `com.example`（两段），过不了 hvigor 的 schema（要三段）。 */
edit('AppScope/app.json5', (s) => s
  .replace('"bundleName": "com.example"', '"bundleName": "com.heyta.harmony"')
  .replace('"vendor": "example"', '"vendor": "heyta"'));

/* 根 oh-package.json5：模板没有这个文件（由 CLI 的 OhPackageJson5Template 生成）。 */
fs.writeFileSync(path.join(PROJ, 'oh-package.json5'), `{
  "modelVersion": "5.0.0",
  "description": "heyta HarmonyOS RNOH probe",
  "dependencies": {
    "@rnoh/react-native-openharmony": "0.84.3"
  },
  "devDependencies": {}
}
`);
ok('根 oh-package.json5 已写入（RNOH har 0.84.3）');

/* 去掉 `@rnoh/hvigor-plugin`：它做 codegen/autolinking，本脚本用桩。 */
fs.writeFileSync(path.join(PROJ, 'hvigorfile.ts'),
  "import { appTasks } from '@ohos/hvigor-ohos-plugin';\n"
  + 'export default { system: appTasks, plugins: [] };\n');
fs.writeFileSync(path.join(PROJ, 'entry', 'hvigorfile.ts'),
  "import { hapTasks } from '@ohos/hvigor-ohos-plugin';\n"
  + 'export default { system: hapTasks, plugins: [] };\n');
ok('两个 hvigorfile.ts 已改成零插件（桩的前提）');

/* 桩 ①②：cmake 的 autolink + 原生包注册 */
const CPP = path.join(PROJ, 'entry', 'src', 'main', 'cpp');
fs.mkdirSync(path.join(CPP, 'generated'), { recursive: true });
fs.writeFileSync(path.join(CPP, 'autolinking.cmake'),
  'function(autolink_libraries target)\n'
  + '  message(STATUS "[probe] autolink ${target} -> no-op")\n'
  + 'endfunction()\n');
fs.writeFileSync(path.join(CPP, 'PackageProvider.cpp'),
  '#include "RNOH/PackageProvider.h"\n'
  + '#include <memory>\n#include <vector>\n'
  + 'using namespace rnoh;\n'
  + 'std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context) {\n'
  + '  return {};\n}\n');

/* 桩 ③④：ets 侧的包工厂 + 入口页 */
const ETS = path.join(PROJ, 'entry', 'src', 'main', 'ets');
fs.mkdirSync(path.join(ETS, 'pages'), { recursive: true });
fs.writeFileSync(path.join(ETS, 'RNOHPackagesFactory.ets'),
  "import type { RNPackageContext, RNOHPackage } from '@rnoh/react-native-openharmony';\n"
  + 'export function createRNOHPackages(_ctx: RNPackageContext): RNOHPackage[] { return []; }\n');
fs.writeFileSync(path.join(ETS, 'pages', 'Index.ets'),
  "@Entry\n@Component\nstruct Index {\n  build() {\n"
  + "    Column() { Text('heyta RNOH') }.width('100%').height('100%')\n  }\n}\n");
ok('四个 codegen 桩已写入（autolinking / PackageProvider / 包工厂 / 入口页）');

/* ── 3. ohpm install → hvigorw assembleHap（真编 C++）───── */

step('3. ohpm install → hvigorw assembleHap（会真编 C++）');
const ohpm = run(`${OHPM} install`, { cwd: PROJ, timeout: 30 * 60 * 1000 });
if (ohpm.status === 0) {
  const ohModules = path.join(PROJ, 'oh_modules');
  ok(`ohpm install 成功（oh_modules ${fs.existsSync(ohModules) ? '已生成' : '缺失'}）`);
} else {
  bad('ohpm install 失败');
  info(ohpm.out.trim().split('\n').slice(-10).join('\n'));
}

const buildLog = run(
  `${HVIGORW} assembleHap --mode module -p product=default -p buildMode=debug --no-daemon`,
  { cwd: PROJ, timeout: 90 * 60 * 1000 },
);
if (buildLog.status === 0) ok('hvigorw assembleHap 退出码 0');
else {
  bad('hvigorw assembleHap 失败');
  info(buildLog.out.split('\n').filter((l) => /ERROR|error:|error /.test(l)).slice(0, 10).join('\n'));
}

/* 🔴 "编译过 C++"这件事日志里有直接证据 —— 退出码里没有。 */
const ninjaLine = (buildLog.out.match(/BuildNativeWithNinja\.\.\. after [^\r\n]+/) || [])[0];
if (ninjaLine !== undefined) ok(`日志确认跑过原生编译：${ninjaLine.trim()}`);
else bad('日志里没有 BuildNativeWithNinja —— C++ 可能根本没编（只是拷了现成的？）');

/* ── 4. 验证产物 ─────────────────────────────────────────── */

step('4. 验证 HAP 里的原生库（退出码不携带这个信息）');
const haps = walk(PROJ, (n) => n.toLowerCase().endsWith('.hap'));
if (haps.length === 0) {
  bad('没有产出任何 .hap');
  console.log(`\n通过 ${PASS}，失败 ${FAIL}`);
  process.exit(1);
}
const HAP = haps[0];
const hapSize = fs.statSync(HAP).size;
ok(`产出 ${path.basename(HAP)}（${hapSize} bytes）`);

let entries = [];
try {
  entries = readZipEntries(HAP);
} catch (e) {
  bad(`读不了 HAP 的条目表：${e.message}`);
}
const findEntry = (needle) => entries.find((e) => e.name.endsWith(needle));

/* 三个 .so 是"RNOH 原生侧真的编出来了"的证据。 */
for (const lib of ['librnoh_core.so', 'librnoh_app.so', 'libreactnative.so']) {
  const e = findEntry(lib);
  if (e !== undefined) ok(`含 ${lib}（${e.size} 字节）`);
  else bad(`缺 ${lib} —— RNOH 原生侧没进包`);
}

/* 纯 ArkTS 空工程的 modules.abc 约 12KB，带 RNOH 的约 900KB —— 用"大得多"当旁证。 */
const abc = findEntry('ets/modules.abc');
if (abc !== undefined && abc.size > 200000) ok(`ets/modules.abc ${abc.size} 字节（RNOH 的 ArkTS 已编入）`);
else bad(`ets/modules.abc 偏小或缺失（${abc === undefined ? '无' : abc.size}）—— RNOH 的 ArkTS 似乎没进包`);

/* ── 汇总 ───────────────────────────────────────────────── */

console.log(`\n==== 汇总 ====`);
console.log(`通过 ${PASS} 项，失败 ${FAIL} 项`);
console.log(`HAP ${HAP}`);
process.exit(FAIL === 0 ? 0 : 1);
