/**
 * 🔴 跨面板失败文案一致性（第 5 个入口的漂移不许再发生）
 * ========================================================
 *
 * ## 这条断言为什么存在
 *
 * `ai-failure-copy.ts` 的文件头记着一条**已经修过一次**的缺陷：四个面板原来
 * 把 `packages/app-host` 拼好的**中文**整句渲染成失败主文案，于是英文界面
 * 一失败就露中文。那一轮修了四个 —— **漏了第 5 个（`AiToolRun`）**，
 * 它继续渲染 `outcome.message`，于是**同一类缺陷以完全相同的形状又活了一轮**：
 * 工具调用失败时，英文界面整屏中文。
 *
 * 这与披露块那次的漂移是同一个形状（`ai-disclosure-parity.spec.tsx` 的文件头
 * 记着那一份）：**四个入口改好了、第 5 个没人管，而没有任何测试会红** ——
 * 每个面板各测各的，谁也没规定"五个入口必须一样"。
 *
 * ## 为什么这一条是**源码级**的
 *
 * 披露那条可以行为级地比：五个面板都能被同一份路由配置驱动到"披露"那一屏。
 * 失败态不行 —— 五个面板的失败输入各不相同（标题 / 正文 / 任务列表 / 工具话术），
 * 要逐一把它们推失败，写出来的是五段互相无关的驱动代码，而不是"一条规则"。
 * 所以这里钉**形状**：
 *
 *   1. 每个面板都必须从 `ai-failure-copy.js` 取一份 `*FailureCopy`
 *      （主文案 → 词条 key 的唯一入口）；
 *   2. 主文案节点必须渲染 `t(failure.key)`；
 *   3. **不许**把包给的原文（`outcome.message` / `failure.message` / `.detail`）
 *      直接当主文案 —— 它只允许进 `<details>`。
 *
 * ⚠️ 与所有源码级断言一样，它挡的是"复制粘贴忘改"，不是"故意绕过"。
 * 真正的行为级判据在各面板自己的 spec 里（英文界面那条在
 * `ai-tool-run.spec.tsx` 的"一个汉字都不许有"）。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const AI_DIR = resolve(HERE, '../src/features/ai');

/** 五个会失败、且必须说人话的 AI 入口。 */
const PANELS = ['AiBreakdown', 'AiCapture', 'AiDuration', 'AiPrioritize', 'AiToolRun'] as const;

function panelSource(name: (typeof PANELS)[number]): string {
  return readFileSync(join(AI_DIR, `${name}.tsx`), 'utf8');
}

describe('五个 AI 入口的失败文案只有一个来源', () => {
  it('每个面板都从 `ai-failure-copy.js` 取一份 `*FailureCopy`', () => {
    const offenders = PANELS.filter(
      (name) => !/import \{[^}]*FailureCopy[^}]*\} from '\.\/ai-failure-copy\.js';/u.test(panelSource(name)),
    );
    expect(
      offenders,
      '这些面板没有走统一的失败文案工厂 —— 它们会把包里的中文原句直接当主文案：',
    ).toEqual([]);
  });

  it('主文案必须是 `t(failure.key)`（不是原文）', () => {
    const offenders = PANELS.filter((name) => !panelSource(name).includes('t(failure.key)'));
    expect(offenders, '这些面板的失败主文案不是从词条表取的：').toEqual([]);
  });

  it('🔴 原始错误文本**不许**当主文案（那是数据，只进 `<details>`）', () => {
    const banned = [
      /<strong[^>]*>\s*\{outcome\.message\}/u,
      /<p[^>]*data-testid="[^"]*-failure-message"[^>]*>\s*\{failure\.detail\}/u,
    ];
    const offenders = PANELS.filter((name) => banned.some((re) => re.test(panelSource(name))));
    expect(
      offenders,
      '这些面板把包给的原文直接渲染成了主文案 —— 英文界面会整句露中文：',
    ).toEqual([]);
  });

  it('失败态的技术详情都收在 `<details>` 里（`-failure-message-detail`）', () => {
    const offenders = PANELS.filter(
      (name) => !panelSource(name).includes('data-testid="') || !/-failure-message-detail/u.test(panelSource(name)),
    );
    expect(offenders, '这些面板的失败态没有折叠的技术详情：').toEqual([]);
  });

  it('`ai-failure-copy.ts` 里五个工厂都在（漏一个就编译不过，这里再钉一次）', () => {
    const copy = readFileSync(join(AI_DIR, 'ai-failure-copy.ts'), 'utf8');
    for (const factory of [
      'breakdownFailureCopy',
      'captureFailureCopy',
      'durationFailureCopy',
      'prioritizeFailureCopy',
      'toolRunFailureCopy',
    ]) {
      expect(copy, `ai-failure-copy.ts 里没有 ${factory}`).toContain(`export function ${factory}(`);
    }
  });

  it('这份清单不能悄悄少一个面板（防止"删掉一个就绿了"）', () => {
    // 反过来查：目录里凡是渲染 `-failure-message` 的面板都必须在清单里。
    const rendered = readdirSync(AI_DIR)
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => readFileSync(join(AI_DIR, f), 'utf8').includes('-failure-message"'))
      .map((f) => f.replace(/\.tsx$/u, ''))
      .sort();
    expect(rendered).toEqual([...PANELS].sort());
  });
});
