/**
 * `png-stats.mjs` 的验收。
 *
 *   node --test scripts/screenshots/png-stats.test.mjs
 *
 * 🔴 **为什么不能只测自己**：解析器写错了照样能跑出"看起来正常"的数字
 * —— 亮度算错、采样跳错、通道读错，产出的仍是 0~1 的比值和一个像模像样的
 * 色阶差。所以这里分两层：
 *
 *   1. **已知像素的合成图**（用 `magick` 造，像素值是定的）→ 断言精确值；
 *   2. **真实文件**上用 `magick identify` 交叉验证尺寸与 PNG 色彩类型
 *      —— 两个工具对得上，才认这个解析器。
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, after } from 'node:test';

import {
  inspectPng,
  looksBlank,
  looksSmeared,
  countColor,
  countBrandBlue,
  HEYTA_BLUE,
  HEYTA_BLUE_DARK,
  HEYTA_BLUE_TOLERANCE,
} from './png-stats.mjs';

const workdir = mkdtempSync(join(tmpdir(), 'heyta-png-stats-'));
after(() => rmSync(workdir, { recursive: true, force: true }));

const hasMagick = (() => {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** 用 ImageMagick 造一张图并返回路径。 */
function makeImage(name, args) {
  const out = join(workdir, name);
  execFileSync('magick', [...args, out]);
  return out;
}

test('纯白图被判为空白（contentRatio=0，colorSpan=0）', { skip: !hasMagick }, () => {
  const file = makeImage('white.png', ['-size', '120x80', 'xc:white']);
  const stats = inspectPng(file);
  assert.equal(stats.width, 120);
  assert.equal(stats.height, 80);
  // 不硬编码「IM 会写成什么格式」—— 以 PNG 自己的 IHDR 字节为基准
  assert.equal(stats.colorType, readFileSync(file)[25], 'colorType 应与 IHDR 字节一致');
  assert.equal(stats.hasAlpha, false);
  assert.equal(stats.colorSpan, 0, '纯白图色阶差必须是 0');
  assert.equal(stats.contentRatio, 0, '纯白图非白采样比例必须是 0');
  assert.equal(looksBlank(stats), true, '纯白图必须被判为空白');
});

test('左黑右白图比例≈50%、色阶差 255', { skip: !hasMagick }, () => {
  const file = makeImage('half.png', [
    '-size', '100x100', 'xc:white',
    '-fill', 'black', '-draw', 'rectangle 0,0 49,99',
  ]);
  const stats = inspectPng(file);
  assert.equal(stats.colorSpan, 255, '黑白同图色阶差必须是 255');
  // 采样有跳步，给 2% 容差
  assert.ok(
    Math.abs(stats.contentRatio - 0.5) < 0.02,
    `非白比例应≈0.5，实得 ${stats.contentRatio.toFixed(4)}`,
  );
  assert.equal(looksBlank(stats), false);
});

test('浅色但非空的内容不会被误判为空白', { skip: !hasMagick }, () => {
  // 248 阈值下：247 算"有内容"，249 算"白"
  const justBelow = makeImage('gray247.png', ['-size', '60x60', 'xc:rgb(247,247,247)']);
  const justAbove = makeImage('gray249.png', ['-size', '60x60', 'xc:rgb(249,249,249)']);
  assert.ok(inspectPng(justBelow).contentRatio > 0.99, '247 应几乎全算作非白');
  assert.equal(inspectPng(justAbove).contentRatio, 0, '249 应全算作白');
  // 249 的图整幅同色 ⇒ 色阶差 0 ⇒ 仍判空白
  assert.equal(looksBlank(inspectPng(justAbove)), true);
});

test('带 alpha 的 PNG 被识别为 hasAlpha', { skip: !hasMagick }, () => {
  // PNG32: 强制 8 位 RGBA —— 不靠 xc:none（IM 会把它优化掉 alpha）
  const out = join(workdir, 'alpha.png');
  execFileSync('magick', ['-size', '40x40', 'xc:red', `PNG32:${out}`]);
  const stats = inspectPng(out);
  assert.equal(stats.colorType, 6, 'PNG32 应是 RGBA');
  assert.equal(stats.hasAlpha, true);
  assert.equal(stats.colorType, readFileSync(out)[25], 'colorType 应与 IHDR 字节一致');
});

test('索引色 PNG 能正确解出调色板颜色', { skip: !hasMagick }, () => {
  // PNG8: 前缀才会产出索引色（colorType=3）
  const out = join(workdir, 'palette.png');
  execFileSync('magick', ['-size', '50x50', 'xc:white', '-colors', '2', `PNG8:${out}`]);
  const stats = inspectPng(out);
  assert.equal(stats.colorType, 3, 'PNG8 应是索引色（colorType=3）');
  assert.equal(stats.hasAlpha, false);
  assert.equal(stats.contentRatio, 0, '纯白索引图应无内容');
  assert.equal(stats.colorSpan, 0);
  assert.equal(looksBlank(stats), true);
});

test('与 magick identify 交叉验证：真实文件的尺寸与色彩类型', { skip: !hasMagick }, () => {
  const candidates = [
    // 本仓库自己生成的 App 图标
    join(process.cwd(), 'apps/mobile/ios/Heyta/Images.xcassets/AppIcon.appiconset/icon-1024.png'),
    // SSOS 的真实产品截图（异库样本，证明解析器不是只对本仓库的文件成立）
    join(
      process.env.HOME,
      'Desktop/All in one Data/01_PROJECTS/ssos/screenshots/software-copyright/1.0.0/desktop/P15-财务报表.png',
    ),
    join(
      process.env.HOME,
      'Desktop/All in one Data/01_PROJECTS/ssos/screenshots/software-copyright/1.0.0/desktop/P28-薪酬管理.png',
    ),
  ].filter(existsSync);

  assert.ok(candidates.length >= 2, `真实样本不足（找到 ${candidates.length} 个）`);

  for (const file of candidates) {
    const mine = inspectPng(file);
    // 尺寸基准：ImageMagick
    const dims = execFileSync('magick', ['identify', '-format', '%w %h', file])
      .toString().trim().split(/\s+/).map(Number);
    assert.deepEqual([mine.width, mine.height], dims, `${mine.name}: 尺寸与 magick 不一致`);

    // 色彩类型基准：PNG IHDR 第 25 字节（偏移 = 8 sig + 4 len + 4 type + 4 w + 4 h + 1 depth）
    const colorTypeByte = readFileSync(file)[25];
    assert.equal(mine.colorType, colorTypeByte, `${mine.name}: colorType 与 IHDR 字节不一致`);
    assert.equal(mine.hasAlpha, colorTypeByte === 4 || colorTypeByte === 6);

    // 真实产品截图必须**不是空白**，否则说明解析器把内容读丢了
    assert.equal(looksBlank(mine), false,
      `${mine.name} 被判为空白 —— 真实产品截图不可能是空白，先怀疑解析器`);
  }
});

test('非 PNG 输入直接报错，不静默给错值', () => {
  const bogus = join(workdir, 'not-a-png.bin');
  execFileSync('sh', ['-c', `printf 'not a png at all' > '${bogus}'`]);
  assert.throws(() => inspectPng(bogus), /不是 PNG/);
});

test('🔴 RGBA（colorType=6）的像素必须按 4 通道读，不能写死 3', { skip: !hasMagick }, () => {
  // 这是实测踩出来的 bug：真彩分支写成 x*3，于是 RGBA 图**整幅错位**，
  // 指标算出 0.99（而同一张图存成 RGB 是 0.007，差 140 倍）。
  //
  // ⚠️ 用**黑白**两半而不是红蓝：所有指标都是基于**亮度**的
  //    （luminance = (r+g+b)/3），而红(255,0,0)与蓝(0,0,255)亮度都是 85 ——
  //    红蓝边界对这套指标是**不可见**的（实测 colorSpan=0）。
  //    这是指标的已知边界：它判的是明暗结构，不判色相。
  const out = join(workdir, 'rgba-halves.png');
  execFileSync('magick', [
    '-size', '200x100', 'xc:black',
    '-fill', 'white', '-draw', 'rectangle 100,0 199,99',
    `PNG32:${out}`,
  ]);
  const stats = inspectPng(out);
  assert.equal(stats.colorType, 6, 'PNG32 应是 RGBA');
  assert.equal(stats.hasAlpha, true);
  assert.equal(stats.colorSpan, 255, '黑白两半的色阶差必须是 255');
  assert.ok(
    stats.contentOnModalRatio > 0.3,
    `两色各半 ⇒ 内容占比应 >30%，实得 ${(stats.contentOnModalRatio * 100).toFixed(1)}%`,
  );
  // 关键判据：整块纯色 + **只有一条**竖直边界 ⇒ 边缘密度必须很低。
  // 若按 3 通道读 RGBA（列偏移错乱），每个采样点都会踩在不同的字节上，
  // 整幅变成高频噪声，这个值会飙高 —— 实测 0.99。
  assert.ok(
    stats.edgeOnContent < 0.2,
    `两半纯色 + 一条边界 ⇒ 边缘密度应很低，实得 ${stats.edgeOnContent.toFixed(3)}` +
      `（按 3 通道读 RGBA 时会飙到约 0.99）`,
  );

  // 与 ImageMagick 逐点核对左右两侧确实是黑白
  for (const [x, expected] of [[30, '0 0 0'], [170, '255 255 255']]) {
    const truth = execFileSync('magick', [
      out, '-format', `%[fx:int(255*p{${x},50}.r)] %[fx:int(255*p{${x},50}.g)] %[fx:int(255*p{${x},50}.b)]`, 'info:',
    ]).toString().trim();
    assert.equal(truth, expected, `magick 在 x=${x} 读到的应是 ${expected}`);
  }
});

test('糊字启发式：横向涂抹判为糊，清晰文本判为不糊', { skip: !hasMagick }, () => {
  // 清晰：细密黑白条纹（模拟文字的陡峭边缘）
  const crisp = join(workdir, 'crisp.png');
  execFileSync('magick', [
    '-size', '400x200', 'xc:white',
    '-fill', 'black',
    '-draw', 'stroke black stroke-width 2 line 40,20 40,180 line 70,20 70,180 line 100,20 100,180 line 130,20 130,180 line 160,20 160,180 line 190,20 190,180',
    crisp,
  ]);
  const a = inspectPng(crisp);
  assert.equal(looksBlank(a), false, '条纹图不该被判空白');
  assert.equal(looksSmeared(a), false, `清晰条纹不该被判糊（edge=${a.edgeOnContent.toFixed(3)}）`);

  // 糊：把同一张图做强横向模糊，再拉宽 —— 内容摊满、梯度消失
  const smeared = join(workdir, 'smeared.png');
  execFileSync('magick', [crisp, '-resize', '400x200!', '-motion-blur', '0x60+0', '-threshold', '50%', smeared]);
  const b = inspectPng(smeared);
  // 这条是**方向性**断言：只要求比清晰的低，不锁死绝对值
  assert.ok(
    b.edgeOnContent < a.edgeOnContent,
    `涂抹后边缘密度应下降：清晰 ${a.edgeOnContent.toFixed(3)} vs 涂抹 ${b.edgeOnContent.toFixed(3)}`,
  );
});

// ── 品牌蓝判据（`countColor` / `countBrandBlue`）──────────────────────────────
// 🔴 这四条原来**一条都没有**：安装包与壳级门禁的"装上来的是不是 heyta 的界面"整条判据
//    就落在这两个函数上（§7 第 82 条），而它自己没有任何常驻用例 —— 采样密度、容差、
//    暗色那一支哪天被改动，产出的仍是一个像样的小整数，没有任何一层会失败。
//    所以这里刻意做成**判别对**：同一张图在"非空白"上过得去、在"品牌蓝"上必须被拦住。

test('小块主蓝在大图上仍数得出（采样密度是这条判据的承重，不是装饰）', { skip: !hasMagick }, () => {
  // 1200x800 白底上放一块 24x24 的主蓝 —— 对应界面上的复选框/图标这类小元素。
  const file = makeImage('brand-blue-small.png', [
    '-size', '1200x800', 'xc:white',
    '-fill', `rgb(${HEYTA_BLUE.join(',')})`, '-draw', 'rectangle 100,100 123,123',
  ]);
  const hits = countColor(file, HEYTA_BLUE);
  assert.ok(hits > 0, `大图上的小块主蓝必须命中（实测 ${hits}）`);
  // 判据实际用的阈值来自 reinstall-all / check-macos-window 那一侧的 >=20，
  // 这里按同一条口径断言，而不是只断"> 0"——否则采样退化成 2 万点也会照样通过。
  assert.ok(hits >= 20, `命中数要过真实阈值（20），实测 ${hits}`);
  assert.ok(countBrandBlue(file) >= hits, 'countBrandBlue 是浅色+暗色之和，不该比单支少');
});

test('暗色主题那一支单独有用：同一张暗色图，浅色支命中 0、暗色支命中 >0', { skip: !hasMagick }, () => {
  const file = makeImage('brand-blue-dark.png', [
    '-size', '400x300', `xc:rgb(${HEYTA_BLUE_DARK.join(',')})`,
  ]);
  assert.equal(countColor(file, HEYTA_BLUE), 0, '暗色图不该被浅色那一支误认');
  assert.ok(countColor(file, HEYTA_BLUE_DARK) > 0, '暗色那一支必须认得自己的颜色');
  assert.ok(countBrandBlue(file) > 0, '两条合起来才是"这是 heyta 的界面"');
});

test('🔴 错误屏判别对：内容很多（非空白过得去）而品牌蓝命中 0', { skip: !hasMagick }, () => {
  // 复刻 §7 第 82 条那个"找不到共享 UI 产物"的报错屏：浅底 + 深灰标题与正文块。
  // 它 contentRatio 很高（`looksBlank` 永远放行），但没有一个像素是品牌色。
  const file = makeImage('error-screen.png', [
    '-size', '1200x800', 'xc:#F8FAFC',
    '-fill', '#0F172A', '-draw', 'rectangle 80,80 720,140',
    '-fill', '#334155', '-draw', 'rectangle 80,200 1080,240',
    '-fill', '#475569', '-draw', 'rectangle 80,270 960,310',
    '-fill', '#64748B', '-draw', 'rectangle 80,340 1010,380',
  ]);
  const stats = inspectPng(file);
  assert.equal(looksBlank(stats), false, '前提：这张图在"非空白"这条判据下是**通过**的');
  assert.ok(stats.contentRatio > 0.01, `内容占比要真的很高（实测 ${stats.contentRatio.toFixed(4)}）`);
  assert.equal(countBrandBlue(file), 0, '而品牌蓝必须一条都不命中 —— 这才是拦住错误屏的那半');
});

test('容差从被约束的常量推导：差 HEYTA_BLUE_TOLERANCE 算命中，再多 1 就不算', { skip: !hasMagick }, () => {
  const inside = makeImage('tol-inside.png', [
    '-size', '60x60', `xc:rgb(${HEYTA_BLUE[0] + HEYTA_BLUE_TOLERANCE},${HEYTA_BLUE[1]},${HEYTA_BLUE[2]})`,
  ]);
  const outside = makeImage('tol-outside.png', [
    '-size', '60x60', `xc:rgb(${HEYTA_BLUE[0] + HEYTA_BLUE_TOLERANCE + 1},${HEYTA_BLUE[1]},${HEYTA_BLUE[2]})`,
  ]);
  assert.ok(countColor(inside, HEYTA_BLUE) > 0, '正好落在容差上的像素要算命中');
  assert.equal(countColor(outside, HEYTA_BLUE), 0, '超出容差 1 就必须不算 —— 阈值是有边的');
});
