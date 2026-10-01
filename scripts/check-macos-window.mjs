/**
 * 门禁：**macOS 原生壳的窗口真的画出来了** + **壳里的真应用把注册/登录前置了**
 * （W-⑧ 替换 Electron 的 desktop-window 断言；M2-macOS 的常设验收）
 *
 * ## M2 那半段是什么（2026-09-29 加）
 *
 * 这个壳现在内嵌 **`apps/web` 的真应用**（经 `WKURLSchemeHandler`，与 Windows 壳同一个架构）。
 * 所以它同时也是 **macOS 端的"用户旅程"验收**：断言**冷启动第一屏就有注册/登录入口**
 * —— 那正是产品负责人钉死的那条（"注册/登录一定要前置，不能藏在设置里"）。
 *
 * 🔴 判据取的是**组件自己打的 testID**（`account-menu-avatar` 身份入口 /
 * `sync-signin-entry` 菜单第一项 / `添加任务` 采集框），不是"界面上有字"。
 * （"窗口出来了" ≠ "真应用画出来了"。）
 *
 * 🔴 **2026-09-30 判据改锚点**：产品负责人拍板"应该是点击头像出来注册、登录"
 * 之后，登录入口不再常驻首屏（它在头像菜单里）。首屏锚点因此改成**身份入口
 * 头像**，登录入口在**菜单打开后**再验 —— 而且判据变**更严**了：
 * 未登录时菜单第一项必须是登录/注册，且**不得**出现「退出登录」。
 *
 * ## 为什么需要它
 *
 * `check-macos-shell.mjs` 验的是**跨语言那一层 + 落盘** —— 它**不开窗**
 * （所以能在没有图形会话的环境里跑）。那条路证明不了"窗口真的画出来了、
 * 画的东西是对的"。
 *
 * 而 Electron 的 `e2e/tests/desktop-window.spec.ts` 恰恰验的就是那一格，
 * 它是**退役 Electron 之前唯一需要被替代的覆盖**（见
 * `docs/plans/multi-end-unified-strategy.md` §6.3-T3 / 执行次序 ⑧⑨）。
 *
 * ## 它断言什么（四条，每条都能失败）
 *
 * 1. 窗口**真的被截到了**（不是"进程起来了"）；
 * 2. 图**不是空白**，且**不含实际透明像素**（`looksBlank` / `hasTransparency`）；
 * 3. 取证记录自述的取图方式是 **`screencapturekit`** —— 那个字段是应用自己写的
 *    （`HeytaMacApp.swift` 的 `Method.screenCaptureKit`），所以它同时证明了
 *    "跑的是 ScreenCaptureKit 那条路"，而不是被废弃的 `CGWindowListCreateImage`
 *    （后者曾长期留在 `capture-window.sh` 的证据说明里，已修正 —— 见本门禁的兄弟教训）；
 * 4. **交叉验证通过**：自截图与外部 `screencapture -l` 尺寸一致（同一数据源）。
 *
 * ## 🔴 跳过与判红的分界（2026-10-01 裁决，Goal 任务 3）
 *
 * 拿不到图形会话 / 屏幕录制权限时，这条门禁**曾经全部响亮跳过（exit 0）**。
 * 裁决后的分界：
 *
 *   · **合法跳过（exit 0，打印含原因的 SKIP）**：目标平台不符、没有 `swift`
 *     —— 工具链不存在，这条门禁在那台机器上**本来就不可能跑**；
 *   · **判红（exit 1）**：平台与工具都在、取证却失败 —— 取证脚本 exit 4
 *     （没给屏幕录制权限）、有 Aqua 会话却取不到图、截图文件缺失或过不了判据。
 *     前者是一分钟能修的机器设置，后者是真故障；**都不许用绿色掩盖**。
 *
 * 实测踩过的坑：没有屏幕录制权限时，窗口服务器只给一张**桌面背景图** ——
 * 尺寸对、非空、看起来完全正常。所以 `capture-window.sh` 自己会做交叉验证，
 * 而本门禁对"权限/会话"的失败**宁可红也不静默通过** —— `pnpm check` 全绿
 * 而这条从未执行，正是任务书 §10 点名要堵住的形状。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectPng, looksBlank } from './screenshots/png-stats.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURE = join(ROOT, 'apps/desktop-macos/scripts/capture-window.sh');

const skip = (why) => {
  console.log(`⚠️  macOS 原生壳的**窗口**冒烟**已跳过**：${why}`);
  console.log('    ⇒ 这一条**没有被验过**。别把这次的"绿"读成"窗口画出来了"。');
  process.exit(0);
};

if (process.platform !== 'darwin') {
  skip(`当前平台是 ${process.platform}（本壳是 SwiftUI / macOS 14+）`);
}
try {
  execFileSync('swift', ['--version'], { stdio: 'ignore' });
} catch {
  skip('没有 `swift`');
}

const OUT = join(tmpdir(), `heyta-macos-window-gate-${process.pid}.png`);
// M2：共享 UI 的探测结论落在这里（**必须与 OUT 不同路径** —— 截屏脚本会写 `OUT.txt`，
// 同路径会被它覆盖；实测踩过）。
const NOTE = join(tmpdir(), `heyta-macos-m2-gate-${process.pid}`);

/**
 * 🔴 **壳的存储桥**（2026-09-30 实测，两个 env 缺一不可）。
 *
 * 本门禁判的是**冷启动、未登录**的第一屏（"注册/登录是否前置"），于是它需要两件事
 * 同时成立，而它们各自都会因为"这台机器现在的状态"而不成立：
 *
 * 1. `HEYTA_WEBKIT_EPHEMERAL=1` —— **非持久仓**。默认的仓是持久的：
 *    只要这台机器上有人真的登录过一次（比如跑过壳侧认证旅程），
 *    门禁就会看到**已登录**的 IA 而失败 —— 那是**正常状态**，不是故障。
 *    壳里那个开关就是为这件事做的（见 `HeytaMacApp.swift`：它的注释写着
 *    "它是取证用的开关，不是产品行为"）。**不设它的后果本机实测过**：
 *    `M2-MACOS ✅ 已登录（退出登录 1 个、登录入口 0 个）` ⇒ 三条断言全红。
 * 2. `HEYTA_BRIDGE_BUNDLE` —— **桥**。取证跑的是**裸 SwiftPM 可执行文件**，
 *    它旁边没有 `native-bridge.js`，于是存储宿主会退化成 `.off`；
 *    而"非持久仓 + 宿主关闭"这个组合**正好是应用起不来的那一格**
 *    （四格矩阵见 `apps/desktop-macos/evidence/storage-host/README.md`）。
 *    ⚠️ 打包的 `Heyta.app` **不需要**这个 env（桥在 `Contents/Resources` 里）；
 *    只有裸可执行文件需要。
 *
 * ⇒ 两条一起给：冷启动状态**确定**，而存储走**壳自己的 SQLite**（产品的那条路），
 *    不依赖页侧兜底。
 */
const BRIDGE = join(ROOT, 'packages/app-host/bridge-bundle/native-bridge.js');
if (!existsSync(BRIDGE)) {
  // 🔴 **响亮失败，不静默降级**：桥缺失时 `capture-window.sh` 会照常跑出一个
  //    "看起来是应用起不来"的证据，而那是**取证配置**的毛病、不是产品的 ——
  //    正是本门禁最该避免的误导。宁可在这一步说清楚怎么修。
  console.error(`❌ 壳的存储桥不存在：${BRIDGE}`);
  console.error('   先跑：node packages/app-host/scripts/build-native-bridge.mjs');
  process.exit(1);
}

// ① 跑取证脚本。**继承 stdio** —— 它的输出本身就是证据。
//
// 🔴 同时带上 `HEYTA_WEB_ROOT`：那个壳里内嵌的是**共享 UI**（M2），
//    不带的话 `ShellView` 只会说"未找到共享 UI 产物目录"，本门禁关于
//    "注册/登录前置"的那几条断言就无从谈起。
const capture = spawnSync('bash', [CAPTURE, OUT], {
  stdio: 'inherit',
  cwd: ROOT,
  timeout: 10 * 60 * 1000,
  env: {
    ...process.env,
    HEYTA_WEB_ROOT: join(ROOT, 'apps/web/dist'),
    HEYTA_M2_EVIDENCE: NOTE,
    HEYTA_BRIDGE_BUNDLE: BRIDGE,
    HEYTA_WEBKIT_EPHEMERAL: '1',
  },
});

if (capture.error) {
  console.error(`❌ 取证脚本没能启动：${capture.error.message}`);
  process.exit(1);
}

// 🔴 退出码 4 = **取证脚本自述"取图基础设施不可用"**（`-3811` / 没给屏幕录制权限）。
//
//    2026-10-01 裁决（文档中心收尾 Goal 任务 3）：这条**不再跳过，改判红**。
//    分界是：平台不符 / 工具不存在 ⇒ 跳过（上面那两条）；**平台与工具都在、
//    取证却失败 ⇒ 判红**。本机 darwin + swift 都在，ScreenCaptureKit 起不来
//    通常只是没给"屏幕录制"权限 —— 那是**一分钟就能修的机器设置**，
//    不是"永远验不了"的环境；让它静默 skip 的代价是 `pnpm check` 全绿
//    而这条门禁**从未执行**（任务书 §10 原话）。红在这里，修好权限再跑。
if (capture.status === 4) {
  console.error('❌ 取证脚本自报"取图基础设施不可用"（exit 4：ScreenCaptureKit 起不来 / 未授权）。');
  console.error('   平台与工具都在，这条门禁**必须真的跑** —— 不再静默跳过（2026-10-01 裁决）。');
  console.error('   ⇒ 系统设置 → 隐私与安全性 → 屏幕录制：给运行本命令的终端/App 授权，然后重跑。');
  console.error('   （这不是应用缺陷；但"没验过"必须用红色说，不能假装绿。）');
  process.exit(1);
}

if (capture.status !== 0 || !existsSync(OUT)) {
  // 区分"环境不给"与"真的坏了"：前者响亮跳过，后者失败。
  // 应用在拿不到屏幕录制权限时**显式**这样说（见 HeytaMacApp.swift 的 exit(4)）。
  console.log('');
  console.log('⚠️  取证脚本没跑成。判断一下是环境问题还是真故障：');
  console.log('    · 若上文出现「截图失败（多半是没给屏幕录制权限）」或「没有可见窗口」');
  console.log('      ⇒ 那是**环境**（无图形会话 / 未授权），不是代码坏了；');
  console.log('    · 其它情况（编译错、断言错、尺寸不一致）一律是**真故障**。');
  // 没有图形会话的环境里，这条必然失败 —— 机器可判的判据是
  // "有没有 Aqua 会话"，用 `launchctl managername` 读。
  let manager = '';
  try {
    manager = execFileSync('launchctl', ['managername'], { encoding: 'utf8' }).trim();
  } catch {
    manager = '';
  }
  if (manager !== 'Aqua') {
    skip(`当前不在图形会话里（launchctl managername = ${manager || '读不到'}）`);
  }
  console.error('❌ 在图形会话里取证仍然失败 —— 这是真故障，不是环境。');
  process.exit(1);
}

// ② 图本身：不能空白、不能带实际透明像素。
const stats = inspectPng(OUT);
console.log('');
console.log(`   ${stats.width}x${stats.height}  colorType=${stats.colorType}  hasAlpha=${stats.hasAlpha}`);
console.log(`   内容比例 ${(stats.contentRatio * 100).toFixed(1)}%   色阶差 ${stats.colorSpan}`);

let bad = false;
if (stats.hasTransparency) {
  console.error('   🔴 含实际透明像素 —— 窗口图应当已合成到不透明底上');
  bad = true;
}
if (looksBlank(stats)) {
  console.error('   🔴 疑似空白 —— 窗口没画出来（这类失败最阴：它什么错都不报）');
  bad = true;
}

// ③ 取证记录自述的取图方式必须是 **screencapturekit**。
const narrative = `${OUT.replace(/\.png$/, '')}.txt`;
if (!existsSync(narrative)) {
  console.error(`   🔴 取证说明不存在：${narrative}（证据必须自述它是怎么来的）`);
  bad = true;
} else {
  const txt = readFileSync(narrative, 'utf8');
  const method = /CAPTURE_METHOD=(\S+)/.exec(txt)?.[1];
  if (method !== 'screencapturekit') {
    console.error(`   🔴 取图方式不是 screencapturekit（读到 ${method ?? '缺失'}）——`);
    console.error('      应用已从废弃的 CGWindowListCreateImage 迁到 ScreenCaptureKit，');
    console.error('      这里读到别的值说明跑的不是那条路，或证据说明被改坏了。');
    bad = true;
  } else {
    console.log('   ✅ CAPTURE_METHOD=screencapturekit');
  }

  // ④ 交叉验证（脚本自己算的，这里只读结果）
  const cross = /CROSSCHECK=(\S+)/.exec(txt)?.[1];
  if (!cross?.startsWith('ok')) {
    console.error(`   🔴 交叉验证没通过（CROSSCHECK=${cross ?? '缺失'}）——`);
    console.error('      自截图与 `screencapture -l` 尺寸不一致 ⇒ 自截图不可信。');
    bad = true;
  } else {
    console.log(`   ✅ CROSSCHECK=${cross}`);
  }

  const size = /WINDOW_SIZE=(\S+)/.exec(txt)?.[1];
  const title = /WINDOW_TITLE=(\S+)/.exec(txt)?.[1];
  console.log(`   窗口：${title ?? '?'} ${size ?? '?'}`);
  if (title !== 'heyta') {
    console.error(`   🔴 窗口标题不是 heyta（读到 ${title ?? '缺失'}）`);
    bad = true;
  }
}

/**
 * 🔴 **"应用到底画出来没有"落在这份快照上，不落在窗口截图上。**
 *
 * 实测（2026-09-30）：窗口截图走**窗口服务器合成**，而在这台机器上
 * "WebView 的内容没合成进窗口"是**常态** —— 抓到的是暗窗口 + 一行诊断文字，
 * 内容比例 100%、色阶差 158、**主蓝 0**，而"非空 / 不透明 / 取图方式 / 交叉验证"
 * **四条全过**（人眼一看就知道里面没有应用）。
 *
 * `takeSnapshot` 直接问 WebKit 要渲染结果：**不走窗口服务器、不需要录屏权限**，
 * 所以它稳定。于是两份产物各证一件事，谁也不替谁背书：
 *
 *   · 窗口截图              → 一个真的 macOS 窗口（标题 / 尺寸 / 非空 / 取图方式 / 尺寸交叉验证）
 *   · WebView 快照          → **壳里那份共享 UI 真的渲染出来了**（数主蓝）
 *
 * ⚠️ 判据取 **主蓝像素**（`--ht-blue-600`）：heyta 的界面一定有它
 *    （rail 激活项 / 主按钮），而错误屏、空白屏、桌面底色**都没有**。
 *    这条判据 `png-stats.mjs` 早就导出了，只是这个门禁一直没用它。
 */
const snapshot = `${OUT}.webview.png`;  // 应用是**追加**，不是替换扩展名（第一版算错了）
if (!existsSync(snapshot)) {
  console.error(`   🔴 没有 WebView 快照：${snapshot}`);
  console.error('      ⇒ 无法判断"壳里的共享 UI 画出来了没有"（窗口截图担不起这条）。');
  bad = true;
} else {
  /**
   * 🔴 判据取 **`contentOnModalRatio`**（"有多少像素不是背景色"），阈值 **0.02**。
   *
   * 为什么不是主蓝：**壳跟随系统外观**，暗色主题下主蓝几乎不出现 ——
   * 实测同一张真应用快照只有 **46** 个主蓝像素，拿它判会把**真应用**判死。
   *
   * 为什么是它：它是**比值**，与主题无关；而且三张已知图分得很开（2026-09-30 实测）：
   *
   *   | 图 | contentOnModalRatio |
   *   |---|---|
   *   | 真应用（暗） | **0.057** |
   *   | 暗窗口·无应用（WebView 没合成进窗口） | 0.006 |
   *   | 过期的「找不到共享 UI 产物」回退屏 | 0.004 |
   *
   * 阈值 0.02：真应用高出 2.8×，两张坏图低 3–5×。
   * ⚠️ `edgePairs` **不能**用：三张图都是 ~20034（归一的固定分母）。
   */
  const snap = inspectPng(snapshot);
  console.log(
    `   WebView 快照 ${String(snap.width)}x${String(snap.height)}  ` +
      `contentOnModalRatio ${snap.contentOnModalRatio.toFixed(3)}（判据阈值 0.02）`,
  );
  if (snap.contentOnModalRatio < 0.02) {
    console.error(
      `   🔴 快照里几乎没有内容（contentOnModalRatio ${snap.contentOnModalRatio.toFixed(3)}）——\n` +
        '      壳里画的**不是真应用**。最可能是「找不到共享 UI 产物」那张错误屏，\n' +
        '      或 WebView 没渲染出内容：它们非空、不透明，窗口那几条全会过。',
    );
    bad = true;
  } else {
    console.log('   ✅ 壳里的共享 UI 真的渲染出来了（快照里有成片的内容）');
  }
}

// ⑤ M2：壳里的**真应用**把身份入口做对了吗。
const notePath = `${NOTE}.txt`;
if (!existsSync(notePath)) {
  console.error(`   🔴 没拿到 M2 探测结论（${notePath}）——`);
  console.error('      壳里没有内嵌共享 UI，或 SHELL 那半边被改坏了。');
  bad = true;
} else {
  console.log(`   WebView 快照：${snapshot}`);
  const note = readFileSync(notePath, 'utf8');
  const m2 = /M2_MACOS_NOTE=(.*)/.exec(note)?.[1] ?? '';
  // 三条都要：① 冷启动第一屏有**身份入口**（头像）与采集框；
  // ② 打开菜单后**身份菜单合规**（第一项=登录/注册，且没有退出登录）；
  // ③ 设置里的**滴答导入面板**可达。
  //
  // ③ 是 ⑩ 第 7 项（滴答导入三端入口）在桌面端的那一半 ——
  // 桌面壳加载的**就是 web 的同一份构建**，所以这个入口**不该例外**；
  // 而「设置点得开、面板在不在」恰恰是加载成功也**照样可能假**的一件事。
  const NEEDED = [
    { ok: m2.includes('✅') && m2.includes('身份入口成立'), what: '冷启动第一屏的身份入口（头像）' },
    { ok: m2.includes('身份菜单合规'), what: '未登录时头像菜单的 IA（第一项=登录/注册、无退出登录）' },
    { ok: m2.includes('滴答导入面板可达'), what: '设置里的滴答导入入口' },
  ];
  const missing = NEEDED.filter((n) => !n.ok);
  if (missing.length === 0) {
    console.log(`   ✅ ${m2.trim()}`);
  } else {
    console.error(`   🔴 缺：${missing.map((n) => n.what).join(' / ')}`);
    console.error(`      探测结论：${m2.trim() || '（空）'}`);
    bad = true;
  }
}

if (bad) {
  console.error('❌ macOS 原生壳的窗口冒烟**未通过**。');
  process.exit(1);
}

console.log('');
console.log('✅ macOS 原生壳的窗口：画出来了、非空、不透明、取图方式正确、交叉验证通过，');
console.log('   且**壳里的真应用把身份入口做对了**（头像可点开、菜单第一项=登录/注册）（M2-macOS）。');