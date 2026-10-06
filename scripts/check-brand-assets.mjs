#!/usr/bin/env node
/**
 * `scripts/check-brand-assets.mjs` —— 品牌产物（图标 + 首屏动画）的**接线对账**
 *
 * ## 它和两个生成器的分工
 *
 * `gen-app-icons.mjs --check` 与 `gen-boot-splash.mjs --check` 已经钉住了
 * "产物 == 从 token 生成的那一份"。本文件钉的是它们**结构上看不见**的那一半：
 * **产物有没有被清单引用、被代码消费**。
 *
 * 为什么要单独钉这一半 —— 本轮实测抓到的两件事都在这里：
 *
 * 1. 图标那笔提交（`c9fe6f56`）把自适应图标的 `foreground android:drawable=
 *    "@mipmap/ic_launcher_foreground"` 写进了 XML 并提交，而**五档前景层 PNG
 *    从没被提交** ⇒ `git ls-tree -r HEAD | grep -c foreground` = **0**，
 *    干净检出打 APK 时 AAPT 直接找不到资源。工作树里文件在、生成器对账全绿、
 *    `pnpm check` 全绿 —— 因为它扫的是工作树，不是**提交物**。
 * 2. `index.html` 里那层满屏品牌帧生成之后，**没有任何代码把它摘掉**。
 *    装出来的桌面端会永远停在品牌帧上，而截图判据"非空白 + 数得出主蓝"
 *    会满分通过 —— 那块底板本身就是 `#2563eb`。
 *
 * 两件事的形状是同一个：**东西都在，没人引用它 / 没人消费它**。
 * 所以这里的每一条判据问的都是"谁指向它"，不是"它在不在"。
 *
 * ## 判据能失败吗
 *
 * 能。至少这几处摘掉会红（臂与读数写在计划文档 §6）：
 *   - 从 `main.tsx` 删掉 `armBootSplashDismiss` 调用 ⇒「退场已接线」红
 *   - 把那次调用挪到 `root.render` **之后** ⇒「顺序」红（漏掉早渲染的竞态）
 *   - 让任意一档 `ic_launcher_foreground.png` **不在 HEAD 里** ⇒「前景层在提交物里」红
 *   - 把 `AndroidManifest` 的 `android:icon` 改掉 ⇒「清单引用」红
 *
 * 🔴 第三条原来**抓不到它自己举的那个例子**：它写的是 `existsSync`（判工作树），
 * 而本文件开头讲的事故恰恰是"工作树里在、HEAD 里没有"。标签写着"在树上"，
 * 判据量的是另一棵树 —— 这是同一文件第 20 行那句"因为它扫的是工作树，不是提交物"
 * 的复发，只不过这次复发在它自己头上。现在这条走 `git ls-tree -r HEAD`。
 *
 * @see docs/plans/brand-icon-and-splash.md
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const problems = [];
const ok = [];
/** 响亮跳过（不是静默）：环境不给的判据列出来，让读输出的人知道这轮**少验了什么**。 */
const skipped = [];

/** 读一个必须存在的文件；读不到就是**判据红**，不是跳过（§7 第 191 条）。 */
function mustRead(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    problems.push(`${rel}：文件不存在 —— 这条判据不能因为目标缺失而静默放行`);
    return null;
  }
  return readFileSync(abs, 'utf8');
}

function check(label, rel, predicate) {
  const text = rel === null ? '' : mustRead(rel);
  if (text === null) return;
  const verdict = predicate(text);
  if (verdict === true) ok.push(label);
  else problems.push(`${label}${typeof verdict === 'string' ? `：${verdict}` : ''}`);
}

/**
 * **提交物**里有没有这个路径（`git ls-tree -r HEAD`），与工作树无关。
 *
 * 🔴 取不到清单必须是**响亮地红**，不能退化成"跳过"（§7 第 191 条）：所以这里
 * 不 catch 后返回空集合，而是把 git 的失败本身登记成一条 problem。
 */
let tree = null;
let treeError = null;
try {
  tree = new Set(
    execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean),
  );
  // 阳性对照：git 在"不在仓库里"时也会退 0 并输出空串，那时每条"在树上"都会
  // 以"缺失"失败 —— 但那句失败讲的是探针，不是产品。空集合直接点名探针。
  if (tree.size < 500) treeError = `只列出 ${tree.size} 个路径 —— 这不像一个 HEAD`;
} catch (err) {
  treeError = `git ls-tree 失败：${String(err.message ?? err).trim()}`;
}

function checkOnTree(label, rel) {
  if (treeError !== null) {
    problems.push(`${label}：提交物清单取不到（${treeError}）—— 这条判据不能凭空放行`);
    return;
  }
  if (tree.has(rel)) ok.push(label);
  else problems.push(`${label}：${rel} 在工作树里，但**不在 HEAD 里** —— 干净检出不含它`);
}

/**
 * 四个品牌资产目录里不许有**未跟踪**的文件。
 *
 * 只判未跟踪，不判"已跟踪但有未提交修改"：后者是别人正在做的事（那枚图标
 * 还在被人调），拿它当红等于把工作树干净度挂成 check 链的前提。而未跟踪的
 * 位图**不可能**在 HEAD 里，是 `c9fe6f56` 那个事故的原始形状。
 */
function checkNoUntrackedAssets(label, dirs) {
  if (treeError !== null) {
    problems.push(`${label}：提交物清单取不到（${treeError}）`);
    return;
  }
  let out;
  try {
    out = execFileSync(
      'git',
      ['ls-files', '--others', '--exclude-standard', '--', ...dirs],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } catch (err) {
    problems.push(`${label}：git ls-files 失败：${String(err.message ?? err).trim()}`);
    return;
  }
  const untracked = out.split('\n').filter(Boolean);
  if (untracked.length === 0) ok.push(label);
  else
    problems.push(
      `${label}：${untracked.length} 个未跟踪资产文件 —— ${untracked.slice(0, 4).join(', ')}`,
    );
}

/* ── 1. 两个生成器：产物与 token 逐字节对账 ─────────────────────────── */
for (const [label, script] of [
  ['应用图标生成器对账', 'scripts/gen-app-icons.mjs'],
  ['首屏动画生成器对账', 'scripts/gen-boot-splash.mjs'],
]) {
  try {
    execFileSync(process.execPath, [script, '--check'], { cwd: ROOT, stdio: 'pipe' });
    ok.push(label);
  } catch (err) {
    const out = `${String(err.stdout ?? '')}${String(err.stderr ?? '')}`.trim().split('\n').slice(0, 6).join(' | ');
    problems.push(`${label}：${script} --check 非零退出 —— ${out || String(err)}`);
  }
}

/* ── 2. web：品牌帧在 HTML 里，并且有人负责把它摘掉 ─────────────────── */
check(
  'web：index.html 含生成物标记与遮罩节点',
  'apps/web/index.html',
  (t) =>
    t.includes('HEYTA-BOOT-SPLASH:BEGIN') &&
    t.includes('id="heyta-boot"') &&
    t.includes('HEYTA-BOOT-SPLASH:END') ||
    '缺 BEGIN/END 标记或 #heyta-boot 节点',
);
check(
  'web：退场模块存在',
  'apps/web/src/boot-splash.ts',
  (t) => t.includes('export function armBootSplashDismiss') || '没有导出 armBootSplashDismiss',
);
check(
  'web：退场已接线（main.tsx 引用并调用）',
  'apps/web/src/main.tsx',
  (t) =>
    (t.includes("from './boot-splash.js'") && t.includes('armBootSplashDismiss(')) ||
    '没有 import 或没有调用 —— 后果是遮罩永远盖在应用上，而截图判据全绿',
);
/**
 * 剥掉注释后再做位置判断。
 *
 * 这不是防御性冗余，是**当场踩到的**：第一版直接对 `main.tsx` 原文做
 * `indexOf('root.render(')`，结果它命中的是我自己写的那句注释
 * "在任何 `root.render()` 之前调用" —— 于是这条判据报"接线晚于渲染"，
 * 而代码顺序是对的。**门禁命中它自己读的文档残留**（同类：§7 第 191 条、
 * 取证定位命中套件自己留下的字符串）。
 */
function stripComments(text) {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
}

check(
  'web：接线早于任何一次 root.render',
  'apps/web/src/main.tsx',
  (t) => {
    const code = stripComments(t);
    const arm = code.indexOf('armBootSplashDismiss(');
    const firstRender = code.indexOf('root.render(');
    if (arm === -1) return '找不到调用点';
    if (firstRender === -1) return '找不到 root.render —— 这条判据的对照物没了';
    return arm < firstRender || `调用在第 ${arm} 字节、第一次 render 在第 ${firstRender} 字节：晚于渲染会漏掉早挂载的分支`;
  },
);

/* ── 3. Android：前景层必须在**提交物**里，且清单真的指向它 ─────────── */
const FOREGROUND_DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
for (const d of FOREGROUND_DENSITIES) {
  checkOnTree(`android：前景层 ${d} 在提交物里`, `apps/mobile/android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`);
}
check(
  'android：自适应图标引用前景层',
  'apps/mobile/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
  (t) => t.includes('@mipmap/ic_launcher_foreground') || 'adaptive-icon 没有引用 ic_launcher_foreground',
);
check(
  'android：Manifest 引用图标与主题',
  'apps/mobile/android/app/src/main/AndroidManifest.xml',
  (t) =>
    (t.includes('android:icon="@mipmap/ic_launcher"') && t.includes('android:theme="@style/AppTheme"')) ||
    'android:icon / android:theme 不再指向我们那一份',
);
check(
  'android：12+ 启动屏三项挂在主题上',
  'apps/mobile/android/app/src/main/res/values-v31/styles.xml',
  (t) =>
    (t.includes('windowSplashScreenBackground') &&
      t.includes('windowSplashScreenAnimatedIcon') &&
      t.includes('windowSplashScreenAnimationDuration')) ||
    '缺 windowSplashScreen* 主题项 —— Android 12+ 那一帧就不是我们说了算',
);
check(
  'android：刻意不设 brandingImage（官方设计指南劝退）',
  'apps/mobile/android/app/src/main/res/values-v31/styles.xml',
  (t) => !t.includes('windowSplashScreenBrandingImage') || '出现了 brandingImage',
);
check(
  'android：主题只有一份内容（Base + 叠加，不是两份逐字拷贝）',
  'apps/mobile/android/app/src/main/res/values/styles.xml',
  (t) =>
    (t.split('<style name="AppTheme.Base"').length - 1 === 1 &&
      t.includes('<style name="AppTheme" parent="AppTheme.Base"')) ||
    'AppTheme 又长出第二份内容体 —— 那是两套裁决标准的形状',
);

/* ── 4. iOS：静态启动帧必须挂在清单上、画的是我们的 mark ───────────── */
check(
  'ios：Info.plist 仍指向 LaunchScreen',
  'apps/mobile/ios/Heyta/Info.plist',
  (t) => /<key>UILaunchStoryboardName<\/key>\s*<string>LaunchScreen<\/string>/.test(t) || 'UILaunchStoryboardName 不再是 LaunchScreen',
);
check(
  'ios：启动帧用的是品牌 mark，且零文案',
  'apps/mobile/ios/Heyta/LaunchScreen.storyboard',
  (t) =>
    (t.includes('image="HeytaLaunchMark"') &&
      t.includes('launchScreen="YES"') &&
      !t.includes('Powered by React Native') &&
      !t.includes('<label')) ||
    '启动帧回到脚手架文案 / 带上了文字 —— storyboard 在 bundle 之前渲染，i18n 够不着它',
);
check(
  'ios：底色走 color asset（亮/暗两档）',
  'apps/mobile/ios/Heyta/LaunchScreen.storyboard',
  (t) => t.includes('name="HeytaSplashBackground"') || '底色是内联字面值，暗色模式会先闪一张亮板',
);
checkOnTree('ios：colorset 在提交物里', 'apps/mobile/ios/Heyta/Images.xcassets/HeytaSplashBackground.colorset/Contents.json');
checkOnTree('ios：mark 图集在提交物里', 'apps/mobile/ios/Heyta/Images.xcassets/HeytaLaunchMark.imageset/Contents.json');

/* ── 3a. xcassets 的 Contents.json 必须**解析得开**（存在性挡不住坏字节） ──
 *
 * 🔴 这条是 10-05 01:2x 四端重装的 ios 段**当场炸出来的**：`xcodebuild Release` 报
 *   `error: failed to read asset tags: … actool --print-asset-tag-combinations …`
 *   `Badly formed object around line 6, column 62` —— 出处是 `gen-boot-splash.mjs:445`
 *   写 `blue` 那一档时**少了一个收尾引号**（`"0.988, ` 而不是 `"0.988", `），
 *   于是提交物里的 colorset 从来不是合法 JSON。
 *   而 `pnpm check` 那一路**一直是绿的**：上面那两格只问"在不在提交物里"。
 *   ⇒ 这就是本仓库登记过的形状：**存在性判据把"有这个文件"当成"这个文件能用"**
 *     （§7 那条「断言只会验界面写了什么，不会验界面少了什么」的字节版）。
 *   生成器与提交物可以**逐字一致而一起是坏的** —— 所以牙齿要长在"读得开 + 形状对"上，
 *   不是长在"和生成器比一致"上。 */
function checkAssetJson(label, rel, shape) {
  check(label, rel, (t) => {
    let doc;
    try {
      doc = JSON.parse(t);
    } catch (err) {
      // 把解析器给的行列原样带出来：这次事故的证据就是那两个数字，人拿它能直接定位
      return `不是合法 JSON（actool 会整趟构建失败）—— ${String(err.message ?? err).trim()}`;
    }
    return shape(doc);
  });
}

checkAssetJson(
  'ios：colorset 解析得开且亮暗两档各带四个分量',
  'apps/mobile/ios/Heyta/Images.xcassets/HeytaSplashBackground.colorset/Contents.json',
  (doc) => {
    const colors = doc?.colors;
    if (!Array.isArray(colors) || colors.length !== 2) return `colors 不是亮/暗两档（读到 ${Array.isArray(colors) ? colors.length : typeof colors}）`;
    if (!colors[1]?.appearances?.some((a) => a?.appearance === 'luminosity' && a?.value === 'dark'))
      return '第二档没写 luminosity=dark ⇒ 暗色模式下这张板是亮的';
    for (const [i, c] of colors.entries()) {
      const comp = c?.color?.components ?? {};
      for (const k of ['alpha', 'blue', 'green', 'red']) {
        if (!/^\d\.\d{3}$/.test(String(comp[k] ?? '')))
          return `第 ${i} 档的 ${k} 不是 "0.xxx" 四字面量（读到 〈${comp[k] ?? '∅'}〉）—— Xcode 按字符串读分量`;
      }
    }
    return true;
  },
);

checkAssetJson(
  'ios：mark 图集解析得开且真挂着图',
  'apps/mobile/ios/Heyta/Images.xcassets/HeytaLaunchMark.imageset/Contents.json',
  (doc) => {
    const images = doc?.images;
    if (!Array.isArray(images) || images.length === 0) return 'images 是空的 —— 启动帧会是一张透明图';
    if (!images.every((im) => typeof im?.filename === 'string' && im.filename.length > 0))
      return '有档位没挂 filename';
    return true;
  },
);

/* ── 3c. storyboard **编得过**（存在性与文本形状都挡不住 ibtool 崩） ──────
 *
 * 🔴 这条是 10-05 01:5x 四端重装的 ios 段第二次炸出来的，而且它换了个死法：
 *   上一次（01:2x）是 colorset 不是合法 JSON，被 492e2124 的"解析得开"判据接住了；
 *   这一次 JSON 全合法、`--check` 逐字节全绿，而 `xcodebuild` 报
 *   `CompileStoryboard LaunchScreen.storyboard … failed with a nonzero exit code`。
 *   根因是生成器给 <color> 元素写了一个 id 属性 —— **ibtool 对它的反应是
 *   rc=255 且零输出**（A/B 现量：带 id=255 / 去掉 id=0 并产出 .storyboardc；
 *   加不加 catalog="Images" 都一样；imageView / constraint 带 id 是合法的）。
 *   ⇒ 一个**不产生任何诊断**的工具链失败，只能靠"真的编一遍"当判据。
 *
 * 两层都要，缺一层就漏：
 *   · 结构判据（永远跑，含非 macOS 宿主）：color 元素不许带 id；
 *   · 真编译（有 ibtool 才跑）：跑完还要**看到产物** —— 本仓库已经量过
 *     "命令 rc=0 而什么都没产出"的假绿（§7 那一族），所以产物存在性是断言的一部分。
 */
check(
  'ios：storyboard 的 color 元素不带 id 属性',
  'apps/mobile/ios/Heyta/LaunchScreen.storyboard',
  (t) => {
    const bad = [...t.matchAll(/<color\b[^>]*\bid=/g)];
    return (
      bad.length === 0 ||
      `有 ${bad.length} 个 <color …> 带 id —— ibtool 以 rc=255 退出且零输出，` +
        'xcodebuild 只会说 CompileStoryboard failed'
    );
  },
);

{
  let ibtool = '';
  try {
    ibtool = execFileSync('xcrun', ['--find', 'ibtool'], { encoding: 'utf8' }).trim();
  } catch {
    ibtool = '';
  }
  if (ibtool === '' || !existsSync(ibtool)) {
    skipped.push('ios：storyboard 真编译（这台机器没有 ibtool —— 非 macOS/无 Xcode 宿主，响亮跳过）');
  } else {
    const storyboard = join(ROOT, 'apps/mobile/ios/Heyta/LaunchScreen.storyboard');
    const out = mkdtempSync(join(tmpdir(), 'heyta-storyboard-'));
    try {
      execFileSync(
        ibtool,
        [
          '--errors',
          '--warnings',
          '--notices',
          '--module',
          'Heyta',
          '--output-partial-info-plist',
          join(out, 'partial.plist'),
          '--auto-activate-custom-fonts',
          '--target-device',
          'iphone',
          '--target-device',
          'ipad',
          '--minimum-deployment-target',
          '17.0',
          '--output-format',
          'human-readable-text',
          storyboard,
          '--compilation-directory',
          out,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      // 🔴 产物必须真在：只判"没抛异常"会被"rc=0 而零输出、零产物"骗过去（实测过）。
      const built = existsSync(join(out, 'LaunchScreen.storyboardc'));
      if (!built) {
        problems.push(
          'ios：storyboard 真编译 —— ibtool 退出码 0 但**没有产出 LaunchScreen.storyboardc**，' +
            '这不算通过（装出来的包会没有启动屏）',
        );
      } else {
        ok.push('ios：storyboard 真编译（ibtool 产出 .storyboardc）');
      }
    } catch (err) {
      const detail = String(err.stdout ?? '').trim() || String(err.stderr ?? '').trim() || String(err.message ?? err).trim();
      problems.push(
        `ios：storyboard 真编译失败 —— xcodebuild 到了这一步同样会红。诊断：${detail.slice(0, 400)}`,
      );
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }
}

/* ── 3b. 四个资产目录里不许躺着未跟踪的位图（c9fe6f56 的原始形状） ──── */
checkNoUntrackedAssets('资产：生成物全部已跟踪', [
  'apps/mobile/android/app/src/main/res/mipmap-mdpi',
  'apps/mobile/android/app/src/main/res/mipmap-hdpi',
  'apps/mobile/android/app/src/main/res/mipmap-xhdpi',
  'apps/mobile/android/app/src/main/res/mipmap-xxhdpi',
  'apps/mobile/android/app/src/main/res/mipmap-xxxhdpi',
  'apps/desktop-windows/assets',
  'apps/web/public/icons',
  'apps/mobile/ios/Heyta/Images.xcassets',
]);

/* ── 5. token：动效档位必须还在（生成器靠它，界面也靠它） ──────────── */
check(
  'token：首屏四档时长 + 层级 + mark 尺寸齐备',
  'packages/design-system/src/tokens.css',
  (t) =>
    ['--ht-duration-splash-enter', '--ht-duration-splash-stagger', '--ht-duration-splash-hold', '--ht-duration-splash-exit', '--ht-z-splash', '--ht-layout-splash-mark']
      .filter((n) => !t.includes(n))
      .join(', ') === '' || '缺 token（首屏动画不许自带字面时长）',
);

/* ── 出口 ─────────────────────────────────────────────────────────── */
// 阳性对照：上面所有判据都可能因为"读不到文件"而一个都不执行，
// 那正是 §7 第 191 条的形状 —— 所以这里断言**跑到的条数**有下限。
const MIN_CHECKS = 18;
if (ok.length + problems.length < MIN_CHECKS) {
  problems.push(`只执行了 ${ok.length + problems.length} 条判据（下限 ${MIN_CHECKS}）—— 枚举面或文件面坏了，不算通过`);
}

if (problems.length > 0) {
  console.error(`🔴 品牌产物接线对账失败（${problems.length} 条）：`);
  for (const p of problems) console.error(`   - ${p}`);
  console.error('   闭合命令：node scripts/gen-app-icons.mjs && node scripts/gen-boot-splash.mjs');
  process.exit(1);
}

if (skipped.length > 0) {
  for (const line of skipped) console.log(`  ⏭  ${line}`);
}
console.log(`  ✅ 品牌产物接线对账通过（${ok.length} 条：生成物逐字节 + 清单引用 + 消费方接线 + 真编译）`);
