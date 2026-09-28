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

import { inspectPng, looksBlank } from './png-stats.mjs';

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
    join(process.cwd(), 'apps/mobile/ios/HeytaMobile/Images.xcassets/AppIcon.appiconset/icon-1024.png'),
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
