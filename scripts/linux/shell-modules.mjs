#!/usr/bin/env node
/**
 * Linux 原生壳的**依赖清单唯一真源**：
 * 哪些 pkg-config 模块是编译必需的、它们各自的 `-dev` 包叫什么。
 *
 * ## 为什么要有这一枚文件（而不是各处再抄一遍）
 *
 * 改之前这份清单住在**三个地方**：
 *   · `apps/desktop-linux/Makefile` 的 `PKGS :=`（真正拿去编译的那一份）
 *   · `scripts/check-linux-shell.mjs` 里硬编码的 `REQUIRED_PKGS`
 *   · `scripts/linux/setup-build-host.sh` 里硬编码的 apt 包名 + 硬编码的探测列表
 * 这正是本仓反复吃亏的那个形状（失败判据被抄三遍 ⇒ 漂移从那里开始，`license-inventory.mjs` 的文件头
 * 记过一次）。**批二 P2 要给壳加 WebKitGTK** —— 加进 Makefile 之后：门禁会继续报"缺 gtk4/JSC/sqlite3"
 * （报的是不相干的三枚），装机脚本永远装不齐第四枚，而 `.pc --exists` 的探测列表里根本没有它。
 *
 * 所以：**模块名从 Makefile 现读**（编译用什么就检查什么），**包名映射只在这里一份**。
 *
 * ## 判据（缺一即响亮失败，不许"读到空集然后报通过"）
 *
 *  ① `apps/desktop-linux/Makefile` 取不到 ⇒ 失败；
 *  ② 那行 `PKGS :=` 锚点不在或解析出 0 枚模块 ⇒ 失败；
 *  ③ 某枚模块在这里**没有映射** ⇒ 失败并点名它（这一条就是给 P2 准备的洞：
 *     往 Makefile 加一枚模块而忘了登记包名，会在这里红，而不是在别人的机器上"装不出来"）。
 *
 * ## 用法
 *
 *   node scripts/linux/shell-modules.mjs                # 逐行打印 pkg-config 模块名
 *   node scripts/linux/shell-modules.mjs --debs         # 逐行打印对应的 -dev 包名
 *   node scripts/linux/shell-modules.mjs --pairs        # 逐行 `模块<TAB>包名`
 *   node scripts/linux/shell-modules.mjs --self-test    # 故障注入（臂数由它自己打印）
 *
 * 消费者：`scripts/check-linux-shell.mjs`（报错文案与缺失点名）、
 * `scripts/linux/setup-build-host.sh`（`--step gtk` 装什么、`--step verify` 查什么）。
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));

/** pkg-config 模块 → Ubuntu/Debian 的 `-dev` 包名。这张表**不可推导**
 * （`gtk4`→`libgtk-4-dev`、`javascriptcoregtk-4.1`→`libjavascriptcoregtk-4.1-dev`），
 * 所以它必须住在一个有判据的地方，而不是散在各脚本里。 */
export const DEV_PACKAGE = {
  'gtk4': 'libgtk-4-dev',
  'javascriptcoregtk-4.1': 'libjavascriptcoregtk-4.1-dev',
  'sqlite3': 'libsqlite3-dev',
  // 批二 P2 落地那一枚（2026-10-07）。登记与接线同批，见 docs/adr/0057。
  // 🔴 是 `webkitgtk-6.0` 而**不是** `webkit2gtk-4.1`：4.1 那套头按 GTK3 编，
  //     与本壳的 GTK4 撞（实测编译期报 unknown type `GtkAction`/`GtkContainer`）。
  'webkitgtk-6.0': 'libwebkitgtk-6.0-dev',
};

/** pkg-config 模块 → **运行时**包名（`.deb` 的 Depends 用这个，不是 `-dev` 名）。
 * 这张表同样不可推导：`gtk4`→`libgtk-4-1`、`webkitgtk-6.0`→`libwebkitgtk-6.0-4`，
 * 而 JSC 在两个 API 档里的包名尾数不一样（4.1 是 `-0`、6.0 是 `-1`）——
 * 实测出处见载体上 `dpkg -S <那枚 .so>`（2026-10-07）。
 * 为什么连它也要同源：窗口那一枚产物**同时**链上 4.1 与 6.0 两份 JSC，
 * 有人往 Makefile 加模块时最容易只补 `-dev`（编译过了）而漏掉运行时那一半
 * —— 症状是"我们的 CI 全绿，用户 `dpkg -i` 之后起不来"。 */
export const RUNTIME_PACKAGE = {
  'gtk4': 'libgtk-4-1',
  'javascriptcoregtk-4.1': 'libjavascriptcoregtk-4.1-0',
  'sqlite3': 'libsqlite3-0',
  'webkitgtk-6.0': 'libwebkitgtk-6.0-4',
  // 6.0 的 WebView 运行时会把它一起带起来（最初的出处是 `ldd heyta-linux`，那是传递闭包）。
  // 🔴 07 04:5x 更正这里曾写的理由：`Depends` 从 `ldd` 换成**直接 NEEDED**（`objdump -p`）之后，
  //    `libjavascriptcoregtk-6.0-1` **不再出现在 Depends 里** —— 它是 webkitgtk-6.0-4 自己的依赖，
  //    由那个包自己声明，本壳的产物并没有直接链它。
  //    它留在登记册的理由换成另外两条，都与 Depends 无关：
  //    ① 许可证那一册要覆盖它（LGPL 系统库那一册问的是"进程加载了什么"）；
  //    ② 回退清单（探针坏了时才用）里带着它比不带更安全。
  'javascriptcoregtk-6.0': 'libjavascriptcoregtk-6.0-1',
};

const MAKEFILE_REL = 'apps/desktop-linux/Makefile';

function die(lines) {
  console.error('❌ Linux 壳的依赖清单取不到（不是"清单为空"）：');
  for (const l of lines) console.error(`   ${l}`);
  process.exitCode = 1;
  throw new Error('shell-modules-abort');
}

/** 从 Makefile 现读 `PKGS :=`。锚点写法与 `apps/desktop-linux/Makefile` 逐字对齐。 */
export function requiredModules(root) {
  const p = join(root, MAKEFILE_REL);
  let text;
  try {
    text = readFileSync(p, 'utf8');
  } catch (e) {
    die([`${MAKEFILE_REL} 读不到：${String(e.message).split('\n')[0]}`]);
  }
  const m = /^PKGS\s*:=\s*(\S.*)$/m.exec(text);
  if (m === null) {
    die([`${MAKEFILE_REL} 里没有 /^PKGS\\s*:=/ 这一行 ⇒ 编译用的模块清单读不到。`,
      '要么 Makefile 改了形（那这两处必须一起改），要么这棵树的壳不在这儿。']);
  }
  const mods = m[1].trim().split(/\s+/).filter(Boolean);
  if (mods.length === 0) die([`${MAKEFILE_REL} 的 PKGS 解析出 0 枚模块 ⇒ 不报"没有依赖"。`]);
  return mods;
}

/** 模块 → 包名；任何一枚没映射就响亮失败并点名。 */
/** 模块 → 运行时包名。未登记的模块同样响亮失败（与 devPackages 一条规矩）。 */
export function runtimePackages(root) {
  const mods = requiredModules(root);
  const extra = mods.includes('webkitgtk-6.0') ? ['javascriptcoregtk-6.0'] : [];
  const all = [...mods, ...extra];
  const unknown = all.filter((m) => RUNTIME_PACKAGE[m] === undefined);
  if (unknown.length > 0) {
    die([
      `Makefile 声明了 ${unknown.map((u) => `\`${u}\``).join(' / ')}，但 RUNTIME_PACKAGE 里没有它`,
      '⇒ .deb 的 Depends 会缺这一枚：CI 全绿而用户装完起不来。加一行（并确认许可归属）。',
    ]);
  }
  return all.map((m) => RUNTIME_PACKAGE[m]);
}

export function devPackages(root) {
  const unknown = requiredModules(root).filter((mod) => DEV_PACKAGE[mod] === undefined);
  if (unknown.length > 0) {
    die([
      `Makefile 声明了 ${unknown.map((u) => `\`${u}\``).join(' / ')}，但本文件的 DEV_PACKAGE 里没有它`,
      '⇒ 门禁会检查一枚没人负责安装的模块。加一行映射（并确认它的许可归属，见 docs/adr/0057）。',
    ]);
  }
  return requiredModules(root).map((mod) => DEV_PACKAGE[mod]);
}

async function selfTest() {
  const arms = [];
  const REAL = resolve(HERE, '../..');

  // A0 阳性对照：真 Makefile 必须给得出模块，且都能映射到包名。
  const mods0 = requiredModules(REAL);
  const debs0 = devPackages(REAL);
  arms.push(['A0 真 Makefile ⇒ 模块数 > 0 且逐枚有包名映射（阳性对照）', mods0.length > 0 && debs0.length === mods0.length]);

  // A1 锚点被改名 ⇒ 响亮失败（不许读成"这个壳不需要依赖"）。
  const d1 = tmpTree('# Linux 壳\nPKG_LIST := gtk4 sqlite3\n');
  let fail1 = false;
  try {
    requiredModules(d1);
  } catch {
    fail1 = true;
  }
  arms.push(['A1 `PKGS :=` 锚点不在 ⇒ 响亮失败', fail1]);

  // A2 锚点在但值为空/只有注释 ⇒ 0 枚也算失败。
  const d2 = tmpTree('PKGS :=\n');
  let fail2 = false;
  try {
    requiredModules(d2);
  } catch {
    fail2 = true;
  }
  arms.push(['A2 PKGS 解析出 0 枚 ⇒ 响亮失败，不报"没有依赖"', fail2]);

  // A3 🔴 这一臂挡的是"往 Makefile 加一枚没登记的模块"⇒ 必须在这里红，
  //     而不是在别人机器上"apt 装不出来"。
  //     变异体用的是**当前未登记**的一枚假模块名，不是写死的某枚真模块 ——
  //     写死的那一版在批二 P2 落地当天自己卸了膛：变异体恰好等于真状态，
  //     A3 不再会红，而 A4 的"补上映射"变成插了一行重复键。
  //     （同一族的教训：判据的变异必须"仍未被登记"，不能借一枚刚转正的名字。）
  const GHOST = 'heyta-ghost-not-registered';
  if (DEV_PACKAGE[GHOST] !== undefined) {
    throw new Error(`A3 的假模块 ${GHOST} 竟然已被登记 —— 换一个名字，别把这一臂变成恒不红`);
  }
  const d3 = tmpTree(`PKGS := ${[...mods0, GHOST].join(' ')}\n`);
  let fail3 = false;
  try {
    devPackages(d3);
  } catch {
    fail3 = true;
  }
  arms.push([
    `A3 Makefile 多了未登记的模块（真清单 ${mods0.length} 枚 + 1 枚没映射的）⇒ 响亮失败`,
    fail3,
  ]);

  // A4 补上那一行映射之后**同一棵树**必须转绿 —— 证明 A3 的红来自"有没有映射"，
  //     不来自模块名的字面。断言的条数由 A0 现量推，不写死。
  const src = readFileSync(join(HERE, 'shell-modules.mjs'), 'utf8');
  const patched = src.replace(
    'export const DEV_PACKAGE = {',
    `export const DEV_PACKAGE = {\n  '${GHOST}': 'libheyta-ghost-dev',`,
  );
  if (patched === src) throw new Error('A4 的变异没生效（锚点字符串写错了）—— 修臂，不许记成通过');
  const mutDir = mkdtempSync(join(tmpdir(), 'heyta-shellmodules-mut-'));
  const mutFile = join(mutDir, 'm.mjs');
  writeFileSync(mutFile, patched);
  const mod = await import(pathToFileURL(mutFile).href);
  const debs4 = mod.devPackages(d3);
  arms.push([
    `A4 同一棵树 + 补上那一行映射 ⇒ 转绿且给出 ${mods0.length + 1} 枚包名（牙在映射表，不在模块名）`,
    debs4.length === mods0.length + 1 && debs4.includes('libheyta-ghost-dev'),
  ]);

  // A6/A7 运行时那一半：同一个洞的第二种漏法。
  //     加了模块、也登记了 -dev 名，但**没登记运行时包名** ⇒ 编译与门禁都绿，
  //     而 .deb 的 Depends 缺一枚 ⇒ 用户装完起不来。
  let fail6 = false;
  try {
    runtimePackages(d3); // 真模块 + 一枚没映射的
  } catch {
    fail6 = true;
  }
  arms.push(['A6 模块有 -dev 映射之外还缺运行时包名 ⇒ 响亮失败（.deb 起不来那一族）', fail6]);

  const patched2 = src.replace(
    'export const RUNTIME_PACKAGE = {',
    `export const RUNTIME_PACKAGE = {\n  '${GHOST}': 'libheyta-ghost-0',`,
  );
  if (patched2 === src) throw new Error('A7 的变异没生效（RUNTIME_PACKAGE 锚点写错了）—— 修臂');
  const mutFile2 = join(mutDir, 'm2.mjs');
  writeFileSync(mutFile2, patched2);
  const mod2 = await import(pathToFileURL(mutFile2).href);
  const rt2 = mod2.runtimePackages(d3);
  arms.push([
    `A7 补上运行时映射 ⇒ 转绿且给出 ${mods0.length + 2} 枚（webkit 那一对传递依赖也在）`,
    rt2.length === mods0.length + 2 && rt2.includes('libheyta-ghost-0'),
  ]);

  // A8 现实对账：`package-deb.sh` 里那条 Depends 回退清单必须**等于**这里推导出来的。
  //     不是"顺手加的一条" —— 它是 `check-native-lib-registry` 的输入锚点，
  //     两边漂开就等于"门禁核对一份没人维护的字符串"。
  const debSrc = readFileSync(join(REAL, 'apps/desktop-linux/scripts/package-deb.sh'), 'utf8');
  const m2 = debSrc.match(/^\[ -n "\$DEPS" \] \|\| DEPS="([^"]+)"/m);
  if (!m2) throw new Error('A8 取不到 package-deb.sh 的 Depends 回退行 —— 锚点变了，修臂而不是跳过');
  // 比**集合**不比顺序：Depends 的书写顺序没有语义，而"少一枚/多一枚"有。
  const want = [...runtimePackages(REAL)].sort().join(',');
  const got = m2[1].split(/,\s*/).sort().join(',');
  arms.push([
    `A8 .deb 的 Depends 回退清单与推导出的 ${want.split(',').length} 枚运行时包名互为等集（两份不许漂开）`,
    m2[1] === want || got === want,
  ]);

  // A5 Makefile 整个不在 ⇒ 响亮失败。
  const d5 = mkdtempSync(join(tmpdir(), 'heyta-shellmodules-none-'));
  let fail5 = false;
  try {
    requiredModules(d5);
  } catch {
    fail5 = true;
  }
  arms.push(['A5 Makefile 取不到 ⇒ 响亮失败', fail5]);

  for (const [name, ok] of arms) console.log(`${ok ? '  ✅' : '  ❌'} ${name}`);
  const bad = arms.filter(([, ok]) => !ok).length;
  console.log(`\nself-test 臂 ${arms.length} 枚，不如预期 ${bad} 枚`);
  process.exitCode = bad === 0 ? 0 : 1;
}

function tmpTree(makefileBody) {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-shellmodules-'));
  const p = join(dir, MAKEFILE_REL);
  execFileSync('mkdir', ['-p', dirname(p)]);
  writeFileSync(p, makefileBody);
  return dir;
}

// 只有被**直接**执行时才走 CLI —— A4 要把这份源码改一行之后 import 进来当库用。
// 🔴 这一条不是风格：上一版没有守卫，A4 import 变异副本时把 CLI 也跑了一遍，
//    于是那条臂的 stdout 里混进了真仓的模块清单，退出码也被人改过。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = process.argv[2];
  if (arg === '--self-test') {
    await selfTest();
  } else if (arg === '--runtime-debs') {
    for (const d of runtimePackages(resolve(HERE, '../..'))) console.log(d);
  } else if (arg === '--debs') {
    for (const d of devPackages(resolve(HERE, '../..'))) console.log(d);
  } else if (arg === '--pairs') {
    for (const m of requiredModules(resolve(HERE, '../..'))) console.log(`${m}\t${DEV_PACKAGE[m] ?? '（未登记）'}`);
  } else {
    for (const m of requiredModules(resolve(HERE, '../..'))) console.log(m);
  }
}
