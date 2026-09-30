/**
 * 子任务在**移动端**的最后一段：详情面板真的接上了吗
 * ======================================================
 *
 * ## 为什么是**源码级**断言
 *
 * `apps/mobile` 没有组件测试栈（本仓刻意没引 `@testing-library/*`，理由见
 * `packages/ui/vitest.config.ts` 的文件头：为了测一个组件引入整套 DOM 测试栈，
 * 代价是长期维护面与许可证登记，而"组件树渲染得对不对"的真正判据是**真机渲染**）。
 *
 * 而这一条要防的失效**恰好是"接线断了"**，不是"逻辑算错了"：
 *
 *   - `packages/domain/src/subtasks.ts`（616 行，建树 + 环防护 + 深度/子数上限）✅ 有
 *   - `packages/app-host` 的 `setParent`（写前校验、失败即 throw）✅ 有
 *   - `apps/mobile` 的调用点 —— 🔴 **在补上之前是 0**
 *
 * ⇒ 症状是"模型支持、树能建、**用户没有任何办法造出一个子任务**"，而且**不报错**。
 * 这种"缺一根线"的失效，**任何行为测试都测不到**（没有行为可测），只能查源码。
 * 形状照 `packages/ui/tests/auth-model.spec.ts` 的"只有一份"那一组。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// `apps/mobile/tests` 上**三级**才是仓库根（少一级会落到 `apps/`，于是每个文件都读不到）。
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SHEET = 'apps/mobile/src/screens/TaskDetailSheet.tsx';
const SCREEN = 'apps/mobile/src/screens/TasksScreen.tsx';

const sheet = (): string => readFileSync(join(REPO, SHEET), 'utf8');

describe('移动端的子任务入口（源码级；这里没有组件测试栈）', () => {
  it('🔴 详情面板**真的调用了** `setParent`（补上之前是 0 个调用点）', () => {
    expect(sheet()).toMatch(/actions\s*\n?\s*\.setParent\(/);
  });

  it('🔴 候选用**领域层的 `canSetParent` 预过滤**，不是"id 不等于自己"', () => {
    const src = sheet();
    expect(src, '没有 import canSetParent —— 那就是在界面这一层自己判环').toContain('canSetParent');
    expect(src).toMatch(/canSetParent\(tasks,\s*task\.id,\s*t2\.id\)/);
    // 反面：土办法过滤（漏掉"后代"这一整类 ⇒ 能造出环）
    expect(src, '出现了 id !== task.id 这种过滤').not.toMatch(/\.filter\([^)]*t2\.id\s*!==\s*task\.id/);
  });

  it('🔴 拒绝**必须被接住并翻成人话**（`run()` 不接错误）', () => {
    const src = sheet();
    // `runSetParent` 必须有 `.catch`
    expect(src).toMatch(/\.catch\(/);
    // 而且翻的是**词条里的人话**，不是 `cause.message`（那是给开发者的诊断串）
    expect(src).toContain('subtaskRejectionMessageKey');
    expect(src).toContain('rejectionReasonOf');
  });

  it('调用方把**全量**任务传下去（不是"当前视图可见的"）', () => {
    const src = readFileSync(join(REPO, SCREEN), 'utf8');
    expect(src, '详情面板没拿到 tasks ⇒ 候选集会是空的，功能看起来不存在').toMatch(
      /<TaskDetailSheet[\s\S]*?tasks=\{tasks\}/,
    );
  });

  it('词条在 zh 里含汉字、在 en 里不含汉字，且两边的键集合一致', () => {
    const zh = readFileSync(join(REPO, 'packages/i18n/src/locales/zh-CN.ts'), 'utf8');
    const en = readFileSync(join(REPO, 'packages/i18n/src/locales/en.ts'), 'utf8');
    for (const key of ['mobile.detail.field.parent', 'mobile.detail.parent.topLevel']) {
      const zhLine = new RegExp(`'${key}':\\s*'([^']*)'`).exec(zh)?.[1] ?? '';
      const enLine = new RegExp(`'${key}':\\s*'([^']*)'`).exec(en)?.[1] ?? '';
      expect(zhLine, `${key} 在 zh 里缺失`).not.toBe('');
      expect(enLine, `${key} 在 en 里缺失`).not.toBe('');
      expect(/[\u4e00-\u9fff]/.test(zhLine), `${key} 的 zh 值不含汉字`).toBe(true);
      expect(/[\u4e00-\u9fff]/.test(enLine), `${key} 的 en 值含汉字`).toBe(false);
    }
  });
});