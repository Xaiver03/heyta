/**
 * 错误态的形态判据（R11 建议 4）
 * ==============================
 *
 * `packages/ui` 跑 node 环境、加载不了 RN 渲染树（见 `vitest.config.ts` 文件头），
 * 所以这里判**源码形状**。三条都在挡同一件事：
 *
 *   1. 错误态**不许**变成空态的第五档（借它的根样式 / 借它的 `size`）；
 *   2. 重试按钮必须**成对**出现（只有文案没有回调 = 假动作）；
 *   3. 它必须**打断**读屏（`accessibilityRole="alert"`），而不是被念成"摘要"。
 *
 * 先掩码注释再判 —— 不掩码的话，照纪律在注释里写"别抄 `space.16`"的人会吃假红，
 * 而假红的终局永远是有人来放宽判据。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 抹掉注释、保留行数与列位置（与 `check-l4-no-style.mjs` 同一条做法）。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (line) => line.replace(/[^\n]/g, ' '));
}

const SRC = readFileSync(join(process.cwd(), 'src/feedback/ErrorState.tsx'), 'utf8');
const CODE = stripComments(SRC);

describe('错误态：不许是空态的第五档', () => {
  it('不 import EmptyState、不传它的 size（两个命名空间互不借用）', () => {
    expect(CODE).not.toMatch(/from ['"].*empty-state/);
    expect(CODE).not.toMatch(/\bsize=\{['"](?:page|card|section|line)['"]/);
  });

  it('根节点没有页面档的大内边距（space.16 是"这里很空"，不是"这里坏了"）', () => {
    expect(CODE).not.toContain("space.16");
  });

  it('根节点声明 alert 语义（它要打断，不是被念成 summary）', () => {
    expect(CODE).toMatch(/accessibilityRole=\{?["']alert["']/);
  });

  it('重试按钮成对：文案与回调必须同时给，否则不画', () => {
    // 判据落在源码上：showRetry 必须同时检查两件事。
    expect(CODE).toMatch(/retryLabel/);
    expect(CODE).toMatch(/onRetry\s*!==\s*undefined/);
    expect(CODE).toMatch(/retryLabel\.length\s*>\s*0/);
  });
});

const SKELETON = stripComments(
  readFileSync(join(process.cwd(), 'src/feedback/Skeleton.tsx'), 'utf8'),
);

describe('骨架：条数未知的那一半', () => {
  it('不给读屏逐条念空盒子（根节点 progressbar + 子节点隐藏）', () => {
    expect(SKELETON).toMatch(/accessibilityRole=\{?["']progressbar["']/);
    expect(SKELETON).toMatch(/accessibilityElementsHidden/);
  });

  it('没有无限动画：本文件里不出现 Animated / looping', () => {
    expect(SKELETON).not.toMatch(/\bAnimated\b/);
    expect(SKELETON).not.toMatch(/loop\s*:/);
  });

  it('高度与圆角走 token，不写裸值', () => {
    expect(SKELETON).toMatch(/tokens\[['"]size\.field-height['"]\]/);
    expect(SKELETON).toMatch(/tokens\[['"]radius\.sm['"]\]/);
    expect(SKELETON).not.toMatch(/height:\s*\d/);
  });
});
