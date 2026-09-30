/**
 * 滴答清单导入（移动端）—— 预览 → 确认
 * ========================================
 *
 * 🔴 这个文件钉的是**移动端的最后一段**：`packages/domain` 的 CSV 解析与
 * `packages/app-host` 的导入动作**都早就写好了**，web 端也有入口，
 * 而移动端**一次调用点都没有**（`ExportScreen` 的文件头甚至写着"这一轮不做导入"）。
 * 于是"从滴答清单搬过来"在手机上不存在 —— 又是"基础设施做完、最后一米没接"。
 *
 * 补上之后要保证的四件事，缺一件这个功能就是假的：
 *
 *   1. **预览真的不写**（`dispatch` 一次都不被调用）—— 预览若能写，
 *      "先看看会导入什么"就是假承诺；
 *   2. **解析失败要说得出原因**（`no-header` / `no-tasks`），不是笼统的"失败了"；
 *   3. **确认 = 按批次逐条派发**，条数与预览给的一致；
 *   4. 🔴 **派发中途抛错要原样上抛** —— 吞成"成功"会让一次半截导入
 *      在界面上看起来完成了（构造器文件头把它列为禁止写法）。
 *
 * ⚠️ 本文件**刻意不 import `react-native`**（在 node 里加载它直接失败），
 * 所以宿主是一个**假对象**，只实现动作层真正会碰的两件事：`getState` / `dispatch`。
 * 同 `widget-drain.spec.ts` 的做法。
 */

import { describe, expect, it, vi } from 'vitest';

import type { AppHost } from '@heyta/app-host';
import { emptyState } from '@heyta/op-log';

import { confirmTickTickImport, previewTickTickImport } from '../src/lib/ticktick-import';

/** 只实现动作层会碰的两件事；其余一律不假装有。 */
function fakeHost(): { host: AppHost; dispatch: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn(async () => undefined);
  const host = {
    getState: () => emptyState(),
    dispatch,
  } as unknown as AppHost;
  return { host, dispatch };
}

/** 合法的滴答备份 CSV。判据是**同时含 `Title` 与 `List Name` 两列**。 */
const CSV_OK = ['"Title","List Name"', '"Ship CSV importer","Projects"', '"买牛奶","Inbox"'].join(
  '\n',
);

/** 没有表头（`parseTickTickCsv` 的 `no-header`）。 */
const CSV_NO_HEADER = ['"待办","清单"', '"买牛奶","收集箱"'].join('\n');

/** 表头在、但一条可导入的任务都没有（`no-tasks`）。 */
const CSV_NO_TASKS = '"Title","List Name"';

describe('previewTickTickImport —— 只回答"会写什么"，一个字都不写', () => {
  it('🔴 预览**不调用 `dispatch`**（否则"先看看"就是假承诺）', () => {
    const { host, dispatch } = fakeHost();
    const preview = previewTickTickImport(CSV_OK, host);

    expect(preview.ok).toBe(true);
    expect(dispatch, '预览阶段写了 op').not.toHaveBeenCalled();
    if (preview.ok) {
      expect(preview.batch.entries.length).toBeGreaterThan(0);
      // 两条任务 + 两个清单（Projects / Inbox）
      expect(preview.batch.plan.tasks).toHaveLength(2);
    }
  });

  it('没有表头 ⇒ `no-header`（不是笼统的"失败了"）', () => {
    const { host } = fakeHost();
    const preview = previewTickTickImport(CSV_NO_HEADER, host);
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.reason).toBe('no-header');
  });

  it('表头在但没有可导入的行 ⇒ `no-tasks`', () => {
    const { host } = fakeHost();
    const preview = previewTickTickImport(CSV_NO_TASKS, host);
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.reason).toBe('no-tasks');
  });

  it('空文本不会崩（粘错东西时界面要能活下去）', () => {
    const { host } = fakeHost();
    const preview = previewTickTickImport('', host);
    expect(preview.ok).toBe(false);
  });
});

describe('confirmTickTickImport —— 按批次逐条派发', () => {
  it('派发条数与预览一致，并返回新增计数', async () => {
    const { host, dispatch } = fakeHost();
    const preview = previewTickTickImport(CSV_OK, host);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await confirmTickTickImport(preview.plan, preview.report, host);

    expect(dispatch).toHaveBeenCalledTimes(preview.batch.entries.length);
    expect(result.opCount).toBe(preview.batch.entries.length);
    expect(result.added.tasks).toBe(2);
  });

  it('🔴 派发中途抛错 ⇒ **原样上抛**（不许吞成"成功"）', async () => {
    const dispatch = vi.fn(async () => {
      throw new Error('引擎炸了');
    });
    const host = { getState: () => emptyState(), dispatch } as unknown as AppHost;

    const preview = previewTickTickImport(CSV_OK, host);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    await expect(confirmTickTickImport(preview.plan, preview.report, host)).rejects.toThrow(
      /引擎炸了/,
    );
  });
});

describe('移动端界面真的接上了（源码级 —— 这里没有组件测试栈）', () => {
  it('🔴 `ExportScreen` import 并渲染了导入段落', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    // `apps/mobile/tests` 上**三级**才是仓库根。
    const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const src = readFileSync(join(repo, 'apps/mobile/src/screens/ExportScreen.tsx'), 'utf8');

    expect(src, '没 import 控制器').toContain('previewTickTickImport');
    expect(src, '没渲染导入标题').toContain("t('web.ticktick.title')");
    // 🔴 移动端是**粘贴**，不是选文件 —— 这句诚实条款必须在，否则用户会去找"选文件"的按钮。
    expect(src, '没说清"粘贴而不是选文件"').toContain("t('mobile.import.pasteNotFile')");
    // 多行输入：CSV 是多行文本，单行框里只看得到最后一行。
    expect(src, '粘贴框不是多行').toMatch(/multiline/);
  });
});