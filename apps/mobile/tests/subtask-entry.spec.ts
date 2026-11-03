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
/**
 * 就地新建子任务 + 子任务列表 + 计数（工单 #6）
 * =============================================
 *
 * 上面那一族钉的是"能不能改父"，这一族钉的是"能不能**在这条任务上长出孩子**"。
 * 每一条都同时给正向锚点与反向形状 —— 只有"没命中"能被判成违规，绿才是证据。
 *
 * 🔴 反向断言之前**必须剥注释**：本文件上半部分不剥（`sheet()` 是原文），因为
 * 那一族的违规形状没有出现在说明文字里。这一族不一样 —— 要防的形状（"自己按父
 * id 过滤列表"、"create 之后再改父"）恰好都写在 `TaskDetailSheet.tsx` 的**注释**
 * 里，那些注释正是在解释"为什么不走那条路"。不剥的话，"讲过这个坑"会被读成
 * "还踩着这个坑"。
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\S\s]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const body = (): string => stripComments(sheet());

describe('详情面板的子任务区（就地新建 / 列表 / 计数）', () => {
  it('🔴 建子任务走 `createSubtask`（**一条** op），不是 create 之后再改父', () => {
    const src = body();
    expect(src).toMatch(/\.createSubtask\(/);
    // 反向：面板里没有"先建一条顶级任务"的调用点。拆两条 op 的后果是**中间态
    // 可被看见**，而改父被拒时那条顶级任务会永久留下（op-log 没有撤回）——
    // 用户看到"失败了"，库里却多了一条挂不上的脏数据。
    expect(src, '出现 .create( ⇒ 子任务被拆成了两条 op').not.toMatch(/\.create\(/);
  });

  it('🔴 列表取数走共享的 `buildTaskTree`，不在界面里自己过滤', () => {
    const src = body();
    expect(src).toMatch(/buildTaskTree\(tasks\)\.nodeById\.get\(task\.id\)/);
    // 反向：自己过滤会漏掉稳定排序、打断已有的环、以及"父已删除"的兜底
    // ⇒ 同一份数据在两台设备上条数与顺序都可能不同，而且不报错。
    expect(src, '界面里自己按父 id 拼了一份列表').not.toMatch(/parentId === task\.id/);
  });

  it('🔴 子任务行渲染**共享 `TaskRow`**，本文件不出现第二棵勾选框', () => {
    const src = body();
    expect(src).toMatch(/density="compact"/);
    expect(src, '出现 <Checkbox ⇒ 行骨架被重画了第二份').not.toMatch(/<Checkbox\b/);
    expect(src).not.toMatch(/accessibilityRole="checkbox"/);
  });

  it('「什么算完成」问领域层，不在界面里比完成时刻', () => {
    const src = body();
    expect(src).toMatch(/isCompleted\(node\.task\)/);
    expect(src, '界面里自己判完成时刻 ⇒ 这是第三份"什么算完成"').not.toMatch(
      /node\.task\.completedAt\s*===\s*undefined/,
    );
  });

  it('🔴 空态之外**必须有真的入口**（那句文案指的是下面那枚按钮）', () => {
    const src = body();
    expect(src).toMatch(/task-detail-add-subtask/);
    // 入口若被关进"有子任务才渲染"那一支，0 条子任务时就只剩一句"点下面的按钮"
    // 而下面什么也没有 —— 这一条测的就是那两句的**先后与同现**。
    // 入口**由谁决定**才是这条判据的内容：它必须落在 `newSubtaskOpen` 那枚三元的
    // 收起支里（收起 = 画按钮），而不是由"已经有子任务"决定。
    // 被关进非空分支的后果是：0 条子任务时界面上只剩一句"点下面的按钮"，
    // 而下面什么也没有 —— 那句空态文案自己把自己否定了。
    const addBranch =
      /newSubtaskOpen \?[\S\s]{0,1400}?task-detail-add-subtask/.exec(src)?.[0] ?? '';
    expect(addBranch, '添加入口不在 newSubtaskOpen 三元的收起支里').not.toBe('');
    expect(addBranch, '入口由"已经有子任务"决定 ⇒ 空态下没有入口').not.toMatch(
      /subtaskNodes\.length > 0/,
    );
  });

  it('`createSubtask` 的拒绝被接住并翻成人话（`run()` 不接错误）', () => {
    const src = body();
    const addBlock = /const runAddSubtask[\S\s]*?\n {2}\}, \[/.exec(src)?.[0] ?? '';
    expect(addBlock, '没找到 runAddSubtask 这一块').not.toBe('');
    expect(addBlock).toMatch(/\.catch\(/);
    expect(addBlock).toMatch(/subtaskRejectionMessageKey\(rejectionReasonOf\(cause\)\)/);
  });

  it('宿主把「打开子任务」接上了（否则行看得见却点不动）', () => {
    const src = readFileSync(join(REPO, SCREEN), 'utf8');
    expect(src, '<TaskDetailSheet> 没传 onOpenSubtask').toMatch(
      /<TaskDetailSheet[\s\S]*?onOpenSubtask=\{/,
    );
  });

  it('🔴 空态文案里「」点名的那个按钮，真的就叫那个名字', () => {
    // 「点下面的『新建标签』」而按钮写着别的字，是**只有真机才会暴露**的缺陷：
    // 读屏用户与看界面的人拿到两个不同的指路，而类型检查与样式门禁都不会红。
    const zh = readFileSync(join(REPO, 'packages/i18n/src/locales/zh-CN.ts'), 'utf8');
    const value = (key: string): string =>
      new RegExp(`'${key}':\\s*'([^']*)'`).exec(zh)?.[1] ?? '';

    for (const [emptyKey, buttonKey] of [
      ['mobile.detail.tags.empty', 'mobile.tags.add'],
      ['mobile.detail.subtasks.empty', 'mobile.detail.subtasks.add'],
    ] as const) {
      const named = /「([^」]+)」/.exec(value(emptyKey))?.[1];
      expect(named, `${emptyKey} 里没有「…」这句指路`).toBeDefined();
      expect(value(buttonKey), `${buttonKey} 缺失`).not.toBe('');
      expect(named, `${emptyKey} 指的名字与按钮文案「${value(buttonKey)}」不同名`).toBe(
        value(buttonKey),
      );
    }
  });

  it('标签可以就地新建（建完立刻点亮到这条任务上）', () => {
    const src = body();
    expect(src).toMatch(/projectActions\s*\n?\s*\.createTag\(/);
    expect(src).toMatch(/setTags\(task\.id,\s*\[\.\.\.\(task\.tagIds \?\? \[\]\), tagId\]\)/);
  });
});
