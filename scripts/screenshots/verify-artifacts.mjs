/**
 * 截图产物校验门禁。
 *
 *   pnpm screenshot:verify
 *
 * 移植自 SSOS 的 `scripts/screenshot-artifact-validation.mjs`，判据完全一致：
 *
 *   1. **数量**对得上（少一张 = 有视图没截到）
 *   2. **尺寸**精确匹配（App Store 上传会因尺寸不对被拒）
 *   3. **不含 alpha 通道**（App Store 的 1024 图标硬性要求，截图同理更严）
 *   4. 🔴 **不是空白**（`contentRatio < 0.01` 或 `colorSpan < 16`）
 *
 * 🔴 第 4 条是这套东西存在的**真正理由**：截图脚本"跑成功"和"截到东西"
 * 是两件事。页面 404、白屏、渲染未完成、被引导弹窗盖住 —— 截出来都是一张
 * 纯白图，尺寸正常、退出码 0、文件名齐全。**只有看像素才能发现。**
 *
 * 退出码：有问题 = 1，全过 = 0（可直接进 CI）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { inspectPng, looksBlank, looksSmeared } from './png-stats.mjs';
import {
  ARTIFACT_ROOT,
  DEVICES,
  KNOWN_BAD_CAPTURE_METHODS,
  SHELL_EVIDENCE,
  artifactName,
  expectedGroups,
} from './targets.mjs';

const root = process.cwd();
const problems = [];
const notes = [];

function readPngs(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name) => inspectPng(join(directory, name)));
}

for (const group of expectedGroups()) {
  const directory = join(root, ARTIFACT_ROOT, group.folder);
  const files = readPngs(directory);
  const byName = new Map(files.map((file) => [file.name, file]));

  const missing = [];
  const present = [];

  for (const target of group.targets) {
    const name = artifactName(target);
    const file = byName.get(name);
    if (file) present.push({ target, file });
    else missing.push(name);
  }

  if (missing.length > 0) {
    // 产物还没生成不算"错误"（产品未完成阶段本就是空的），但要如实报出来
    notes.push(`${group.label}: 缺失 ${missing.length}/${group.targets.length} 张 —— ${missing.slice(0, 4).join('、')}${missing.length > 4 ? ' …' : ''}`);
    continue;
  }

  const expected = {
    width: group.device.viewport.width * group.device.viewport.deviceScaleFactor,
    height: group.device.viewport.height * group.device.viewport.deviceScaleFactor,
  };

  for (const { target, file } of present) {
    if (file.width !== expected.width || file.height !== expected.height) {
      problems.push(
        `${group.label}/${file.name}: 尺寸 ${file.width}×${file.height}，期望 ${expected.width}×${expected.height}`,
      );
    }
    if (file.hasTransparency) {
      problems.push(`${group.label}/${file.name}: 含实际透明像素（colorType=${file.colorType}）`);
    }
    if (looksBlank(file)) {
      problems.push(
        `${group.label}/${file.name}: 🔴 疑似空白 —— 内容比例 ${(file.contentRatio * 100).toFixed(1)}%，色阶差 ${file.colorSpan}` +
          `\n    ⇒ 这张图几乎全是白/同色。先查页面是否 404 / 白屏 / 渲染未完成 / 被弹窗遮挡，` +
          `\n      再查 readyText 是否等错了元素。**不要靠调低阈值让它变绿。**`,
      );
    }
  }

  const extra = files.filter((file) => !group.targets.some((t) => artifactName(t) === file.name));
  if (extra.length > 0) {
    notes.push(`${group.label}: 有 ${extra.length} 张不在注册表里（可能是改名后残留）—— ${extra.slice(0, 3).map((f) => f.name).join('、')}`);
  }
}

// ── 原生壳证据：**来源门禁**（防回归的核心）＋ 糊字启发式 ─────────────────
//
// 顺序很重要：先证明"这份证据是可信的采集路径产出的"，再看它长什么样。
// 反过来做就会出现"图看着没问题、其实是渲染坏的"那种漏检。
for (const evidence of SHELL_EVIDENCE) {
  const pngPath = join(root, evidence.png);
  const notePath = join(root, evidence.note);

  if (!existsSync(pngPath)) {
    notes.push(`${evidence.label}: 证据图还没生成（${evidence.png}）`);
    continue;
  }

  const stats = inspectPng(pngPath);
  if (stats.hasTransparency) problems.push(`${evidence.label}: 证据图含实际透明像素`);
  if (looksBlank(stats)) {
    problems.push(`${evidence.label}: 🔴 证据图疑似空白（内容 ${(stats.contentRatio * 100).toFixed(1)}%）`);
  } else if (looksSmeared(stats)) {
    problems.push(
      `${evidence.label}: 🔴 证据图疑似**渲染坏了**（内容占比 ${(stats.contentOnModalRatio * 100).toFixed(1)}%，` +
        `边缘密度 ${stats.edgeOnContent.toFixed(3)}）\n` +
        `    ⇒ "内容摊满画布却没有梯度"是横向涂抹的典型形态。\n` +
        `      先查采集方式，别去调阈值。`,
    );
  }

  // 🔴 来源门禁
  if (!existsSync(notePath)) {
    problems.push(
      `${evidence.label}: 缺少证据说明 ${evidence.note} —— **无法证明这份图是怎么采的**\n` +
        `    ⇒ 请用 apps/desktop-macos/scripts/capture-window.sh 重新采集（它会写好说明）`,
    );
    continue;
  }
  const note = readFileSync(notePath, 'utf8');
  const method = /^CAPTURE_METHOD=(.+)$/m.exec(note)?.[1]?.trim();
  const crosscheck = /^CROSSCHECK=(.+)$/m.exec(note)?.[1]?.trim();

  if (!method) {
    problems.push(`${evidence.label}: 证据说明里没有 CAPTURE_METHOD —— 无法判定采集路径是否可信`);
  } else if (KNOWN_BAD_CAPTURE_METHODS.has(method)) {
    problems.push(
      `${evidence.label}: 🔴 采集方式是不可信的 \`${method}\`\n` +
        `    ⇒ ${KNOWN_BAD_CAPTURE_METHODS.get(method)}\n` +
        `    ⇒ 改用 capture-window.sh（cgs-window-server）重采`,
    );
  } else if (!evidence.methods.includes(method)) {
    problems.push(
      `${evidence.label}: 采集方式 \`${method}\` 不在白名单里（允许：${evidence.methods.join(' / ')}）\n` +
        `    ⇒ 要么改成可信方式，要么先证明它是忠实的`,
    );
  }

  if (evidence.requiresCrosscheck) {
    if (!crosscheck) {
      problems.push(`${evidence.label}: 证据说明里没有 CROSSCHECK —— 没有与独立截屏交叉验证过`);
    } else if (!crosscheck.startsWith('ok')) {
      problems.push(`${evidence.label}: 交叉验证未通过（${crosscheck}）—— 自产图与独立截屏对不上`);
    }
  }
}

for (const note of notes) console.log(`  ⚠️  ${note}`);

if (problems.length > 0) {
  console.error('');
  for (const problem of problems) console.error(`  🔴 ${problem}`);
  console.error(`\n截图校验未通过：${problems.length} 个问题`);
  process.exit(1);
}

const total = expectedGroups().reduce((sum, group) => sum + group.targets.length, 0);
console.log(`\n✅ 截图校验通过（注册表共 ${total} 个目标；已生成的均尺寸正确、无 alpha、非空白）`);
